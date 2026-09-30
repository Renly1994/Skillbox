export function getMcpConnectionSummary(server: McpServerEntry, agents: McpAgentInfo[]) {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const installed = server.connections
    .map((connection) => agentById.get(connection.agentId))
    .filter((agent): agent is McpAgentInfo => Boolean(agent?.installed))
  return {
    installed,
    historicalCount: server.connections.length - installed.length,
  }
}

export function getMcpAgentPreview(server: McpServerEntry, agents: McpAgentInfo[], limit: number) {
  const { installed, historicalCount } = getMcpConnectionSummary(server, agents)
  return {
    visible: installed.slice(0, limit),
    hiddenCount: Math.max(0, installed.length - limit),
    installedCount: installed.length,
    historicalCount,
  }
}
