---
name: playwright
description: Run the DogeClaw Playwright suite and extend it when adding features. INVOKE when the user is about to push, when a test fails, when "run tests" is asked, and PROACTIVELY whenever a code change touches the admin UI, chat UI, HTTP API, or DB schema — every new feature in those surfaces needs a test added under tests/specs/.
---

# Playwright skill for DogeClaw

The Playwright suite (`tests/`) is the deployment gate. CI publishes Docker
images only if every spec passes — see `.github/workflows/publish.yml`.
Treat a red suite as "do not push."

## Two situations this skill covers

### 1. About to push, or asked to run tests

```bash
cd tests
npm install              # only the first time / when tests/package.json changed
npx playwright install chromium   # only the first time
npm test
```

What to expect:

- The config auto-starts the docker compose stack (`docker compose up -d`)
  when nothing is listening on `localhost:3000`, and reuses an already-running
  stack otherwise. First-time stack boot includes a Whisper model download
  (~50s). Warm runs finish in ~30s.
- Single worker — tests share one Postgres + one agent process.
- Global setup logs in once and drops any leftover `pw-*` rows from the
  previous run, so prior failures don't poison the next attempt.

If something fails:

- `npx playwright show-report` opens the HTML report (also uploaded as a CI
  artifact named `playwright-report-<run-id>`).
- `npx playwright test specs/foo.spec.js --reporter=line` re-runs one spec.
- `npx playwright test --headed` runs visibly in Chromium.
- `npx playwright test --ui` opens the time-travel debugger.
- Failure screenshots and traces live under `tests/test-results/`.

Never push if the suite is red. The CI will block the publish anyway, but
catching it locally saves a round-trip.

### 2. A new feature was added — extend the suite

Any change that touches one of these surfaces needs a corresponding test:

| Change | Add a test in |
|---|---|
| New admin tab or section | `tests/specs/tabs.spec.js` + a new `<resource>.spec.js` |
| New CRUD on existing tab | the matching `<resource>.spec.js` |
| New API endpoint | `crons.spec.js`-style API block, or a new spec |
| New DB constraint / validation | API-level test asserting the error response |
| New chat UI behavior | `sessions.spec.js` or a new spec |
| New cron / scheduling behavior | `crons.spec.js` |
| New setting | `settings.spec.js` |

Do not commit a feature without its test. If the feature genuinely cannot be
tested (LLM completion, real Telegram delivery), say so explicitly in the PR
description and add the test for everything around it.

## Conventions to follow when adding tests

- **Prefix everything you create with `pw-`** (`pw-agent-...`, `pw-cron-...`).
  `tests/helpers/cleanup.js` purges `pw-*` rows in global setup, so prefix
  collisions across runs are harmless.
- **Use `uniqueName(prefix)`** from `tests/helpers/ui.js` — adds a timestamp
  + random suffix so the same test can re-run without collision.
- **Locate rows by visible content**, not by id (ids in attributes like
  `onclick="..."` don't satisfy `hasText`). Make the unique marker something
  that's actually rendered.
- **Locate by element id when possible**: `page.locator('#cronModal')` is
  more stable than text-based selectors.
- **Auto-accept dialogs** with `page.on('dialog', d => d.accept())` in
  `beforeEach`. Capture the message via `d => { msg = d.message(); d.dismiss(); }`
  when asserting on dialog text.
- **Use `request` for API-only assertions** — much faster than driving the
  UI just to hit an endpoint.
- **Seed sessions via psql** — there's no POST `/api/sessions`. Use
  `tests/helpers/db.js#psql` and clean up in `finally`.
- **Cascades** — when testing FK CASCADE, seed via API or psql, delete the
  parent via the API, then re-fetch the child list and assert it's gone.
- **No artificial waits** (`page.waitForTimeout` is a code smell). Use
  Playwright's auto-waiting locators or `expect.poll`.
- **Single worker** is set in `playwright.config.js` — don't change it.
  Tests share global state (one Postgres, one agent process).

## How to add a spec, in order

1. Pick or create the spec file under `tests/specs/`.
2. Decide UI-driven vs. API-only (or both) — UI tests cover what users do;
   API tests cover what middleware/DB enforces.
3. If the test needs an agent, channel, or session: create them in
   `beforeAll` via `request` (or `psql` for sessions), tear down in
   `afterAll`. Use `pw-` prefixes so cleanup is safe.
4. Author the assertions. Reference an existing spec for the exact shape
   (`crons.spec.js` is the richest example).
5. Run just that spec: `npx playwright test specs/<name>.spec.js`.
6. Run the whole suite to catch interactions: `npm test`.
7. Update `tests/README.md` if you added a spec file.

## Before-push checklist

Walk through this whenever the user is preparing to push:

1. `cd tests && npm test` is green.
2. Any new behavior added in this branch has at least one test.
3. New entities use `pw-` prefix; helpers/cleanup.js purges them.
4. CI workflow file wasn't touched unless intentional — the workflow gates
   on Playwright, so its config is load-bearing.
5. If `tests/package.json` changed, commit the updated `package-lock.json`.

## What NOT to do

- Don't bypass the CI test gate by editing `.github/workflows/publish.yml`
  to drop the `needs: test` line without saying so explicitly.
- Don't add LLM-dependent tests (real completions, real Telegram, etc.)
  without an explicit mock or skip — the dev stack has no model.
- Don't increase `workers` above 1 — tests share one Postgres.
- Don't introduce a new dependency to `tests/package.json` unless it's
  Playwright-adjacent (assertion libs, test data factories). `request`
  and `psql` cover almost every case.