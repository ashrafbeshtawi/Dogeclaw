<p align="center">
  <img src="logo.png" alt="DogeClaw" width="320">
</p>

<h1 align="center">DogeClaw</h1>

<p align="center">
  Self-hosted, multi-agent AI assistant. Web UI + Telegram + cron + tools, multi-model.
</p>

<p align="center">
  <a href="https://github.com/ashrafbeshtawi/Dogeclaw/pkgs/container/dogeclaw"><img alt="agent image" src="https://img.shields.io/badge/ghcr.io-dogeclaw-blue"></a>
  <a href="https://github.com/ashrafbeshtawi/Dogeclaw/pkgs/container/dogeclaw-migrations"><img alt="migrations image" src="https://img.shields.io/badge/ghcr.io-dogeclaw--migrations-blue"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green">
</p>

---

## Installation

DogeClaw ships as two public Docker images:

- `ghcr.io/ashrafbeshtawi/dogeclaw` — the agent (web UI, Telegram, tools, cron)
- `ghcr.io/ashrafbeshtawi/dogeclaw-migrations` — Flyway with the agent's DB schema baked in

Both are versioned with semver tags (`vX.Y.Z`) plus `:latest`, and built for `linux/amd64` and `linux/arm64`.

You can run DogeClaw two ways:

### Local (clone & hack)

For development or local tinkering. Bundles Postgres, migrations, and the agent in a single `docker compose` stack with the source mounted into the container, so editing any `.js` file under `agent/src/` auto-restarts the process via `node --watch`.

```bash
git clone https://github.com/ashrafbeshtawi/Dogeclaw.git
cd Dogeclaw
cp .env.example .env       # adjust DOGECLAW_WEB_PASSWORD, secrets, etc.
docker compose up -d
```

Web UI: <http://localhost:3000> — log in with `admin` / `changeme` (override via `.env`), then visit `/admin` to add a model and an agent before chatting.

```bash
docker compose down        # stop
docker compose down -v     # stop + wipe state (postgres + workspace)
```

Helper scripts under `bin/`:
```
bin/build      docker compose build dogeclaw  (after Dockerfile changes)
bin/restart    docker compose restart dogeclaw
bin/install    reinstall deps inside the running container
bin/logs       tail logs
bin/shell      bash inside the container
bin/seed       load dev fixtures (model + skills + agents + telegram channel)
```

#### Dev fixtures

A fresh stack boots with an empty admin UI. To seed a starter model, a handful of skills, a few agents, and a telegram channel, fill in the fixture variables in `.env`:

```env
DOGECLAW_FIXTURE_GEMINI_API_KEY=AI...        # https://aistudio.google.com/apikey
DOGECLAW_FIXTURE_TELEGRAM_BOT_TOKEN=12345:AB... # from BotFather
```

Then run the seeder once the stack is up:

```bash
bin/seed
```

The script is idempotent — re-running it leaves existing rows alone (or just refreshes the API key / bot token). Either fixture variable can be left blank to skip that piece; missing both is fine and only the skills + agents get seeded.

### Docker (consume the published images)

For real deployments. Drop the two images into your own `docker-compose.yml` (or k8s manifests) alongside any Postgres 16+ instance, set the env vars, and you're done.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: dogeclaw
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U admin"]
      interval: 5s
      retries: 5

  dogeclaw-migrations:
    image: ghcr.io/ashrafbeshtawi/dogeclaw-migrations:v1.0.0
    environment:
      FLYWAY_URL: jdbc:postgresql://postgres:5432/dogeclaw
      FLYWAY_USER: admin
      FLYWAY_PASSWORD: ${DB_PASSWORD}
    depends_on:
      postgres: { condition: service_healthy }
    restart: "no"

  dogeclaw:
    image: ghcr.io/ashrafbeshtawi/dogeclaw:v1.0.0
    environment:
      # Admin role — used for schema/admin queries
      DOGECLAW_ADMIN_DATABASE_URL: postgres://admin:${DB_PASSWORD}@postgres:5432/dogeclaw
      # Restricted role — used by the agent's query_database tool
      DOGECLAW_DATABASE_URL: postgres://dogeclaw:dogeclaw-agent-pw@postgres:5432/dogeclaw
      # Web UI auth
      DOGECLAW_WEB_USER: admin
      DOGECLAW_WEB_PASSWORD: ${WEB_PASSWORD}
      DOGECLAW_WEB_SECRET: ${WEB_SECRET}    # openssl rand -hex 32
      # Optional: local LLM backend
      DOGECLAW_OLLAMA_URL: ""
      # Optional: Telegram in prod (set to 'webhook' + provide a public URL)
      DOGECLAW_TELEGRAM_MODE: polling
      DOGECLAW_WEBHOOK_URL: ""
    ports:
      - "3000:3000"
    depends_on:
      dogeclaw-migrations: { condition: service_completed_successfully }

volumes:
  postgres_data:
```

The migrations image creates a restricted `dogeclaw` Postgres role (default password `dogeclaw-agent-pw` — **rotate in production**) and grants it only what the agent needs. The agent connects with this restricted role for its `query_database` tool, while admin operations use `DOGECLAW_ADMIN_DATABASE_URL`.

#### Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DOGECLAW_ADMIN_DATABASE_URL` | yes | — | Postgres URL with admin privileges |
| `DOGECLAW_DATABASE_URL` | yes | — | Postgres URL using the restricted `dogeclaw` role |
| `DOGECLAW_WEB_USER` | yes | `admin` | Web UI login |
| `DOGECLAW_WEB_PASSWORD` | yes | `changeme` | Web UI password |
| `DOGECLAW_WEB_SECRET` | yes | — | Session secret (`openssl rand -hex 32`) |
| `DOGECLAW_PORT` | no | `3000` | HTTP port |
| `DOGECLAW_OLLAMA_URL` | no | — | Base URL of an Ollama instance for local models |
| `DOGECLAW_TELEGRAM_MODE` | no | `polling` | `polling` or `webhook` |
| `DOGECLAW_WEBHOOK_URL` | no | — | Public base URL when using `webhook` mode |

Model API keys (OpenRouter, Google Gemini, etc.) are configured per-model **at runtime via the admin UI**, not via env vars.

---

## Features

### Web UI
- Streaming chat with **live thinking display** for reasoning models
- **Collapsible tool calls** — see exactly what the agent did, with arguments and results
- Session management, conversation history
- **Image and audio upload** — drop a screenshot or a voice note straight into chat
- Agent picker — switch between configured agents per conversation
- Admin pages at `/admin` for managing models, agents, skills, channels, and MCP servers

### Multi-agent
Define any number of agents with their own:
- system prompt
- model assignment
- skill assignments

Each agent is a separate persona with its own behavior and toolset.

### Multi-model providers
Configure models per-agent across three providers, all routed through one unified streaming abstraction:
- **Ollama** — local LLMs
- **OpenRouter** — OpenAI-compatible gateway to hundreds of models
- **Google Gemini** — including Gemini 3+ with `thoughtSignature` preservation

### Telegram bots
- Multiple bots, each backed by a different agent, configured from the admin UI
- **Polling** mode (no public URL needed — perfect for local dev) or **webhook** mode for production
- **Voice note transcription** via Whisper before forwarding to the agent
- **Image forwarding** to vision-capable models
- Two response modes: **immediate** (reply per message) or **periodic** (batch and reply on a cron schedule)

### Skills system
Reusable knowledge / instructions stored in the DB, assignable per-agent (or marked public). The agent sees them in its system prompt as `[id] name: description` entries and uses the `read_skill` tool to pull the full content on demand — keeps system prompts compact while making large playbooks available.

### Built-in tools
- **`shell_exec`** — run shell commands inside the container's workspace
- **File ops** — read, write, list, delete files
- **`schedule_cron`** — let the agent set up its own scheduled tasks
- **`query_database`** — read-only Postgres queries via the restricted role
- **`web_search` / `web_fetch` / `web_research`** — fetch and parse pages with cheerio
- **MCP bridge** — connect any Model Context Protocol stdio server and expose its tools to the agent
- **`read_skill`** — load a skill's full content on demand

### Audio & vision
- **Whisper** transcription baked into the image (model pre-downloaded at build time)
- Image inputs forwarded transparently to vision-capable models

### Cron
In-process cron scheduler. Both the agent (via the `schedule_cron` tool) and the admin UI can schedule recurring runs that hit a configured agent and (optionally) deliver the result to a Telegram chat.

### MCP (Model Context Protocol)
Configure stdio MCP servers in the admin UI; their tools are dynamically registered alongside the built-ins, so the agent can use them without any code changes.

---

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

## CI/CD

GitHub Actions builds and publishes both images to GHCR on every push to `main` (`:latest`) and on every git tag matching `v*` (`:vX.Y.Z` and `:latest`). Builds are multi-arch (`linux/amd64` + `linux/arm64`).

Cut a release:
```bash
git tag v1.2.3
git push origin v1.2.3
```

## License

MIT
