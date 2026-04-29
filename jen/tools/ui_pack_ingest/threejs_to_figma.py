"""Read a three.js UI scene JSON (the canonical format defined in
`threejs_scene.py`) and emit a Figma-plugin bundle JSON.

The existing `UI Pack Importer` Figma plugin accepts the output unchanged, so
Godot-origin, Unity-origin, and now three.js-origin imports all share one plugin.

Usage:
  python tools/ui_pack_ingest/threejs_to_figma.py <scene.json> \
      [--slug <slug>] [--out <bundle.json>]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]


_DATA_URL_RE = re.compile(r"^data:image/[^;]+;base64,(.+)$")


def _extract_base64(data_url: str | None) -> str | None:
    if not data_url:
        return None
    m = _DATA_URL_RE.match(data_url)
    return m.group(1) if m else None


def _tmp_alignment(v: str | None, kind: str) -> str:
    if not v:
        return "CENTER" if kind == "h" else "CENTER"
    v = v.upper()
    if v in ("LEFT", "RIGHT", "CENTER", "TOP", "BOTTOM"):
        return v
    return "CENTER"


def convert(scene: dict, slug: str) -> dict:
    canvas = scene.get("metadata", {}).get("canvas") or [0, 0]
    images: dict[str, str] = {}
    nodes: list[dict] = []

    def walk_obj(obj: dict) -> None:
        rect = obj.get("rect") or {"x": 0, "y": 0, "w": 0, "h": 0}
        kind = obj.get("kind")
        name = obj.get("name", "node")
        rotation_deg = float(obj.get("rotation_deg") or 0)
        opacity = float(obj.get("opacity", 1.0))

        if kind == "image":
            img = obj.get("image") or {}
            b64 = _extract_base64(img.get("data_url"))
            image_key = None
            color_rgba = img.get("tint")
            if b64:
                key = hashlib.sha1(b64.encode("ascii")).hexdigest()[:16]
                if key not in images:
                    images[key] = b64
                image_key = key
            nodes.append({
                "id": obj.get("id", name),
                "name": name,
                "type": "image",
                "rect": {"x": int(round(rect["x"])), "y": int(round(rect["y"])),
                          "w": int(round(rect["w"])), "h": int(round(rect["h"]))},
                "rotation_deg": rotation_deg,
                "opacity": opacity,
                "image_key": image_key,
                "color_rgba": color_rgba,
            })
        elif kind == "text":
            t = obj.get("text") or {}
            chars = str(t.get("characters") or "")
            nodes.append({
                "id": obj.get("id", name),
                "name": name,
                "type": "text",
                "rect": {"x": int(round(rect["x"])), "y": int(round(rect["y"])),
                          "w": int(round(rect["w"])), "h": int(round(rect["h"]))},
                "rotation_deg": rotation_deg,
                "opacity": opacity,
                "text": {
                    "characters": chars,
                    "segments": [{"chars": chars, "color": None, "size": None, "bold": False, "italic": False}],
                    "family": t.get("family") or "Inter",
                    "style": "Regular",
                    "size": int(t.get("size") or 36),
                    "color_rgba": t.get("color") or [1, 1, 1, 1],
                    "align_h": _tmp_alignment(t.get("align_h"), "h"),
                    "align_v": _tmp_alignment(t.get("align_v"), "v"),
                    "outline_px": int(t.get("outline_px") or 0),
                    "outline_rgba": t.get("outline_color") or [0, 0, 0, 1],
                    "shadow_offset": t.get("shadow_offset") or [0, 0],
                    "shadow_rgba": t.get("shadow_color") or [0, 0, 0, 0.5],
                },
            })
        elif kind == "group":
            nodes.append({
                "id": obj.get("id", name),
                "name": name,
                "type": "frame",
                "rect": {"x": int(round(rect["x"])), "y": int(round(rect["y"])),
                          "w": int(round(rect["w"])), "h": int(round(rect["h"]))},
                "rotation_deg": rotation_deg,
                "opacity": opacity,
            })

        for c in obj.get("children") or []:
            walk_obj(c)

    for obj in scene.get("objects") or []:
        walk_obj(obj)

    screen_name = scene.get("metadata", {}).get("name") or slug
    return {
        "slug": slug,
        "images": images,
        "screens": [{"name": screen_name, "canvas": canvas, "nodes": nodes}],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("scene_json", type=Path)
    ap.add_argument("--slug", default="threejs_import")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    scene = json.loads(args.scene_json.read_text(encoding="utf-8"))
    bundle = convert(scene, args.slug)

    out = args.out or (REPO / "experiments" / "ui_pack_validation" / "figma_bundles"
                       / f"{args.slug}_bundle.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle), encoding="utf-8")
    n_nodes = sum(len(s["nodes"]) for s in bundle["screens"])
    print(f"wrote {out}")
    print(f"  screens: {len(bundle['screens'])}")
    print(f"  nodes:   {n_nodes}")
    print(f"  images:  {len(bundle['images'])}")
    print(f"  size:    {out.stat().st_size / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
