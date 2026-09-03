import { chat, chatStream } from './llm.js';
import config from './config.js';
import { listSkillsForAgent } from './tools/skills.js';
import { composeUserText } from './lib/composeUserText.js';
import { timestampNote } from './lib/timestamp.js';
import { toolIcons, appendToolIcons, toolTrace } from './lib/toolIcons.js';
import { claimsAction, CLAIM_NUDGE } from './lib/claimGuard.js';
import { composeSystemPrompt, formatToolLine } from './lib/systemPrompt.js';
import { visibleEntries, mcpGroups } from './lib/mcpVisibility.js';
import { getAgentMcpServerNames } from './db/mcpServers.js';
import { getTimezone } from './db/settings.js';

const MAX_ITERATIONS = 30;

export class Agent {
  #registry;

  constructor(registry) {
    this.#registry = registry;
  }

  // The agent's tool view: built-in tools plus the MCP tools of servers this
  // agent is assigned to. An MCP server with no assignment is visible to no
  // agent — assignment (agent_mcp_servers) is the access boundary.
  async #visibleEntries(agentId) {
    const entries = this.#registry.getEntries();
    if (!entries.some(e => e.meta?.mcpServer)) return entries;
    const allowed = agentId ? await getAgentMcpServerNames(agentId) : [];
    return visibleEntries(entries, allowed);
  }

  async #buildSystemPrompt(customPrompt, agentId, entries) {
    const toolDescriptions = entries
      .filter(e => !e.meta?.mcpServer)
      .map(e => formatToolLine(e.definition))
      .join('\n');

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

    return composeSystemPrompt({
      customPrompt,
      workspace: config.paths.files,
      toolDescriptions,
      skillsBlock,
      mcpGroups: mcpGroups(entries),
    });
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
    const entries = await this.#visibleEntries(agentId);
    const systemPrompt = await this.#buildSystemPrompt(opts.systemPrompt, agentId, entries);
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

    // Replay history faithfully: past assistant turns that called tools get
    // a compact trace appended. Without it the model sees only its own
    // claims ("saved it!") with the tool call edited out of the transcript —
    // and learns to claim without calling. Derived from persisted data, so
    // history still re-serializes identically every turn (cache-stable).
    const replayed = history.map(m => {
      const trace = m.role === 'assistant' ? toolTrace(m.toolCalls || []) : '';
      return trace ? { ...m, content: `${m.content}\n${trace}` } : m;
    });
    const messages = [{ role: 'system', content: systemContent }, ...replayed];

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

    const tools = entries.map(e => e.definition);
    const visibleNames = new Set(entries.map(e => e.name));
    const apiKey = mc.apiKey || null;
    const llmOpts = { baseUrl, model, think, provider, apiKey };
    const collectedToolCalls = [];
    let claimRetried = false;

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
        // Claim guard: a final reply that claims a completed action with
        // ZERO tool calls this turn gets one corrective retry — the model
        // either performs the action for real or rephrases. Bounded to one
        // retry so a stubborn model can't loop.
        if (!claimRetried && collectedToolCalls.length === 0 && claimsAction(response.content)) {
          claimRetried = true;
          messages.push(response);
          messages.push({ role: 'system', content: CLAIM_NUDGE });
          continue;
        }
        // The 🗄️/🔧 status line is appended mechanically from the calls
        // actually made this turn (the model is told not to write it).
        // Streamed clients accumulated the raw text, so ship the line as
        // one final chunk to keep the live view in sync with what's stored.
        const icons = toolIcons(collectedToolCalls);
        if (icons && onEvent) onEvent('content', `\n\n${icons}`);
        return {
          content: appendToolIcons(response.content || '(no response)', collectedToolCalls),
          toolCalls: collectedToolCalls,
        };
      }

      messages.push(response);
      if (onEvent) onEvent('tool_calls', response.tool_calls);

      for (const call of response.tool_calls) {
        // A tool can be registered globally (another agent's MCP server) yet
        // invisible to this agent — refuse instead of executing, so per-agent
        // assignment holds even if the model hallucinates a foreign tool name.
        const result = visibleNames.has(call.function.name)
          ? await this.#registry.execute(
              call.function.name,
              call.function.arguments,
              { agentId, channelId, chatId, sessionId },
            )
          : { error: `Unknown tool: ${call.function.name}` };
        collectedToolCalls.push({
          name: call.function.name,
          args: call.function.arguments,
          result,
        });
        if (onEvent) onEvent('tool_result', { name: call.function.name, result });
        // Truncate tool results to avoid exceeding model context — and say
        // so explicitly: a silently cut list reads as "the rest doesn't
        // exist" and the model states that as fact.
        const resultStr = JSON.stringify(result);
        const resultContent = resultStr.length > 12000
          ? `${resultStr.slice(0, 12000)}\n…[tool result truncated: showing 12000 of ${resultStr.length} chars — the data continues beyond this point]`
          : resultStr;
        messages.push({ role: 'tool', content: resultContent, _toolName: call.function.name });
      }
    }

    return {
      content: appendToolIcons('(reached maximum tool call iterations)', collectedToolCalls),
      toolCalls: collectedToolCalls,
    };
  }
}
