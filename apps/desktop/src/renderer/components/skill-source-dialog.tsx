import { useEffect, useMemo, useRef, useState } from "react"
import { electronAPI } from "../lib/electron-api"
import { changedSourceSkills, isSourceKindValid, sourceKindForSkill, type SkillSourceKind } from "../lib/skill-source-drafts"

interface Props {
  open: boolean
  skills: InstalledSkill[]
  onClose: () => void
  onLinked: () => Promise<void>
}

export function SkillSourceDialog({ open, skills, onClose, onLinked }: Props) {
  const [sharedKind, setSharedKind] = useState<SkillSourceKind>("github")
  const [sharedSource, setSharedSource] = useState("")
  const [sources, setSources] = useState<Record<string, string>>({})
  const [kinds, setKinds] = useState<Record<string, SkillSourceKind>>({})
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "unlinked" | "linked">("all")
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const skillPathsKey = skills.map((skill) => skill.canonicalPath).join("\0")
  const unlinkedCount = skills.filter((skill) => !skill.hasLinkedSource).length
  const changes = changedSourceSkills(skills, sources)
  const visibleSkills = useMemo(() => skills.filter((skill) => {
    if (status === "linked" && !skill.hasLinkedSource) return false
    if (status === "unlinked" && skill.hasLinkedSource) return false
    const term = query.trim().toLowerCase()
    return !term || `${skill.name} ${skill.source ?? ""} ${skill.canonicalPath}`.toLowerCase().includes(term)
  }), [query, skills, status])

  useEffect(() => {
    if (!open) return
    setSharedKind("github")
    setSharedSource("")
    setSources({})
    setKinds({})
    setQuery("")
    setStatus("all")
    setExpandedPath(null)
    setError(null)
    if (skills.length === 1) window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open, skillPathsKey])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [busy, onClose, open])

  if (!open) return null

  const chooseDirectory = async (path?: string) => {
    const directory = await electronAPI.chooseSkillSourceDirectory()
    if (!directory) return
    if (path) {
      setKinds((current) => ({ ...current, [path]: "local" }))
      setSources((current) => ({ ...current, [path]: directory }))
    } else {
      setSharedKind("local")
      setSharedSource(directory)
    }
  }

  const fillUnlinked = () => {
    const value = sharedSource.trim()
    if (!value) return
    if (!isSourceKindValid(sharedKind, value)) {
      setError(sharedKind === "github" ? "请输入 GitHub 仓库地址或 owner/repo。" : "请输入本地目录的完整路径，或点击“选择文件夹”。")
      return
    }
    setError(null)
    setSources((current) => Object.fromEntries(skills.map((skill) => [
      skill.canonicalPath,
      current[skill.canonicalPath] || (skill.hasLinkedSource ? "" : value),
    ])))
    setKinds((current) => Object.fromEntries(skills.map((skill) => [
      skill.canonicalPath,
      current[skill.canonicalPath] || (skill.hasLinkedSource ? sourceKindForSkill(skill) : sharedKind),
    ])))
  }

  const handleSubmit = async () => {
    if (busy || changes.length === 0) return
    const invalid = changes.find((skill) => !isSourceKindValid(kinds[skill.canonicalPath] || sourceKindForSkill(skill), sources[skill.canonicalPath]))
    if (invalid) {
      setError(`${invalid.name}：${(kinds[invalid.canonicalPath] || sourceKindForSkill(invalid)) === "local" ? "请输入本地目录路径。" : "请输入 GitHub 仓库地址或 owner/repo。"}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await electronAPI.linkSkillSources(changes.map((skill) => ({
        name: skill.name,
        canonicalPath: skill.canonicalPath,
        source: sources[skill.canonicalPath].trim(),
      })))
      if (result.linked > 0) await onLinked()
      if (result.errors.length > 0) {
        const failed = new Set(result.errors.map((item) => item.canonicalPath))
        setSources((current) => Object.fromEntries(Object.entries(current).filter(([path]) => failed.has(path))))
        setError(result.errors.map((item) => `${item.name}：${item.message}`).join("；"))
        return
      }
      onClose()
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "关联来源失败，请检查地址后重试")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="skillbox-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="skill-source-title" className={`skillbox-source-dialog ${skills.length === 1 ? "is-single" : ""} rounded-2xl border border-border bg-surface shadow-xl`}>
        <header className="skillbox-source-dialog__head">
          <div className="min-w-0">
            <h2 id="skill-source-title">{skills.length === 1 ? "更新来源" : "管理更新来源"}</h2>
            <p>{skills.length === 1 ? skills[0].name : `${skills.length - unlinkedCount} 个已关联 · ${unlinkedCount} 个未关联`}</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} disabled={busy} className="skillbox-dialog-close">×</button>
        </header>

        {skills.length > 1 && <div className="skillbox-source-dialog__bulk">
          <div className="skillbox-source-dialog__section-head"><strong>批量关联</strong><span>只填入未关联的 Skill，不覆盖现有来源</span></div>
          <div className="skillbox-source-kind" role="group" aria-label="批量来源类型">
            {(["github", "local"] as const).map((kind) => <button key={kind} type="button" aria-pressed={sharedKind === kind} onClick={() => { setSharedKind(kind); setSharedSource("") }}>{kind === "github" ? "GitHub 仓库" : "本地目录"}</button>)}
          </div>
          <div className="skillbox-source-input-row">
            <input value={sharedSource} onChange={(event) => setSharedSource(event.target.value)} aria-label="批量来源地址" placeholder={sharedKind === "github" ? "owner/repo 或 GitHub 地址" : "来源文件夹的完整路径"} />
            {sharedKind === "local" && <button type="button" onClick={() => void chooseDirectory()}>选择文件夹</button>}
            <button type="button" onClick={fillUnlinked} disabled={!sharedSource.trim() || busy || unlinkedCount === 0}>填入未关联项</button>
          </div>
        </div>}

        {skills.length > 1 && <div className="skillbox-source-dialog__filters">
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索 Skill 或来源" placeholder="搜索 Skill 或来源" />
          {(["all", "unlinked", "linked"] as const).map((value) => <button key={value} type="button" onClick={() => setStatus(value)} aria-pressed={status === value} className="skillbox-source-filter">
            {value === "all" ? `全部 ${skills.length}` : value === "unlinked" ? `未关联 ${unlinkedCount}` : `已关联 ${skills.length - unlinkedCount}`}
          </button>)}
        </div>}

        <div className="skillbox-source-dialog__list">
          {visibleSkills.length === 0 ? <p className="py-8 text-center text-[12px] text-muted">没有匹配的 Skill</p> : visibleSkills.map((skill, index) => {
            const kind = kinds[skill.canonicalPath] || sourceKindForSkill(skill)
            const expanded = skills.length === 1 || expandedPath === skill.canonicalPath
            const draft = sources[skill.canonicalPath]?.trim()
            return <div key={skill.canonicalPath} className="skillbox-source-item">
              {skills.length > 1 && <div className="skillbox-source-item__title">
                <div className="skillbox-source-item__identity"><strong data-no-localize>{skill.name}</strong><code data-no-localize title={skill.canonicalPath}>{skill.canonicalPath}</code></div>
                <span>{draft ? "待保存" : skill.hasLinkedSource ? "已关联" : "未关联"}</span>
                <button type="button" aria-expanded={expanded} onClick={() => setExpandedPath(expanded ? null : skill.canonicalPath)}>{expanded ? "收起" : skill.hasLinkedSource ? "更改" : "关联"}</button>
              </div>}
              {skills.length > 1 && <div className="skillbox-source-item__summary" title={draft || skill.source || "未设置"}>
                {draft ? <>待保存：<code data-no-localize>{draft}</code></> : skill.source ? <>{skill.hasLinkedSource ? "当前来源" : "来源线索"}：<code data-no-localize>{skill.source}</code></> : "尚未关联来源"}
              </div>}
              {skills.length === 1 && <div className="skillbox-source-item__current">
                <span>{skill.hasLinkedSource ? "当前更新来源" : skill.source ? "发现的来源线索（未关联）" : "当前更新来源"}</span>
                <code data-no-localize>{skill.source || "未设置"}</code>
              </div>}
              {skills.length === 1 && <div className="skillbox-source-item__current"><span>Skill 所在目录</span><code data-no-localize>{skill.canonicalPath}</code></div>}
              {expanded && <div className="skillbox-source-item__edit">
                <label htmlFor={`skill-source-${index}`}>{skill.hasLinkedSource ? "更改为" : "关联到"}</label>
                <div className="skillbox-source-kind" role="group" aria-label={`${skill.name} 的来源类型`}>
                  {(["github", "local"] as const).map((value) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => {
                    setKinds((current) => ({ ...current, [skill.canonicalPath]: value }))
                    setSources((current) => ({ ...current, [skill.canonicalPath]: "" }))
                  }}>{value === "github" ? "GitHub 仓库" : "本地目录"}</button>)}
                </div>
                <div className="skillbox-source-input-row">
                  <input ref={skills.length === 1 ? inputRef : undefined} id={`skill-source-${index}`} value={sources[skill.canonicalPath] ?? ""}
                    onChange={(event) => setSources((current) => ({ ...current, [skill.canonicalPath]: event.target.value }))}
                    onKeyDown={(event) => { if (event.key === "Enter") void handleSubmit() }}
                    placeholder={kind === "github" ? "owner/repo 或 GitHub 地址" : "来源文件夹的完整路径"} />
                  {kind === "local" && <button type="button" onClick={() => void chooseDirectory(skill.canonicalPath)}>选择文件夹</button>}
                </div>
              </div>}
            </div>
          })}
        </div>
        <p className="skillbox-source-dialog__note">保存时会确认来源中包含对应 Skill；同名仓库不一定是更新来源。本地来源可选 Skill 文件夹或上层目录。关联信息只保存在 Skillbox，不写入 SKILL.md。</p>
        {error && <p role="alert" className="skillbox-source-dialog__error">{error}</p>}
        <footer className="skillbox-source-dialog__footer">
          <span>待保存 {changes.length} 项</span>
          <div><button type="button" onClick={onClose} disabled={busy}>取消</button><button type="button" onClick={() => void handleSubmit()} disabled={busy || changes.length === 0} className="is-primary">{busy ? "保存中…" : "保存来源"}</button></div>
        </footer>
      </section>
    </div>
  )
}
