import fs from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"

export interface CustomSkillLocation {
  skillDir: string
  canonicalPath: string
  scope: "project" | "custom"
  projectName: string | null
  /** 命中探针对应的 agentRegistry key；非探针来源（自定义根/平铺目录）为 null。 */
  agentName: string | null
}

interface ProjectProbe {
  subpath: string
  agentName?: string | null
}

const MAX_CUSTOM_PROJECT_DEPTH = 2
const SKIPPED_PROJECT_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
])

async function hasSkillMd(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(directory, "SKILL.md"))).isFile()
  } catch {
    return false
  }
}

async function readDirectory(directory: string): Promise<Dirent<string>[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

function pathKey(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

/**
 * 扫描用户明确添加的自定义目录。
 *
 * 只支持三种既有布局：目录本身是 Skill、目录下直接放置多个 Skill、
 * 以及目录下两级项目中的标准 Agent Skill 目录。不会读取项目文件，
 * 也不会递归进入 Junction 或符号链接。
 */
export async function findCustomSkillLocations(
  rootPath: string,
  projectProbes: ProjectProbe[],
): Promise<CustomSkillLocation[]> {
  const resolvedRoot = path.resolve(rootPath)
  const results: CustomSkillLocation[] = []
  const seenSkills = new Set<string>()

  async function addSkill(
    skillDir: string,
    scope: "project" | "custom",
    projectName: string | null,
    agentName: string | null = null,
  ): Promise<void> {
    if (!(await hasSkillMd(skillDir))) return

    const canonicalPath = await fs.realpath(skillDir).catch(() => path.resolve(skillDir))
    const key = pathKey(canonicalPath)
    if (seenSkills.has(key)) return
    seenSkills.add(key)
    results.push({ skillDir, canonicalPath, scope, projectName, agentName })
  }

  await addSkill(resolvedRoot, "custom", null)

  const rootEntries = await readDirectory(resolvedRoot)
  if (rootEntries.length === 0) return results

  // 兼容“一个目录直接放多个 Skill”的原有用法。
  for (const entry of rootEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    await addSkill(path.join(resolvedRoot, entry.name), "custom", null)
  }

  const queue: Array<{ directory: string; depth: number }> = [
    { directory: resolvedRoot, depth: 0 },
  ]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break

    const projectName = path.basename(current.directory) || current.directory
    for (const probe of projectProbes) {
      const probeDir = path.join(current.directory, probe.subpath)
      const skillEntries = await readDirectory(probeDir)

      for (const skillEntry of skillEntries) {
        if (!skillEntry.isDirectory() && !skillEntry.isSymbolicLink()) continue
        await addSkill(
          path.join(probeDir, skillEntry.name),
          "project",
          projectName,
          probe.agentName ?? null,
        )
      }
    }

    if (current.depth >= MAX_CUSTOM_PROJECT_DEPTH) continue

    const entries = await readDirectory(current.directory)

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (entry.name.startsWith(".") || SKIPPED_PROJECT_DIRECTORIES.has(entry.name)) continue
      queue.push({
        directory: path.join(current.directory, entry.name),
        depth: current.depth + 1,
      })
    }
  }

  return results
}
