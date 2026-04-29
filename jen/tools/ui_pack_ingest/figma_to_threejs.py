"""Pull a Figma file via REST and emit a canonical three.js UI scene JSON.

Schema defined in `threejs_scene.py`. Pixel-based y-down coordinates, so the
Figma node tree maps directly without any coordinate conversion. The three.js
runtime uses an OrthographicCamera that flips y when mounting the scene.

Usage:
  python tools/ui_pack_ingest/figma_to_threejs.py <FIGMA_URL_OR_KEY> \
      [--out <scene.json>] [--node <nodeId>] [--frames <name1> <name2> ...]

Requires FIGMA_PAT in .env.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from figma_to_godot import (
    _collect_frames,
    _collect_image_refs,
    _fetch_file,
    _fetch_image_refs,
    _http_get,
    _load_token,
    parse_figma_url,
)


REPO = Path(__file__).resolve().parents[2]


def _rgba_from_fill(fill: dict) -> list[float] | None:
    if fill.get("type") != "SOLID":
        return None
    c = fill.get("color") or {}
    a = fill.get("opacity", c.get("a", 1.0))
    return [c.get("r", 1), c.get("g", 1), c.get("b", 1), a]


def _rgba_from_color_dict(c: dict, fallback_a: float = 1.0) -> list[float]:
    if not c:
        return [0, 0, 0, fallback_a]
    return [c.get("r", 0), c.get("g", 0), c.get("b", 0), c.get("a", fallback_a)]


def _text_from_node(node: dict) -> dict:
    style = node.get("style") or {}
    fills = node.get("fills") or []
    primary = next((f for f in fills if f.get("type") == "SOLID" and f.get("visible", True)), None)
    color = _rgba_from_fill(primary) if primary else [1, 1, 1, 1]

    strokes = node.get("strokes") or []
    stroke_w = node.get("strokeWeight") or 0
    outline_px = int(stroke_w) if strokes and stroke_w else 0
    outline_color = _rgba_from_fill(strokes[0]) if strokes else [0, 0, 0, 1]

    shadow_offset = [0, 0]
    shadow_color = [0, 0, 0, 0.5]
    for eff in node.get("effects") or []:
        if eff.get("type") == "DROP_SHADOW" and eff.get("visible", True):
            off = eff.get("offset") or {}
            shadow_offset = [int(off.get("x", 0)), int(off.get("y", 0))]
            shadow_color = _rgba_from_color_dict(eff.get("color"), fallback_a=0.5)
            break

    return {
        "characters": node.get("characters", ""),
        "family": (style.get("fontFamily") or "Inter"),
        "size": int(style.get("fontSize") or 36),
        "color": color,
        "align_h": (style.get("textAlignHorizontal") or "LEFT").upper(),
        "align_v": (style.get("textAlignVertical") or "TOP").upper(),
        "outline_px": outline_px,
        "outline_color": outline_color,
        "shadow_offset": shadow_offset,
        "shadow_color": shadow_color,
    }


def _walk(node: dict, frame_origin: tuple[float, float], images_b64: dict[str, str],
          out: list[dict], parent_id: str = "") -> None:
    box = node.get("absoluteBoundingBox") or {"x": frame_origin[0], "y": frame_origin[1], "width": 0, "height": 0}
    x = box["x"] - frame_origin[0]
    y = box["y"] - frame_origin[1]
    w = box["width"]
    h = box["height"]
    rotation = node.get("rotation") or 0
    rotation_deg = -float(rotation) * 180.0 / 3.14159265 if rotation else 0.0
    opacity = node.get("opacity", 1.0)

    typ = node.get("type")
    fills = node.get("fills") or []
    image_fill = next((f for f in fills if f.get("type") == "IMAGE" and f.get("visible", True)), None)
    solid_fill = next((f for f in fills if f.get("type") == "SOLID" and f.get("visible", True)), None)

    node_id = node.get("id") or f"{parent_id}/{node.get('name','?')}"

    if typ == "TEXT":
        out.append({
            "id": node_id, "name": node.get("name", "?"), "kind": "text",
            "rect": {"x": x, "y": y, "w": w, "h": h},
            "rotation_deg": rotation_deg, "opacity": opacity,
            "text": _text_from_node(node),
        })
    elif image_fill and image_fill.get("imageRef") in images_b64:
        ref = image_fill["imageRef"]
        tint = image_fill.get("color")
        out.append({
            "id": node_id, "name": node.get("name", "?"), "kind": "image",
            "rect": {"x": x, "y": y, "w": w, "h": h},
            "rotation_deg": rotation_deg, "opacity": opacity,
            "image": {
                "data_url": f"data:image/png;base64,{images_b64[ref]}",
                "tint": _rgba_from_color_dict(tint) if tint else None,
            },
        })
    elif solid_fill:
        out.append({
            "id": node_id, "name": node.get("name", "?"), "kind": "image",
            "rect": {"x": x, "y": y, "w": w, "h": h},
            "rotation_deg": rotation_deg, "opacity": opacity,
            "image": {"data_url": None, "tint": _rgba_from_fill(solid_fill)},
        })
    elif typ in ("FRAME", "GROUP", "COMPONENT", "INSTANCE"):
        out.append({
            "id": node_id, "name": node.get("name", "?"), "kind": "group",
            "rect": {"x": x, "y": y, "w": w, "h": h},
            "rotation_deg": rotation_deg, "opacity": opacity,
        })
    else:
        # Skip unknown types but still recurse into their children
        pass

    for c in node.get("children") or []:
        _walk(c, frame_origin, images_b64, out, node_id)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("figma")
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--node", default=None)
    ap.add_argument("--frames", nargs="*", default=None)
    args = ap.parse_args()

    token = _load_token()
    file_key, node_id_from_url = parse_figma_url(args.figma)
    node_id = args.node or node_id_from_url

    print(f"Fetching Figma file {file_key}" + (f" (node {node_id})" if node_id else ""))
    file_data = _fetch_file(file_key, node_id, token)
    image_ref_to_url = _fetch_image_refs(file_key, token)

    frames = _collect_frames(file_data["document"], args.frames)
    if not frames:
        raise SystemExit("No frames found. Pass --frames <name> or a --node URL.")

    # Collect + download image bytes → base64
    refs: set[str] = set()
    for f in frames:
        _collect_image_refs(f, refs)
    images_b64: dict[str, str] = {}
    for ref in sorted(refs):
        url = image_ref_to_url.get(ref)
        if not url:
            continue
        data = _http_get(url, token, as_bytes=True)
        images_b64[ref] = base64.b64encode(data).decode("ascii")
    print(f"Embedded {len(images_b64)}/{len(refs)} images as data URLs")

    # First frame = primary scene; subsequent frames get appended but positioned via offset
    primary = frames[0]
    pbox = primary.get("absoluteBoundingBox") or {"x": 0, "y": 0, "width": 0, "height": 0}
    origin = (pbox["x"], pbox["y"])
    canvas = [int(round(pbox["width"])), int(round(pbox["height"]))]

    objects: list[dict] = []
    for frame in frames:
        _walk(frame, origin, images_b64, objects)

    scene = {
        "metadata": {
            "generator": "ui-pack-ingest figma_to_threejs",
            "version": 1,
            "canvas": canvas,
            "name": file_data.get("name", "scene"),
        },
        "objects": objects,
    }

    out = args.out or (REPO / "experiments" / "ui_pack_validation" / "threejs_scenes"
                       / f"{file_key}_scene.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(scene), encoding="utf-8")
    print(f"wrote {out}")
    print(f"  canvas: {canvas[0]}x{canvas[1]}")
    print(f"  objects: {len(objects)}")
    print(f"  images:  {len(images_b64)}")
    print(f"  size:    {out.stat().st_size / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
