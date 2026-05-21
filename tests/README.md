# DogeClaw Playwright tests

End-to-end tests that drive the admin + chat UIs and exercise the HTTP API.

## Run

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

The config auto-starts the dev compose stack via `docker compose up -d`
from the repo root when nothing is listening on `localhost:3000`, and reuses
an already-running stack otherwise. Postgres state is left in place between
runs — tests prefix every created entity with `pw-` and the global setup
purges those rows before each run.

## Layout

| File | Purpose |
|---|---|
| `playwright.config.js` | webServer + global storageState + chromium project |
| `global-setup.js` | Logs in once → `.auth/state.json`; clears `pw-*` rows |
| `helpers/db.js` | `psql` shell-out for state the API doesn't expose (sessions) |
| `helpers/cleanup.js` | Drops every `pw-*` row across all tables |
| `helpers/ui.js` | Tab-open / modal / unique-name helpers |
| `specs/auth.spec.js` | login/logout, auth gate |
| `specs/tabs.spec.js` | tab nav + hash routing |
| `specs/models.spec.js` | model CRUD |
| `specs/agents.spec.js` | agent CRUD + cross-tab dropdown |
| `specs/skills.spec.js` | skill CRUD + agent assignment |
| `specs/channels.spec.js` | channel CRUD |
| `specs/crons.spec.js` | cron CRUD, validation, FK cascade |
| `specs/settings.spec.js` | timezone select, persistence, cron-modal default |
| `specs/sessions.spec.js` | chat UI session list + cron-warning dialog |

## Notes

- `workers: 1` because tests share one Postgres + one agent process.
- LLM chat completions are out of scope (no real model in the dev stack).
- The legacy V2 role conflict makes `[telegram] Failed to load channels`
  appear in logs; it doesn't affect any UI/API path the suite exercises.
