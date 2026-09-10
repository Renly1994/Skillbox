// Keyword-based category for the list's category capsule. SKILL.md has no
// standard category field, so we classify from name + description. Rules are
// ordered: the first match wins, so specific domains come before broad ones.
// Each category carries an earthy accent color (readable on the warm paper
// theme in both light and dark mode) and a chunky solid icon (24 viewBox).
const SKILL_CATEGORY_RULES: Array<{ label: string; color: string; icon: string; pattern: RegExp }> = [
  { label: "视频", color: "#C2453C", icon: "M8 5v14l11-7z", pattern: /video|字幕|视频|剪辑|ffmpeg|remotion|youtube/i },
  { label: "音频", color: "#D06E23", icon: "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z", pattern: /\btts\b|audio|voice|speech|music|transcri|音频|语音/i },
  { label: "图像", color: "#9E8A1F", icon: "M21 19V5c0-1.1-.9-2-2-2H5C3.9 3 3 3.9 3 5v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z", pattern: /image|img|photo|图片|图像|icon|screenshot/i },
  { label: "设计", color: "#8A5FA8", icon: "M12 2l7 7-7 13L5 9l7-7z", pattern: /design|frontend|\bui\b|css|theme|视觉|设计/i },
  { label: "安全", color: "#3E7356", icon: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z", pattern: /secur|guard|vuln|audit|安全|审计/i },
  { label: "文档", color: "#4F6FA8", icon: "M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6z", pattern: /\bpdf\b|xlsx|excel|spreadsheet|\bdoc|slide|ppt|markdown|表格|文档/i },
  { label: "社媒", color: "#2E8B8B", icon: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z", pattern: /social|twitter|reddit|小红书|抖音|社媒|营销/i },
  { label: "写作", color: "#B04A6E", icon: "M4 20l1.2-4.2L16.5 4.5a2.1 2.1 0 0 1 3 3L8.2 18.8 4 20z", pattern: /writ|humaniz|文案|写作|copy(edit|writ)/i },
  { label: "开发", color: "#5B5EA6", icon: "M3 4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H3zm4.3 4.7L6 12l1.3 3.3 1.4-.6L7.8 12l.9-2.7-1.4-.6zM11 15h6v1.5h-6V15z", pattern: /code|github|\bgit\b|\bapi\b|debug|test|refactor|explain|开发/i },
  { label: "数据", color: "#6E7F3C", icon: "M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z", pattern: /data|\bcsv\b|\bsql\b|analy|数据/i },
]

const DEFAULT_CATEGORY = {
  label: "通用",
  color: "#8A8378",
  icon: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
}

export function categorizeSkill(
  name: string,
  description: string,
): { label: string; color: string; icon: string } {
  const haystack = `${name}\n${description}`
  for (const rule of SKILL_CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) {
      return { label: rule.label, color: rule.color, icon: rule.icon }
    }
  }
  return DEFAULT_CATEGORY
}

