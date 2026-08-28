import type { Database } from "bun:sqlite"
import type { SkillsShSkill } from "../../../cli/src/core/skills-sh-client.js"

// How long a cached trending payload stays fresh before a re-fetch is needed.
const TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

interface TrendingCacheRow {
  id: number
  fetched_at: string
  payload: string
}

/**
 * Returns the cached trending skills if the single-row cache exists and is
 * still within the TTL window; otherwise returns null so the caller can
 * re-fetch.
 */
export function loadTrendingCache(db: Database): SkillsShSkill[] | null {
  const row = db
    .query("SELECT * FROM trending_cache WHERE id = 1")
    .get() as TrendingCacheRow | null

  if (!row) return null

  const fetchedAt = Date.parse(row.fetched_at)
  if (Number.isNaN(fetchedAt)) return null
  if (Date.now() - fetchedAt >= TTL_MS) return null

  try {
    return JSON.parse(row.payload) as SkillsShSkill[]
  } catch {
    return null
  }
}

/**
 * Upserts the single-row (id=1) trending cache with the given skills and the
 * current timestamp.
 */
export function saveTrendingCache(db: Database, skills: SkillsShSkill[]): void {
  db.query(
    `INSERT OR REPLACE INTO trending_cache (id, fetched_at, payload)
     VALUES (1, ?, ?)`
  ).run(new Date().toISOString(), JSON.stringify(skills))
}
