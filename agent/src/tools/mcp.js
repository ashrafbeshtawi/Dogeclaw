export function registerMcpTools(registry, mcpClient) {
  const servers = mcpClient.getConnectedServers();

  for (const [serverName, tools] of servers) {
    for (const tool of tools) {
      const name = `mcp_${serverName}_${tool.name}`;
      registry.register(name, {
        type: 'function',
        function: {
          name,
          description: tool.description || tool.name,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      }, async (args) => {
        return mcpClient.callTool(serverName, tool.name, args);
      }, {
        // Visibility + prompt grouping: only agents assigned to this server
        // see the tool; the prompt groups tools under the server header, so
        // the per-tool [MCP:server] tag is gone.
        mcpServer: serverName,
        serverDescription: mcpClient.getServerDescription(serverName),
      });
    }
  }
}
