import { useEffect, useState } from "react"

// Copy-to-clipboard button with transient "copied" state — shared by skill
// rows (library) and MCP rows/detail so the affordance looks identical.
// label 用于详情等场景自定义悬停文案，如 label="Skill 名称" → “复制 Skill 名称”。
export function CopySkillName({ name, label }: { name: string; label?: string }) {
  const [status, setStatus] = useState("idle")
  useEffect(() => {
    setStatus("idle")
  }, [name])
  useEffect(() => {
    if (status === "idle") return
    const timer = setTimeout(() => setStatus("idle"), 1600)
    return () => clearTimeout(timer)
  }, [status])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(name)
      setStatus("copied")
    } catch {
      setStatus("error")
    }
  }
  const what = label ?? "名称"
  const sep = label ? " " : ""
  const text = status === "copied" ? `已复制${sep}${what}` : status === "error" ? "复制失败，请重试" : `复制${sep}${what}`
  return (
    <button
      type="button"
      className="skillbox-copy-name"
      title={text}
      aria-label={`${text}：${name}`}
      onClick={(event) => { event.stopPropagation(); void copy() }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          event.stopPropagation()
          void copy()
        }
      }}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {status === "copied" ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>}
      </svg>
      <span className="sr-only" role="status">{status === "idle" ? "" : text}</span>
    </button>
  )
}
