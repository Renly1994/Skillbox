import { useState, useEffect } from "react"
import { electronAPI } from "../lib/electron-api"
import { OPEN_UPDATE_DIALOG } from "./update-notifier"

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    electronAPI.updatesGetState().then(setState).catch(() => {})
    const cleanup = electronAPI.onUpdateState((s) => {
      setState(s)
      // 发现新版本或下载完成时重新显示提示。
      if (s.status === "available" || s.status === "downloaded") {
        setDismissed(false)
      }
    })
    return cleanup
  }, [])

  if (dismissed || !state) return null

  if (state.status === "downloaded") {
    return (
      <div className="flex items-center justify-between px-4 py-2.5 bg-accent/10 border-b border-accent/20 text-[12px]">
        <span className="text-foreground">
          Update <strong>v{state.downloadedVersion}</strong> is ready to install.
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDismissed(true)}
            className="text-muted hover:text-foreground transition-colors px-2 py-1"
          >
            Later
          </button>
          <button
            onClick={() => electronAPI.updatesInstall()}
            className="bg-foreground text-background px-3 py-1 rounded-md hover:opacity-90 transition-opacity font-medium"
          >
            Restart & Update
          </button>
        </div>
      </div>
    )
  }

  if (state.status === "available") {
    return (
      <div className="flex items-center justify-between px-4 py-2.5 bg-accent/10 border-b border-accent/20 text-[12px]">
        <span className="text-foreground">
          发现新版本 <strong>v{state.availableVersion}</strong>，等待确认下载。
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDismissed(true)}
            className="text-muted hover:text-foreground transition-colors px-2 py-1"
          >
            Later
          </button>
          <button
            onClick={() => window.dispatchEvent(new Event(OPEN_UPDATE_DIALOG))}
            className="bg-foreground text-background px-3 py-1 rounded-md hover:opacity-90 transition-opacity font-medium"
          >
            查看更新
          </button>
        </div>
      </div>
    )
  }

  if (state.status === "downloading") {
    return (
      <div className="flex items-center justify-between px-4 py-2.5 bg-accent/10 border-b border-accent/20 text-[12px]">
        <span className="text-foreground">
          Downloading update <strong>v{state.availableVersion}</strong>...
          {state.progressPercent != null && (
            <span className="text-muted ml-2">{Math.round(state.progressPercent)}%</span>
          )}
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="text-muted hover:text-foreground transition-colors px-2 py-1"
        >
          Dismiss
        </button>
      </div>
    )
  }

  return null
}
