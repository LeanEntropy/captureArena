"""Start the companion in library-browse mode.

Writes packs.json + HTML templates into <library>/.companion/ and launches the
artgen companion server with screenDir=<companion dir>, imagesDir=<library>.
Prints the browser URL.

Usage:
  python -m tools.ui_pack_library.browse [--mode library|picker] [--port N]
  python -m tools.ui_pack_library.browse --stop
"""
from __future__ import annotations

import argparse
import json
import time
import webbrowser

from tools.artgen import companion

from . import companion_data, config


def start(mode: str = "library", port: int | None = None, open_browser: bool = True) -> dict:
    d = companion_data.write_companion_data(mode)
    info = companion.start_server(str(d), str(config.library_root()), port=port)
    url = info.get("url") or f"http://localhost:{info.get('port')}"
    # The server routes /<file>.html; point the user at the browser explicitly.
    full_url = f"{url}/library-browser.html"
    if open_browser:
        try:
            webbrowser.open(full_url, new=2)
        except Exception:
            pass
    return {"url": full_url, "mode": mode, "companion_dir": str(d)}


def stop() -> None:
    d = companion_data.companion_dir()
    companion.stop_server(str(d))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("library", "picker"), default="library")
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--no-open", action="store_true", help="don't open the browser")
    ap.add_argument("--stop", action="store_true", help="stop a running server")
    args = ap.parse_args()

    if args.stop:
        stop()
        print("stopped")
        return

    result = start(mode=args.mode, port=args.port, open_browser=not args.no_open)
    print(json.dumps(result, indent=2))
    print("\nServer running. Ctrl-C or `python -m tools.ui_pack_library.browse --stop` to stop.")
    try:
        while companion.is_running(result["companion_dir"]):
            time.sleep(1)
    except KeyboardInterrupt:
        stop()
        print("\nstopped")


if __name__ == "__main__":
    main()
