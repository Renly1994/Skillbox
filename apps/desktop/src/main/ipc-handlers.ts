import { app, BrowserWindow, dialog, ipcMain, net, safeStorage, shell } from "electron"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import fsSync from "node:fs"
import { execFile, spawn } from "node:child_process"
import AdmZip from "adm-zip"
import matter from "gray-matter"
import { openDb } from "./db/index"
import { SettingsStore } from "./db/settings"
import { RemoteServerStore } from "./db/servers"
import { RemoteSkillStore } from "./db/skills"
import { FavoritesStore } from "./db/favorites"
import { TranslationCacheStore } from "./db/translation-cache"
import { ActivityStore } from "./db/activity"
import { loadCachedSkills, saveCachedSkills } from "./db/skills-cache"
import {
  loadTrendingCache,
  saveTrendingCache,
  type TrendingSkill,
} from "./db/trending-cache"
import { testConnection, syncRemoteServer, readRemoteFile, writeRemoteFile } from "./db/ssh"
import { planPush, applyPush } from "./db/push"
import type { PushPreview } from "./db/push"
import {
  checkForAppUpdates,
  downloadAppUpdate,
  getUpdateState,
  quitAndInstallUpdate,
} from "./auto-updater"
import {
  agentRegistry,
  dirExists,
  getAgentGlobalSkillDirectories,
  PROJECT_PROBES,
  type AgentEntry,
} from "./agent-registry"
import {
  compareSkillContents,
  createSkillContentFingerprint,
  syncAgentCopyToMaster,
  type SkillVersionChange,
} from "./version-sync"
import {
  findCustomSkillLocations,
} from "./custom-skill-scanner"
import { findSkillDirectories } from "./skill-directory-scanner"
import { getScannedSkillScope } from "./skill-scan-scope"
import { createSkillSourceResolver } from "./skill-source-records"
import { resolveSkillTimestamps } from "./skill-timestamps"
import { mergeProjectSkillsIntoGlobal } from "./skill-display-merge"
import {
  moveAgentSkillDirectory,
  prepareAgentSkillTarget,
  selectAgentSkillRemovalCandidates,
} from "./agent-skill-target"
import {
  assertSafePathSegment,
  isPathInside,
  removeSkillPath,
  resolveSkillRemovalRoots,
  selectAgentSkillRemovalTargets,
  validateSkillRemovalRequest,
  type SkillRemovalRequest,
} from "./skill-removal"
import {
  acquireGitHubRepository,
  cleanupMarketplaceTempDirectories,
} from "./github-repository-download"
import {
  isRequestedMarketplaceContent,
  marketplaceSourceKey,
  requireLinkedSourceSkill,
  selectMarketplaceSkill,
} from "./marketplace-install"
import {
  MarketplaceInstallTaskStore,
  marketplaceInstallTaskKey,
  type MarketplaceInstallStage,
  type MarketplaceInstallTask,
} from "./marketplace-install-task"
import {
  buildTranslationCacheKey,
  buildTranslationRequest,
  buildTranslationSourceHash,
  getTranslationPreset,
  normalizeTranslationUsage,
  parseTranslationResponse,
  recordTranslationUsage,
  validateTranslationConfig,
  validateTranslationContent,
  type TranslationConfig,
  type TranslationUsage,
} from "./translation"
import {
  addMcpServer,
  openMcpConfig,
  removeMcpServer,
  scanMcpLibrary,
  setMcpConnection,
  syncMcpServer,
} from "./mcp-config"
import { mcpAgentRegistry } from "./mcp-registry"
import { noteSkillboxMcpWrite } from "./mcp-config-watcher"
import {
  SkillVersionStore,
  migrateDefaultSkillVersionStore,
  migrateSkillVersionStore,
  prepareSkillVersionPathMigration,
  type SkillVersionReason,
} from "./skill-version-history"
import { migrateSkillStorage } from "./skill-storage-migration"
import {
  remapPathKeyedRecords,
  remapSkillStoragePathFromRoots,
  remapSkillStoragePathList,
} from "./skill-storage-records"

const home = os.homedir()

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p)
    return stat.isFile()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Lock file reading (mirrored from packages/cli/src/core/skill-lock.ts)
// ---------------------------------------------------------------------------

const LOCK_FILE_VERSION = 1
const LOCK_FILE_PATH = path.join(home, ".agents", ".skill-lock.json")
const CANONICAL_SKILLS_DIR = path.join(home, ".agents", "skills")
const SKILL_STORAGE_PATH_KEY = "skills.storagePath"
const DETACHED_AGENT_COPIES_DIR = path.join(home, ".agents", "skillbox-detached")
const SKILLBOX_BACKUPS_DIR = path.join(home, ".agents", "skillbox-backups")
const SKILL_VERSION_STORAGE_KEY = "versions.storagePath"
const SKILL_VERSION_RETENTION_KEY = "versions.maxPerSkill"
const DEFAULT_SKILL_VERSION_RETENTION = 20

interface SkillLockEntry {
  source: string
  sourceType: string
  originalUrl?: string
  sourceLinked?: boolean
  skillId?: string
  skillFolderHash?: string
  installedAt?: string
  updatedAt?: string
}

interface SkillLockFile {
  version: number
  skills: Record<string, SkillLockEntry>
  linkedSources?: Record<string, SkillLockEntry>
}

function getSkillSourceRecord(lock: SkillLockFile, skillPath: string): SkillLockEntry | undefined {
  const resolvedPath = path.resolve(skillPath)
  const linked = lock.linkedSources?.[pathComparisonKey(resolvedPath)]
  if (linked) return linked
  const managed = getSkillStorageRoots().some((root) => isPathInside(root, resolvedPath)) ||
    Object.values(agentRegistry).some((agent) =>
      getAgentGlobalSkillDirectories(agent).some((root) => isPathInside(root, resolvedPath)),
    )
  return managed
    ? lock.skills[path.basename(resolvedPath)]
    : undefined
}

async function readSkillLock(): Promise<SkillLockFile> {
  try {
    const raw = await fs.readFile(LOCK_FILE_PATH, "utf-8")
    const data = JSON.parse(raw) as SkillLockFile
    if (data.version !== LOCK_FILE_VERSION) {
      return { version: LOCK_FILE_VERSION, skills: {} }
    }
    return data
  } catch {
    return { version: LOCK_FILE_VERSION, skills: {} }
  }
}

async function writeSkillLock(lock: SkillLockFile): Promise<void> {
  await fs.mkdir(path.dirname(LOCK_FILE_PATH), { recursive: true })
  await fs.writeFile(LOCK_FILE_PATH, JSON.stringify(lock, null, 2), "utf-8")
}

// ---------------------------------------------------------------------------
// SKILL.md parsing
// ---------------------------------------------------------------------------

interface ParsedSkill {
  name: string
  description: string
  filePath: string
}

interface SupportingFile {
  relativePath: string
  size: number
}

interface SkillVersionMismatch {
  agentName: string
  agentDisplayName: string
  agentPath: string
  changes: SkillVersionChange[]
  totalChanges: number
}

interface AgentSkillBinding {
  agentName: string
  agentDisplayName: string
  agentShortCode: string
  linkPath: string
  realPath: string
  isSymbolicLink: boolean
}

const CUSTOM_SCAN_PATHS_KEY = "scan.customPaths"
const COLLECTIONS_KEY = "collections.skills"
const DEFAULT_AGENTS_KEY = "install.defaultAgents"
const MIRROR_AGENTS_KEY = "sync.mirrorAgents"
const PENDING_AGENT_BINDINGS_KEY = "migration.pendingAgentBindings"

// ---------------------------------------------------------------------------
// Agent detection cache
// ---------------------------------------------------------------------------

type DetectedAgentInfo = {
  name: string
  displayName: string
  shortCode: string
  isSharedSkillDirectory: boolean
}

let cachedAgents: DetectedAgentInfo[] | null = null
let agentCacheTime = 0
let detectAgentsPromise: Promise<DetectedAgentInfo[]> | null = null
const AGENT_CACHE_TTL_MS = 60_000 // Re-detect at most once per minute

const supportingFilesCache = new Map<string, SupportingFile[]>()
const rescanInFlight = new Map<string, Promise<Array<Omit<InternalSkill, "folderName">>>>()
let cachedSkillsFingerprint: string | null = null
// Revalidate the skill cache once per process: page mounts call list-installed
// repeatedly, but runtime changes are already pushed by the file watcher, so
// the only thing a background rescan needs to cover is edits made while the
// app was closed.
let backgroundRescanDone = false
let lastBroadcastFingerprint: string | null = null
let pendingRestorePromise: Promise<void> | null = null

async function parseSkillMd(filePath: string): Promise<ParsedSkill | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8")
    const { data: frontmatter } = matter(raw)

    if (
      typeof frontmatter.name !== "string" ||
      typeof frontmatter.description !== "string"
    ) {
      return null
    }

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      filePath,
    }
  } catch {
    return null
  }
}

function getGlobalSkillRoots(): string[] {
  return [
    ...getSkillStorageRoots(),
    ...Object.values(agentRegistry).flatMap(getAgentGlobalSkillDirectories),
  ]
}

function getScopeForPath(skillPath: string): "global" | "project" | "custom" {
  return getScannedSkillScope(
    { path: skillPath, canonicalPath: skillPath },
    getGlobalSkillRoots(),
  )
}

function getProjectNameForPath(resolvedPath: string): string | null {
  const parts = path.resolve(resolvedPath).split(path.sep).filter(Boolean)
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith(".")) {
      return parts[i - 1] || null
    }
  }
  return null
}

async function listSupportingFiles(skillDir: string): Promise<SupportingFile[]> {
  const resolvedSkillDir = await fs.realpath(skillDir).catch(() => path.resolve(skillDir))
  const cached = supportingFilesCache.get(resolvedSkillDir)
  if (cached) {
    return cached
  }

  const files: SupportingFile[] = []

  async function walk(currentDir: string, prefix = ""): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      const relativePath = prefix ? path.join(prefix, entry.name) : entry.name

      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath)
        continue
      }

      if (!entry.isFile() || relativePath === "SKILL.md") continue

      const stat = await fs.stat(absolutePath)
      files.push({
        relativePath: relativePath.split(path.sep).join("/"),
        size: stat.size,
      })
    }
  }

  try {
    await walk(resolvedSkillDir)
  } catch {
    return []
  }

  const sorted = files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  supportingFilesCache.set(resolvedSkillDir, sorted)
  return sorted
}

function clearSupportingFilesCache(skillDir?: string): void {
  if (!skillDir) {
    supportingFilesCache.clear()
    return
  }

  const resolved = path.resolve(skillDir)
  for (const key of supportingFilesCache.keys()) {
    if (key === resolved) {
      supportingFilesCache.delete(key)
    }
  }
}

function isSkillPathAllowed(resolvedPath: string): boolean {
  if (
    Object.values(agentRegistry).some((agent) =>
      getAgentGlobalSkillDirectories(agent).some((skillsDir) =>
        pathsEqual(resolvedPath, skillsDir) || isPathInside(skillsDir, resolvedPath),
      ),
    ) ||
    getSkillStorageRoots().some((root) =>
      pathsEqual(resolvedPath, root) || isPathInside(root, resolvedPath),
    )
  ) {
    return true
  }

  // Custom scan directories are allowed too. Without this the app contradicts
  // itself: the scanner walks scan.customPaths and lists those skills, but reading
  // one is denied because the allowlist does not know about that path -- the user
  // sees "it is in the list, but opening it says the skill may have no SKILL.md".
  // These directories are scan sources the user configured, so reading them is the
  // expected behaviour.
  try {
    ensureStores()
    const customScanPaths = settingsStore?.get<string[]>(CUSTOM_SCAN_PATHS_KEY, []) ?? []
    const allowedByCustomPath = customScanPaths.some((custom) => {
      const base = path.resolve(custom.replace(/^~(?=$|\/|\\)/, home))
      return pathsEqual(resolvedPath, base) || isPathInside(base, resolvedPath)
    })
    if (allowedByCustomPath) return true
  } catch {
    // 继续检查扫描缓存。
  }

  // The scanner follows links (junctions/symlinks) inside allowed roots and
  // records the resolved target as the canonical path. That target can live
  // outside every configured root (e.g. a legacy skill-manager/shared store
  // linked into an agent dir), so also trust canonical paths the app itself
  // has already discovered and cached.
  try {
    return loadCachedSkills().some((skill) => {
      const canonical = path.resolve(skill.canonicalPath)
      return pathsEqual(resolvedPath, canonical) || isPathInside(canonical, resolvedPath)
    })
  } catch {
    return false
  }
}

function getExpandedTargetAgents(requestedAgentNames: string[]): AgentEntry[] {
  ensureStores()
  const configuredDefaultAgents = settingsStore?.get<string[]>(DEFAULT_AGENTS_KEY, []) ?? []
  const configuredMirrorAgents = settingsStore?.get<string[]>(MIRROR_AGENTS_KEY, []) ?? []

  const baseNames =
    requestedAgentNames.length > 0
      ? requestedAgentNames
      : configuredDefaultAgents.length > 0
        ? configuredDefaultAgents
        : []

  const resolvedBaseNames = baseNames.length > 0 ? baseNames : Object.keys(agentRegistry)
  const finalNames = Array.from(
    new Set([...resolvedBaseNames, ...configuredMirrorAgents]),
  )

  return finalNames
    .map((name) => agentRegistry[name])
    .filter((value): value is AgentEntry => Boolean(value))
}

async function collectSkillsFromRoot(
  rootPath: string,
  scopeHint: "custom" | "project",
  lock: SkillLockFile,
): Promise<
  Array<{
    name: string
    description: string
    path: string
    canonicalPath: string
    agents: string[]
    agentShortCodes: string[]
    scope: "global" | "project" | "custom"
    projectName: string | null
    hasSupportingFiles: boolean
    supportingFiles: SupportingFile[]
    versionMismatches: SkillVersionMismatch[]
    source?: string
    sourceType?: string
    hasLinkedSource?: boolean
    installedAt?: string
    updatedAt?: string
    folderName: string
  }>
> {
  const results: Array<{
    name: string
    description: string
    path: string
    canonicalPath: string
    agents: string[]
    agentShortCodes: string[]
    scope: "global" | "project" | "custom"
    projectName: string | null
    hasSupportingFiles: boolean
    supportingFiles: SupportingFile[]
    versionMismatches: SkillVersionMismatch[]
    source?: string
    sourceType?: string
    hasLinkedSource?: boolean
    installedAt?: string
    updatedAt?: string
    folderName: string
  }> = []

  const resolvedRoot = path.resolve(rootPath.replace(/^~(?=$|\/|\\)/, home))
  async function maybeCollectSkillDir(
    skillDir: string,
    scope: "project" | "custom",
    projectName: string | null,
    agentName: string | null,
  ) {
    const skillMdPath = path.join(skillDir, "SKILL.md")
    if (!(await fileExists(skillMdPath))) return

    const realPath = await fs.realpath(skillDir).catch(() => skillDir)
    const parsed = await parseSkillMd(skillMdPath)
    const folderName = path.basename(skillDir)
    const lockEntry = getSkillSourceRecord(lock, scope === "project" ? skillDir : realPath)
    const timestamps = await resolveSkillTimestamps(realPath, lockEntry)
    const attributedAgent = agentName ? agentRegistry[agentName] : undefined

    results.push({
      name: parsed?.name || folderName,
      description: parsed?.description || "",
      path: skillDir,
      // 项目位置本身是需要保留的绑定身份；即使它是指向母版的 Junction，
      // 也不能与全局行共用缓存主键，否则会丢失项目级 Agent 归属。
      canonicalPath: scope === "project" ? path.resolve(skillDir) : realPath,
      agents: attributedAgent ? [attributedAgent.displayName] : [],
      agentShortCodes: attributedAgent ? [attributedAgent.shortCode] : [],
      scope,
      projectName,
      hasSupportingFiles: false,
      supportingFiles: [],
      versionMismatches: [],
      source: lockEntry?.source,
      sourceType: lockEntry?.sourceType,
      hasLinkedSource: lockEntry?.sourceLinked === true || lockEntry?.sourceType === "github",
      ...timestamps,
      folderName,
    })
  }

  const locations = await findCustomSkillLocations(resolvedRoot, PROJECT_PROBES)
  for (const location of locations) {
    await maybeCollectSkillDir(
      location.skillDir,
      location.scope === "custom" ? scopeHint : location.scope,
      location.projectName,
      location.agentName,
    )
  }

  return results
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function getSkillFolderName(skillDir: string, skillName: string): string {
  const sanitized = sanitizeName(skillName)
  if (sanitized && sanitized !== "." && sanitized !== "..") {
    return assertSafePathSegment(sanitized)
  }
  return assertSafePathSegment(path.basename(path.resolve(skillDir)))
}

interface SkillboxArchiveManifest {
  format: "skillbox-migration"
  version: 1
  exportedAt: string
  skills: Array<{
    name: string
    archiveFolder: string
    agentNames: string[]
  }>
}

type ExportScope = "selected" | "all" | "global" | "project"

interface MigrationProgress {
  operation: "export" | "import"
  stage: "preparing" | "packing" | "writing" | "importing" | "adapting" | "refreshing" | "complete"
  current: number
  total: number
  percent: number
  skillName?: string
  message: string
}

type PendingAgentBindings = Record<string, string[]>

function emitMigrationProgress(progress: MigrationProgress): void {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send("skills:migration-progress", progress)
  }
}

function parseSkillboxManifest(zip: AdmZip): SkillboxArchiveManifest {
  const manifestEntry = zip.getEntry("skillbox-manifest.json")
  if (!manifestEntry) {
    throw new Error("这不是有效的 Skillbox 迁移包")
  }

  const value = JSON.parse(manifestEntry.getData().toString("utf-8")) as Partial<SkillboxArchiveManifest>
  if (
    value.format !== "skillbox-migration" ||
    value.version !== 1 ||
    !Array.isArray(value.skills)
  ) {
    throw new Error("迁移包版本不受支持")
  }

  const skills = value.skills.map((skill) => {
    if (!skill || typeof skill !== "object") {
      throw new Error("迁移包包含无效的 Skill 信息")
    }
    const name = typeof skill.name === "string" ? skill.name.trim() : ""
    const archiveFolder = typeof skill.archiveFolder === "string" ? skill.archiveFolder : ""
    if (!name || !/^[a-z0-9._-]+$/.test(archiveFolder)) {
      throw new Error("迁移包包含无效的 Skill 信息")
    }
    return {
      name,
      archiveFolder,
      agentNames: Array.isArray(skill.agentNames)
        ? Array.from(new Set(skill.agentNames.filter((agent): agent is string => typeof agent === "string" && agent.length > 0)))
        : [],
    }
  })

  return {
    format: "skillbox-migration",
    version: 1,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    skills,
  }
}

async function addDirectoryToArchive(
  zip: AdmZip,
  sourceDir: string,
  archiveDir: string,
): Promise<void> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const sourcePath = path.join(sourceDir, entry.name)
    const archivePath = path.posix.join(archiveDir, entry.name)
    if (entry.isDirectory()) {
      await addDirectoryToArchive(zip, sourcePath, archivePath)
    } else if (entry.isFile()) {
      zip.addFile(archivePath, await fs.readFile(sourcePath))
    }
  }
}

function getAgentKeys(displayNames: string[]): string[] {
  return displayNames.flatMap((displayName) => {
    const match = Object.values(agentRegistry).find(
      (agent) => agent.displayName === displayName && agent.name !== "universal",
    )
    return match ? [match.name] : []
  })
}

function pathsEqual(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value)
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }
  return normalize(left) === normalize(right)
}

async function moveAgentCopyToBackup(
  folderName: string,
  agentName: string,
  agentPath: string,
): Promise<string> {
  const backupRoot = path.join(
    SKILLBOX_BACKUPS_DIR,
    agentName,
    assertSafePathSegment(folderName),
  )
  await fs.mkdir(backupRoot, { recursive: true })
  const backupPath = path.join(
    backupRoot,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`,
  )
  await moveAgentSkillDirectory(agentPath, backupPath)
  return backupPath
}

function getDetachedAgentCopyPath(folderName: string, agentName: string): string {
  return path.join(
    DETACHED_AGENT_COPIES_DIR,
    agentName,
    assertSafePathSegment(folderName),
  )
}

async function detachAgentCopy(
  folderName: string,
  agentName: string,
  agentPath: string,
): Promise<string> {
  const detachedPath = getDetachedAgentCopyPath(folderName, agentName)
  if (await dirExists(detachedPath)) {
    await moveAgentCopyToBackup(folderName, agentName, detachedPath)
  }
  await fs.mkdir(path.dirname(detachedPath), { recursive: true })
  await moveAgentSkillDirectory(agentPath, detachedPath)
  return detachedPath
}

async function restoreDetachedAgentCopy(
  folderName: string,
  agent: AgentEntry,
): Promise<boolean> {
  const detachedPath = getDetachedAgentCopyPath(folderName, agent.name)
  if (!(await dirExists(detachedPath))) return false
  if (!(await fileExists(path.join(detachedPath, "SKILL.md")))) {
    throw new Error("暂存的 Agent 副本缺少 SKILL.md，无法恢复")
  }

  const agentPath = path.join(agent.globalSkillsDir, assertSafePathSegment(folderName))
  if (await dirExists(agentPath)) {
    throw new Error("Agent 目录中已存在同名 Skill，无法恢复暂存副本")
  }
  await fs.mkdir(agent.globalSkillsDir, { recursive: true })
  await moveAgentSkillDirectory(detachedPath, agentPath)
  return true
}

async function findVersionMismatches(
  masterBinding: AgentSkillBinding | undefined,
  bindings: AgentSkillBinding[],
): Promise<SkillVersionMismatch[]> {
  if (!masterBinding) return []

  const mismatches: SkillVersionMismatch[] = []
  for (const binding of bindings) {
    if (binding.agentName === "universal") continue
    // 位置或链接类型变化不属于“版本未同步”。只有有效文件内容不同才提示。
    if (pathsEqual(binding.realPath, masterBinding.realPath)) continue

    try {
      const changes = await compareSkillContents(masterBinding.realPath, binding.realPath)
      if (changes.length === 0) continue
      mismatches.push({
        agentName: binding.agentName,
        agentDisplayName: binding.agentDisplayName,
        agentPath: binding.linkPath,
        changes: changes.slice(0, 100),
        totalChanges: changes.length,
      })
    } catch {
      // 无法读取属于适配故障，不冒充版本差异。
    }
  }
  return mismatches
}

/** Detect all installed agents on this machine */
async function detectAgents(): Promise<DetectedAgentInfo[]> {
  const now = Date.now()
  if (cachedAgents && now - agentCacheTime < AGENT_CACHE_TTL_MS) {
    return cachedAgents
  }

  if (detectAgentsPromise) {
    return detectAgentsPromise
  }

  detectAgentsPromise = (async () => {
    const detected: DetectedAgentInfo[] = []
    for (const agent of Object.values(agentRegistry)) {
      try {
        if (await agent.detectInstalled()) {
          detected.push({
            name: agent.name,
            displayName: agent.displayName,
            shortCode: agent.shortCode,
            isSharedSkillDirectory:
              agent.name !== "universal" && pathsEqual(agent.globalSkillsDir, CANONICAL_SKILLS_DIR),
          })
        }
      } catch {
        // Skip agents that fail detection
      }
    }

    cachedAgents = detected
    agentCacheTime = Date.now()
    return detected
  })()

  try {
    return await detectAgentsPromise
  } finally {
    detectAgentsPromise = null
  }
}

async function getDetectedAgentEntries(): Promise<AgentEntry[]> {
  const detected = await detectAgents()
  return detected
    .map((agent) => agentRegistry[agent.name])
    .filter((value): value is AgentEntry => Boolean(value))
}

/** Scan all detected agents for installed skills, merging with lock file data.
 *  Returns the full internal shape including folderName (needed for caching). */
async function listInstalledSkillsInternal(
  opts: {
    skipCustomPaths?: boolean
    agents?: AgentEntry[]
    lock?: SkillLockFile
  } = {},
): Promise<
  Array<{
    name: string
    description: string
    path: string
    canonicalPath: string
    agents: string[]
    agentShortCodes: string[]
    scope: "global" | "project" | "custom"
    projectName: string | null
    hasSupportingFiles: boolean
    supportingFiles: SupportingFile[]
    versionMismatches: SkillVersionMismatch[]
    source?: string
    sourceType?: string
    hasLinkedSource?: boolean
    installedAt?: string
    updatedAt?: string
    folderName: string
  }>
> {
  const lock = opts.lock ?? await readSkillLock()
  const skillMap = new Map<
    string,
    {
      name: string
      description: string
      path: string
      canonicalPath: string
      agents: string[]
      agentShortCodes: string[]
      scope: "global" | "project" | "custom"
      projectName: string | null
      hasSupportingFiles: boolean
      supportingFiles: SupportingFile[]
      versionMismatches: SkillVersionMismatch[]
      source?: string
      sourceType?: string
      hasLinkedSource?: boolean
      installedAt?: string
      updatedAt?: string
      folderName: string
    }
  >()
  const bindingsBySkillKey = new Map<string, AgentSkillBinding[]>()

  const agentsToScan = opts.agents ?? await getDetectedAgentEntries()
  const globalSkillKey = (name: string) => `global:${name.trim().toLowerCase()}`

  for (const agent of agentsToScan) {
    for (const skillsDir of getAgentGlobalSkillDirectories(agent)) {
      const skillDirectories = await findSkillDirectories(skillsDir)
      for (const discovered of skillDirectories) {
        const skillDir = discovered.path
        const folderName = path.basename(skillDir)
        const parsed = await parseSkillMd(path.join(skillDir, "SKILL.md"))
        const scope = getScannedSkillScope(discovered, getGlobalSkillRoots())
        const projectName =
          scope === "project" ? getProjectNameForPath(skillDir) : null

        const skillName = parsed?.name || folderName
        const skillKey = globalSkillKey(skillName)
        const existing = skillMap.get(skillKey)
        const lockEntry = getSkillSourceRecord(lock, discovered.canonicalPath)
        const bindings = bindingsBySkillKey.get(skillKey) ?? []
        if (!bindings.some((binding) => binding.agentName === agent.name)) {
          bindings.push({
            agentName: agent.name,
            agentDisplayName: agent.displayName,
            agentShortCode: agent.shortCode,
            linkPath: skillDir,
            realPath: discovered.canonicalPath,
            isSymbolicLink: discovered.isSymbolicLink,
          })
          bindingsBySkillKey.set(skillKey, bindings)
        }

        if (existing) {
          if (!existing.agents.includes(agent.displayName)) {
            existing.agents.push(agent.displayName)
            existing.agentShortCodes.push(agent.shortCode)
          }
          if (agent.name === "universal") {
            const timestamps = await resolveSkillTimestamps(discovered.canonicalPath, lockEntry)
            existing.path = skillDir
            existing.canonicalPath = discovered.canonicalPath
            existing.scope = "global"
            existing.projectName = null
            existing.folderName = folderName
            Object.assign(existing, timestamps)
          }
          continue
        }

        const timestamps = await resolveSkillTimestamps(discovered.canonicalPath, lockEntry)
        skillMap.set(skillKey, {
          name: skillName,
          description: parsed?.description || "",
          path: skillDir,
          canonicalPath: discovered.canonicalPath,
          agents: [agent.displayName],
          agentShortCodes: [agent.shortCode],
          scope,
          projectName,
          hasSupportingFiles: false,
          supportingFiles: [],
          versionMismatches: [],
          source: lockEntry?.source,
          sourceType: lockEntry?.sourceType,
          hasLinkedSource: lockEntry?.sourceLinked === true || lockEntry?.sourceType === "github",
          ...timestamps,
          folderName,
        })
      }
    }
  }

  for (const [skillKey, skill] of skillMap) {
    const bindings = bindingsBySkillKey.get(skillKey) ?? []
    const masterBinding = bindings.find((binding) => binding.agentName === "universal")
    skill.versionMismatches = await findVersionMismatches(masterBinding, bindings)
  }

  if (!opts.skipCustomPaths) {
    ensureStores()
    const customScanPaths = settingsStore?.get<string[]>(CUSTOM_SCAN_PATHS_KEY, []) ?? []
    for (const customPath of customScanPaths) {
      const collected = await collectSkillsFromRoot(customPath, "custom", lock)
      for (const item of collected) {
        const skillKey = globalSkillKey(item.name)
        const masterBinding = bindingsBySkillKey
          .get(skillKey)
          ?.find((binding) => binding.agentName === "universal")

        if (
          item.scope === "project" &&
          masterBinding &&
          item.agents.length > 0 &&
          !pathsEqual(item.canonicalPath, masterBinding.realPath)
        ) {
          try {
            const changes = await compareSkillContents(
              masterBinding.realPath,
              item.canonicalPath,
            )
            if (changes.length > 0) {
              item.versionMismatches = item.agents.flatMap((displayName) => {
                const attributedAgent = Object.values(agentRegistry).find(
                  (agent) => agent.displayName === displayName,
                )
                if (!attributedAgent) return []
                return [{
                  agentName: attributedAgent.name,
                  agentDisplayName: attributedAgent.displayName,
                  agentPath: item.path,
                  changes: changes.slice(0, 100),
                  totalChanges: changes.length,
                }]
              })
            }
          } catch {
            // 无法完整比对时保留项目位置，但不把读取故障标成“版本未同步”。
          }
        }

        skillMap.set(`path:${path.resolve(item.path)}`, item)
      }
    }
  }

  return Array.from(skillMap.values())
}

/** Internal skill type that includes folderName for cache storage. */
type InternalSkill = Awaited<ReturnType<typeof listInstalledSkillsInternal>>[number]
type RendererSkill = Omit<InternalSkill, "folderName"> & {
  projectNames: string[]
  locations: Array<{
    path: string
    canonicalPath: string
    scope: "global" | "project" | "custom"
    projectName: string | null
    agents: string[]
  }>
}

type RendererSkillLocation = RendererSkill["locations"][number]

async function collectGlobalSkillLocations(): Promise<Map<string, RendererSkillLocation[]>> {
  const byName = new Map<string, RendererSkillLocation[]>()
  const agents = await getDetectedAgentEntries()
  for (const agent of agents) {
    for (const skillsDir of getAgentGlobalSkillDirectories(agent)) {
      for (const discovered of await findSkillDirectories(skillsDir)) {
        const parsed = await parseSkillMd(path.join(discovered.path, "SKILL.md"))
        if (!parsed) continue
        const key = parsed.name.trim().toLowerCase()
        const locations = byName.get(key) ?? []
        const existing = locations.find((location) => pathsEqual(location.path, discovered.path))
        if (existing) {
          if (!existing.agents.includes(agent.displayName)) existing.agents.push(agent.displayName)
        } else {
          locations.push({
            path: discovered.path,
            canonicalPath: discovered.canonicalPath,
            scope: "global",
            projectName: null,
            agents: [agent.displayName],
          })
        }
        byName.set(key, locations)
      }
    }
  }
  return byName
}

function getSkillRemovalRoots(): string[] {
  ensureStores()
  const customRoots = settingsStore?.get<string[]>(CUSTOM_SCAN_PATHS_KEY, []) ?? []
  return resolveSkillRemovalRoots([
    ...getSkillStorageRoots(),
    ...Object.values(agentRegistry).flatMap(getAgentGlobalSkillDirectories),
    ...customRoots.map((custom) => path.resolve(custom.replace(/^~(?=$|\/|\\)/, home))),
  ])
}

function pathComparisonKey(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

async function buildSkillRemovalPlan(input: SkillRemovalRequest): Promise<{
  request: SkillRemovalRequest
  paths: Array<{ path: string; scope: "global" | "project" | "custom" }>
}> {
  const roots = getSkillRemovalRoots()
  const request = validateSkillRemovalRequest(input, roots)
  const planned = new Map<string, { path: string; scope: "global" | "project" | "custom" }>()
  const expectedName = request.name.toLowerCase()

  const addPath = async (
    targetPath: string,
    scope: "global" | "project" | "custom",
  ): Promise<void> => {
    const resolved = path.resolve(targetPath)
    validateSkillRemovalRequest({
      name: request.name,
      targets: [{ path: resolved, canonicalPath: resolved, scope }],
    }, roots)
    const parsed = await parseSkillMd(path.join(resolved, "SKILL.md"))
    if (!parsed || parsed.name.trim().toLowerCase() !== expectedName) {
      throw new Error(`删除目标与当前 Skill 身份不一致：${resolved}`)
    }
    planned.set(pathComparisonKey(resolved), { path: resolved, scope })
  }

  const currentSkills = await listInstalledSkillsInternal()
  for (const target of request.targets) {
    if (target.scope !== "global") {
      await addPath(target.path, target.scope)
      continue
    }
    const selectedRealPath = await fs.realpath(target.path)
    const physicalRoot = getSkillStorageRoots().find((root) =>
      !pathsEqual(root, CANONICAL_SKILLS_DIR) && isPathInside(root, selectedRealPath),
    )
    await addPath(physicalRoot ? selectedRealPath : target.path, target.scope)
    const selectedRealKey = pathComparisonKey(selectedRealPath)

    // 只清理确实指向同一母本的 Agent/项目 Junction。同名但实体内容
    // 不同的目录 realpath 不同，不会被纳入删除计划。
    for (const skill of currentSkills) {
      if (skill.name.trim().toLowerCase() !== expectedName) continue
      const realPath = await fs.realpath(skill.path).catch(() => null)
      if (!realPath || pathComparisonKey(realPath) !== selectedRealKey) continue
      if (physicalRoot && isPathInside(CANONICAL_SKILLS_DIR, skill.path) &&
          !(await fs.lstat(skill.path)).isSymbolicLink()) continue
      await addPath(skill.path, skill.scope)
    }

    for (const agent of Object.values(agentRegistry)) {
      for (const skillsDir of getAgentGlobalSkillDirectories(agent)) {
        const discovered = await findSkillDirectories(skillsDir)
        for (const location of discovered) {
          if (pathComparisonKey(location.canonicalPath) !== selectedRealKey) continue
          if (physicalRoot && pathsEqual(skillsDir, CANONICAL_SKILLS_DIR) && !location.isSymbolicLink) continue
          await addPath(location.path, "global")
        }
      }
    }

    if (roots.some((root) => isPathInside(root, selectedRealPath))) {
      await addPath(selectedRealPath, getScopeForPath(selectedRealPath))
    }
  }

  const paths = Array.from(planned.values())
  for (let index = 0; index < paths.length; index += 1) {
    for (let other = index + 1; other < paths.length; other += 1) {
      if (
        isPathInside(paths[index].path, paths[other].path) ||
        isPathInside(paths[other].path, paths[index].path)
      ) {
        throw new Error("删除计划包含相互嵌套的 Skill 目录，已拒绝执行")
      }
    }
  }
  return { request, paths }
}

async function resolveAgentSkillBinding(
  input: SkillRemovalRequest,
  agent: AgentEntry,
): Promise<{
  request: SkillRemovalRequest
  bindings: Array<{ skillPath: string; folderName: string }>
}> {
  const request = validateSkillRemovalRequest(
    selectAgentSkillRemovalTargets(input, getAgentGlobalSkillDirectories(agent), getSkillStorageRoots()),
    getSkillRemovalRoots(),
  )
  const expectedName = request.name.toLowerCase()
  const selectedRealPaths = new Set<string>()
  for (const target of request.targets) {
    const realPath = await fs.realpath(target.path).catch(() => null)
    if (realPath) selectedRealPaths.add(pathComparisonKey(realPath))
  }

  const matches: Array<{ path: string; canonicalPath: string }> = []
  for (const skillsDir of getAgentGlobalSkillDirectories(agent)) {
    const discovered = await findSkillDirectories(skillsDir)
    for (const location of discovered) {
      const parsed = await parseSkillMd(path.join(location.path, "SKILL.md"))
      if (!parsed || parsed.name.trim().toLowerCase() !== expectedName) continue
      matches.push(location)
    }
  }
  const candidates = selectAgentSkillRemovalCandidates(matches, selectedRealPaths)
  if (!candidates) {
    throw new Error(`${agent.displayName} 中存在多个同名 Skill，无法安全判断删除目标`)
  }
  if (candidates.length === 0) {
    throw new Error(`${agent.displayName} 中未找到当前 Skill 的适配位置`)
  }
  return {
    request,
    bindings: candidates.map((candidate) => {
      const skillPath = path.resolve(candidate.path)
      validateSkillRemovalRequest({
        name: request.name,
        targets: [{ path: skillPath, canonicalPath: candidate.canonicalPath, scope: "global" }],
      }, getSkillRemovalRoots())
      return {
        skillPath,
        folderName: assertSafePathSegment(path.basename(skillPath)),
      }
    }),
  }
}

/** Strip the internal folderName field before sending to the renderer. */
async function toRendererSkills(skills: InternalSkill[], identifySources = false): Promise<RendererSkill[]> {
  const globalLocationsByName = skills.some((skill) => skill.scope === "global")
    ? await collectGlobalSkillLocations()
    : new Map<string, RendererSkillLocation[]>()
  const nameCounts = new Map<string, number>()
  for (const skill of skills) {
    const key = skill.name.trim().toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }

  const fingerprintByPath = new Map<string, Promise<string | null>>()
  const prepared = await Promise.all(skills.map(async (skill) => {
    const nameKey = skill.name.trim().toLowerCase()
    let contentFingerprint: string | null = null
    if ((nameCounts.get(nameKey) ?? 0) > 1) {
      let fingerprint = fingerprintByPath.get(skill.canonicalPath)
      if (!fingerprint) {
        fingerprint = createSkillContentFingerprint(skill.canonicalPath).catch(() => null)
        fingerprintByPath.set(skill.canonicalPath, fingerprint)
      }
      contentFingerprint = await fingerprint
    }
    return {
      ...skill,
      projectNames: skill.projectName ? [skill.projectName] : [],
      locations: (
        skill.scope === "global"
          ? globalLocationsByName.get(nameKey)
          : undefined
      )?.map((location) => ({ ...location, agents: [...location.agents] })) ?? [{
          path: skill.path,
          canonicalPath: skill.canonicalPath,
          scope: skill.scope,
          projectName: skill.projectName,
          agents: [...skill.agents],
        }],
      contentFingerprint,
    }
  }))

  const resolveSource = identifySources ? createSkillSourceResolver() : null
  const rawByPath = new Map(skills.map((skill) => [skill.canonicalPath, skill]))
  return Promise.all(mergeProjectSkillsIntoGlobal(prepared).map(
    async ({ folderName: _, contentFingerprint: __, ...rest }) => {
      if (!resolveSource || rest.source || rest.sourceType) return rest
      for (const location of rest.locations) {
        const source = await resolveSource({ name: rest.name, ...location })
        if (source) {
          // 扫描时回填原始缓存行；普通列表读取不解析来源文件。
          const raw = rawByPath.get(rest.canonicalPath)
          if (raw) Object.assign(raw, source, { hasLinkedSource: false })
          return { ...rest, ...source, hasLinkedSource: false }
        }
      }
      return rest
    },
  )) as Promise<RendererSkill[]>
}

/** Backward-compatible wrapper -- returns the renderer-safe shape. */
async function listInstalledSkills() {
  const raw = await listInstalledSkillsInternal()
  return toRendererSkills(raw, true)
}

function createSkillsFingerprint(skills: InternalSkill[]): string {
  return JSON.stringify(
    [...skills]
      .sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath))
      .map((skill) => ({
        canonicalPath: skill.canonicalPath,
        name: skill.name,
        description: skill.description,
        agents: [...skill.agents].sort(),
        agentShortCodes: [...skill.agentShortCodes].sort(),
        scope: skill.scope,
        projectName: skill.projectName,
        hasSupportingFiles: skill.hasSupportingFiles,
        supportingFiles: [...skill.supportingFiles].sort((a, b) =>
          a.relativePath.localeCompare(b.relativePath),
        ),
        versionMismatches: [...skill.versionMismatches].sort((a, b) =>
          a.agentName.localeCompare(b.agentName),
        ),
        source: skill.source,
        sourceType: skill.sourceType,
        hasLinkedSource: skill.hasLinkedSource,
        installedAt: skill.installedAt,
        updatedAt: skill.updatedAt,
        folderName: skill.folderName,
      })),
  )
}

function getCachedSkillsFingerprint(): string {
  if (cachedSkillsFingerprint === null) {
    cachedSkillsFingerprint = createSkillsFingerprint(
      loadCachedSkills() as InternalSkill[],
    )
  }
  return cachedSkillsFingerprint
}

function persistCachedSkills(
  raw: InternalSkill[],
  preserveCustomScope = false,
): string {
  const fingerprint = createSkillsFingerprint(raw)
  if (fingerprint !== getCachedSkillsFingerprint()) {
    saveCachedSkills(raw, { preserveCustomScope })
    cachedSkillsFingerprint = fingerprint
  }
  return fingerprint
}

function maybeBroadcastSkills(
  skills: RendererSkill[],
  fingerprint: string,
  broadcast: boolean,
): void {
  if (!broadcast || fingerprint === lastBroadcastFingerprint) {
    return
  }

  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send("skills:updated", skills)
  }
  lastBroadcastFingerprint = fingerprint
}

async function runRescan(
  key: string,
  run: () => Promise<InternalSkill[]>,
  broadcast: boolean,
  preserveCustomScope = false,
): Promise<Array<Omit<InternalSkill, "folderName">>> {
  const inFlight = rescanInFlight.get(key)
  if (inFlight) {
    return inFlight
  }

  const task = (async () => {
    let raw = await run()
    // A quick rescan skips the custom paths. Persisting and broadcasting that result
    // as-is drops the custom-path skills from both the cache and the UI. Merge the
    // custom entries already in the cache back in first, so the cache, the broadcast
    // and the return value all stay consistent.
    if (preserveCustomScope) {
      // Custom scan paths produce both "custom" entries (direct children with a
      // SKILL.md) and "project" entries (via PROJECT_PROBES like .claude/skills).
      // Neither is re-scanned on a quick pass, so both must be preserved --
      // keeping only "custom" wiped the project ones on every quick rescan.
      const preserved = loadCachedSkills().filter(
        (s) => s.scope === "custom" || s.scope === "project",
      )
      if (preserved.length > 0) {
        const seen = new Set(raw.map((s) => s.canonicalPath))
        raw = raw.concat(
          (preserved as InternalSkill[]).filter((s) => !seen.has(s.canonicalPath)),
        )
      }
    }
    clearSupportingFilesCache()
    const rendered = await toRendererSkills(raw, true)
    const fingerprint = persistCachedSkills(raw, preserveCustomScope)
    maybeBroadcastSkills(rendered, fingerprint, broadcast)
    return rendered
  })().finally(() => {
    rescanInFlight.delete(key)
  })

  rescanInFlight.set(key, task)
  return task
}

// ---------------------------------------------------------------------------
// Skills cache: rescan, save, and push to renderer
// ---------------------------------------------------------------------------

let _mainWindow: BrowserWindow | null = null
let restartSkillWatcher: (() => Promise<void>) | null = null

/** Called from the main process to provide a window reference for pushing events. */
export function setMainWindow(win: BrowserWindow): void {
  _mainWindow = win
}

export function setSkillWatcherRestart(handler: () => Promise<void>): void {
  restartSkillWatcher = handler
}

/**
 * Run a filesystem scan, persist results to the SQLite cache,
 * and push the updated list to the renderer via the skills:updated event.
 *
 * Pass { skipCustomPaths: true } from the file watcher to avoid
 * walking potentially large custom scan directories on every change.
 */
async function rescanAndCache(
  opts: { skipCustomPaths?: boolean; broadcast?: boolean } = {},
) {
  const key = opts.skipCustomPaths ? "quick" : "full"
  return runRescan(
    key,
    async () => {
      await restorePendingAgentBindings()
      const [agents, lock] = await Promise.all([
        getDetectedAgentEntries(),
        readSkillLock(),
      ])
      return listInstalledSkillsInternal({
        skipCustomPaths: opts.skipCustomPaths,
        agents,
        lock,
      })
    },
    opts.broadcast ?? true,
    // This pass did not scan the custom paths -> keep the cached custom entries.
    opts.skipCustomPaths === true,
  )
}

/**
 * Re-scan a single skill by folder name across all agent directories.
 * Falls back to full rescan if the skill can't be identified.
 */
async function rescanSingleSkill(changedPath: string): Promise<void> {
  // Extract the skill folder name from the changed path.
  // Changed paths look like: "skill-folder-name/SKILL.md" or "skill-folder-name"
  const segments = changedPath.split(path.sep).filter(Boolean)
  const skillFolderName = segments[0]

  if (!skillFolderName || skillFolderName.startsWith(".")) {
    // Ambiguous change (root-level or hidden dir) -- full rescan
    await rescanAndCache()
    return
  }

  // Load current cache
  const cached = loadCachedSkills()
  const existingIdx = cached.findIndex((s) => s.folderName === skillFolderName)

  // Re-scan just this skill across all agents
  const [lock, agentsToScan] = await Promise.all([
    readSkillLock(),
    getDetectedAgentEntries(),
  ])
  const agents: string[] = []
  const agentShortCodes: string[] = []
  const bindings: AgentSkillBinding[] = []
  let resolvedDir: string | null = null
  let linkDir: string | null = null
  let parsed: ParsedSkill | null = null

  for (const agent of agentsToScan) {
    for (const skillsDir of getAgentGlobalSkillDirectories(agent)) {
      const skillDir = path.join(skillsDir, skillFolderName)
      try {
        const realPath = await fs.realpath(skillDir)
        await fs.stat(realPath)
        const entryStat = await fs.lstat(skillDir)
        bindings.push({
          agentName: agent.name,
          agentDisplayName: agent.displayName,
          agentShortCode: agent.shortCode,
          linkPath: skillDir,
          realPath,
          isSymbolicLink: entryStat.isSymbolicLink(),
        })
        if (!resolvedDir || agent.name === "universal") {
          resolvedDir = realPath
          // Keep the link path (inside an allowed agent directory) as `path`,
          // same contract as listInstalledSkillsInternal.
          linkDir = skillDir
          const skillMdPath = path.join(realPath, "SKILL.md")
          parsed = await parseSkillMd(skillMdPath)
        }
        if (!agents.includes(agent.displayName)) {
          agents.push(agent.displayName)
          agentShortCodes.push(agent.shortCode)
        }
        break
      } catch {
        // Not present in this directory
      }
    }
  }

  if (resolvedDir && parsed && agents.length > 0) {
    const lockEntry = getSkillSourceRecord(lock, resolvedDir)
    const timestamps = await resolveSkillTimestamps(resolvedDir, lockEntry)
    const masterBinding = bindings.find((binding) => binding.agentName === "universal")
    const scope = masterBinding ? "global" : getScannedSkillScope(
      { path: linkDir ?? resolvedDir, canonicalPath: resolvedDir },
      getGlobalSkillRoots(),
    )
    const updatedSkill = {
      name: parsed.name,
      description: parsed.description,
      path: linkDir ?? resolvedDir,
      canonicalPath: resolvedDir,
      agents,
      agentShortCodes,
      scope,
      projectName: scope === "project" ? getProjectNameForPath(resolvedDir) : null,
      hasSupportingFiles: false,
      supportingFiles: [] as SupportingFile[],
      versionMismatches: await findVersionMismatches(masterBinding, bindings),
      source: lockEntry?.source,
      sourceType: lockEntry?.sourceType,
      hasLinkedSource: lockEntry?.sourceLinked === true || lockEntry?.sourceType === "github",
      ...timestamps,
      folderName: skillFolderName,
    }

    if (existingIdx >= 0) {
      cached[existingIdx] = updatedSkill
    } else {
      cached.push(updatedSkill)
    }
  } else if (existingIdx >= 0) {
    // Skill was deleted
    cached.splice(existingIdx, 1)
  } else {
    // Can't resolve -- full rescan
    await rescanAndCache()
    return
  }

  clearSupportingFilesCache(resolvedDir ?? undefined)
  const rendered = await toRendererSkills(cached as InternalSkill[], true)
  const fingerprint = persistCachedSkills(cached as InternalSkill[])
  maybeBroadcastSkills(rendered, fingerprint, true)
}

// ---------------------------------------------------------------------------
// Git clone helper (uses system git to avoid simple-git dependency)
// ---------------------------------------------------------------------------

function gitClone(
  url: string,
  dest: string,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["clone", "--depth", "1", url, dest],
      { timeout: 60_000, env: buildCliEnv() },
      (error) => {
        if (error) {
          resolve({ success: false, error: error.message })
        } else {
          resolve({ success: true })
        }
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Source parser (mirrored from packages/cli/src/core/source-parser.ts)
// ---------------------------------------------------------------------------

interface ParsedSource {
  type: "github" | "local"
  owner: string
  repo: string
  url: string
  subpath?: string
  ref?: string
}

function parseSource(source: string): ParsedSource | null {
  // GitHub URL
  if (
    source.startsWith("https://github.com/") ||
    source.startsWith("github.com/")
  ) {
    let url = source
    if (url.startsWith("github.com/")) url = `https://${url}`
    try {
      const parsed = new URL(url)
      const parts = parsed.pathname.split("/").filter(Boolean)
      if (parts.length < 2) return null
      return {
        type: "github",
        owner: parts[0],
        repo: parts[1],
        url: `https://github.com/${parts[0]}/${parts[1]}`,
      }
    } catch {
      return null
    }
  }

  // owner/repo shorthand
  const match = source.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)$/)
  if (match) {
    return {
      type: "github",
      owner: match[1],
      repo: match[2],
      url: `https://github.com/${match[1]}/${match[2]}`,
    }
  }

  // Local path
  if (
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith("/") ||
    source.startsWith("~/") ||
    /^[a-zA-Z]:[\\/]/.test(source) ||
    source.startsWith("\\\\")
  ) {
    let resolved = source
    if (resolved.startsWith("~/")) {
      resolved = path.join(home, resolved.slice(2))
    }
    resolved = path.resolve(resolved)
    return {
      type: "local",
      owner: "",
      repo: path.basename(resolved),
      url: resolved,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Skill discovery in a directory tree
// ---------------------------------------------------------------------------

const SKILL_MD = "SKILL.md"
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__"])

async function discoverSkillsInDir(
  dir: string,
  depth = 0,
  maxDepth = 5,
): Promise<ParsedSkill[]> {
  if (depth > maxDepth) return []

  const skills: ParsedSkill[] = []

  // Check if this directory has a SKILL.md
  const skillMdPath = path.join(dir, SKILL_MD)
  if (await fileExists(skillMdPath)) {
    const parsed = await parseSkillMd(skillMdPath)
    if (parsed) skills.push(parsed)
    // If at root and found a skill, don't recurse further
    if (depth === 0 && skills.length > 0) return skills
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.startsWith(".") && depth > 0) continue

      const subSkills = await discoverSkillsInDir(
        path.join(dir, entry.name),
        depth + 1,
        maxDepth,
      )
      skills.push(...subSkills)
    }
  } catch {
    // Directory not readable
  }

  return skills
}

interface SkillSourceTarget {
  name: string
  canonicalPath: string
}

interface ResolvedSourceSkill {
  skillDir: string
  temporaryRoot: string | null
  parsed: ParsedSource
}

interface CachedSourceRoot {
  sourceRoot: string
  temporaryRoot: string | null
}

async function resolveSourceSkill(
  source: string,
  target: SkillSourceTarget,
  skillId?: string,
  sharedRoots?: Map<string, CachedSourceRoot>,
): Promise<ResolvedSourceSkill> {
  const parsed = parseSource(source)
  if (!parsed) throw new Error("来源地址无效，请填写 GitHub 仓库地址、owner/repo 或本地路径")

  const cached = sharedRoots?.get(source)
  let sourceRoot = cached?.sourceRoot
  let temporaryRoot = cached?.temporaryRoot ?? null
  let allowSingleFallback = false
  if (!sourceRoot && parsed.type === "github") {
    temporaryRoot = path.join(
      os.tmpdir(),
      `skillbox-source-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    )
    const downloadResult = await acquireGitHubRepository({
      owner: parsed.owner,
      repo: parsed.repo,
      skillId: sharedRoots ? undefined : skillId || path.basename(target.canonicalPath),
      destination: temporaryRoot,
      clone: gitClone,
      fetchImpl: marketFetch,
    })
    if (!downloadResult.success) {
      await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {})
      throw new Error(downloadResult.error)
    }
    sourceRoot = temporaryRoot
    allowSingleFallback = downloadResult.method === "files"
    sharedRoots?.set(source, { sourceRoot, temporaryRoot })
  } else if (!sourceRoot) {
    sourceRoot = parsed.url
    if (!(await dirExists(sourceRoot))) throw new Error("本地来源目录不存在")
    // 用户明确选中某个 Skill 目录时，以该目录为准，不依赖本地副本的名称。
    if (await fileExists(path.join(sourceRoot, SKILL_MD))) {
      return { skillDir: sourceRoot, temporaryRoot: null, parsed }
    }
    sharedRoots?.set(source, { sourceRoot, temporaryRoot: null })
  }

  const discovered = await discoverSkillsInDir(sourceRoot)
  const expectedId = skillId || path.basename(target.canonicalPath)
  let selected: ParsedSkill
  try {
    selected = requireLinkedSourceSkill(discovered, sourceRoot, expectedId, target.name, allowSingleFallback)
  } catch (error) {
    if (temporaryRoot && !sharedRoots) {
      await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {})
    }
    throw error
  }

  return {
    skillDir: path.dirname(selected.filePath),
    temporaryRoot,
    parsed,
  }
}

async function replaceSkillDirectory(
  sourceDir: string,
  targetDir: string,
  onReplaced?: () => Promise<void>,
): Promise<void> {
  const resolvedSource = await fs.realpath(sourceDir).catch(() => path.resolve(sourceDir))
  const resolvedTarget = await fs.realpath(targetDir).catch(() => path.resolve(targetDir))
  if (pathComparisonKey(resolvedSource) === pathComparisonKey(resolvedTarget)) {
    throw new Error("来源目录与当前 Skill 相同，没有可更新的内容")
  }

  const parent = path.dirname(resolvedTarget)
  const stagingPath = path.join(parent, `.skillbox-update-${crypto.randomUUID()}`)
  const rollbackPath = path.join(parent, `.skillbox-update-rollback-${crypto.randomUUID()}`)
  let targetMoved = false
  try {
    await fs.cp(resolvedSource, stagingPath, { recursive: true })
    if (!(await fileExists(path.join(stagingPath, "SKILL.md")))) {
      throw new Error("来源 Skill 缺少 SKILL.md")
    }
    await fs.rename(resolvedTarget, rollbackPath)
    targetMoved = true
    await fs.rename(stagingPath, resolvedTarget)
    await onReplaced?.()
    targetMoved = false
    await fs.rm(rollbackPath, { recursive: true, force: true }).catch((error) => {
      console.warn("[skill-update] failed to remove rollback directory", error)
    })
  } catch (error) {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {})
    if (targetMoved) {
      await fs.rm(resolvedTarget, { recursive: true, force: true }).catch(() => {})
      await fs.rename(rollbackPath, resolvedTarget).catch(() => {})
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Install skill files to an agent directory (symlink with copy fallback)
// ---------------------------------------------------------------------------

async function installSkillToAgent(
  skillDir: string,
  skillName: string,
  agent: AgentEntry,
): Promise<{ success: boolean; error?: string }> {
  const folderName = getSkillFolderName(skillDir, skillName)
  const agentTargetDir = path.join(agent.globalSkillsDir, folderName)
  const canonicalDir = path.join(CANONICAL_SKILLS_DIR, folderName)

  try {
    // Ensure agent skills directory exists
    await fs.mkdir(agent.globalSkillsDir, { recursive: true })

    // If the agent IS the universal agent, the canonical dir IS the target
    if (path.resolve(agentTargetDir) === path.resolve(canonicalDir)) {
      if (path.resolve(skillDir) === path.resolve(canonicalDir)) {
        return { success: true }
      }
      let backupPath: string | null = null
      if (await dirExists(canonicalDir)) {
        backupPath = await moveAgentCopyToBackup(folderName, "universal", canonicalDir)
      }
      try {
        await fs.cp(skillDir, canonicalDir, { recursive: true })
      } catch (error) {
        if (backupPath) {
          await fs.rm(canonicalDir, { recursive: true, force: true }).catch(() => {})
          await fs.rename(backupPath, canonicalDir)
        }
        throw error
      }
      return { success: true }
    }

    // Ensure canonical dir has the skill
    if (!(await dirExists(canonicalDir))) {
      try {
        await fs.cp(skillDir, canonicalDir, { recursive: true })
      } catch (error) {
        // canonicalDir 是本次新建的未完成副本，不包含用户原有数据。
        await fs.rm(canonicalDir, { recursive: true, force: true }).catch(() => {})
        throw error
      }
    }

    await prepareAgentSkillTarget(agentTargetDir, canonicalDir, async (targetPath) => {
      await detachAgentCopy(folderName, agent.name, targetPath)
    }, async (targetPath) => {
      await moveAgentCopyToBackup(folderName, agent.name, targetPath)
    })

    // Try symlink from agent dir to canonical dir
    try {
      const relativePath = path.relative(
        path.dirname(agentTargetDir),
        canonicalDir,
      )
      // Junction targets must be absolute: Node resolves a relative junction
      // target against the process cwd, not the link location, which silently
      // creates a broken link. POSIX symlinks stay relative.
      const type = process.platform === "win32" ? "junction" : undefined
      const linkTarget = type === "junction" ? canonicalDir : relativePath
      await fs.symlink(linkTarget, agentTargetDir, type)
      return { success: true }
    } catch {
      // Symlink failed, fall back to copy
      await prepareAgentSkillTarget(agentTargetDir, canonicalDir, async (targetPath) => {
        await detachAgentCopy(folderName, agent.name, targetPath)
      }, async (targetPath) => {
        await moveAgentCopyToBackup(folderName, agent.name, targetPath)
      })
      try {
        await fs.cp(canonicalDir, agentTargetDir, { recursive: true })
      } catch (error) {
        // 仅清理由本次降级复制创建的不完整目录。
        await fs.rm(agentTargetDir, { recursive: true, force: true }).catch(() => {})
        throw error
      }
      return { success: true }
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function restorePendingAgentBindings(): Promise<void> {
  if (pendingRestorePromise) return pendingRestorePromise

  pendingRestorePromise = (async () => {
    ensureStores()
    const pending = settingsStore.get<PendingAgentBindings>(PENDING_AGENT_BINDINGS_KEY, {})
    if (Object.keys(pending).length === 0) return

    const detectedNames = new Set((await detectAgents()).map((agent) => agent.name))
    const next: PendingAgentBindings = {}
    const restoredAgents = new Set<string>()
    let restored = 0

    for (const [skillFolder, agentNames] of Object.entries(pending)) {
      const sourceDir = path.join(CANONICAL_SKILLS_DIR, sanitizeName(skillFolder))
      if (!(await fileExists(path.join(sourceDir, "SKILL.md")))) continue

      const stillPending: string[] = []
      for (const agentName of Array.from(new Set(agentNames))) {
        const agent = agentRegistry[agentName]
        if (!agent || agent.name === "universal" || !detectedNames.has(agent.name)) {
          stillPending.push(agentName)
          continue
        }

        const result = await installSkillToAgent(sourceDir, skillFolder, agent)
        if (result.success) {
          restored += 1
          restoredAgents.add(agent.displayName)
        } else {
          stillPending.push(agentName)
        }
      }

      if (stillPending.length > 0) next[skillFolder] = stillPending
    }

    settingsStore.set(PENDING_AGENT_BINDINGS_KEY, next)
    if (restored > 0 && _mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send("skills:pending-agent-restored", {
        restored,
        agents: Array.from(restoredAgents),
      })
    }
  })().finally(() => {
    pendingRestorePromise = null
  })

  return pendingRestorePromise
}

// ---------------------------------------------------------------------------
// Trending scrape (mirrored from packages/cli/src/core/skills-sh-client.ts)
//
// The trending listing has no JSON API, so we read the trending page HTML and
// extract the embedded skill payload. The page lives on the www host (the apex
// host serves the JSON search API). Results arrive ranked by install count.
// ---------------------------------------------------------------------------

const SKILLS_SH_TRENDING_URL = "https://www.skills.sh/trending"

const TRENDING_SKILL_RE =
  /\{"source":"[^"]*","skillId":"[^"]*","name":"[^"]*","installs":\d+(?:,"isOfficial":(?:true|false))?\}/g

/**
 * Extract skills from the trending page HTML. The skill objects live inside JS
 * string literals (a server-rendered framework payload), so JSON quotes arrive
 * escaped as \"; we unescape, pull out each object, and decode it. Page order
 * (install-count descending) is preserved and duplicates are dropped.
 */
function parseTrending(html: string): TrendingSkill[] {
  const unescaped = html.replace(/\\"/g, '"')
  const seen = new Set<string>()
  const result: TrendingSkill[] = []

  for (const match of unescaped.match(TRENDING_SKILL_RE) ?? []) {
    let obj: Omit<TrendingSkill, "id">
    try {
      obj = JSON.parse(match)
    } catch {
      continue
    }
    const id = `${obj.source}/${obj.skillId}`
    if (seen.has(id)) continue
    seen.add(id)
    result.push({ ...obj, id })
  }

  return result
}

/**
 * Scrape the skills.sh trending page for the most-installed skills.
 * Throws on a bad response or an empty parse so callers can fall back.
 */
async function fetchTrending(): Promise<TrendingSkill[]> {
  const res = await marketFetch(SKILLS_SH_TRENDING_URL, {
    headers: {
      "User-Agent": "Skillbox (+https://github.com/Renly1994/Skillbox)",
    },
  })
  if (!res.ok) {
    throw new Error(`skills.sh trending failed (HTTP ${res.status})`)
  }

  const skills = parseTrending(await res.text())
  if (skills.length === 0) {
    throw new Error("skills.sh trending returned no skills")
  }
  return skills
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

// Initialize SQLite stores lazily so cold start is not blocked on DB open.
let settingsStore!: SettingsStore
let serverStore!: RemoteServerStore
let skillStore!: RemoteSkillStore
let favoritesStore!: FavoritesStore
let translationCacheStore!: TranslationCacheStore
let activityStore!: ActivityStore

function ensureStores(): void {
  if (settingsStore && serverStore && skillStore && favoritesStore && translationCacheStore) {
    return
  }

  const db = openDb()
  settingsStore ??= new SettingsStore(db)
  serverStore ??= new RemoteServerStore(db)
  skillStore ??= new RemoteSkillStore(db)
  favoritesStore ??= new FavoritesStore(db)
  translationCacheStore ??= new TranslationCacheStore(db)
  activityStore ??= new ActivityStore(db)
}

function getSkillStorageRoots(): string[] {
  let actual = CANONICAL_SKILLS_DIR
  try { actual = fsSync.realpathSync.native(CANONICAL_SKILLS_DIR) }
  catch { /* 尚未创建或目标盘暂不可用 */ }
  return pathsEqual(actual, CANONICAL_SKILLS_DIR)
    ? [CANONICAL_SKILLS_DIR]
    : [CANONICAL_SKILLS_DIR, actual]
}

async function remapSkillStorageRecords(previous: string, next: string): Promise<void> {
  const previousRoots = Array.from(new Set([previous, CANONICAL_SKILLS_DIR]))
  const lock = await readSkillLock()
  for (const entry of Object.values(lock.skills)) {
    entry.source = remapSkillStoragePathFromRoots(entry.source, previousRoots, next)
    if (entry.originalUrl) {
      entry.originalUrl = remapSkillStoragePathFromRoots(entry.originalUrl, previousRoots, next)
    }
  }
  if (lock.linkedSources) {
    let linkedSources = lock.linkedSources
    for (const previousRoot of previousRoots) {
      linkedSources = remapPathKeyedRecords(
        linkedSources,
        previousRoot,
        next,
        (entry) => ({
          ...entry,
          source: remapSkillStoragePathFromRoots(entry.source, previousRoots, next),
          originalUrl: entry.originalUrl
            ? remapSkillStoragePathFromRoots(entry.originalUrl, previousRoots, next)
            : undefined,
        }),
      )
    }
    lock.linkedSources = Object.fromEntries(
      Object.entries(linkedSources).map(([key, entry]) => [pathComparisonKey(key), entry]),
    )
  }
  await writeSkillLock(lock)
  const collections = settingsStore.get<Record<string, string[]>>(COLLECTIONS_KEY, {})
  settingsStore.set(COLLECTIONS_KEY, Object.fromEntries(
    Object.entries(collections).map(([name, paths]) => [
      name,
      previousRoots.reduce(
        (values, previousRoot) => remapSkillStoragePathList(values, previousRoot, next),
        paths,
      ),
    ]),
  ))
  let aliases = settingsStore.get<Record<string, string>>("alias.skill", {})
  for (const previousRoot of previousRoots) {
    aliases = remapPathKeyedRecords(aliases, previousRoot, next)
  }
  settingsStore.set("alias.skill", aliases)
  for (const previousRoot of previousRoots) {
    translationCacheStore.remapPreferenceIdentities(previousRoot, next)
  }
}

let defaultVersionStoragePath: string | null = null

export async function prepareSkillVersionStorage(): Promise<void> {
  ensureStores()
  if (settingsStore.get<string | null>(SKILL_VERSION_STORAGE_KEY, null)) return
  const legacyPath = path.join(app.getPath("appData"), "@skillsgate", "desktop", "skill-versions")
  const brandedPath = path.join(app.getPath("appData"), "Skillbox", "skill-versions")
  try {
    defaultVersionStoragePath = await migrateDefaultSkillVersionStore(legacyPath, brandedPath)
  } catch (error) {
    defaultVersionStoragePath = legacyPath
    console.warn("Failed to move Skillbox version storage:", error)
  }
}

function getSkillVersionStoragePath(): string {
  ensureStores()
  const configured = settingsStore.get<string | null>(SKILL_VERSION_STORAGE_KEY, null)
  return configured ? path.resolve(configured) : defaultVersionStoragePath ?? path.join(app.getPath("userData"), "skill-versions")
}

function getSkillVersionRetention(): number {
  ensureStores()
  const configured = settingsStore.get<number>(
    SKILL_VERSION_RETENTION_KEY,
    DEFAULT_SKILL_VERSION_RETENTION,
  )
  return Math.min(100, Math.max(3, Math.round(Number(configured) || DEFAULT_SKILL_VERSION_RETENTION)))
}

function getSkillVersionStore(): SkillVersionStore {
  return new SkillVersionStore(getSkillVersionStoragePath(), getSkillVersionRetention())
}

async function saveSkillVersion(
  skillPath: string,
  skillName: string,
  reason: SkillVersionReason,
): Promise<void> {
  await getSkillVersionStore().create(skillPath, skillName, reason)
}

const COMMON_BIN_DIRS =
  process.platform === "win32"
    ? [
        path.join(process.env.APPDATA ?? "", "npm"),
        path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs"),
        path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "nodejs"),
      ].filter(Boolean)
    : [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ]

function dedupePathEntries(entries: string[]): string {
  return [...new Set(entries.filter(Boolean))].join(path.delimiter)
}

function buildCliEnv(): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH?.split(path.delimiter) ?? []
  return {
    ...process.env,
    PATH: dedupePathEntries([...currentPath, ...COMMON_BIN_DIRS]),
  }
}

async function entryExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

const marketFetch = net.fetch.bind(net) as unknown as typeof fetch
const marketplaceInstallTasks = new MarketplaceInstallTaskStore()
let skillStorageMigrationInProgress = false

function assertSkillStorageReady(): void {
  if (skillStorageMigrationInProgress) {
    throw new Error("通用 Skill 目录正在迁移，请完成后再操作")
  }
}

const TRANSLATION_CONFIG_KEY = "translation.api.config"
const TRANSLATION_API_KEY = "translation.api.key.encrypted"
const TRANSLATION_USAGE_KEY = "translation.usage.total"
let translationInFlight = false

interface TranslationConfigInput extends TranslationConfig {
  apiKey?: string
}

interface TranslationViewInput {
  identity: string
  content: string
  cacheKey: string
  sourceDescription?: string | null
  translatedDescription?: string | null
  showTranslation: boolean
}

function validateTranslationIdentity(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) {
    throw new Error("无效的 Skill 翻译标识")
  }
  return value.trim()
}

function validateTranslationCacheKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("无效的翻译缓存标识")
  }
  return value.toLowerCase()
}

function normalizeTranslationDescription(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readTranslationConfig(): TranslationConfig {
  const fallback = getTranslationPreset("deepseek")
  const stored = settingsStore.get<TranslationConfig>(TRANSLATION_CONFIG_KEY, fallback)
  try {
    return validateTranslationConfig(stored)
  } catch {
    return fallback
  }
}

function readTranslationApiKey(): string | null {
  const encrypted = settingsStore.get<string | null>(TRANSLATION_API_KEY, null)
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64")) || null
  } catch {
    return null
  }
}

function translationConfigView() {
  const apiKey = readTranslationApiKey()
  const usage = normalizeTranslationUsage(
    settingsStore.get<TranslationUsage | null>(TRANSLATION_USAGE_KEY, null),
  )
  return {
    ...readTranslationConfig(),
    apiKeyConfigured: Boolean(apiKey),
    usage,
  }
}

async function readTranslationApiError(response: Response): Promise<string> {
  const text = (await response.text()).slice(0, 2_000)
  try {
    const payload = JSON.parse(text) as Record<string, any>
    return String(payload?.error?.message ?? payload?.message ?? payload?.detail ?? response.statusText)
  } catch {
    return text.trim() || response.statusText
  }
}

async function requestTranslation(
  config: TranslationConfig,
  apiKey: string,
  content: string,
) {
  const request = buildTranslationRequest(config, apiKey, content)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await marketFetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      redirect: "error",
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await readTranslationApiError(response)
      throw new Error(`翻译请求失败（HTTP ${response.status}）：${detail}`)
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error("模型 API 返回了无法识别的响应")
    }
    return parseTranslationResponse(config.apiFormat, payload)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("翻译请求超过 90 秒，已停止且不会自动重试")
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export function hasActiveMarketplaceInstalls(): boolean {
  return marketplaceInstallTasks.hasRunningTasks()
}

function broadcastMarketplaceInstallTask(task: MarketplaceInstallTask): void {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send("skills:install-progress", task)
  }
}

function execFileAsync(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function resolveNpxPath(): Promise<string> {
  const env = buildCliEnv()
  const isWindows = process.platform === "win32"

  try {
    const { stdout } = isWindows
      ? await execFileAsync("where.exe", ["npx"], env)
      : await execFileAsync(process.env.SHELL || "/bin/sh", ["-lc", "command -v npx"], env)
    const lines = stdout.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const resolved = isWindows
      ? lines.find((line) => /\.cmd$/i.test(line)) ?? lines[0]
      : lines.at(-1)
    if (resolved) {
      return await fs.realpath(resolved).catch(() => resolved)
    }
  } catch (error) {
    console.error("[skills:install-via-cli] failed to resolve npx via system shell:", error)
  }

  const candidatePaths = isWindows
    ? COMMON_BIN_DIRS.flatMap((dir) => [
        path.join(dir, "npx.cmd"),
        path.join(dir, "npx.exe"),
      ])
    : ["/opt/homebrew/bin/npx", "/usr/local/bin/npx", "/usr/bin/npx", "/bin/npx"]

  for (const candidate of candidatePaths) {
    try {
      await fs.access(candidate)
      return await fs.realpath(candidate).catch(() => candidate)
    } catch {
      continue
    }
  }

  throw new Error(
    `Unable to locate npx. PATH=${env.PATH || "<empty>"} platform=${process.platform}`,
  )
}

function quoteWindowsCmdArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function buildNpxInstallCommand(
  npxPath: string,
  safeSource: string,
): { command: string; args: string[] } {
  const args = ["skills", "add", safeSource, "--all", "--global", "-y"]

  if (process.platform !== "win32") {
    return { command: npxPath, args }
  }

  const quotedCommand = [npxPath, ...args].map(quoteWindowsCmdArg).join(" ")
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", `"${quotedCommand}"`],
  }
}

export function registerIpcHandlers(): void {
  console.log("[ipc] registerIpcHandlers initialized")
  void cleanupMarketplaceTempDirectories(os.tmpdir()).catch((error) => {
    console.warn("[marketplace] failed to clean stale downloads", error)
  })
  // Detect which agents are installed on this machine
  ipcMain.handle("agents:detect", async () => {
    return detectAgents()
  })

  // List all installed skills across all detected agents.
  // Returns cached data instantly when available, then rescans in the
  // background and pushes a skills:updated event when the fresh data is ready.
  ipcMain.handle("skills:list-installed", async () => {
    const cached = loadCachedSkills()
    if (cached.length > 0) {
      const cachedFingerprint = createSkillsFingerprint(cached as InternalSkill[])
      cachedSkillsFingerprint = cachedFingerprint
      lastBroadcastFingerprint = cachedFingerprint
      // Return stale-while-revalidate: send cached data now, rescan later
      // 先返回缓存保证启动速度，再在后台完整扫描；项目级副本的 Agent 归属
      // 与版本差异只有完整扫描才能重新计算，升级后不能依赖用户手动刷新。
      if (!backgroundRescanDone) {
        backgroundRescanDone = true
        rescanAndCache().catch((err) => {
          console.error("Background rescan failed:", err)
        })
      }
      return toRendererSkills(cached)
    }
    // Cache is empty (first launch or cleared) -- do a full scan synchronously
    return rescanAndCache({ broadcast: false })
  })

  // Force a full filesystem rescan, update the cache, and push to renderer
  ipcMain.handle("skills:rescan", async () => {
    cachedAgents = null
    agentCacheTime = 0
    return rescanAndCache()
  })

  // Read the content of a skill's SKILL.md file
  ipcMain.handle("skill:read-content", async (_event, skillPath: string) => {
    // Validate the path is within allowed skill directories
    const resolved = path.resolve(skillPath)
    if (!isSkillPathAllowed(resolved)) {
      throw new Error("Access denied: path is outside skill directories")
    }

    const skillMdPath = path.join(resolved, "SKILL.md")
    try {
      return await fs.readFile(skillMdPath, "utf-8")
    } catch {
      // If skillPath itself is a SKILL.md file, try reading it directly
      if (resolved.endsWith("SKILL.md")) {
        try {
          return await fs.readFile(resolved, "utf-8")
        } catch {
          return ""
        }
      }
      return ""
    }
  })

  ipcMain.handle("skill:list-supporting-files", async (_event, skillPath: string) => {
    const resolved = path.resolve(skillPath)
    if (!isSkillPathAllowed(resolved)) {
      throw new Error("Access denied: path is outside skill directories")
    }
    return listSupportingFiles(resolved)
  })

  ipcMain.handle(
    "skill:read-supporting-file",
    async (_event, skillPath: string, relativePath: string) => {
      const resolved = path.resolve(skillPath)
      if (!isSkillPathAllowed(resolved)) {
        throw new Error("Access denied: path is outside skill directories")
      }
      const filePath = path.resolve(resolved, relativePath)
      if (!isPathInside(resolved, filePath)) {
        throw new Error("Access denied: invalid supporting file path")
      }
      return fs.readFile(filePath, "utf-8")
    },
  )

  // Install a skill from a source (GitHub owner/repo, URL, or local path)
  ipcMain.handle("skills:list-install-tasks", () => marketplaceInstallTasks.list())
  ipcMain.handle("skills:dismiss-install-task", (_event, key: string) => {
    marketplaceInstallTasks.dismiss(key)
  })

  ipcMain.handle(
    "skills:install",
    async (
      _event,
      source: string,
      skillId: string,
      agentNames: string[],
      _scope: string,
    ): Promise<
      Array<{ skillName: string; agent: string; success: boolean; error?: string }>
    > => {
      assertSkillStorageReady()
      const failedResult = (error: string) => [{
        skillName: skillId || source,
        agent: "unknown",
        success: false,
        error,
      }]
      const parsed = parseSource(source)
      if (!parsed) {
        return failedResult("Skill 来源地址无效，请返回市场后重试。")
      }
      if (agentNames.length === 0) {
        return failedResult("请选择至少一个已安装的 Agent。")
      }

      const detected = await detectAgents()
      const detectedNames = new Set(detected.map((agent) => agent.name))
      const targetAgents = getExpandedTargetAgents(agentNames).filter((agent) =>
        detectedNames.has(agent.name),
      )
      if (targetAgents.length === 0) {
        return failedResult("请选择至少一个已安装的 Agent。")
      }

      const installKey = marketplaceInstallTaskKey(source, skillId)
      if (marketplaceInstallTasks.isRunning(installKey)) {
        return failedResult("该 Skill 正在后台安装，可返回市场查看进度。")
      }
      broadcastMarketplaceInstallTask(
        marketplaceInstallTasks.start(source, skillId, agentNames),
      )

      const failed = (error: string) => {
        const task = marketplaceInstallTasks.fail(installKey, error)
        if (task) broadcastMarketplaceInstallTask(task)
        return failedResult(error)
      }

      const emitProgress = (
        stage: Exclude<MarketplaceInstallStage, "failed">,
        completed = 0,
        total = 0,
        downloadedBytes = 0,
        totalBytes = 0,
      ) => {
        const task = marketplaceInstallTasks.update(installKey, {
          stage,
          completed,
          total,
          downloadedBytes,
          totalBytes,
        })
        if (task) broadcastMarketplaceInstallTask(task)
      }

      let tmpDir: string | null = null
      try {
        emitProgress("preparing")
        let sourceDir: string
        let allowSingleSkillFallback = false
        if (parsed.type === "github") {
          tmpDir = path.join(os.tmpdir(), `skillbox-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)
          const downloadResult = await acquireGitHubRepository({
            owner: parsed.owner,
            repo: parsed.repo,
            skillId,
            destination: tmpDir,
            clone: gitClone,
            fetchImpl: marketFetch,
            onProgress: (progress) => emitProgress(
              progress.stage,
              progress.completed,
              progress.total,
              progress.downloadedBytes,
              progress.totalBytes,
            ),
          })
          if (!downloadResult.success) {
            return failed(downloadResult.error)
          }
          allowSingleSkillFallback = downloadResult.method === "files"
          sourceDir = tmpDir
        } else {
          sourceDir = parsed.url
        }

        const discovered = await discoverSkillsInDir(sourceDir)
        const skill = selectMarketplaceSkill(
          discovered,
          sourceDir,
          skillId,
          allowSingleSkillFallback,
        )
        if (!skill) {
          return failed("仓库中未找到所选 Skill，请联系发布者检查市场信息。")
        }

        const safeName = sanitizeName(skill.name)
        const canonicalDir = path.join(CANONICAL_SKILLS_DIR, safeName)
        if (await dirExists(canonicalDir)) {
          return failed("本地已存在同名 Skill，请在技能详情中管理 Agent 适配。")
        }
        for (const agent of targetAgents) {
          const targetDir = path.join(agent.globalSkillsDir, safeName)
          if (await entryExists(targetDir)) {
            return failed(
              `${agent.displayName} 中已存在同名 Skill。为避免覆盖本地修改，请先在技能详情中处理该副本。`,
            )
          }
        }

        emitProgress("installing")
        const skillDir = path.dirname(skill.filePath)
        const results: Array<{
          skillName: string
          agent: string
          success: boolean
          error?: string
        }> = []
        for (const agent of targetAgents) {
          const result = await installSkillToAgent(skillDir, skill.name, agent)
          results.push({
            skillName: skill.name,
            agent: agent.displayName,
            success: result.success,
            error: result.error,
          })
        }

        if (results.some((result) => result.success)) {
          const lock = await readSkillLock()
          const now = new Date().toISOString()
          const existing = lock.skills[safeName]
          lock.skills[safeName] = {
            source:
              parsed.type === "github"
                ? marketplaceSourceKey(parsed.owner, parsed.repo, skillId)
                : parsed.url,
            sourceType: parsed.type,
            originalUrl: source,
            sourceLinked: true,
            skillFolderHash: "",
            installedAt: existing?.installedAt || now,
            updatedAt: now,
          }
          await writeSkillLock(lock)
        }

        if (results.every((result) => result.success)) {
          const task = marketplaceInstallTasks.complete(installKey)
          if (task) broadcastMarketplaceInstallTask(task)
        } else {
          const error = results
            .filter((result) => !result.success)
            .map((result) => result.error)
            .filter(Boolean)
            .join("，") || "安装到部分 Agent 时失败，请重试。"
          const task = marketplaceInstallTasks.fail(installKey, error)
          if (task) broadcastMarketplaceInstallTask(task)
        }
        return results
      } catch (error) {
        console.error(`[skills:install] failed for ${source}/${skillId}`, error)
        return failed("安装失败，请检查网络或磁盘空间后重试。")
      } finally {
        if (tmpDir) {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
        }
      }
    },
  )

  // Search skills.sh from main process (avoids CORS)
  ipcMain.handle(
    "skills:search-catalog",
    async (
      _event,
      query: string,
      limit: number = 30,
      offset: number = 0,
    ): Promise<{ skills: { id: string; skillId: string; name: string; installs: number; source: string }[]; count: number }> => {
      const q = query.trim().length >= 2 ? query.trim() : "skill"
      const url = `https://skills.sh/api/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`
      const res = await marketFetch(url)
      if (!res.ok) throw new Error(`skills.sh search failed (HTTP ${res.status})`)
      const data = (await res.json()) as {
        skills?: { id: string; skillId: string; name: string; installs: number; source: string }[]
        count?: number
      }
      return { skills: data.skills ?? [], count: data.count ?? 0 }
    },
  )

  // Trending browse: scrape skills.sh's trending page (no JSON API exists).
  // Returns a fresh six-hour cache when available, otherwise scrapes, persists,
  // and returns the result. Rejects on scrape failure so the renderer can
  // treat trending as a non-fatal enhancement over live search.
  ipcMain.handle(
    "skills:fetch-trending",
    async (): Promise<TrendingSkill[]> => {
      const cached = loadTrendingCache()
      if (cached) return cached

      const skills = await fetchTrending()
      saveTrendingCache(skills)
      return skills
    },
  )

  // Fetch SKILL.md content from GitHub raw (avoids CORS)
  const summaryCache = new Map<string, string | null>()
  const branchCache = new Map<string, string>()

  ipcMain.handle(
    "skills:fetch-summary",
    async (_event, source: string, skillId: string): Promise<string | null> => {
      const cacheKey = `${source}:${skillId}`
      if (summaryCache.has(cacheKey)) return summaryCache.get(cacheKey) ?? null

      const sourceParts = source.split("/").filter(Boolean)
      if (sourceParts.length !== 2 || !skillId.trim()) {
        summaryCache.set(cacheKey, null)
        return null
      }

      try {
        const skillPath = [...sourceParts, skillId]
          .map((part) => encodeURIComponent(part))
          .join("/")
        const res = await marketFetch(`https://skills.sh/${skillPath}`)
        if (!res.ok) throw new Error(`skills.sh detail failed (HTTP ${res.status})`)

        const html = await res.text()
        const descriptionTag = html.match(/<meta\b[^>]*\bname=["']description["'][^>]*>/i)?.[0]
        const encodedDescription = descriptionTag
          ?.match(/\bcontent=["']([^"']*)["']/i)?.[1]
          ?.trim()
        const description = encodedDescription
          ? encodedDescription
            .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
            .replace(/&quot;/g, '"')
            .replace(/&apos;|&#39;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
          : null

        summaryCache.set(cacheKey, description)
        return description
      } catch {
        summaryCache.set(cacheKey, null)
        return null
      }
    },
  )

  ipcMain.handle(
    "skills:fetch-content",
    async (
      _event,
      source: string,
      skillId: string,
    ): Promise<string | null> => {
      // Resolve default branch
      let branch = branchCache.get(source)
      if (!branch) {
        try {
          const res = await marketFetch(`https://api.github.com/repos/${source}`)
          if (res.ok) {
            const data = await res.json() as { default_branch?: string }
            branch = data.default_branch || "main"
          } else {
            branch = "main"
          }
        } catch {
          branch = "main"
        }
        branchCache.set(source, branch || "main")
      }
      const resolvedBranch = branch || "main"

      const paths = [
        `skills/${skillId}/SKILL.md`,
        `skills/.curated/${skillId}/SKILL.md`,
        `skills/.experimental/${skillId}/SKILL.md`,
        `${skillId}/SKILL.md`,
        `SKILL.md`,
      ]

      for (const ref of Array.from(new Set([resolvedBranch, "HEAD"]))) {
        for (const p of paths) {
          try {
            const res = await marketFetch(`https://raw.githubusercontent.com/${source}/${ref}/${p}`)
            if (res.ok) {
              const content = await res.text()
              if (isRequestedMarketplaceContent(skillId, p, content)) return content
            }
          } catch {
            continue
          }
        }
      }

      // raw.githubusercontent.com is unavailable on some networks even when
      // api.github.com works, so retry through the GitHub Contents API.
      for (const p of paths) {
        try {
          const encodedPath = p.split("/").map(encodeURIComponent).join("/")
          const res = await marketFetch(
            `https://api.github.com/repos/${source}/contents/${encodedPath}?ref=${encodeURIComponent(resolvedBranch)}`,
            {
              headers: {
                Accept: "application/vnd.github.raw+json",
                "User-Agent": "Skillbox",
              },
            },
          )
          if (res.ok) {
            const content = await res.text()
            if (isRequestedMarketplaceContent(skillId, p, content)) return content
          }
        } catch {
          continue
        }
      }

      // Some repositories keep skills below a custom package/plugin folder.
      // Resolve those entries by directory name instead of assuming one layout.
      try {
        const treeResponse = await marketFetch(
          `https://api.github.com/repos/${source}/git/trees/HEAD?recursive=1`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "Skillbox",
            },
          },
        )
        if (treeResponse.ok) {
          const treeData = await treeResponse.json() as {
            truncated?: boolean
            tree?: Array<{ path: string; type: string }>
          }
          const nestedPath = !treeData.truncated
            ? treeData.tree?.find((entry) =>
              entry.type === "blob" &&
              path.posix.basename(entry.path) === "SKILL.md" &&
              path.posix.basename(path.posix.dirname(entry.path)).toLowerCase() === skillId.toLowerCase(),
            )?.path
            : undefined
          if (nestedPath) {
            const encodedPath = nestedPath.split("/").map(encodeURIComponent).join("/")
            const rawResponse = await marketFetch(
              `https://raw.githubusercontent.com/${source}/HEAD/${encodedPath}`,
            )
            if (rawResponse.ok) return await rawResponse.text()

            const contentsResponse = await marketFetch(
              `https://api.github.com/repos/${source}/contents/${encodedPath}?ref=HEAD`,
              {
                headers: {
                  Accept: "application/vnd.github.raw+json",
                  "User-Agent": "Skillbox",
                },
              },
            )
            if (contentsResponse.ok) return await contentsResponse.text()
          }
        }
      } catch {
        // Preview is optional; installation still has its own fallbacks.
      }
      return null
    },
  )

  // Install a skill using the `npx skills add` CLI command
  ipcMain.handle(
    "skills:install-via-cli",
    async (
      _event,
      source: string,
    ): Promise<{ success: boolean; output: string; error?: string }> => {
      assertSkillStorageReady()
      const safeSource = source.replace(/[^a-zA-Z0-9_./-]/g, "")
      const env = buildCliEnv()
      console.log("[skills:install-via-cli] request received", {
        source,
        safeSource,
        platform: process.platform,
        shell: process.env.SHELL || process.env.ComSpec || "<none>",
        path: env.PATH,
      })

      try {
        const npxPath = await resolveNpxPath()
        console.log("[skills:install-via-cli] resolved npx", npxPath)

        return await new Promise((resolve) => {
          const { command, args } = buildNpxInstallCommand(npxPath, safeSource)
          const child = spawn(command, args, {
            cwd: os.homedir(),
            env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsVerbatimArguments: process.platform === "win32",
          })

          let stdout = ""
          let stderr = ""
          let timedOut = false
          const timeout = setTimeout(() => {
            timedOut = true
            console.error("[skills:install-via-cli] timed out after 120000ms")
            child.kill("SIGTERM")
          }, 120_000)

          child.stdout.on("data", (chunk) => {
            const text = chunk.toString()
            stdout += text
            console.log("[skills:install-via-cli][stdout]", text.trimEnd())
          })

          child.stderr.on("data", (chunk) => {
            const text = chunk.toString()
            stderr += text
            console.error("[skills:install-via-cli][stderr]", text.trimEnd())
          })

          child.on("error", (error) => {
            clearTimeout(timeout)
            console.error("[skills:install-via-cli] spawn error:", error)
            resolve({
              success: false,
              output: stdout,
              error: error.message,
            })
          })

          child.on("close", async (code, signal) => {
            clearTimeout(timeout)
            console.log("[skills:install-via-cli] process closed", { code, signal, timedOut })
            if (code === 0 && !timedOut) {
              try {
                await rescanAndCache()
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                console.error("[skills:install-via-cli] rescan failed after successful install:", message)
                resolve({
                  success: false,
                  output: stdout,
                  error: `Install completed but refresh failed: ${message}`,
                })
                return
              }

              resolve({
                success: true,
                output: stdout,
              })
              return
            }

            resolve({
              success: false,
              output: stdout,
              error: stderr || `Install exited with code ${code ?? "unknown"}${signal ? ` (signal ${signal})` : ""}`,
            })
          })
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error("[skills:install-via-cli] setup failed:", message)
        return {
          success: false,
          output: "",
          error: message,
        }
      }
    },
  )

  ipcMain.handle(
    "skills:export-package",
    async (
      _event,
      request: { scope: ExportScope; selectedPaths?: string[] },
    ) => {
      const scope: ExportScope = ["selected", "all", "global", "project"].includes(request?.scope)
        ? request.scope
        : "all"
      const selected = new Set((request?.selectedPaths || []).map((value) => path.resolve(value)))
      const installed = await listInstalledSkillsInternal()
      const candidates = installed.filter((skill) => {
        if (scope === "selected") return selected.has(path.resolve(skill.canonicalPath))
        if (scope === "global" || scope === "project") return skill.scope === scope
        return true
      })

      const exportable: Array<{
        skill: (typeof candidates)[number]
        sourceDir: string
      }> = []
      for (const skill of candidates) {
        // `canonicalPath` 可能是 Agent 符号链接背后的共享目录目标。
        // 使用扫描到的 Agent 路径进行白名单校验和归档读取，确保链接的全局 Skill 也能导出。
        const sourceDir = path.resolve(skill.path)
        if (
          isSkillPathAllowed(sourceDir) &&
          await fileExists(path.join(sourceDir, "SKILL.md"))
        ) {
          exportable.push({ skill, sourceDir })
        }
      }

      if (exportable.length === 0) {
        return { cancelled: false, filePath: null, skillCount: 0 }
      }

      const date = new Date().toISOString().slice(0, 10)
      const options = {
        title: "导出 Skillbox 迁移包",
        defaultPath: path.join(app.getPath("downloads"), `Skillbox-${date}.skillbox`),
        filters: [{ name: "Skillbox 迁移包", extensions: ["skillbox"] }],
        properties: ["showOverwriteConfirmation"] as Array<"showOverwriteConfirmation">,
      }
      const result = _mainWindow
        ? await dialog.showSaveDialog(_mainWindow, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) {
        return { cancelled: true, filePath: null, skillCount: 0 }
      }

      emitMigrationProgress({
        operation: "export",
        stage: "preparing",
        current: 0,
        total: exportable.length,
        percent: 2,
        message: "正在准备导出",
      })

      const usedFolders = new Set<string>()
      const manifest: SkillboxArchiveManifest = {
        format: "skillbox-migration",
        version: 1,
        exportedAt: new Date().toISOString(),
        skills: [],
      }
      const zip = new AdmZip()

      for (const [index, { skill, sourceDir }] of exportable.entries()) {
        const baseFolder = sanitizeName(skill.name) || `skill-${index + 1}`
        let archiveFolder = baseFolder
        let suffix = 2
        while (usedFolders.has(archiveFolder)) {
          archiveFolder = `${baseFolder}-${suffix++}`
        }
        usedFolders.add(archiveFolder)

        await addDirectoryToArchive(
          zip,
          sourceDir,
          path.posix.join("skills", archiveFolder),
        )
        manifest.skills.push({
          name: skill.name,
          archiveFolder,
          agentNames: getAgentKeys(skill.agents),
        })
        emitMigrationProgress({
          operation: "export",
          stage: "packing",
          current: index + 1,
          total: exportable.length,
          percent: Math.round(5 + ((index + 1) / exportable.length) * 85),
          skillName: skill.name,
          message: `正在打包 ${skill.name}`,
        })
      }

      zip.addFile(
        "skillbox-manifest.json",
        Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
      )
      emitMigrationProgress({
        operation: "export",
        stage: "writing",
        current: exportable.length,
        total: exportable.length,
        percent: 94,
        message: "正在写入迁移包",
      })
      await zip.writeZipPromise(result.filePath, { overwrite: true })
      emitMigrationProgress({
        operation: "export",
        stage: "complete",
        current: exportable.length,
        total: exportable.length,
        percent: 100,
        message: "导出完成",
      })
      return {
        cancelled: false,
        filePath: result.filePath,
        skillCount: manifest.skills.length,
      }
    },
  )

  ipcMain.handle("skills:inspect-import-package", async () => {
    const options = {
      title: "导入 Skillbox 迁移包",
      properties: ["openFile"] as Array<"openFile">,
      filters: [{ name: "Skillbox 迁移包", extensions: ["skillbox"] }],
    }
    const result = _mainWindow
      ? await dialog.showOpenDialog(_mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true }
    }

    const archivePath = result.filePaths[0]
    const zip = new AdmZip(archivePath)
    const manifest = parseSkillboxManifest(zip)
    const existing = await listInstalledSkillsInternal()
    const existingNames = new Set(existing.map((skill) => skill.name.trim().toLowerCase()))
    const importableSkills = manifest.skills.filter(
      (skill) => !existingNames.has(skill.name.trim().toLowerCase()),
    )
    const detected = await detectAgents()
    const detectedNames = new Set(detected.map((agent) => agent.name))
    const bindingCounts = new Map<string, number>()
    for (const skill of importableSkills) {
      for (const agentName of skill.agentNames) {
        bindingCounts.set(agentName, (bindingCounts.get(agentName) || 0) + 1)
      }
    }

    const availableAgents: Array<{ name: string; displayName: string; skillCount: number }> = []
    const missingAgents: Array<{ name: string; displayName: string; skillCount: number }> = []
    const unknownAgents: Array<{ name: string; displayName: string; skillCount: number }> = []
    for (const [agentName, skillCount] of bindingCounts) {
      const agent = agentRegistry[agentName]
      if (!agent || agent.name === "universal") {
        unknownAgents.push({ name: agentName, displayName: agentName, skillCount })
      } else if (detectedNames.has(agent.name)) {
        availableAgents.push({ name: agent.name, displayName: agent.displayName, skillCount })
      } else {
        missingAgents.push({ name: agent.name, displayName: agent.displayName, skillCount })
      }
    }

    const packageAgentNames = new Set(manifest.skills.flatMap((skill) => skill.agentNames))
    const newAgents = detected
      .filter((agent) => agent.name !== "universal" && !packageAgentNames.has(agent.name))
      .map((agent) => ({ name: agent.name, displayName: agent.displayName }))

    return {
      cancelled: false,
      filePath: archivePath,
      fileName: path.basename(archivePath),
      skillCount: manifest.skills.length,
      importableCount: importableSkills.length,
      duplicateCount: manifest.skills.length - importableSkills.length,
      availableAgents,
      missingAgents,
      unknownAgents,
      newAgents,
    }
  })

  ipcMain.handle("skills:import-package", async (_event, archivePath: string) => {
    assertSkillStorageReady()
    if (
      typeof archivePath !== "string" ||
      path.extname(archivePath).toLowerCase() !== ".skillbox" ||
      !(await fileExists(archivePath))
    ) {
      throw new Error("请选择有效的 Skillbox 迁移包")
    }

    const zip = new AdmZip(archivePath)
    const manifest = parseSkillboxManifest(zip)
    emitMigrationProgress({
      operation: "import",
      stage: "preparing",
      current: 0,
      total: manifest.skills.length,
      percent: 2,
      message: "正在校验迁移包",
    })

    const existing = await listInstalledSkillsInternal()
    const existingNames = new Set(existing.map((skill) => skill.name.trim().toLowerCase()))
    const detectedNames = new Set((await detectAgents()).map((agent) => agent.name))
    const lock = await readSkillLock()
    const physicalRoot = await fs.realpath(CANONICAL_SKILLS_DIR).catch(() => CANONICAL_SKILLS_DIR)
    const tempRoot = await fs.mkdtemp(path.join(path.dirname(physicalRoot), ".skillbox-import-"))
    let imported = 0
    let skipped = 0
    let adapted = 0
    const importedSafeNames = new Set<string>()
    const errors: string[] = []
    ensureStores()
    const pendingBindings = settingsStore.get<PendingAgentBindings>(PENDING_AGENT_BINDINGS_KEY, {})

    try {
      for (const [index, archivedSkill] of manifest.skills.entries()) {
        const displayName = archivedSkill.name.trim()
        const archiveFolder = archivedSkill.archiveFolder
        const safeName = sanitizeName(displayName) || sanitizeName(archiveFolder) || `skill-${index + 1}`
        if (
          existingNames.has(displayName.toLowerCase())
        ) {
          skipped += 1
          emitMigrationProgress({
            operation: "import",
            stage: "importing",
            current: index + 1,
            total: manifest.skills.length,
            percent: Math.round(5 + ((index + 1) / Math.max(manifest.skills.length, 1)) * 82),
            skillName: displayName,
            message: `已跳过同名 Skill：${displayName}`,
          })
          continue
        }

        const targetDir = path.join(physicalRoot, safeName)
        if (await dirExists(targetDir)) {
          skipped += 1
          emitMigrationProgress({
            operation: "import",
            stage: "importing",
            current: index + 1,
            total: manifest.skills.length,
            percent: Math.round(5 + ((index + 1) / Math.max(manifest.skills.length, 1)) * 82),
            skillName: displayName,
            message: `已跳过同名 Skill：${displayName}`,
          })
          continue
        }

        const tempSkillDir = path.join(tempRoot, `${safeName}-${index}`)
        const prefix = `skills/${archiveFolder}/`
        const entries = zip.getEntries().filter(
          (entry) => !entry.isDirectory && entry.entryName.startsWith(prefix),
        )

        try {
          for (const entry of entries) {
            const relativeName = path.posix.normalize(entry.entryName.slice(prefix.length))
            if (
              !relativeName ||
              relativeName === "." ||
              relativeName.startsWith("../") ||
              path.posix.isAbsolute(relativeName)
            ) {
              throw new Error("迁移包包含不安全的文件路径")
            }
            const destination = path.resolve(tempSkillDir, ...relativeName.split("/"))
            if (!destination.startsWith(path.resolve(tempSkillDir) + path.sep)) {
              throw new Error("迁移包包含越界文件路径")
            }
            await fs.mkdir(path.dirname(destination), { recursive: true })
            await fs.writeFile(destination, entry.getData())
          }

          if (!(await fileExists(path.join(tempSkillDir, "SKILL.md")))) {
            throw new Error("缺少 SKILL.md")
          }

          await fs.mkdir(physicalRoot, { recursive: true })
          await fs.rename(tempSkillDir, targetDir)
          imported += 1
          importedSafeNames.add(safeName)
          existingNames.add(displayName.toLowerCase())

          const now = new Date().toISOString()
          lock.skills[safeName] = {
            source: archivePath,
            sourceType: "import",
            originalUrl: targetDir,
            sourceLinked: false,
            skillFolderHash: "",
            installedAt: now,
            updatedAt: now,
          }

          const waiting = new Set(pendingBindings[safeName] || [])
          for (const agentName of archivedSkill.agentNames) {
            const agent = agentRegistry[agentName]
            if (!agent || agent.name === "universal" || !detectedNames.has(agent.name)) {
              waiting.add(agentName)
              continue
            }
            emitMigrationProgress({
              operation: "import",
              stage: "adapting",
              current: index + 1,
              total: manifest.skills.length,
              percent: Math.round(5 + ((index + 1) / Math.max(manifest.skills.length, 1)) * 82),
              skillName: displayName,
              message: `正在恢复 ${agent.displayName} 适配`,
            })
            const installResult = await installSkillToAgent(targetDir, safeName, agent)
            if (installResult.success) adapted += 1
            else waiting.add(agentName)
          }
          if (waiting.size > 0) pendingBindings[safeName] = Array.from(waiting)
          else delete pendingBindings[safeName]
        } catch (error) {
          await fs.rm(tempSkillDir, { recursive: true, force: true }).catch(() => {})
          errors.push(`${displayName || archiveFolder}: ${error instanceof Error ? error.message : String(error)}`)
        }

        emitMigrationProgress({
          operation: "import",
          stage: "importing",
          current: index + 1,
          total: manifest.skills.length,
          percent: Math.round(5 + ((index + 1) / Math.max(manifest.skills.length, 1)) * 82),
          skillName: displayName,
          message: `已处理 ${displayName}`,
        })
      }

      await writeSkillLock(lock)
      settingsStore.set(PENDING_AGENT_BINDINGS_KEY, pendingBindings)
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    }

    emitMigrationProgress({
      operation: "import",
      stage: "refreshing",
      current: manifest.skills.length,
      total: manifest.skills.length,
      percent: 94,
      message: "正在刷新本地 Skill",
    })
    await rescanAndCache()
    const remainingBindings = settingsStore.get<PendingAgentBindings>(PENDING_AGENT_BINDINGS_KEY, {})
    const pending = Array.from(importedSafeNames).reduce(
      (count, safeName) => count + (remainingBindings[safeName]?.length || 0),
      0,
    )
    emitMigrationProgress({
      operation: "import",
      stage: "complete",
      current: manifest.skills.length,
      total: manifest.skills.length,
      percent: 100,
      message: "导入完成",
    })
    return { cancelled: false, imported, skipped, adapted, pending, errors }
  })

  ipcMain.handle(
    "skills:create",
    async (
      _event,
      data: { name: string; description?: string; content?: string; agentNames?: string[] },
    ) => {
      assertSkillStorageReady()
      const trimmedName = data.name.trim()
      if (!trimmedName) {
        throw new Error("Skill name is required")
      }

      const safeName = sanitizeName(trimmedName)
      const canonicalDir = path.join(CANONICAL_SKILLS_DIR, safeName)
      const skillFilePath = path.join(canonicalDir, "SKILL.md")

      if (await dirExists(canonicalDir)) {
        throw new Error(`Skill "${trimmedName}" already exists`)
      }

      await fs.mkdir(canonicalDir, { recursive: true })
      const content = (data.content?.trim() || `---
name: ${safeName}
description: ${(data.description?.trim() || trimmedName).replace(/\n/g, " ")}
---

# ${trimmedName}

## Instructions

Add your skill instructions here.
`).trimEnd() + "\n"
      await fs.writeFile(skillFilePath, content, "utf-8")

      const detected = await detectAgents()
      const detectedNames = new Set(detected.map((agent) => agent.name))
      const targetAgents = getExpandedTargetAgents(data.agentNames ?? []).filter((agent) =>
        detectedNames.has(agent.name),
      )

      for (const agent of targetAgents) {
        await installSkillToAgent(canonicalDir, trimmedName, agent)
      }

      const lock = await readSkillLock()
      const now = new Date().toISOString()
      lock.skills[safeName] = {
        source: canonicalDir,
        sourceType: "local",
        originalUrl: canonicalDir,
        sourceLinked: false,
        skillFolderHash: "",
        installedAt: now,
        updatedAt: now,
      }
      await writeSkillLock(lock)

      return {
        name: trimmedName,
        path: canonicalDir,
        targets: targetAgents.map((agent) => agent.name),
      }
    },
  )

  // 按扫描得到的真实位置删除。实体目录进入系统回收站，Junction 只解除链接；
  // 不再根据名称推算路径，避免同名误删和空名称导致的目录越界。
  ipcMain.handle("skills:remove", async (_event, input: SkillRemovalRequest) => {
    assertSkillStorageReady()
    const plan = await buildSkillRemovalPlan(input)
    const removedPaths: string[] = []
    const errors: Array<{ path: string; message: string }> = []

    const classified = await Promise.all(plan.paths.map(async (target) => ({
      ...target,
      stat: await fs.lstat(target.path),
    })))
    classified.sort((left, right) =>
      Number(right.stat.isSymbolicLink()) - Number(left.stat.isSymbolicLink()),
    )

    for (const target of classified) {
      try {
        await removeSkillPath(target.path, {
          lstat: (targetPath) => fs.lstat(targetPath),
          unlink: (targetPath) => fs.unlink(targetPath),
          trash: (targetPath) => shell.trashItem(targetPath),
        })
        removedPaths.push(target.path)
      } catch (error) {
        errors.push({
          path: target.path,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const removedKeys = new Set(removedPaths.map(pathComparisonKey))

    ensureStores()
    const collections = settingsStore.get<Record<string, string[]>>(COLLECTIONS_KEY, {})
    const removedCollectionPaths = new Set(removedPaths.map(pathComparisonKey))
    const nextCollections = Object.fromEntries(
      Object.entries(collections).map(([name, items]) => [
        name,
        items.filter((item) => !removedCollectionPaths.has(pathComparisonKey(item))),
      ]),
    )
    settingsStore.set(COLLECTIONS_KEY, nextCollections)

    const skills = await rescanAndCache()
    const stillHasGlobalSkill = skills.some((skill) =>
      skill.scope === "global" &&
      skill.name.trim().toLowerCase() === plan.request.name.toLowerCase(),
    )
    if (removedPaths.length > 0) {
      const lock = await readSkillLock()
      for (const removedPath of removedPaths) {
        delete lock.linkedSources?.[pathComparisonKey(removedPath)]
      }
      for (const target of plan.paths) {
        if (stillHasGlobalSkill || target.scope !== "global" || !removedKeys.has(pathComparisonKey(target.path))) continue
        delete lock.skills[path.basename(target.path)]
      }
      await writeSkillLock(lock)
    }
    if (!skills.some((skill) => skill.name.trim().toLowerCase() === plan.request.name.toLowerCase())) {
      favoritesStore.remove(plan.request.name)
    }
    return { skills, removedPaths, collections: nextCollections, errors }
  })

  ipcMain.handle("skills:choose-source-directory", async () => {
    const options = { title: "选择 Skill 更新来源目录", properties: ["openDirectory"] as Array<"openDirectory"> }
    const result = _mainWindow
      ? await dialog.showOpenDialog(_mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle(
    "skills:link-sources",
    async (
      _event,
      input: { skills: Array<SkillSourceTarget & { source: string }> },
    ): Promise<{ linked: number; errors: Array<{ name: string; canonicalPath: string; message: string }> }> => {
      assertSkillStorageReady()
      const targets = Array.isArray(input?.skills) ? input.skills : []
      if (targets.length === 0) throw new Error("没有选择要关联来源的 Skill")

      const lock = await readSkillLock()
      const errors: Array<{ name: string; canonicalPath: string; message: string }> = []
      const sourceCounts = new Map<string, number>()
      for (const target of targets) {
        const source = String(target.source ?? "").trim()
        sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1)
      }
      const sharedRoots = new Map<string, CachedSourceRoot>()
      let linked = 0
      try {
        for (const target of targets) {
          const source = String(target.source ?? "").trim()
          const parsed = parseSource(source)
          if (!parsed) {
            errors.push({ name: target.name, canonicalPath: target.canonicalPath, message: "来源地址无效" })
            continue
          }
          if (parsed.type === "local" && !(await dirExists(parsed.url))) {
            errors.push({ name: target.name, canonicalPath: target.canonicalPath, message: "本地来源目录不存在" })
            continue
          }
          const resolvedPath = path.resolve(target.canonicalPath)
          if (!isSkillPathAllowed(resolvedPath) || !(await fileExists(path.join(resolvedPath, "SKILL.md")))) {
            errors.push({ name: target.name, canonicalPath: target.canonicalPath, message: "Skill 路径无效或不在已授权目录中" })
            continue
          }
          const folderName = path.basename(resolvedPath)
          const existing = getSkillSourceRecord(lock, resolvedPath)
          let resolved: ResolvedSourceSkill
          try {
            resolved = await resolveSourceSkill(
              source,
              target,
              undefined,
              (sourceCounts.get(source) ?? 0) > 1 ? sharedRoots : undefined,
            )
          } catch (error) {
            errors.push({
              name: target.name,
              canonicalPath: target.canonicalPath,
              message: error instanceof Error ? error.message : "无法检查来源目录",
            })
            continue
          }
          if (resolved.temporaryRoot && !sharedRoots.has(source)) {
            await fs.rm(resolved.temporaryRoot, { recursive: true, force: true }).catch(() => {})
          }
          lock.linkedSources ??= {}
          lock.linkedSources[pathComparisonKey(resolvedPath)] = {
            ...existing,
            source: parsed.type === "github"
              ? marketplaceSourceKey(parsed.owner, parsed.repo, folderName)
              : parsed.url,
            sourceType: parsed.type,
            originalUrl: source,
            sourceLinked: true,
            skillId: folderName,
            installedAt: existing?.installedAt,
            updatedAt: existing?.updatedAt,
          }
          linked += 1
        }
        if (linked > 0) {
          await writeSkillLock(lock)
          await rescanAndCache()
        }
        return { linked, errors }
      } finally {
        await Promise.all([...sharedRoots.values()].map(({ temporaryRoot }) => temporaryRoot
          ? fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {})
          : Promise.resolve()))
      }
    },
  )

  ipcMain.handle("skills:list-linked-sources", async (_event, targets: SkillSourceTarget[]) => {
    const lock = await readSkillLock()
    return (Array.isArray(targets) ? targets : []).flatMap((target) => {
      if (typeof target?.canonicalPath !== "string") return []
      const resolvedPath = path.resolve(target.canonicalPath)
      if (!isSkillPathAllowed(resolvedPath)) return []
      const entry = getSkillSourceRecord(lock, resolvedPath)
      if (!entry?.originalUrl || (!entry.sourceLinked && entry.sourceType !== "github")) return []
      return [{ canonicalPath: target.canonicalPath, source: entry.source ?? entry.originalUrl }]
    })
  })

  ipcMain.handle(
    "skills:check-update",
    async (_event, target: SkillSourceTarget) => {
      const resolvedPath = path.resolve(target.canonicalPath)
      if (!isSkillPathAllowed(resolvedPath)) throw new Error("Skill 路径不在已授权目录中")
      const lock = await readSkillLock()
      const entry = getSkillSourceRecord(lock, resolvedPath)
      if (!entry?.originalUrl || (!entry.sourceLinked && entry.sourceType !== "github")) {
        throw new Error("这个 Skill 尚未关联来源")
      }

      const resolved = await resolveSourceSkill(entry.originalUrl, target, entry.skillId)
      try {
        const changes = await compareSkillContents(resolvedPath, resolved.skillDir)
        return {
          available: changes.length > 0,
          source: entry.source,
          changes,
        }
      } finally {
        if (resolved.temporaryRoot) {
          await fs.rm(resolved.temporaryRoot, { recursive: true, force: true }).catch(() => {})
        }
      }
    },
  )

  // 更新前后都保存外置快照；Skill 目录本身不会写入版本元数据。
  ipcMain.handle("skills:update", async (_event, target: SkillSourceTarget) => {
    assertSkillStorageReady()
    const resolvedPath = path.resolve(target.canonicalPath)
    if (!isSkillPathAllowed(resolvedPath)) throw new Error("Skill 路径不在已授权目录中")
    const lock = await readSkillLock()
    const entry = getSkillSourceRecord(lock, resolvedPath)
    if (!entry?.originalUrl || (!entry.sourceLinked && entry.sourceType !== "github")) {
      throw new Error("这个 Skill 尚未关联来源")
    }

    const resolved = await resolveSourceSkill(entry.originalUrl, target, entry.skillId)
    try {
      const changes = await compareSkillContents(resolvedPath, resolved.skillDir)
      if (changes.length === 0) return { updated: false, changes: [] }

      await saveSkillVersion(resolvedPath, target.name, "initial")
      await replaceSkillDirectory(resolved.skillDir, resolvedPath, async () => {
        await saveSkillVersion(resolvedPath, target.name, "update")
      })

      const recordKey = pathComparisonKey(resolvedPath)
      if (lock.linkedSources?.[recordKey]) {
        lock.linkedSources[recordKey] = { ...entry, updatedAt: new Date().toISOString() }
      } else {
        lock.skills[path.basename(resolvedPath)] = { ...entry, updatedAt: new Date().toISOString() }
      }
      await writeSkillLock(lock)
      await rescanAndCache()
      return { updated: true, changes }
    } finally {
      if (resolved.temporaryRoot) {
        await fs.rm(resolved.temporaryRoot, { recursive: true, force: true }).catch(() => {})
      }
    }
  })

  ipcMain.handle("skill-versions:list", async (_event, target: SkillSourceTarget) => {
    const resolvedPath = path.resolve(target.canonicalPath)
    if (!isSkillPathAllowed(resolvedPath)) throw new Error("Skill 路径不在已授权目录中")
    return getSkillVersionStore().list(resolvedPath, target.name)
  })

  ipcMain.handle(
    "skill-versions:create",
    async (_event, target: SkillSourceTarget, reason: SkillVersionReason = "manual") => {
      assertSkillStorageReady()
      const resolvedPath = path.resolve(target.canonicalPath)
      if (!isSkillPathAllowed(resolvedPath)) throw new Error("Skill 路径不在已授权目录中")
      return getSkillVersionStore().create(resolvedPath, target.name, reason)
    },
  )

  ipcMain.handle(
    "skill-versions:read-file",
    async (_event, target: SkillSourceTarget, versionId: string, relativePath?: string) => {
      const resolvedPath = path.resolve(target.canonicalPath)
      if (!isSkillPathAllowed(resolvedPath)) throw new Error("Skill 路径不在已授权目录中")
      return getSkillVersionStore().readFile(resolvedPath, target.name, versionId, relativePath)
    },
  )

  ipcMain.handle(
    "skill-versions:restore",
    async (_event, target: SkillSourceTarget, versionId: string) => {
      assertSkillStorageReady()
      const resolvedPath = path.resolve(target.canonicalPath)
      if (!isSkillPathAllowed(resolvedPath)) throw new Error("Skill 路径不在已授权目录中")
      const store = getSkillVersionStore()
      await store.create(resolvedPath, target.name, "initial")
      await store.restore(resolvedPath, target.name, versionId)
      await store.create(resolvedPath, target.name, "restore")
      await rescanAndCache()
    },
  )

  ipcMain.handle("skill-versions:storage-info", async () => {
    return getSkillVersionStore().info()
  })

  ipcMain.handle("skill-versions:set-retention", async (_event, rawValue: number) => {
    ensureStores()
    const value = Math.min(100, Math.max(3, Math.round(Number(rawValue) || DEFAULT_SKILL_VERSION_RETENTION)))
    settingsStore.set(SKILL_VERSION_RETENTION_KEY, value)
    const store = getSkillVersionStore()
    await store.prune()
    return store.info()
  })

  ipcMain.handle("skill-versions:choose-storage", async () => {
    assertSkillStorageReady()
    ensureStores()
    const result = _mainWindow
      ? await dialog.showOpenDialog(_mainWindow, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] })
    if (result.canceled || !result.filePaths[0]) return null

    const nextRoot = path.join(result.filePaths[0], "Skillbox Versions")
    if (isSkillPathAllowed(nextRoot)) {
      throw new Error("版本仓库不能放在 Skill 扫描目录内，请选择其他位置")
    }
    const previousRoot = getSkillVersionStoragePath()
    await migrateSkillVersionStore(previousRoot, nextRoot)
    settingsStore.set(SKILL_VERSION_STORAGE_KEY, nextRoot)
    return getSkillVersionStore().info()
  })

  ipcMain.handle("skill-versions:open-storage", async () => {
    const root = getSkillVersionStoragePath()
    await fs.mkdir(root, { recursive: true })
    await shell.openPath(root)
  })

  ipcMain.handle("skill-storage:info", async () => {
    const rootStat = await fs.lstat(CANONICAL_SKILLS_DIR).catch(() => null)
    const actualPath = await fs.realpath(CANONICAL_SKILLS_DIR).catch(() => null)
    if (rootStat?.isSymbolicLink() && !actualPath) {
      throw new Error("通用 Skill 存储盘不可用，请连接磁盘后重试")
    }
    return {
      path: actualPath ?? CANONICAL_SKILLS_DIR,
      compatibilityPath: CANONICAL_SKILLS_DIR,
      isLinked: Boolean(actualPath && !pathsEqual(actualPath, CANONICAL_SKILLS_DIR)),
    }
  })

  ipcMain.handle("skill-storage:choose", async () => {
    ensureStores()
    if (skillStorageMigrationInProgress || marketplaceInstallTasks.hasRunningTasks()) {
      throw new Error("有 Skill 正在安装或迁移，请完成后再更改存储位置")
    }
    const chosen = _mainWindow
      ? await dialog.showOpenDialog(_mainWindow, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] })
    if (chosen.canceled || !chosen.filePaths[0]) return null
    const destination = path.join(await fs.realpath(chosen.filePaths[0]), "Skillbox Skills")
    const versionRoot = await fs.realpath(getSkillVersionStoragePath()).catch(() => getSkillVersionStoragePath())
    if (isSkillPathAllowed(destination) ||
        pathsEqual(destination, versionRoot) ||
        isPathInside(destination, versionRoot) ||
        isPathInside(versionRoot, destination)) {
      throw new Error("新目录不能放在 Skill 或版本仓库目录内，请选择其他位置")
    }
    const previous = await fs.realpath(CANONICAL_SKILLS_DIR).catch(() => CANONICAL_SKILLS_DIR)
    if (pathsEqual(previous, destination)) {
      return { path: previous, compatibilityPath: CANONICAL_SKILLS_DIR, isLinked: !pathsEqual(previous, CANONICAL_SKILLS_DIR) }
    }

    if (skillStorageMigrationInProgress || marketplaceInstallTasks.hasRunningTasks()) {
      throw new Error("有 Skill 正在安装或迁移，请完成后再更改存储位置")
    }
    skillStorageMigrationInProgress = true
    try {
      const versions = await prepareSkillVersionPathMigration(
        getSkillVersionStoragePath(),
        previous,
        destination,
        [CANONICAL_SKILLS_DIR],
      )
      let migrated: Awaited<ReturnType<typeof migrateSkillStorage>>
      try {
        const managedPrevious = settingsStore.get<string | null>(SKILL_STORAGE_PATH_KEY, null)
        migrated = await migrateSkillStorage(CANONICAL_SKILLS_DIR, destination, {
          removePreviousTarget: Boolean(managedPrevious && pathsEqual(managedPrevious, previous)),
        })
      } catch (error) {
        await versions.rollback()
        throw error
      }
      const warnings: string[] = []
      try { settingsStore.set(SKILL_STORAGE_PATH_KEY, migrated.path) }
      catch (error) { warnings.push(`存储位置记录失败：${error instanceof Error ? error.message : String(error)}`) }
      try { await remapSkillStorageRecords(migrated.previousPath, migrated.path) }
      catch (error) { warnings.push(`来源记录更新失败：${error instanceof Error ? error.message : String(error)}`) }
      try { await versions.commit() }
      catch (error) { warnings.push(`旧版本索引清理失败：${error instanceof Error ? error.message : String(error)}`) }
      if (migrated.retainedOldPath) warnings.push(`旧目录未能自动清理：${migrated.retainedOldPath}`)
      try { await restartSkillWatcher?.() }
      catch (error) { warnings.push(`文件监听重启失败：${error instanceof Error ? error.message : String(error)}`) }
      try { await rescanAndCache() }
      catch (error) { warnings.push(`Skill 列表刷新失败：${error instanceof Error ? error.message : String(error)}`) }
      return {
        path: migrated.path,
        compatibilityPath: CANONICAL_SKILLS_DIR,
        isLinked: true,
        warning: warnings.join("；") || undefined,
      }
    } finally {
      skillStorageMigrationInProgress = false
    }
  })

  ipcMain.handle("skill-storage:open", async () => {
    const root = await fs.realpath(CANONICAL_SKILLS_DIR).catch(() => CANONICAL_SKILLS_DIR)
    await fs.mkdir(root, { recursive: true })
    const error = await shell.openPath(root)
    if (error) throw new Error(error)
  })

  // -------------------------------------------------------------------------
  // Remote server handlers
  // -------------------------------------------------------------------------

  ipcMain.handle("servers:list", () => {
    ensureStores()
    const servers = serverStore.list()
    // Enrich with skill count
    return servers.map((s) => ({
      ...s,
      skillCount: skillStore.countByServer(s.id),
    }))
  })

  ipcMain.handle("servers:create", (_event, data) => {
    ensureStores()
    return serverStore.create(data)
  })

  ipcMain.handle("servers:update", (_event, id: string, fields) => {
    ensureStores()
    return serverStore.update(id, fields)
  })

  ipcMain.handle("servers:delete", (_event, id: string) => {
    ensureStores()
    serverStore.delete(id)
  })

  ipcMain.handle("servers:test", async (_event, id: string) => {
    ensureStores()
    const server = serverStore.get(id)
    if (!server) return { ok: false, error: "Server not found" }
    return testConnection(server)
  })

  ipcMain.handle("servers:sync", async (_event, id: string) => {
    ensureStores()
    const server = serverStore.get(id)
    if (!server) return { added: 0, updated: 0, removed: 0, unchanged: 0, error: "Server not found" }
    return syncRemoteServer({ remoteServers: serverStore, remoteSkills: skillStore }, server)
  })

  ipcMain.handle("servers:skills", (_event, serverId: string) => {
    ensureStores()
    return skillStore.listByServer(serverId)
  })

  ipcMain.handle("servers:read-skill", async (_event, serverId: string, remotePath: string) => {
    ensureStores()
    const server = serverStore.get(serverId)
    if (!server) {
      throw new Error("Server not found")
    }
    return readRemoteFile(server, remotePath)
  })

  ipcMain.handle(
    "servers:write-skill",
    async (_event, serverId: string, remotePath: string, content: string) => {
      ensureStores()
      const server = serverStore.get(serverId)
      if (!server) {
        throw new Error("Server not found")
      }
      await writeRemoteFile(server, remotePath, content)
      const contentHash = require("node:crypto")
        .createHash("sha256")
        .update(content, "utf-8")
        .digest("hex")
      skillStore.updateContent(serverId, remotePath, content, contentHash)
      return { ok: true }
    },
  )

  ipcMain.handle(
    "servers:push-preview",
    async (_event, serverId: string, mirror: boolean) => {
      ensureStores()
      const server = serverStore.get(serverId)
      if (!server) throw new Error("Server not found")
      return planPush(server, { mirror }, {
        localSkills: await listInstalledSkillsInternal({ skipCustomPaths: true }),
      })
    },
  )

  ipcMain.handle(
    "servers:push-apply",
    async (_event, serverId: string, preview: PushPreview) => {
      ensureStores()
      const server = serverStore.get(serverId)
      if (!server) throw new Error("Server not found")
      const freshPreview = await planPush(server, { mirror: preview?.mirror === true }, {
        localSkills: await listInstalledSkillsInternal({ skipCustomPaths: true }),
      })
      const signature = (value: PushPreview) => JSON.stringify({
        mirror: value.mirror,
        add: value.toAdd.map((entry) => [entry.folderName, entry.remoteDir]).sort(),
        update: value.toUpdate.map((entry) => [entry.folderName, entry.remoteDir]).sort(),
        delete: value.toDelete.map((entry) => [entry.folderName, entry.remoteDir]).sort(),
      })
      if (signature(preview) !== signature(freshPreview)) {
        throw new Error("远程目录已变化，删除清单已失效，请重新预览后再执行")
      }
      const result = await applyPush(server, freshPreview)
      // Refresh remote_skills cache so the UI shows post-push state correctly
      try {
        await syncRemoteServer(
          { remoteServers: serverStore, remoteSkills: skillStore },
          server,
        )
      } catch {
        // Non-fatal: push already happened; cache will refresh on next sync.
      }
      return result
    },
  )

  ipcMain.handle("servers:count", () => {
    ensureStores()
    return serverStore.count()
  })

  // -------------------------------------------------------------------------
  // Skill translation
  // -------------------------------------------------------------------------

  ipcMain.handle("translation:get-config", () => {
    ensureStores()
    return translationConfigView()
  })

  ipcMain.handle("translation:reveal-api-key", () => {
    ensureStores()
    const apiKey = readTranslationApiKey()
    if (!apiKey) throw new Error("未配置大模型 API")
    return apiKey
  })

  ipcMain.handle("translation:save-config", (_event, input: TranslationConfigInput) => {
    ensureStores()
    const config = validateTranslationConfig(input)
    const nextApiKey = input.apiKey?.trim()
    const currentApiKey = readTranslationApiKey()

    if (!nextApiKey && !currentApiKey) {
      throw new Error("请输入 API Key")
    }
    if (nextApiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("当前系统安全存储不可用，无法安全保存 API Key")
      }
      const encrypted = safeStorage.encryptString(nextApiKey).toString("base64")
      settingsStore.set(TRANSLATION_API_KEY, encrypted)
    }

    settingsStore.set(TRANSLATION_CONFIG_KEY, config)
    return translationConfigView()
  })

  ipcMain.handle("translation:clear-config", () => {
    ensureStores()
    settingsStore.delete(TRANSLATION_CONFIG_KEY)
    settingsStore.delete(TRANSLATION_API_KEY)
    return translationConfigView()
  })

  ipcMain.handle("translation:get-state", (_event, rawInput: { identity?: unknown; content?: unknown }) => {
    ensureStores()
    const identity = validateTranslationIdentity(rawInput?.identity)
    const content = validateTranslationContent(String(rawInput?.content ?? ""))
    const sourceHash = buildTranslationSourceHash(content)
    const preference = translationCacheStore.getPreference(identity)

    if (preference?.sourceHash === sourceHash) {
      const cached = translationCacheStore.get(preference.cacheKey)
      if (cached) {
        return {
          content: cached,
          cacheKey: preference.cacheKey,
          showTranslation: preference.showTranslation,
        }
      }
    }

    const cacheKey = buildTranslationCacheKey(readTranslationConfig(), content)
    const cached = translationCacheStore.get(cacheKey)
    if (!cached) return null
    return { content: cached, cacheKey, showTranslation: true }
  })

  ipcMain.handle("translation:list-views", () => {
    ensureStores()
    return translationCacheStore.listPreferences()
  })

  ipcMain.handle("translation:set-view", (_event, rawInput: TranslationViewInput) => {
    ensureStores()
    const identity = validateTranslationIdentity(rawInput?.identity)
    const content = validateTranslationContent(String(rawInput?.content ?? ""))
    const cacheKey = validateTranslationCacheKey(rawInput?.cacheKey)
    if (!translationCacheStore.get(cacheKey)) {
      throw new Error("译文缓存已失效，请重新翻译")
    }
    const preference = {
      identity,
      cacheKey,
      sourceHash: buildTranslationSourceHash(content),
      sourceDescription: normalizeTranslationDescription(rawInput?.sourceDescription),
      translatedDescription: normalizeTranslationDescription(rawInput?.translatedDescription),
      showTranslation: Boolean(rawInput?.showTranslation),
    }
    translationCacheStore.setPreference(preference)
    return preference
  })

  ipcMain.handle("translation:translate", async (_event, rawContent: string) => {
    ensureStores()
    const content = validateTranslationContent(rawContent)
    const config = readTranslationConfig()
    const apiKey = readTranslationApiKey()
    if (!apiKey) {
      throw new Error("未配置大模型 API")
    }

    const cacheKey = buildTranslationCacheKey(config, content)
    const cached = translationCacheStore.get(cacheKey)
    if (cached) {
      return { content: cached, cached: true, cacheKey }
    }
    if (translationInFlight) {
      throw new Error("已有一个 Skill 正在翻译，请等它完成后再试")
    }

    translationInFlight = true
    try {
      const result = await requestTranslation(config, apiKey, content)
      translationCacheStore.set(cacheKey, result.content)
      const currentUsage = settingsStore.get<TranslationUsage | null>(TRANSLATION_USAGE_KEY, null)
      settingsStore.set(
        TRANSLATION_USAGE_KEY,
        recordTranslationUsage(currentUsage, result.usage),
      )
      return {
        content: result.content,
        cached: false,
        cacheKey,
        usage: result.usage,
      }
    } finally {
      translationInFlight = false
    }
  })

  // -------------------------------------------------------------------------
  // Settings handlers
  // -------------------------------------------------------------------------

  ipcMain.handle("settings:get", (_event, key: string, defaultValue: unknown) => {
    ensureStores()
    return settingsStore.get(key, defaultValue)
  })

  ipcMain.handle("settings:set", (_event, key: string, value: unknown) => {
    ensureStores()
    settingsStore.set(key, value)
  })

  ipcMain.handle("settings:all", () => {
    ensureStores()
    return settingsStore.getAll()
  })

  // -------------------------------------------------------------------------
  // Favorites handlers
  // -------------------------------------------------------------------------

  ipcMain.handle("favorites:list", () => {
    ensureStores()
    return favoritesStore.list()
  })

  ipcMain.handle("favorites:toggle", (_event, name: string) => {
    ensureStores()
    return favoritesStore.toggle(name)
  })

  ipcMain.handle("favorites:add-many", (_event, names: string[]) => {
    ensureStores()
    for (const name of Array.from(new Set(names.filter((value) => typeof value === "string" && value.trim())))) {
      favoritesStore.add(name.trim())
    }
    return favoritesStore.list()
  })

  // -------------------------------------------------------------------------
  // Updates
  // -------------------------------------------------------------------------

  ipcMain.handle("updates:get-state", () => {
    return getUpdateState()
  })

  ipcMain.handle("updates:check", async () => {
    return checkForAppUpdates()
  })

  ipcMain.handle("updates:download", async () => {
    return downloadAppUpdate()
  })

  ipcMain.handle("updates:install", () => {
    quitAndInstallUpdate()
  })

  // Release notes for the update dialog. Fetched from the GitHub API in the
  // main process (no CORS, no token needed for a public repo).
  ipcMain.handle(
    "updates:release-notes",
    async (): Promise<{
      version: string
      name: string
      body: string
      url: string
      publishedAt: string
    } | null> => {
      try {
        const res = await fetch(
          "https://api.github.com/repos/Renly1994/Skillbox/releases/latest",
          { headers: { Accept: "application/vnd.github+json" } },
        )
        if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`)
        const data = (await res.json()) as Record<string, unknown>
        return {
          version: String(data.tag_name ?? "").replace(/^(desktop-v|v)/, ""),
          name: String(data.name ?? data.tag_name ?? ""),
          body: String(data.body ?? ""),
          url: String(data.html_url ?? ""),
          publishedAt: String(data.published_at ?? ""),
        }
      } catch {
        return null
      }
    },
  )

  ipcMain.handle("app:get-version", () => {
    return app.getVersion()
  })

  // -------------------------------------------------------------------------
  // Skill editing & management
  // -------------------------------------------------------------------------

  // Write skill content back to disk
  ipcMain.handle("skill:write-content", async (_, filePath: string, content: string) => {
    assertSkillStorageReady()
    // Validate the path is within allowed skill directories
    const resolved = path.resolve(filePath)
    if (!isSkillPathAllowed(resolved)) {
      throw new Error("Access denied: path is outside skill directories")
    }

    try {
      const skillPath = path.dirname(resolved)
      const parsed = await parseSkillMd(resolved)
      const skillName = parsed?.name || path.basename(skillPath)
      const previousContent = await fs.readFile(resolved)
      await saveSkillVersion(skillPath, skillName, "initial")
      await fs.writeFile(resolved, content, "utf-8")
      try {
        await saveSkillVersion(skillPath, skillName, "edit")
      } catch (error) {
        await fs.writeFile(resolved, previousContent)
        throw error
      }
    } catch (err) {
      throw new Error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // Open skill folder in Finder/Explorer
  ipcMain.handle("skill:open-in-finder", (_, filePath: string) => {
    // Validate the path is within allowed skill directories
    const resolved = path.resolve(filePath)
    if (!isSkillPathAllowed(resolved)) {
      throw new Error("Access denied: path is outside skill directories")
    }
    shell.showItemInFolder(resolved)
  })

  // Disable a skill for one agent. Modified physical copies are detached and restored on re-enable.
  ipcMain.handle("skills:remove-from-agent", async (_, input: SkillRemovalRequest, agentName: string) => {
    assertSkillStorageReady()
    const agent = agentRegistry[agentName]
    if (!agent) throw new Error(`Unknown agent: ${agentName}`)
    if (pathsEqual(agent.globalSkillsDir, CANONICAL_SKILLS_DIR)) {
      throw new Error(`${agent.displayName} 直接使用通用 Skill 目录，不存在可单独移除的适配入口`)
    }
    try {
      const resolved = await resolveAgentSkillBinding(input, agent)
      const preservedCopyPaths: string[] = []
      for (const binding of resolved.bindings) {
        const { skillPath, folderName } = binding
        const masterTarget = resolved.request.targets
          .filter((target) => target.scope === "global")
          .flatMap((target) => [target.path, target.canonicalPath])
          .map((targetPath) => path.resolve(targetPath))
          .find((targetPath) =>
            getSkillStorageRoots().some((root) => isPathInside(root, targetPath)),
          )
        const canonicalDir = masterTarget ?? path.join(CANONICAL_SKILLS_DIR, folderName)
        if (pathsEqual(skillPath, canonicalDir)) {
          throw new Error("通用 Skill 母本不能作为普通 Agent 关闭")
        }
        if (!(await dirExists(canonicalDir)) && await dirExists(skillPath)) {
          await fs.mkdir(CANONICAL_SKILLS_DIR, { recursive: true })
          try {
            await fs.cp(skillPath, canonicalDir, { recursive: true })
          } catch (error) {
            // canonicalDir 是本次新建的未完成副本，原 Agent 副本仍保持不动。
            await fs.rm(canonicalDir, { recursive: true, force: true }).catch(() => {})
            throw error
          }
        }
        const stat = await fs.lstat(skillPath)
        if (stat.isSymbolicLink()) {
          await fs.unlink(skillPath)
          continue
        }
        if (!stat.isDirectory()) {
          throw new Error("Agent 适配位置不是 Skill 目录")
        }

        let hasContentDifference = true
        try {
          hasContentDifference = (await compareSkillContents(canonicalDir, skillPath)).length > 0
        } catch {
          // 比对失败时优先保留副本，避免关闭开关造成不可恢复的数据丢失。
        }
        if (hasContentDifference) {
          preservedCopyPaths.push(await detachAgentCopy(folderName, agent.name, skillPath))
          continue
        }

        preservedCopyPaths.push(await moveAgentCopyToBackup(folderName, agent.name, skillPath))
      }
      return { backupPath: null, preservedCopyPaths }
    } catch (err) {
      throw new Error(`Failed to remove: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  ipcMain.handle(
    "skills:add-to-agent",
    async (_event, skillName: string, canonicalPath: string, agentName: string) => {
      assertSkillStorageReady()
      const agent = agentRegistry[agentName]
      if (!agent) throw new Error(`Unknown agent: ${agentName}`)

      const resolvedCanonical = path.resolve(canonicalPath)
      // The renderer passes the listed skill path, which may be a junction
      // inside an agent directory pointing at a store elsewhere (e.g. an old
      // skill-manager/shared dir). Validate the link path against the
      // allowlist, then resolve to the real directory so the copy below deals
      // with a plain directory instead of a junction.
      const sourceDir = await fs.realpath(resolvedCanonical).catch(() => resolvedCanonical)
      if (
        !isSkillPathAllowed(resolvedCanonical) ||
        !(await fileExists(path.join(sourceDir, "SKILL.md")))
      ) {
        throw new Error("Access denied: source is not a readable local skill")
      }

      const folderName = getSkillFolderName(sourceDir, skillName)
      ensureStores()
      if (await restoreDetachedAgentCopy(folderName, agent)) {
        activityStore.add("skill", `将 ${skillName} 适配到 ${agent.displayName}`)
        return { restoredDetachedCopy: true }
      }

      const result = await installSkillToAgent(sourceDir, skillName, agent)
      if (!result.success) {
        throw new Error(result.error || "Failed to add skill to target agent")
      }
      activityStore.add("skill", `将 ${skillName} 适配到 ${agent.displayName}`)
    },
  )

  ipcMain.handle(
    "skills:sync-agent-copy-to-master",
    async (_event, skillName: string, masterPath: string, agentName: string, agentPath: string) => {
      assertSkillStorageReady()
      const agent = agentRegistry[agentName]
      if (!agent) {
        throw new Error(`Unknown agent: ${agentName}`)
      }
      const resolvedAgentPath = path.resolve(agentPath)
      if (
        !isSkillPathAllowed(resolvedAgentPath) ||
        !(await fileExists(path.join(resolvedAgentPath, "SKILL.md")))
      ) {
        throw new Error("独立副本路径无效或不在已授权的扫描目录中")
      }
      const resolvedMasterPath = path.resolve(masterPath)
      if (
        !getSkillStorageRoots().some((root) => isPathInside(root, resolvedMasterPath)) ||
        !(await fileExists(path.join(resolvedMasterPath, "SKILL.md")))
      ) {
        throw new Error("母版路径无效或不在通用 Skill 目录中")
      }
      const parsedMaster = await parseSkillMd(path.join(resolvedMasterPath, "SKILL.md"))
      if ((parsedMaster?.name || path.basename(resolvedMasterPath)).trim().toLowerCase() !== skillName.trim().toLowerCase()) {
        throw new Error("母版名称与待同步 Skill 不一致")
      }
      const versionWarnings: string[] = []
      try {
        await saveSkillVersion(resolvedMasterPath, skillName, "initial")
      } catch (error) {
        versionWarnings.push("同步前版本未保存")
        console.warn("Failed to save skill version before sync:", error)
      }
      const result = await syncAgentCopyToMaster({
        skillName,
        agentName: agent.name,
        masterPath: resolvedMasterPath,
        agentPath: resolvedAgentPath,
        backupRoot: SKILLBOX_BACKUPS_DIR,
      })
      try {
        await saveSkillVersion(resolvedMasterPath, skillName, "edit")
      } catch (error) {
        versionWarnings.push("同步后版本未保存")
        console.warn("Failed to save skill version after sync:", error)
      }
      return { ...result, warning: versionWarnings.join("；") || undefined }
    },
  )

  // ---------------------------------------------------------------------
  // MCP library
  // ---------------------------------------------------------------------

  const broadcastMcpUpdated = async (): Promise<void> => {
    const library = await scanMcpLibrary()
    noteSkillboxMcpWrite(library)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("mcp:updated", library)
      }
    }
  }

  ipcMain.handle("mcp:list-library", async () => {
    return scanMcpLibrary()
  })

  ipcMain.handle(
    "mcp:set-connection",
    async (
      _event,
      serverName: string,
      agentId: string,
      enable: boolean,
      sourceAgentId?: string,
    ) => {
      const result = await setMcpConnection(serverName, agentId, enable, sourceAgentId)
      if (result.ok || result.written.length > 0) {
        ensureStores()
        const label = mcpAgentRegistry.find((a) => a.id === agentId)?.displayName ?? agentId
        activityStore.add("mcp", enable ? `将 ${serverName} 接入 ${label}` : `从 ${label} 断开 ${serverName}`)
        await broadcastMcpUpdated()
      }
      return result
    },
  )

  ipcMain.handle(
    "mcp:sync-server",
    async (_event, serverName: string, sourceAgentId: string, targetAgentIds: string[]) => {
      const result = await syncMcpServer(serverName, sourceAgentId, targetAgentIds)
      if (result.ok || result.written.length > 0) {
        ensureStores()
        activityStore.add(
          "mcp",
          result.ok
            ? `${serverName} 的 MCP 配置已同步到 ${result.written.length} 个 agent`
            : `${serverName} 的 MCP 配置部分写入（${result.written.length} 个 agent）：${result.error ?? "仍有目标未完成"}`,
        )
        await broadcastMcpUpdated()
      }
      return result
    },
  )

  ipcMain.handle(
    "mcp:add-server",
    async (_event, input: McpServerInput, agentIds: string[]) => {
      const result = await addMcpServer(input, agentIds)
      if (result.ok || result.written.length > 0) {
        ensureStores()
        activityStore.add("mcp", `新增 MCP server: ${input.name} · 写入 ${result.written.length} 个 agent`)
        await broadcastMcpUpdated()
      }
      return result
    },
  )

  ipcMain.handle("mcp:remove-server", async (_event, serverName: string) => {
    const result = await removeMcpServer(serverName)
    if (result.ok || result.written.length > 0) {
      ensureStores()
      activityStore.add("mcp", `移除 MCP server: ${serverName}`)
      await broadcastMcpUpdated()
    }
    return result
  })

  ipcMain.handle("mcp:open-config", async (_event, configPath: string) => {
    return openMcpConfig(configPath)
  })

  ipcMain.handle("activity:list", (_event, limit?: number) => {
    ensureStores()
    return activityStore.list(typeof limit === "number" ? limit : 20)
  })
}

// Export for use by file-watcher and main process
export { listInstalledSkills, listInstalledSkillsInternal, rescanAndCache, rescanSingleSkill, detectAgents }
