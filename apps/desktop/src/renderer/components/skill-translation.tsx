import { useEffect, useState } from "react"
import { electronAPI } from "../lib/electron-api"
import {
  parseSkillTranslationDocument,
  prepareSkillTranslationDocument,
} from "../lib/skill-translation-document"
import { openTranslationApiDialog } from "./translation-api-dialog"
import { SupportAuthorButton } from "./support-author"

const TRANSLATION_VIEW_CHANGED = "skillbox:translation-view-changed"

export type TranslationViewPreference = Pick<
  SkillTranslationPreference,
  "identity" | "sourceDescription" | "translatedDescription" | "showTranslation"
>

export function resolveTranslationDescription(
  originalDescription: string | null | undefined,
  preference: TranslationViewPreference | null | undefined,
): string | null {
  const original = originalDescription?.trim() || null
  if (!preference || preference.sourceDescription !== original) return original
  if (preference.showTranslation && preference.translatedDescription) {
    return preference.translatedDescription
  }
  return original
}

function announceTranslationView(preference: SkillTranslationPreference) {
  window.dispatchEvent(new CustomEvent(TRANSLATION_VIEW_CHANGED, { detail: preference }))
}

export function useTranslationViewPreferences() {
  const [preferences, setPreferences] = useState<Record<string, TranslationViewPreference>>({})

  useEffect(() => {
    let active = true
    const load = () => {
      electronAPI.translationListViews()
        .then((items) => {
          if (!active) return
          setPreferences(Object.fromEntries(items.map((item) => [item.identity, item])))
        })
        .catch(() => {})
    }
    load()

    const handleChange = (event: Event) => {
      const preference = (event as CustomEvent<SkillTranslationPreference>).detail
      if (!preference?.identity) return
      setPreferences((current) => ({
        ...current,
        [preference.identity]: preference,
      }))
    }
    window.addEventListener(TRANSLATION_VIEW_CHANGED, handleChange)
    const stopSkillsUpdated = electronAPI.onSkillsUpdated(load)
    return () => {
      active = false
      stopSkillsUpdated()
      window.removeEventListener(TRANSLATION_VIEW_CHANGED, handleChange)
    }
  }, [])

  return preferences
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const marker = message.lastIndexOf("Error: ")
  return marker >= 0 ? message.slice(marker + 7) : message
}

export function useSkillTranslation(
  content: string | null,
  description: string | null | undefined,
  identity: string,
) {
  const [translatedContent, setTranslatedContent] = useState<string | null>(null)
  const [translatedDescription, setTranslatedDescription] = useState<string | null>(null)
  const [translationCacheKey, setTranslationCacheKey] = useState<string | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cached, setCached] = useState(false)
  const [tokenUsage, setTokenUsage] = useState<number | null>(null)
  const [showSetupPrompt, setShowSetupPrompt] = useState(false)
  const [completedTranslation, setCompletedTranslation] = useState(false)

  useEffect(() => {
    let cancelled = false
    setTranslatedContent(null)
    setTranslatedDescription(null)
    setTranslationCacheKey(null)
    setShowTranslation(false)
    setLoading(false)
    setError(null)
    setCached(false)
    setTokenUsage(null)
    setShowSetupPrompt(false)
    setCompletedTranslation(false)
    if (!identity || !content) return () => { cancelled = true }

    const prepared = prepareSkillTranslationDocument(content, description)
    electronAPI.translationGetState({ identity, content: prepared.content })
      .then(async (stored) => {
        if (!stored || cancelled) return
        const translated = parseSkillTranslationDocument(
          stored.content,
          prepared.includesDescription,
        )
        if (cancelled) return
        setTranslatedContent(translated.content)
        setTranslatedDescription(translated.description)
        setTranslationCacheKey(stored.cacheKey)
        setShowTranslation(stored.showTranslation)
        setCached(true)

        const preference = await electronAPI.translationSetView({
          identity,
          content: prepared.content,
          cacheKey: stored.cacheKey,
          sourceDescription: description,
          translatedDescription: translated.description,
          showTranslation: stored.showTranslation,
        })
        if (!cancelled) announceTranslationView(preference)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [identity, content, description])

  const persistView = async (
    show: boolean,
    cacheKey: string,
    nextTranslatedDescription: string | null,
  ) => {
    if (!content || !identity) return
    const prepared = prepareSkillTranslationDocument(content, description)
    const preference = await electronAPI.translationSetView({
      identity,
      content: prepared.content,
      cacheKey,
      sourceDescription: description,
      translatedDescription: nextTranslatedDescription,
      showTranslation: show,
    })
    announceTranslationView(preference)
  }

  const toggle = async () => {
    if (!content || loading) return
    if (translatedContent && translationCacheKey) {
      const next = !showTranslation
      setShowTranslation(next)
      setCompletedTranslation(false)
      setError(null)
      try {
        await persistView(next, translationCacheKey, translatedDescription)
      } catch (err) {
        setError(readableError(err))
      }
      return
    }

    setLoading(true)
    setError(null)
    try {
      const config = await electronAPI.translationGetConfig()
      if (!config.apiKeyConfigured) {
        setShowSetupPrompt(true)
        return
      }
      const prepared = prepareSkillTranslationDocument(content, description)
      const result = await electronAPI.translateSkillContent(prepared.content)
      const translated = parseSkillTranslationDocument(
        result.content,
        prepared.includesDescription,
      )
      setTranslatedContent(translated.content)
      setTranslatedDescription(translated.description)
      setTranslationCacheKey(result.cacheKey)
      setShowTranslation(true)
      setCached(result.cached)
      setTokenUsage(result.usage?.totalTokens ?? null)
      await persistView(true, result.cacheKey, translated.description)
      setCompletedTranslation(!result.cached)
    } catch (err) {
      const message = readableError(err)
      if (message.includes("未配置大模型 API")) {
        setShowSetupPrompt(true)
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }

  return {
    visibleContent: showTranslation && translatedContent ? translatedContent : content,
    visibleDescription: showTranslation && translatedDescription
      ? translatedDescription
      : description,
    translatedContent,
    translatedDescription,
    showTranslation,
    loading,
    error,
    cached,
    tokenUsage,
    showSetupPrompt,
    completedTranslation,
    toggle,
    closeSetupPrompt: () => setShowSetupPrompt(false),
  }
}

type SkillTranslationState = ReturnType<typeof useSkillTranslation>

export function SkillTranslationAction({ state }: { state: SkillTranslationState }) {
  const label = state.loading
    ? "翻译中…"
    : state.translatedContent
      ? state.showTranslation ? "查看原文" : "查看译文"
      : "翻译"

  return (
    <>
      <div className="skillbox-translation-action">
        <button
          type="button"
          className={`skillbox-translate-button${state.showTranslation ? " is-translated" : ""}${state.error ? " is-error" : ""}`}
          onClick={() => void state.toggle()}
          disabled={state.loading || !state.visibleContent}
          aria-busy={state.loading}
          aria-pressed={state.showTranslation}
          title="翻译仅用于预览，不会修改 SKILL.md"
        >
          {state.loading ? (
            <span className="skillbox-translate-spinner" aria-hidden />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 5h7M7.5 3v2M5 8c1.2 2.5 3.1 4.6 5.7 6M10 8c-1.1 2.2-2.9 4.2-5.4 6" />
              <path d="m13 19 3.5-9 3.5 9M14.3 16h4.4" />
            </svg>
          )}
          {label}
        </button>
      </div>

      {state.showSetupPrompt && (
        <div className="skillbox-modal-backdrop skillbox-modal-backdrop--nested" role="presentation">
          <section className="skillbox-setup-prompt" role="alertdialog" aria-modal="true" aria-labelledby="translation-setup-title">
            <div className="skillbox-setup-prompt__icon" aria-hidden>API</div>
            <h2 id="translation-setup-title">未配置大模型 API</h2>
            <p>先添加你自己的 API Key，保存后即可翻译当前 Skill。</p>
            <div>
              <button type="button" onClick={state.closeSetupPrompt}>稍后再说</button>
              <button
                type="button"
                className="is-primary"
                onClick={() => {
                  state.closeSetupPrompt()
                  openTranslationApiDialog()
                }}
              >
                去配置
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

export function SkillTranslationStatus({ state }: { state: SkillTranslationState }) {
  if (!state.showTranslation && !state.error) return null

  return (
    <>
    <div className="skillbox-translation-status" aria-live="polite">
      {state.showTranslation && (
        <span className="skillbox-translation-meta">
          中文预览{state.cached ? " · 本地缓存" : state.tokenUsage ? ` · ${state.tokenUsage.toLocaleString()} tokens` : ""}
        </span>
      )}
      {state.error && <span className="skillbox-translation-error" role="alert">{state.error}</span>}
    </div>
    {state.showTranslation && state.completedTranslation && !state.loading && !state.error && (
      <div className="skillbox-support-after-success"><SupportAuthorButton /></div>
    )}
    </>
  )
}
