import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import JSON5 from "json5"
import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser"
import { dirExists } from "./agent-registry"
import {
  mcpAgentRegistry,
  type McpAgentConfigEntry,
  type McpEntryStyle,
} from "./mcp-registry"

const home = os.homedir()

// Mirrors the SKILLBOX_BACKUPS_DIR convention from ipc-handlers.ts
// (~/.agents/skillbox-backups), namespaced per feature.
const DEFAULT_BACKUPS_DIR = path.join(home, ".agents", "skillbox-backups", "mcp")

const ENV_REDACTED = "••••"

// ---------------------------------------------------------------------------
// Normalized representation shared by all config formats
// ---------------------------------------------------------------------------

interface NormalizedMcpServer {
  type: McpServerType
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  transport?: "http" | "sse"
  unsupported?: Record<string, unknown>
}

interface RawServerEntry {
  name: string
  normalized: NormalizedMcpServer
  /** Pretty JSON of the raw entry with env values redacted. */
  raw: string
}

interface AgentScanResult {
  agent: McpAgentConfigEntry
  installed: boolean
  configExists: boolean
  parseError?: string
  entries: RawServerEntry[]
}

export interface McpWriteOptions {
  registry?: McpAgentConfigEntry[]
  backupsDir?: string
  commandRunner?: McpCommandRunner
}

export type McpCommandRunner = (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) => Promise<void>

const signatureKey = crypto.randomBytes(32)
const configWriteQueues = new Map<string, Promise<unknown>>()

function configWriteKey(configPath: string): string {
  const resolved = path.resolve(configPath)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function withConfigWriteLock<T>(configPath: string, task: () => Promise<T>): Promise<T> {
  const key = configWriteKey(configPath)
  const previous = configWriteQueues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(task)
  configWriteQueues.set(key, current)
  return current.finally(() => {
    if (configWriteQueues.get(key) === current) configWriteQueues.delete(key)
  })
}

function protectedValue(value: string): string {
  return crypto.createHmac("sha256", signatureKey).update(value).digest("base64url")
}

function signatureOf(server: NormalizedMcpServer): string {
  const protectedEnv = Object.fromEntries(
    Object.entries(server.env ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, protectedValue(value)]),
  )
  const protectedHeaders = Object.fromEntries(
    Object.entries(server.headers ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, protectedValue(value)]),
  )
  return JSON.stringify({
    type: server.type,
    command: server.command === undefined ? null : protectedValue(server.command),
    args: protectedValue(JSON.stringify(server.args ?? [])),
    cwd: server.cwd === undefined ? null : protectedValue(server.cwd),
    url: server.url === undefined ? null : protectedValue(server.url),
    transport: server.transport ?? null,
    env: protectedEnv,
    headers: protectedHeaders,
    unsupported: server.unsupported ? protectedValue(JSON.stringify(server.unsupported)) : null,
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function pickStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const SENSITIVE_KEY = /token|secret|password|passwd|api[_-]?key|access[_-]?key|authorization|credential|cookie|signature/i
const SENSITIVE_ARG = /^-{1,2}(?:.*(?:token|secret|password|passwd|api[-_]?key|access[-_]?key|authorization|auth|credential|cookie|signature))$/i

function redactUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value
  try {
    const url = new URL(value)
    if (url.username) url.username = ENV_REDACTED
    if (url.password) url.password = ENV_REDACTED
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, ENV_REDACTED)
    }
    return url.toString()
  } catch {
    return value.replace(/([?&](?:token|secret|password|api[_-]?key|access[_-]?key|auth|authorization|credential|signature)=)[^&#]*/gi, `$1${encodeURIComponent(ENV_REDACTED)}`)
  }
}

function redactText(value: string): string {
  const safeUrl = redactUrl(value)
  return safeUrl
    .replace(/(Bearer\s+)(?!\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)(?!Token\b)[^\s,;]+/gi, `$1${ENV_REDACTED}`)
    .replace(/(--?(?:token|secret|password|passwd|api[-_]?key|authorization|auth|credential)=)[^\s]+/gi, `$1${ENV_REDACTED}`)
    .replace(/\b([A-Z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|AUTH|CREDENTIAL|COOKIE|SIGNATURE)[A-Z0-9_.-]*)=([^\s,;]+)/gi, `$1=${ENV_REDACTED}`)
    .replace(/\b(authorization|proxy-authorization|x-api-key|cookie|set-cookie)\s*:\s*[^\s,;]+/gi, `$1: ${ENV_REDACTED}`)
}

function redactArgs(args: string[]): string[] {
  let redactNext = false
  return args.map((arg) => {
    if (redactNext) {
      redactNext = false
      return ENV_REDACTED
    }
    if (SENSITIVE_ARG.test(arg)) {
      const equal = arg.indexOf("=")
      if (equal >= 0) return `${arg.slice(0, equal + 1)}${ENV_REDACTED}`
      redactNext = true
      return arg
    }
    return redactText(arg)
  })
}

function redactValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return ENV_REDACTED
  if (key === "unsupported" && isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).map((name) => [name, ENV_REDACTED]))
  }
  if ((key === "env" || key === "environment" || key === "headers") && isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).map((name) => [name, ENV_REDACTED]))
  }
  if (key === "args" && Array.isArray(value)) {
    return redactArgs(value.filter((item): item is string => typeof item === "string"))
  }
  if (typeof value === "string") {
    return key === "url" || key === "httpUrl" || key === "serverUrl" ? redactUrl(value) : redactText(value)
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item))
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactValue(item, name)]))
  }
  return value
}

/** Pretty-print a raw entry without exposing credentials to the renderer. */
function redactedRaw(entry: Record<string, unknown>): string {
  return JSON.stringify(redactValue(entry), null, 2)
}

function unsupportedFields(entry: Record<string, unknown>, allowed: string[]): Record<string, unknown> | undefined {
  const unsupported = Object.fromEntries(
    Object.entries(entry)
      .filter(([key]) => !allowed.includes(key))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  return Object.keys(unsupported).length > 0 ? unsupported : undefined
}

function hasInvalidStringRecord(value: unknown): boolean {
  return value !== undefined && (
    !isPlainObject(value) || Object.values(value).some((item) => typeof item !== "string")
  )
}

// ---------------------------------------------------------------------------
// Per-format entry extraction
// ---------------------------------------------------------------------------

function normalizeJsonEntry(entry: unknown, style: McpEntryStyle): NormalizedMcpServer | null {
  if (!isPlainObject(entry)) return null
  const headers = pickStringRecord(entry.headers)
  const httpUrl = typeof entry.httpUrl === "string" ? entry.httpUrl : undefined
  const serverUrl = typeof entry.serverUrl === "string" ? entry.serverUrl : undefined
  const url = typeof entry.url === "string" ? entry.url : httpUrl ?? serverUrl
  if (url) {
    const allowed = ["url", "httpUrl", "serverUrl", "transport", "type", "headers"]
    const declaredTransport = typeof entry.transport === "string" ? entry.transport : entry.type
    const out: NormalizedMcpServer = {
      type: "http",
      url,
      transport: declaredTransport === "sse" || (!httpUrl && style === "qwen") ? "sse" : "http",
    }
    if (headers) out.headers = headers
    out.unsupported = unsupportedFields(entry, allowed)
    if (hasInvalidStringRecord(entry.headers)) {
      out.unsupported ??= {}
      out.unsupported.invalidHeaders = entry.headers
    }
    return out
  }

  if (style === "opencode") {
    if (!Array.isArray(entry.command)) return null
    const parts = entry.command.filter((part): part is string => typeof part === "string")
    if (parts.length === 0) return null
    const out: NormalizedMcpServer = { type: "stdio", command: parts[0] }
    if (parts.length > 1) out.args = parts.slice(1)
    const env = pickStringRecord(entry.environment) ?? pickStringRecord(entry.env)
    if (env) out.env = env
    out.unsupported = unsupportedFields(entry, ["command", "type", "environment", "env"])
    if (parts.length !== entry.command.length) {
      out.unsupported ??= {}
      out.unsupported.invalidCommand = entry.command
    }
    if (hasInvalidStringRecord(entry.environment) || hasInvalidStringRecord(entry.env)) {
      out.unsupported ??= {}
      out.unsupported.invalidEnvironment = entry.environment ?? entry.env
    }
    return out
  }

  if (typeof entry.command === "string" && entry.command.length > 0) {
    const out: NormalizedMcpServer = { type: "stdio", command: entry.command }
    if (Array.isArray(entry.args)) {
      out.args = entry.args.filter((arg): arg is string => typeof arg === "string")
    }
    const env = pickStringRecord(entry.env) ?? pickStringRecord(entry.environment)
    if (env) out.env = env
    if (typeof entry.cwd === "string" && entry.cwd) out.cwd = entry.cwd
    out.unsupported = unsupportedFields(entry, ["command", "args", "env", "environment", "cwd", "type"])
    if (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== "string"))) {
      out.unsupported ??= {}
      out.unsupported.invalidArgs = entry.args
    }
    if (hasInvalidStringRecord(entry.env) || hasInvalidStringRecord(entry.environment)) {
      out.unsupported ??= {}
      out.unsupported.invalidEnvironment = entry.env ?? entry.environment
    }
    return out
  }
  return null
}

function defaultContainerPath(agent: McpAgentConfigEntry): string[] {
  return agent.containerPath ?? (agent.format === "opencode-json" ? ["mcp"] : ["mcpServers"])
}

function entryStyleOf(agent: McpAgentConfigEntry): McpEntryStyle {
  return agent.entryStyle ?? (agent.format === "opencode-json" ? "opencode" : "standard")
}

function valueAtPath(doc: unknown, segments: string[]): unknown {
  let current = doc
  for (const segment of segments) {
    if (!isPlainObject(current)) return undefined
    current = current[segment]
  }
  return current
}

function parseJsonDocument(content: string, agent: McpAgentConfigEntry): unknown {
  if (agent.json5) return JSON5.parse(content) as unknown
  const errors: ParseError[] = []
  const doc: unknown = parseJsonc(content, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    throw new Error(`invalid JSON near offset ${errors[0].offset}`)
  }
  return doc
}

function extractJsonEntries(content: string, agent: McpAgentConfigEntry): RawServerEntry[] {
  const doc = parseJsonDocument(content, agent)
  if (!isPlainObject(doc)) return []
  const container = valueAtPath(doc, defaultContainerPath(agent))
  if (!isPlainObject(container)) return []
  const style = entryStyleOf(agent)
  const entries: RawServerEntry[] = []
  for (const [name, rawEntry] of Object.entries(container)) {
    const normalized = normalizeJsonEntry(rawEntry, style)
    if (!normalized) continue
    entries.push({
      name,
      normalized,
      raw: redactedRaw(isPlainObject(rawEntry) ? rawEntry : { value: rawEntry }),
    })
  }
  return entries
}

// ---------------------------------------------------------------------------
// codex-toml: restricted line parser for [mcp_servers.*] tables only.
// Not a general TOML parser -- just enough to read real codex configs.
// ---------------------------------------------------------------------------

interface CodexTable {
  command?: string
  args?: string[]
  url?: string
  bearerTokenEnvVar?: string
  env?: Record<string, string>
  unsupported?: Record<string, unknown>
}

function parseTomlString(raw: string): string {
  const trimmed = raw.trim()
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === "string") return parsed
  } catch {
    // fall through to naive unquoting
  }
  const match = trimmed.match(/^"(.*)"$/) ?? trimmed.match(/^'(.*)'$/)
  if (match) return match[1]
  throw new Error(`invalid TOML string: ${trimmed}`)
}

function parseTomlStringArray(raw: string): string[] {
  const trimmed = raw.trim()
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed
    }
  } catch {
    // fall through
  }

  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error(`invalid TOML string array: ${trimmed}`)
  }
  const body = trimmed.slice(1, -1)
  const values: string[] = []
  let index = 0
  while (index < body.length) {
    while (/\s/.test(body[index] ?? "")) index++
    if (index >= body.length) break
    const quote = body[index]
    if (quote !== '"' && quote !== "'") {
      throw new Error(`invalid TOML string array: ${trimmed}`)
    }
    const start = index++
    while (index < body.length) {
      if (quote === '"' && body[index] === "\\") {
        index += 2
        continue
      }
      if (body[index] === quote) break
      index++
    }
    if (index >= body.length) {
      throw new Error(`invalid TOML string array: ${trimmed}`)
    }
    values.push(parseTomlString(body.slice(start, ++index)))
    while (/\s/.test(body[index] ?? "")) index++
    if (index < body.length && body[index++] !== ",") {
      throw new Error(`invalid TOML string array: ${trimmed}`)
    }
  }
  return values
}

export function parseCodexTomlServers(content: string): Map<string, CodexTable> {
  const tables = new Map<string, CodexTable>()
  let currentName: string | null = null
  let inEnv = false

  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith("#")) continue

    const envSection = line.match(/^\[\s*mcp_servers\.(.+)\.env\s*\]$/)
    const serverSection = line.match(/^\[\s*mcp_servers\.(.+)\s*\]$/)
    if (envSection) {
      currentName = envSection[1].trim().replace(/^"(.*)"$/, "$1")
      inEnv = true
      if (!tables.has(currentName)) tables.set(currentName, {})
      continue
    }
    if (serverSection) {
      currentName = serverSection[1].trim().replace(/^"(.*)"$/, "$1")
      inEnv = false
      if (!tables.has(currentName)) tables.set(currentName, {})
      continue
    }
    if (line.startsWith("[")) {
      // Some other TOML section -- stop collecting until the next mcp_servers table.
      currentName = null
      inEnv = false
      continue
    }
    if (currentName === null) continue

    const eq = line.indexOf("=")
    if (eq <= 0) {
      throw new Error(`malformed line ${i + 1} in [mcp_servers.${currentName}]: ${line}`)
    }
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    const table = tables.get(currentName)
    if (!table) continue
    if (inEnv) {
      if (!table.env) table.env = {}
      table.env[key] = parseTomlString(value)
      continue
    }
    if (key === "command") table.command = parseTomlString(value)
    else if (key === "args") table.args = parseTomlStringArray(value)
    else if (key === "url") table.url = parseTomlString(value)
    else if (key === "bearer_token_env_var") table.bearerTokenEnvVar = parseTomlString(value)
    else {
      table.unsupported ??= {}
      table.unsupported[key] = value.trim()
    }
  }
  return tables
}

function extractCodexEntries(content: string): RawServerEntry[] {
  const tables = parseCodexTomlServers(content)
  const entries: RawServerEntry[] = []
  for (const [name, table] of tables) {
    let normalized: NormalizedMcpServer | null = null
    if (table.url) {
      normalized = { type: "http", url: table.url, transport: "http" }
      if (table.bearerTokenEnvVar) {
        normalized.headers = { Authorization: `Bearer \${${table.bearerTokenEnvVar}}` }
      }
    } else if (table.command) {
      normalized = { type: "stdio", command: table.command }
      if (table.args && table.args.length > 0) normalized.args = table.args
      if (table.env && Object.keys(table.env).length > 0) normalized.env = table.env
    }
    if (!normalized) continue
    normalized.unsupported = table.unsupported
    const rawEntry: Record<string, unknown> = {}
    if (table.command) rawEntry.command = table.command
    if (table.args) rawEntry.args = table.args
    if (table.url) rawEntry.url = table.url
    if (table.bearerTokenEnvVar) rawEntry.bearer_token_env_var = table.bearerTokenEnvVar
    if (table.env) rawEntry.env = table.env
    if (table.unsupported) rawEntry.unsupported = table.unsupported
    entries.push({ name, normalized, raw: redactedRaw(rawEntry) })
  }
  return entries
}

function extractEntries(agent: McpAgentConfigEntry, content: string): RawServerEntry[] {
  switch (agent.format) {
    case "json-mcpServers":
    case "opencode-json":
      return extractJsonEntries(content, agent)
    case "codex-toml":
      return extractCodexEntries(content)
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function configPathsOf(agent: McpAgentConfigEntry): string[] {
  return [agent.configPath, ...(agent.alternateConfigPaths ?? [])]
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveAgentConfig(agent: McpAgentConfigEntry): Promise<McpAgentConfigEntry> {
  for (const configPath of configPathsOf(agent)) {
    if (await pathExists(configPath)) return { ...agent, configPath }
  }
  return agent
}

async function isAgentInstalled(agent: McpAgentConfigEntry): Promise<boolean> {
  if (agent.detectInstalled) return agent.detectInstalled()
  const directories = [agent.installedDir, ...(agent.alternateInstalledDirs ?? [])]
  const results = await Promise.all(directories.map(dirExists))
  return results.some(Boolean)
}

async function scanAgent(registryAgent: McpAgentConfigEntry): Promise<AgentScanResult> {
  const agent = await resolveAgentConfig(registryAgent)
  const installed = await isAgentInstalled(agent)
  let content: string
  try {
    content = await fs.readFile(agent.configPath, "utf-8")
  } catch {
    return { agent, installed, configExists: false, entries: [] }
  }
  try {
    return { agent, installed, configExists: true, entries: extractEntries(agent, content) }
  } catch (error) {
    return {
      agent,
      installed,
      configExists: true,
      parseError: redactText(error instanceof Error ? error.message : String(error)),
      entries: [],
    }
  }
}

export async function scanMcpLibrary(
  registry: McpAgentConfigEntry[] = mcpAgentRegistry,
): Promise<McpLibrary> {
  const results = await Promise.all(registry.map(scanAgent))

  const agents: McpAgentInfo[] = []
  const errors: McpLibrary["errors"] = []
  const byServer = new Map<string, McpConnection[]>()

  for (const result of results) {
    agents.push({
      id: result.agent.id,
      displayName: result.agent.displayName,
      shortCode: result.agent.shortCode,
      configPath: result.agent.configPath,
      format: result.agent.format,
      installed: result.installed,
      configExists: result.configExists,
      writable: result.agent.writable,
      ...(result.agent.writeStrategy ? { writeStrategy: result.agent.writeStrategy } : {}),
      ...(result.parseError ? { parseError: result.parseError } : {}),
    })
    if (result.parseError) {
      errors.push({
        agentId: result.agent.id,
        configPath: result.agent.configPath,
        message: result.parseError,
      })
      continue
    }
    for (const entry of result.entries) {
      const { normalized } = entry
      const connection: McpConnection = {
        agentId: result.agent.id,
        configPath: result.agent.configPath,
        type: normalized.type,
        signature: signatureOf(normalized),
        raw: entry.raw,
      }
      if (normalized.command !== undefined) connection.command = normalized.command
      if (normalized.command !== undefined) connection.command = redactText(normalized.command)
      if (normalized.args !== undefined) connection.args = redactArgs(normalized.args)
      if (normalized.cwd !== undefined) connection.cwd = normalized.cwd
      if (normalized.url !== undefined) connection.url = redactUrl(normalized.url)
      if (normalized.env) connection.envKeys = Object.keys(normalized.env).sort()
      if (normalized.headers) connection.headerKeys = Object.keys(normalized.headers).sort()
      const list = byServer.get(entry.name) ?? []
      list.push(connection)
      byServer.set(entry.name, list)
    }
  }

  const servers: McpServerEntry[] = Array.from(byServer.entries())
    .map(([name, connections]) => {
      connections.sort((a, b) => a.agentId.localeCompare(b.agentId))
      const first = connections[0]
      const entry: McpServerEntry = {
        name,
        type: first.type,
        hasEnv: connections.some((c) => (c.envKeys?.length ?? 0) > 0),
        connections,
        consistent: new Set(connections.map((c) => c.signature)).size <= 1,
      }
      const withCommand = connections.find((c) => c.command !== undefined)
      if (withCommand?.command !== undefined) entry.command = withCommand.command
      if (withCommand?.args !== undefined) entry.args = withCommand.args
      if (withCommand?.cwd !== undefined) entry.cwd = withCommand.cwd
      const withUrl = connections.find((c) => c.url !== undefined)
      if (withUrl?.url !== undefined) entry.url = withUrl.url
      return entry
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return { servers, agents, scannedAt: Date.now(), errors }
}

// ---------------------------------------------------------------------------
// Write helpers: validate -> backup -> atomic write (tmp + rename)
// ---------------------------------------------------------------------------

function fail(error: string): McpWriteResult {
  return { ok: false, error: redactText(error), written: [], backups: [] }
}

class WriteAccumulator {
  written: string[] = []
  backups: string[] = []
  errors: string[] = []

  result(): McpWriteResult {
    return {
      ok: this.errors.length === 0,
      ...(this.errors.length > 0 ? { error: redactText(this.errors.join("; ")) } : {}),
      written: this.written,
      backups: this.backups,
    }
  }
}

async function loadJsonConfig(agent: McpAgentConfigEntry): Promise<{
  content: string
  doc: Record<string, unknown>
}> {
  let content = "{}\n"
  try {
    content = await fs.readFile(agent.configPath, "utf-8")
  } catch {
    return { content, doc: {} }
  }
  let doc: unknown
  try {
    doc = parseJsonDocument(content, agent)
  } catch (error) {
    throw new Error(
      `refusing to write ${agent.configPath}: existing file is not valid JSON (${
        error instanceof Error ? error.message : String(error)
      })`,
    )
  }
  if (!isPlainObject(doc)) {
    throw new Error(`refusing to write ${agent.configPath}: top-level value is not an object`)
  }
  return { content, doc }
}

async function backupConfig(
  agent: McpAgentConfigEntry,
  backupsDir: string,
): Promise<string | null> {
  try {
    await fs.stat(agent.configPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
  const dir = path.join(backupsDir, agent.id)
  await fs.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const nonce = crypto.randomUUID().slice(0, 8)
  const backupPath = path.join(dir, `${stamp}-${nonce}-${path.basename(agent.configPath)}`)
  await fs.copyFile(agent.configPath, backupPath)
  return backupPath
}

async function atomicWriteText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`,
  )
  await fs.writeFile(tmpPath, content.endsWith("\n") ? content : `${content}\n`, "utf-8")
  await fs.rename(tmpPath, filePath)
}

function runCommand(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024, env },
      (error) => (error ? reject(error) : resolve()),
    )
  })
}

function codexAddArgs(name: string, server: NormalizedMcpServer): string[] {
  if (server.type === "http") {
    if (server.transport === "sse") {
      throw new Error("Codex CLI 不支持 SSE MCP，请改用 Streamable HTTP 地址")
    }
    const headers = Object.entries(server.headers ?? {})
    if (headers.length === 0) return ["mcp", "add", name, "--url", server.url ?? ""]
    const bearer = headers.length === 1 && headers[0][0].toLowerCase() === "authorization"
      ? headers[0][1].match(/^Bearer\s+\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/i)
      : null
    if (!bearer) {
      throw new Error("Codex CLI 只支持通过环境变量传入 Bearer Token，无法安全复制当前请求头")
    }
    return [
      "mcp",
      "add",
      name,
      "--url",
      server.url ?? "",
      "--bearer-token-env-var",
      bearer[1],
    ]
  }
  if (server.cwd) {
    throw new Error("Codex CLI 的 MCP 注册命令不支持 cwd，无法完整复制当前配置")
  }
  const envArgs = Object.entries(server.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`])
  return [
    "mcp",
    "add",
    ...envArgs,
    name,
    "--",
    server.command ?? "",
    ...(server.args ?? []),
  ]
}

async function mutateCodexConfig(
  agent: McpAgentConfigEntry,
  serverName: string,
  server: NormalizedMcpServer | null,
  backupsDir: string,
  commandRunner: McpCommandRunner,
): Promise<{ written?: string; backup?: string }> {
  const current = await scanAgent(agent)
  if (current.parseError) {
    throw new Error(`cannot read ${agent.displayName} config: ${current.parseError}`)
  }
  const exists = current.entries.some((entry) => entry.name === serverName)
  if (server === null && !exists) return {}
  const addArgs = server === null ? null : codexAddArgs(serverName, server)

  const backup = await backupConfig(agent, backupsDir)
  const commandEnv = { ...process.env, CODEX_HOME: path.dirname(agent.configPath) }
  try {
    if (exists) {
      await commandRunner("codex", ["mcp", "remove", serverName], commandEnv)
    }
    if (addArgs) {
      await commandRunner("codex", addArgs, commandEnv)
    }
  } catch (error) {
    let restoreError: string | undefined
    if (backup) {
      try {
        await fs.copyFile(backup, agent.configPath)
      } catch (restoreFailure) {
        restoreError = restoreFailure instanceof Error ? restoreFailure.message : String(restoreFailure)
      }
    } else if (server !== null) {
      try {
        await commandRunner("codex", ["mcp", "remove", serverName], commandEnv)
      } catch (restoreFailure) {
        restoreError = restoreFailure instanceof Error ? restoreFailure.message : String(restoreFailure)
      }
    }
    const detail = error instanceof Error ? error.message : String(error)
    const recoveryNote = backup
      ? restoreError
        ? `；恢复失败：${restoreError}；请从备份恢复：${backup}`
        : `；原配置已恢复，备份：${backup}`
      : restoreError
        ? `；回退失败：${restoreError}`
        : server !== null
          ? "；新配置已回退"
          : "；未能恢复原配置"
    throw new Error(`${agent.displayName} 写入失败：${detail}${recoveryNote}`)
  }

  return { written: agent.configPath, ...(backup ? { backup } : {}) }
}

async function mutateOpenClawConfig(
  agent: McpAgentConfigEntry,
  serverName: string,
  server: NormalizedMcpServer | null,
  backupsDir: string,
  commandRunner: McpCommandRunner,
): Promise<{ written?: string; backup?: string }> {
  const current = await scanAgent(agent)
  if (current.parseError) {
    throw new Error(`cannot read ${agent.displayName} config: ${current.parseError}`)
  }
  const exists = current.entries.some((entry) => entry.name === serverName)
  if (server === null && !exists) return {}

  const backup = await backupConfig(agent, backupsDir)
  try {
    if (server === null) {
      await commandRunner("openclaw", ["mcp", "unset", serverName])
    } else {
      await commandRunner("openclaw", [
        "mcp",
        "set",
        serverName,
        JSON.stringify(serverToFormatEntry(agent, server)),
      ])
    }
  } catch (error) {
    let restoreError: string | undefined
    if (backup) {
      try {
        await fs.copyFile(backup, agent.configPath)
      } catch (restoreFailure) {
        restoreError = restoreFailure instanceof Error ? restoreFailure.message : String(restoreFailure)
      }
    } else if (server !== null) {
      try {
        await commandRunner("openclaw", ["mcp", "unset", serverName])
      } catch (restoreFailure) {
        restoreError = restoreFailure instanceof Error ? restoreFailure.message : String(restoreFailure)
      }
    }
    const detail = error instanceof Error ? `：${error.message}` : ""
    const recoveryNote = backup
      ? restoreError
        ? `；恢复失败：${restoreError}；请从备份恢复：${backup}`
        : `；原配置已恢复，备份：${backup}`
      : restoreError
        ? `；回退失败：${restoreError}`
        : server !== null
          ? "；新配置已回退"
          : "；未能恢复原配置"
    throw new Error(`${agent.displayName} 写入失败${detail}，请确认 OpenClaw CLI 可用且 MCP 配置有效${recoveryNote}`)
  }

  return { written: agent.configPath, ...(backup ? { backup } : {}) }
}

function serverToFormatEntry(agent: McpAgentConfigEntry, server: NormalizedMcpServer): unknown {
  const style = entryStyleOf(agent)
  if (server.type === "http") {
    const entry: Record<string, unknown> = {}
    if (style === "qwen") {
      entry[server.transport === "sse" ? "url" : "httpUrl"] = server.url
    } else {
      entry.url = server.url
    }
    if (style === "opencode") entry.type = "remote"
    else if (style === "vscode" || style === "copilot") {
      entry.type = server.transport === "sse" ? "sse" : "http"
    } else if (style === "cline" || style === "workbuddy") {
      entry.type = server.transport === "sse" ? "sse" : "streamableHttp"
    }
    else if (style === "roo") entry.type = server.transport === "sse" ? "sse" : "streamable-http"
    else if (style === "openclaw") entry.transport = server.transport === "sse" ? "sse" : "streamable-http"
    if (server.headers) entry.headers = server.headers
    return entry
  }
  if (style === "opencode") {
    if (server.cwd) {
      throw new Error(`${agent.displayName} 的 MCP 格式不支持 cwd，无法完整复制当前配置`)
    }
    const entry: Record<string, unknown> = {
      type: "local",
      command: [server.command, ...(server.args ?? [])],
    }
    if (server.env) entry.environment = server.env
    return entry
  }
  const entry: Record<string, unknown> = { command: server.command }
  if (style === "vscode" || style === "workbuddy") entry.type = "stdio"
  else if (style === "copilot") entry.type = "local"
  if (server.args && server.args.length > 0) entry.args = server.args
  if (server.cwd) entry.cwd = server.cwd
  if (server.env) entry.env = server.env
  return entry
}

/**
 * Apply a mutation to one agent's server table. The whole parsed document is
 * kept so unknown top-level and sibling keys survive the round-trip.
 */
async function mutateAgentConfig(
  agent: McpAgentConfigEntry,
  serverName: string,
  value: unknown | undefined,
  backupsDir: string,
): Promise<{ written?: string; backup?: string }> {
  if (!agent.writable) {
    throw new Error(`${agent.displayName} config is read-only`)
  }
  if (agent.format === "codex-toml") {
    throw new Error(`writing ${agent.format} configs is not supported`)
  }
  const { content, doc } = await loadJsonConfig(agent)
  const containerPath = defaultContainerPath(agent)
  const container = valueAtPath(doc, containerPath)
  if (container !== undefined && !isPlainObject(container)) {
    throw new Error(
      `refusing to write ${agent.configPath}: "${containerPath.join(".")}" is not an object`,
    )
  }
  if (value === undefined && (!container || !(serverName in container))) return {}
  const edits = modify(content, [...containerPath, serverName], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  })
  const updated = applyEdits(content, edits)
  const backup = await backupConfig(agent, backupsDir)
  try {
    await atomicWriteText(agent.configPath, updated)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const backupNote = backup ? `（原配置保留，备份：${backup}）` : ""
    throw new Error(`${agent.displayName} 写入失败：${detail}${backupNote}`)
  }
  return { written: agent.configPath, ...(backup ? { backup } : {}) }
}

async function upsertAgentServer(
  agent: McpAgentConfigEntry,
  serverName: string,
  server: NormalizedMcpServer,
  backupsDir: string,
  commandRunner: McpCommandRunner,
): Promise<{ written?: string; backup?: string }> {
  const resolvedAgent = await resolveAgentConfig(agent)
  return withConfigWriteLock(resolvedAgent.configPath, async () => {
    if (server.unsupported && Object.keys(server.unsupported).length > 0) {
      throw new Error(
        `${agent.displayName} 的来源配置含有当前适配器不支持的字段：${Object.keys(server.unsupported).join(", ")}`,
      )
    }
    const existing = await scanAgent(resolvedAgent)
    if (existing.parseError) {
      if (resolvedAgent.format !== "codex-toml") {
        throw new Error(`cannot read ${agent.displayName} config: existing file is not valid JSON (${existing.parseError})`)
      }
      throw new Error(`cannot read ${agent.displayName} config: ${existing.parseError}`)
    }
    const existingEntry = existing.entries.find((entry) => entry.name === serverName)
    if (existingEntry?.normalized.unsupported && Object.keys(existingEntry.normalized.unsupported).length > 0) {
      throw new Error(
        `${agent.displayName} 的目标配置含有当前适配器不支持的字段，已拒绝覆盖：${Object.keys(existingEntry.normalized.unsupported).join(", ")}`,
      )
    }

    const configExisted = await pathExists(resolvedAgent.configPath)
    let outcome: { written?: string; backup?: string }
    if (resolvedAgent.writeStrategy === "codex-cli") {
      outcome = await mutateCodexConfig(resolvedAgent, serverName, server, backupsDir, commandRunner)
    } else if (resolvedAgent.writeStrategy === "openclaw-cli") {
      outcome = await mutateOpenClawConfig(resolvedAgent, serverName, server, backupsDir, commandRunner)
    } else {
      outcome = await mutateAgentConfig(
        resolvedAgent,
        serverName,
        serverToFormatEntry(resolvedAgent, server),
        backupsDir,
      )
    }

    const afterWrite = await scanAgent(resolvedAgent)
    const writtenEntry = afterWrite.entries.find((entry) => entry.name === serverName)
    if (afterWrite.parseError || !writtenEntry || signatureOf(writtenEntry.normalized) !== signatureOf(server)) {
      try {
        if (outcome.backup) await fs.copyFile(outcome.backup, resolvedAgent.configPath)
        else if (!configExisted) await fs.rm(resolvedAgent.configPath, { force: true })
      } catch (error) {
        throw new Error(
          `${agent.displayName} 写后回读不匹配，且恢复失败：${error instanceof Error ? error.message : String(error)}${outcome.backup ? `（备份：${outcome.backup}）` : ""}`,
        )
      }
      throw new Error(
        `${agent.displayName} 写后回读与来源语义不一致，已恢复原配置${outcome.backup ? `（备份：${outcome.backup}）` : ""}`,
      )
    }
    return outcome
  })
}

async function removeAgentServer(
  agent: McpAgentConfigEntry,
  serverName: string,
  backupsDir: string,
  commandRunner: McpCommandRunner,
): Promise<{ written?: string; backup?: string }> {
  const resolvedAgent = await resolveAgentConfig(agent)
  return withConfigWriteLock(resolvedAgent.configPath, async () => {
    if (resolvedAgent.writeStrategy === "codex-cli") {
      return mutateCodexConfig(resolvedAgent, serverName, null, backupsDir, commandRunner)
    }
    if (resolvedAgent.writeStrategy === "openclaw-cli") {
      return mutateOpenClawConfig(resolvedAgent, serverName, null, backupsDir, commandRunner)
    }
    return mutateAgentConfig(resolvedAgent, serverName, undefined, backupsDir)
  })
}

function findAgent(
  registry: McpAgentConfigEntry[],
  agentId: string,
): McpAgentConfigEntry | null {
  return registry.find((agent) => agent.id === agentId) ?? null
}

async function collectAgentEntries(
  registry: McpAgentConfigEntry[],
  agentId: string,
): Promise<RawServerEntry[]> {
  const agent = findAgent(registry, agentId)
  if (!agent) return []
  const result = await scanAgent(agent)
  if (result.parseError) {
    throw new Error(`cannot read ${agent.displayName} config: ${result.parseError}`)
  }
  return result.entries
}

// ---------------------------------------------------------------------------
// Public write operations
// ---------------------------------------------------------------------------

export async function setMcpConnection(
  serverName: string,
  agentId: string,
  enable: boolean,
  sourceAgentId?: string,
  options: McpWriteOptions = {},
): Promise<McpWriteResult> {
  const registry = options.registry ?? mcpAgentRegistry
  const backupsDir = options.backupsDir ?? DEFAULT_BACKUPS_DIR
  const commandRunner = options.commandRunner ?? runCommand
  try {
    if (typeof serverName !== "string" || serverName.length === 0) {
      return fail("server name must be a non-empty string")
    }
    const agent = findAgent(registry, agentId)
    if (!agent) return fail(`unknown agent: ${agentId}`)
    if (!agent.writable) return fail(`${agent.displayName} config is read-only`)

    if (!enable) {
      const outcome = await removeAgentServer(agent, serverName, backupsDir, commandRunner)
      return {
        ok: true,
        written: outcome.written ? [outcome.written] : [],
        backups: outcome.backup ? [outcome.backup] : [],
      }
    }

    if (!(await isAgentInstalled(agent))) {
      return fail(`${agent.displayName} is not installed`)
    }
    const candidates: Array<{ agentId: string; entry: RawServerEntry }> = []
    for (const other of registry) {
      const result = await scanAgent(other)
      if (result.parseError) continue
      for (const entry of result.entries) {
        if (entry.name === serverName) candidates.push({ agentId: other.id, entry })
      }
    }
    if (candidates.length === 0) {
      return fail(`server "${serverName}" is not configured in any agent`)
    }

    let source: RawServerEntry | undefined
    if (sourceAgentId) {
      source = candidates.find((candidate) => candidate.agentId === sourceAgentId)?.entry
      if (!source) {
        return fail(`server "${serverName}" is not configured in source agent ${sourceAgentId}`)
      }
    } else {
      const variants = new Set(candidates.map(({ entry }) => signatureOf(entry.normalized)))
      if (variants.size > 1) {
        return fail(`server "${serverName}" has different configurations; choose a source agent`)
      }
      source = candidates[0].entry
    }

    const outcome = await upsertAgentServer(
      agent,
      serverName,
      source.normalized,
      backupsDir,
      commandRunner,
    )
    return {
      ok: true,
      written: outcome.written ? [outcome.written] : [],
      backups: outcome.backup ? [outcome.backup] : [],
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

export async function syncMcpServer(
  serverName: string,
  sourceAgentId: string,
  targetAgentIds: string[],
  options: McpWriteOptions = {},
): Promise<McpWriteResult> {
  const registry = options.registry ?? mcpAgentRegistry
  const backupsDir = options.backupsDir ?? DEFAULT_BACKUPS_DIR
  const commandRunner = options.commandRunner ?? runCommand
  try {
    if (typeof serverName !== "string" || serverName.length === 0) {
      return fail("server name must be a non-empty string")
    }
    const source = findAgent(registry, sourceAgentId)
    if (!source) return fail(`unknown agent: ${sourceAgentId}`)
    const sourceEntries = await collectAgentEntries(registry, sourceAgentId)
    const sourceEntry = sourceEntries.find((entry) => entry.name === serverName)
    if (!sourceEntry) {
      return fail(`server "${serverName}" is not configured in ${source.displayName}`)
    }

    const acc = new WriteAccumulator()
    for (const targetId of targetAgentIds) {
      const target = findAgent(registry, targetId)
      if (!target) {
        acc.errors.push(`unknown agent: ${targetId}`)
        continue
      }
      if (target.id === source.id) continue
      if (!target.writable) {
        acc.errors.push(`${target.displayName}: config is read-only`)
        continue
      }
      try {
        if (!(await isAgentInstalled(target))) {
          throw new Error(`${target.displayName} is not installed`)
        }
        const outcome = await upsertAgentServer(
          target,
          serverName,
          sourceEntry.normalized,
          backupsDir,
          commandRunner,
        )
        if (outcome.written) acc.written.push(outcome.written)
        if (outcome.backup) acc.backups.push(outcome.backup)
      } catch (error) {
        acc.errors.push(
          `${target.displayName}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return acc.result()
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

const SERVER_NAME_PATTERN = /^[A-Za-z0-9._-]+$/
const MAX_SERVER_NAME_LENGTH = 64

export function validateServerName(name: unknown): string | null {
  if (typeof name !== "string" || name.length === 0) return "MCP 名称不能为空"
  if (name.length > MAX_SERVER_NAME_LENGTH) {
    return `MCP 名称不能超过 ${MAX_SERVER_NAME_LENGTH} 个字符`
  }
  if (!SERVER_NAME_PATTERN.test(name) || name.includes("..")) {
    return "MCP 名称只能包含字母、数字、点、下划线和连字符"
  }
  return null
}

function validateServerInput(input: McpServerInput): string | null {
  const nameError = validateServerName(input?.name)
  if (nameError) return nameError
  if (input.type === "stdio") {
    if (typeof input.command !== "string" || input.command.length === 0) {
      return "stdio 类型需要填写启动命令"
    }
    if (input.args !== undefined) {
      if (!Array.isArray(input.args) || input.args.some((arg) => typeof arg !== "string")) {
        return "参数必须是字符串数组"
      }
    }
    if (input.cwd !== undefined && typeof input.cwd !== "string") {
      return "工作目录必须是字符串"
    }
    if (input.env !== undefined) {
      if (!isPlainObject(input.env) || Object.values(input.env).some((v) => typeof v !== "string")) {
        return "环境变量必须是字符串键值对"
      }
    }
    return null
  }
  if (input.type === "http") {
    if (typeof input.url !== "string" || input.url.length === 0) {
      return "HTTP 类型需要填写 URL"
    }
    if (
      input.headers !== undefined &&
      (!isPlainObject(input.headers) || Object.values(input.headers).some((v) => typeof v !== "string"))
    ) {
      return "请求头必须是字符串键值对"
    }
    return null
  }
  return '类型必须是 "stdio" 或 "http"'
}

export async function addMcpServer(
  input: McpServerInput,
  agentIds: string[],
  options: McpWriteOptions = {},
): Promise<McpWriteResult> {
  const registry = options.registry ?? mcpAgentRegistry
  const backupsDir = options.backupsDir ?? DEFAULT_BACKUPS_DIR
  const commandRunner = options.commandRunner ?? runCommand
  const inputError = validateServerInput(input)
  if (inputError) return fail(inputError)

  const normalized: NormalizedMcpServer =
    input.type === "http"
      ? {
          type: "http",
          url: input.url,
          ...(input.headers && Object.keys(input.headers).length > 0 ? { headers: input.headers } : {}),
          ...(input.transport ? { transport: input.transport } : { transport: "http" as const }),
        }
      : {
          type: "stdio",
          command: input.command,
          ...(input.args && input.args.length > 0 ? { args: input.args } : {}),
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
        }

  const acc = new WriteAccumulator()
  for (const agentId of agentIds) {
    const agent = findAgent(registry, agentId)
    if (!agent) {
      acc.errors.push(`unknown agent: ${agentId}`)
      continue
    }
    try {
      if (!(await isAgentInstalled(agent))) {
        throw new Error(`${agent.displayName} is not installed`)
      }
      const existing = await collectAgentEntries(registry, agent.id)
      if (existing.some((entry) => entry.name === input.name)) {
        throw new Error(`server "${input.name}" already exists in ${agent.displayName}`)
      }
      const outcome = await upsertAgentServer(
        agent,
        input.name,
        normalized,
        backupsDir,
        commandRunner,
      )
      if (outcome.written) acc.written.push(outcome.written)
      if (outcome.backup) acc.backups.push(outcome.backup)
    } catch (error) {
      acc.errors.push(
        `${agent.displayName}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return acc.result()
}

export async function removeMcpServer(
  serverName: string,
  options: McpWriteOptions = {},
): Promise<McpWriteResult> {
  const registry = options.registry ?? mcpAgentRegistry
  const backupsDir = options.backupsDir ?? DEFAULT_BACKUPS_DIR
  const commandRunner = options.commandRunner ?? runCommand
  if (typeof serverName !== "string" || serverName.length === 0) {
    return fail("server name must be a non-empty string")
  }
  const acc = new WriteAccumulator()
  for (const agent of registry) {
    if (!agent.writable) continue
    try {
      const outcome = await removeAgentServer(agent, serverName, backupsDir, commandRunner)
      if (outcome.written) acc.written.push(outcome.written)
      if (outcome.backup) acc.backups.push(outcome.backup)
    } catch (error) {
      acc.errors.push(
        `${agent.displayName}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return acc.result()
}

// ---------------------------------------------------------------------------
// Reveal config file in the OS file manager
// ---------------------------------------------------------------------------

function pathsEqual(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value)
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }
  return normalize(left) === normalize(right)
}

export async function openMcpConfig(
  configPath: string,
  registry: McpAgentConfigEntry[] = mcpAgentRegistry,
): Promise<void> {
  // Only registered agent config paths may be opened -- never arbitrary paths.
  const match = registry.find((agent) =>
    configPathsOf(agent).some((registeredPath) => pathsEqual(registeredPath, configPath)),
  )
  if (!match) {
    throw new Error("path is not a registered MCP agent config")
  }
  const { shell } = await import("electron")
  shell.showItemInFolder(configPath)
}
