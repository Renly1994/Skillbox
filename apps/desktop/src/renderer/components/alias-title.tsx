import { useEffect, useRef, useState } from "react"

interface AliasTitleProps {
  /** 真实名称（MCP server 名 / Skill 名），别名留空时展示它。 */
  name: string
  alias: string | undefined
  onSave: (alias: string) => void
  className?: string
}

/**
 * 详情页标题：粗体始终是真实名称，别名（如已设置）以小字跟在后面，
 * 点编辑按钮就地修改别名。Enter / 失焦保存，Esc 取消；
 * 保存空值或与真实名称相同即清除别名。
 */
export function AliasTitle({ name, alias, onSave, className }: AliasTitleProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // 切换目标时退出编辑态，避免把草稿写到另一个条目上。
  useEffect(() => {
    setEditing(false)
  }, [name])

  if (editing) {
    const commit = () => {
      onSave(draft)
      setEditing(false)
    }
    return (
      <input
        ref={inputRef}
        className="skillbox-alias-input"
        value={draft}
        placeholder={name}
        aria-label="编辑显示名称"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit()
          if (event.key === "Escape") setEditing(false)
        }}
      />
    )
  }

  return (
    <>
      <h1 data-no-localize title={name} className={className}>
        {name}
      </h1>
      {alias && (
        <small data-no-localize className="skillbox-alias-real" title={`显示名称「${alias}」，仅在本工具内展示`}>
          {alias}
        </small>
      )}
      <button
        type="button"
        className={`skillbox-alias-edit ${alias ? "is-set" : ""}`}
        title={alias ? "修改显示名称" : "设置显示名称"}
        aria-label={alias ? "修改显示名称" : "设置显示名称"}
        onClick={() => {
          setDraft(alias ?? "")
          setEditing(true)
        }}
      >
        ✎
      </button>
    </>
  )
}
