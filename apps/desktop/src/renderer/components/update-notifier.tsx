import { useEffect, useState } from "react"
import { marked } from "marked"
import { electronAPI } from "../lib/electron-api"

marked.setOptions({ async: false, breaks: true, gfm: true })

// Minimal HTML sanitizer for release notes (same policy as Discover).
function sanitizeHtml(html: string): string {
  let clean = html.replace(
    /<(script|iframe|object|embed|form|style)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi,
    "",
  )
  clean = clean.replace(/<(script|iframe|object|embed|link)\b[^>]*\/?>/gi, "")
  clean = clean.replace(/\s+on\w+\s*=\s*["']?[^"'>\s]*["']?/gi, "")
  clean = clean.replace(/href\s*=\s*["']?\s*javascript:/gi, 'href="')
  clean = clean.replace(/src\s*=\s*["']?\s*javascript:/gi, 'src="')
  return clean
}

interface ReleaseNotes {
  version: string
  name: string
  body: string
  url: string
  publishedAt: string
}

function UpdateIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

export function UpdateNotifier() {
  const [state, setState] = useState<UpdateState | null>(null)
  const [appVersion, setAppVersion] = useState("")
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<ReleaseNotes | null>(null)
  const [notesLoading, setNotesLoading] = useState(false)

  useEffect(() => {
    electronAPI.updatesGetState().then(setState).catch(() => {})
    electronAPI.appGetVersion().then(setAppVersion).catch(() => {})
    return electronAPI.onUpdateState(setState)
  }, [])

  const hasUpdate =
    state?.status === "available" ||
    state?.status === "downloading" ||
    state?.status === "downloaded"

  // Fetch release notes when the dialog opens with an update pending.
  useEffect(() => {
    if (!open || !hasUpdate || notes || notesLoading) return
    setNotesLoading(true)
    electronAPI
      .updatesReleaseNotes()
      .then((result) => setNotes(result))
      .catch(() => setNotes(null))
      .finally(() => setNotesLoading(false))
  }, [open, hasUpdate, notes, notesLoading])

  const targetVersion =
    state?.downloadedVersion || state?.availableVersion || notes?.version

  return (
    <>
      <button
        type="button"
        className={`skillbox-update-button ${hasUpdate ? "has-update" : ""}`}
        title={hasUpdate ? `新版本 ${targetVersion} 可用` : "检查更新"}
        aria-label={hasUpdate ? `新版本 ${targetVersion} 可用` : "检查更新"}
        onClick={() => setOpen(true)}
      >
        <UpdateIcon />
        {hasUpdate && <i className="skillbox-update-dot" />}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[16px] font-semibold text-foreground">版本更新</h2>
                <p className="mt-1 text-[12px] text-muted">
                  当前版本 v{appVersion || "…"}
                  {targetVersion && hasUpdate ? ` → 新版本 v${targetVersion}` : ""}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="skillbox-detail-close"
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            {/* Status area */}
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              {state?.status === "checking" && (
                <p className="text-[12px] text-muted">正在检查更新…</p>
              )}
              {state?.status === "available" && (
                <p className="text-[12px] text-foreground">
                  发现新版本 v{state.availableVersion}，正在后台下载…
                </p>
              )}
              {state?.status === "downloading" && (
                <div>
                  <p className="text-[12px] text-foreground mb-2">
                    正在下载 v{state.availableVersion ?? targetVersion}…
                  </p>
                  <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${Math.round(state.progressPercent ?? 0)}%` }}
                    />
                  </div>
                </div>
              )}
              {state?.status === "downloaded" && (
                <p className="text-[12px] text-foreground">
                  v{state.downloadedVersion} 已下载完成，重启后生效。
                </p>
              )}
              {state?.status === "error" && (
                <p className="text-[12px] text-muted">
                  检查更新失败：{state.message}
                </p>
              )}
              {(state?.status === "idle" ||
                state?.status === "not-available" ||
                !state) && (
                <p className="text-[12px] text-muted">
                  {state?.status === "not-available"
                    ? "当前已是最新版本。"
                    : state?.message || "启动时会自动检查更新，也可以手动检查。"}
                </p>
              )}
            </div>

            {/* Release notes */}
            {hasUpdate && (
              <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-border bg-background px-4 py-3">
                {notesLoading ? (
                  <p className="text-[12px] text-muted">正在载入更新内容…</p>
                ) : notes?.body ? (
                  <div
                    className="skillbox-release-notes text-[12px] text-foreground"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(marked.parse(notes.body) as string),
                    }}
                  />
                ) : (
                  <p className="text-[12px] text-muted">暂无更新说明。</p>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex items-center justify-end gap-2">
              {notes?.url && (
                <button
                  onClick={() => window.open(notes.url)}
                  className="rounded-lg border border-border px-4 py-2 text-[12px] text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
                >
                  查看 GitHub Release
                </button>
              )}
              {state?.status === "downloaded" ? (
                <button
                  onClick={() => electronAPI.updatesInstall()}
                  className="rounded-lg bg-accent px-4 py-2 text-[12px] font-medium text-white"
                >
                  立即重启安装
                </button>
              ) : (
                <button
                  onClick={() => void electronAPI.updatesCheck().then(setState)}
                  disabled={state?.status === "checking" || state?.status === "downloading"}
                  className="rounded-lg border border-border px-4 py-2 text-[12px] font-medium text-foreground hover:bg-surface-hover disabled:opacity-40 transition-colors"
                >
                  {state?.status === "checking" ? "检查中…" : "检查更新"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
