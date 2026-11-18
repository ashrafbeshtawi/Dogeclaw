# Camoufox (stealth Firefox) as a Playwright server for the agent's browser_*
# tools. Started by entrypoint.sh inside the agent container when
# DOGECLAW_BROWSER=true; the agent connects with playwright-core's
# firefox.connect() to ws://127.0.0.1:<port>/<path>.
#
# The browser's only way out is the agent's egress proxy (CAMOUFOX_PROXY),
# which checks every connection against the SSRF guard. Firefox normally skips
# the proxy for localhost, and WebRTC opens UDP sockets past any proxy, so both
# are switched off here.
import os

from camoufox.server import launch_server

headless = os.environ.get("CAMOUFOX_HEADLESS", "true").lower()

launch_server(
    # "virtual" renders into Xvfb: harder to fingerprint than true headless.
    headless="virtual" if headless == "virtual" else headless != "false",
    host="127.0.0.1",
    port=int(os.environ.get("CAMOUFOX_PORT", "1234")),
    ws_path=os.environ.get("CAMOUFOX_WS_PATH", "camoufox"),
    proxy={"server": os.environ["CAMOUFOX_PROXY"]},
    block_webrtc=True,
    firefox_user_prefs={
        "network.proxy.allow_hijacking_localhost": True,
        "network.proxy.no_proxies_on": "",
    },
)
