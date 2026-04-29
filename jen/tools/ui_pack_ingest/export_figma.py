"""Export parsed screens to a Figma-plugin bundle JSON.

The Figma plugin (`tools/ui_pack_figma_plugin/`) reads this bundle and creates a
page per pack, a frame per screen, rectangles + text nodes with sprite/font
fidelity preserved.

Design:
  - Flatten each screen tree into a depth-first list of drawables; Figma frames
    are flat — children are positioned by absolute canvas coords, not nested.
  - Pre-bake 9-slice images to their target display sizes (Figma has no native
    9-slice). Dedupe baked images by (sprite_path, target_w, target_h).
  - Embed baked PNGs as base64 in the JSON so the plugin receives a single file.

Output: experiments/ui_pack_validation/figma_bundles/<slug>_bundle.json
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))

from nine_slice import nine_slice
from tmp_text import parse_segments, strip_tags


REPO = Path(__file__).resolve().parents[2]


def _bake_sprite(pack_dir: Path, sprite: dict, target_w: int, target_h: int, image_type: int) -> bytes | None:
    """Return PNG bytes at exactly (target_w, target_h). Returns None if sprite is missing."""
    path = pack_dir / sprite["path"]
    if not path.is_file():
        return None
    src = Image.open(path).convert("RGBA")
    border = sprite.get("border") or [0, 0, 0, 0]
    tw = max(1, int(target_w))
    th = max(1, int(target_h))
    if image_type == 1 and any(border):
        baked = nine_slice(src, tw, th, border)
    else:
        baked = src.resize((tw, th), Image.BILINEAR)
    buf = io.BytesIO()
    baked.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _sprite_key(sprite_path: str, w: int, h: int, image_type: int) -> str:
    h_in = hashlib.sha1(f"{sprite_path}|{w}x{h}|{image_type}".encode()).hexdigest()[:16]
    return h_in


def _tint_multiply(png_bytes: bytes, color_rgba: list[float] | None) -> bytes:
    if not color_rgba or tuple(color_rgba[:4]) == (1, 1, 1, 1):
        return png_bytes
    im = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    px = im.load()
    r, g, b, a = [max(0.0, min(1.0, float(c))) for c in (color_rgba + [1.0] * 4)[:4]]
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            pr, pg, pb, pa = px[x, y]
            px[x, y] = (int(pr * r), int(pg * g), int(pb * b), int(pa * a))
    out = io.BytesIO()
    im.save(out, format="PNG", optimize=True)
    return out.getvalue()


# TMP alignment -> Figma enums
def _align_h(flag: int | None) -> str:
    if flag in (2, 32):
        return "CENTER"
    if flag == 4:
        return "RIGHT"
    return "LEFT"


def _align_v(flag: int | None) -> str:
    if flag in (512, 4096, 8192):
        return "CENTER"
    if flag == 1024:
        return "BOTTOM"
    return "TOP"


def _font_family_from_tmp(font_info: dict | None) -> tuple[str, str]:
    """Map TMP font asset path to (family, style). Best-effort; plugin falls back
    to Inter Regular if the name isn't installed."""
    if not font_info:
        return ("Inter", "Regular")
    asset = (font_info.get("path") or "").lower()
    if "lilitaone" in asset:
        return ("Lilita One", "Regular")
    # Extract a best-effort family name from the path
    stem = Path(asset).stem.replace("_", " ").replace("-", " ")
    return (stem.title() or "Inter", "Regular")


def _flatten(node: dict, out: list[dict], inherit_opacity: float = 1.0) -> None:
    """Walk the tree, emit one entry per drawable component."""
    if not node.get("active", True):
        return
    rect = node.get("abs_rect") or {}
    opacity = inherit_opacity
    # CanvasGroup alpha
    for comp in node.get("components", []):
        if comp.get("type") == "CanvasGroup":
            opacity *= float(comp.get("alpha", 1.0))
    rt = node.get("rect") or {}
    rotation_z = rt.get("rotation_z") or 0

    for comp in node.get("components", []):
        t = comp.get("type")
        if t in ("Image", "RawImage"):
            out.append({
                "kind": "image",
                "id": node["id"],
                "name": node.get("name", "node"),
                "rect": rect,
                "rotation_deg": -rotation_z,  # Unity Z-up -> Figma clockwise
                "opacity": opacity,
                "comp": comp,
            })
        elif t in ("Text", "TextMeshProUGUI"):
            raw = comp.get("text")
            text = str(raw) if raw is not None else ""
            if text.strip():
                out.append({
                    "kind": "text",
                    "id": node["id"],
                    "name": node.get("name", "text"),
                    "rect": rect,
                    "rotation_deg": -rotation_z,
                    "opacity": opacity,
                    "comp": comp,
                })
    for child in node.get("children", []):
        _flatten(child, out, opacity)


def build_bundle(slug: str, pack_dir: Path, screen_names: list[str] | None = None) -> dict:
    pack_out = REPO / "references" / "ui_packs" / slug
    screens_dir = pack_out / "screens"
    if not screens_dir.is_dir():
        raise FileNotFoundError(f"pack not ingested: {screens_dir} does not exist")

    images: dict[str, str] = {}  # key -> base64
    screens_out: list[dict] = []

    for screen_json in sorted(screens_dir.glob("*.json")):
        if screen_names and screen_json.stem not in screen_names:
            continue
        tree = json.loads(screen_json.read_text(encoding="utf-8"))
        root = tree["root"]
        canvas_w = int(root["abs_rect"]["w"])
        canvas_h = int(root["abs_rect"]["h"])

        flat: list[dict] = []
        _flatten(root, flat)

        nodes_out: list[dict] = []
        for entry in flat:
            rect = entry["rect"]
            comp = entry["comp"]
            w = max(1, int(round(rect["w"])))
            h = max(1, int(round(rect["h"])))

            if entry["kind"] == "image":
                sprite = comp.get("sprite") or comp.get("texture")
                if not sprite or sprite.get("missing") or not sprite.get("path"):
                    # Draw a transparent placeholder rect with optional tint color
                    nodes_out.append({
                        "id": entry["id"],
                        "name": entry["name"],
                        "type": "image",
                        "rect": {"x": int(round(rect["x"])), "y": int(round(rect["y"])), "w": w, "h": h},
                        "rotation_deg": entry["rotation_deg"],
                        "opacity": entry["opacity"],
                        "image_key": None,
                        "color_rgba": comp.get("color"),
                    })
                    continue
                image_type = comp.get("image_type", 0)
                key = _sprite_key(sprite["path"], w, h, image_type)
                color = comp.get("color")
                if color and tuple(color[:4]) != (1, 1, 1, 1):
                    # Tinted instance gets its own bake
                    tint_tag = hashlib.sha1(",".join(str(round(c, 3)) for c in color).encode()).hexdigest()[:6]
                    key = f"{key}_t{tint_tag}"
                if key not in images:
                    png = _bake_sprite(pack_dir, sprite, w, h, image_type)
                    if png is None:
                        nodes_out.append({
                            "id": entry["id"], "name": entry["name"], "type": "image",
                            "rect": {"x": int(round(rect["x"])), "y": int(round(rect["y"])), "w": w, "h": h},
                            "rotation_deg": entry["rotation_deg"], "opacity": entry["opacity"],
                            "image_key": None,
                        })
                        continue
                    if color and tuple(color[:4]) != (1, 1, 1, 1):
                        png = _tint_multiply(png, color)
                    images[key] = base64.b64encode(png).decode("ascii")
                nodes_out.append({
                    "id": entry["id"],
                    "name": entry["name"],
                    "type": "image",
                    "rect": {"x": int(round(rect["x"])), "y": int(round(rect["y"])), "w": w, "h": h},
                    "rotation_deg": entry["rotation_deg"],
                    "opacity": entry["opacity"],
                    "image_key": key,
                })

            elif entry["kind"] == "text":
                family, style = _font_family_from_tmp(comp.get("font"))
                outline_w = float(comp.get("outline_width") or 0)
                font_size = int(comp.get("font_size") or 36)
                outline_px = max(2, int(round(outline_w * max(4, int(font_size * 0.08))))) if outline_w > 0 else 0
                # TMP "Outline" SDF font atlases bake the outline into the material, so
                # the component's m_outlineWidth stays 0 even though rendered text has
                # a black contour. Detect via font asset path.
                font_path = (comp.get("font") or {}).get("path", "").lower() if isinstance(comp.get("font"), dict) else ""
                if outline_px == 0 and "outline" in font_path:
                    outline_px = max(2, int(round(font_size * 0.09)))
                nodes_out.append({
                    "id": entry["id"],
                    "name": entry["name"],
                    "type": "text",
                    "rect": {"x": int(round(rect["x"])), "y": int(round(rect["y"])), "w": w, "h": h},
                    "rotation_deg": entry["rotation_deg"],
                    "opacity": entry["opacity"],
                    "text": {
                        "characters": strip_tags(str(comp.get("text") or "")),
                        "segments":   parse_segments(str(comp.get("text") or "")),
                        "family": family,
                        "style": style,
                        "size": font_size,
                        "color_rgba": comp.get("face_color") or comp.get("color") or [1, 1, 1, 1],
                        "align_h": _align_h(comp.get("alignment_h")),
                        "align_v": _align_v(comp.get("alignment_v")),
                        "outline_px": outline_px,
                        "outline_rgba": comp.get("outline_color") or [0, 0, 0, 1],
                    },
                })

        screens_out.append({"name": screen_json.stem, "canvas": [canvas_w, canvas_h], "nodes": nodes_out})

    return {"slug": slug, "images": images, "screens": screens_out}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("pack_dir", type=Path)
    ap.add_argument("--screens", nargs="*", default=None)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    bundle = build_bundle(args.slug, args.pack_dir, args.screens)
    out = args.out or (REPO / "experiments" / "ui_pack_validation" / "figma_bundles" / f"{args.slug}_bundle.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle), encoding="utf-8")

    total_bytes = out.stat().st_size
    n_images = len(bundle["images"])
    n_nodes = sum(len(s["nodes"]) for s in bundle["screens"])
    print(f"wrote {out}")
    print(f"  screens: {len(bundle['screens'])}")
    print(f"  nodes:   {n_nodes}")
    print(f"  images:  {n_images}")
    print(f"  size:    {total_bytes / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
