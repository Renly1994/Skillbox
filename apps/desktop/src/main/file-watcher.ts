import { BrowserWindow } from "electron"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { rescanAndCache, rescanSingleSkill, detectAgents } from "./ipc-handlers"
import { agentRegistry } from "./agent-registry"

const DEBOUNCE_MS = 500
const CANONICAL_DIR = path.join(os.homedir(), ".agents", "skills")

/**
 * File watcher that monitors all detected agent skill directories
 * and the canonical ~/.agents/skills/ directory for changes.
 *
 * On change, it debounces and re-scans installed skills, then pushes
 * the updated list to the renderer via IPC.
 */
export class SkillsFileWatcher {
  private watchers: fs.FSWatcher[] = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingSkillFolders = new Set<string>()
  private forceFullRescan = false
  private mainWindow: BrowserWindow

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  async start(): Promise<void> {
    const dirsToWatch = new Set<string>()

    // Always watch the canonical skills directory
    try {
      const realCanonical = await fs.promises.realpath(CANONICAL_DIR)
      dirsToWatch.add(realCanonical)
    } catch {
      dirsToWatch.add(CANONICAL_DIR)
    }

    // For each agent, only watch if it resolves to a different real path
    const detected = await detectAgents()
    for (const agent of detected) {
      const entry = agentRegistry[agent.name]
      if (!entry) continue
      try {
        const realPath = await fs.promises.realpath(entry.globalSkillsDir)
        dirsToWatch.add(realPath)
      } catch {
        // Dir doesn't exist yet -- watch the expected path
        dirsToWatch.add(entry.globalSkillsDir)
      }
    }

    for (const dir of dirsToWatch) {
      this.watchDirectory(dir)
    }
  }

  private watchDirectory(dir: string): void {
    // Ensure the directory exists before watching
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      // If we can't create it, try watching anyway
    }

    try {
      // Use recursive option on macOS/Windows (supported natively).
      // On Linux, recursive is supported since Node 19+ with inotify.
      const watcher = fs.watch(
        dir,
        { recursive: true, persistent: false },
        (_eventType, filename) => {
          this.scheduleRescan(typeof filename === "string" ? filename : null)
        },
      )

      watcher.on("error", (err) => {
        console.error(`File watcher error for ${dir}:`, err.message)
      })

      this.watchers.push(watcher)
    } catch (err) {
      // Directory may not exist or not be watchable -- that's ok.
      // Skills might not be installed in every agent yet.
      console.warn(
        `Could not watch ${dir}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  private scheduleRescan(changedPath: string | null): void {
    const skillFolder = this.getChangedSkillFolder(changedPath)
    if (skillFolder) {
      this.pendingSkillFolders.add(skillFolder)
    } else {
      this.forceFullRescan = true
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(async () => {
      const pendingFolders = [...this.pendingSkillFolders]
      const shouldFullRescan =
        this.forceFullRescan || pendingFolders.length !== 1

      this.debounceTimer = null
      this.pendingSkillFolders.clear()
      this.forceFullRescan = false
      try {
        if (!shouldFullRescan) {
          await rescanSingleSkill(pendingFolders[0])
        } else {
          await rescanAndCache({ skipCustomPaths: true })
        }
      } catch (err) {
        console.error("Rescan after file change failed:", err)
      }
    }, DEBOUNCE_MS)
  }

  private getChangedSkillFolder(changedPath: string | null): string | null {
    if (!changedPath) {
      return null
    }

    const segments = changedPath.split(/[\\/]+/).filter(Boolean)
    const skillFolder = segments[0]
    if (!skillFolder || skillFolder.startsWith(".")) {
      return null
    }

    return skillFolder
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.pendingSkillFolders.clear()
    this.forceFullRescan = false

    for (const watcher of this.watchers) {
      try {
        watcher.close()
      } catch {
        // Best effort
      }
    }
    this.watchers = []
  }
}
