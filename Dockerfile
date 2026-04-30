FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    python3 \
    python3-pip \
    ffmpeg \
  && pip3 install --break-system-packages openai-whisper \
  && rm -rf /var/lib/apt/lists/*

# Pre-download whisper base model
RUN python3 -c "import whisper; whisper.load_model('base')"

# Bake the agent source as a fallback (used when no volume mount overrides /opt/agent).
# node_modules is NOT installed at build time — the entrypoint runs `npm install`
# on every start, into the host-mounted agent/ directory.
COPY agent/ /opt/agent/

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
