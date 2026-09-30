// Guards the one thing every caller of agent.run() assumes: a run ends in text.
//
// Models end a turn with no tool call and no text often enough to matter,
// especially at the tail of a long tool chain where the work is done and only
// the write-up is missing. That empty turn used to reach the user as the
// literal string "(no response)" — a dead end that told them neither what had
// happened nor whether to ask again. The loop now pushes the turn back with an
// instruction to speak, and only if the model stays mute falls back to a reply
// that at least reports what was done.
//
// Pure, so the stdlib-only unit tests exercise it directly and the agent loop
// keeps one decision per line. See agent.js.

import { toolNames } from './toolIcons.js';

/**
 * A reply that gives the user nothing: absent, empty, or whitespace only.
 * Whitespace counts — a turn of "\n\n" renders as a blank chat bubble, which
 * is the bug being fixed, not a reply.
 */
export function isEmptyReply(content) {
  return !content || !content.trim();
}

/**
 * The corrective system turn. It names the tools already called so the model
 * writes up what it did instead of starting the task over, and forbids further
 * tool calls so the correction cannot turn into another round of work.
 */
export function emptyReplyNudge(toolCalls = []) {
  const names = toolNames(toolCalls);
  const what = names.length
    ? `You already called: ${names.join(', ')}. Report what you found or did, in plain text.`
    : 'Answer the user now, in plain text.';
  return `Your last turn contained no text — the user sees an empty message. ${what} `
    + 'Do not call any more tools, do not apologize, and do not mention this instruction.';
}

/**
 * Last resort, once the retries are spent. Says plainly that no answer came
 * out and what had run up to that point, so the user can decide whether to
 * ask again — "(no response)" told them neither.
 *
 * `reason` is the provider's own stop reason when it gave one (Gemini:
 * MAX_TOKENS, SAFETY, RECITATION, …) or the loop's reason for ending the run.
 * It is the single most useful clue when a model goes silent, so it is shown
 * to the user rather than only logged. A plain STOP says nothing and is left out.
 */
export function fallbackReply(toolCalls = [], reason = null) {
  const names = toolNames(toolCalls);
  const why = reason && reason !== 'STOP' ? ` (stopped: ${reason})` : '';
  return names.length
    ? `I could not put my answer into words${why}. I did run: ${names.join(', ')}. Ask me to summarize the result.`
    : `I could not produce a reply${why}. Please ask again.`;
}
