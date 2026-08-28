import { useState, useEffect, useRef, useCallback } from "react"
import { searchSkills, type CatalogSkill } from "./api-client.js"

const DEBOUNCE_MS = 300
const PAGE_SIZE = 20

interface UseSearchResult {
  results: CatalogSkill[]
  loading: boolean
  error: string | null
  total: number
  hasMore: boolean
  loadMore: () => void
}

/**
 * Hook that manages search state with debounce and pagination.
 * - When query is empty, loads popular skills
 * - When query is provided, searches after 300ms debounce
 */
export function useSearch(query: string): UseSearchResult {
  const [results, setResults] = useState<CatalogSkill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset pagination when query changes
  useEffect(() => {
    setResults([])
    setOffset(0)
    setError(null)
  }, [query])

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const doFetch = async () => {
      setLoading(true)
      setError(null)

      try {
        const data = await searchSkills(query, PAGE_SIZE)
        setResults(data.skills)
        setTotal(data.total)
        setOffset(PAGE_SIZE)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes("abort")) {
          setError(msg)
        }
      } finally {
        setLoading(false)
      }
    }

    if (query.trim()) {
      timerRef.current = setTimeout(doFetch, DEBOUNCE_MS)
    } else {
      doFetch()
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [query])

  const loadMore = useCallback(async () => {
    if (loading) return
    if (results.length >= total && total > 0) return

    setLoading(true)
    try {
      const data = await searchSkills(query, PAGE_SIZE, offset)
      setResults((prev) => [...prev, ...data.skills])
      setTotal((prev) => prev + data.total)
      setOffset((prev) => prev + PAGE_SIZE)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [query, loading, results.length, total, offset])

  return {
    results,
    loading,
    error,
    total,
    hasMore: results.length < total,
    loadMore,
  }
}
