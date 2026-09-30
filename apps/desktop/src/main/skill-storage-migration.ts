import crypto from "node:crypto"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

export interface SkillStorageMigrationResult {
  path: string
  compatibilityPath: string
  previousPath: string
  retainedOldPath?: string
}

interface SkillLink {
  relativePath: string
  target: string
  isDirectory: boolean
}

function pathKey(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function overlaps(left: string, right: string): boolean {
  const a = pathKey(left)
  const b = pathKey(right)
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)
}

async function entryExists(value: string): Promise<boolean> {
  return fs.lstat(value).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false
    throw error
  })
}

async function snapshot(root: string, includeLinkTargets = true): Promise<string[]> {
  const entries: string[] = []
  async function walk(directory: string, relative = ""): Promise<void> {
    const children = await fs.readdir(directory, { withFileTypes: true })
    children.sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      const name = relative ? path.join(relative, child.name) : child.name
      const fullPath = path.join(directory, child.name)
      const stat = await fs.lstat(fullPath)
      if (stat.isSymbolicLink()) {
        entries.push(includeLinkTargets ? `L:${name}:${await fs.readlink(fullPath)}` : `L:${name}`)
      } else if (stat.isDirectory()) {
        entries.push(`D:${name}`)
        await walk(fullPath, name)
      } else if (stat.isFile()) {
        const digest = crypto.createHash("sha256")
        for await (const chunk of createReadStream(fullPath)) digest.update(chunk)
        const hash = digest.digest("hex")
        entries.push(`F:${name}:${hash}`)
      } else {
        throw new Error(`Skill 目录包含不支持迁移的文件：${fullPath}`)
      }
    }
  }
  await walk(root)
  return entries
}

async function listLinks(root: string): Promise<SkillLink[]> {
  const links: SkillLink[] = []
  async function walk(directory: string, relative = ""): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = relative ? path.join(relative, entry.name) : entry.name
      const fullPath = path.join(directory, entry.name)
      const stat = await fs.lstat(fullPath)
      if (stat.isSymbolicLink()) {
        const target = await fs.realpath(fullPath).catch(() => {
          throw new Error(`Skill 目录包含失效链接：${fullPath}`)
        })
        links.push({ relativePath: name, target, isDirectory: (await fs.stat(fullPath)).isDirectory() })
      } else if (stat.isDirectory()) {
        await walk(fullPath, name)
      }
    }
  }
  await walk(root)
  return links
}

async function copyTree(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination)
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    const stat = await fs.lstat(from)
    if (stat.isSymbolicLink()) {
      const target = await fs.realpath(from)
      const isDirectory = (await fs.stat(from)).isDirectory()
      await fs.symlink(target, to, process.platform === "win32" && isDirectory ? "junction" : undefined)
    } else if (stat.isDirectory()) {
      await copyTree(from, to)
    } else if (stat.isFile()) {
      await fs.copyFile(from, to)
      await fs.chmod(to, stat.mode)
      await fs.utimes(to, stat.atime, stat.mtime)
    } else {
      throw new Error(`Skill 目录包含不支持迁移的文件：${from}`)
    }
  }
  const sourceStat = await fs.stat(source)
  await fs.chmod(destination, sourceStat.mode)
  await fs.utimes(destination, sourceStat.atime, sourceStat.mtime)
}

/** 实体文件迁入新磁盘，标准目录只保留一个兼容入口。 */
export async function migrateSkillStorage(
  canonicalRoot: string,
  destinationRoot: string,
  options: { removePreviousTarget?: boolean } = {},
): Promise<SkillStorageMigrationResult> {
  const canonical = path.resolve(canonicalRoot)
  const destination = path.resolve(destinationRoot)
  if (!(await entryExists(canonical))) await fs.mkdir(canonical, { recursive: true })
  const previous = await fs.realpath(canonical)
  const canonicalStat = await fs.lstat(canonical)
  if (!canonicalStat.isDirectory() && !canonicalStat.isSymbolicLink()) {
    throw new Error("当前通用 Skill 路径不是目录")
  }
  if (pathKey(previous) === pathKey(destination)) {
    return { path: previous, compatibilityPath: canonical, previousPath: previous }
  }
  if (overlaps(previous, destination) || overlaps(canonical, destination)) {
    throw new Error("新旧 Skill 目录不能互相包含，请选择其他位置")
  }

  await fs.mkdir(path.dirname(destination), { recursive: true })
  const physicalDestination = path.join(await fs.realpath(path.dirname(destination)), path.basename(destination))
  if (overlaps(previous, physicalDestination) || overlaps(canonical, physicalDestination)) {
    throw new Error("新旧 Skill 目录不能互相包含，请选择其他位置")
  }

  if (await entryExists(destination)) {
    const stat = await fs.lstat(destination)
    if (!stat.isDirectory() || (await fs.readdir(destination)).length > 0) {
      throw new Error("新存储位置已包含文件，请选择空目录")
    }
  }

  const staging = path.join(path.dirname(destination), `.skillbox-skills-migrate-${crypto.randomUUID()}`)
  const backup = path.join(path.dirname(canonical), `.skillbox-skills-backup-${crypto.randomUUID()}`)
  const beforeShape = await snapshot(previous, false)
  const links = await listLinks(previous)
  let promoted = false
  let oldEntryMoved = false
  try {
    await copyTree(previous, staging)
    if (JSON.stringify(await snapshot(staging, false)) !== JSON.stringify(beforeShape) ||
        JSON.stringify(await snapshot(previous, false)) !== JSON.stringify(beforeShape) ||
        JSON.stringify(await listLinks(previous)) !== JSON.stringify(links)) {
      throw new Error("复制后文件发生变化，已停止迁移，请重试")
    }
    if (await entryExists(destination)) await fs.rmdir(destination)
    await fs.rename(staging, destination)
    promoted = true

    for (const link of links) {
      const linkPath = path.join(destination, link.relativePath)
      const relative = path.relative(previous, link.target)
      const insideSource = !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)
      const target = insideSource ? path.join(destination, relative) : link.target
      await fs.unlink(linkPath)
      await fs.symlink(target, linkPath, process.platform === "win32" && link.isDirectory ? "junction" : undefined)
      if (pathKey(await fs.realpath(linkPath)) !== pathKey(target)) {
        throw new Error(`迁移后链接无效：${link.relativePath}`)
      }
    }

    await fs.rename(canonical, backup)
    oldEntryMoved = true
    await fs.symlink(destination, canonical, process.platform === "win32" ? "junction" : "dir")
    if (pathKey(await fs.realpath(canonical)) !== pathKey(await fs.realpath(destination)) ||
        JSON.stringify(await snapshot(canonical, false)) !== JSON.stringify(beforeShape) ||
        JSON.stringify(await snapshot(canonical, false)) !== JSON.stringify(await snapshot(backup, false))) {
      throw new Error("新目录校验失败，已恢复原目录")
    }
  } catch (error) {
    if (oldEntryMoved && await entryExists(canonical)) {
      const stat = await fs.lstat(canonical)
      if (stat.isSymbolicLink()) await fs.unlink(canonical).catch(() => {})
    }
    if (oldEntryMoved) {
      try {
        await fs.rename(backup, canonical)
      } catch (restoreError) {
        throw new Error(
          `迁移失败，原目录恢复失败。原文件保留在 ${backup}，新副本保留在 ${destination}。${String(restoreError)}`,
          { cause: error },
        )
      }
    }
    if (promoted) await fs.rm(destination, { recursive: true, force: true }).catch(() => {})
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  const oldPath = canonicalStat.isSymbolicLink() ? previous : backup
  let retainedOldPath: string | undefined
  if (canonicalStat.isSymbolicLink()) {
    try {
      await fs.unlink(backup)
    } catch {
      retainedOldPath = backup
    }
  }
  try {
    if (canonicalStat.isSymbolicLink() && (!options.removePreviousTarget || retainedOldPath)) {
      retainedOldPath = oldPath
    } else {
      await fs.rm(oldPath, { recursive: true, force: true })
    }
  } catch {
    retainedOldPath = oldPath
  }
  return { path: destination, compatibilityPath: canonical, previousPath: previous, retainedOldPath }
}
