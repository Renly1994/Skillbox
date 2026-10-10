import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { SKILL_HEAT_THRESHOLDS, type SkillHeat } from "../../shared/skill-heat"
import { useLocalization } from "../lib/localization"

const FLAME_PATH = "M13.4 2.7c.3 3.1-2.8 5.2-2.8 7.5 0 .7.3 1.3.8 1.6 1.5-.8 2-2.1 2.1-3.9 3.1 2.6 5.3 5.2 4.7 8.2-.7 3.2-3.1 5.2-6.2 5.2s-5.7-2.1-6.1-5.1c-.6-4.2 3-7.8 7.5-13.5Z"

export function SkillHeatIndicator({ heat }: { heat?: SkillHeat }) {
  if (heat?.usageCount != null && heat.usageCount < 2) return null
  return <SkillHeatBadge heat={heat} />
}

function SkillHeatBadge({ heat }: { heat?: SkillHeat }) {
  const { locale } = useLocalization()
  const english = locale === "en-US"
  const level = heat?.level ?? null
  const hasUsage = (heat?.usageCount ?? 0) > 0
  const labels = english ? [hasUsage ? "Below Level 1" : "No recent record", "Rarely", "Occasionally", "Often"] : [hasUsage ? "未达一档" : "暂无记录", "较少", "偶尔", "常用"]
  const label = level === null ? (english ? "No data" : "暂无数据") : labels[level]
  const id = useId()
  const trigger = useRef<HTMLElement | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const show = (target: HTMLElement) => {
    window.dispatchEvent(new Event("skillbox:heat-tooltip-open"))
    trigger.current = target
    const box = target.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(box.left - 16, window.innerWidth - 284)), top: box.bottom + 8 })
  }
  useLayoutEffect(() => {
    if (!position || !trigger.current) return
    const tooltip = document.getElementById(id)
    if (!tooltip) return
    const box = trigger.current.getBoundingClientRect()
    const height = tooltip.getBoundingClientRect().height
    const top = box.bottom + height + 16 <= window.innerHeight ? box.bottom + 8 : Math.max(8, box.top - height - 8)
    if (top !== position.top) setPosition({ ...position, top })
  }, [position, id, heat, english])
  useEffect(() => {
    if (!position) return
    const hide = () => setPosition(null)
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); hide() } }
    window.addEventListener("scroll", hide, true)
    window.addEventListener("resize", hide)
    window.addEventListener("skillbox:heat-tooltip-open", hide)
    window.addEventListener("keydown", escape, true)
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); window.removeEventListener("skillbox:heat-tooltip-open", hide); window.removeEventListener("keydown", escape, true) }
  }, [position])
  const detail = level === null
    ? (english ? "No usable usage records yet." : "暂时没有可用的使用记录。")
    : !hasUsage
      ? (english ? "No usage found in the last 30 days. This does not mean it was never used." : "近 30 天未发现使用记录，不代表没有用过。")
      : (english ? "Repeated use in the same session counts once." : "同一会话，多次使用只算 1 次。")
  return <>
    <button type="button" className={`skillbox-skill-heat ${level ? "has-heat" : level === 0 ? "is-unlit" : ""}`} data-no-localize
      aria-label={`${english ? "Recent heat" : "近期热度"}：${label}`} aria-describedby={position ? id : undefined}
      onMouseEnter={event => show(event.currentTarget)} onMouseLeave={event => { if (document.activeElement !== event.currentTarget) setPosition(null) }}
      onFocus={event => show(event.currentTarget)} onBlur={() => setPosition(null)}
      onClick={event => { event.stopPropagation(); show(event.currentTarget) }}>
      {level ? Array.from({ length: level }, (_, index) => <svg key={index} width="13" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={FLAME_PATH} /></svg>)
        : level === 0 ? <svg width="13" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={FLAME_PATH} /></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7.8" /><path d="M9.9 9.7a2.1 2.1 0 1 1 3.5 1.6c-1 .6-1.4 1-1.4 2.2" /><circle cx="12" cy="16" r=".55" fill="currentColor" stroke="none" /></svg>}
    </button>
    {position && createPortal(<div id={id} role="tooltip" data-no-localize className="skillbox-heat-tooltip" style={position}>
      <strong>{level === null ? label : english ? `Last 30 days: ${heat?.usageCount ?? 0} sessions` : `近 30 天使用 ${heat?.usageCount ?? 0} 次`}</strong>
      <p>{detail}</p>
      {heat?.usageCount90 != null && <p>{english ? `Last 90 days: ${heat.usageCount90} sessions` : `近 90 天使用 ${heat.usageCount90} 次`}</p>}
      {hasUsage && <dl className="skillbox-heat-levels">
        {SKILL_HEAT_THRESHOLDS.map((minimum, index) => {
          const next = SKILL_HEAT_THRESHOLDS[index + 1]
          const range = next ? `${minimum}–${next - 1}` : `${minimum}+`
          return <div key={minimum} className={level === index + 1 ? "is-current" : undefined}>
            <dt>{english ? `Level ${index + 1}` : ["一档", "二档", "三档"][index]}</dt>
            <dd>{english ? `${range} sessions` : next ? `${range} 次` : `${minimum} 次及以上`}</dd>
          </div>
        })}
      </dl>}
      {heat?.partial && <p>{english ? "Some records are pending. Counts may increase." : "还有部分记录未统计，次数可能增加。"}</p>}
      {heat?.stale && <p>{english ? "Update unavailable. Showing the previous result." : "暂时无法更新，显示上次统计结果。"}</p>}
      {(heat?.lastSeen || heat?.observedSince || Boolean(heat?.sources.length)) && <small>
        {heat?.observedSince && <div>{english ? "Tracking since: " : "开始统计："}{new Date(heat.observedSince).toLocaleDateString(locale)}</div>}
        {heat?.lastSeen && <div>{english ? "Latest record: " : "最近记录："}{new Date(heat.lastSeen).toLocaleDateString(locale)}</div>}
        {Boolean(heat?.sources.length) && <div>{english ? "Sources: " : "记录来源："}{heat?.sources.join("、")}</div>}
      </small>}
    </div>, document.body)}
  </>
}
