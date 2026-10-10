import { categorizeSkill } from "./skill-category"
import { getSkillAgentCoverageNames } from "./skill-agent-bindings"

export interface LibraryFilters {
  category: string
  mismatched: boolean
  uncollected: boolean
  usage: "all" | "low" | "idle"
  usageDays: 30 | 90
  usageMax: number
  excludeFavorites: boolean
  sort: "default" | "name-asc" | "name-desc" | "updated" | "installed" | "coverage" | "favorites" | "heat"
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  category: "", mismatched: false, uncollected: false, sort: "default",
  usage: "all", usageDays: 90, usageMax: 3, excludeFavorites: true,
}

export function getRecordedUsageCount(skill: InstalledSkill, days: 30 | 90): number | null {
  return (days === 90 ? skill.heat?.usageCount90 : skill.heat?.usageCount) ?? null
}

export function getObservedUsageCount(skill: InstalledSkill, days: 30 | 90, now = Date.now()): number | null {
  const heat = skill.heat
  const since = Date.parse(heat?.observedSince || "")
  if (!heat?.coverageComplete || heat.partial || heat.stale || !Number.isFinite(since) || since > now - days * 86_400_000) return null
  return getRecordedUsageCount(skill, days)
}

export function refineLibrarySkills(
  skills: InstalledSkill[],
  filters: LibraryFilters,
  collections: Record<string, string[]>,
  favorites: Set<string>,
  now = Date.now(),
): InstalledSkill[] {
  const collected = new Set(Object.values(collections).flat())
  const result = skills.filter((skill) => {
    if (filters.category && categorizeSkill(skill.name, skill.description).label !== filters.category ||
      filters.mismatched && skill.versionMismatches.length === 0 ||
      filters.uncollected && collected.has(skill.canonicalPath)) return false
    if (filters.usage === "all") return true
    if (filters.excludeFavorites && favorites.has(skill.name)) return false
    const count = filters.usage === "idle" ? getObservedUsageCount(skill, filters.usageDays, now) : getRecordedUsageCount(skill, filters.usageDays)
    if (count === null) return false
    return filters.usage === "idle" ? count === 0 : Number.isSafeInteger(filters.usageMax) && filters.usageMax >= 1 && count >= 1 && count <= filters.usageMax
  })
  const byName = (a: InstalledSkill, b: InstalledSkill) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })
  const timestamp = (value?: string) => Date.parse(value || "") || 0
  switch (filters.sort) {
    case "heat": return result.sort((a, b) => (b.heat?.usageCount ?? -1) - (a.heat?.usageCount ?? -1))
    case "name-asc": return result.sort(byName)
    case "name-desc": return result.sort((a, b) => byName(b, a))
    case "updated": return result.sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt) || byName(a, b))
    case "installed": return result.sort((a, b) => timestamp(b.installedAt) - timestamp(a.installedAt) || byName(a, b))
    case "coverage": {
      const coverage = new Map(result.map((skill) => {
        const agents = getSkillAgentCoverageNames(skill).sort((a, b) => a.localeCompare(b, "zh-CN"))
        return [skill, { count: agents.length, group: agents.join("\0") }]
      }))
      return result.sort((a, b) =>
        coverage.get(b)!.count - coverage.get(a)!.count ||
        coverage.get(a)!.group.localeCompare(coverage.get(b)!.group, "zh-CN") ||
        byName(a, b))
    }
    case "favorites": return result.sort((a, b) => Number(favorites.has(b.name)) - Number(favorites.has(a.name)) || byName(a, b))
    default: return result
  }
}
