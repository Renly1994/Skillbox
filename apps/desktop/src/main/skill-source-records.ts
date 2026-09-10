import fs from "node:fs/promises"
import path from "node:path"

interface SourceRecord { source: string; sourceType: string }

/** 每次列表读取共享缓存；只查询技能所属目录的安装记录。 */
export function createSkillSourceResolver() {
  const cache = new Map<string, Promise<Record<string, SourceRecord>>>()
  function read(file: string) {
    if (!cache.has(file)) cache.set(file, fs.readFile(file, "utf-8").then((raw) => {
      const data = JSON.parse(raw.replace(/^\uFEFF/, ""))
      return data && typeof data.skills === "object" && data.skills !== null ? data.skills : {}
    }).catch(() => ({})))
    return cache.get(file)!
  }
  return async (skill: { name: string; path: string; canonicalPath: string }): Promise<SourceRecord | undefined> => {
    for (const location of new Set([skill.canonicalPath, skill.path])) {
      let directory = path.dirname(location)
      const roots = new Set([directory])
      while (path.dirname(directory) !== directory) {
        if (path.basename(directory) === "skills") {
          const parent = path.dirname(directory)
          roots.add(parent)
          if (path.basename(parent).startsWith(".")) roots.add(path.dirname(parent))
          break
        }
        directory = path.dirname(directory)
      }
      for (const root of roots) {
        for (const filename of ["skills-lock.json", ".skill-lock.json"]) {
          const records = await read(path.join(root, filename))
          const record = records[path.basename(location)] ?? records[skill.name]
          if (record && typeof record.source === "string" && typeof record.sourceType === "string") {
            return { source: record.source, sourceType: record.sourceType }
          }
        }
      }
    }
  }
}
