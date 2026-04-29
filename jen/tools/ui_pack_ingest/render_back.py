"""Render a parsed screen JSON back to PNG for preview diffing.

Scope (phase 1):
  - Image: simple, sliced, tiled (treated as stretched), filled (ignored — draws as simple)
  - RawImage: simple
  - TextMeshProUGUI / Text: solid rectangle placeholder + text string using PIL's default font
  - Respects tint color, alpha, active flag, child z-order (document order)

Known gaps (documented, not bugs): TMP rich-text formatting, particle UI, animated
states, custom scripts that mutate rects at runtime.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))

from nine_slice import nine_slice
from tmp_text import strip_tags


# Unity Image.Type enum
_IMAGE_SIMPLE  = 0
_IMAGE_SLICED  = 1
_IMAGE_TILED   = 2
_IMAGE_FILLED  = 3


def _tint(im: Image.Image, color: list[float] | None) -> Image.Image:
    if color is None:
        return im
    r, g, b, a = [max(0.0, min(1.0, float(c))) for c in (color + [1.0] * 4)[:4]]
    if (r, g, b, a) == (1, 1, 1, 1):
        return im
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            pr, pg, pb, pa = px[x, y]
            px[x, y] = (int(pr * r), int(pg * g), int(pb * b), int(pa * a))
    return im


def _load_sprite(pack_dir: Path, sprite_rel: str) -> Image.Image | None:
    path = pack_dir / sprite_rel
    if not path.is_file():
        return None
    return Image.open(path).convert("RGBA")


def _draw_image_component(
    canvas: Image.Image,
    rect: dict,
    comp: dict,
    pack_dir: Path,
) -> None:
    sprite_info = comp.get("sprite") or comp.get("texture")
    if not sprite_info or sprite_info.get("missing"):
        return
    src = _load_sprite(pack_dir, sprite_info["path"])
    if src is None:
        return

    w = max(1, int(round(rect["w"])))
    h = max(1, int(round(rect["h"])))
    if w <= 0 or h <= 0:
        return

    image_type = comp.get("image_type", 0)
    border = sprite_info.get("border") or [0, 0, 0, 0]

    if image_type == _IMAGE_SLICED and any(border):
        patch = nine_slice(src, w, h, border)
    else:
        patch = src.resize((w, h), Image.BILINEAR)

    patch = _tint(patch, comp.get("color"))

    x = int(round(rect["x"]))
    y = int(round(rect["y"]))
    canvas.alpha_composite(patch, (x, y))


_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _pick_font_path(comp: dict, font_map: dict[str, str]) -> str:
    """Map TMP font asset path -> local .ttf. Falls back to LilitaOne."""
    font_info = comp.get("font") or {}
    asset_path = font_info.get("path", "") if isinstance(font_info, dict) else ""
    # Match by family name substring
    lower = asset_path.lower()
    for needle, ttf in font_map.items():
        if needle in lower:
            return ttf
    return font_map.get("__default__", "")


def _load_font(path: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    size = max(8, int(size))
    key = (path, size)
    cached = _FONT_CACHE.get(key)
    if cached is not None:
        return cached
    try:
        font = ImageFont.truetype(path, size=size) if path else ImageFont.load_default()
    except OSError:
        font = ImageFont.load_default()
    _FONT_CACHE[key] = font
    return font


def _tmp_halign(flag: int | None) -> str:
    # TMP HorizontalAlignment flags: 1=Left 2=Center 4=Right 8=Justified 16=Flush 32=GeoCenter
    if flag in (2, 32):
        return "center"
    if flag == 4:
        return "right"
    return "left"


def _tmp_valign(flag: int | None) -> str:
    # TMP VerticalAlignment flags: 256=Top 512=Middle 1024=Bottom 2048=Baseline 4096=Geometry 8192=Capline
    if flag in (512, 4096, 8192):
        return "middle"
    if flag == 1024:
        return "bottom"
    return "top"


def _rgba_to_fill(color_rgba: list[float] | None, default: tuple[int, int, int, int] = (255, 255, 255, 255)) -> tuple[int, int, int, int]:
    if not color_rgba:
        return default
    vals = [max(0, min(255, int(round(c * 255)))) for c in (color_rgba + [1.0] * 4)[:4]]
    return (vals[0], vals[1], vals[2], vals[3])


def _draw_text_component(canvas: Image.Image, rect: dict, comp: dict, font_map: dict[str, str]) -> None:
    raw = comp.get("text")
    text = strip_tags(str(raw)).strip() if raw is not None else ""
    if not text:
        return
    w = max(1, int(round(rect["w"])))
    h = max(1, int(round(rect["h"])))
    x = int(round(rect["x"]))
    y = int(round(rect["y"]))

    face = _rgba_to_fill(comp.get("face_color") or comp.get("color"))
    outline_rgba = comp.get("outline_color")
    outline_width = float(comp.get("outline_width") or 0)
    # TMP outline_width is 0-1 normalized; visible outline ~1.5-4 px at typical font sizes
    stroke_px = int(round(outline_width * max(4, int(comp.get("font_size", 36) * 0.08)))) if outline_width > 0 else 0
    stroke_fill = _rgba_to_fill(outline_rgba, default=(0, 0, 0, 255)) if stroke_px else None

    font_path = _pick_font_path(comp, font_map)
    font = _load_font(font_path, comp.get("font_size", 36))

    draw = ImageDraw.Draw(canvas)
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_px)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    halign = _tmp_halign(comp.get("alignment_h"))
    valign = _tmp_valign(comp.get("alignment_v"))

    if halign == "center":
        tx = x + (w - tw) // 2 - bbox[0]
    elif halign == "right":
        tx = x + w - tw - bbox[0]
    else:
        tx = x - bbox[0]

    if valign == "middle":
        ty = y + (h - th) // 2 - bbox[1]
    elif valign == "bottom":
        ty = y + h - th - bbox[1]
    else:
        ty = y - bbox[1]

    draw.text((tx, ty), text, font=font, fill=face, stroke_width=stroke_px, stroke_fill=stroke_fill)


def _render_node(canvas: Image.Image, node: dict, pack_dir: Path, font_map: dict[str, str]) -> None:
    if not node.get("active", True):
        return
    rect = node.get("abs_rect")
    if rect is None:
        return

    # Self paints first, then children on top (Unity document order = draw order)
    for comp in node.get("components", []):
        t = comp.get("type")
        if t in ("Image", "RawImage"):
            _draw_image_component(canvas, rect, comp, pack_dir)
        elif t in ("TextMeshProUGUI", "Text"):
            _draw_text_component(canvas, rect, comp, font_map)
        # Mask, ScrollRect, Button, Canvas, LayoutGroup, etc. are layout-only

    for child in node.get("children", []):
        _render_node(canvas, child, pack_dir, font_map)


DEFAULT_FONT_MAP = {
    "lilitaone": "references/fonts/LilitaOne-Regular.ttf",
    "__default__": "references/fonts/LilitaOne-Regular.ttf",
}


def render_screen(screen_json: Path, pack_dir: Path, out_png: Path, font_map: dict[str, str] | None = None) -> tuple[int, int]:
    tree = json.loads(screen_json.read_text(encoding="utf-8"))
    root = tree["root"]
    rect = root["abs_rect"]
    w = max(1, int(round(rect["w"])))
    h = max(1, int(round(rect["h"])))
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    _render_node(canvas, root, pack_dir, font_map or DEFAULT_FONT_MAP)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_png, optimize=True)  # keep alpha so validator can mask by painted region
    return w, h


if __name__ == "__main__":
    screen_json = Path(sys.argv[1])
    pack_dir = Path(sys.argv[2])
    out_png = Path(sys.argv[3])
    size = render_screen(screen_json, pack_dir, out_png)
    print(f"rendered {size[0]}x{size[1]} -> {out_png}")
