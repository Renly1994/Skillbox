import { useSyncExternalStore } from "react"
import { electronAPI } from "./electron-api"

// 显示名称（别名）只保存在本地设置里，不改动 MCP server 名或 Skill 的
// SKILL.md。键分别是 server 名和 skill 的 canonicalPath。
const MCP_ALIASES_KEY = "alias.mcp"
const SKILL_ALIASES_KEY = "alias.skill"

export interface AliasMaps {
  mcp: Record<string, string>
  skill: Record<string, string>
}

let cache: AliasMaps = { mcp: {}, skill: {} }
let loading: Promise<void> | null = null
let loadGeneration = 0
let stopSkillsUpdated: (() => void) | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

async function load(): Promise<void> {
  const generation = ++loadGeneration
  try {
    const [mcp, skill] = await Promise.all([
      electronAPI.settingsGet(MCP_ALIASES_KEY, {} as Record<string, string>),
      electronAPI.settingsGet(SKILL_ALIASES_KEY, {} as Record<string, string>),
    ])
    if (generation === loadGeneration) cache = { mcp: mcp ?? {}, skill: skill ?? {} }
  } catch {
    // 读取失败时保持现有缓存，下次操作时再尝试。
  } finally {
    if (generation === loadGeneration) loading = null
  }
  if (generation === loadGeneration) emit()
}

function ensureLoaded() {
  if (!stopSkillsUpdated) {
    stopSkillsUpdated = electronAPI.onSkillsUpdated(() => {
      loading = null
      ensureLoaded()
    })
  }
  if (!loading) loading = load()
}

export function useDisplayAliases(): AliasMaps {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      ensureLoaded()
      return () => {
        listeners.delete(listener)
      }
    },
    () => cache,
  )
}

async function setAlias(scope: keyof AliasMaps, key: string, alias: string): Promise<void> {
  const trimmed = alias.trim()
  const next = { ...cache[scope] }
  // 空值或与真实名称相同都视为清除别名。
  if (trimmed && trimmed !== key) next[key] = trimmed
  else delete next[key]
  cache = { ...cache, [scope]: next }
  emit()
  try {
    await electronAPI.settingsSet(scope === "mcp" ? MCP_ALIASES_KEY : SKILL_ALIASES_KEY, next)
  } catch {
    // 写入失败时回滚到持久化前的状态。
    await load()
  }
}

export function setMcpAlias(serverName: string, alias: string): Promise<void> {
  return setAlias("mcp", serverName, alias)
}

export function setSkillAlias(canonicalPath: string, alias: string): Promise<void> {
  return setAlias("skill", canonicalPath, alias)
}
