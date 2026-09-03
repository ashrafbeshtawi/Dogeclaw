export class ToolRegistry {
  #tools = new Map();

  register(name, definition, handler, meta = null) {
    this.#tools.set(name, { definition, handler, meta });
  }

  unregister(name) {
    this.#tools.delete(name);
  }

  getDefinitions() {
    return [...this.#tools.values()].map(t => t.definition);
  }

  // Full entries incl. meta ({ mcpServer, serverDescription } on MCP tools) —
  // used for per-agent visibility filtering and prompt grouping.
  getEntries() {
    return [...this.#tools.entries()].map(([name, t]) => ({
      name, definition: t.definition, meta: t.meta,
    }));
  }

  async execute(name, args, context = {}) {
    const tool = this.#tools.get(name);
    if (!tool) return { error: `Unknown tool: ${name}` };
    try {
      return await tool.handler(typeof args === 'string' ? JSON.parse(args) : args, context);
    } catch (err) {
      return { error: err.message };
    }
  }

  has(name) {
    return this.#tools.has(name);
  }

  list() {
    return [...this.#tools.keys()];
  }
}
