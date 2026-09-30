import crypto from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import AdmZip from "adm-zip"
import { createSkillContentFingerprint } from "./version-sync"

export type SkillVersionReason = "initial" | "edit" | "update" | "restore" | "manual"

export interface SkillVersionFile {
  relativePath: string
  hash: string
  size: number
}

export interface SkillVersionChange {
  relativePath: string
  kind: "added" | "modified" | "removed"
}

export interface SkillVersionEntry {
  id: string
  number: number
  createdAt: string
  reason: SkillVersionReason
  fingerprint: string
  archiveSize: number
  fileCount: number
  files: SkillVersionFile[]
  changes: SkillVersionChange[]
}

interface StoredSkillVersionEntry extends Omit<SkillVersionEntry, "changes"> {}

interface SkillVersionManifest {
  version: 1
  skillName: string
  skillPath: string
  nextVersionNumber?: number
  versions: StoredSkillVersionEntry[]
}

export interface CreateSkillVersionResult {
  created: boolean
  version: SkillVersionEntry
}

export interface SkillVersionStorageInfo {
  path: string
  versionCount: number
  sizeBytes: number
  maxVersionsPerSkill: number
}

const STORE_MARKER = ".skillbox-version-store"
const STORE_VERSION = 1
const IGNORED_DIRECTORIES = new Set([".git", "node_modules"])
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"])

function safeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "skill"
}

function pathKey(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function skillStoreKey(skillPath: string): string {
  const digest = crypto.createHash("sha256").update(pathKey(skillPath)).digest("hex").slice(0, 12)
  return `${safeSegment(path.basename(skillPath))}-${digest}`
}

function normalizeArchivePath(value: string): string {
  return value.split(path.sep).join("/")
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target)
    return true
  } catch {
    return false
  }
}

async function renameOrCopyFile(source: string, destination: string, overwrite = false): Promise<void> {
  try {
    await fs.rename(source, destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
    await fs.copyFile(source, destination, overwrite ? 0 : constants.COPYFILE_EXCL)
    await fs.rm(source, { force: true })
  }
}

async function listFiles(rootPath: string): Promise<SkillVersionFile[]> {
  const files: SkillVersionFile[] = []

  async function walk(directory: string, relativeDirectory = ""): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue
      if (entry.isFile() && IGNORED_FILES.has(entry.name)) continue
      if (!entry.isDirectory() && !entry.isFile()) continue

      const absolutePath = path.join(directory, entry.name)
      const relativePath = normalizeArchivePath(
        relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name,
      )
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath)
        continue
      }

      const content = await fs.readFile(absolutePath)
      files.push({
        relativePath,
        hash: crypto.createHash("sha256").update(content).digest("hex"),
        size: content.byteLength,
      })
    }
  }

  await walk(rootPath)
  return files
}

function compareFiles(
  current: SkillVersionFile[],
  previous: SkillVersionFile[] | undefined,
): SkillVersionChange[] {
  if (!previous) return current.map((file) => ({ relativePath: file.relativePath, kind: "added" }))
  const currentMap = new Map(current.map((file) => [file.relativePath, file.hash]))
  const previousMap = new Map(previous.map((file) => [file.relativePath, file.hash]))
  return Array.from(new Set([...currentMap.keys(), ...previousMap.keys()]))
    .sort((a, b) => a.localeCompare(b))
    .flatMap((relativePath): SkillVersionChange[] => {
      const currentHash = currentMap.get(relativePath)
      const previousHash = previousMap.get(relativePath)
      if (currentHash === previousHash) return []
      if (previousHash === undefined) return [{ relativePath, kind: "added" }]
      if (currentHash === undefined) return [{ relativePath, kind: "removed" }]
      return [{ relativePath, kind: "modified" }]
    })
}

async function directorySize(rootPath: string): Promise<number> {
  if (!(await pathExists(rootPath))) return 0
  let total = 0
  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(entryPath)
      else if (entry.isFile()) total += (await fs.stat(entryPath)).size
    }))
  }
  await walk(rootPath)
  return total
}

export class SkillVersionStore {
  constructor(
    readonly rootPath: string,
    readonly maxVersionsPerSkill = 20,
  ) {}

  private skillDirectory(skillPath: string): string {
    return path.join(this.rootPath, skillStoreKey(skillPath))
  }

  private manifestPath(skillPath: string): string {
    return path.join(this.skillDirectory(skillPath), "history.json")
  }

  private async ensureRoot(): Promise<void> {
    await fs.mkdir(this.rootPath, { recursive: true })
    await fs.writeFile(
      path.join(this.rootPath, STORE_MARKER),
      JSON.stringify({ version: STORE_VERSION }),
      "utf-8",
    )
  }

  private async readManifest(skillPath: string, skillName: string): Promise<SkillVersionManifest> {
    try {
      const raw = await fs.readFile(this.manifestPath(skillPath), "utf-8")
      const parsed = JSON.parse(raw) as SkillVersionManifest
      if (parsed.version === STORE_VERSION && Array.isArray(parsed.versions)) {
        parsed.versions.forEach((version, index) => {
          version.number ||= parsed.versions.length - index
        })
        parsed.nextVersionNumber ??= Math.max(0, ...parsed.versions.map((version) => version.number)) + 1
        return parsed
      }
      throw new Error("版本历史索引格式无效，请检查版本仓库")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    return {
      version: STORE_VERSION,
      skillName,
      skillPath: path.resolve(skillPath),
      nextVersionNumber: 1,
      versions: [],
    }
  }

  private async writeManifest(manifest: SkillVersionManifest): Promise<void> {
    const directory = this.skillDirectory(manifest.skillPath)
    await fs.mkdir(directory, { recursive: true })
    const destination = path.join(directory, "history.json")
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), "utf-8")
      await renameOrCopyFile(temporary, destination, true)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }

  async create(
    skillPath: string,
    skillName: string,
    reason: SkillVersionReason,
  ): Promise<CreateSkillVersionResult> {
    const resolvedSkillPath = path.resolve(skillPath)
    if (!(await pathExists(path.join(resolvedSkillPath, "SKILL.md")))) {
      throw new Error("Skill 缺少 SKILL.md，无法保存版本")
    }

    await this.ensureRoot()
    const [fingerprint, files, manifest] = await Promise.all([
      createSkillContentFingerprint(resolvedSkillPath),
      listFiles(resolvedSkillPath),
      this.readManifest(resolvedSkillPath, skillName),
    ])
    const latest = manifest.versions[0]
    if (latest?.fingerprint === fingerprint) {
      return {
        created: false,
        version: { ...latest, changes: compareFiles(latest.files, manifest.versions[1]?.files) },
      }
    }

    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`
    const directory = this.skillDirectory(resolvedSkillPath)
    const archivePath = path.join(directory, `${id}.zip`)
    const temporaryArchivePath = `${archivePath}.tmp`
    await fs.mkdir(directory, { recursive: true })

    const archive = new AdmZip()
    for (const file of files) {
      const absolutePath = path.join(resolvedSkillPath, ...file.relativePath.split("/"))
      archive.addLocalFile(absolutePath, path.posix.dirname(file.relativePath) === "." ? "" : path.posix.dirname(file.relativePath))
    }
    try {
      archive.writeZip(temporaryArchivePath)
      await renameOrCopyFile(temporaryArchivePath, archivePath)
    } catch (error) {
      await fs.rm(temporaryArchivePath, { force: true }).catch(() => {})
      throw error
    }

    const stored: StoredSkillVersionEntry = {
      id,
      number: manifest.nextVersionNumber ?? Math.max(0, ...manifest.versions.map((version) => version.number || 0)) + 1,
      createdAt: new Date().toISOString(),
      reason,
      fingerprint,
      archiveSize: (await fs.stat(archivePath)).size,
      fileCount: files.length,
      files,
    }
    manifest.skillName = skillName
    manifest.skillPath = resolvedSkillPath
    manifest.nextVersionNumber = stored.number + 1
    manifest.versions.unshift(stored)

    const removed = manifest.versions.splice(Math.max(1, this.maxVersionsPerSkill))
    try {
      await this.writeManifest(manifest)
    } catch (error) {
      await fs.rm(archivePath, { force: true }).catch(() => {})
      throw error
    }
    await Promise.all(removed.map((version) =>
      fs.rm(path.join(directory, `${version.id}.zip`), { force: true }).catch(() => {}),
    ))

    return {
      created: true,
      version: { ...stored, changes: compareFiles(files, manifest.versions[1]?.files) },
    }
  }

  async list(skillPath: string, skillName: string): Promise<SkillVersionEntry[]> {
    const manifest = await this.readManifest(path.resolve(skillPath), skillName)
    return manifest.versions.map((version, index) => ({
      ...version,
      changes: compareFiles(version.files, manifest.versions[index + 1]?.files),
    }))
  }

  async prune(): Promise<void> {
    if (!(await pathExists(this.rootPath))) return
    const entries = await fs.readdir(this.rootPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const directory = path.join(this.rootPath, entry.name)
      try {
        const manifest = JSON.parse(
          await fs.readFile(path.join(directory, "history.json"), "utf-8"),
        ) as SkillVersionManifest
        const removed = manifest.versions.splice(Math.max(1, this.maxVersionsPerSkill))
        if (removed.length === 0) continue
        await this.writeManifest(manifest)
        await Promise.all(removed.map((version) =>
          fs.rm(path.join(directory, `${version.id}.zip`), { force: true }).catch(() => {}),
        ))
      } catch {
        // 忽略非版本目录或损坏的历史索引，避免影响其他 Skill。
      }
    }
  }

  async readFile(
    skillPath: string,
    skillName: string,
    versionId: string,
    relativePath = "SKILL.md",
  ): Promise<string | null> {
    const manifest = await this.readManifest(path.resolve(skillPath), skillName)
    if (!manifest.versions.some((version) => version.id === versionId)) {
      throw new Error("找不到这个历史版本")
    }
    const archive = new AdmZip(path.join(this.skillDirectory(skillPath), `${versionId}.zip`))
    const entry = archive.getEntry(normalizeArchivePath(relativePath))
    return entry ? entry.getData().toString("utf-8") : null
  }

  async restore(skillPath: string, skillName: string, versionId: string): Promise<void> {
    const resolvedSkillPath = path.resolve(skillPath)
    const manifest = await this.readManifest(resolvedSkillPath, skillName)
    if (!manifest.versions.some((version) => version.id === versionId)) {
      throw new Error("找不到这个历史版本")
    }

    const parent = path.dirname(resolvedSkillPath)
    const stagingPath = path.join(parent, `.skillbox-restore-${crypto.randomUUID()}`)
    const rollbackPath = path.join(parent, `.skillbox-rollback-${crypto.randomUUID()}`)
    const archive = new AdmZip(path.join(this.skillDirectory(resolvedSkillPath), `${versionId}.zip`))
    let originalMoved = false

    try {
      await fs.mkdir(stagingPath, { recursive: true })
      archive.extractAllTo(stagingPath, true)
      if (!(await pathExists(path.join(stagingPath, "SKILL.md")))) {
        throw new Error("历史版本缺少 SKILL.md，无法恢复")
      }
      await fs.rename(resolvedSkillPath, rollbackPath)
      originalMoved = true
      await fs.rename(stagingPath, resolvedSkillPath)
      originalMoved = false
      await fs.rm(rollbackPath, { recursive: true, force: true }).catch(() => {})
    } catch (error) {
      await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {})
      if (originalMoved) {
        await fs.rm(resolvedSkillPath, { recursive: true, force: true }).catch(() => {})
        await fs.rename(rollbackPath, resolvedSkillPath).catch(() => {})
      }
      throw error
    }
  }

  async info(): Promise<SkillVersionStorageInfo> {
    let versionCount = 0
    if (await pathExists(this.rootPath)) {
      const entries = await fs.readdir(this.rootPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          const manifest = JSON.parse(
            await fs.readFile(path.join(this.rootPath, entry.name, "history.json"), "utf-8"),
          ) as SkillVersionManifest
          versionCount += manifest.versions?.length ?? 0
        } catch {
          // 忽略非版本目录。
        }
      }
    }
    return {
      path: this.rootPath,
      versionCount,
      sizeBytes: await directorySize(this.rootPath),
      maxVersionsPerSkill: this.maxVersionsPerSkill,
    }
  }
}

/** 迁移 Skill 实体位置前，先为旧路径的版本记录准备新索引。 */
export async function prepareSkillVersionPathMigration(
  storeRoot: string,
  oldSkillRoot: string,
  newSkillRoot: string,
  legacySkillRoots: string[] = [],
): Promise<{ commit: () => Promise<void>; rollback: () => Promise<void> }> {
  const prepared: Array<{ oldPath: string; newPath: string }> = []
  const sourceRoots = Array.from(new Set([oldSkillRoot, ...legacySkillRoots].map((root) => path.resolve(root))))
    .sort((left, right) => right.length - left.length)
  const rootEntries = await fs.readdir(storeRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  try {
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue
      const oldPath = path.join(storeRoot, entry.name)
      let manifest: SkillVersionManifest
      try {
        manifest = JSON.parse(await fs.readFile(path.join(oldPath, "history.json"), "utf-8")) as SkillVersionManifest
      } catch {
        continue
      }
      const oldPathResolved = path.resolve(manifest.skillPath)
      const sourceRoot = sourceRoots.find((root) => {
        const relative = path.relative(root, oldPathResolved)
        return relative === "" || (
          relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative)
        )
      })
      if (!sourceRoot) continue
      const newSkillPath = path.join(newSkillRoot, path.relative(sourceRoot, oldPathResolved))
      const newPath = path.join(storeRoot, skillStoreKey(newSkillPath))
      if (await pathExists(newPath)) throw new Error(`新目录已有同名 Skill 版本记录：${manifest.skillName}`)
      const staging = path.join(storeRoot, `.skillbox-version-path-${crypto.randomUUID()}`)
      try {
        await fs.cp(oldPath, staging, { recursive: true, force: false, errorOnExist: true })
        await fs.writeFile(
          path.join(staging, "history.json"),
          JSON.stringify({ ...manifest, skillPath: newSkillPath }, null, 2),
          "utf-8",
        )
        await fs.rename(staging, newPath)
      } catch (error) {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
        throw error
      }
      prepared.push({ oldPath, newPath })
    }
  } catch (error) {
    await Promise.all(prepared.map(({ newPath }) => fs.rm(newPath, { recursive: true, force: true })))
    throw error
  }
  return {
    commit: async () => {
      await Promise.all(prepared.map(({ oldPath }) => fs.rm(oldPath, { recursive: true, force: true })))
    },
    rollback: async () => {
      await Promise.all(prepared.map(({ newPath }) => fs.rm(newPath, { recursive: true, force: true })))
    },
  }
}

export async function migrateSkillVersionStore(oldRoot: string, newRoot: string): Promise<void> {
  const previous = path.resolve(oldRoot)
  const next = path.resolve(newRoot)
  if (pathKey(previous) === pathKey(next)) return
  const nextInsidePrevious = path.relative(previous, next)
  const previousInsideNext = path.relative(next, previous)
  if (
    (nextInsidePrevious && !nextInsidePrevious.startsWith("..") && !path.isAbsolute(nextInsidePrevious)) ||
    (previousInsideNext && !previousInsideNext.startsWith("..") && !path.isAbsolute(previousInsideNext))
  ) {
    throw new Error("新旧版本仓库不能互相包含，请选择其他文件夹")
  }
  if (!(await pathExists(previous))) {
    if (await pathExists(next)) {
      const entries = await fs.readdir(next)
      if (entries.length > 0 && !(entries.length === 1 && entries[0] === STORE_MARKER)) {
        throw new Error("新储存目录不是空目录，请选择一个空文件夹")
      }
    }
    await fs.mkdir(next, { recursive: true })
    await fs.writeFile(path.join(next, STORE_MARKER), JSON.stringify({ version: STORE_VERSION }), "utf-8")
    return
  }

  const marker = path.join(previous, STORE_MARKER)
  if (!(await pathExists(marker))) {
    throw new Error("旧目录不是 Skillbox 版本仓库，已停止迁移")
  }
  if (await pathExists(next)) {
    const entries = await fs.readdir(next)
    if (entries.length > 0 && !(entries.length === 1 && entries[0] === STORE_MARKER)) {
      throw new Error("新储存目录不是空目录，请选择一个空文件夹")
    }
  }

  await fs.mkdir(path.dirname(next), { recursive: true })
  const staging = path.join(path.dirname(next), `.skillbox-version-migrate-${crypto.randomUUID()}`)
  try {
    await fs.cp(previous, staging, { recursive: true, force: false, errorOnExist: true })
    if (await pathExists(next)) await fs.rm(next, { recursive: true, force: true })
    try {
      await fs.rename(staging, next)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
      try {
        await fs.cp(staging, next, { recursive: true, force: false, errorOnExist: true })
      } catch (copyError) {
        await fs.rm(next, { recursive: true, force: true }).catch(() => {})
        throw copyError
      }
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  try {
    await fs.rm(previous, { recursive: true, force: true })
  } catch (error) {
    throw error
  }
}

export async function migrateDefaultSkillVersionStore(oldRoot: string, newRoot: string): Promise<string> {
  const previous = path.resolve(oldRoot)
  const next = path.resolve(newRoot)
  if (pathKey(previous) === pathKey(next) || !(await pathExists(previous))) return next
  await migrateSkillVersionStore(previous, next)
  return next
}
