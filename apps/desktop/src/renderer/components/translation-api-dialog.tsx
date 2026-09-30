import { useEffect, useRef, useState } from "react"
import { electronAPI } from "../lib/electron-api"

export const OPEN_TRANSLATION_API_DIALOG = "skillbox:open-translation-api-dialog"

export function openTranslationApiDialog(): void {
  window.dispatchEvent(new Event(OPEN_TRANSLATION_API_DIALOG))
}

const PRESETS: Record<Exclude<TranslationProviderPreset, "custom">, Omit<TranslationConfigInput, "apiKey">> = {
  deepseek: {
    preset: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiFormat: "openai-chat",
    model: "deepseek-flash",
  },
  openai: {
    preset: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiFormat: "openai-chat",
    model: "gpt-5.4-mini",
  },
  anthropic: {
    preset: "anthropic",
    name: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com",
    apiFormat: "anthropic-messages",
    model: "claude-haiku-4-5-20251001",
  },
}

const DEFAULT_FORM = PRESETS.deepseek

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function TranslationApiControl() {
  const [open, setOpen] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [revealingKey, setRevealingKey] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [form, setForm] = useState<Omit<TranslationConfigInput, "apiKey">>(DEFAULT_FORM)
  const [configView, setConfigView] = useState<TranslationConfigView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)

  const loadConfig = async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await electronAPI.translationGetConfig()
      setConfigView(next)
      setConfigured(next.apiKeyConfigured)
      setForm({
        preset: next.preset,
        name: next.name,
        baseUrl: next.baseUrl,
        apiFormat: next.apiFormat,
        model: next.model,
      })
      setApiKey("")
      setShowApiKey(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    electronAPI.translationGetConfig()
      .then((next) => setConfigured(next.apiKeyConfigured))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const handleOpen = () => setOpen(true)
    window.addEventListener(OPEN_TRANSLATION_API_DIALOG, handleOpen)
    return () => window.removeEventListener(OPEN_TRANSLATION_API_DIALOG, handleOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    void loadConfig()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setOpen(false)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, saving])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => dialogRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const selectPreset = (preset: TranslationProviderPreset) => {
    setError(null)
    if (preset === "custom") {
      setForm((current) => ({ ...current, preset: "custom", name: "自定义" }))
      setShowAdvanced(true)
      return
    }
    setForm(PRESETS[preset])
  }

  const changeApiFormat = (apiFormat: TranslationApiFormat) => {
    setForm((current) => ({
      ...current,
      apiFormat,
      baseUrl: current.preset === "deepseek"
        ? apiFormat === "openai-chat"
          ? "https://api.deepseek.com"
          : "https://api.deepseek.com/anthropic"
        : current.baseUrl,
    }))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await electronAPI.translationSaveConfig({
        ...form,
        apiKey: apiKey.trim() || undefined,
      })
      setConfigView(next)
      setConfigured(next.apiKeyConfigured)
      setApiKey("")
      window.setTimeout(() => setOpen(false), 180)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const toggleApiKeyVisibility = async () => {
    if (showApiKey) {
      setShowApiKey(false)
      return
    }
    if (!apiKey && configured) {
      setRevealingKey(true)
      setError(null)
      try {
        setApiKey(await electronAPI.translationRevealApiKey())
      } catch (err) {
        setError(errorMessage(err))
        return
      } finally {
        setRevealingKey(false)
      }
    }
    setShowApiKey(true)
  }

  const clear = async () => {
    if (!window.confirm("移除后将无法发起新翻译，已缓存的译文会保留。继续吗？")) return
    setSaving(true)
    setError(null)
    try {
      const next = await electronAPI.translationClearConfig()
      setConfigView(next)
      setConfigured(false)
      setForm(PRESETS.deepseek)
      setApiKey("")
      setShowApiKey(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={`skillbox-api-button${configured ? " is-configured" : ""}`}
        onClick={() => setOpen(true)}
        aria-label="配置翻译 API"
        title={configured ? "翻译 API 已配置" : "配置翻译 API"}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="8" cy="15" r="4" />
          <path d="m11 12 8-8M16 4h3v3M12 15h8M17 12v6" />
        </svg>
        <span>API</span>
        <i aria-hidden />
      </button>

      {open && (
        <div
          className="skillbox-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setOpen(false)
          }}
        >
          <section
            ref={dialogRef}
            tabIndex={-1}
            className="skillbox-api-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="translation-api-title"
          >
            <header className="skillbox-api-dialog__header">
              <div>
                <h2 id="translation-api-title">翻译模型 API</h2>
                <p>默认用 DeepSeek Flash。填好 API Key 后，Skill 详情页即点即译。</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={saving} aria-label="关闭配置窗口">×</button>
            </header>

            {loading ? (
              <div className="skillbox-api-dialog__loading" role="status">正在读取配置…</div>
            ) : (
              <div className="skillbox-api-dialog__body">
                <label className="skillbox-form-field">
                  <span>服务商</span>
                  <select value={form.preset} onChange={(event) => selectPreset(event.target.value as TranslationProviderPreset)}>
                    <option value="deepseek">DeepSeek（推荐）</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic Claude</option>
                    <option value="custom">自定义兼容端点</option>
                  </select>
                </label>

                <label className="skillbox-form-field">
                  <span>API Key</span>
                  <div className="skillbox-api-key-field">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      autoComplete="new-password"
                      spellCheck={false}
                      placeholder={configView?.apiKeyConfigured ? "••••••••••••••••••••" : "输入 API Key"}
                    />
                    <button type="button" onClick={() => void toggleApiKeyVisibility()} disabled={revealingKey}>
                      {revealingKey ? "读取中" : showApiKey ? "隐藏" : "显示"}
                    </button>
                  </div>
                  <small>API Key 由系统安全存储加密，只会发送给你配置的接口。</small>
                </label>

                <button
                  type="button"
                  className="skillbox-advanced-toggle"
                  onClick={() => setShowAdvanced((value) => !value)}
                  aria-expanded={showAdvanced}
                >
                  <span>高级设置</span>
                  <small>{form.apiFormat === "openai-chat" ? "OpenAI 兼容" : "Anthropic Messages"} · {form.model}</small>
                  <b aria-hidden>{showAdvanced ? "−" : "+"}</b>
                </button>

                {showAdvanced && (
                  <div className="skillbox-api-advanced">
                    <label className="skillbox-form-field">
                      <span>名称</span>
                      <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                    </label>
                    <label className="skillbox-form-field">
                      <span>API 格式</span>
                      <select value={form.apiFormat} onChange={(event) => changeApiFormat(event.target.value as TranslationApiFormat)}>
                        <option value="openai-chat">OpenAI Chat Completions</option>
                        <option value="anthropic-messages">Anthropic Messages (/v1/messages)</option>
                      </select>
                    </label>
                    <label className="skillbox-form-field">
                      <span>Base URL</span>
                      <input value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} spellCheck={false} />
                    </label>
                    <label className="skillbox-form-field">
                      <span>模型</span>
                      <input value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} spellCheck={false} />
                    </label>
                  </div>
                )}

                <div className="skillbox-translation-guard">
                  <strong>Token 用量</strong>
                  <p>不限制翻译次数或用量。只统计实际请求，命中本地缓存不会产生新的 Token 消耗。</p>
                  {configView?.usage && (
                    <small>
                      累计翻译 {configView.usage.requests.toLocaleString()} 次 · 输入 {configView.usage.inputTokens.toLocaleString()} · 输出 {configView.usage.outputTokens.toLocaleString()} · 合计 {configView.usage.totalTokens.toLocaleString()} tokens
                    </small>
                  )}
                </div>

                {error && <p className="skillbox-api-dialog__error" role="alert">{error}</p>}
              </div>
            )}

            <footer className="skillbox-api-dialog__footer">
              <div>
                {configured && (
                  <button type="button" className="is-danger" onClick={() => void clear()} disabled={saving}>移除配置</button>
                )}
              </div>
              <div>
                <button type="button" onClick={() => setOpen(false)} disabled={saving}>取消</button>
                <button type="button" className="is-primary" onClick={() => void save()} disabled={loading || saving}>
                  {saving ? "保存中…" : "保存配置"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
