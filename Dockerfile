FROM node:22-bookworm-slim

# Slim base — Whisper was removed (no on-box speech-to-text); the LLM hosts
# audio/video understanding natively when the configured model accepts it.
# git/curl stay because skills and tools shell out to them.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Bake the agent source as a fallback (used when no volume mount overrides /opt/agent).
# node_modules is NOT installed at build time — the entrypoint runs `npm install`
# on every start, into the host-mounted agent/ directory.
COPY agent/ /opt/agent/

# SQL migrations are applied in-process by agent/src/db/migrate.js on startup.
# Live in /opt/migrations/sql so a sibling volume mount can override during dev
# (see docker-compose.yml).
COPY migrations/sql/ /opt/migrations/sql/

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
