import os from "node:os"
import path from "node:path"
import { agentRegistry } from "./agent-registry"

export type McpEntryStyle =
  | "standard"
  | "qwen"
  | "vscode"
  | "copilot"
  | "cline"
  | "roo"
  | "opencode"
  | "openclaw"
  | "workbuddy"

/** Data-driven description of one Agent's MCP configuration contract. */
export interface McpAgentConfigEntry {
  id: string
  displayName: string
  shortCode: string
  configPath: string
  /** Older or product-specific locations, in priority order after configPath. */
  alternateConfigPaths?: string[]
  format: McpConfigFormat
  /** Path from the root JSON object to the server dictionary. */
  containerPath?: string[]
  entryStyle?: McpEntryStyle
  /** JSON5 is only used for reading; writes for these agents go through their CLI. */
  json5?: boolean
  /** Directory whose existence marks the agent as installed. */
  installedDir: string
  alternateInstalledDirs?: string[]
  detectInstalled?: () => Promise<boolean>
  /** Whether Skillbox can change this agent's MCP configuration. */
  writable: boolean
  /** Native CLIs preserve complex config files more safely than direct serialization. */
  writeStrategy?: "json" | "codex-cli" | "openclaw-cli"
}

const home = os.homedir()
const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming")
const configHome = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config")

function shortCodeOf(agentName: string, fallback: string): string {
  return agentRegistry[agentName]?.shortCode ?? fallback
}

function vscodeUserDir(product = "Code"): string {
  if (process.platform === "win32") return path.join(appData, product, "User")
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", product, "User")
  }
  return path.join(configHome, product, "User")
}

function zedConfigDir(): string {
  if (process.platform === "win32") return path.join(appData, "Zed")
  return path.join(configHome, "zed")
}

const vscodeDir = vscodeUserDir()
const clineIdeDir = path.join(vscodeDir, "globalStorage", "saoudrizwan.claude-dev", "settings")
const rooDir = path.join(vscodeDir, "globalStorage", "rooveterinaryinc.roo-cline", "settings")
const copilotHome = process.env.COPILOT_HOME ?? path.join(home, ".copilot")
const kimiCodeHome = process.env.KIMI_CODE_HOME ?? path.join(home, ".kimi-code")
const qoderHome = process.env.QODER_CONFIG_DIR ?? path.join(home, ".qoder")
const openClawConfig = process.env.OPENCLAW_CONFIG_PATH ?? path.join(home, ".openclaw", "openclaw.json")

export const mcpAgentRegistry: McpAgentConfigEntry[] = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    shortCode: shortCodeOf("claude-code", "CC"),
    configPath: path.join(home, ".claude.json"),
    format: "json-mcpServers",
    installedDir: path.join(home, ".claude"),
    writable: true,
  },
  {
    id: "cursor",
    displayName: "Cursor",
    shortCode: shortCodeOf("cursor", "CU"),
    configPath: path.join(home, ".cursor", "mcp.json"),
    format: "json-mcpServers",
    installedDir: path.join(home, ".cursor"),
    writable: true,
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    shortCode: shortCodeOf("windsurf", "WS"),
    configPath: path.join(home, ".codeium", "windsurf", "mcp_config.json"),
    format: "json-mcpServers",
    installedDir: path.join(home, ".codeium", "windsurf"),
    writable: true,
  },
  {
    id: "gemini-cli",
    displayName: "Gemini CLI",
    shortCode: shortCodeOf("gemini-cli", "GM"),
    configPath: path.join(home, ".gemini", "settings.json"),
    format: "json-mcpServers",
    entryStyle: "qwen",
    installedDir: path.join(home, ".gemini"),
    writable: true,
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    shortCode: shortCodeOf("codex-cli", "CX"),
    configPath: path.join(home, ".codex", "config.toml"),
    format: "codex-toml",
    installedDir: path.join(home, ".codex"),
    writable: true,
    writeStrategy: "codex-cli",
  },
  {
    id: "zcode",
    displayName: "ZCode",
    shortCode: shortCodeOf("zcode", "ZC"),
    configPath: path.join(home, ".zcode", "cli", "config.json"),
    format: "json-mcpServers",
    containerPath: ["mcp", "servers"],
    entryStyle: "vscode",
    installedDir: path.join(home, ".zcode"),
    writable: true,
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    shortCode: shortCodeOf("opencode", "OC"),
    configPath: path.join(process.env.OPENCODE_CONFIG_DIR ?? path.join(configHome, "opencode"), "opencode.json"),
    alternateConfigPaths: [path.join(configHome, "opencode", "opencode.jsonc")],
    format: "opencode-json",
    entryStyle: "opencode",
    installedDir: path.join(configHome, "opencode"),
    writable: true,
  },
  {
    id: "kiro",
    displayName: "Kiro",
    shortCode: shortCodeOf("kiro", "KI"),
    configPath: path.join(home, ".kiro", "settings", "mcp.json"),
    format: "json-mcpServers",
    installedDir: path.join(home, ".kiro"),
    writable: true,
  },
  {
    id: "cline",
    displayName: "Cline",
    shortCode: shortCodeOf("cline", "CL"),
    configPath: path.join(home, ".cline", "data", "settings", "cline_mcp_settings.json"),
    alternateConfigPaths: [
      path.join(clineIdeDir, "cline_mcp_settings.json"),
      path.join(home, ".cline", "mcp.json"),
    ],
    format: "json-mcpServers",
    entryStyle: "cline",
    installedDir: path.join(home, ".cline"),
    alternateInstalledDirs: [path.dirname(clineIdeDir)],
    writable: true,
  },
  {
    id: "junie",
    displayName: "Junie",
    shortCode: shortCodeOf("junie", "JU"),
    configPath: path.join(home, ".junie", "mcp", "mcp.json"),
    format: "json-mcpServers",
    installedDir: path.join(home, ".junie"),
    writable: true,
  },
  {
    id: "codebuddy",
    displayName: "CodeBuddy CLI",
    shortCode: shortCodeOf("codebuddy", "CB"),
    configPath: path.join(home, ".codebuddy", ".mcp.json"),
    alternateConfigPaths: [path.join(home, ".codebuddy", "mcp.json"), path.join(home, ".codebuddy.json")],
    format: "json-mcpServers",
    installedDir: path.join(home, ".codebuddy"),
    writable: true,
  },
  {
    id: "workbuddy",
    displayName: "WorkBuddy",
    shortCode: shortCodeOf("workbuddy", "WB"),
    configPath: path.join(home, ".workbuddy", "mcp.json"),
    format: "json-mcpServers",
    entryStyle: "workbuddy",
    installedDir: path.join(home, ".workbuddy"),
    writable: true,
  },
  {
    id: "workbuddy-ai",
    displayName: "WorkBuddy AI",
    shortCode: shortCodeOf("workbuddy-ai", "WA"),
    configPath: path.join(home, ".workbuddy-ai", "mcp.json"),
    format: "json-mcpServers",
    entryStyle: "workbuddy",
    installedDir: path.join(home, ".workbuddy-ai"),
    writable: true,
  },
  {
    id: "iflow-cli",
    displayName: "iFlow CLI",
    shortCode: shortCodeOf("iflow-cli", "IF"),
    configPath: path.join(home, ".iflow", "settings.json"),
    format: "json-mcpServers",
    installedDir: path.join(home, ".iflow"),
    writable: true,
  },
  {
    id: "qwen-code",
    displayName: "Qwen Code",
    shortCode: shortCodeOf("qwen-code", "QW"),
    configPath: path.join(home, ".qwen", "settings.json"),
    format: "json-mcpServers",
    entryStyle: "qwen",
    installedDir: path.join(home, ".qwen"),
    writable: true,
  },
  {
    id: "kimi-code",
    displayName: "Kimi Code",
    shortCode: shortCodeOf("kimi-code", "KM"),
    configPath: path.join(kimiCodeHome, "mcp.json"),
    alternateConfigPaths: [path.join(home, ".kimi", "mcp.json")],
    format: "json-mcpServers",
    installedDir: kimiCodeHome,
    alternateInstalledDirs: [path.join(home, ".kimi")],
    writable: true,
  },
  {
    id: "copilot-cli",
    displayName: "Copilot CLI",
    shortCode: "GC",
    configPath: path.join(copilotHome, "mcp-config.json"),
    format: "json-mcpServers",
    entryStyle: "copilot",
    installedDir: copilotHome,
    detectInstalled: agentRegistry["github-copilot"].detectInstalled,
    writable: true,
  },
  {
    id: "qoder",
    displayName: "Qoder CLI",
    shortCode: shortCodeOf("qoder", "QD"),
    configPath: path.join(qoderHome, "settings.json"),
    format: "json-mcpServers",
    entryStyle: "vscode",
    installedDir: qoderHome,
    writable: true,
  },
  {
    id: "vscode",
    displayName: "VS Code (Copilot)",
    shortCode: shortCodeOf("vscode", "VS"),
    configPath: path.join(vscodeDir, "mcp.json"),
    format: "json-mcpServers",
    containerPath: ["servers"],
    entryStyle: "vscode",
    installedDir: path.dirname(vscodeDir),
    writable: true,
  },
  {
    id: "vscode-insiders",
    displayName: "VS Code Insiders (Copilot)",
    shortCode: shortCodeOf("vscode-insiders", "VI"),
    configPath: path.join(vscodeUserDir("Code - Insiders"), "mcp.json"),
    format: "json-mcpServers",
    containerPath: ["servers"],
    entryStyle: "vscode",
    installedDir: path.dirname(vscodeUserDir("Code - Insiders")),
    writable: true,
  },
  {
    id: "zed",
    displayName: "Zed",
    shortCode: shortCodeOf("zed", "ZE"),
    configPath: path.join(zedConfigDir(), "settings.json"),
    format: "json-mcpServers",
    containerPath: ["context_servers"],
    installedDir: zedConfigDir(),
    writable: true,
  },
  {
    id: "amp",
    displayName: "Amp",
    shortCode: shortCodeOf("amp", "AM"),
    configPath: path.join(configHome, "amp", "settings.json"),
    alternateConfigPaths: [path.join(configHome, "amp", "settings.jsonc")],
    format: "json-mcpServers",
    containerPath: ["amp.mcpServers"],
    installedDir: path.join(configHome, "amp"),
    writable: true,
  },
  {
    id: "openclaw",
    displayName: "OpenClaw",
    shortCode: shortCodeOf("openclaw", "OA"),
    configPath: openClawConfig,
    format: "json-mcpServers",
    containerPath: ["mcp", "servers"],
    entryStyle: "openclaw",
    json5: true,
    installedDir: path.dirname(openClawConfig),
    writable: true,
    writeStrategy: "openclaw-cli",
  },
  {
    id: "roo-code",
    displayName: "Roo Code",
    shortCode: shortCodeOf("roo-code", "RO"),
    configPath: path.join(rooDir, "mcp_settings.json"),
    format: "json-mcpServers",
    entryStyle: "roo",
    installedDir: path.dirname(rooDir),
    writable: true,
  },
  {
    id: "kilo-code",
    displayName: "Kilo Code",
    shortCode: shortCodeOf("kilo-code", "KL"),
    configPath: path.join(configHome, "kilo", "kilo.jsonc"),
    alternateConfigPaths: [path.join(configHome, "kilo", "kilo.json")],
    format: "opencode-json",
    entryStyle: "opencode",
    installedDir: path.join(configHome, "kilo"),
    writable: true,
  },
  {
    id: "mimo-code",
    displayName: "MiMo Code",
    shortCode: shortCodeOf("mimo-code", "MM"),
    configPath: path.join(configHome, "mimocode", "mimocode.jsonc"),
    alternateConfigPaths: [path.join(configHome, "mimocode", "mimocode.json")],
    format: "opencode-json",
    entryStyle: "opencode",
    installedDir: path.join(configHome, "mimocode"),
    writable: true,
  },
]
