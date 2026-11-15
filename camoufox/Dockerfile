# Camoufox browser service for the agent's browser_* tools. Optional: started
# only with `docker compose --profile browser up`.
FROM python:3.12-slim

# Firefox runtime libraries + Xvfb for CAMOUFOX_HEADLESS=virtual.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libgtk-3-0 libx11-xcb1 libasound2 libdbus-glib-1-2 libxt6 xvfb \
 && rm -rf /var/lib/apt/lists/*

# The Playwright version bundled here must match playwright-core in
# agent/package.json, or firefox.connect() refuses the handshake.
RUN pip install --no-cache-dir "camoufox[geoip]" \
 && python -m camoufox fetch

COPY server.py /opt/camoufox/server.py

EXPOSE 1234
CMD ["python", "/opt/camoufox/server.py"]
