const DESCRIPTION_START = "<!-- SKILLBOX_TRANSLATABLE_DESCRIPTION_START -->"
const DESCRIPTION_END = "<!-- SKILLBOX_TRANSLATABLE_DESCRIPTION_END -->"

export function prepareSkillTranslationDocument(
  content: string,
  description: string | null | undefined,
): { content: string; includesDescription: boolean } {
  const normalizedDescription = description?.trim()
  if (!normalizedDescription) {
    return { content, includesDescription: false }
  }

  return {
    content: `${content.trimEnd()}\n\n${DESCRIPTION_START}\n${normalizedDescription}\n${DESCRIPTION_END}`,
    includesDescription: true,
  }
}

export function parseSkillTranslationDocument(
  translated: string,
  includesDescription: boolean,
): { content: string; description: string | null } {
  if (!includesDescription) {
    return { content: translated, description: null }
  }

  const start = translated.lastIndexOf(DESCRIPTION_START)
  const end = translated.indexOf(DESCRIPTION_END, start + DESCRIPTION_START.length)
  if (start < 0 || end < 0) {
    throw new Error("模型未完整返回描述译文，请重试")
  }

  const description = translated
    .slice(start + DESCRIPTION_START.length, end)
    .trim()
  const content = translated.slice(0, start).trimEnd()
  if (!description || !content) {
    throw new Error("模型返回的译文不完整，请重试")
  }

  return { content, description }
}

function unwrapYamlScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

export function extractSkillDescription(content: string | null): string | null {
  if (!content) return null
  const normalized = content.replace(/^\uFEFF/, "")
  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!match) return null

  const lines = match[1].split(/\r?\n/)
  const index = lines.findIndex((line) => /^description\s*:/i.test(line))
  if (index < 0) return null

  const firstLine = lines[index].replace(/^description\s*:\s*/i, "")
  if (!/^[>|][+-]?$/.test(firstLine.trim())) {
    return unwrapYamlScalar(firstLine) || null
  }

  const indentedLines: string[] = []
  for (const line of lines.slice(index + 1)) {
    if (!/^\s+/.test(line)) break
    indentedLines.push(line)
  }
  const separator = firstLine.trim().startsWith(">") ? " " : "\n"
  return indentedLines.map((line) => line.trim()).join(separator).trim() || null
}
