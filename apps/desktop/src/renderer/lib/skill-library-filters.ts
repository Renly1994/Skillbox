import { categorizeSkill } from "./skill-category"
import { getSkillAgentCoverageNames } from "./skill-agent-bindings"

export interface LibraryFilters {
  category: string
  mismatched: boolean
  uncollected: boolean
  sort: "default" | "name-asc" | "name-desc" | "updated" | "installed" | "coverage" | "favorites"
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  category: "", mismatched: false, uncollected: false, sort: "default",
}

export function refineLibrarySkills(
  skills: InstalledSkill[],
  filters: LibraryFilters,
  collections: Record<string, string[]>,
  favorites: Set<string>,
): InstalledSkill[] {
  const collected = new Set(Object.values(collections).flat())
  const result = skills.filter((skill) =>
    (!filters.category || categorizeSkill(skill.name, skill.description).label === filters.category) &&
    (!filters.mismatched || skill.versionMismatches.length > 0) &&
    (!filters.uncollected || !collected.has(skill.canonicalPath)),
  )
  const byName = (a: InstalledSkill, b: InstalledSkill) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })
  const timestamp = (value?: string) => Date.parse(value || "") || 0
  switch (filters.sort) {
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
