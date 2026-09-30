import { useEffect, useRef, useState } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import { electronAPI } from "../lib/electron-api"
import { useInstalledSkills } from "../lib/installed-skills"
import { AgentLogo } from "./agent-logo"
import { CopySkillName } from "./copy-name"
import { getMcpAgentPreview } from "../lib/mcp-display"

// Plug icon — shared by all MCP entry points (sidebar nav, home strip, MCP page).
export function PlugIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0V8z" />
      <path d="M12 17v5" />
    </svg>
  )
}

// Module-level cache so multiple sidebars/strips share one scan and stay in
// sync via the mcp:updated broadcast.
let libraryCache: McpLibrary | null = null
let libraryInflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function notifyLibraryListeners() {
  for (const listener of listeners) listener()
}

export function useMcpLibrary(): McpLibrary | null {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1)
    listeners.add(listener)
    if (!libraryCache && !libraryInflight) {
      libraryInflight = electronAPI
        .mcpListLibrary()
        .then((lib) => {
          libraryCache = lib
        })
        .catch(() => {})
        .finally(() => {
          libraryInflight = null
          notifyLibraryListeners()
        })
    }
    const unsubscribe = electronAPI.onMcpUpdated((lib) => {
      libraryCache = lib as McpLibrary
      notifyLibraryListeners()
    })
    return () => {
      listeners.delete(listener)
      unsubscribe()
    }
  }, [])
  return libraryCache
}

const FAVORITES_UPDATED_EVENT = "skillbox:favorites-updated"

export function notifyFavoritesChanged(): void {
  window.dispatchEvent(new Event(FAVORITES_UPDATED_EVENT))
}

export function McpAgentStack({ server, agents, className, size = 18, maxVisible = 4 }: {
  server: McpServerEntry
  agents: McpAgentInfo[]
  className?: string
  size?: number
  maxVisible?: number
}) {
  const { visible, hiddenCount, installedCount, historicalCount } = getMcpAgentPreview(server, agents, maxVisible)
  const title = `${installedCount} 个已安装 Agent${historicalCount ? `，另有 ${historicalCount} 处未安装 Agent 的历史配置` : ""}`
  return (
    <span className={className} title={title}>
      {visible.map((agent) => <AgentLogo key={agent.id} name={agent.displayName} size={size} />)}
      {hiddenCount > 0 && <small className="skillbox-mcp-agent-more">+{hiddenCount}</small>}
      {installedCount === 0 && <small className="skillbox-mcp-agent-more">—</small>}
    </span>
  )
}

// Sidebar nav entry under the Library section on every page.
// Shares the skillbox-library-button treatment with "All Skills"/"首页" so the
// hover/selected states are identical across pages.
export function McpNavLink() {
  const library = useMcpLibrary()
  return (
    <NavLink
      to="/mcp"
      className={({ isActive }) => `skillbox-library-button ${isActive ? "is-active" : ""}`}
    >
      <span className="flex items-center gap-2">
        <PlugIcon size={13} /> MCP 管理
      </span>
      {library && <strong>{library.servers.length}</strong>}
    </NavLink>
  )
}

// Favorites nav entry — on non-library pages it deep-links into the library's
// Favorites filter; styled identically to the other top-level nav items.
export function FavoritesNavLink() {
  const navigate = useNavigate()
  const installedSkills = useInstalledSkills()
  const library = useMcpLibrary()
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    if (!installedSkills || !library) {
      setCount(null)
      return
    }
    const load = () => {
      void electronAPI
        .favoritesList()
        .then((names) => {
          const skillNames = new Set(installedSkills.map((skill) => skill.name))
          const mcpNames = new Set(library.servers.map((server) => server.name))
          setCount(
            names.filter((name) =>
              name.startsWith("mcp:")
                ? mcpNames.has(name.slice(4))
                : skillNames.has(name),
            ).length,
          )
        })
        .catch(() => {})
    }
    load()
    window.addEventListener(FAVORITES_UPDATED_EVENT, load)
    return () => window.removeEventListener(FAVORITES_UPDATED_EVENT, load)
  }, [installedSkills, library])
  return (
    <button
      type="button"
      className="skillbox-library-button"
      onClick={() => navigate("/library", { state: { filter: "favorites" } })}
    >
      <span className="flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        收藏
      </span>
      {count !== null && <strong>{count}</strong>}
    </button>
  )
}

// Favorited MCP servers rendered as native rows of the library table (same
// grid as skill rows, under a slim group header), so Favorites reads as one
// mixed list rather than two stacked blocks.
export function McpFavoritesSection({
  visible,
  favorites,
  searchQuery = "",
  showFilters = false,
  onToggleMcpFavorite,
  selectedName,
  onSelect,
}: {
  visible: boolean
  favorites: Set<string>
  searchQuery?: string
  showFilters?: boolean
  onToggleMcpFavorite: (name: string) => void
  selectedName: string | null
  onSelect: (name: string | null) => void
}) {
  const library = useMcpLibrary()
  const navigate = useNavigate()
  const detailRef = useRef<HTMLElement>(null)
  const [typeFilter, setTypeFilter] = useState<"all" | "stdio" | "http">("all")
  const [agentFilter, setAgentFilter] = useState("")
  useEffect(() => {
    if (!selectedName) return
    const closeOnOutside = (event: MouseEvent) => {
      if (detailRef.current && !detailRef.current.contains(event.target as Node)) onSelect(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSelect(null)
    }
    document.addEventListener("mousedown", closeOnOutside)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("mousedown", closeOnOutside)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [onSelect, selectedName])
  if (!visible) return null
  const query = searchQuery.trim().toLowerCase()
  const servers = (library?.servers ?? []).filter((server) => {
    if (!favorites.has(`mcp:${server.name}`)) return false
    if (showFilters && typeFilter !== "all" && server.type !== typeFilter) return false
    if (showFilters && agentFilter && !server.connections.some((connection) => connection.agentId === agentFilter)) return false
    const commandLine =
      server.type === "http"
        ? server.url || ""
        : [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")
    const searchable = `${server.name} ${commandLine}`.toLowerCase()
    return !query || searchable.includes(query)
  })
  const favoriteCount = (library?.servers ?? []).filter((server) => favorites.has(`mcp:${server.name}`)).length
  const activeAgents = (library?.agents ?? []).filter((agent) => agent.installed && (library?.servers ?? []).some((server) =>
    favorites.has(`mcp:${server.name}`) && server.connections.some((connection) => connection.agentId === agent.id),
  ))
  const selectedServer = (library?.servers ?? []).find((server) => server.name === selectedName && favorites.has(`mcp:${server.name}`))
  return (
    <section className="skillbox-favorites-section">
      <header className="skillbox-favorites-section__head">
        <div><h2>MCP <span>{servers.length}/{favoriteCount}</span></h2><p>常用工具服务</p></div>
        {showFilters && <div className="skillbox-favorites-section__filters">
          <select aria-label="筛选收藏的 MCP 类型" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
            <option value="all">全部类型</option><option value="stdio">stdio</option><option value="http">HTTP</option>
          </select>
          <select aria-label="筛选收藏的 MCP Agent" value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
            <option value="">全部 Agent</option>
            {activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}
          </select>
        </div>}
      </header>
      <div className="skillbox-favorites-items">
        {servers.length === 0 ? <p className="skillbox-favorites-empty">{query || (showFilters && (typeFilter !== "all" || agentFilter)) ? "没有匹配的 MCP" : "暂无收藏的 MCP，可在 MCP 管理页点亮星标。"}</p> : servers.map((server) => {
          const commandLine = server.type === "http" ? server.url || "—" : [server.command, ...(server.args ?? [])].filter(Boolean).join(" ") || "—"
          return <div key={server.name} className={`skillbox-favorites-item ${selectedName === server.name ? "is-selected" : ""}`}>
            <button type="button" className="skillbox-favorites-item__open" aria-label={`查看 ${server.name} 的 MCP 详情`} onClick={() => onSelect(selectedName === server.name ? null : server.name)} />
            <span className="skillbox-favorites-item__icon" aria-hidden="true"><PlugIcon size={18} /></span>
            <span className="skillbox-favorites-item__main">
              <span className="skillbox-favorites-item__name"><strong data-no-localize>{server.name}</strong><CopySkillName name={server.name} /></span>
              <small data-no-localize title={commandLine}>{server.type.toUpperCase()} · {server.consistent ? "配置一致" : "配置有差异"} · {commandLine}</small>
            </span>
            <McpAgentStack server={server} agents={library?.agents ?? []} className="skillbox-favorites-item__agents" size={19} />
            <button type="button" aria-label={`取消收藏 ${server.name}`} title="取消收藏" className="skillbox-favorites-item__star" onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onToggleMcpFavorite(server.name)
            }}><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg></button>
          </div>
        })}
      </div>
      {selectedServer && <aside ref={detailRef} className="skillbox-mcp-detail skillbox-mcp-favorite-detail" role="dialog" aria-label={`${selectedServer.name} 的 MCP 详情`}>
        <div className="skillbox-mcp-detail__scroll">
          <header className="skillbox-mcp-detail__header">
            <div className="skillbox-mcp-detail__heading"><h1 data-no-localize title={selectedServer.name}>{selectedServer.name}</h1><CopySkillName name={selectedServer.name} /></div>
            <div className="skillbox-mcp-detail__actions"><button type="button" className="skillbox-mcp-detail__icon" aria-label="关闭 MCP 详情" onClick={() => onSelect(null)}>×</button></div>
          </header>
          <p className="skillbox-mcp-detail__description">{selectedServer.type.toUpperCase()} · {selectedServer.consistent ? "配置一致" : "配置有差异"} · {selectedServer.connections.length} 处接入</p>
          <div className="skillbox-mcp-favorite-detail__field"><span>{selectedServer.type === "http" ? "地址" : "命令"}</span><code data-no-localize>{selectedServer.type === "http" ? selectedServer.url || "—" : [selectedServer.command, ...(selectedServer.args ?? [])].filter(Boolean).join(" ") || "—"}</code></div>
          <h2 className="skillbox-mcp-favorite-detail__title">接入 Agent</h2>
          <div className="skillbox-mcp-favorite-detail__agents">
            {selectedServer.connections.map((connection) => {
              const agent = library?.agents.find((item) => item.id === connection.agentId)
              return <div key={connection.agentId} className="skillbox-mcp-favorite-detail__agent"><AgentLogo name={agent?.displayName ?? connection.agentId} size={22} /><span className="skillbox-mcp-favorite-detail__agent-meta">{agent?.displayName ?? connection.agentId}<small data-no-localize title={connection.configPath}>{connection.configPath}</small></span>{!agent?.installed && <em>历史配置</em>}</div>
            })}
          </div>
          <button type="button" className="skillbox-mcp-detail__open skillbox-mcp-favorite-detail__manage" onClick={() => navigate("/mcp", { state: { serverName: selectedServer.name } })}>在 MCP 管理中编辑</button>
        </div>
      </aside>}
    </section>
  )
}
