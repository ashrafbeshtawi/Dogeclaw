# Camoufox (stealth Firefox) as a Playwright server for the agent's browser_*
# tools. The agent connects with playwright-core's firefox.connect() to
# ws://camoufox:<port>/<path> — see DOGECLAW_CAMOUFOX_WS in docker-compose.yml.
import os

from camoufox.server import launch_server

headless = os.environ.get("CAMOUFOX_HEADLESS", "true").lower()

launch_server(
    # "virtual" renders into Xvfb: harder to fingerprint than true headless.
    headless="virtual" if headless == "virtual" else headless != "false",
    port=int(os.environ.get("CAMOUFOX_PORT", "1234")),
    ws_path=os.environ.get("CAMOUFOX_WS_PATH", "camoufox"),
)
