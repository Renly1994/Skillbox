import { useEffect, useState } from "react"
import { electronAPI } from "./electron-api"

// Shared installed-skills cache for secondary pages (dashboard, sidebars).
// Home owns the authoritative loading/rescan flow; every other consumer reads
// this module-level cache so navigating between pages does not refetch or
// flash loading states. Freshness comes from the skills:updated broadcast
// (file watcher + write operations).
let cache: InstalledSkill[] | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function useInstalledSkills(): InstalledSkill[] | null {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1)
    listeners.add(listener)
    if (!cache && !inflight) {
      inflight = electronAPI
        .listInstalled()
        .then((skills) => {
          cache = skills
        })
        .catch(() => {})
        .finally(() => {
          inflight = null
          notify()
        })
    }
    const unsubscribe = electronAPI.onSkillsUpdated((skills) => {
      cache = skills
      notify()
    })
    return () => {
      listeners.delete(listener)
      unsubscribe()
    }
  }, [])
  return cache
}
