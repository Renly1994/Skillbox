import fs from "node:fs/promises"
import type { Stats } from "node:fs"
import os from "node:os"
import path from "node:path"
import { SKILL_HEAT_THRESHOLDS, type SkillHeat } from "../shared/skill-heat"

interface LogSource {
  agent: string
  kind: "codex" | "claude"
  root: string
}

interface LogCache {
  offset: number
  size: number
  mtime: number
  inode: number
  cwd: string
  readable: boolean
  agent: string
  sessionId?: string
  signals: Record<string, string>
  skipLine?: boolean
}

export interface SkillHeatCache {
  files: Record<string, LogCache>
  observations?: Record<string, { since: string; agents: string[] }>
}

interface HeatSkill {
  name: string
  path: string
  canonicalPath: string
  agents: string[]
  locations: Array<{ path: string; canonicalPath: string; agents: string[] }>
  installedAt?: string
}

const DAY = 86_400_000
const pathKey = (value: string) => {
  const normalized = value.replace(/\\/g, "/").replace(/\/$/, "")
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

export function skillLogSources(): LogSource[] {
  const codex = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")
  const claude = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")
  return [
    { agent: "Codex CLI", kind: "codex", root: path.join(codex, "sessions") },
    { agent: "Codex CLI", kind: "codex", root: path.join(codex, "archived_sessions") },
    { agent: "Claude Code", kind: "claude", root: path.join(claude, "projects") },
  ]
}

function readCommandPaths(command: string, cwd: string): string[] {
  if (typeof command !== "string" || typeof cwd !== "string") return []
  const result: string[] = []
  for (const segment of command.split(/[;\n|]|&&/)) {
    const tokens = segment.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g) || []
    if (!/^(?:Get-Content|cat|head|tail|sed|type)$/i.test(tokens[0]?.split(/[\\/]/).at(-1) || "")) continue
    for (const token of tokens.slice(1)) {
      let value = token.replace(/^["']|["']$/g, "").replace(/\\\\/g, "\\")
      if (!/(?:^|[\\/])SKILL\.md$/i.test(value)) continue
      if (value.startsWith("~/") || value.startsWith("~\\")) value = path.join(os.homedir(), value.slice(2))
      if (!path.isAbsolute(value) && !cwd) continue
      result.push("p:" + pathKey(path.dirname(path.resolve(cwd || ".", value))))
    }
  }
  return result
}

function toolSignals(name: string, input: unknown, cwd: string): string[] {
  if (typeof name !== "string") return []
  const tool = name.split(/\.|__/).at(-1)?.toLowerCase()
  let args: any = input
  if (typeof args === "string") {
    try { args = JSON.parse(args) } catch { /* 自定义工具调用使用原始代码。 */ }
  }
  if (tool === "skill" && typeof args?.skill === "string") return ["n:" + args.skill.trim().toLowerCase()]
  if (["read", "read_file", "read_text_file"].includes(tool || "") && typeof (args?.file_path ?? args?.path) === "string") {
    return readCommandPaths("cat " + JSON.stringify(args.file_path ?? args.path), cwd)
  }
  if (tool === "bash" || name.endsWith("exec_command")) {
    return readCommandPaths(args?.command ?? args?.cmd ?? "", typeof args?.workdir === "string" ? args.workdir : cwd)
  }
  if (tool === "exec" && typeof args === "string") {
    const signals: string[] = []
    for (const match of args.matchAll(/\bcmd["']?\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)) {
      let command: string
      try { command = JSON.parse(match[1]) } catch { command = match[1].slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\") }
      signals.push(...readCommandPaths(command, cwd))
    }
    return signals
  }
  return []
}

function ingest(line: string, file: LogCache, kind: LogSource["kind"], cutoff: number, now: number): void {
  if (!/SKILL\.md|"tool_use"|"function_call"|"custom_tool_call"|"session_meta"|"turn_context"/.test(line)) return
  let record: any
  try { record = JSON.parse(line) } catch { return }
  const timestamp = Date.parse(record.timestamp)
  if (!Number.isFinite(timestamp) || timestamp > now) return
  const body = record.payload
  if (kind === "codex" && ["session_meta", "turn_context"].includes(record.type)) {
    if (typeof body?.cwd === "string") file.cwd = body.cwd
    if (record.type === "session_meta" && typeof body?.id === "string") file.sessionId = body.id
    return
  }
  let signals: string[] = []
  if (kind === "codex" && record.type === "response_item" && ["function_call", "custom_tool_call"].includes(body?.type)) {
    file.readable = true
    signals = toolSignals(body.name || "", body.arguments ?? body.input, file.cwd)
  } else if (kind === "claude" && record.type === "assistant" && Array.isArray(record.message?.content)) {
    if (typeof record.sessionId === "string") file.sessionId = record.sessionId
    for (const block of record.message.content) {
      if (!block || block.type !== "tool_use") continue
      file.readable = true
      signals.push(...toolSignals(block.name || "", block.input, record.cwd || file.cwd))
    }
  }
  if (timestamp < cutoff) return
  const seen = new Date(timestamp).toISOString()
  for (const signal of signals) {
    if (!file.signals[signal] || file.signals[signal] < seen) file.signals[signal] = seen
  }
}

async function findLogs(root: string, cutoff: number, depth = 4): Promise<Array<{ file: string; stat: Stats }>> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const result: Awaited<ReturnType<typeof findLogs>> = []
  for (const entry of entries) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory() && depth > 0) result.push(...await findLogs(file, cutoff, depth - 1))
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const stat = await fs.stat(file)
      if (stat.mtimeMs >= cutoff) result.push({ file, stat })
    }
  }
  return result
}

export class SkillHeatReader {
  readonly cache: SkillHeatCache
  private partial = new Set<string>()
  private failed = new Set<string>()
  private gaps = new Set<string>()
  private refreshed = false
  private now = Date.now()

  constructor(private sources = skillLogSources(), cache: SkillHeatCache = { files: {} }) {
    this.cache = cache
    for (const file of Object.values(cache.files)) if (file.offset < file.size) this.partial.add(file.agent)
  }

  async refresh(now = Date.now(), byteBudget = 32 * 1024 * 1024): Promise<void> {
    this.now = now
    const cutoff = now - 90 * DAY
    this.partial.clear()
    this.failed.clear()
    this.gaps.clear()
    const discovered = new Set<string>()
    for (const [sourceIndex, source] of this.sources.entries()) {
      let sourceBudget = Math.floor(byteBudget / (this.sources.length - sourceIndex))
      let logs: Awaited<ReturnType<typeof findLogs>>
      try { logs = await findLogs(source.root, cutoff) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.failed.add(source.agent)
        continue
      }
      logs.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      for (const { file, stat } of logs) {
        discovered.add(file)
        let cached = this.cache.files[file]
        if (!cached || stat.size < cached.offset || stat.ino !== cached.inode || (stat.size === cached.offset && stat.mtimeMs !== cached.mtime)) {
          if (cached) this.gaps.add(source.agent)
          cached = this.cache.files[file] = { offset: 0, size: 0, mtime: 0, inode: stat.ino, cwd: "", readable: false, agent: source.agent, signals: {} }
        }
        if (stat.size > cached.offset && sourceBudget > 0) {
          let handle: Awaited<ReturnType<typeof fs.open>> | undefined
          try {
            handle = await fs.open(file, "r")
            const length = Math.min(stat.size - cached.offset, sourceBudget)
            const buffer = Buffer.alloc(length)
            const { bytesRead } = await handle.read(buffer, 0, length, cached.offset)
            byteBudget -= bytesRead
            sourceBudget -= bytesRead
            let start = 0
            if (cached.skipLine) {
              const newline = buffer.subarray(0, bytesRead).indexOf(10)
              start = newline < 0 ? bytesRead : newline + 1
              cached.skipLine = newline < 0
            }
            const end = Math.max(start, buffer.subarray(0, bytesRead).lastIndexOf(10) + 1)
            for (const line of buffer.subarray(start, end).toString("utf8").split("\n")) {
              if (line.length <= 1024 * 1024) ingest(line, cached, source.kind, cutoff, now)
            }
            // 图片等超长输出不参与热度；跳过整行，避免增量游标卡住。
            cached.skipLine ||= bytesRead - end > 1024 * 1024
            cached.offset += cached.skipLine ? bytesRead : end
            cached.size = stat.size
            cached.mtime = stat.mtimeMs
          } catch { this.failed.add(source.agent) }
          finally { await handle?.close() }
        }
        cached.size = stat.size
        if (cached.offset < stat.size) this.partial.add(source.agent)
      }
    }
    const remainingSessions = new Set(Object.entries(this.cache.files).filter(([file]) => discovered.has(file)).map(([, cached]) => cached.agent + "\0" + cached.sessionId))
    for (const [file, cached] of Object.entries(this.cache.files)) {
      if (!discovered.has(file) && cached.readable && cached.mtime >= cutoff && (!cached.sessionId || !remainingSessions.has(cached.agent + "\0" + cached.sessionId))) this.gaps.add(cached.agent)
      if (!discovered.has(file) && !this.failed.has(cached.agent)) cached.readable = false
      for (const [signal, seen] of Object.entries(cached.signals)) if (Date.parse(seen) < cutoff) delete cached.signals[signal]
      if (!discovered.has(file) && !this.failed.has(cached.agent) && !Object.keys(cached.signals).length) delete this.cache.files[file]
    }
    this.refreshed = true
  }

  attach<T extends HeatSkill>(skills: T[]): Array<T & { heat: SkillHeat }> {
    const files = Object.entries(this.cache.files)
    const readableAgents = new Set(files.filter(([, file]) => file.readable).map(([, file]) => file.agent))
    const observations = this.cache.observations ??= {}
    const currentPaths = new Set(skills.map(skill => pathKey(skill.canonicalPath)))
    for (const key of Object.keys(observations)) if (!currentPaths.has(key)) delete observations[key]
    const names = new Map<string, number>()
    for (const skill of skills) { const name = skill.name.toLowerCase(); names.set(name, (names.get(name) || 0) + 1) }
    return skills.map((skill) => {
      const paths = new Set([skill.path, skill.canonicalPath, ...skill.locations.flatMap(l => [l.path, l.canonicalPath])].map(p => "p:" + pathKey(p)))
      const agents = new Set([...skill.agents, ...skill.locations.flatMap(l => l.agents)])
      const realAgents = [...agents].filter(agent => !["通用 Skill 目录", "Universal (.agents/skills)"].includes(agent)).sort()
      const sessions = new Set<string>()
      const sessions90 = new Set<string>()
      const sources = new Set<string>()
      let lastSeen: string | undefined
      let ambiguous = false
      for (const [logPath, file] of files) {
        if (file.readable && agents.has(file.agent)) sources.add(file.agent)
        for (const [signal, seen] of Object.entries(file.signals)) {
          if (signal === "n:" + skill.name.toLowerCase() && names.get(skill.name.toLowerCase())! > 1 && agents.has(file.agent)) ambiguous = true
          const named = signal === "n:" + skill.name.toLowerCase() && names.get(skill.name.toLowerCase()) === 1 && agents.has(file.agent)
          if (!paths.has(signal) && !named) continue
          sources.add(file.agent)
          if (Date.parse(seen) < this.now - 90 * DAY || Date.parse(seen) > this.now) continue
          const session = file.agent + "\0" + (file.sessionId || pathKey(logPath))
          sessions90.add(session)
          if (Date.parse(seen) >= this.now - 30 * DAY) sessions.add(session)
          if (!lastSeen || lastSeen < seen) lastSeen = seen
        }
      }
      const level = sessions.size >= SKILL_HEAT_THRESHOLDS[2] ? 3 : sessions.size >= SKILL_HEAT_THRESHOLDS[1] ? 2 : sessions.size >= SKILL_HEAT_THRESHOLDS[0] ? 1 : sessions.size ? 0 : ambiguous ? null : sources.size ? 0 : null
      const partial = [...sources, ...realAgents].some(agent => this.partial.has(agent))
      const stale = [...agents, ...sources].some(agent => this.failed.has(agent))
      const covered = realAgents.length > 0 && realAgents.every(agent => readableAgents.has(agent)) && !ambiguous && !stale
      const key = pathKey(skill.canonicalPath)
      let observation: (typeof observations)[string] | undefined = observations[key]
      if (this.refreshed && (!covered || observation && (observation.agents.join("\0") !== realAgents.join("\0") || Date.parse(skill.installedAt || "") > Date.parse(observation.since) || realAgents.some(agent => this.gaps.has(agent))))) {
        delete observations[key]
        observation = undefined
      }
      if (this.refreshed && covered && !partial && !observation) observation = observations[key] = { since: new Date(this.now).toISOString(), agents: realAgents }
      // 随原有刷新推送观察天数，满 30／90 天时同步更新筛选结果。
      const observedDays = observation ? Math.max(0, Math.floor((this.now - Date.parse(observation.since)) / DAY)) : 0
      return { ...skill, heat: { level, usageCount: level === null ? null : sessions.size, usageCount90: (!sources.size || ambiguous && !sessions90.size) ? null : sessions90.size, observedSince: observation?.since, observedDays, coverageComplete: this.refreshed && covered && !partial, lastSeen, sources: [...sources].sort(), partial, stale } }
    })
  }
}
