import fs from "node:fs/promises"
import path from "node:path"

const IGNORED_DIRECTORIES = new Set([".git", "node_modules"])

interface RecordedSkillTimestamps {
  installedAt?: string
  updatedAt?: string
}

function validTime(value?: string): number {
  const timestamp = Date.parse(value || "")
  return Number.isFinite(timestamp) ? timestamp : 0
}

async function latestContentModification(rootPath: string): Promise<number> {
  let latest = 0

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) return

      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
        return
      }

      const stat = await fs.lstat(entryPath)
      latest = Math.max(latest, stat.mtimeMs)
    }))
  }

  await walk(rootPath)
  return latest
}

/**
 * 最近添加以 Skillbox 安装记录优先，外部 Skill 回退到目录创建时间。
 * 最近更新取安装记录和目录内容修改时间中的较新值。
 */
export async function resolveSkillTimestamps(
  skillPath: string,
  recorded: RecordedSkillTimestamps = {},
): Promise<RecordedSkillTimestamps> {
  try {
    const [rootStat, contentModifiedAt] = await Promise.all([
      fs.stat(skillPath),
      latestContentModification(skillPath),
    ])
    const recordedInstalledAt = validTime(recorded.installedAt)
    const recordedUpdatedAt = validTime(recorded.updatedAt)
    const createdAt = rootStat.birthtimeMs > 0 ? rootStat.birthtimeMs : rootStat.ctimeMs
    const updatedAt = Math.max(recordedUpdatedAt, contentModifiedAt || rootStat.mtimeMs)

    return {
      installedAt: new Date(recordedInstalledAt || createdAt).toISOString(),
      updatedAt: new Date(updatedAt).toISOString(),
    }
  } catch {
    return {
      installedAt: validTime(recorded.installedAt) ? recorded.installedAt : undefined,
      updatedAt: validTime(recorded.updatedAt) ? recorded.updatedAt : undefined,
    }
  }
}
