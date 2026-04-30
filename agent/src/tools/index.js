export class ToolRegistry {
  #tools = new Map();

  register(name, definition, handler) {
    this.#tools.set(name, { definition, handler });
  }

  getDefinitions() {
    return [...this.#tools.values()].map(t => t.definition);
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
