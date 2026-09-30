import fs, { type FSWatcher } from "node:fs"
import path from "node:path"
import type { BrowserWindow } from "electron"
import { scanMcpLibrary } from "./mcp-config"
import { mcpAgentRegistry } from "./mcp-registry"
import { openDb } from "./db/index"
import { ActivityStore } from "./db/activity"

// Window during which file changes are attributed to Skillbox's own write
// operations (the IPC write handlers log their own activity events), so the
// watcher does not log them twice.
const SELF_WRITE_WINDOW_MS = 3000

let lastLibrary: McpLibrary | null = null
let lastSelfWriteAt = 0
let activityStore: ActivityStore | null = null

function activity(): ActivityStore {
  activityStore ??= new ActivityStore(openDb())
  return activityStore
}

// Called by the IPC write handlers after a Skillbox-originated config write:
// suppresses watcher-side event logging for the change and refreshes the
// baseline so later external diffs stay accurate.
export function noteSkillboxMcpWrite(library: McpLibrary): void {
  lastSelfWriteAt = Date.now()
  lastLibrary = library
}

function agentLabel(agentId: string): string {
  return mcpAgentRegistry.find((a) => a.id === agentId)?.displayName ?? agentId
}

function connectionSignatures(library: McpLibrary): Map<string, string> {
  const map = new Map<string, string>()
  for (const server of library.servers) {
    for (const connection of server.connections) {
      map.set(`${server.name}::${connection.agentId}`, connection.signature)
    }
  }
  return map
}

function diffAndLog(previous: McpLibrary, next: McpLibrary): void {
  const oldConns = connectionSignatures(previous)
  const newConns = connectionSignatures(next)
  const messages: string[] = []
  for (const [key, signature] of newConns) {
    const [server, agentId] = key.split("::")
    const label = agentLabel(agentId)
    const old = oldConns.get(key)
    if (old === undefined) {
      messages.push(`${server} 接入 ${label}`)
    } else if (old !== signature) {
      messages.push(`${label} 的 ${server} 配置已变更`)
    }
  }
  for (const key of oldConns.keys()) {
    if (!newConns.has(key)) {
      const [server, agentId] = key.split("::")
      messages.push(`${agentLabel(agentId)} 移除了 ${server}`)
    }
  }
  for (const message of messages) {
    try {
      activity().add("mcp", message)
    } catch (error) {
      console.warn("[mcp] failed to log activity:", error)
    }
  }
}

export class McpConfigWatcher {
  private readonly mainWindow: BrowserWindow
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly configNamesByDirectory = new Map<string, Set<string>>()
  private refreshTimer: NodeJS.Timeout | null = null
  private reconcileTimer: NodeJS.Timeout | null = null

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  start(): void {
    // Establish the diff baseline; events are only logged for changes after this.
    void scanMcpLibrary()
      .then((library) => {
        lastLibrary = library
      })
      .catch(() => {})

    for (const agent of mcpAgentRegistry) {
      for (const configPath of [agent.configPath, ...(agent.alternateConfigPaths ?? [])]) {
        const directory = path.dirname(configPath)
        const names = this.configNamesByDirectory.get(directory) ?? new Set<string>()
        names.add(path.basename(configPath).toLowerCase())
        this.configNamesByDirectory.set(directory, names)
      }
    }
    this.reconcileWatchers()
    this.reconcileTimer = setInterval(() => this.reconcileWatchers(), 5000)
  }

  stop(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = null
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    this.reconcileTimer = null
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    this.configNamesByDirectory.clear()
  }

  private reconcileWatchers(): void {
    for (const [directory, watcher] of this.watchers) {
      if (fs.existsSync(directory)) continue
      watcher.close()
      this.watchers.delete(directory)
    }
    for (const [directory, configNames] of this.configNamesByDirectory) {
      if (this.watchers.has(directory) || !fs.existsSync(directory)) continue
      try {
        const watcher = fs.watch(directory, (_event, filename) => {
          if (!filename || !configNames.has(filename.toString().toLowerCase())) return
          this.scheduleRefresh()
        })
        watcher.on("error", (error) => {
          console.warn(`[mcp] stopped watching ${directory}:`, error)
          watcher.close()
          this.watchers.delete(directory)
        })
        this.watchers.set(directory, watcher)
      } catch (error) {
        console.warn(`[mcp] could not watch ${directory}:`, error)
      }
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.broadcast()
    }, 250)
  }

  private async broadcast(): Promise<void> {
    if (this.mainWindow.isDestroyed()) return
    try {
      const library = await scanMcpLibrary()
      // Log external edits as activity; Skillbox's own writes are logged by
      // the IPC handlers and suppressed here via the self-write window.
      if (lastLibrary && Date.now() - lastSelfWriteAt > SELF_WRITE_WINDOW_MS) {
        diffAndLog(lastLibrary, library)
      }
      lastLibrary = library
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("mcp:updated", library)
      }
    } catch (error) {
      console.warn("[mcp] refresh after config change failed:", error)
    }
  }
}
