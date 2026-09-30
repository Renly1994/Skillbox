import { useMemo } from "react"
import { categorizeSkill } from "../lib/skill-category"
import type { LibraryFilters } from "../lib/skill-library-filters"

interface Props {
  skills: InstalledSkill[]
  value: LibraryFilters
  onChange: (value: LibraryFilters) => void
  onReset: () => void
  hasOtherFilters: boolean
}

export function LibraryFiltersBar({ skills, value, onChange }: Props) {
  const { categories } = useMemo(() => {
    const counts = new Map<string, { color: string; count: number }>()
    for (const skill of skills) {
      const category = categorizeSkill(skill.name, skill.description)
      counts.set(category.label, { color: category.color, count: (counts.get(category.label)?.count || 0) + 1 })
    }
    return {
      categories: [...counts].sort((a, b) => b[1].count - a[1].count),
    }
  }, [skills])

  return (
    <section className="skillbox-library-filters" aria-label="技能筛选与排序">
      <div className="skillbox-category-filters" role="group" aria-label="按类别筛选" title="类别按技能名称与描述自动识别；数量为技能库总数">
        <span className="skillbox-filter-label">类别</span>
        <button aria-pressed={!value.category} onClick={() => onChange({ ...value, category: "" })}>
          全部 <span>{skills.length}</span>
        </button>
        {categories.map(([label, { color, count }]) => (
          <button key={label} aria-pressed={value.category === label} onClick={() => onChange({ ...value, category: value.category === label ? "" : label })}>
            <i style={{ background: color }} />{label}<span>{count}</span>
          </button>
        ))}
      </div>

    </section>
  )
}

export function LibraryListActions({ skills, value, onChange, onReset, hasOtherFilters }: Props) {
  const mismatchCount = skills.filter((skill) => skill.versionMismatches.length > 0).length
  const active = Boolean(value.category || value.mismatched || value.uncollected || hasOtherFilters)
  return (
    <div className="skillbox-filter-controls">
        {(mismatchCount > 0 || value.mismatched) && (
          <button className="skillbox-version-filter" aria-pressed={value.mismatched}
            title="筛选母本与 Agent 副本内容不一致的 Skill"
            onClick={() => onChange({ ...value, mismatched: !value.mismatched })}>
            <span aria-hidden="true">⇄</span> 版本差异 <span>{mismatchCount}</span>
          </button>
        )}
        {active && <button className="skillbox-filter-reset" onClick={onReset}>清除筛选</button>}
        <label className="skillbox-sort-control">排序
          <select aria-label="技能排序" title="按列表中真实 Agent 数量从多到少，不计通用目录；同一 Agent 组合相邻，再按 Skill 名称排序" value={value.sort}
            onPointerDown={(event) => { event.currentTarget.dataset.pointerFocus = "true" }}
            onKeyDown={(event) => { delete event.currentTarget.dataset.pointerFocus }}
            onBlur={(event) => { delete event.currentTarget.dataset.pointerFocus }}
            onChange={(event) => onChange({ ...value, sort: event.target.value as LibraryFilters["sort"] })}>
            <option value="default">默认顺序</option>
            <option value="name-asc">名称 A → Z</option>
            <option value="name-desc">名称 Z → A</option>
            <option value="updated">最近更新</option>
            <option value="installed">最近添加</option>
            <option value="coverage">适配数量</option>
            <option value="favorites">收藏优先</option>
          </select>
        </label>
      </div>
  )
}
