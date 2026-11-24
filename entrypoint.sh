#!/bin/bash
set -e

# Ensure workspace directories exist
mkdir -p /root/agent-workspace/{files,sessions,queues,logs}

# Production deps are baked into the image (`npm ci` at build time — see
# Dockerfile); the stamp file marks them, so a fresh container boots in
# seconds instead of cold-installing from the npm registry. A dev volume
# mount over /opt/agent hides the baked modules along with the stamp — for
# that case keep the old install-on-boot path:
# - Picks up new deps automatically after a `restart`.
# - `npm rebuild` recompiles native modules for the current platform — guards
#   against node_modules installed on a non-Linux host.
cd /opt/agent
LOCK_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ -f node_modules/.image-baked ] || [ "$(cat node_modules/.lock-hash 2>/dev/null)" = "$LOCK_HASH" ]; then
  echo "[entrypoint] Dependencies up to date — skipping install."
else
  echo "[entrypoint] Installing agent dependencies (dev volume mount)..."
  npm install --omit=dev
  npm rebuild
  # ponytail: stale-hash ceiling — if the host reinstalls node_modules with
  # the same lockfile (e.g. on macOS), the hash still matches and rebuild is
  # skipped; `rm agent/node_modules/.lock-hash` (or rm -rf node_modules)
  # forces a fresh install+rebuild.
  echo "$LOCK_HASH" > node_modules/.lock-hash
fi

# Camoufox for the browser_* tools, as an unprivileged user so a compromised
# browser can't read the agent's workspace or environment. Restarted when it
# exits; the agent reconnects on the next browser call. Its only way out is the
# agent's egress proxy (agent/src/lib/egressProxy.js).
if [ "$DOGECLAW_BROWSER" = "true" ]; then
  export DOGECLAW_BROWSER_PROXY_PORT=${DOGECLAW_BROWSER_PROXY_PORT:-3129}
  echo "[entrypoint] Starting Camoufox..."
  (
    while true; do
      runuser -u camoufox -- env -i HOME=/home/camoufox PATH=/usr/bin:/bin \
        XDG_CACHE_HOME="$CAMOUFOX_CACHE" \
        CAMOUFOX_PROXY="http://127.0.0.1:$DOGECLAW_BROWSER_PROXY_PORT" \
        CAMOUFOX_HEADLESS="${CAMOUFOX_HEADLESS:-true}" \
        /opt/camoufox/venv/bin/python /opt/camoufox/server.py || true
      echo "[entrypoint] Camoufox exited, restarting in 5s"
      sleep 5
    done
  ) &
fi

echo "[entrypoint] Starting DogeClaw agent (with --watch for hot reload)..."
exec node --watch /opt/agent/src/index.js
