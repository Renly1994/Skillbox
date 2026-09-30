import assert from "node:assert/strict"
import test from "node:test"
import { getMcpAgentPreview, getMcpConnectionSummary } from "../src/renderer/lib/mcp-display"

test("MCP 接入数只计算已安装 Agent，历史配置单独标记", () => {
  const agents = Array.from({ length: 7 }, (_, index) => ({
    id: `agent-${index}`,
    displayName: `Agent ${index}`,
    installed: index < 6,
  })) as McpAgentInfo[]
  const server = {
    name: "demo",
    connections: agents.map((agent) => ({ agentId: agent.id })),
  } as McpServerEntry

  const summary = getMcpConnectionSummary(server, agents)
  assert.equal(summary.installed.length, 6)
  assert.equal(summary.historicalCount, 1)
  assert.deepEqual(summary.installed.map((agent) => agent.id), agents.slice(0, 6).map((agent) => agent.id))
})

test("MCP 列表在多 Agent 时只展示可容纳的图标，剩余数量不挤占接入数", () => {
  const agents = Array.from({ length: 19 }, (_, index) => ({
    id: `agent-${index}`,
    displayName: `Agent ${index}`,
    installed: true,
  })) as McpAgentInfo[]
  const server = {
    name: "many-agents",
    connections: agents.map((agent) => ({ agentId: agent.id })),
  } as McpServerEntry

  const preview = getMcpAgentPreview(server, agents, 2)
  assert.deepEqual(preview.visible.map((agent) => agent.id), ["agent-0", "agent-1"])
  assert.equal(preview.hiddenCount, 17)
  assert.equal(preview.installedCount, 19)
})
