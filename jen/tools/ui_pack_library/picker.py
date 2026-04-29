"""Per-game picker: companion library in picker mode + event listener.

Differences from `browse.py` (library mode):
- writes packs.json with mode='picker' so the HTML renders per-screen buttons
- watches the companion's .events file for `pack_pick` events and dispatches
  them to `place.place(...)` against the target game dir

The process runs in the foreground, polls events every second, and stays up
until Ctrl-C or `--stop`. Used by the `ui-pack-place` skill.
"""
from __future__ import annotations

import argparse
import json
import os
import time
import webbrowser
from dataclasses import asdict
from pathlib import Path

from tools.artgen import companion

from . import adapt, companion_data, config, place


def start(
    game_dir: Path,
    port: int | None = None,
    open_browser: bool = True,
    engine: str = "threejs",
) -> dict:
    d = companion_data.write_companion_data("picker")
    info = companion.start_server(str(d), str(config.library_root()), port=port)
    url = info.get("url") or f"http://localhost:{info.get('port')}"
    full_url = f"{url}/library-browser.html"
    if open_browser:
        try:
            webbrowser.open(full_url, new=2)
        except Exception:
            pass
    return {"url": full_url, "companion_dir": str(d), "game_dir": str(game_dir), "default_engine": engine}


def stop() -> None:
    companion.stop_server(str(companion_data.companion_dir()))


def run(game_dir: Path, port: int | None = None, engine: str = "threejs") -> None:
    game_dir = game_dir.resolve()
    info = start(game_dir, port=port, engine=engine)
    print(json.dumps(info, indent=2))
    print(f"\nWatching events in {info['companion_dir']}/.events ... Ctrl-C to stop.")
    companion_dir_path = info["companion_dir"]
    try:
        while companion.is_running(companion_dir_path):
            _drain_events(companion_dir_path, game_dir, engine)
            time.sleep(1)
    except KeyboardInterrupt:
        stop()
        print("\nstopped")


def _drain_events(companion_dir_path: str, game_dir: Path, default_engine: str) -> None:
    events = companion.read_events(companion_dir_path)
    if not events:
        return
    for ev in events:
        etype = ev.get("type")
        if etype == "pack_pick":
            _handle_pick(ev, game_dir, default_engine)
        elif etype == "adapt":
            _handle_adapt(ev, game_dir)
    companion.clear_events(companion_dir_path)


def _handle_pick(ev: dict, game_dir: Path, default_engine: str) -> None:
    pack_id = ev.get("pack_id")
    kind = ev.get("kind")
    name = ev.get("name")
    mode = ev.get("mode") or "engine"
    engine = ev.get("engine") or default_engine
    if not (pack_id and kind and name):
        print(f"[skip] malformed pack_pick event: {ev}")
        return
    try:
        result = place.place(
            pack_id, kind, name,
            mode=mode, engine=engine, game_dir=game_dir,
        )
        entry = catalog_find(pack_id)
        slug = (entry or {}).get("slug") or pack_id
        plan = adapt.build_plan(game_dir, slug, name, mode, engine)
        adapt_path = adapt.write_adapt_page(plan)
        print(
            f"[placed] {kind}:{name} via {mode}/{engine} -> {result.export_paths}\n"
            f"  adapt URL: /{adapt_path.name}  (text: {len(plan.text_entries)}, sprites: {len(plan.sprite_entries)})"
        )
    except Exception as exc:
        print(f"[error] {kind}:{name} via {mode}/{engine}: {type(exc).__name__}: {exc}")


def _handle_adapt(ev: dict, game_dir: Path) -> None:
    import_key = ev.get("import_key")
    if not import_key:
        print(f"[skip] malformed adapt event: {ev}")
        return
    try:
        result = adapt.apply(
            game_dir,
            import_key=import_key,
            mode=ev.get("mode") or "engine",
            engine=ev.get("engine") or "threejs",
            text_edits=ev.get("text_edits") or [],
            sprite_edits=ev.get("sprite_edits") or [],
        )
        print(
            f"[adapted] {import_key}: {len(result['applied_text'])} texts, "
            f"{len(result['applied_sprites'])} sprites -> {result['export_paths']}"
        )
    except Exception as exc:
        print(f"[error] adapt {import_key}: {type(exc).__name__}: {exc}")


def catalog_find(pack_id: str) -> dict | None:
    from . import catalog as _cat
    return _cat.find(pack_id)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", type=Path, default=None, help="target game project dir (default: cwd)")
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--engine", choices=("threejs", "godot"), default="threejs",
                    help="default engine for pick events without explicit engine")
    ap.add_argument("--stop", action="store_true")
    args = ap.parse_args()

    if args.stop:
        stop()
        print("stopped")
        return

    game = Path(args.game_dir or Path.cwd())
    if not (game / ".artgen" / "project.json").exists():
        print(
            f"[warn] {game}/.artgen/project.json not found; license guard will use the default scope 'director_games'. "
            f"Create it with {{'scope': '...'}} to gate access explicitly.",
        )
    run(game, port=args.port, engine=args.engine)


if __name__ == "__main__":
    main()
