import { useEffect, useRef, useState } from "react"
import { useLocalization } from "../lib/localization"
import { getObservedUsageCount, getRecordedUsageCount, type LibraryFilters } from "../lib/skill-library-filters"

export function SkillUsageFilter({ skills, value, onChange, loading = false }: {
  skills: InstalledSkill[]
  value: LibraryFilters
  onChange: (value: LibraryFilters) => void
  loading?: boolean
}) {
  const { locale } = useLocalization()
  const english = locale === "en-US"
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const active = value.usage !== "all"
  const invalid = value.usage === "low" && (!Number.isSafeInteger(value.usageMax) || value.usageMax < 1)
  const insufficient = skills.filter(skill => (value.usage === "idle" ? getObservedUsageCount(skill, value.usageDays) : getRecordedUsageCount(skill, value.usageDays)) === null).length
  const usageRange = value.usageMax === 1 ? "1" : `1–${value.usageMax}`
  const modes = [
    { value: "all", label: english ? "All" : "全部" },
    { value: "low", label: english ? "Low usage" : "低频使用" },
    { value: "idle", label: english ? "Idle" : "长期闲置" },
  ] as const
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape, true)
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true) }
  }, [open])
  return <div className="skillbox-usage-filter" ref={container} data-no-localize>
    <button type="button" className="skillbox-usage-filter__trigger" ref={trigger} disabled={loading}
      aria-label={english ? "Usage filter" : "使用情况筛选"} aria-expanded={open} aria-pressed={active}
      onClick={() => setOpen(current => !current)}>
      {active ? `${modes.find(mode => mode.value === value.usage)!.label} · ${value.usageDays} ${english ? "days" : "天"}` : english ? "Usage" : "使用情况"}
    </button>
    {open && <div className="skillbox-usage-filter__panel" role="group" aria-label={english ? "Usage filter settings" : "使用情况筛选设置"}>
      <div className="skillbox-usage-filter__modes" role="group" aria-label={english ? "Usage status" : "使用状态"}>
        {modes.map(mode => <button type="button" key={mode.value} aria-pressed={value.usage === mode.value} disabled={loading}
          onClick={() => onChange({ ...value, usage: mode.value })}>{mode.label}</button>)}
      </div>
      <label>{english ? "Time range" : "时间范围"}
        <select aria-label={english ? "Usage time range" : "使用情况时间范围"} value={value.usageDays} disabled={!active || loading}
          onChange={event => onChange({ ...value, usageDays: Number(event.target.value) as 30 | 90 })}>
          <option value="30">{english ? "Last 30 days" : "近 30 天"}</option>
          <option value="90">{english ? "Last 90 days" : "近 90 天"}</option>
        </select>
      </label>
      {value.usage !== "idle" && <label>{english ? "Usage limit" : "次数上限"}
        <span><input type="number" min="1" step="1" aria-label={english ? "Low usage limit" : "低频使用次数上限"}
          aria-invalid={invalid} value={value.usageMax || ""} disabled={!active || loading}
          onChange={event => onChange({ ...value, usageMax: event.target.valueAsNumber || 0 })} />{english ? "sessions" : "次"}</span>
      </label>}
      {invalid && <p className="skillbox-usage-filter__error" role="alert">{english ? "Enter a whole number of at least 1." : "请输入至少 1 次的整数。"}</p>}
      <label className="skillbox-usage-filter__favorites"><input type="checkbox" checked={value.excludeFavorites} disabled={!active || loading}
        onChange={event => onChange({ ...value, excludeFavorites: event.target.checked })} />{english ? "Exclude favorites" : "排除收藏"}</label>
      <p>{value.usage === "low"
        ? invalid ? (english ? "Filter by recorded usage in the selected period." : "按所选时间内已记录的次数筛选。")
          : (english ? `Recorded usage in the last ${value.usageDays} days: ${usageRange} ${value.usageMax === 1 ? "session" : "sessions"}.` : `近 ${value.usageDays} 天已记录 ${usageRange} 次使用的技能。`)
        : value.usage === "idle" ? (english ? `Only skills observed for ${value.usageDays} days with no usage records are included.` : `仅显示已统计满 ${value.usageDays} 天、没有使用记录的技能。`)
          : (english ? "Low usage filters by count. Idle requires a full observation period." : "低频按次数筛选，闲置需满观察期。")}</p>
      {value.usage === "low" && <small>{english ? "Counts reflect available records and may change." : "按已有记录估算，次数可能更新。"}</small>}
      {insufficient > 0 && <small>{value.usage === "idle"
        ? (english ? `${insufficient} skills need more records or observation time.` : `${insufficient} 个技能的记录或统计时间不足。`)
        : (english ? `${insufficient} skills have no usable records yet.` : `${insufficient} 个技能暂时没有可用记录。`)}</small>}
    </div>}
  </div>
}
