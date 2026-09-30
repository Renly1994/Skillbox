import path from "node:path"
import matter from "gray-matter"

interface MarketplaceSkillCandidate {
  name: string
  filePath: string
}

function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._]+/gu, "-")
    .replace(/^-+|-+$/g, "")
}

export function selectMarketplaceSkill<T extends MarketplaceSkillCandidate>(
  discovered: T[],
  sourceDir: string,
  skillId: string,
  allowSingleFallback = false,
): T | null {
  const normalizedId = normalizeSkillName(skillId)
  const pathMatch = discovered.find((skill) => {
    const relativeDirectory = path.relative(sourceDir, path.dirname(skill.filePath))
    return normalizeSkillName(path.basename(relativeDirectory)) === normalizedId
  })
  if (pathMatch) return pathMatch

  const nameMatch = discovered.find(
    (skill) => normalizeSkillName(skill.name) === normalizedId,
  )
  if (nameMatch) return nameMatch

  return allowSingleFallback && discovered.length === 1 ? discovered[0] : null
}

export function requireLinkedSourceSkill<T extends MarketplaceSkillCandidate>(
  discovered: T[],
  sourceDir: string,
  skillId: string,
  skillName: string,
  allowSingleFallback = false,
): T {
  const selected = selectMarketplaceSkill(discovered, sourceDir, skillId, allowSingleFallback)
    ?? selectMarketplaceSkill(discovered, sourceDir, skillName)
  if (!selected) {
    throw new Error(`来源中没有找到“${skillName}”的 SKILL.md，请关联包含此 Skill 的仓库或目录`)
  }
  return selected
}

export function marketplaceSourceKey(
  owner: string,
  repo: string,
  skillId: string,
): string {
  return `${owner}/${repo}/${skillId}`
}

export function isRequestedMarketplaceContent(
  skillId: string,
  relativePath: string,
  content: string,
): boolean {
  if (relativePath !== "SKILL.md") return true
  try {
    const name = matter(content).data.name
    return typeof name === "string" && normalizeSkillName(name) === normalizeSkillName(skillId)
  } catch {
    return false
  }
}
