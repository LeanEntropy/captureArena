"""Generate pack + screen thumbnails for the library browser.

Strategy (cheap first, accurate fallback):
1. If the adapter copied a bundled preview PNG into thumbnails/screens/<name>.png
   during ingest, we use it as-is (resized to 640-wide max).
2. Otherwise render the canonical scene JSON via the Pillow renderer
   (tools.ui_pack_ingest.render_threejs_scene) with image.path → data_url
   inlining, and save as the thumbnail.
3. The pack thumbnail is a 256x256 crop of the first available screen thumbnail.

Both steps 1 and 2 run after the adapter has finished producing canonical JSON
and assets, so they're engine-neutral.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

_UI_PACK_INGEST = Path(__file__).resolve().parents[1] / "ui_pack_ingest"
if str(_UI_PACK_INGEST) not in sys.path:
    sys.path.insert(0, str(_UI_PACK_INGEST))

from render_threejs_scene import render as render_scene  # type: ignore  # noqa: E402

_THUMB_MAX_W = 640
_PACK_SIZE = 256


def generate_thumbnails(pack_dir: Path) -> dict:
    """Generate pack.png + per-screen + per-component thumbnails. Returns a
    summary dict with counts and the path to the pack thumbnail."""
    thumbs_root = pack_dir / "thumbnails"
    thumbs_root.mkdir(parents=True, exist_ok=True)

    screens_out = _generate_for_kind(pack_dir, "screens")
    components_out = _generate_for_kind(pack_dir, "components")

    # Pack thumbnail: first available screen, else first component, else blank.
    pack_thumb = thumbs_root / "pack.png"
    candidates = list((thumbs_root / "screens").glob("*.png")) + list(
        (thumbs_root / "components").glob("*.png")
    )
    if candidates:
        _make_square_thumbnail(candidates[0], pack_thumb, _PACK_SIZE)
    else:
        Image.new("RGBA", (_PACK_SIZE, _PACK_SIZE), (24, 30, 45, 255)).save(pack_thumb)

    return {
        "pack_thumbnail": "thumbnails/pack.png",
        "screens": screens_out,
        "components": components_out,
    }


def _generate_for_kind(pack_dir: Path, kind: str) -> int:
    """Ensure every canonical scene in canonical/<kind>/ has a thumbnail.
    Reuses bundled preview PNGs when present."""
    canonical_dir = pack_dir / "canonical" / kind
    thumbs_dir = pack_dir / "thumbnails" / kind
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    if not canonical_dir.is_dir():
        return 0
    count = 0
    for scene_json in sorted(canonical_dir.glob("*.json")):
        name = scene_json.stem
        out_png = thumbs_dir / f"{name}.png"
        if out_png.exists():
            # Bundled preview was copied by the adapter — just cap width.
            _cap_width(out_png, _THUMB_MAX_W)
            count += 1
            continue
        try:
            scene = json.loads(scene_json.read_text(encoding="utf-8"))
            img = render_scene(scene, pack_dir=pack_dir)
            img = _resize_keep_aspect(img, _THUMB_MAX_W)
            img.save(out_png, optimize=True)
            count += 1
        except Exception as exc:
            _write_error_placeholder(out_png, f"{name}\n{type(exc).__name__}")
    return count


def _resize_keep_aspect(img: Image.Image, max_w: int) -> Image.Image:
    if img.width <= max_w:
        return img
    ratio = max_w / img.width
    new_h = max(1, int(round(img.height * ratio)))
    return img.resize((max_w, new_h), Image.LANCZOS)


def _cap_width(path: Path, max_w: int) -> None:
    with Image.open(path) as im:
        if im.width <= max_w:
            return
        out = _resize_keep_aspect(im.convert("RGBA"), max_w)
        out.save(path, optimize=True)


def _make_square_thumbnail(src: Path, dst: Path, side: int) -> None:
    with Image.open(src) as im:
        im = im.convert("RGBA")
        w, h = im.size
        # Center-crop to square, then resize
        s = min(w, h)
        left = (w - s) // 2
        top = (h - s) // 2
        cropped = im.crop((left, top, left + s, top + s))
        cropped.resize((side, side), Image.LANCZOS).save(dst, optimize=True)


def _write_error_placeholder(dst: Path, text: str) -> None:
    img = Image.new("RGBA", (_THUMB_MAX_W, _THUMB_MAX_W // 2), (40, 10, 10, 255))
    img.save(dst, optimize=True)
    # Could draw text with PIL.ImageDraw, but a blank red rectangle is enough
    # signal that this scene failed to render.
    _ = text


if __name__ == "__main__":
    import sys as _sys
    target = Path(_sys.argv[1])
    print(json.dumps(generate_thumbnails(target), indent=2))
