# DogeClaw

Custom Node.js AI agent. Web UI + Telegram + cron + tools, multi-agent and multi-model.

Ships as two Docker images:
- `ghcr.io/ashrafbeshtawi/dogeclaw` — the agent (web UI, Telegram, tools, cron)
- `ghcr.io/ashrafbeshtawi/dogeclaw-migrations` — Flyway with the agent's DB schema baked in

Both are public, both are versioned with semver tags + `:latest`.

## Features

- **Web UI**: streaming chat with live thinking display, collapsible tool calls, session management, image/audio upload, agent picker
- **Telegram bots**: multiple bots configurable from the UI, immediate or periodic response modes, voice note transcription, image forwarding
- **Multi-agent**: define agents with custom system prompts, models, and skill assignments
- **Multi-model providers**: Ollama (local), OpenRouter, Google Gemini — configurable per agent
- **Skills system**: reusable knowledge/instructions stored in DB, assignable per-agent or public
- **Built-in tools**: shell exec, file ops, cron jobs, PostgreSQL queries, web search/fetch/research, MCP bridge, skill reading
- **Audio**: Whisper transcription for voice messages
- **Vision**: image inputs forwarded to vision-capable models

## Quick start (local)

```bash
git clone https://github.com/ashrafbeshtawi/dogeclaw.git
cd dogeclaw
cp .env.example .env
docker compose up -d
```

Web UI: http://localhost:3000 — log in with `admin` / `changeme` (override via `.env`), then visit `/admin` to add a model and an agent before chatting.

To stop: `docker compose down`. To wipe state: `docker compose down -v`.

## Consuming the published images

```yaml
services:
  postgres: { ... }   # any postgres 16+

  dogeclaw-migrations:
    image: ghcr.io/ashrafbeshtawi/dogeclaw-migrations:v1.0.0
    environment:
      - FLYWAY_URL=jdbc:postgresql://postgres:5432/yourdb
      - FLYWAY_USER=admin
      - FLYWAY_PASSWORD=...
    depends_on:
      postgres: { condition: service_healthy }
    restart: "no"

  dogeclaw:
    image: ghcr.io/ashrafbeshtawi/dogeclaw:v1.0.0
    environment:
      - DOGECLAW_ADMIN_DATABASE_URL=postgres://admin:...@postgres:5432/yourdb
      - DOGECLAW_DATABASE_URL=postgres://dogeclaw:dogeclaw-agent-pw@postgres:5432/yourdb
      - DOGECLAW_WEB_USER=admin
      - DOGECLAW_WEB_PASSWORD=...
      - DOGECLAW_WEB_SECRET=...
    depends_on:
      dogeclaw-migrations: { condition: service_completed_successfully }
```

The migrations image creates a restricted `dogeclaw` postgres role (default password `dogeclaw-agent-pw`; rotate in prod) and grants it only what the agent needs. The agent connects with the restricted role for its `query_database` tool.

## Repo layout

```
dogeclaw/
├── Dockerfile              # agent image (Node + Whisper + agent source)
├── entrypoint.sh           # runs npm install + node --watch on every start
├── docker-compose.yml      # local-dev: postgres + migrations + agent
├── .env.example
├── bin/                    # helper scripts (build, restart, install, logs, shell)
├── agent/                  # JS source (mounted into the container at /opt/agent)
│   ├── package.json
│   └── src/
│       ├── index.js        # boot orchestrator
│       ├── agent.js        # core agent loop (LLM + tools)
│       ├── llm.js          # Ollama / OpenRouter / Gemini drivers
│       ├── audio.js        # Whisper transcription
│       ├── db/             # pg pools, schema queries
│       ├── tools/          # built-in tool implementations
│       ├── cron/           # in-process cron scheduler
│       ├── channels/       # Telegram (multi-bot, polling/webhook)
│       ├── mcp/            # MCP stdio clients
│       └── web/            # Express + SSE chat + REST + admin UI
└── migrations/             # Flyway image
    ├── Dockerfile
    └── sql/
        ├── V1__init.sql           # tables: agents, models, channels, skills, agent_skills
        ├── V2__create_role.sql    # CREATE ROLE dogeclaw
        └── V3__grants.sql         # GRANT SELECT / USAGE / CREATE
```

## Development

The agent runs with `node --watch`, so editing any `.js` file under `agent/src/` auto-restarts the process inside the container. Static HTML/CSS under `agent/src/web/public/` is re-read from disk per request — no restart needed.

Helper scripts:
```bash
bin/build      # docker compose build dogeclaw  (after Dockerfile changes)
bin/restart    # docker compose restart dogeclaw
bin/install    # reinstall deps inside the running container
bin/logs       # tail logs
bin/shell      # bash inside the container
```

Adding a dependency:
```bash
cd agent && npm install <pkg>
../bin/install   # or ../bin/restart
```

## CI/CD

GitHub Actions builds and publishes both images to GHCR on every push to `main` (`:latest` tag) and on every git tag matching `v*` (`:vX.Y.Z` and `:latest`).

To cut a release:
```bash
git tag v1.2.3
git push origin v1.2.3
```

## License

MIT
