// Detects replies that claim a completed action ("logged", "saved", ✅) so
// the agent loop can force one corrective retry when zero tool calls back
// the claim (see agent.js). The prompt already forbids unbacked claims, but
// a rule the model must follow itself is not enforcement — this is.
//
// False positives are cheap (the model just rephrases, one extra iteration),
// so the list favors recall over precision. English + German — the languages
// the bot is actually used in; extend the list before adding cleverness.

const CLAIM_RE = /\b(logged|saved|stored|recorded|scheduled|updated|deleted|noted|tracked|marked|gespeichert|eingetragen|notiert|vermerkt|erledigt)\b|✅/iu;

export const CLAIM_NUDGE =
  'You claimed a completed action but made no tool call this turn. ' +
  'Either call the tool that actually performs it now, or rewrite your reply ' +
  'without claiming the action happened. Do not apologize or mention this correction.';

export function claimsAction(text) {
  return CLAIM_RE.test(text || '');
}
