# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

# Slim base — Whisper was removed (no on-box speech-to-text); the LLM hosts
# audio/video understanding natively when the configured model accepts it.
# git/curl stay because skills and tools shell out to them.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Camoufox (stealth Firefox) for the browser_* tools, started by the entrypoint
# when DOGECLAW_BROWSER=true. Python, the Firefox runtime libraries and Xvfb
# (CAMOUFOX_HEADLESS=virtual) live in their own venv, since bookworm's pip
# refuses system-wide installs. Its Playwright must match playwright-core in
# agent/package.json, or firefox.connect() refuses the handshake; camoufox
# itself requires playwright<1.63. The browser binary goes to a fixed cache dir
# so the unprivileged camoufox user finds it at runtime. `camoufox fetch` asks
# the GitHub API for the release; the optional github_token build secret lifts
# the anonymous rate limit that shared CI runners hit (never stored in a layer).
ENV CAMOUFOX_CACHE=/opt/camoufox/cache
RUN --mount=type=secret,id=github_token,env=GITHUB_TOKEN \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv \
    libgtk-3-0 libx11-xcb1 libasound2 libdbus-glib-1-2 libxt6 xvfb \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/camoufox/venv \
  && /opt/camoufox/venv/bin/pip install --no-cache-dir "camoufox[geoip]==0.5.9" "playwright==1.62.0" \
  && XDG_CACHE_HOME=$CAMOUFOX_CACHE /opt/camoufox/venv/bin/python -m camoufox fetch \
  && useradd --create-home --shell /usr/sbin/nologin camoufox \
  && chmod -R a+rX /opt/camoufox && chown -R camoufox: $CAMOUFOX_CACHE
COPY camoufox/server.py /opt/camoufox/server.py

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
