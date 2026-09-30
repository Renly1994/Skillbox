export type SkillSourceKind = "github" | "local"

export function isSourceKindValid(kind: SkillSourceKind, value: string): boolean {
  const source = value.trim()
  if (kind === "local") {
    return /^(?:\.\.?\/|\/|~\/|[a-zA-Z]:[\\/]|\\\\)/.test(source)
  }
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(source)) return true
  if (!/^(?:https:\/\/)?github\.com\//.test(source)) return false
  try {
    const url = new URL(source.startsWith("https://") ? source : `https://${source}`)
    return url.hostname === "github.com" && url.pathname.split("/").filter(Boolean).length >= 2
  } catch {
    return false
  }
}

export function sourceKindForSkill(skill: InstalledSkill): SkillSourceKind {
  return skill.sourceType === "local" ? "local" : "github"
}

export function changedSourceSkills(
  skills: InstalledSkill[],
  drafts: Record<string, string>,
): InstalledSkill[] {
  return skills.filter((skill) => {
    const draft = drafts[skill.canonicalPath]?.trim()
    return Boolean(draft && (!skill.hasLinkedSource || draft !== skill.source))
  })
}
