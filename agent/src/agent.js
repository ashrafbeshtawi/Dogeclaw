import { chat, chatStream } from './llm.js';
import config from './config.js';
import { listSkillsForAgent } from './tools/skills.js';
import { composeUserText } from './lib/composeUserText.js';
import { timestampNote } from './lib/timestamp.js';
import { getTimezone } from './db/settings.js';

const MAX_ITERATIONS = 30;

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

Workspace: ${config.paths.files}

You have the following tools available. Use them whenever needed — do not say you lack capabilities:
${toolDescriptions}${skillsBlock}

IMPORTANT rules for tool use:
- Act, don't ask. Never say "I cannot" — if a tool can do it, use it.
- Chain tool calls autonomously until the task is done (e.g. web_search → web_fetch on several results → synthesize). Don't stop after one call and don't ask the user to pick between steps.
- If a skill in the list above looks relevant, call read_skill with its ID first.
- Memory: you have a database (query_database). Log new useful facts about the user there, and consult it before doing or answering anything personal.
- Reuse existing tables — check information_schema.tables before CREATE TABLE.
- Keep answers short and to the point. Don't explain the technical details of how you did it (tools called, tables queried, SQL) unless the user asks.
- Instead, end your reply with a last line containing only icons: 🗄️ if you used the database, 🔧 if you called other tools. Omit the line if neither.`;
  }

  /**
   * Run the agent loop.
   * Returns { content, toolCalls } where toolCalls is an array of { name, args, result }
   *
   * When opts.triggerNote is set (cron-fired runs), no synthetic user message is
   * appended; instead the trigger is added as a system-role turn after history.
   * The caller is responsible for persisting only the assistant reply.
   */
  async run(userMessage, history = [], opts = {}) {
    const agentId = opts.agentId || null;
    const channelId = opts.channelId ?? null;
    const chatId = opts.chatId ?? null;
    const sessionId = opts.sessionId ?? null;
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

    // Stamp every outgoing message (manual, telegram, cron) with the current
    // date & time so the model knows "now". Appended here — the single
    // chokepoint all send paths route through — and never persisted: callers
    // store the raw user text before calling run().
    const stamp = timestampNote(await getTimezone());

    const composed = opts.triggerNote
      ? null
      : composeUserText(userMessage, opts, accepts);
    const processedMessage = composed
      ? `${composed}\n\n${stamp}`
      : stamp;

    const systemContent = opts.systemNote
      ? `${systemPrompt}\n\nNote: ${opts.systemNote}`
      : systemPrompt;

    const messages = [{ role: 'system', content: systemContent }, ...history];

    if (opts.triggerNote) {
      messages.push({ role: 'system', content: `${opts.triggerNote}\n\n${stamp}` });
    } else {
      const userMsg = { role: 'user', content: processedMessage };
      // Attach media the model claims to accept. The LLM layer is responsible
      // for translating these into the provider's wire format (Ollama uses
      // `images`; Gemini uses inline_data via toGeminiContents).
      if (opts.images?.length && accepts.includes('image')) userMsg.images = opts.images;
      if (opts.audio && accepts.includes('audio')) {
        userMsg.audio = opts.audio;
        userMsg.audioMime = opts.audioMime || 'audio/ogg';
      }
      if (opts.video && accepts.includes('video')) {
        userMsg.video = opts.video;
        userMsg.videoMime = opts.videoMime || 'video/mp4';
      }
      messages.push(userMsg);
    }

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
        // Gemini's thinking mode can return a turn that contains only a
        // `thoughtSignature` part — no text, no functionCall. The model is
        // not done; it expects us to feed the signature back and ask for the
        // next step. Treating it as "done" surfaces a bare "(no response)"
        // and discards the model's reasoning state. Detect this and loop.
        const hasThoughtOnly = !response.content
          && response._geminiParts?.some(p => p.thoughtSignature)
          && !response._geminiParts.some(p => p.text || p.functionCall);
        if (hasThoughtOnly) {
          messages.push(response);
          continue;
        }
        return { content: response.content || '(no response)', toolCalls: collectedToolCalls };
      }

      messages.push(response);
      if (onEvent) onEvent('tool_calls', response.tool_calls);

      for (const call of response.tool_calls) {
        const result = await this.#registry.execute(
          call.function.name,
          call.function.arguments,
          { agentId, channelId, chatId, sessionId },
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
