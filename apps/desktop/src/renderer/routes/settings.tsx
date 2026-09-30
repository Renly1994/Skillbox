import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ThemeToggle } from "@skillbox/ui"
import { electronAPI } from "../lib/electron-api"
import { useLocalization, type AppLocale } from "../lib/localization"
import { OPEN_SETTINGS_DIALOG } from "../components/skillbox-brand"
import { AgentLogo } from "../components/agent-logo"
import { SupportAuthorButton } from "../components/support-author"

// ---------------------------------------------------------------------------
// Setting row components
// ---------------------------------------------------------------------------

function SettingSelect({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string
  description: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface">
      <div>
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-[12px] text-muted">{description}</p>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 rounded bg-background border border-border text-[12px] text-foreground focus:outline-none focus:border-accent/40 transition-colors cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function SettingToggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface">
      <div>
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-[12px] text-muted">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        aria-pressed={value}
        aria-label={label}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          value ? "bg-foreground" : "bg-border"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background transition-transform ${
            value ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  )
}

function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

export function Settings() {
  const navigate = useNavigate()
  const { locale, setLocale } = useLocalization()
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  // SQLite-backed settings
  const [installScope, setInstallScope] = useState("global")
  const [installMethod, setInstallMethod] = useState("symlink")
  const [searchPreference, setSearchPreference] = useState("semantic")
  const [telemetryEnabled, setTelemetryEnabled] = useState(true)
  const [customScanPaths, setCustomScanPaths] = useState<string[]>([])
  const [newScanPath, setNewScanPath] = useState("")
  const [defaultAgents, setDefaultAgents] = useState<string[]>([])
  const [mirrorAgents, setMirrorAgents] = useState<string[]>([])
  const [detectedAgents, setDetectedAgents] = useState<DetectedAgent[]>([])
  const [appVersion, setAppVersion] = useState("")
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const [mcpLibrary, setMcpLibrary] = useState<McpLibrary | null>(null)
  const [versionStorage, setVersionStorage] = useState<SkillVersionStorageInfo | null>(null)
  const [skillStorage, setSkillStorage] = useState<SkillStorageInfo | null>(null)
  const [skillStorageBusy, setSkillStorageBusy] = useState(false)
  const [skillStorageError, setSkillStorageError] = useState<string | null>(null)
  const [versionStorageBusy, setVersionStorageBusy] = useState(false)
  const [versionStorageError, setVersionStorageError] = useState<string | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  const closeSettings = useCallback(() => {
    setOpen(false)
    window.setTimeout(() => returnFocusRef.current?.focus(), 0)
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const all = await electronAPI.settingsAll()
      if (all["install.scope"]) setInstallScope(all["install.scope"] as string)
      if (all["install.method"])
        setInstallMethod(all["install.method"] as string)
      if (all["search.preferSemantic"] !== undefined)
        setSearchPreference(
          all["search.preferSemantic"] ? "semantic" : "keyword",
        )
      if (all["telemetry.enabled"] !== undefined)
        setTelemetryEnabled(all["telemetry.enabled"] as boolean)
      if (Array.isArray(all["scan.customPaths"]))
        setCustomScanPaths(all["scan.customPaths"] as string[])
      if (Array.isArray(all["install.defaultAgents"]))
        setDefaultAgents(all["install.defaultAgents"] as string[])
      if (Array.isArray(all["sync.mirrorAgents"]))
        setMirrorAgents(all["sync.mirrorAgents"] as string[])
    } catch (err) {
      console.error("Failed to load settings:", err)
    } finally {
      setSettingsLoaded(true)
    }
  }, [])

  useEffect(() => {
    const handleOpen = () => {
      returnFocusRef.current = document.activeElement as HTMLElement | null
      setOpen(true)
    }
    window.addEventListener(OPEN_SETTINGS_DIALOG, handleOpen)
    return () => window.removeEventListener(OPEN_SETTINGS_DIALOG, handleOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    setSettingsLoaded(false)
    void loadSettings()
  }, [loadSettings, open])

  useEffect(() => {
    if (!open) return
    electronAPI.detectAgents().then(setDetectedAgents).catch(() => {})
    electronAPI.appGetVersion().then(setAppVersion).catch(() => {})
    electronAPI.updatesGetState().then(setUpdateState).catch(() => {})
    electronAPI.mcpListLibrary().then(setMcpLibrary).catch(() => {})
    electronAPI.skillVersionStorageInfo().then(setVersionStorage).catch(() => {})
    electronAPI.skillStorageInfo().then(setSkillStorage).catch((error) => {
      setSkillStorageError(error instanceof Error ? error.message : "读取 Skill 存储位置失败")
    })
    const cleanupUpdate = electronAPI.onUpdateState((state) => {
      setUpdateState(state)
      setCheckingUpdates(state.status === "checking" || state.status === "downloading")
    })
    const cleanupMcp = electronAPI.onMcpUpdated(setMcpLibrary)
    return () => {
      cleanupUpdate()
      cleanupMcp()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeSettings()
        return
      }
      if (event.key !== "Tab") return

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [closeSettings, open])

  async function saveSetting(key: string, value: unknown) {
    try {
      await electronAPI.settingsSet(key, value)
    } catch (err) {
      console.error("Failed to save setting:", err)
    }
  }

  function toggleAgentSelection(
    current: string[],
    setCurrent: (value: string[]) => void,
    key: "install.defaultAgents" | "sync.mirrorAgents",
    value: string,
  ) {
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]
    setCurrent(next)
    saveSetting(key, next)
  }

  async function handleCheckUpdates() {
    setCheckingUpdates(true)
    try {
      const state = await electronAPI.updatesCheck()
      setUpdateState(state)
    } catch (err) {
      console.error("Failed to check updates:", err)
    } finally {
      setCheckingUpdates(false)
    }
  }

  async function handleChooseVersionStorage() {
    setVersionStorageBusy(true)
    setVersionStorageError(null)
    try {
      const next = await electronAPI.chooseSkillVersionStorage()
      if (next) setVersionStorage(next)
    } catch (err) {
      console.error("Failed to move skill version storage:", err)
      setVersionStorageError(err instanceof Error ? err.message : "迁移版本仓库失败")
    } finally {
      setVersionStorageBusy(false)
    }
  }

  async function handleChooseSkillStorage() {
    setSkillStorageBusy(true)
    setSkillStorageError(null)
    try {
      const next = await electronAPI.chooseSkillStorage()
      if (next) setSkillStorage(next)
    } catch (err) {
      setSkillStorageError(err instanceof Error ? err.message : "迁移 Skill 目录失败")
    } finally {
      setSkillStorageBusy(false)
    }
  }

  async function handleVersionRetention(value: string) {
    setVersionStorageBusy(true)
    setVersionStorageError(null)
    try {
      setVersionStorage(await electronAPI.setSkillVersionRetention(Number(value)))
    } catch (err) {
      console.error("Failed to change skill version retention:", err)
      setVersionStorageError(err instanceof Error ? err.message : "修改保留数量失败")
    } finally {
      setVersionStorageBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="skillbox-settings-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSettings()
      }}
    >
      <section
        ref={dialogRef}
        className="skillbox-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skillbox-settings-title"
      >
        <header className="skillbox-settings-panel__header">
          <div>
            <h2 id="skillbox-settings-title">Settings</h2>
            <p>Manage skills, MCP connections, scanning, and app updates.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeSettings}
            aria-label="Close settings"
            title="Close settings"
          >
            ×
          </button>
        </header>

        <div className="skillbox-settings-panel__body">
          <div className="flex flex-col gap-6">
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Language
          </h3>
          <SettingSelect
            label="Language"
            description="Choose the language used by the desktop app"
            value={locale}
            options={[
              { value: "zh-CN", label: "Chinese" },
              { value: "en-US", label: "English" },
            ]}
            onChange={(value) => setLocale(value as AppLocale)}
          />
        </section>

        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Theme
          </h3>
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface">
            <div>
              <p className="text-sm text-foreground">Appearance</p>
              <p className="text-[12px] text-muted">Switch between light and dark mode</p>
            </div>
            <ThemeToggle />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            MCP management
          </h3>
          <div className="skillbox-settings-mcp">
            <div className="skillbox-settings-mcp__copy">
              <p>Local MCP overview</p>
              <span>MCP settings are stored by each Agent. Skillbox scans these local files and creates a backup before every change.</span>
            </div>
            <div className="skillbox-settings-mcp__metrics">
              <span><strong data-no-localize>{mcpLibrary?.servers.length ?? "—"}</strong>MCP servers</span>
              <span><strong data-no-localize>{mcpLibrary?.agents.filter((agent) => agent.installed).length ?? "—"}</strong>installed Agents</span>
              <span><strong data-no-localize>{mcpLibrary?.servers.reduce((total, server) => total + server.connections.length, 0) ?? "—"}</strong>connections</span>
            </div>
            <div className="skillbox-settings-mcp__agents">
              {mcpLibrary?.agents.filter((agent) => agent.installed).map((agent) => (
                <span key={agent.id}>
                  <AgentLogo name={agent.displayName} size={16} />
                  {agent.displayName}
                </span>
              ))}
              {mcpLibrary && mcpLibrary.agents.every((agent) => !agent.installed) && (
                <span>No supported MCP Agent detected</span>
              )}
            </div>
            <button
              type="button"
              className="skillbox-settings-mcp__button"
              onClick={() => {
                closeSettings()
                navigate("/mcp")
              }}
            >
              Open MCP management
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>

        {/* Install preferences */}
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Skill installation
          </h3>
          <div className="flex flex-col gap-3">
            {settingsLoaded ? (
              <>
                <SettingSelect
                  label="Default scope"
                  description="Where skills are installed by default"
                  value={installScope}
                  options={[
                    { value: "global", label: "Global" },
                    { value: "project", label: "Project" },
                  ]}
                  onChange={(v) => {
                    setInstallScope(v)
                    saveSetting("install.scope", v)
                  }}
                />
                <SettingSelect
                  label="Install method"
                  description="How skill files are placed in agent directories"
                  value={installMethod}
                  options={[
                    { value: "symlink", label: "Symlink" },
                    { value: "copy", label: "Copy" },
                  ]}
                  onChange={(v) => {
                    setInstallMethod(v)
                    saveSetting("install.method", v)
                  }}
                />
              </>
            ) : (
              <div className="p-3 rounded-lg border border-border bg-surface">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
              </div>
            )}
          </div>
        </section>

        {/* Search preferences */}
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Search
          </h3>
          <div className="flex flex-col gap-3">
            {settingsLoaded && (
              <SettingSelect
                label="Search preference"
                description="Preferred search method for discovering skills"
                value={searchPreference}
                options={[
                  { value: "semantic", label: "Semantic" },
                  { value: "keyword", label: "Keyword" },
                ]}
                onChange={(v) => {
                  setSearchPreference(v)
                  saveSetting("search.preferSemantic", v === "semantic")
                }}
              />
            )}
          </div>
        </section>

        {/* Privacy */}
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Privacy
          </h3>
          <div className="flex flex-col gap-3">
            {settingsLoaded && (
              <SettingToggle
                label="Telemetry"
                description="Send anonymous usage data to help improve Skillbox"
                value={telemetryEnabled}
                onChange={(v) => {
                  setTelemetryEnabled(v)
                  saveSetting("telemetry.enabled", v)
                }}
              />
            )}
          </div>
        </section>

        {/* Updates */}
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Updates
          </h3>
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-foreground">Desktop app updates</p>
                <p className="text-[12px] text-muted mt-1">
                  Version {appVersion || "unknown"}
                </p>
                <p className="text-[12px] text-muted mt-2">
                  {updateState?.message || "Check for updates from GitHub Releases."}
                </p>
                {updateState?.availableVersion && (
                  <p className="text-[12px] text-foreground mt-1">
                    Latest available: {updateState.availableVersion}
                  </p>
                )}
                {typeof updateState?.progressPercent === "number" && (
                  <p className="text-[12px] text-muted mt-1">
                    Download progress: {Math.round(updateState.progressPercent)}%
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleCheckUpdates}
                  disabled={checkingUpdates}
                  className="rounded-lg border border-border px-4 py-2 text-[12px] font-medium text-foreground hover:bg-surface-hover disabled:opacity-40"
                >
                  {checkingUpdates ? "Checking..." : "Check now"}
                </button>
                {updateState?.status === "downloaded" && (
                  <button
                    onClick={() => electronAPI.updatesInstall()}
                    className="rounded-lg bg-foreground px-4 py-2 text-[12px] font-medium text-background"
                  >
                    Restart to install
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">Shared Skill storage</h3>
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-5 max-sm:flex-col">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">Storage location</p>
                <p className="mt-1 text-[12px] leading-5 text-muted">
                  New and marketplace Skills use this location. The selected folder gets a Skillbox Skills subfolder; existing Skills move automatically and Agent paths keep working.
                </p>
                <code data-no-localize className="mt-3 block break-all rounded-md border border-border bg-background px-3 py-2 text-[11px] leading-5 text-foreground">
                  {skillStorage?.path || (locale === "zh-CN" ? "正在读取…" : "Loading...")}
                </code>
                {skillStorage?.isLinked && (
                  <p className="mt-2 break-all text-[11px] leading-5 text-muted">
                    Standard path: <span data-no-localize>{skillStorage.compatibilityPath}</span>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2 max-sm:w-full">
                <button type="button" onClick={() => void handleChooseSkillStorage()} disabled={skillStorageBusy}
                  className="min-h-11 whitespace-nowrap rounded-lg border border-border px-4 text-[12px] font-medium text-foreground hover:bg-surface-hover disabled:opacity-40">
                  {skillStorageBusy ? "Moving..." : "Change location"}
                </button>
                <button type="button" onClick={() => void electronAPI.openSkillStorage()}
                  className="min-h-11 whitespace-nowrap rounded-lg px-4 text-[12px] text-muted hover:bg-surface-hover hover:text-foreground">
                  Open folder
                </button>
              </div>
            </div>
            {(skillStorageError || skillStorage?.warning) && (
              <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-600">
                {skillStorageError || skillStorage?.warning}
              </p>
            )}
          </div>
        </section>

        {/* Skill version history */}
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Skill version history
          </h3>
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-5 max-sm:flex-col">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">External snapshot storage</p>
                  <p className="mt-1 text-[12px] leading-5 text-muted">
                    Snapshots stay outside Skill folders. Identical content is stored only once, and old versions are cleaned up automatically.
                  </p>
                  <code
                    data-no-localize
                    className="mt-3 block break-all rounded-md border border-border bg-background px-3 py-2 text-[11px] leading-5 text-foreground"
                  >
                    {versionStorage?.path || (locale === "zh-CN" ? "正在读取…" : "Loading...")}
                  </code>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
                    <span><strong className="mr-1 text-foreground" data-no-localize>{versionStorage?.versionCount ?? "—"}</strong>snapshots</span>
                    <span><strong className="mr-1 text-foreground" data-no-localize>{versionStorage ? formatStorageSize(versionStorage.sizeBytes) : "—"}</strong>used</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 max-sm:w-full">
                  <button
                    type="button"
                    onClick={() => void handleChooseVersionStorage()}
                    disabled={versionStorageBusy}
                    className="min-h-11 whitespace-nowrap rounded-lg border border-border px-4 text-[12px] font-medium text-foreground hover:bg-surface-hover disabled:opacity-40"
                  >
                    {versionStorageBusy ? "Moving..." : "Change location"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void electronAPI.openSkillVersionStorage()}
                    className="min-h-11 whitespace-nowrap rounded-lg px-4 text-[12px] text-muted hover:bg-surface-hover hover:text-foreground"
                  >
                    Open folder
                  </button>
                </div>
              </div>
            </div>
            <SettingSelect
              label="Versions kept per Skill"
              description="When the limit is lowered, the oldest snapshots are removed immediately"
              value={String(versionStorage?.maxVersionsPerSkill ?? 20)}
              options={[
                { value: "10", label: "10" },
                { value: "20", label: "20" },
                { value: "50", label: "50" },
                { value: "100", label: "100" },
              ]}
              onChange={(value) => void handleVersionRetention(value)}
            />
            {versionStorageError && (
              <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-600">
                {versionStorageError}
              </p>
            )}
          </div>
        </section>

        {/* Scan paths */}
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Scan Paths
          </h3>
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-sm text-foreground mb-1">Custom scan directories</p>
              <p className="text-[12px] text-muted mb-3">
                Skillbox will scan direct skill folders and project-local tool paths inside these roots.
              </p>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newScanPath}
                  onChange={(e) => setNewScanPath(e.target.value)}
                  placeholder="~/projects or ~/my-skills"
                  className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-[12px] text-foreground placeholder:text-muted focus:outline-none focus:border-accent/40 transition-colors font-mono"
                />
                <button
                  onClick={() => {
                    const value = newScanPath.trim()
                    if (!value || customScanPaths.includes(value)) return
                    const next = [...customScanPaths, value]
                    setCustomScanPaths(next)
                    setNewScanPath("")
                    saveSetting("scan.customPaths", next)
                  }}
                  className="px-3 py-2 rounded-lg bg-foreground text-background text-[12px] font-medium"
                >
                  Add
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {customScanPaths.length === 0 ? (
                  <p className="text-[12px] text-muted">No custom scan paths configured.</p>
                ) : (
                  customScanPaths.map((scanPath) => (
                    <div key={scanPath} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <code className="text-[12px] text-foreground">{scanPath}</code>
                      <button
                        onClick={() => {
                          const next = customScanPaths.filter((item) => item !== scanPath)
                          setCustomScanPaths(next)
                          saveSetting("scan.customPaths", next)
                        }}
                        className="text-[12px] text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Target defaults */}
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Skill default targets
          </h3>
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="text-sm text-foreground mb-1">Install targets</p>
            <p className="text-[12px] text-muted mb-3">
              These targets are used for installs and new local skill creation when no explicit target set is chosen.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {detectedAgents.map((agent) => (
                <label key={agent.name} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12px] text-foreground">
                  <input
                    type="checkbox"
                    checked={defaultAgents.includes(agent.name)}
                    onChange={() =>
                      toggleAgentSelection(defaultAgents, setDefaultAgents, "install.defaultAgents", agent.name)
                    }
                  />
                  <span>{agent.displayName}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Sync rules */}
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Skill sync rules
          </h3>
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="text-sm text-foreground mb-1">Mirror installs to additional targets</p>
            <p className="text-[12px] text-muted mb-3">
              Any skill installed or created in the desktop app will also be linked into these targets.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {detectedAgents.map((agent) => (
                <label key={agent.name} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12px] text-foreground">
                  <input
                    type="checkbox"
                    checked={mirrorAgents.includes(agent.name)}
                    onChange={() =>
                      toggleAgentSelection(mirrorAgents, setMirrorAgents, "sync.mirrorAgents", agent.name)
                    }
                  />
                  <span>{agent.displayName}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">支持与维护</h3>
          <div className="p-3 rounded-lg border border-border bg-surface">
            <p className="text-[12px] text-muted mb-3">如果 Skillbox 帮到了你，欢迎自愿支持后续维护。</p>
            <SupportAuthorButton />
          </div>
        </section>

        {/* About */}
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">About</h3>
          <div className="p-3 rounded-lg border border-border bg-surface">
            <p className="text-sm text-foreground">
              Skillbox v{appVersion || "0.1.6"}
            </p>
            <p className="text-[12px] text-muted mt-1">
              Manage AI Agent skills and MCP connections from your desktop.
            </p>
          </div>
        </section>
          </div>
        </div>

        <footer className="skillbox-settings-panel__footer">
          <span>Changes are saved automatically.</span>
          <button type="button" onClick={closeSettings}>Done</button>
        </footer>
      </section>
    </div>
  )
}
