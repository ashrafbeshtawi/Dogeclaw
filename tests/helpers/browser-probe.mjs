// Runs inside the agent container (piped to `node --input-type=module` with
// cwd /opt/agent) and drives the real Camoufox in contexts WITHOUT the route
// guard, so only the egress proxy stands between the page and each target.
// Prints one JSON object: { [url]: page text, or "ERR <message>" }.

import { firefox } from 'playwright-core';

const targets = JSON.parse(process.env.PROBE_TARGETS);

let browser;
for (let i = 0; i < 45 && !browser; i++) {
  try {
    browser = await firefox.connect('ws://127.0.0.1:1234/camoufox', { timeout: 5000 });
  } catch {
    await new Promise(r => setTimeout(r, 2000)); // Camoufox may still be starting
  }
}
if (!browser) {
  console.log(JSON.stringify({ error: 'Camoufox not reachable' }));
  process.exit(1);
}

const result = {};
for (const url of targets) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { timeout: 20_000 });
    result[url] = (await page.innerText('body')).trim();
  } catch (err) {
    result[url] = `ERR ${err.message.split('\n')[0]}`;
  }
  await context.close();
}
await browser.close();
console.log(JSON.stringify(result));
