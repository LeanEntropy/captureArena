"""Ingest a Unity UI pack into references/ui_packs/<slug>/.

Usage:
  python tools/ui_pack_ingest/ingest.py <pack_dir> [--slug <slug>] [--screen <name>]

If --screen is given, only that prefab is parsed (fast iteration). Otherwise
every prefab in Prefabs_DemoScene_Panels/ and Prefabs_Component_*/ is ingested.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from layout_solver import solve as solve_layout
from parse_meta import build_guid_index
from parse_prefab import parse_prefab
from rect_math import annotate_abs_rects


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    return _SLUG_RE.sub("_", name.lower()).strip("_")


def ingest(pack_dir: Path, out_root: Path, slug: str | None = None, only_screen: str | None = None) -> dict:
    slug = slug or slugify(pack_dir.name)
    out_dir = out_root / slug
    (out_dir / "screens").mkdir(parents=True, exist_ok=True)
    (out_dir / "components").mkdir(parents=True, exist_ok=True)
    (out_dir / "previews").mkdir(parents=True, exist_ok=True)

    # 1. GUID index
    guid_index = build_guid_index(pack_dir)
    # Attach absolute pack path so downstream tools can resolve sprites without re-ingesting
    (out_dir / "guid_index.json").write_text(
        json.dumps(guid_index, indent=2, sort_keys=True), encoding="utf-8",
    )

    # 2. Copy preview screenshots for ground truth
    preview_src = pack_dir / "Preview"
    preview_count = 0
    if preview_src.is_dir():
        for png in preview_src.glob("*.png"):
            shutil.copy2(png, out_dir / "previews" / png.name)
            preview_count += 1

    # 3. Parse prefabs
    screens_parsed: list[dict] = []
    components_parsed: list[dict] = []
    errors: list[dict] = []

    screen_dirs = [pack_dir / "Prefabs" / "Prefabs_DemoScene_Panels"]
    component_dirs = sorted((pack_dir / "Prefabs").glob("Prefabs_Component_*"))

    for d, bucket, out_sub in [
        *[(sd, screens_parsed, "screens") for sd in screen_dirs],
        *[(cd, components_parsed, "components") for cd in component_dirs],
    ]:
        if not d.is_dir():
            continue
        for prefab in sorted(d.glob("*.prefab")):
            if only_screen and prefab.stem != only_screen:
                continue
            try:
                tree = parse_prefab(prefab, guid_index, pack_dir)
                solve_layout(tree["root"])
                annotate_abs_rects(tree["root"])
                dst = out_dir / out_sub / f"{prefab.stem}.json"
                dst.write_text(json.dumps(tree, indent=2, sort_keys=True), encoding="utf-8")
                bucket.append({
                    "name": prefab.stem,
                    "path": str(prefab),
                    "json": f"{out_sub}/{prefab.stem}.json",
                })
            except Exception as exc:  # surface ingest failures so we iterate the parser, don't hide them
                errors.append({"prefab": str(prefab), "error": f"{type(exc).__name__}: {exc}"})

    # 4. Pack manifest
    manifest = {
        "slug": slug,
        "source_path": str(pack_dir),
        "vendor": _read_vendor(pack_dir),
        "guid_count": len(guid_index),
        "preview_count": preview_count,
        "screens": screens_parsed,
        "components": components_parsed,
        "errors": errors,
    }
    (out_dir / "pack.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8",
    )
    return manifest


def _read_vendor(pack_dir: Path) -> dict:
    # Read AssetOrigin block from any .meta in the pack
    for meta in pack_dir.rglob("*.meta"):
        text = meta.read_text(encoding="utf-8", errors="ignore")
        if "AssetOrigin:" not in text:
            continue
        info: dict = {}
        for line in text.splitlines():
            line = line.strip()
            for key in ("productId", "packageName", "packageVersion", "uploadId"):
                if line.startswith(f"{key}:"):
                    info[key] = line.split(":", 1)[1].strip()
        if info:
            return info
    return {}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pack_dir", type=Path)
    ap.add_argument("--slug", default=None)
    ap.add_argument("--screen", default=None)
    ap.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "references" / "ui_packs",
    )
    args = ap.parse_args()
    manifest = ingest(args.pack_dir, args.out, args.slug, args.screen)
    print(json.dumps({
        "slug": manifest["slug"],
        "screens": len(manifest["screens"]),
        "components": len(manifest["components"]),
        "errors": len(manifest["errors"]),
        "previews": manifest["preview_count"],
        "guids": manifest["guid_count"],
    }, indent=2))
    if manifest["errors"]:
        print("\nErrors:")
        for e in manifest["errors"][:10]:
            print(f"  {Path(e['prefab']).name}: {e['error']}")


if __name__ == "__main__":
    main()
