// Re-export the shared trending browse helpers from the CLI core so the
// scraping/filtering logic lives in exactly one place.
export {
  fetchTrending,
  filterSkills,
  type SkillsShSkill,
} from "../../../cli/src/core/skills-sh-client.js"

const SKILLS_SH_BASE = "https://skills.sh"
const GITHUB_API_BASE = "https://api.github.com"
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com"

// ---------- Types ----------

export interface CatalogSkill {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
}

interface SkillsShSearchResponse {
  skills: CatalogSkill[]
  count: number
}

export interface SearchResult {
  skills: CatalogSkill[]
  total: number
}

// ---------- Search (skills.sh) ----------

/**
 * Search for skills or load popular skills when query is empty.
 * Public endpoint, no authentication required.
 */
export async function searchSkills(
  query: string,
  limit: number = 20,
  offset: number = 0
): Promise<SearchResult> {
  // skills.sh requires a minimum 2-char query
  const q = query.trim() || "skill"
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) })

  const url = `${SKILLS_SH_BASE}/api/search?${params}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Search failed (HTTP ${response.status})`)
  }

  const data = (await response.json()) as SkillsShSearchResponse
  return {
    skills: data.skills ?? [],
    total: data.count ?? 0,
  }
}

// ---------- Skill Content (GitHub raw) ----------

/**
 * In-memory cache for GitHub default branch lookups.
 */
const branchCache = new Map<string, string>()

/**
 * Fetches the default branch for a GitHub repository.
 */
async function getDefaultBranch(source: string): Promise<string> {
  const cached = branchCache.get(source)
  if (cached) return cached

  const response = await fetch(`${GITHUB_API_BASE}/repos/${source}`, {
    headers: { Accept: "application/vnd.github.v3+json" },
  })

  if (!response.ok) {
    throw new Error(`GitHub API error (HTTP ${response.status})`)
  }

  const data = (await response.json()) as { default_branch: string }
  const branch = data.default_branch
  branchCache.set(source, branch)
  return branch
}

/**
 * Candidate paths where a SKILL.md file might be located in a repository.
 */
function candidatePaths(skillId: string): string[] {
  return [
    `skills/${skillId}/SKILL.md`,
    `skills/.curated/${skillId}/SKILL.md`,
    `skills/.experimental/${skillId}/SKILL.md`,
    `${skillId}/SKILL.md`,
    `SKILL.md`,
  ]
}

/**
 * Fetches the SKILL.md content for a skill by trying multiple path candidates
 * against the GitHub raw content API.
 */
export async function fetchSkillContent(
  source: string,
  skillId: string
): Promise<string | null> {
  const branch = await getDefaultBranch(source)
  const paths = candidatePaths(skillId)

  for (const p of paths) {
    const url = `${GITHUB_RAW_BASE}/${source}/${branch}/${p}`
    const response = await fetch(url)
    if (response.ok) {
      return response.text()
    }
  }

  return null
}

