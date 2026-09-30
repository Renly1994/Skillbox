import { useEffect, useMemo, useState } from "react"
import { NavLink } from "react-router-dom"
import { electronAPI } from "../lib/electron-api"
import { AgentLogo } from "../components/agent-logo"
import { HomeNavLink } from "../components/home-nav"
import { FavoritesNavLink, McpNavLink, PlugIcon } from "../components/mcp-nav"
import { useInstalledSkills } from "../lib/installed-skills"
import { SidebarUtilities, SkillboxBrand } from "../components/skillbox-brand"

// ---------------------------------------------------------------------------
// Agent accent colors (dashboard bars/segments; AgentLogo itself is image-based)
// ---------------------------------------------------------------------------

const AGENT_COLORS: Record<string, string> = {
  "claude-code": "#D97757",
  cursor: "#5B6CFF",
  "codex-cli": "#10A37F",
  windsurf: "#2E9BD6",
  "gemini-cli": "#4A7CDE",
  "kimi-code": "#E23E2B",
  opencode: "#14B8A6",
  openclaw: "#0E9F8C",
  continue: "#E8C15A",
  trae: "#FF6B3D",
  zed: "#2743D6",
  "github-copilot": "#6E57C4",
  vscode: "#6E57C4",
  "droid-cli": "#8A6D3B",
  junie: "#7C5CD6",
  goose: "#C46A2B",
  amp: "#D6495B",
}

const FALLBACK_COLORS = ["#B0653A", "#7A6C2F", "#4D7A52", "#3F6F8A", "#6A5A8E", "#8A4F62"]

function agentColor(displayName: string): string {
  if (displayName.includes("Universal") || displayName.includes("通用")) {
    return "#8A8270"
  }
  const key = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  const known = AGENT_COLORS[key]
  if (known) return known
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}

// ---------------------------------------------------------------------------
// Time formatting (Chinese relative time)
// ---------------------------------------------------------------------------

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

function relativeTime(ts: number, now: number): string {
  const diff = now - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (ts >= startOfToday) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`
  if (ts >= startOfToday - 86_400_000) return "昨天"
  if (ts >= startOfToday - 6 * 86_400_000) return WEEKDAYS[new Date(ts).getDay()]
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function headerDate(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[d.getDay()]}`
}

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------

interface FeedEvent {
  time: number
  kind: "added" | "updated" | "mcp" | "skill"
  skill?: InstalledSkill
  message?: string
}

function buildFeed(skills: InstalledSkill[], activity: ActivityEvent[]): FeedEvent[] {
  const events: FeedEvent[] = []
  for (const skill of skills) {
    const installed = skill.installedAt ? Date.parse(skill.installedAt) : NaN
    const updated = skill.updatedAt ? Date.parse(skill.updatedAt) : NaN
    if (!Number.isNaN(installed)) events.push({ time: installed, kind: "added", skill })
    if (!Number.isNaN(updated) && (Number.isNaN(installed) || updated > installed)) {
      events.push({ time: updated, kind: "updated", skill })
    }
  }
  for (const entry of activity) {
    const time = Date.parse(entry.ts)
    if (Number.isNaN(time)) continue
    events.push({
      time,
      kind: entry.kind === "skill" ? "skill" : "mcp",
      message: entry.message,
    })
  }
  return events.sort((a, b) => b.time - a.time).slice(0, 7)
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function AdaptIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function DashboardSidebar({
  agents,
  skillCount,
}: {
  agents: DetectedAgent[]
  skillCount: number
}) {
  return (
    <aside className="skillbox-sidebar">
      <div className="skillbox-sidebar__scroll">
        <SkillboxBrand />
        <section className="skillbox-nav-section">
          <h3>导航</h3>
          <nav className="flex flex-col gap-1">
            <HomeNavLink />
            <NavLink to="/library" className="skillbox-library-button">
              <span className="flex items-center gap-2"><span aria-hidden>⌘</span> All Skills</span>
              <strong>{skillCount}</strong>
            </NavLink>
            <McpNavLink />
            <FavoritesNavLink />
          </nav>
        </section>
        {agents.length > 0 && (
          <section className="skillbox-nav-section skillbox-agent-section">
            <h3>Agents</h3>
            <div className="flex flex-col gap-0.5">
              {agents.map((agent) => (
                <div key={agent.name} className="skillbox-dash-agent-tile">
                  <AgentLogo name={agent.displayName} shortCode={agent.shortCode} size={22} />
                  <span data-no-localize className="truncate">{agent.displayName}</span>
                </div>
              ))}
            </div>
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
// Dashboard
// ---------------------------------------------------------------------------

export function Dashboard() {
  // Shared installed-skills cache — instant on revisit, no per-mount refetch.
  const skills = useInstalledSkills()
  const [agents, setAgents] = useState<DetectedAgent[]>([])
  const [universalName, setUniversalName] = useState<string | null>(null)
  const [mcpCount, setMcpCount] = useState(0)
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [appVersion, setAppVersion] = useState("")
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [detectedAgents, mcpLibrary, version, activityLog] = await Promise.all([
          electronAPI.detectAgents(),
          electronAPI.mcpListLibrary(),
          electronAPI.appGetVersion(),
          electronAPI.activityList(20),
        ])
        if (cancelled) return
        setUniversalName(detectedAgents.find((a) => a.name === "universal")?.displayName ?? null)
        setAgents(detectedAgents.filter((a) => a.name !== "universal"))
        setMcpCount(mcpLibrary.servers.length)
        setActivity(activityLog)
        setAppVersion(version)
        setLoadedAt(Date.now())
        setNow(Date.now())
      } catch (err) {
        console.error("Failed to load dashboard data:", err)
      }
    }
    load()
    const unsubscribeMcp = electronAPI.onMcpUpdated((library) => {
      setMcpCount(library.servers.length)
      electronAPI
        .activityList(20)
        .then(setActivity)
        .catch(() => {})
    })
    // 适配 Agent 等技能操作会触发 skills:updated，同步刷新动态流。
    const unsubscribeSkills = electronAPI.onSkillsUpdated(() => {
      electronAPI
        .activityList(20)
        .then(setActivity)
        .catch(() => {})
    })
    const tick = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => {
      cancelled = true
      unsubscribeMcp()
      unsubscribeSkills()
      window.clearInterval(tick)
    }
  }, [])

  const skillList = skills ?? []

  // Per-agent skill counts (a skill counts toward every agent it is installed for).
  const agentSkillCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const skill of skillList) {
      for (const agentName of skill.agents) {
        if (agentName === universalName) continue
        counts.set(agentName, (counts.get(agentName) ?? 0) + 1)
      }
    }
    return counts
  }, [skillList, universalName])

  const sourceAgentCount = agentSkillCounts.size
  const scopeCounts = useMemo(() => {
    const counts = { global: 0, project: 0, custom: 0 }
    for (const skill of skillList) counts[skill.scope] += 1
    return counts
  }, [skillList])
  const conflictCount = useMemo(
    () => skillList.filter((skill) => skill.versionMismatches.length > 0).length,
    [skillList],
  )

  // Share bar: installs per agent, top 3 colored segments + "其他".
  const shareSegments = useMemo(() => {
    const entries = [...agentSkillCounts.entries()].sort((a, b) => b[1] - a[1])
    const total = entries.reduce((sum, [, count]) => sum + count, 0)
    if (total === 0) return { total, top: [] as { name: string; count: number; pct: number }[], restPct: 0 }
    const top = entries.slice(0, 3).map(([name, count]) => ({
      name,
      count,
      pct: (count / total) * 100,
    }))
    const restPct = 100 - top.reduce((sum, seg) => sum + seg.pct, 0)
    return { total, top, restPct }
  }, [agentSkillCounts])

  const topCovered = useMemo(
    () =>
      [...skillList]
        .sort((a, b) => b.agents.length - a.agents.length || a.name.localeCompare(b.name))
        .slice(0, 5),
    [skillList],
  )

  const feed = useMemo(() => buildFeed(skillList, activity), [skillList, activity])

  const distribution = useMemo(() => {
    const rows = agents.map((agent) => ({
      agent,
      count: agentSkillCounts.get(agent.displayName) ?? 0,
    }))
    rows.sort((a, b) => b.count - a.count)
    const max = rows.reduce((m, row) => Math.max(m, row.count), 0)
    return { rows, max }
  }, [agents, agentSkillCounts])

  const totalInstalls = shareSegments.total

  return (
    <div className="flex h-full min-w-0">
      <DashboardSidebar
        agents={agents}
        skillCount={skillList.length}
      />
      <main className="skillbox-dash">
        {skills === null ? (
          <div className="skillbox-dash__loading">正在扫描本地技能库…</div>
        ) : (
          <>
            <div className="skillbox-dash__scroll">
              <div className="skillbox-dash__head">
                <div>
                  <h1 className="skillbox-dash__title">
                    首页<span className="mono">· HOME</span>
                  </h1>
                  <div className="skillbox-dash__scan mono">
                    本地技能库总览 · 最近扫描 {loadedAt ? relativeTime(loadedAt, now) : "…"}
                  </div>
                </div>
                <div className="skillbox-dash__date mono num">{headerDate(now)}</div>
              </div>

              {/* Hero: library overview + widest-coverage skills */}
              <section className="skillbox-dash-hero">
                <div className="skillbox-dash-hero__left">
                  <div className="skillbox-dash-cap mono">
                    技能库概览
                    <NavLink to="/library" className="skillbox-dash-cap__more">
                      查看全部 →
                    </NavLink>
                  </div>
                  <div className="skillbox-dash-kpi">
                    <span className="skillbox-dash-kpi__big num">{skillList.length}</span>
                    <span className="skillbox-dash-kpi__unit">个技能</span>
                    <span className="skillbox-dash-kpi__sub mono">覆盖 {sourceAgentCount}/{agents.length} 个 Agent</span>
                  </div>
                  <div className="skillbox-dash-stats">
                    <div className="skillbox-dash-stat">
                      <div className="skillbox-dash-stat__v num">{scopeCounts.global}</div>
                      <div className="skillbox-dash-stat__k mono">全局</div>
                    </div>
                    <div className="skillbox-dash-stat">
                      <div className="skillbox-dash-stat__v num">{scopeCounts.project}</div>
                      <div className="skillbox-dash-stat__k mono">项目</div>
                    </div>
                    <div className="skillbox-dash-stat">
                      <div className="skillbox-dash-stat__v num">{scopeCounts.custom}</div>
                      <div className="skillbox-dash-stat__k mono">自定义</div>
                    </div>
                    <div className="skillbox-dash-stat">
                      <div className="skillbox-dash-stat__v num">{conflictCount}</div>
                      <div className="skillbox-dash-stat__k mono">同步冲突</div>
                    </div>
                  </div>
                  {shareSegments.total > 0 && (
                    <div className="skillbox-dash-share">
                      <div className="skillbox-dash-share__bar">
                        {shareSegments.top.map((seg) => (
                          <i
                            key={seg.name}
                            style={{ width: `${seg.pct}%`, background: agentColor(seg.name) }}
                          />
                        ))}
                        {shareSegments.restPct > 0 && (
                          <i className="skillbox-dash-share__rest" style={{ width: `${shareSegments.restPct}%` }} />
                        )}
                      </div>
                      {shareSegments.top.map((seg) => (
                        <span key={seg.name} className="skillbox-dash-share__seg">
                          <i style={{ background: agentColor(seg.name) }} />
                          {agents.find((a) => a.displayName === seg.name)?.shortCode ?? seg.name}{" "}
                          {Math.round(seg.pct)}%
                        </span>
                      ))}
                      {shareSegments.restPct > 0 && (
                        <span className="skillbox-dash-share__seg">
                          <i className="skillbox-dash-share__rest-swatch" />
                          其他 {Math.round(shareSegments.restPct)}%
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="skillbox-dash-hero__right">
                  <div className="skillbox-dash-cap mono">
                    覆盖最广的技能
                    <span className="skillbox-dash-cap__hint mono num">按接入 agent 数</span>
                  </div>
                  <div className="skillbox-dash-sklist">
                    {topCovered.length === 0 && (
                      <div className="skillbox-dash-empty">暂无技能</div>
                    )}
                    {topCovered.map((skill) => (
                      <div key={skill.canonicalPath} className="skillbox-dash-skrow">
                        <span data-no-localize className="skillbox-dash-skrow__name mono">
                          {skill.name}
                        </span>
                        <span className="skillbox-dash-skrow__count mono num">
                          {skill.agents.length} agents
                        </span>
                        <span className="skillbox-dash-skrow__agents">
                          {skill.agents.slice(0, 6).map((agentName) => (
                            <AgentLogo key={agentName} name={agentName} size={18} />
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Row 2: recent activity + per-agent distribution */}
              <div className="skillbox-dash-row2">
                <div className="skillbox-dash-card">
                  <div className="skillbox-dash-cap mono">最近动态</div>
                  <div className="skillbox-dash-feed">
                    {feed.length === 0 && (
                      <div className="skillbox-dash-empty">暂无动态</div>
                    )}
                    {feed.map((event) => (
                      <div key={`${event.kind}:${event.skill?.canonicalPath ?? event.message}:${event.time}`} className="skillbox-dash-event">
                        <span className="skillbox-dash-event__time mono num">
                          {relativeTime(event.time, now)}
                        </span>
                        {event.kind === "mcp" || event.kind === "skill" ? (
                          <>
                            <span className="skillbox-dash-event__what" data-no-localize>
                              {event.message}
                            </span>
                            <span className={`skillbox-dash-event__agent ${event.kind === "mcp" ? "skillbox-dash-event__agent--mcp" : "skillbox-dash-event__agent--skill"}`}>
                              {event.kind === "mcp" ? <PlugIcon size={12} /> : <AdaptIcon size={12} />}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="skillbox-dash-event__what">
                              {event.kind === "added" ? "新增技能" : "更新技能"}{" "}
                              <b data-no-localize className="mono">{event.skill!.name}</b>
                            </span>
                            {event.skill!.agents[0] && (
                              <AgentLogo
                                name={event.skill!.agents[0]}
                                size={19}
                                className="skillbox-dash-event__agent"
                              />
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="skillbox-dash-card">
                  <div className="skillbox-dash-cap mono">
                    各 AGENT 技能分布
                    <span className="skillbox-dash-cap__hint mono num">{totalInstalls} 安装</span>
                  </div>
                  <div className="skillbox-dash-dist">
                    {distribution.rows.length === 0 && (
                      <div className="skillbox-dash-empty">未检测到 agent</div>
                    )}
                    {distribution.rows.map(({ agent, count }) => (
                      <div key={agent.name} className="skillbox-dash-drow">
                        <AgentLogo name={agent.displayName} shortCode={agent.shortCode} size={17} />
                        <span data-no-localize className="skillbox-dash-drow__name">
                          {agent.displayName}
                        </span>
                        <span className="skillbox-dash-drow__bar">
                          <i
                            style={{
                              width: distribution.max > 0 ? `${(count / distribution.max) * 100}%` : "0%",
                              background: agentColor(agent.displayName),
                            }}
                          />
                        </span>
                        <span className="skillbox-dash-drow__v num">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <footer className="skillbox-dash-status mono">
              <span className="num">
                {skillList.length} 技能 · {agents.length} agents · {mcpCount} MCP
              </span>
              <span className="skillbox-dash-status__right num">
                {appVersion ? `v${appVersion}` : ""}
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  )
}
