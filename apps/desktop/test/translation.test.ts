import assert from "node:assert/strict"
import test from "node:test"
import {
  buildTranslationCacheKey,
  buildTranslationSourceHash,
  buildTranslationRequest,
  getTranslationPreset,
  normalizeTranslationUsage,
  parseTranslationResponse,
  recordTranslationUsage,
  validateTranslationConfig,
  validateTranslationContent,
} from "../src/main/translation"
import {
  extractSkillDescription,
  parseSkillTranslationDocument,
  prepareSkillTranslationDocument,
} from "../src/renderer/lib/skill-translation-document"

test("DeepSeek 预设使用当前 Flash 模型和 OpenAI 格式", () => {
  assert.deepEqual(getTranslationPreset("deepseek"), {
    preset: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiFormat: "openai-chat",
    model: "deepseek-flash",
  })
})

test("OpenAI 和 Claude 预设自动补齐官方端点与轻量模型", () => {
  assert.equal(getTranslationPreset("openai").baseUrl, "https://api.openai.com/v1")
  assert.equal(getTranslationPreset("openai").model, "gpt-5.4-mini")
  assert.equal(getTranslationPreset("anthropic").baseUrl, "https://api.anthropic.com")
  assert.equal(getTranslationPreset("anthropic").model, "claude-haiku-4-5-20251001")
})

test("DeepSeek OpenAI 请求关闭思考模式，避免翻译浪费 token", () => {
  const request = buildTranslationRequest(
    getTranslationPreset("deepseek"),
    "sk-test",
    "# Hello",
  )

  assert.equal(request.url, "https://api.deepseek.com/chat/completions")
  assert.equal(request.headers.Authorization, "Bearer sk-test")
  assert.deepEqual(request.body.thinking, { type: "disabled" })
  assert.equal(request.body.reasoning_effort, "none")
})

test("DeepSeek Anthropic 请求使用 /v1/messages 并关闭思考", () => {
  const config = {
    ...getTranslationPreset("deepseek"),
    baseUrl: "https://api.deepseek.com/anthropic",
    apiFormat: "anthropic-messages" as const,
  }
  const request = buildTranslationRequest(config, "sk-test", "# Hello")

  assert.equal(request.url, "https://api.deepseek.com/anthropic/v1/messages")
  assert.equal(request.headers["x-api-key"], "sk-test")
  assert.equal(request.headers["anthropic-version"], "2023-06-01")
  assert.deepEqual(request.body.reasoning, { effort: "none" })
})

test("自定义端点只允许 HTTPS 或本机 HTTP", () => {
  assert.throws(
    () => validateTranslationConfig({
      ...getTranslationPreset("deepseek"),
      baseUrl: "http://api.example.com/v1",
    }),
    /HTTPS/,
  )
  assert.doesNotThrow(() => validateTranslationConfig({
    ...getTranslationPreset("deepseek"),
    preset: "custom",
    baseUrl: "http://127.0.0.1:11434/v1",
  }))
})

test("长 Skill 不受应用内字符额度限制", () => {
  const content = "a".repeat(120_000)
  assert.equal(validateTranslationContent(content), content)
})

test("翻译用量只累计实际 Token，不设置次数或 Token 上限", () => {
  const initial = normalizeTranslationUsage(null)
  const afterManyRequests = recordTranslationUsage(
    { ...initial, requests: 10_000, totalTokens: 9_000_000 },
    { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
  )
  assert.deepEqual(afterManyRequests, {
    requests: 10_001,
    inputTokens: 120,
    outputTokens: 80,
    totalTokens: 9_000_200,
  })
})

test("缓存键跟随原文、模型和接口变化", () => {
  const config = getTranslationPreset("deepseek")
  const first = buildTranslationCacheKey(config, "# Hello")
  assert.equal(first, buildTranslationCacheKey(config, "# Hello"))
  assert.notEqual(first, buildTranslationCacheKey(config, "# Hello!"))
  assert.notEqual(first, buildTranslationCacheKey({ ...config, model: "another-model" }, "# Hello"))
})

test("原文指纹不受模型配置变化影响，可用于升级后恢复译文", () => {
  assert.equal(
    buildTranslationSourceHash("# Hello"),
    buildTranslationSourceHash("# Hello"),
  )
  assert.notEqual(
    buildTranslationSourceHash("# Hello"),
    buildTranslationSourceHash("# Hello!"),
  )
})

test("兼容 OpenAI 字符串与 Anthropic 文本块响应", () => {
  assert.equal(
    parseTranslationResponse("openai-chat", {
      choices: [{ message: { content: "# 你好" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }).content,
    "# 你好",
  )
  assert.equal(
    parseTranslationResponse("anthropic-messages", {
      content: [{ type: "text", text: "# 你好" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }).content,
    "# 你好",
  )
})

test("输出达到上限时不把不完整译文写入缓存", () => {
  assert.throws(
    () => parseTranslationResponse("openai-chat", {
      choices: [{ finish_reason: "length", message: { content: "# 未完成" } }],
    }),
    /不完整/,
  )
  assert.throws(
    () => parseTranslationResponse("anthropic-messages", {
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "# 未完成" }],
    }),
    /不完整/,
  )
})

test("描述与正文合并为一次翻译，并能从译文中拆开", () => {
  const prepared = prepareSkillTranslationDocument("# Hello", "Translate skills quickly")
  assert.equal(prepared.includesDescription, true)
  assert.match(prepared.content, /SKILLBOX_TRANSLATABLE_DESCRIPTION_START/)

  const translated = parseSkillTranslationDocument(
    prepared.content
      .replace("# Hello", "# 你好")
      .replace("Translate skills quickly", "快速翻译技能"),
    prepared.includesDescription,
  )
  assert.deepEqual(translated, {
    content: "# 你好",
    description: "快速翻译技能",
  })
})

test("模型遗漏描述标记时拒绝不完整结果", () => {
  assert.throws(
    () => parseSkillTranslationDocument("# 只有正文", true),
    /描述译文/,
  )
})

test("可从市场 Skill 的 frontmatter 读取描述", () => {
  assert.equal(
    extractSkillDescription("---\nname: demo\ndescription: 'Translate agent skills'\n---\n# Demo"),
    "Translate agent skills",
  )
  assert.equal(
    extractSkillDescription("---\nname: demo\ndescription: >-\n  Translate agent skills\n  with one click\n---\n# Demo"),
    "Translate agent skills with one click",
  )
})
