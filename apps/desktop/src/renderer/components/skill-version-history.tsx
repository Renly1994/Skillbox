import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { electronAPI } from "../lib/electron-api"
import { getVersionsForSkill, skillVersionErrorMessage } from "../lib/skill-version-history-view"

interface SkillVersionHistoryProps {
  open: boolean
  skill: InstalledSkill | null
  onClose: () => void
  onRestored: () => Promise<void>
}

type HistoryTab = "content" | "changes"

const reasonLabels: Record<SkillVersionEntry["reason"], string> = {
  initial: "初始版本",
  edit: "编辑保存",
  update: "来源更新",
  restore: "恢复版本",
  manual: "手动保存",
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function buildSimpleDiff(previous: string, current: string) {
  const before = previous.split("\n")
  const after = current.split("\n")
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) suffix += 1
  return {
    prefix: before.slice(0, prefix),
    removed: before.slice(prefix, before.length - suffix),
    added: after.slice(prefix, after.length - suffix),
    suffix: suffix > 0 ? after.slice(after.length - suffix) : [],
  }
}

export function SkillVersionHistory({
  open,
  skill,
  onClose,
  onRestored,
}: SkillVersionHistoryProps) {
  const [history, setHistory] = useState<{ skillPath: string; versions: SkillVersionEntry[] } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [content, setContent] = useState("")
  const [previousContent, setPreviousContent] = useState("")
  const [tab, setTab] = useState<HistoryTab>("content")
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [restorePending, setRestorePending] = useState(false)
  const loadRequestRef = useRef(0)

  const target = useMemo(
    () => skill ? { name: skill.name, canonicalPath: skill.canonicalPath } : null,
    [skill?.name, skill?.canonicalPath],
  )
  const versions = getVersionsForSkill(history, target?.canonicalPath)
  const selectedIndex = versions.findIndex((version) => version.id === selectedId)
  const selected = selectedIndex >= 0 ? versions[selectedIndex] : null
  const comparison = useMemo(
    () => buildSimpleDiff(previousContent, content),
    [content, previousContent],
  )

  const loadVersions = useCallback(async () => {
    if (!target) return
    const requestId = ++loadRequestRef.current
    setLoading(true)
    setError(null)
    try {
      const next = await electronAPI.listSkillVersions(target)
      if (requestId !== loadRequestRef.current) return
      setHistory({ skillPath: target.canonicalPath, versions: next })
      setSelectedId((current) => next.some((version) => version.id === current) ? current : next[0]?.id ?? null)
      setError(null)
    } catch (loadError) {
      if (requestId !== loadRequestRef.current) return
      setError(skillVersionErrorMessage(loadError, "读取历史版本失败"))
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false)
    }
  }, [target])

  useEffect(() => {
    if (!open || !target) return
    setTab("content")
    setRestorePending(false)
    setNotice(null)
    void loadVersions()
    return () => { loadRequestRef.current += 1 }
  }, [loadVersions, open, target])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [busy, onClose, open])

  useEffect(() => {
    if (!open || !target || !selected) {
      setContent("")
      setPreviousContent("")
      return
    }
    let cancelled = false
    setContent("")
    setPreviousContent("")
    setError(null)
    const previous = versions[selectedIndex + 1]
    Promise.all([
      electronAPI.readSkillVersionFile(target, selected.id, "SKILL.md"),
      previous
        ? electronAPI.readSkillVersionFile(target, previous.id, "SKILL.md")
        : Promise.resolve(null),
    ]).then(([currentValue, previousValue]) => {
      if (cancelled) return
      setContent(currentValue ?? "此版本没有 SKILL.md 正文")
      setPreviousContent(previousValue ?? "")
    }).catch((readError) => {
      if (!cancelled) setError(skillVersionErrorMessage(readError, "读取版本正文失败"))
    })
    return () => { cancelled = true }
  }, [open, selected, selectedIndex, target, versions])

  if (!open || !skill || !target) return null

  const handleCreate = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await electronAPI.createSkillVersion(target, "manual")
      await loadVersions()
      setNotice(result.created ? "当前版本已保存。" : "当前内容已保存，没有生成重复快照。")
    } catch (createError) {
      setError(skillVersionErrorMessage(createError, "保存当前版本失败"))
    } finally {
      setBusy(false)
    }
  }

  const handleRestore = async () => {
    if (!selected || !restorePending) {
      setRestorePending(true)
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await electronAPI.restoreSkillVersion(target, selected.id)
      await onRestored()
      await loadVersions()
      setRestorePending(false)
    } catch (restoreError) {
      setError(skillVersionErrorMessage(restoreError, "恢复版本失败"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="skillbox-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-history-title"
        className={`skillbox-history-dialog ${versions.length === 0 ? "is-empty" : ""} flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl`}
      >
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-5">
          <div className="min-w-0">
            <h2 id="skill-history-title" className="truncate text-[15px] font-semibold text-foreground">
              历史版本 · <span data-no-localize>{skill.name}</span>
            </h2>
            <p className="mt-0.5 text-[11px] text-muted">快照保存在 Skill 目录之外</p>
          </div>
          <div className="flex items-center gap-2">
            {versions.length > 0 && <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={busy}
              className="min-h-11 whitespace-nowrap rounded-[10px] border border-border px-3 text-[12px] text-foreground hover:bg-surface-hover disabled:opacity-40"
            >
              保存当前版本
            </button>}
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="关闭"
              className="skillbox-dialog-close disabled:opacity-40"
            >
              ×
            </button>
          </div>
        </header>

        <div className={`grid min-h-0 flex-1 ${versions.length > 0 ? "grid-cols-[240px_minmax(0,1fr)] max-md:grid-cols-1" : "grid-cols-1"}`}>
          {versions.length > 0 && <aside className="min-h-0 overflow-y-auto border-r border-border bg-background/50 p-2.5 max-md:max-h-48 max-md:border-b max-md:border-r-0">
            {loading ? (
              <p className="px-3 py-6 text-center text-[12px] text-muted">正在读取版本…</p>
            ) : versions.map((version, index) => (
              <button
                key={version.id}
                type="button"
                onClick={() => {
                  setSelectedId(version.id)
                  setRestorePending(false)
                }}
                className={`mb-1 w-full rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
                  selectedId === version.id
                    ? "border-accent/35 bg-accent/10"
                    : "border-transparent hover:border-border hover:bg-surface"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] font-semibold text-foreground">
                    v{version.number || versions.length - index}
                    {index === 0 && <small className="ml-1.5 font-normal text-accent">最新</small>}
                  </span>
                  <small className="whitespace-nowrap text-[10px] text-muted">{formatDate(version.createdAt)}</small>
                </div>
                <p className="mt-1 text-[11px] text-muted">{reasonLabels[version.reason]} · {version.fileCount} 个文件</p>
                <p className="mt-1 truncate text-[10px] text-muted">{version.changes.length} 项变化 · {formatSize(version.archiveSize)}</p>
              </button>
            ))}
          </aside>}

          <main className="flex min-h-0 min-w-0 flex-col">
            {selected ? (
              <>
                <div className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-5">
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{reasonLabels[selected.reason]}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{new Date(selected.createdAt).toLocaleString("zh-CN")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTab("content")}
                      className={`min-h-11 whitespace-nowrap rounded-[9px] px-3 text-[12px] ${tab === "content" ? "bg-surface-hover text-foreground" : "text-muted hover:text-foreground"}`}
                    >
                      正文
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab("changes")}
                      className={`min-h-11 whitespace-nowrap rounded-[9px] px-3 text-[12px] ${tab === "changes" ? "bg-surface-hover text-foreground" : "text-muted hover:text-foreground"}`}
                    >
                      与上一版对比
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto bg-background p-5">
                  {tab === "content" ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-foreground">{content}</pre>
                  ) : (
                    <div className="space-y-5">
                      <section>
                        <h3 className="mb-2 text-[12px] font-semibold text-foreground">文件变化</h3>
                        {selected.changes.length === 0 ? (
                          <p className="text-[12px] text-muted">与上一版内容相同。</p>
                        ) : (
                          <div className="space-y-1">
                            {selected.changes.map((change) => (
                              <div key={`${change.kind}:${change.relativePath}`} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-[11px]">
                                <span className="w-12 shrink-0 text-muted">
                                  {change.kind === "added" ? "新增" : change.kind === "removed" ? "删除" : "修改"}
                                </span>
                                <code data-no-localize className="min-w-0 truncate text-foreground">{change.relativePath}</code>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>

                      <section>
                        <h3 className="mb-2 text-[12px] font-semibold text-foreground">SKILL.md 变化</h3>
                        {!previousContent ? (
                          <p className="text-[12px] text-muted">这是最早保存的版本，没有更早正文可供对比。</p>
                        ) : (
                          <div className="overflow-hidden rounded-[10px] border border-border bg-surface font-mono text-[11px] leading-5">
                            {comparison.prefix.map((line, index) => <div key={`p-${index}`} className="px-3 text-muted">  {line}</div>)}
                            {comparison.removed.map((line, index) => <div key={`r-${index}`} className="bg-red-500/10 px-3 text-red-600">- {line}</div>)}
                            {comparison.added.map((line, index) => <div key={`a-${index}`} className="bg-emerald-500/10 px-3 text-emerald-700">+ {line}</div>)}
                            {comparison.suffix.map((line, index) => <div key={`s-${index}`} className="px-3 text-muted">  {line}</div>)}
                          </div>
                        )}
                      </section>
                    </div>
                  )}
                </div>

                <footer className="flex min-h-16 items-center justify-between gap-4 border-t border-border px-5">
                  <p className="text-[11px] text-muted">
                    {restorePending ? "再次点击确认恢复，当前状态会先自动保存。" : "恢复会替换整个 Skill 文件夹。"}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleRestore()}
                    disabled={busy}
                    className={`min-h-11 whitespace-nowrap rounded-[10px] px-4 text-[12px] font-medium disabled:opacity-40 ${restorePending ? "bg-accent text-white" : "border border-border text-foreground hover:bg-surface-hover"}`}
                  >
                    {busy ? "处理中…" : restorePending ? "确认恢复此版本" : "恢复此版本"}
                  </button>
                </footer>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
                <p className="text-[15px] font-semibold text-foreground">{loading ? "正在读取版本…" : "还没有历史版本"}</p>
                {!loading && <>
                  <p className="max-w-[400px] text-[12px] leading-5 text-muted">编辑、更新和恢复时会自动保存。也可以现在保存一份完整的 Skill 文件快照。</p>
                  <button type="button" onClick={() => void handleCreate()} disabled={busy}
                    className="min-h-10 rounded-lg bg-foreground px-4 text-[12px] font-medium text-background disabled:opacity-40">保存当前版本</button>
                </>}
              </div>
            )}
          </main>
        </div>

        {notice && !error && (
          <p role="status" className="border-t border-border px-5 py-3 text-[12px] text-muted">{notice}</p>
        )}
        {error && (
          <p role="alert" className="border-t border-red-500/25 bg-red-500/10 px-5 py-3 text-[12px] text-red-600">{error}</p>
        )}
      </section>
    </div>
  )
}
