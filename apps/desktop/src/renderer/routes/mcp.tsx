import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { electronAPI } from "../lib/electron-api"
import { AgentLogo } from "../components/agent-logo"
import { SidebarUtilities, SkillboxBrand } from "../components/skillbox-brand"
import {
  FavoritesNavLink,
  McpNavLink,
  McpAgentStack,
  PlugIcon,
  notifyFavoritesChanged,
} from "../components/mcp-nav"
import { useInstalledSkills } from "../lib/installed-skills"
import { CopySkillName } from "../components/copy-name"
import { HomeNavLink } from "../components/home-nav"
import { getMcpConnectionSummary } from "../lib/mcp-display"
import { useDisplayAliases, setMcpAlias } from "../lib/display-aliases"
import { AliasTitle } from "../components/alias-title"
import { SupportAuthorButton } from "../components/support-author"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MCP_AUTHORITY_STORAGE_KEY = "skillbox.mcp.authoritativeAgents"

function readMcpAuthorities(): Record<string, string> {
  try {
    const stored = window.localStorage.getItem(MCP_AUTHORITY_STORAGE_KEY)
    const parsed: unknown = stored ? JSON.parse(stored) : null
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
  } catch {
    return {}
  }
}

function serverCommandLine(server: McpServerEntry): string {
  if (server.type === "http") return server.url || "—"
  return [server.command, ...(server.args ?? [])].filter(Boolean).join(" ") || "—"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseArgsInput(value: string): { args?: string[]; error?: string } {
  const input = value.trim()
  if (!input) return {}
  const args: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (quote) {
      if (char === quote) {
        quote = null
      } else if (char === "\\" && input[index + 1] === quote) {
        current += quote
        index++
      } else {
        current += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ""
      }
    } else {
      current += char
    }
  }
  if (quote) return { error: "参数中有未闭合的引号" }
  if (current) args.push(current)
  return { args }
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, same stroke style as discover.tsx)
// ---------------------------------------------------------------------------

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="text-muted"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  )
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "skillbox-mcp-spin" : undefined}
    >
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

function WarnIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3L2 20h20L12 3z" />
      <path d="M12 10v4M12 17.2v.1" />
    </svg>
  )
}

function Spinner() {
  return (
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
  )
}

// Same star glyph as the skill rows on the library page.
function StarIcon({ size = 14, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function CopyIcon({ checked = false }: { checked?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {checked ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>}
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

interface McpSidebarProps {
  agents: McpAgentInfo[]
  agentFilter: string | null
  onSelectAgent: (agentId: string | null) => void
  perAgentCounts: Map<string, number>
}

function McpSidebar({ agents, agentFilter, onSelectAgent, perAgentCounts }: McpSidebarProps) {
  const installedSkills = useInstalledSkills()
  const skillCount = installedSkills ? installedSkills.length : null
  // 接入数为 0 的 Agent 不显示，接入后自然出现。
  const visibleAgents = agents.filter(
    (agent) => (perAgentCounts.get(agent.id) ?? 0) > 0 || agent.id === agentFilter,
  )
  return (
    <aside className="skillbox-sidebar">
      <div className="skillbox-sidebar__scroll">
        <SkillboxBrand />
        <section className="skillbox-nav-section">
          <h3>Library</h3>
          <nav className="flex flex-col gap-1">
            <HomeNavLink />
            <NavLink to="/library" className="skillbox-library-button">
              <span>⌘ All Skills</span>
              {skillCount !== null && <strong>{skillCount}</strong>}
            </NavLink>
            <McpNavLink />
            <FavoritesNavLink />
          </nav>
        </section>
        {visibleAgents.length > 0 && (
          <section className="skillbox-nav-section skillbox-agent-section">
            <h3>Agents <span>点击筛选 MCP</span></h3>
            <nav className="flex flex-col gap-1.5">
              {visibleAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onSelectAgent(agentFilter === agent.id ? null : agent.id)}
                  className={`skillbox-agent-button ${agentFilter === agent.id ? "is-active" : ""}`}
                  aria-pressed={agentFilter === agent.id}
                >
                  <AgentLogo name={agent.displayName} size={25} />
                  <span data-no-localize className="truncate">{agent.displayName}</span>
                  <span className={`skillbox-agent-count ${(perAgentCounts.get(agent.id) ?? 0) === 0 ? "is-empty" : ""}`}>
                    {perAgentCounts.get(agent.id) ?? 0}
                  </span>
                </button>
              ))}
            </nav>
          </section>
        )}
      </div>
      <div className="skillbox-market-area">
        <p>Market</p>
        <NavLink to="/discover" className="skillbox-market-button">
          <span>▣ Skill Market</span>
          <small>在线目录</small>
        </NavLink>
        <SidebarUtilities />
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Server detail panel
// ---------------------------------------------------------------------------

interface ServerPanelProps {
  server: McpServerEntry
  agents: McpAgentInfo[]
  agentById: Map<string, McpAgentInfo>
  pendingConnections: Set<string>
  sourceAgentId?: string
  busy: boolean
  onSelectSource: (agentId: string) => void
  onToggleConnection: (
    server: McpServerEntry,
    agent: McpAgentInfo,
    enable: boolean,
    sourceAgentId?: string,
  ) => void
  onSync: (server: McpServerEntry, sourceAgentId: string, targetAgentIds: string[]) => void
  onOpenConfig: (configPath: string) => void
  onClose: () => void
  onRemove: (server: McpServerEntry) => void
}

function ServerPanel({
  server,
  agents,
  agentById,
  pendingConnections,
  sourceAgentId,
  busy,
  onSelectSource,
  onToggleConnection,
  onSync,
  onOpenConfig,
  onClose,
  onRemove,
}: ServerPanelProps) {
  const [agentQuery, setAgentQuery] = useState("")
  const mcpAliases = useDisplayAliases().mcp
  const [copied, setCopied] = useState<"name" | "command" | "path" | null>(null)
  const selectedSource = server.connections.find((c) => c.agentId === sourceAgentId)
  const effectiveSource = selectedSource ?? (!sourceAgentId && server.consistent ? server.connections[0] : undefined)
  const displayConnection = effectiveSource ?? server.connections[0]
  const syncTargets = effectiveSource
    ? server.connections.filter(
        (connection) =>
          connection.agentId !== effectiveSource.agentId &&
          connection.signature !== effectiveSource.signature &&
          agentById.get(connection.agentId)?.writable,
      )
    : []
  const connectedIds = new Set(server.connections.map((c) => c.agentId))
  const installedConnectionCount = getMcpConnectionSummary(server, agents).installed.length
  const historicalConnectionCount = server.connections.length - installedConnectionCount
  const query = agentQuery.trim().toLowerCase()
  const visibleConnections = server.connections.filter((connection) => {
    const agent = agentById.get(connection.agentId)
    return !query || (agent?.displayName ?? connection.agentId).toLowerCase().includes(query)
  }).sort((a, b) => Number(Boolean(agentById.get(b.agentId)?.installed)) - Number(Boolean(agentById.get(a.agentId)?.installed)))
  const connectable = agents.filter(
    (agent) =>
      agent.installed &&
      !connectedIds.has(agent.id) &&
      (!query || agent.displayName.toLowerCase().includes(query)),
  )
  const variantLabels = new Map<string, number>()
  for (const connection of server.connections) {
    if (!variantLabels.has(connection.signature)) {
      variantLabels.set(connection.signature, variantLabels.size + 1)
    }
  }

  const copyText = async (value: string, field: "name" | "command" | "path") => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(field)
      window.setTimeout(() => setCopied((current) => current === field ? null : current), 1500)
    } catch {
      setCopied(null)
    }
  }

  const envKeys = displayConnection?.envKeys ?? []
  const headerKeys = displayConnection?.headerKeys ?? []
  const isWindowsCommandWrapper =
    displayConnection?.type === "stdio" &&
    displayConnection.command?.toLowerCase() === "cmd" &&
    displayConnection.args?.[0]?.toLowerCase() === "/c"
  const commandValue =
    displayConnection?.type === "http"
      ? displayConnection.url || "无"
      : isWindowsCommandWrapper
        ? displayConnection?.args?.slice(1).join(" ") || "无"
        : [displayConnection?.command, ...(displayConnection?.args ?? [])].filter(Boolean).join(" ") || "无"
  const argsValue =
    displayConnection?.type === "http" || isWindowsCommandWrapper
      ? "无"
      : displayConnection?.args?.join(" ") || "无"
  const primaryPath = displayConnection?.configPath ?? "无"

  return (
    <aside className="skillbox-mcp-detail" aria-label={`${server.name} 详情`}>
      <div className="skillbox-mcp-detail__scroll">
        <header className="skillbox-mcp-detail__header">
          <div className="skillbox-mcp-detail__heading">
            <AliasTitle
              name={server.name}
              alias={mcpAliases[server.name]}
              onSave={(value) => void setMcpAlias(server.name, value)}
            />
            <CopySkillName name={server.name} label="MCP 名称" />
          </div>
          <div className="skillbox-mcp-detail__actions">
            <button type="button" className="skillbox-mcp-detail__open" disabled={!displayConnection} onClick={() => displayConnection && onOpenConfig(displayConnection.configPath)}>
              打开配置
            </button>
            <button type="button" className="skillbox-mcp-detail__icon is-danger" title="删除 MCP" aria-label={`删除 ${server.name}`} disabled={busy} onClick={() => onRemove(server)}>
              <TrashIcon />
            </button>
            <button type="button" className="skillbox-mcp-detail__icon" title="关闭详情" aria-label="关闭详情" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
        </header>

        <p className="skillbox-mcp-detail__description">
          {displayConnection?.type === "http"
            ? "通过远程地址连接的 MCP 服务。可在此管理各 Agent 的接入，并检查配置是否一致。"
            : "通过本地命令启动的 MCP 服务。可在此管理各 Agent 的接入，并检查配置是否一致。"}
        </p>

        <section className="skillbox-mcp-agent-card">
          <div className="skillbox-mcp-agent-card__head">
            <div>
              <h2>Agent 接入 <span>{installedConnectionCount}/{agents.filter((agent) => agent.installed).length}</span></h2>
              <p>{selectedSource ? `权威配置：${agentById.get(selectedSource.agentId)?.displayName ?? selectedSource.agentId}` : "尚未指定权威 Agent；可在已接入列表中选择"}</p>
            </div>
            <div className="skillbox-mcp-agent-card__tools">
              <small>运行中的 Agent 可能需要重启或重新加载</small>
              <label className="skillbox-mcp-agent-search">
                <SearchIcon size={13} />
                <input
                  aria-label="筛选全部 Agent"
                  value={agentQuery}
                  onChange={(event) => setAgentQuery(event.target.value)}
                  placeholder="筛选全部 Agent…"
                />
              </label>
            </div>
          </div>

          {!server.consistent && (
            <div className="skillbox-mcp-detail__drift">
              <WarnIcon />
              <span>
                {sourceAgentId && !selectedSource
                  ? "已指定的权威 Agent 当前没有此配置，请重新指定。"
                  : selectedSource
                    ? `检测到 ${variantLabels.size} 个配置版本，将以 ${agentById.get(selectedSource.agentId)?.displayName ?? selectedSource.agentId} 为准。`
                    : `检测到 ${variantLabels.size} 个配置版本，请先指定权威 Agent。`}
              </span>
              {effectiveSource && syncTargets.length > 0 && (
                <button type="button" disabled={busy} onClick={() => onSync(server, effectiveSource.agentId, syncTargets.map((connection) => connection.agentId))}>
                  {busy ? "同步中…" : `同步 ${syncTargets.length} 项`}
                </button>
              )}
            </div>
          )}

          <div className="skillbox-mcp-agent-group">
            <div className="skillbox-mcp-agent-group__title">
              <span><ChevronIcon /> 已接入 <b>{installedConnectionCount}</b>{historicalConnectionCount > 0 && <small>另有 {historicalConnectionCount} 处历史配置</small>}</span>
            </div>
            <div className="skillbox-mcp-connected-list">
              {visibleConnections.map((connection) => {
                const agent = agentById.get(connection.agentId)
                const pending = pendingConnections.has(`${server.name}:${connection.agentId}`)
                const writable = agent?.writable ?? false
                const isSource = selectedSource?.agentId === connection.agentId
                return (
                  <div key={connection.agentId} className={`skillbox-mcp-agent-row ${agent?.installed ? "" : "is-historical"}`}>
                    <AgentLogo name={agent?.displayName ?? connection.agentId} size={27} />
                    <button type="button" className="skillbox-mcp-agent-row__info" title={`打开 ${connection.configPath}`} onClick={() => onOpenConfig(connection.configPath)}>
                      <strong data-no-localize>{agent?.displayName ?? connection.agentId}{!agent?.installed ? " · 未安装" : ""}</strong>
                      <small data-no-localize>{connection.configPath}</small>
                    </button>
                    <button type="button" className={`skillbox-mcp-source-button ${isSource ? "is-selected" : ""}`} onClick={() => onSelectSource(connection.agentId)}>
                      {isSource ? "权威" : "设为权威"}
                    </button>
                    <button
                      type="button"
                      className={`skillbox-mcp-detail-toggle is-on ${pending ? "is-pending" : ""}`}
                      disabled={!writable || pending}
                      aria-pressed="true"
                      aria-label={writable ? `从 ${agent?.displayName ?? connection.agentId} 移除` : "该 Agent 配置为只读"}
                      title={writable ? `从 ${agent?.displayName ?? connection.agentId} 移除` : "该 Agent 配置为只读"}
                      onClick={() => agent && onToggleConnection(server, agent, false)}
                    ><i /></button>
                  </div>
                )
              })}
              {visibleConnections.length === 0 && <p className="skillbox-mcp-agent-empty">没有匹配的已接入 Agent</p>}
            </div>
          </div>

          <div className="skillbox-mcp-agent-group is-unconnected">
            <div className="skillbox-mcp-agent-group__title">
              <span><ChevronIcon /> 未接入 <b>{agents.filter((agent) => agent.installed && !connectedIds.has(agent.id)).length}</b></span>
            </div>
            <div className="skillbox-mcp-unconnected-grid">
              {connectable.map((agent) => {
                const pending = pendingConnections.has(`${server.name}:${agent.id}`)
                const disabled = !agent.writable || !effectiveSource || pending
                return (
                  <div key={agent.id} className="skillbox-mcp-agent-row is-compact">
                    <AgentLogo name={agent.displayName} size={23} />
                    <strong data-no-localize title={agent.displayName}>{agent.displayName}</strong>
                    <button
                      type="button"
                      className={`skillbox-mcp-detail-toggle ${pending ? "is-pending" : ""}`}
                      disabled={disabled}
                      aria-pressed="false"
                      aria-label={effectiveSource ? `接入到 ${agent.displayName}` : "请先选择同步来源"}
                      title={!agent.writable ? "该 Agent 配置为只读" : effectiveSource ? `接入到 ${agent.displayName}` : "请先选择同步来源"}
                      onClick={() => onToggleConnection(server, agent, true, effectiveSource?.agentId)}
                    ><i /></button>
                  </div>
                )
              })}
              {connectable.length === 0 && <p className="skillbox-mcp-agent-empty">没有匹配的未接入 Agent</p>}
            </div>
          </div>
        </section>

        <div className="skillbox-mcp-detail__chips">
          <span>类型：<b>{displayConnection?.type ?? server.type}</b></span>
          <span>已接入：{installedConnectionCount} 个已安装 Agent</span>
          <span>环境变量：{envKeys.length}</span>
        </div>

        <section className="skillbox-mcp-meta">
          <div className="skillbox-mcp-meta__row">
            <strong>{displayConnection?.type === "http" ? "地址" : "命令"}</strong>
            <code data-no-localize>{commandValue}</code>
            <button type="button" title="复制" onClick={() => void copyText(commandValue, "command")}><CopyIcon checked={copied === "command"} /></button>
          </div>
          <div className="skillbox-mcp-meta__row">
            <strong>参数</strong>
            <span data-no-localize>{argsValue}</span>
          </div>
          <div className="skillbox-mcp-meta__row">
            <strong>环境变量</strong>
            <span data-no-localize>{envKeys.length > 0 ? envKeys.join("、") : "无"}</span>
          </div>
          {headerKeys.length > 0 && (
            <div className="skillbox-mcp-meta__row">
              <strong>请求头</strong>
              <span data-no-localize>{headerKeys.join("、")}</span>
            </div>
          )}
          <div className="skillbox-mcp-meta__row is-consistency">
            <strong>配置一致性</strong>
            <span className={server.consistent ? "is-ok" : "is-warn"}>
              <i aria-hidden="true">{server.consistent ? "✓" : "!"}</i>
              <span><b>{server.consistent ? "配置一致" : `${variantLabels.size} 个配置版本`}</b><small>所有已接入的 Agent 配置均参与检查</small></span>
            </span>
          </div>
          <div className="skillbox-mcp-meta__row">
            <strong>配置路径</strong>
            <code data-no-localize>{primaryPath}</code>
            <button type="button" title="复制" onClick={() => void copyText(primaryPath, "path")}><CopyIcon checked={copied === "path"} /></button>
          </div>
        </section>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Add MCP dialog
// ---------------------------------------------------------------------------

interface EnvRow {
  key: string
  value: string
}

interface AddDialogProps {
  agents: McpAgentInfo[]
  submitting: boolean
  error: string | null
  onClose: () => void
  onSubmit: (inputs: McpServerInput[], agentIds: string[]) => void
}

function parseJsonServers(
  text: string,
  fallbackName: string,
): { servers: McpServerInput[]; error?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { servers: [], error: "JSON 解析失败，请检查格式" }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { servers: [], error: "需要 JSON 对象" }
  }
  const root = parsed as Record<string, unknown>

  const toInput = (name: string, config: unknown): McpServerInput | string => {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return `「${name}」的配置不是对象`
    }
    const cfg = config as Record<string, unknown>
    const url =
      typeof cfg.httpUrl === "string"
        ? cfg.httpUrl
        : typeof cfg.url === "string"
          ? cfg.url
          : undefined
    const commandParts = Array.isArray(cfg.command)
      ? cfg.command.filter((part): part is string => typeof part === "string")
      : []
    const command =
      typeof cfg.command === "string" ? cfg.command : commandParts.length > 0 ? commandParts[0] : undefined
    const args = Array.isArray(cfg.args)
      ? cfg.args.filter((a): a is string => typeof a === "string")
      : commandParts.length > 1
        ? commandParts.slice(1)
        : undefined
    const cwd = typeof cfg.cwd === "string" ? cfg.cwd : undefined
    const env =
      (cfg.env ?? cfg.environment) &&
      typeof (cfg.env ?? cfg.environment) === "object" &&
      !Array.isArray(cfg.env ?? cfg.environment)
        ? Object.fromEntries(
            Object.entries((cfg.env ?? cfg.environment) as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === "string",
            ),
          )
        : undefined
    const headers =
      cfg.headers && typeof cfg.headers === "object" && !Array.isArray(cfg.headers)
        ? Object.fromEntries(
            Object.entries(cfg.headers as Record<string, unknown>).filter(
              (e): e is [string, string] => typeof e[1] === "string",
            ),
          )
        : undefined
    if (url) {
      return {
        name,
        type: "http",
        url,
        headers,
        transport: cfg.type === "sse" || cfg.transport === "sse" ? "sse" : "http",
      }
    }
    if (command) {
      return { name, type: "stdio", command, args, cwd, env }
    }
    return `「${name}」缺少 command 或 url`
  }

  const nestedMcp =
    root.mcp && typeof root.mcp === "object" && !Array.isArray(root.mcp)
      ? (root.mcp as Record<string, unknown>)
      : null
  const knownContainers: Array<{ label: string; value: unknown }> = [
    { label: "mcpServers", value: root.mcpServers },
    { label: "servers", value: root.servers },
    { label: "context_servers", value: root.context_servers },
    { label: "amp.mcpServers", value: root["amp.mcpServers"] },
    { label: "mcp.servers", value: nestedMcp?.servers },
    { label: "mcp", value: root.mcp },
  ]
  const detected = knownContainers.find(
    ({ value }) => value && typeof value === "object" && !Array.isArray(value),
  )
  if (detected) {
    const entries = Object.entries(detected.value as Record<string, unknown>)
    if (entries.length === 0) return { servers: [], error: `${detected.label} 为空` }
    const servers: McpServerInput[] = []
    for (const [name, config] of entries) {
      const result = toInput(name, config)
      if (typeof result === "string") return { servers: [], error: result }
      servers.push(result)
    }
    return { servers }
  }

  const name = fallbackName.trim()
  if (!name) {
    return { servers: [], error: "单条格式需要先在「名称」里填入 server 名" }
  }
  const result = toInput(name, root)
  if (typeof result === "string") return { servers: [], error: result }
  return { servers: [result] }
}

function AddMcpDialog({ agents, submitting, error, onClose, onSubmit }: AddDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<"json" | "form">("json")
  const [jsonText, setJsonText] = useState("")
  const [jsonName, setJsonName] = useState("")
  const [name, setName] = useState("")
  const [type, setType] = useState<McpServerType>("stdio")
  const [command, setCommand] = useState("")
  const [args, setArgs] = useState("")
  const [url, setUrl] = useState("")
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const first =
      dialog.querySelector<HTMLElement>(".skillbox-mcp-textarea, .skillbox-mcp-input") ??
      dialog.querySelector<HTMLElement>(focusableSelector)
    first?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab") return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      if (focusable.length === 0) return
      const head = focusable[0]
      const tail = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault()
        tail.focus()
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault()
        head.focus()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose, submitting])

  const writableAgents = agents.filter((a) => a.installed && a.writable)
  const readonlyAgents = agents.filter((a) => a.installed && !a.writable)
  const [selected, setSelected] = useState<string[]>(() => writableAgents.map((a) => a.id))

  function toggleAgent(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((v) => v !== id) : [...current, id],
    )
  }

  function handleSubmit() {
    setLocalError(null)
    let inputs: McpServerInput[]
    if (tab === "json") {
      if (!jsonText.trim()) {
        setLocalError("请粘贴 MCP server 的 JSON 配置")
        return
      }
      const parsed = parseJsonServers(jsonText, jsonName)
      if (parsed.error) {
        setLocalError(parsed.error)
        return
      }
      inputs = parsed.servers
    } else {
      const trimmedName = name.trim()
      if (!trimmedName) {
        setLocalError("请填写名称")
        return
      }
      if (type === "stdio" && !command.trim()) {
        setLocalError("stdio 类型需要填写 command")
        return
      }
      if (type === "http" && !url.trim()) {
        setLocalError("http 类型需要填写 url")
        return
      }
      const env: Record<string, string> = {}
      for (const row of envRows) {
        if (row.key.trim()) env[row.key.trim()] = row.value
      }
      const parsedArgs = parseArgsInput(args)
      if (parsedArgs.error) {
        setLocalError(parsedArgs.error)
        return
      }
      inputs = [
        type === "http"
          ? { name: trimmedName, type: "http", url: url.trim() }
          : {
              name: trimmedName,
              type: "stdio",
              command: command.trim(),
              args: parsedArgs.args,
              env: Object.keys(env).length > 0 ? env : undefined,
            },
      ]
    }
    if (selected.length === 0) {
      setLocalError("请至少选择一个要写入的 Agent")
      return
    }
    onSubmit(inputs, selected)
  }

  const visibleError = localError || error

  return (
    <div className="skillbox-modal-backdrop" onClick={() => !submitting && onClose()}>
      <div
        ref={dialogRef}
        className="skillbox-mcp-modal"
        role="dialog"
        aria-modal="true"
        aria-label="添加 MCP"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="skillbox-mcp-modal__head">
          <div>
            <h2>添加 MCP</h2>
            <p>接入一个 MCP server，并写入所选 Agent 的配置文件。</p>
          </div>
          <button type="button" className="skillbox-mcp-modal__close" disabled={submitting} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="skillbox-mcp-modal__tabs">
          <button
            type="button"
            className={tab === "json" ? "is-active" : ""}
            onClick={() => setTab("json")}
          >
            粘贴 JSON
          </button>
          <button
            type="button"
            className={tab === "form" ? "is-active" : ""}
            onClick={() => setTab("form")}
          >
            表单
          </button>
        </div>

        <div className="skillbox-mcp-modal__body">
          {tab === "json" ? (
            <>
              <label className="skillbox-mcp-field">
                <span>
                  JSON 配置 <em>支持常见 Agent 完整配置或单条 server</em>
                </span>
                <textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  rows={8}
                  spellCheck={false}
                  placeholder={'{\n  "mcpServers": {\n    "github": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-github"]\n    }\n  }\n}'}
                  className="skillbox-mcp-textarea"
                />
              </label>
              <label className="skillbox-mcp-field">
                <span>
                  名称 <em>仅单条格式需要</em>
                </span>
                <input
                  type="text"
                  value={jsonName}
                  onChange={(e) => setJsonName(e.target.value)}
                  placeholder="my-server"
                  className="skillbox-mcp-input"
                />
              </label>
            </>
          ) : (
            <>
              <label className="skillbox-mcp-field">
                <span>名称</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="brave-search"
                  className="skillbox-mcp-input"
                />
              </label>
              <label className="skillbox-mcp-field">
                <span>类型</span>
                <div className="skillbox-mcp-segmented">
                  <button
                    type="button"
                    className={type === "stdio" ? "is-active" : ""}
                    onClick={() => setType("stdio")}
                  >
                    stdio
                  </button>
                  <button
                    type="button"
                    className={type === "http" ? "is-active" : ""}
                    onClick={() => setType("http")}
                  >
                    http
                  </button>
                </div>
              </label>
              {type === "stdio" ? (
                <>
                  <label className="skillbox-mcp-field">
                    <span>启动命令 command</span>
                    <input
                      type="text"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="npx"
                      className="skillbox-mcp-input"
                    />
                  </label>
                  <label className="skillbox-mcp-field">
                    <span>
                      参数 args <em>空格分隔</em>
                    </span>
                    <input
                      type="text"
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder="-y @modelcontextprotocol/server-brave-search"
                      className="skillbox-mcp-input"
                    />
                  </label>
                  <div className="skillbox-mcp-field">
                    <span>
                      环境变量 <em>可选 · KEY=VALUE</em>
                    </span>
                    {envRows.map((row, index) => (
                      <div key={index} className="skillbox-mcp-env-row">
                        <input
                          type="text"
                          value={row.key}
                          onChange={(e) =>
                            setEnvRows((rows) =>
                              rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)),
                            )
                          }
                          placeholder="KEY"
                          className="skillbox-mcp-input"
                        />
                        <span className="skillbox-mcp-env-row__eq">=</span>
                        <input
                          type="text"
                          value={row.value}
                          onChange={(e) =>
                            setEnvRows((rows) =>
                              rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)),
                            )
                          }
                          placeholder="VALUE"
                          className="skillbox-mcp-input"
                        />
                        <button
                          type="button"
                          className="skillbox-mcp-env-row__remove"
                          aria-label="删除该环境变量"
                          onClick={() => setEnvRows((rows) => rows.filter((_, i) => i !== index))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="skillbox-mcp-env-row__add"
                      onClick={() => setEnvRows((rows) => [...rows, { key: "", value: "" }])}
                    >
                      + 添加环境变量
                    </button>
                    <small>密钥仅保存在本地配置文件，不上传。</small>
                  </div>
                </>
              ) : (
                <label className="skillbox-mcp-field">
                  <span>URL</span>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="http://127.0.0.1:3845/mcp"
                    className="skillbox-mcp-input"
                  />
                </label>
              )}
            </>
          )}

          <div className="skillbox-mcp-field">
            <span>
              接入到以下 Agent <em>已安装 {writableAgents.length + readonlyAgents.length} 个</em>
            </span>
            <div className="skillbox-mcp-agentpick">
              {writableAgents.map((agent) => {
                const checked = selected.includes(agent.id)
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className="skillbox-mcp-agentrow"
                    aria-pressed={checked}
                    onClick={() => toggleAgent(agent.id)}
                  >
                    <AgentLogo name={agent.displayName} size={22} />
                    <span className="skillbox-mcp-agentrow__meta">
                      <span data-no-localize>{agent.displayName}</span>
                      <small data-no-localize>{agent.configPath}</small>
                    </span>
                    <span className={`skillbox-mcp-check ${checked ? "is-on" : ""}`}>
                      {checked && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 12.5l5 5L20 6.5" />
                        </svg>
                      )}
                    </span>
                  </button>
                )
              })}
              {readonlyAgents.map((agent) => (
                <div key={agent.id} className="skillbox-mcp-agentrow is-disabled">
                  <AgentLogo name={agent.displayName} size={22} />
                  <span className="skillbox-mcp-agentrow__meta">
                    <span data-no-localize>{agent.displayName}</span>
                    <small data-no-localize>{agent.configPath}</small>
                  </span>
                  <span className="skillbox-mcp-readonly-tag">只读</span>
                </div>
              ))}
            </div>
          </div>

          {visibleError && <p className="skillbox-mcp-modal__error">{visibleError}</p>}
        </div>

        <div className="skillbox-mcp-modal__foot">
          <span className="skillbox-mcp-modal__note">
            将写入 {selected.length} 个配置文件，格式自动适配 JSON / TOML。
          </span>
          <button type="button" className="skillbox-mcp-button-ghost" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="skillbox-mcp-button-primary"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? "写入中…" : "添加 MCP"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MCP library page (main export)
// ---------------------------------------------------------------------------

export function Mcp() {
  const location = useLocation()
  const [library, setLibrary] = useState<McpLibrary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [agentFilter, setAgentFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<"all" | McpServerType>("all")
  const [onlyDrift, setOnlyDrift] = useState(false)
  const [expandedName, setExpandedName] = useState<string | null>(null)
  const [favoriteServers, setFavoriteServers] = useState<Set<string>>(() => new Set())
  const [sourceByServer, setSourceByServer] = useState<Record<string, string>>(readMcpAuthorities)
  const [showAdd, setShowAdd] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [pendingConnections, setPendingConnections] = useState<Set<string>>(() => new Set())
  const [pendingServers, setPendingServers] = useState<Set<string>>(() => new Set())
  const [writeFeedback, setWriteFeedback] = useState<{
    title: string
    detail: string
    support?: boolean
  } | null>(null)
  const mcpAliases = useDisplayAliases().mcp

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true)
    else setRefreshing(true)
    try {
      const data = await electronAPI.mcpListLibrary()
      setLibrary(data)
    } catch (error) {
      setWriteError(`扫描失败：${errorMessage(error)}`)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(true)
    return electronAPI.onMcpUpdated((updated) => {
      setLibrary(updated)
    })
  }, [load])

  useEffect(() => {
    const state = location.state as { serverName?: unknown } | null
    if (typeof state?.serverName === "string") setExpandedName(state.serverName)
  }, [location.state])

  useEffect(() => {
    electronAPI
      .favoritesList()
      .then((names) => {
        setFavoriteServers(
          new Set(
            names
              .filter((name) => name.startsWith("mcp:"))
              .map((name) => name.slice(4)),
          ),
        )
      })
      .catch(() => {})
  }, [])

  async function toggleFavoriteServer(name: string) {
    const previous = favoriteServers
    const next = new Set(previous)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setFavoriteServers(next)
    try {
      await electronAPI.favoritesToggle(`mcp:${name}`)
      notifyFavoritesChanged()
    } catch {
      setFavoriteServers(previous)
    }
  }

  useEffect(() => {
    if (!writeFeedback) return
    const timeout = window.setTimeout(() => setWriteFeedback(null), 4200)
    return () => window.clearTimeout(timeout)
  }, [writeFeedback])

  const agents = useMemo(() => library?.agents ?? [], [library])
  const installedAgents = useMemo(() => agents.filter((a) => a.installed), [agents])
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const servers = useMemo(() => library?.servers ?? [], [library])

  function selectMcpAuthority(serverName: string, agentId: string) {
    const next = { ...sourceByServer, [serverName]: agentId }
    setSourceByServer(next)
    try {
      window.localStorage.setItem(MCP_AUTHORITY_STORAGE_KEY, JSON.stringify(next))
    } catch {
      setWriteError("无法保存该 MCP 的权威 Agent，请检查应用存储空间。")
    }
  }

  const connectionCount = useMemo(
    () => servers.reduce((n, s) => n + getMcpConnectionSummary(s, agents).installed.length, 0),
    [agents, servers],
  )
  const driftCount = useMemo(() => servers.filter((s) => !s.consistent).length, [servers])
  const perAgentCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const server of servers) {
      for (const connection of server.connections) {
        counts.set(connection.agentId, (counts.get(connection.agentId) ?? 0) + 1)
      }
    }
    return counts
  }, [servers])

  const visibleServers = useMemo(() => {
    const q = query.trim().toLowerCase()
    return servers.filter((server) => {
      if (q && !server.name.toLowerCase().includes(q)) return false
      if (agentFilter && !server.connections.some((c) => c.agentId === agentFilter)) return false
      if (typeFilter !== "all" && server.type !== typeFilter) return false
      if (onlyDrift && server.consistent) return false
      return true
    })
  }, [servers, query, agentFilter, typeFilter, onlyDrift])

  useEffect(() => {
    if (!expandedName) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest(".skillbox-mcp-detail, .skillbox-mcp-library-row, .skillbox-modal-backdrop")) return
      setExpandedName(null)
    }
    document.addEventListener("pointerdown", handleOutsidePointerDown)
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown)
  }, [expandedName])

  async function runWrite(action: Promise<McpWriteResult>): Promise<boolean> {
    try {
      const result = await action
      if (!result.ok) {
        setWriteError(result.error || "操作失败")
        if (result.written.length > 0) await load()
        return false
      }
      setWriteError(null)
      await load()
      return true
    } catch (error) {
      setWriteError(errorMessage(error))
      return false
    }
  }

  async function handleToggleConnection(
    server: McpServerEntry,
    agent: McpAgentInfo,
    enable: boolean,
    sourceAgentId?: string,
  ) {
    if (!enable) {
      const ok = window.confirm(`确定从 ${agent.displayName} 移除「${server.name}」的接入吗？`)
      if (!ok) return
    } else if (!server.consistent && !sourceAgentId) {
      setExpandedName(server.name)
      setWriteError("该 MCP 存在多个配置版本，请在详情中选择同步来源。")
      return
    }
    const pendingKey = `${server.name}:${agent.id}`
    if (pendingConnections.has(pendingKey)) return
    setPendingConnections((current) => new Set(current).add(pendingKey))
    try {
      const ok = await runWrite(
        electronAPI.mcpSetConnection(server.name, agent.id, enable, sourceAgentId),
      )
      if (ok) {
        setWriteFeedback({
          title: enable
            ? `已接入 ${agent.displayName}`
            : `已从 ${agent.displayName} 移除`,
          detail: `「${server.name}」配置已写入；正在运行的 Agent 可能需要重启或重新加载。`,
        })
      }
    } finally {
      setPendingConnections((current) => {
        const next = new Set(current)
        next.delete(pendingKey)
        return next
      })
    }
  }

  async function handleSync(
    server: McpServerEntry,
    sourceAgentId: string,
    targetAgentIds: string[],
  ) {
    if (targetAgentIds.length === 0) return
    const source = agentById.get(sourceAgentId)
    const ok = window.confirm(
      `确定将 ${source?.displayName ?? sourceAgentId} 设为「${server.name}」的权威配置，并覆盖 ${targetAgentIds.length} 个 Agent 吗？`,
    )
    if (!ok) return
    if (pendingServers.has(server.name)) return
    setPendingServers((current) => new Set(current).add(server.name))
    try {
      const result = await electronAPI.mcpSyncServer(server.name, sourceAgentId, targetAgentIds)
      await load()
      if (!result.ok) {
        if (result.written.length > 0) {
          const writtenPaths = new Set(result.written)
          const writtenNames = targetAgentIds
            .map((id) => agents.find((agent) => agent.id === id))
            .filter((agent): agent is McpAgentInfo => Boolean(agent && writtenPaths.has(agent.configPath)))
            .map((agent) => agent.displayName)
          const failedNames = targetAgentIds
            .map((id) => agents.find((agent) => agent.id === id))
            .filter((agent): agent is McpAgentInfo => Boolean(agent && !writtenPaths.has(agent.configPath)))
            .map((agent) => agent.displayName)
          setWriteError(
            `部分同步：已写入 ${writtenNames.join("、") || `${result.written.length} 个 Agent`}；未完成 ${failedNames.join("、") || "部分目标"}。${result.error ?? ""}`,
          )
        } else {
          setWriteError(result.error || "同步失败")
        }
        return
      }
      setWriteError(null)
      setWriteFeedback({
        title: `已同步 ${server.name}`,
        detail: `已将权威配置写入 ${targetAgentIds.length} 个 Agent；运行状态尚未检测，目标 Agent 可能需要重启或重新加载。`,
      })
    } finally {
      setPendingServers((current) => {
        const next = new Set(current)
        next.delete(server.name)
        return next
      })
    }
  }

  async function handleAdd(inputs: McpServerInput[], agentIds: string[]) {
    setAdding(true)
    setAddError(null)
    let completed = 0
    const failures: string[] = []
    try {
      for (const input of inputs) {
        try {
          const result = await electronAPI.mcpAddServer(input, agentIds)
          if (result.ok) completed++
          else {
            const partial = result.written.length > 0
              ? `已写入 ${result.written.length} 个 Agent，但未全部完成；`
              : ""
            failures.push(`${input.name}：${partial}${result.error || "操作失败"}`)
          }
        } catch (error) {
          failures.push(`${input.name}：${errorMessage(error)}`)
        }
      }
      await load()
      if (failures.length > 0) {
        setAddError(
          `${completed > 0 ? `已成功添加 ${completed} 项；` : ""}${failures.join("；")}`,
        )
        return
      }
      setShowAdd(false)
      setWriteFeedback({
        title: `已添加 ${completed} 个 MCP`,
        detail: `配置已写入 ${agentIds.length} 个 Agent；正在运行的 Agent 可能需要重启或重新加载。`,
        support: completed > 0,
      })
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(server: McpServerEntry) {
    if (pendingServers.has(server.name)) return
    const ok = window.confirm(
      `确定删除「${server.name}」吗？这会从 ${server.connections.length} 个 Agent 的配置中移除。`,
    )
    if (!ok) return
    setPendingServers((current) => new Set(current).add(server.name))
    try {
      const removed = await runWrite(electronAPI.mcpRemoveServer(server.name))
      if (removed) {
        setExpandedName(null)
        setWriteFeedback({
          title: `已删除 ${server.name}`,
          detail: `已从 ${server.connections.length} 个 Agent 的配置中移除。`,
        })
      }
    } finally {
      setPendingServers((current) => {
        const next = new Set(current)
        next.delete(server.name)
        return next
      })
    }
  }

  const parseErrors = library?.errors ?? []
  const expandedServer = servers.find((server) => server.name === expandedName)

  return (
    <div className="flex h-full min-w-0">
      <McpSidebar
        agents={installedAgents}
        agentFilter={agentFilter}
        onSelectAgent={setAgentFilter}
        perAgentCounts={perAgentCounts}
      />

      <div className="skillbox-market-main">
        {/* Header */}
        <div className="skillbox-mcp-header">
          <div className="skillbox-mcp-header__title">
            <h2>MCP 管理</h2>
            <p>MCP 让 Agent 使用文件、数据库等外部工具。这里查看本机配置、指定权威配置并检查差异；配置一致不代表服务已连接或工具可用。</p>
          </div>
          <div className="skillbox-mcp-overview" aria-label="MCP 状态概览">
            <div className="skillbox-mcp-overview__metric">
              <strong>{servers.length}</strong>
              <span>MCP</span>
            </div>
            <div className="skillbox-mcp-overview__metric" title="本机可配置 MCP 的 Agent，数量不代表实际使用记录">
              <strong>{installedAgents.length}</strong>
              <span>Agent</span>
            </div>
            <div className="skillbox-mcp-overview__metric" title="同一个 MCP 写入一个 Agent 计为一处">
              <strong>{connectionCount}</strong>
              <span>接入</span>
            </div>
            <div className="skillbox-mcp-overview__metric" title="存在多个配置版本的 MCP 数量">
              <strong>{driftCount}</strong>
              <span>差异</span>
            </div>
            {parseErrors.length > 0 && (
              <button
                type="button"
                className="skillbox-mcp-parse-warn"
                aria-expanded={showErrors}
                onClick={() => setShowErrors((v) => !v)}
              >
                <WarnIcon /> {parseErrors.length} 个配置文件解析失败
              </button>
            )}
          </div>
        </div>

        {showErrors && parseErrors.length > 0 && (
          <div className="skillbox-mcp-parse-list">
            {parseErrors.map((err) => (
              <div key={err.agentId} className="skillbox-mcp-parse-list__row">
                <code data-no-localize>{err.configPath}</code>
                <span>{err.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Write error bar */}
        {writeError && (
          <div className="skillbox-mcp-errorbar" role="alert">
            <span>{writeError}</span>
            <button type="button" onClick={() => setWriteError(null)} aria-label="关闭错误提示">
              ×
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="skillbox-mcp-toolbar">
          <div className="skillbox-mcp-search">
            <SearchIcon />
            <input
              type="text"
              aria-label="搜索 MCP server"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索 MCP server…"
            />
          </div>

          <button
            type="button"
            className="skillbox-mcp-icon-button"
            title="重新扫描"
            disabled={refreshing}
            onClick={() => void load()}
          >
            <RefreshIcon spinning={refreshing} />
          </button>

          <button
            type="button"
            className="skillbox-mcp-button-primary"
            onClick={() => setShowAdd(true)}
          >
            + 添加 MCP
          </button>
        </div>

        <div className="skillbox-mcp-filterbar" aria-label="MCP 筛选">
          <button type="button" className={typeFilter === "all" && !onlyDrift ? "is-active" : ""} onClick={() => { setTypeFilter("all"); setOnlyDrift(false) }}>
            全部 <span>{servers.length}</span>
          </button>
          <button type="button" className={typeFilter === "stdio" && !onlyDrift ? "is-active" : ""} onClick={() => { setTypeFilter("stdio"); setOnlyDrift(false) }}>
            stdio <span>{servers.filter((server) => server.type === "stdio").length}</span>
          </button>
          <button type="button" className={typeFilter === "http" && !onlyDrift ? "is-active" : ""} onClick={() => { setTypeFilter("http"); setOnlyDrift(false) }}>
            HTTP <span>{servers.filter((server) => server.type === "http").length}</span>
          </button>
          <button type="button" className={onlyDrift ? "is-active is-warn" : ""} onClick={() => { setTypeFilter("all"); setOnlyDrift((value) => !value) }}>
            配置差异 <span>{driftCount}</span>
          </button>
        </div>

        {/* Content */}
        <div className="skillbox-mcp-content">
          {loading ? (
            <div className="skillbox-mcp-empty">
              <Spinner />
              <p>正在扫描各 Agent 的 MCP 配置…</p>
            </div>
          ) : servers.length === 0 ? (
            <div className="skillbox-mcp-empty">
              <PlugIcon size={40} />
              <p className="skillbox-mcp-empty__title">未检测到 MCP server 配置</p>
              <p>各 Agent 的配置文件里还没有 MCP server，可以从这里添加一个并统一写入。</p>
              <button
                type="button"
                className="skillbox-mcp-button-primary"
                onClick={() => setShowAdd(true)}
              >
                + 添加 MCP
              </button>
            </div>
          ) : visibleServers.length === 0 ? (
            <div className="skillbox-mcp-empty">
              <p>没有匹配的 MCP server{query ? `："${query.trim()}"` : ""}</p>
            </div>
          ) : (
            <div className="skillbox-mcp-library-list">
              <div className="skillbox-mcp-library-list__head">
                <span>MCP 名称</span>
                <span>类型 / 命令摘要</span>
                <span>Agent</span>
                <span>接入数</span>
                <span>状态</span>
                <span aria-hidden="true" />
              </div>
              {visibleServers.map((server) => {
                const connectedAgents = getMcpConnectionSummary(server, agents).installed
                return (
                  <div
                    key={server.name}
                    className={`skillbox-mcp-library-row ${expandedName === server.name ? "is-selected" : ""} ${server.consistent ? "" : "has-drift"}`}
                  >
                    <button
                      type="button"
                      className="skillbox-mcp-library-row__open"
                      aria-label={`查看 ${server.name} 的 MCP 详情`}
                      aria-expanded={expandedName === server.name}
                      onClick={() => setExpandedName(expandedName === server.name ? null : server.name)}
                    />
                    <span className="skillbox-mcp-library-row__name">
                      <i><PlugIcon size={15} /></i>
                      <strong data-no-localize title={server.name}>{mcpAliases[server.name] ?? server.name}</strong>
                      <CopySkillName name={server.name} />
                    </span>
                    <span className="skillbox-mcp-library-row__summary">
                      <b>{server.type}</b>
                      <small data-no-localize title={serverCommandLine(server)}>{serverCommandLine(server)}</small>
                    </span>
                    <McpAgentStack server={server} agents={agents} className="skillbox-mcp-library-row__agents" size={18} maxVisible={6} />
                    <span className="skillbox-mcp-library-row__count">{connectedAgents.length}/{installedAgents.length}</span>
                    <span className={`skillbox-mcp-library-row__status ${server.consistent ? "is-ok" : "is-warn"}`}>
                      <i aria-hidden="true">{server.consistent ? "✓" : "!"}</i>
                      {server.consistent ? "一致" : "有差异"}
                    </span>
                    <button
                      type="button"
                      aria-label={favoriteServers.has(server.name) ? "取消收藏" : "收藏"}
                      title={favoriteServers.has(server.name) ? "取消收藏" : "收藏"}
                      className={`skillbox-favorite-button inline-flex items-center justify-center w-5 h-5 rounded transition-colors cursor-pointer ${
                        favoriteServers.has(server.name)
                          ? "text-amber-400 hover:text-amber-300"
                          : "text-muted hover:text-foreground"
                      }`}
                      onClick={(event) => {
                        event.stopPropagation()
                        void toggleFavoriteServer(server.name)
                      }}
                    >
                      <StarIcon size={14} filled={favoriteServers.has(server.name)} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {showAdd && (
          <AddMcpDialog
            agents={agents}
            submitting={adding}
            error={addError}
            onClose={() => {
              if (adding) return
              setShowAdd(false)
              setAddError(null)
            }}
            onSubmit={(inputs, agentIds) => void handleAdd(inputs, agentIds)}
          />
        )}

        {writeFeedback && (
          <div className="skillbox-mcp-toast" role="status" aria-live="polite">
            <i aria-hidden="true">✓</i>
            <div>
              <strong>{writeFeedback.title}</strong>
              <span>{writeFeedback.detail}</span>
              {writeFeedback.support && <div className="skillbox-support-after-success"><SupportAuthorButton /></div>}
            </div>
          </div>
        )}

        {expandedServer && (
          <ServerPanel
            key={expandedServer.name}
            server={expandedServer}
            agents={agents}
            agentById={agentById}
            pendingConnections={pendingConnections}
            sourceAgentId={sourceByServer[expandedServer.name]}
            busy={pendingServers.has(expandedServer.name)}
            onSelectSource={(agentId) => {
              selectMcpAuthority(expandedServer.name, agentId)
              setWriteError(null)
            }}
            onToggleConnection={handleToggleConnection}
            onSync={handleSync}
            onOpenConfig={(configPath) => {
              void electronAPI.mcpOpenConfig(configPath).catch((error) => {
                setWriteError(`无法打开配置：${errorMessage(error)}`)
              })
            }}
            onClose={() => setExpandedName(null)}
            onRemove={(server) => void handleRemove(server)}
          />
        )}
      </div>
    </div>
  )
}
