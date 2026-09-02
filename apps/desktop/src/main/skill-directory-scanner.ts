import fs from "node:fs/promises"
import path from "node:path"

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "__pycache__",
])

export interface SkillDirectory {
  path: string
  canonicalPath: string
  isSymbolicLink: boolean
}

async function hasSkillMd(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(directory, "SKILL.md"))).isFile()
  } catch {
    return false
  }
}

/**
 * 递归发现技能目录；一旦命中 SKILL.md，就不再进入该技能的支持文件目录。
 */
export async function findSkillDirectories(skillsRoot: string): Promise<SkillDirectory[]> {
  const results: SkillDirectory[] = []
  const visited = new Set<string>()

  async function visit(directory: string): Promise<void> {
    let canonicalPath: string
    let isSymbolicLink = false
    try {
      const [stat, realPath] = await Promise.all([
        fs.lstat(directory),
        fs.realpath(directory),
      ])
      if (!stat.isDirectory() && !stat.isSymbolicLink()) return
      canonicalPath = realPath
      isSymbolicLink = stat.isSymbolicLink()
    } catch {
      return
    }

    const key = process.platform === "win32"
      ? canonicalPath.toLowerCase()
      : canonicalPath
    if (visited.has(key)) return
    visited.add(key)

    if (await hasSkillMd(directory)) {
      results.push({ path: directory, canonicalPath, isSymbolicLink })
      return
    }

    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    await Promise.all(
      entries
        .filter((entry) =>
          (entry.isDirectory() || entry.isSymbolicLink()) &&
          !SKIPPED_DIRECTORIES.has(entry.name),
        )
        .map((entry) => visit(path.join(directory, entry.name))),
    )
  }

  let entries
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true })
  } catch {
    return results
  }

  await Promise.all(
    entries
      .filter((entry) =>
        (entry.isDirectory() || entry.isSymbolicLink()) &&
        !SKIPPED_DIRECTORIES.has(entry.name),
      )
      .map((entry) => visit(path.join(skillsRoot, entry.name))),
  )

  return results
}
