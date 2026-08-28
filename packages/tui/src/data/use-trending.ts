import { useEffect, useState } from "react"
import { useDb } from "../db/context.js"
import {
  loadTrendingCache,
  saveTrendingCache,
} from "../db/trending-cache.js"
import { fetchTrending, type SkillsShSkill } from "./api-client.js"

interface UseTrendingResult {
  trending: SkillsShSkill[]
  loading: boolean
}

/**
 * Loads the ranked, most-installed skills for an instant local browse + filter.
 * Reads a fresh local cache first; if it's stale or missing, scrapes the live
 * list and persists it. A scrape failure is non-fatal — trending falls back to
 * empty and the live search path still works.
 */
export function useTrending(): UseTrendingResult {
  const { db } = useDb()
  const [trending, setTrending] = useState<SkillsShSkill[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const cached = loadTrendingCache(db)
    if (cached) {
      setTrending(cached)
      setLoading(false)
      return
    }

    const load = async () => {
      try {
        const skills = await fetchTrending()
        if (cancelled) return
        saveTrendingCache(db, skills)
        setTrending(skills)
      } catch {
        // Non-fatal: live search remains available without trending.
        if (!cancelled) setTrending([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [db])

  return { trending, loading }
}
