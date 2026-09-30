import assert from "node:assert/strict"
import test from "node:test"
import { agentRegistry } from "../src/main/agent-registry"

test("VS Code 的 Skill Agent 与 MCP Agent 使用独立但对应的身份", () => {
  const agent = agentRegistry.vscode
  assert.ok(agent)
  assert.equal(agent.displayName, "VS Code (Copilot)")
  assert.ok(agent.globalSkillsDir.endsWith(".copilot\\skills") || agent.globalSkillsDir.endsWith(".copilot/skills"))
})
