import path from "node:path"
import { isPathInside } from "./skill-removal"

export type SkillScanScope = "global" | "project" | "custom"

/** 范围由扫描到的位置决定；符号链接的实体路径只用于识别同一份 Skill。 */
export function getScannedSkillScope(
  location: { path: string; canonicalPath: string },
  globalRoots: readonly string[],
): SkillScanScope {
  const skillPath = path.resolve(location.path)
  if (globalRoots.some((root) => {
    const resolvedRoot = path.resolve(root)
    return path.relative(resolvedRoot, skillPath) === "" || isPathInside(resolvedRoot, skillPath)
  })) return "global"

  if (skillPath.split(path.sep).some((segment) => segment.startsWith("."))) {
    return "project"
  }
  return "custom"
}
