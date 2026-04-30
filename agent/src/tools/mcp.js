export function registerMcpTools(registry, mcpClient) {
  const servers = mcpClient.getConnectedServers();

  for (const [serverName, tools] of servers) {
    for (const tool of tools) {
      const name = `mcp_${serverName}_${tool.name}`;
      registry.register(name, {
        type: 'function',
        function: {
          name,
          description: `[MCP:${serverName}] ${tool.description || tool.name}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      }, async (args) => {
        return mcpClient.callTool(serverName, tool.name, args);
      });
    }
  }
}
