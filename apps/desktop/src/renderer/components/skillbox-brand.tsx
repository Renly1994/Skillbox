import { TranslationApiControl } from "./translation-api-dialog"
import skillboxMark from "../assets/skillbox-mark.svg"
import { SupportAuthorButton } from "./support-author"

export const OPEN_SETTINGS_DIALOG = "skillbox:open-settings-dialog"

export function openSettingsDialog() {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_DIALOG))
}

export function SkillboxBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`skillbox-brand ${compact ? "skillbox-brand--compact" : ""}`}>
      <img src={skillboxMark} alt="" draggable={false} />
      <span data-no-localize aria-label="Skillbox">
        Skill<span>box</span>
      </span>
    </div>
  )
}

export function SidebarUtilities() {
  return (
    <>
    <SupportAuthorButton />
    <div className="skillbox-utilities">
      <button
        type="button"
        className="skillbox-settings-button"
        onClick={openSettingsDialog}
        aria-label="设置"
        aria-haspopup="dialog"
        title="设置"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3V9.6h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.38.33.72.6 1 .3.27.68.4 1.1.4H21v4h-.09a1.7 1.7 0 0 0-1.51.6Z" />
        </svg>
        <span>设置</span>
      </button>
      <TranslationApiControl />
      <span className="skillbox-local-state">
        <i /> 本地模式
      </span>
    </div>
    </>
  )
}
