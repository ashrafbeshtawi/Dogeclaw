#!/bin/bash
set -e

# Ensure workspace directories exist
mkdir -p /root/agent-workspace/{files,sessions,queues,logs}

# Install/refresh deps on every start.
# - Idempotent and fast when nothing changed (a few seconds).
# - Picks up new deps automatically after a `restart`.
# - `npm rebuild` recompiles native modules for the current platform — guards
#   against the case where someone ran `npm install` on a non-Linux host.
echo "[entrypoint] Installing agent dependencies..."
cd /opt/agent
npm install --omit=dev
npm rebuild

echo "[entrypoint] Starting DogeClaw agent (with --watch for hot reload)..."
exec node --watch /opt/agent/src/index.js
