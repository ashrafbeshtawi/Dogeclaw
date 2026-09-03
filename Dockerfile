FROM node:22-bookworm-slim

# Slim base — Whisper was removed (no on-box speech-to-text); the LLM hosts
# audio/video understanding natively when the configured model accepts it.
# git/curl stay because skills and tools shell out to them.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Bake the agent source AND its production deps into the image. Installing at
# boot instead meant every fresh container (prod deploys, CI) cold-installed
# from the npm registry — 90s to 3.5+ min depending on registry weather, which
# made smoke tests flaky and deploys slow. The stamp file marks the modules as
# image-built; the entrypoint only reinstalls when it's absent (a dev volume
# mount over /opt/agent hides the baked modules together with the stamp).
COPY agent/ /opt/agent/
RUN cd /opt/agent && npm ci --omit=dev && touch node_modules/.image-baked

# SQL migrations are applied in-process by agent/src/db/migrate.js on startup.
# Live in /opt/migrations/sql so a sibling volume mount can override during dev
# (see docker-compose.yml).
COPY migrations/sql/ /opt/migrations/sql/

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
