import { adminQuery } from '../db/pool.js';
import { loadAgentRuntime } from '../db/agentRuntime.js';
import { loadSession, ensureSession, appendMessage } from '../db/sessions.js';
import { withSessionLock } from '../lib/sessionLock.js';
import { makeAdminHandlers, makeAgentDispatcher } from '../lib/adminTools.js';
import { reloadTelegram } from '../web/managers.js';

// Admin ("god") agent tools: manage, inspect and talk to the other agents.
// Registered with meta.adminOnly — agent.js hides them from every agent whose
// agents.is_admin is false, and each handler re-checks the flag. Handlers,
// guards and redaction live in lib/adminTools.js for testability.
//
// Deliberately no delete_agent: deleting an agent cascades to its channels,
// skills assignments and cron jobs with no undo. That stays an operator
// action in the admin UI.

const ADMIN_META = { adminOnly: true };

// `agent` is the Agent instance — messaging runs the target through the same
// loop every other entry point uses.
export function register(registry, agent) {
  const dispatch = makeAgentDispatcher({
    loadRuntime: loadAgentRuntime,
    loadSession,
    ensureSession,
    appendMessage,
    withSessionLock,
    run: (text, history, opts) => agent.run(text, history, opts),
  });
  const h = makeAdminHandlers({ query: adminQuery, dispatch, onAgentsChanged: reloadTelegram });

  const def = (name, description, properties = {}, required = []) => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  });
  const agentId = { type: 'number', description: 'Agent id (from list_agents)' };

  registry.register('list_agents', def(
    'list_agents',
    'Admin: list every agent with its id, model, admin flag, a prompt preview, session count and last activity.',
  ), h.listAgents, ADMIN_META);

  registry.register('list_models', def(
    'list_models',
    'Admin: list the configured models (id, name, provider, model) — use the id as model_id in create_agent / update_agent.',
  ), h.listModels, ADMIN_META);

  registry.register('get_agent', def(
    'get_agent',
    'Admin: full configuration of one agent — system prompt, model, assigned skills (with content), public skills, MCP servers, channels and cron jobs. Secrets are redacted.',
    { agent_id: agentId },
    ['agent_id'],
  ), h.getAgent, ADMIN_META);

  registry.register('create_agent', def(
    'create_agent',
    'Admin: create a new (non-admin) agent. Only do this when the user asks for it.',
    {
      name: { type: 'string', description: 'Unique agent name' },
      system_prompt: { type: 'string', description: 'The agent\'s system prompt' },
      model_id: { type: 'number', description: 'Model id from list_models (optional)' },
      skill_ids: { type: 'array', items: { type: 'number' }, description: 'Skill ids to assign (optional)' },
    },
    ['name'],
  ), h.createAgent, ADMIN_META);

  registry.register('update_agent', def(
    'update_agent',
    'Admin: edit a non-admin agent. Only the fields you pass change; skill_ids replaces the full assignment list. Admin agents (including you) cannot be edited with this tool.',
    {
      agent_id: agentId,
      name: { type: 'string', description: 'New name' },
      system_prompt: { type: 'string', description: 'New system prompt (replaces the old one entirely)' },
      model_id: { type: 'number', description: 'New model id from list_models' },
      skill_ids: { type: 'array', items: { type: 'number' }, description: 'Complete list of skill ids to assign' },
    },
    ['agent_id'],
  ), h.updateAgent, ADMIN_META);

  registry.register('get_agent_conversations', def(
    'get_agent_conversations',
    'Admin: read an agent\'s conversations. Without session_id: its most recent sessions. With session_id: the latest messages of that session (tool calls summarized). Secrets are redacted.',
    {
      agent_id: agentId,
      session_id: { type: 'string', description: 'Session id (from the session list) to read messages of' },
      limit: { type: 'number', description: 'Sessions (default 10, max 50) or messages (default 20, max 100) to return' },
    },
    ['agent_id'],
  ), h.getAgentConversations, ADMIN_META);

  registry.register('analyze_agent_performance', def(
    'analyze_agent_performance',
    'Admin: performance stats for one agent over the last N days — message volume, unanswered messages, fallback replies, turn latency, tool calls and tool error rates per tool, recent errors, and cron run success. Token usage and cost are not recorded.',
    {
      agent_id: agentId,
      days: { type: 'number', description: 'Time window in days (default 7, max 90)' },
    },
    ['agent_id'],
  ), h.analyzeAgentPerformance, ADMIN_META);

  registry.register('send_message_to_agent', def(
    'send_message_to_agent',
    'Admin: send a message to another (non-admin) agent and get its reply. The agent processes it like a normal turn, with its own tools, in a dedicated thread (session agent-<you>-to-<id>) that keeps context across messages.',
    {
      agent_id: agentId,
      message: { type: 'string', description: 'The message to send' },
    },
    ['agent_id', 'message'],
  ), h.sendMessageToAgent, ADMIN_META);

  registry.register('relay_message', def(
    'relay_message',
    'Admin: pass a message from one agent to another when the user asks you to. The recipient sees it attributed to from_agent_id (relayed by you) and its reply is returned. The recipient must not be an admin agent.',
    {
      from_agent_id: { type: 'number', description: 'Agent the message is from' },
      to_agent_id: { type: 'number', description: 'Agent that receives the message' },
      message: { type: 'string', description: 'The message content to pass on' },
    },
    ['from_agent_id', 'to_agent_id', 'message'],
  ), h.relayMessage, ADMIN_META);
}
