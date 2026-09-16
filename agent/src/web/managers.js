// The Telegram and MCP managers are constructed after the web server, so the
// routes that need them cannot receive them at mount time. They used to be
// file-scope `let`s in server.js that every route closed over — an ambient
// dependency with nothing recording that the wiring order mattered. Keeping
// them here at least makes the lookup explicit at each use site.
//
// Both are legitimately null until index.js finishes booting; callers check.

let telegramManager = null;
let mcpManager = null;

export function setTelegramManager(tm) { telegramManager = tm; }
export function getTelegramManager() { return telegramManager; }

export function setMcpManager(m) { mcpManager = m; }
export function getMcpManager() { return mcpManager; }

// Model and agent writes change what a Telegram channel will use on its next
// message, so both routers ask the manager to re-read its channels. Fire and
// forget: the write already succeeded and the response has usually gone out.
export function reloadTelegram() {
  if (telegramManager) telegramManager.reload().catch(e => console.error('[telegram] reload failed:', e.message));
}
