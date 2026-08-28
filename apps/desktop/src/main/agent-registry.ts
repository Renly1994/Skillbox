import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export interface AgentEntry {
  name: string
  displayName: string
  shortCode: string
  globalSkillsDir: string
  detectInstalled: () => Promise<boolean>
}

const home = os.homedir()
const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
const factoryHome = process.env.FACTORY_HOME || path.join(home, ".factory")
const ob1Home = process.env.OB1_HOME || path.join(home, ".ob1")
const kimiCodeHome = process.env.KIMI_CODE_HOME || path.join(home, ".kimi-code")
const dshHome = process.env.DSH_HOME || path.join(home, ".dsh")

export async function dirExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

export const agentRegistry: Record<string, AgentEntry> = {
  "claude-code": {
    name: "claude-code",
    displayName: "Claude Code",
    shortCode: "CC",
    globalSkillsDir: path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"),
      "skills",
    ),
    detectInstalled: () =>
      dirExists(process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude")),
  },
  cursor: {
    name: "cursor",
    displayName: "Cursor",
    shortCode: "CU",
    globalSkillsDir: path.join(home, ".cursor", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".cursor")),
  },
  "github-copilot": {
    name: "github-copilot",
    displayName: "GitHub Copilot",
    shortCode: "GC",
    globalSkillsDir: path.join(configHome, "github-copilot", "skills"),
    detectInstalled: () => dirExists(path.join(configHome, "github-copilot")),
  },
  windsurf: {
    name: "windsurf",
    displayName: "Windsurf",
    shortCode: "WS",
    globalSkillsDir: path.join(home, ".windsurf", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".windsurf")),
  },
  cline: {
    name: "cline",
    displayName: "Cline",
    shortCode: "CL",
    globalSkillsDir: path.join(home, ".cline", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".cline")),
  },
  continue: {
    name: "continue",
    displayName: "Continue",
    shortCode: "CN",
    globalSkillsDir: path.join(home, ".continue", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".continue")),
  },
  "codex-cli": {
    name: "codex-cli",
    displayName: "Codex CLI",
    shortCode: "CX",
    globalSkillsDir: path.join(
      process.env.CODEX_HOME || path.join(home, ".codex"),
      "skills",
    ),
    detectInstalled: () =>
      dirExists(process.env.CODEX_HOME || path.join(home, ".codex")),
  },
  workbuddy: {
    name: "workbuddy",
    displayName: "WorkBuddy",
    shortCode: "WB",
    globalSkillsDir: path.join(home, ".workbuddy", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".workbuddy")),
  },
  "kimi-code": {
    name: "kimi-code",
    displayName: "Kimi Code",
    shortCode: "KM",
    globalSkillsDir: path.join(kimiCodeHome, "skills"),
    detectInstalled: () => dirExists(kimiCodeHome),
  },
  "deepseek-harness": {
    name: "deepseek-harness",
    displayName: "DeepSeek Harness",
    shortCode: "DS",
    globalSkillsDir: path.join(dshHome, "skills"),
    detectInstalled: () => dirExists(dshHome),
  },
  qoderwork: {
    name: "qoderwork",
    displayName: "QoderWork",
    shortCode: "QW",
    globalSkillsDir: path.join(home, ".qoderwork", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".qoderwork")),
  },
  qoder: {
    name: "qoder",
    displayName: "Qoder CLI",
    shortCode: "QD",
    globalSkillsDir: path.join(home, ".qoder", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".qoder")),
  },
  trae: {
    name: "trae",
    displayName: "TRAE",
    shortCode: "TR",
    globalSkillsDir: path.join(home, ".trae", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".trae")),
  },
  "droid-cli": {
    name: "droid-cli",
    displayName: "Droid CLI",
    shortCode: "DR",
    globalSkillsDir: path.join(factoryHome, "skills"),
    detectInstalled: () => dirExists(factoryHome),
  },
  "ob-1": {
    name: "ob-1",
    displayName: "OB-1",
    shortCode: "OB1",
    globalSkillsDir: path.join(ob1Home, "skills"),
    detectInstalled: () => dirExists(ob1Home),
  },
  amp: {
    name: "amp",
    displayName: "Amp",
    shortCode: "AM",
    globalSkillsDir: path.join(home, ".amp", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".amp")),
  },
  goose: {
    name: "goose",
    displayName: "Goose",
    shortCode: "GO",
    globalSkillsDir: path.join(home, ".goose", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".goose")),
  },
  junie: {
    name: "junie",
    displayName: "Junie",
    shortCode: "JU",
    globalSkillsDir: path.join(home, ".junie", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".junie")),
  },
  "kilo-code": {
    name: "kilo-code",
    displayName: "Kilo Code",
    shortCode: "KC",
    globalSkillsDir: path.join(home, ".kilo-code", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".kilo-code")),
  },
  opencode: {
    name: "opencode",
    displayName: "OpenCode",
    shortCode: "OC",
    globalSkillsDir: path.join(home, ".opencode", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".opencode")),
  },
  openclaw: {
    name: "openclaw",
    displayName: "OpenClaw",
    shortCode: "OW",
    globalSkillsDir: path.join(home, ".openclaw", "skills"),
    detectInstalled: async () =>
      (await dirExists(path.join(home, ".openclaw"))) ||
      (await dirExists(path.join(home, ".clawdbot"))) ||
      (await dirExists(path.join(home, ".moltbot"))),
  },
  "pear-ai": {
    name: "pear-ai",
    displayName: "Pear AI",
    shortCode: "PA",
    globalSkillsDir: path.join(home, ".pear-ai", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".pear-ai")),
  },
  "roo-code": {
    name: "roo-code",
    displayName: "Roo Code",
    shortCode: "RC",
    globalSkillsDir: path.join(home, ".roo-code", "skills"),
    detectInstalled: () => dirExists(path.join(home, ".roo-code")),
  },
  zed: {
    name: "zed",
    displayName: "Zed",
    shortCode: "ZD",
    globalSkillsDir: path.join(configHome, "zed", "skills"),
    detectInstalled: () => dirExists(path.join(configHome, "zed")),
  },
  universal: {
    name: "universal",
    displayName: "通用 Skill 目录",
    shortCode: "UA",
    globalSkillsDir: path.join(home, ".agents", "skills"),
    detectInstalled: async () => true,
  },
}

export const PROJECT_PROBES = [
  { subpath: ".claude/skills" },
  { subpath: ".cursor/skills" },
  { subpath: ".cursor/rules" },
  { subpath: ".codex/skills" },
  { subpath: ".github/skills" },
  { subpath: ".windsurf/skills" },
  { subpath: ".continue/skills" },
  { subpath: ".cline/skills" },
  { subpath: ".amp/skills" },
  { subpath: ".opencode/skills" },
  { subpath: ".goose/skills" },
  { subpath: ".junie/skills" },
  { subpath: ".kilo-code/skills" },
  { subpath: ".pear-ai/skills" },
  { subpath: ".roo-code/skills" },
  { subpath: ".workbuddy/skills" },
  { subpath: ".kimi-code/skills" },
  { subpath: ".dsh/skills" },
  { subpath: ".qoderwork/skills" },
  { subpath: ".qoder/skills" },
  { subpath: ".trae/skills" },
  { subpath: ".zed/skills" },
  { subpath: ".agents/skills" },
]
