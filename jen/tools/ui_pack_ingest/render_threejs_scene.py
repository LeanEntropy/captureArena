"""Render a canonical UI-pack scene JSON to a PNG via Pillow.

Honours (in order of importance for visual fidelity):
- Image `border_ltrb` / `render_type=sliced` → 9-slice composite via nine_slice.
- Object-level `rotation_deg` → Image.rotate around the rect centre.
- Object-level `clip_rect` → crop before composite (Unity Mask / RectMask2D).
- Text wrapping inside `rect.w` / `rect.h` (word boundaries; overflow dropped).
- Text `font_file` relative to `pack_dir` when provided; else
  `references/fonts/*.ttf` substring match on `family`.

Transparency is preserved — the function returns an RGBA image. The CLI's
`main()` saves as PNG.
"""
from __future__ import annotations

import argparse
import base64
import io
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_SELF_DIR = Path(__file__).resolve().parent
if str(_SELF_DIR) not in sys.path:
    sys.path.insert(0, str(_SELF_DIR))

from nine_slice import nine_slice  # type: ignore  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
_DATA_URL_RE = re.compile(r"^data:image/[^;]+;base64,(.+)$")


def _decode_data_url(url: str | None) -> bytes | None:
    if not url:
        return None
    m = _DATA_URL_RE.match(url)
    if not m:
        return None
    return base64.b64decode(m.group(1))


def _load_image_source(img: dict, pack_dir: Path | None) -> Image.Image | None:
    data = _decode_data_url(img.get("data_url"))
    if data:
        return Image.open(io.BytesIO(data)).convert("RGBA")
    path = img.get("path")
    if path and pack_dir is not None:
        p = pack_dir / path
        if p.is_file():
            return Image.open(p).convert("RGBA")
    return None


def _rgba_tuple(c: list | None, default=(255, 255, 255, 255)) -> tuple[int, int, int, int]:
    if not c:
        return default
    v = [max(0.0, min(1.0, float(x))) for x in (list(c) + [1.0] * 4)[:4]]
    return (int(round(v[0] * 255)), int(round(v[1] * 255)), int(round(v[2] * 255)), int(round(v[3] * 255)))


def _apply_tint(patch: Image.Image, tint: list | None) -> Image.Image:
    if not tint:
        return patch
    r, g, b, a = [max(0.0, min(1.0, float(c))) for c in (list(tint) + [1.0] * 4)[:4]]
    if abs(r - 1) < 0.01 and abs(g - 1) < 0.01 and abs(b - 1) < 0.01 and abs(a - 1) < 0.01:
        return patch
    px = patch.load()
    for y in range(patch.size[1]):
        for x in range(patch.size[0]):
            pr, pg, pb, pa = px[x, y]
            px[x, y] = (int(pr * r), int(pg * g), int(pb * b), int(pa * a))
    return patch


def _load_font(family: str, size: int, font_file: Path | None = None) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if font_file and font_file.is_file():
        try:
            return ImageFont.truetype(str(font_file), size=max(8, int(size)))
        except Exception:
            pass
    candidates: list[Path] = []
    fonts_dir = REPO / "references" / "fonts"
    if fonts_dir.is_dir():
        target = family.lower().replace(" ", "").replace("-", "")
        for p in fonts_dir.glob("*.ttf"):
            stem = p.stem.lower().replace(" ", "").replace("-", "")
            if target in stem:
                candidates.append(p)
        if not candidates:
            candidates.append(fonts_dir / "LilitaOne-Regular.ttf")
    for c in candidates:
        try:
            return ImageFont.truetype(str(c), size=max(8, int(size)))
        except Exception:
            continue
    try:
        return ImageFont.truetype("arial.ttf", size=max(8, int(size)))
    except Exception:
        return ImageFont.load_default()


def _wrap_lines(draw: ImageDraw.ImageDraw, text: str, font, max_w: int) -> list[str]:
    if not text:
        return []
    lines: list[str] = []
    for paragraph in text.splitlines() or [""]:
        if not paragraph.strip():
            lines.append("")
            continue
        words = paragraph.split(" ")
        current = ""
        for word in words:
            probe = word if not current else f"{current} {word}"
            w = draw.textbbox((0, 0), probe, font=font)[2]
            if w <= max_w or not current:
                current = probe
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)
    return lines


def _draw_text(canvas: Image.Image, rect: dict, text_spec: dict, pack_dir: Path | None) -> None:
    chars = str(text_spec.get("characters") or "")
    if not chars.strip():
        return
    w = max(1, int(round(rect["w"])))
    h = max(1, int(round(rect["h"])))
    x = int(round(rect["x"]))
    y = int(round(rect["y"]))

    font_file: Path | None = None
    ff = text_spec.get("font_file")
    if ff and pack_dir is not None:
        p = pack_dir / ff
        if p.is_file():
            font_file = p
    size = int(text_spec.get("size") or 36)
    family = text_spec.get("family") or "Lilita One"
    font = _load_font(family, size, font_file)
    draw = ImageDraw.Draw(canvas)

    outline_px = int(text_spec.get("outline_px") or 0)
    align_h = (text_spec.get("align_h") or "CENTER").upper()
    align_v = (text_spec.get("align_v") or "CENTER").upper()

    lines = _wrap_lines(draw, chars, font, max(1, w - outline_px * 2))
    if not lines:
        return
    line_h = max(1, int(size * 1.2))
    max_lines = max(1, h // line_h)
    lines = lines[:max_lines]

    total_h = line_h * len(lines)
    if align_v == "CENTER":
        block_top = y + (h - total_h) // 2
    elif align_v == "BOTTOM":
        block_top = y + h - total_h
    else:
        block_top = y

    shadow_offset = text_spec.get("shadow_offset") or [0, 0]
    face = _rgba_tuple(text_spec.get("color"))
    stroke = _rgba_tuple(text_spec.get("outline_color"), default=(0, 0, 0, 255)) if outline_px else None
    sc = _rgba_tuple(text_spec.get("shadow_color"), default=(0, 0, 0, 128))

    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font, stroke_width=outline_px)
        tw = bbox[2] - bbox[0]
        ty = block_top + i * line_h - bbox[1]
        if align_h == "CENTER":
            tx = x + (w - tw) // 2 - bbox[0]
        elif align_h == "RIGHT":
            tx = x + w - tw - bbox[0]
        else:
            tx = x - bbox[0]

        if shadow_offset[0] or shadow_offset[1]:
            draw.text((tx + shadow_offset[0], ty + shadow_offset[1]), line, font=font, fill=sc, stroke_width=0)
        draw.text((tx, ty), line, font=font, fill=face, stroke_width=outline_px, stroke_fill=stroke)


def _apply_rotation(patch: Image.Image, deg: float) -> Image.Image:
    if abs(deg) < 0.1:
        return patch
    # Pillow rotates counter-clockwise; canonical rotation_deg is clockwise.
    return patch.rotate(-deg, resample=Image.BILINEAR, expand=True)


def _compose_at(canvas: Image.Image, patch: Image.Image, rect: dict, clip: dict | None) -> None:
    w = max(1, int(round(rect["w"])))
    h = max(1, int(round(rect["h"])))
    x = int(round(rect["x"]))
    y = int(round(rect["y"]))
    if patch.size != (w, h):
        patch = patch.resize((w, h), Image.BILINEAR)
    if clip is None:
        canvas.alpha_composite(patch, (x, y))
        return
    cx = int(round(clip["x"])); cy = int(round(clip["y"]))
    cw = int(round(clip["w"])); ch = int(round(clip["h"]))
    left = max(x, cx); top = max(y, cy)
    right = min(x + w, cx + cw); bottom = min(y + h, cy + ch)
    if right <= left or bottom <= top:
        return
    crop = patch.crop((left - x, top - y, right - x, bottom - y))
    canvas.alpha_composite(crop, (left, top))


def _compose_rotated(
    canvas: Image.Image, patch: Image.Image, rect: dict, rotation_deg: float, clip: dict | None
) -> None:
    if abs(rotation_deg) < 0.1:
        _compose_at(canvas, patch, rect, clip)
        return
    w = max(1, int(round(rect["w"])))
    h = max(1, int(round(rect["h"])))
    cx = int(round(rect["x"])) + w // 2
    cy = int(round(rect["y"])) + h // 2
    if patch.size != (w, h):
        patch = patch.resize((w, h), Image.BILINEAR)
    rotated = _apply_rotation(patch, rotation_deg)
    rx = cx - rotated.size[0] // 2
    ry = cy - rotated.size[1] // 2
    bbox_rect = {"x": rx, "y": ry, "w": rotated.size[0], "h": rotated.size[1]}
    _compose_at(canvas, rotated, bbox_rect, clip)


def render(scene: dict, pack_dir: Path | None = None) -> Image.Image:
    canvas_size = scene.get("metadata", {}).get("canvas") or [2560, 1440]
    W, H = int(canvas_size[0]), int(canvas_size[1])
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    for obj in scene.get("objects") or []:
        kind = obj.get("kind")
        rect = obj.get("rect") or {"x": 0, "y": 0, "w": 0, "h": 0}
        w, h = int(round(rect["w"])), int(round(rect["h"]))
        if w <= 0 or h <= 0:
            continue
        clip = obj.get("clip_rect")
        rotation = float(obj.get("rotation_deg") or 0)

        if kind == "image":
            img = obj.get("image") or {}
            src = _load_image_source(img, pack_dir)
            if src is not None:
                border = img.get("border_ltrb")
                if border and any(float(b) for b in border):
                    patch = nine_slice(src, w, h, [int(b) for b in border])
                else:
                    patch = src.resize((w, h), Image.BILINEAR)
                patch = _apply_tint(patch, img.get("tint"))
                _compose_rotated(canvas, patch, rect, rotation, clip)
            elif img.get("tint"):
                fill = _rgba_tuple(img.get("tint"))
                ov = Image.new("RGBA", (w, h), fill)
                _compose_rotated(canvas, ov, rect, rotation, clip)
        elif kind == "text":
            _draw_text(canvas, rect, obj.get("text") or {}, pack_dir)

    return canvas


def main() -> None:
    import json
    ap = argparse.ArgumentParser()
    ap.add_argument("scene_json", type=Path)
    ap.add_argument("out_png", type=Path)
    ap.add_argument("--pack-dir", type=Path, default=None,
                    help="Pack root for resolving image.path and text.font_file")
    args = ap.parse_args()

    scene = json.loads(args.scene_json.read_text(encoding="utf-8"))
    im = render(scene, pack_dir=args.pack_dir)
    args.out_png.parent.mkdir(parents=True, exist_ok=True)
    im.save(args.out_png, optimize=True)
    print(f"rendered {im.size[0]}x{im.size[1]} -> {args.out_png}")


if __name__ == "__main__":
    main()
