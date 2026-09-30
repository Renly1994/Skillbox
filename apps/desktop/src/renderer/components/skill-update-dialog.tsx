import { useEffect, useMemo, useState } from "react"
import { electronAPI } from "../lib/electron-api"

interface SkillUpdateDialogProps {
  open: boolean
  skill: InstalledSkill | null
  onClose: () => void
  onChangeSource: () => void
  onUpdated: () => Promise<void>
}

function updateErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, "")
    : fallback
}

function changeLabel(kind: SkillUpdateCheck["changes"][number]["kind"]): string {
  if (kind === "only-agent") return "来源新增"
  if (kind === "only-master") return "本地独有"
  return "内容变化"
}

export function SkillUpdateDialog({
  open,
  skill,
  onClose,
  onChangeSource,
  onUpdated,
}: SkillUpdateDialogProps) {
  const [check, setCheck] = useState<SkillUpdateCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = useMemo(
    () => skill ? { name: skill.name, canonicalPath: skill.canonicalPath } : null,
    [skill],
  )

  useEffect(() => {
    if (!open || !target) return
    let cancelled = false
    setChecking(true)
    setCheck(null)
    setError(null)
    electronAPI.checkSkillUpdate(target)
      .then((result) => {
        if (!cancelled) setCheck(result)
      })
      .catch((checkError) => {
        if (!cancelled) setError(updateErrorMessage(checkError, "检查更新失败"))
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => { cancelled = true }
  }, [open, target])

  if (!open || !skill || !target) return null

  const handleUpdate = async () => {
    if (!check?.available || updating) return
    setUpdating(true)
    setError(null)
    try {
      await electronAPI.updateSkill(target)
      await onUpdated()
      onClose()
    } catch (updateError) {
      setError(updateErrorMessage(updateError, "更新失败，当前版本已保留"))
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="skillbox-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-update-title"
        className="w-full max-w-[620px] overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <h2 id="skill-update-title" className="truncate text-[16px] font-semibold text-foreground">
              更新 <span data-no-localize>{skill.name}</span>
            </h2>
            <p className="mt-1 truncate text-[11px] text-muted">{check?.source ?? skill.source ?? "已关联来源"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={updating}
            aria-label="关闭"
            className="min-h-11 min-w-11 rounded-[10px] text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
          >
            ×
          </button>
        </header>

        <div className="min-h-52 px-6 py-5">
          {checking ? (
            <div className="flex min-h-40 items-center justify-center text-[12px] text-muted">正在读取来源并比较文件…</div>
          ) : check ? (
            check.available ? (
              <>
                <div className="mb-4 flex items-center justify-between rounded-[10px] border border-accent/25 bg-accent/10 px-3 py-3">
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">发现 {check.changes.length} 项变化</p>
                    <p className="mt-1 text-[11px] text-muted">更新前会自动保存当前版本，失败时不会替换现有文件。</p>
                  </div>
                  <span className="rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-white">可更新</span>
                </div>
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {check.changes.map((change) => (
                    <div key={`${change.kind}:${change.relativePath}`} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-[11px]">
                      <span className="w-16 shrink-0 text-muted">{changeLabel(change.kind)}</span>
                      <code data-no-localize className="min-w-0 truncate text-foreground">{change.relativePath}</code>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center text-center">
                <p className="text-[13px] font-semibold text-foreground">当前已经是最新版本</p>
                <p className="mt-1 text-[12px] text-muted">本地内容与已关联来源一致。</p>
              </div>
            )
          ) : null}

          {error && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[12px] leading-5 text-red-600">
              <span>{error}</span>
              {error.includes("来源中没有找到") && (
                <button type="button" onClick={onChangeSource} className="shrink-0 rounded-md border border-current px-2 py-1 font-medium hover:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600">
                  更改来源
                </button>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
          <p className="text-[10px] leading-4 text-muted">更新只替换 Skill 文件夹，当前版本和更新结果会独立保存。</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={updating}
              className="min-h-11 whitespace-nowrap rounded-[10px] px-4 text-[12px] text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
            >
              关闭
            </button>
            {check?.available && (
              <button
                type="button"
                onClick={() => void handleUpdate()}
                disabled={updating}
                className="min-h-11 whitespace-nowrap rounded-[10px] bg-foreground px-4 text-[12px] font-medium text-background outline-2 outline-offset-2 hover:opacity-90 focus-visible:outline-accent disabled:opacity-40"
              >
                {updating ? "更新中…" : "保存当前版并更新"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  )
}
