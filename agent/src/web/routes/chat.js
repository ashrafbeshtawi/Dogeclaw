import express from 'express';
import { loadAgentRuntime } from '../../db/agentRuntime.js';
import { loadSession, ensureSession, appendMessage } from '../../db/sessions.js';
import { withSessionLock } from '../../lib/sessionLock.js';
import { randomUUID } from 'node:crypto';

// Mounted under /api behind authMiddleware in server.js; no per-route guards needed.
export function chatRoutes(agent) {
  const router = express.Router();

  // --- Chat (SSE streaming) ---
  router.post('/chat', async (req, res) => {
    const { message, sessionId: reqSessionId, agentId, images, audio, audioMime, video, videoMime } = req.body;
    if (!message && !images?.length && !audio && !video) return res.status(400).json({ error: 'message, images, audio, or video required' });

    const sid = reqSessionId || randomUUID();
    const existing = await loadSession(sid);
    const aid = agentId || existing.agentId;
    if (!aid) return res.status(400).json({ error: 'No agent selected. Create an agent in the admin UI first.' });

    let runtime = null;
    try {
      runtime = await loadAgentRuntime(aid);
    } catch {}

    if (!runtime) return res.status(404).json({ error: 'Agent not found.' });
    const { agent: agentConfig, modelConfig } = runtime;
    if (!modelConfig) return res.status(400).json({ error: 'This agent has no model assigned. Configure it in the admin UI.' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    await ensureSession(sid, {
      agentId: aid,
      agentName: agentConfig?.name || 'default',
      source: 'web',
    });

    await withSessionLock(sid, async () => {
      // Load history BEFORE persisting the new user message so agent.run
      // doesn't see it twice (it re-appends the user message internally),
      // and persist the user row FIRST so an LLM/network failure below
      // doesn't silently drop the user's input from session history.
      const { messages: history } = await loadSession(sid);

      await appendMessage(sid, {
        role: 'user',
        content: message || '',
        hasImage: !!images?.length,
        hasAudio: !!audio,
        hasVideo: !!video,
      });

      try {
        let fullContent = '';
        let fullThinking = '';

        const result = await agent.run(message || '', history, {
          agentId: aid,
          agentName: agentConfig?.name,
          sessionId: sid,
          systemPrompt: agentConfig?.system_prompt,
          modelConfig,
          images: images || undefined,
          audio: audio || undefined,
          audioMime: audioMime || undefined,
          video: video || undefined,
          videoMime: videoMime || undefined,
          onEvent: (type, data) => {
            if (type === 'thinking') { fullThinking += data; send('thinking', data); }
            else if (type === 'content') { fullContent += data; send('content', data); }
            else if (type === 'tool_calls') { send('tool_calls', data); }
            else if (type === 'tool_result') { send('tool_result', data); }
            else if (type === 'status') { send('status', data); }
          },
        });

        // Prefer run()'s content: it's the streamed text plus the mechanical
        // 🗄️/🔧 line, with any model-written icon lines stripped.
        const finalContent = result.content || fullContent;

        await appendMessage(sid, {
          role: 'assistant',
          content: finalContent,
          thinking: result.thinking || fullThinking || null,
          toolCalls: result.toolCalls?.length ? result.toolCalls : null,
        });

        send('done', { sessionId: sid });
      } catch (err) {
        send('error', { message: err.message });
      }
    });

    res.end();
  });

  return router;
}
