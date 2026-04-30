import { chat, chatStream } from './llm.js';
import config from './config.js';
import { transcribeAudio } from './audio.js';
import { listSkillsForAgent } from './tools/skills.js';

const MAX_ITERATIONS = 10;

const DEFAULT_SYSTEM_PROMPT = `You are DogeClaw, a personal AI agent running inside a Docker container.
Be concise and practical.`;

export class Agent {
  #registry;

  constructor(registry) {
    this.#registry = registry;
  }

  async #buildSystemPrompt(customPrompt, agentId) {
    const base = customPrompt || DEFAULT_SYSTEM_PROMPT;

    const toolDescriptions = this.#registry.getDefinitions().map(t => {
      const fn = t.function;
      const params = fn.parameters?.properties
        ? Object.keys(fn.parameters.properties).join(', ')
        : '';
      return `- ${fn.name}(${params}): ${fn.description}`;
    }).join('\n');

    // Skills available to this agent
    let skillsBlock = '';
    if (agentId) {
      try {
        const skills = await listSkillsForAgent(agentId);
        if (skills.length) {
          skillsBlock = '\n\nAvailable skills (use read_skill with the ID to view full content):\n' +
            skills.map(s => `- [${s.id}] ${s.name}: ${s.description || '(no description)'}`).join('\n');
        }
      } catch {}
    }

    return `${base}

Current date: ${new Date().toISOString().split('T')[0]}
Workspace: ${config.paths.files}

You have the following tools available. Use them whenever needed — do not say you lack capabilities:
${toolDescriptions}${skillsBlock}

IMPORTANT rules for tool use:
- Always prefer ACTION over asking the user. If you can do it with your tools, do it.
- Chain tools together autonomously. For example: use web_search to find URLs, then use web_fetch on those URLs to read their content, then summarize. Do NOT ask the user to pick URLs or confirm steps.
- Never say "I cannot" when you have a tool that can do it. Just use the tool.
- When asked to research something, search the web, visit multiple result pages, and synthesize the information yourself.
- If a skill in the list above looks relevant to the task, call read_skill with its ID first to learn the proper approach.
- You can call tools multiple times in sequence. Do not stop after one tool call if more are needed to complete the task.`;
  }

  /**
   * Run the agent loop.
   * Returns { content, toolCalls } where toolCalls is an array of { name, args, result }
   */
  async run(userMessage, history = [], opts = {}) {
    const agentId = opts.agentId || null;
    const systemPrompt = await this.#buildSystemPrompt(opts.systemPrompt, agentId);
    const mc = opts.modelConfig || {};
    if (!mc.model_id) {
      throw new Error('No model configured. Add a model in the admin UI and assign it to this agent.');
    }
    const baseUrl = mc.base_url || config.ollama.url;
    const model = mc.model_id;
    const think = mc.think ?? false;
    const accepts = mc.accepts || ['text'];
    const provider = mc.provider || 'ollama';
    const onEvent = opts.onEvent || null;

    let processedMessage = userMessage;
    if (opts.audio) {
      if (accepts.includes('audio')) {
        processedMessage = processedMessage || 'What is said in this audio?';
      } else {
        if (onEvent) onEvent('status', 'Transcribing audio...');
        const transcript = await transcribeAudio(opts.audio, opts.audioMime);
        if (onEvent) onEvent('transcript', transcript);
        processedMessage = processedMessage
          ? `${processedMessage}\n\n[Voice message]: ${transcript}`
          : transcript;
      }
    }

    if (!processedMessage && opts.images?.length) {
      processedMessage = 'What do you see in this image?';
    }

    const systemContent = opts.systemNote
      ? `${systemPrompt}\n\nNote: ${opts.systemNote}`
      : systemPrompt;

    const userMsg = { role: 'user', content: processedMessage };
    if (opts.images?.length && accepts.includes('image')) {
      userMsg.images = opts.images;
    }

    const messages = [
      { role: 'system', content: systemContent },
      ...history,
      userMsg,
    ];

    const tools = this.#registry.getDefinitions();
    const apiKey = mc.apiKey || null;
    const llmOpts = { baseUrl, model, think, provider, apiKey };
    const collectedToolCalls = [];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      let response;

      if (onEvent) {
        response = await chatStream(messages, tools, llmOpts, onEvent);
      } else {
        response = await chat(messages, tools, llmOpts);
      }

      if (!response.tool_calls || response.tool_calls.length === 0) {
        return { content: response.content || '(no response)', toolCalls: collectedToolCalls };
      }

      messages.push(response);
      if (onEvent) onEvent('tool_calls', response.tool_calls);

      for (const call of response.tool_calls) {
        const result = await this.#registry.execute(
          call.function.name,
          call.function.arguments,
          { agentId },
        );
        collectedToolCalls.push({
          name: call.function.name,
          args: call.function.arguments,
          result,
        });
        if (onEvent) onEvent('tool_result', { name: call.function.name, result });
        // Truncate tool results to avoid exceeding model context
        const resultStr = JSON.stringify(result);
        messages.push({ role: 'tool', content: resultStr.slice(0, 12000), _toolName: call.function.name });
      }
    }

    return { content: '(reached maximum tool call iterations)', toolCalls: collectedToolCalls };
  }
}
