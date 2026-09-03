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

echo "[entrypoint] Starting DogeClaw agent (with --watch for hot reload)..."
exec node --watch /opt/agent/src/index.js
