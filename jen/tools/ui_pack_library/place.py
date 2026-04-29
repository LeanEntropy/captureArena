"""Place a UI pack screen into a game project.

Workflow:
1. Load canonical scene from <library>/packs/<slug>/canonical/<kind>s/<name>.json.
2. License guard: check pack.license.allowed_in against the game project's scope
   (from <game>/.artgen/project.json, default 'director_games').
3. Sandbox everything under <game>/.artgen/packs_imports/<slug>/<name>/:
   - canonical.json with asset paths rewritten to this import's assets/
   - assets/<sha1>.png copied from the library
   - adaptation.json (empty for v1; populated by Stage 6 passes)
   - exports/ depending on mode
4. Mode:
   - 'figma'  → plugin bundle via tools.ui_pack_ingest.threejs_to_figma.convert
   - 'engine' + 'threejs' → copy canonical + assets (ready for lobby.js loader)
   - 'engine' + 'godot'  → .tscn via canonical_to_godot.emit

Usage:
  python -m tools.ui_pack_library.place <pack_id> <kind> <name> --mode figma
  python -m tools.ui_pack_library.place <pack_id> <kind> <name> --mode engine --engine godot --game-dir <path>
"""
from __future__ import annotations

import argparse
import base64
import json
import shutil
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from . import canonical_to_godot, catalog, config

_UI_PACK_INGEST = Path(__file__).resolve().parents[1] / "ui_pack_ingest"
if str(_UI_PACK_INGEST) not in sys.path:
    sys.path.insert(0, str(_UI_PACK_INGEST))

from threejs_to_figma import convert as scene_to_figma_bundle  # type: ignore  # noqa: E402


@dataclass
class PlaceResult:
    pack_id: str
    kind: str
    name: str
    mode: str
    engine: str
    import_dir: str
    export_paths: dict[str, str]


def place(
    pack_id: str,
    kind: str,
    name: str,
    mode: str = "engine",
    engine: str = "threejs",
    game_dir: Path | None = None,
) -> PlaceResult:
    if mode not in ("figma", "engine"):
        raise ValueError(f"mode must be 'figma' or 'engine', got {mode!r}")
    if mode == "engine" and engine not in ("threejs", "godot"):
        raise ValueError(f"engine must be 'threejs' or 'godot', got {engine!r}")
    if kind not in ("screen", "component"):
        raise ValueError(f"kind must be 'screen' or 'component', got {kind!r}")

    entry = catalog.find(pack_id)
    if entry is None:
        raise KeyError(f"no pack with id={pack_id!r} in catalog")

    game_dir = Path(game_dir or Path.cwd()).resolve()
    _license_guard(entry, game_dir)

    pack_dir = config.library_root() / entry["path"]
    canonical_path = pack_dir / "canonical" / f"{kind}s" / f"{name}.json"
    if not canonical_path.exists():
        raise FileNotFoundError(
            f"canonical not found: {canonical_path} "
            f"(pack has {entry.get('screen_count', 0)} screens, {entry.get('component_count', 0)} components)"
        )

    scene = json.loads(canonical_path.read_text(encoding="utf-8"))

    import_dir = game_dir / ".artgen" / "packs_imports" / entry["slug"] / name
    import_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = import_dir / "assets"
    assets_dir.mkdir(exist_ok=True)

    # Copy assets + rewrite paths in the canonical
    local_scene = _copy_assets_and_rewrite(scene, pack_dir, import_dir)
    (import_dir / "canonical.json").write_text(
        json.dumps(local_scene, indent=2), encoding="utf-8",
    )
    (import_dir / "adaptation.json").write_text(
        json.dumps({"applied": [], "version": 1}, indent=2), encoding="utf-8",
    )

    exports: dict[str, str] = {}
    exports_dir = import_dir / "exports"

    if mode == "figma":
        inlined = _inline_data_urls(local_scene, import_dir)
        bundle = scene_to_figma_bundle(inlined, entry["slug"])
        out_dir = exports_dir / "figma"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{name}_bundle.json"
        out_path.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
        exports["figma"] = str(out_path)
    elif engine == "threejs":
        out_dir = exports_dir / "threejs"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{name}.json"
        # three.js loader can consume either data_url or path; we keep path so
        # the host loader serves images off disk.
        out_path.write_text(json.dumps(local_scene, indent=2), encoding="utf-8")
        exports["threejs"] = str(out_path)
    elif engine == "godot":
        out_dir = exports_dir / "godot"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{name}.tscn"
        try:
            res_prefix = f"res://{out_path.parent.relative_to(game_dir).as_posix()}"
        except ValueError:
            res_prefix = "res://"
        canonical_to_godot.emit(local_scene, import_dir, out_path, res_prefix)
        exports["godot"] = str(out_path)

    return PlaceResult(
        pack_id=pack_id,
        kind=kind,
        name=name,
        mode=mode,
        engine=engine,
        import_dir=str(import_dir),
        export_paths=exports,
    )


# ---------- helpers ----------


def _license_guard(entry: dict, game_dir: Path) -> None:
    """Refuse placement if the pack's license doesn't allow this game's scope."""
    allowed: list[str] = (entry.get("license") or {}).get("allowed_in") or []
    if "*" in allowed:
        return
    project_json = game_dir / ".artgen" / "project.json"
    scope = "director_games"
    if project_json.exists():
        try:
            project_meta = json.loads(project_json.read_text(encoding="utf-8"))
            scope = project_meta.get("scope", scope)
        except Exception:
            pass
    if scope not in allowed:
        raise PermissionError(
            f"pack {entry['id']!r} is licensed for {allowed}; this game's scope is {scope!r}. "
            f"Set scope in {project_json} to a matching value, or pick a pack with allowed_in=['*']."
        )


def _copy_assets_and_rewrite(scene: dict, pack_dir: Path, import_dir: Path) -> dict:
    """Copy referenced images from <pack>/assets/images/ into
    <import>/assets/ (sha1 names preserved) and rewrite image.path accordingly."""
    out: dict[str, Any] = {"metadata": dict(scene.get("metadata") or {}), "objects": []}
    out["metadata"].setdefault("source", {})
    for obj in scene.get("objects") or []:
        o = _deep_copy(obj)
        img = o.get("image")
        if img and img.get("path"):
            rel = img["path"]
            src = pack_dir / rel
            if src.is_file():
                sha_file = Path(rel).name
                dst = import_dir / "assets" / sha_file
                if not dst.exists():
                    shutil.copy2(src, dst)
                img["path"] = f"assets/{sha_file}"
        out["objects"].append(o)
    return out


def _inline_data_urls(scene: dict, import_dir: Path) -> dict:
    """Materialise image.data_url from image.path (for exporters that don't
    read from disk, like threejs_to_figma)."""
    out: dict[str, Any] = {"metadata": dict(scene.get("metadata") or {}), "objects": []}
    for obj in scene.get("objects") or []:
        o = _deep_copy(obj)
        img = o.get("image") or {}
        if img.get("path") and not img.get("data_url"):
            abs_path = (import_dir / img["path"]).resolve()
            if abs_path.is_file():
                img["data_url"] = "data:image/png;base64," + base64.b64encode(
                    abs_path.read_bytes()
                ).decode("ascii")
        out["objects"].append(o)
    return out


def _deep_copy(d: Any) -> Any:
    return json.loads(json.dumps(d))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pack_id")
    ap.add_argument("kind", choices=("screen", "component"))
    ap.add_argument("name")
    ap.add_argument("--mode", choices=("figma", "engine"), default="engine")
    ap.add_argument("--engine", choices=("threejs", "godot"), default="threejs")
    ap.add_argument("--game-dir", type=Path, default=None)
    args = ap.parse_args()
    result = place(
        args.pack_id, args.kind, args.name,
        mode=args.mode, engine=args.engine, game_dir=args.game_dir,
    )
    print(json.dumps(asdict(result), indent=2))


if __name__ == "__main__":
    main()
