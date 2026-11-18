// The browser's only way out is the agent's egress proxy (agent/src/lib/
// egressProxy.js). Drives the real Camoufox in the agent container, without
// the route guard, and checks that internal targets get the proxy's refusal
// while a public page loads. Needs the stack started with DOGECLAW_BROWSER=true
// (CI does); skipped otherwise.

const { test, expect } = require('@playwright/test');
const { execSync } = require('node:child_process');
const path = require('node:path');

const CONTAINER = 'dogeclaw';

function isBrowserEnabled() {
  try {
    return execSync(`docker exec ${CONTAINER} printenv DOGECLAW_BROWSER`, { encoding: 'utf-8', stdio: 'pipe' }).trim() === 'true';
  } catch {
    return false;
  }
}

function probe(targets) {
  const out = execSync(
    `docker exec -i -w /opt/agent -e PROBE_TARGETS ${CONTAINER} node --input-type=module`,
    {
      input: require('node:fs').readFileSync(path.join(__dirname, '../helpers/browser-probe.mjs')),
      env: { ...process.env, PROBE_TARGETS: JSON.stringify(targets) },
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180_000,
    },
  );
  return JSON.parse(out.trim().split('\n').pop());
}

test.describe('browser egress proxy', () => {
  test.skip(!isBrowserEnabled(), 'stack runs without DOGECLAW_BROWSER=true');

  test('internal targets are refused by the proxy, a public page loads', async () => {
    test.setTimeout(240_000);
    const internal = [
      'http://postgres:5432/',                       // another compose service
      'http://dogeclaw:3000/login',                  // the agent via its container address
      'http://169.254.169.254/latest/meta-data/',    // cloud metadata
    ];
    const result = probe([...internal, 'https://github.com/']);

    for (const url of internal) {
      expect(result[url], url).toBe('Forbidden');
    }
    // CI already depends on GitHub; any real page means the proxy let it through.
    expect(result['https://github.com/']).not.toBe('Forbidden');
    expect(result['https://github.com/']).not.toMatch(/^ERR /);
  });
});
