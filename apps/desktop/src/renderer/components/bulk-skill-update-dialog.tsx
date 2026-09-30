import { useEffect, useMemo, useRef, useState } from "react"
import { electronAPI } from "../lib/electron-api"

type CheckStatus = "idle" | "pending" | "checking" | "available" | "current" | "error"

interface CheckRow {
  skill: InstalledSkill
  status: CheckStatus
  changeCount?: number
  error?: string
}

interface Props {
  skills: InstalledSkill[]
  loading: boolean
  loadError: boolean
  onRetryLoad: () => void
  onClose: () => void
  onLinkSources: () => void
  onChangeSource: (skill: InstalledSkill) => void
  onOpenUpdate: (skill: InstalledSkill) => void
}

function checkErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ""
  const detail = message.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "")
  return /^[\u3400-\u9fff]/u.test(detail) ? detail : "检查失败，请确认来源可访问"
}

export function BulkSkillUpdateDialog({ skills, loading, loadError, onRetryLoad, onClose, onLinkSources, onChangeSource, onOpenUpdate }: Props) {
  const [rows, setRows] = useState<CheckRow[]>(() => skills.map((skill) => ({ skill, status: "idle" })))
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<"all" | "available" | "error">("all")
  const [checking, setChecking] = useState(false)
  const [runPaths, setRunPaths] = useState<string[]>([])
  const checkingRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const paths = new Set(skills.map((skill) => skill.canonicalPath))
    setRows((current) => {
      const previous = new Map(current.map((row) => [row.skill.canonicalPath, row]))
      return skills.map((skill) => ({ ...previous.get(skill.canonicalPath), skill, status: previous.get(skill.canonicalPath)?.status ?? "idle" }))
    })
    setSelectedPaths((current) => new Set([...current].filter((path) => paths.has(path))))
  }, [skills])

  async function runCheck(targets: InstalledSkill[]) {
    if (checkingRef.current || loading || loadError || targets.length === 0) return
    checkingRef.current = true
    setChecking(true)
    setFilter("all")
    setRunPaths(targets.map((skill) => skill.canonicalPath))
    const targetPaths = new Set(targets.map((skill) => skill.canonicalPath))
    setRows((current) => current.map((row) => targetPaths.has(row.skill.canonicalPath)
      ? { skill: row.skill, status: "pending" }
      : row))

    let nextIndex = 0
    async function worker() {
      while (mountedRef.current && nextIndex < targets.length) {
        const skill = targets[nextIndex++]
        setRows((current) => current.map((row) => row.skill.canonicalPath === skill.canonicalPath
          ? { skill: row.skill, status: "checking" }
          : row))
        try {
          const result = await electronAPI.checkSkillUpdate({ name: skill.name, canonicalPath: skill.canonicalPath })
          if (!mountedRef.current) return
          setRows((current) => current.map((row) => row.skill.canonicalPath === skill.canonicalPath
            ? { skill: row.skill, status: result.available ? "available" : "current", changeCount: result.changes.length }
            : row))
        } catch (error) {
          if (!mountedRef.current) return
          setRows((current) => current.map((row) => row.skill.canonicalPath === skill.canonicalPath
            ? { skill: row.skill, status: "error", error: checkErrorMessage(error) }
            : row))
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, () => worker()))
    if (mountedRef.current) {
      checkingRef.current = false
      setChecking(false)
    }
  }

  const selectedSkills = useMemo(() => skills.filter((skill) => selectedPaths.has(skill.canonicalPath)), [skills, selectedPaths])
  const checked = rows.filter((row) => row.status === "available" || row.status === "current" || row.status === "error").length
  const completedInRun = rows.filter((row) => runPaths.includes(row.skill.canonicalPath) &&
    (row.status === "available" || row.status === "current" || row.status === "error")).length
  const available = rows.filter((row) => row.status === "available").length
  const current = rows.filter((row) => row.status === "current").length
  const failed = rows.filter((row) => row.status === "error").length
  const visibleRows = useMemo(() => rows.filter((row) =>
    filter === "all" || row.status === filter,
  ), [filter, rows])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <div className="skillbox-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="bulk-update-title" className="skillbox-bulk-update-dialog">
        <header className="skillbox-bulk-update-header">
          <div>
            <h2 id="bulk-update-title">检查来源更新</h2>
            <p>{loading ? "正在读取已关联的 Skill…" : skills.length > 0
              ? `共 ${skills.length} 个已关联来源的 Skill，选择后开始检查。`
              : "关联来源后，可在这里统一检查 Skill 更新。"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="skillbox-bulk-update-close">×</button>
        </header>

        {!loading && !loadError && skills.length > 0 && (
          <>
            <div className="skillbox-bulk-update-actions">
              <span>已选 {selectedPaths.size}/{skills.length}</span>
              <button type="button" disabled={checking} onClick={() => setSelectedPaths(new Set(skills.map((skill) => skill.canonicalPath)))}>全选</button>
              <button type="button" disabled={checking || selectedPaths.size === 0} onClick={() => setSelectedPaths(new Set())}>清空</button>
              <div className="skillbox-bulk-update-actions__run">
                <button type="button" disabled={checking || selectedSkills.length === 0} onClick={() => void runCheck(selectedSkills)}>检查所选 ({selectedSkills.length})</button>
                <button type="button" disabled={checking} onClick={() => void runCheck(skills)}>检查全部 ({skills.length})</button>
              </div>
            </div>
            {(checked > 0 || checking) && (
              <>
                <div className="skillbox-bulk-update-summary">
                  <div><strong>{available}</strong><span>可更新</span></div>
                  <div><strong>{current}</strong><span>已是最新</span></div>
                  <div><strong>{failed}</strong><span>检查失败</span></div>
                  <p aria-live="polite">{checking ? `正在检查 ${completedInRun}/${runPaths.length}` : `已检查 ${checked}/${skills.length}`}</p>
                </div>
                <div className="skillbox-bulk-update-progress" role="progressbar" aria-label="检查进度" aria-valuemin={0} aria-valuemax={runPaths.length} aria-valuenow={completedInRun}>
                  <span style={{ width: `${runPaths.length ? completedInRun / runPaths.length * 100 : 0}%` }} />
                </div>
                <div className="skillbox-bulk-update-toolbar" role="group" aria-label="筛选检查结果">
                  <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>全部 <span>{skills.length}</span></button>
                  <button type="button" aria-pressed={filter === "available"} onClick={() => setFilter("available")}>可更新 <span>{available}</span></button>
                  <button type="button" aria-pressed={filter === "error"} onClick={() => setFilter("error")}>检查失败 <span>{failed}</span></button>
                </div>
              </>
            )}
          </>
        )}

        <div className="skillbox-bulk-update-list">
          {loading ? (
            <p className="skillbox-bulk-update-empty">正在读取已关联的 Skill…</p>
          ) : loadError ? (
            <div className="skillbox-bulk-update-empty">
              <p>无法读取已关联的 Skill，请重试</p>
              <button type="button" className="skillbox-bulk-update-open" onClick={onRetryLoad}>重试</button>
            </div>
          ) : skills.length === 0 ? (
            <div className="skillbox-bulk-update-empty">
              <p>还没有关联更新来源的 Skill。</p>
              <button type="button" className="skillbox-bulk-update-open" onClick={onLinkSources}>管理 Skill 来源</button>
            </div>
          ) : visibleRows.length === 0 ? (
            <p className="skillbox-bulk-update-empty">没有符合条件的 Skill</p>
          ) : visibleRows.map((row) => (
            <div key={row.skill.canonicalPath} className={`skillbox-bulk-update-row${selectedPaths.has(row.skill.canonicalPath) ? " is-selected" : ""}`}>
              <input
                type="checkbox"
                className="skillbox-bulk-update-checkbox"
                aria-label={`选择 ${row.skill.name}`}
                checked={selectedPaths.has(row.skill.canonicalPath)}
                disabled={checking}
                onChange={() => setSelectedPaths((current) => {
                  const next = new Set(current)
                  if (next.has(row.skill.canonicalPath)) next.delete(row.skill.canonicalPath)
                  else next.add(row.skill.canonicalPath)
                  return next
                })}
              />
              <span className={`skillbox-bulk-update-indicator is-${row.status}`} aria-hidden="true" />
              <div className="skillbox-bulk-update-row-main">
                <strong data-no-localize title={row.skill.name}>{row.skill.name}</strong>
                <small data-no-localize title={row.skill.source}>{row.skill.source}</small>
                {row.error && <p role="alert">{row.error}</p>}
              </div>
              {row.status === "available" ? (
                <button type="button" className="skillbox-bulk-update-open" onClick={() => onOpenUpdate(row.skill)}>
                  {row.changeCount} 项变化 · 查看
                </button>
              ) : row.status === "error" ? (
                <button type="button" className="skillbox-bulk-update-open" onClick={() => onChangeSource(row.skill)}>更改来源</button>
              ) : (
                <span className="skillbox-bulk-update-status">
                  {row.status === "current" ? "已是最新" : row.status === "checking" ? "检查中…" : row.status === "pending" ? "等待中" : "待检查"}
                </span>
              )}
            </div>
          ))}
        </div>

        <footer className="skillbox-bulk-update-footer">
          <p>只检查更新，不修改本地文件。</p>
          <button type="button" onClick={onClose}>完成</button>
        </footer>
      </section>
    </div>
  )
}
