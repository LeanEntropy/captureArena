"""Compose rendered vs preview + diff heatmap; emit metric JSON."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageOps


def _label(im: Image.Image, text: str) -> Image.Image:
    from PIL import ImageDraw, ImageFont
    try:
        font = ImageFont.truetype("arial.ttf", size=48)
    except OSError:
        font = ImageFont.load_default()
    out = im.copy()
    draw = ImageDraw.Draw(out)
    pad = 20
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.rectangle((pad - 5, pad - 5, pad + tw + 5, pad + th + 10), fill=(0, 0, 0, 180))
    draw.text((pad, pad), text, font=font, fill=(255, 255, 255))
    return out


def diff(rendered_path: Path, preview_path: Path, out_dir: Path) -> dict:
    rendered_rgba = Image.open(rendered_path).convert("RGBA")
    preview = Image.open(preview_path).convert("RGB")
    if rendered_rgba.size != preview.size:
        preview = preview.resize(rendered_rgba.size, Image.BILINEAR)

    # Composite rendered over preview to compare painted pixels only
    alpha = rendered_rgba.split()[3]
    painted_pixels = sum(1 for p in alpha.getdata() if p > 0)
    total = rendered_rgba.size[0] * rendered_rgba.size[1]
    painted_pct = 100.0 * painted_pixels / total

    rendered = Image.alpha_composite(preview.convert("RGBA"), rendered_rgba).convert("RGB")

    diff_img = ImageChops.difference(rendered, preview)
    heat = ImageOps.autocontrast(diff_img.convert("L"))
    heat_rgb = Image.merge("RGB", (heat, Image.new("L", heat.size, 0), Image.new("L", heat.size, 0)))

    # Global metrics (full canvas)
    hist = diff_img.convert("L").histogram()
    nonzero = sum(hist[1:])
    weighted = sum(i * c for i, c in enumerate(hist))
    mean_abs = weighted / total
    pct_nonzero = 100.0 * nonzero / total

    # Painted-region metrics (pixels where the prefab actually paints)
    lum = diff_img.convert("L")
    lum_data = lum.getdata()
    alpha_data = alpha.getdata()
    pm_nonzero = 0
    pm_significant = 0   # pixels diff > 32 (~12.5% intensity) — human-noticeable mismatch
    pm_sum = 0
    THRESH = 32
    for lv, av in zip(lum_data, alpha_data):
        if av > 0:
            pm_sum += lv
            if lv > 0:
                pm_nonzero += 1
            if lv > THRESH:
                pm_significant += 1
    pm_mean = pm_sum / painted_pixels if painted_pixels else 0.0
    pm_pct_nonzero = 100.0 * pm_nonzero / painted_pixels if painted_pixels else 0.0
    pm_pct_significant = 100.0 * pm_significant / painted_pixels if painted_pixels else 0.0

    # Composite (3 columns)
    w, h = rendered.size
    strip = Image.new("RGB", (w * 3, h), (20, 20, 20))
    strip.paste(_label(rendered, "rendered"), (0, 0))
    strip.paste(_label(preview, "preview"),   (w, 0))
    strip.paste(_label(heat_rgb, "diff"),      (w * 2, 0))
    out_dir.mkdir(parents=True, exist_ok=True)
    strip_path = out_dir / f"{rendered_path.stem}_diff_strip.png"
    strip.thumbnail((2400, 1200))  # cap display size
    strip.save(strip_path, optimize=True)

    return {
        "mean_abs_diff": mean_abs,
        "pct_pixels_nonzero": pct_nonzero,
        "painted_pct": painted_pct,
        "painted_mean_abs_diff": pm_mean,
        "painted_pct_nonzero": pm_pct_nonzero,
        "painted_pct_significant": pm_pct_significant,
        "canvas_size": rendered.size,
        "strip": strip_path.as_posix(),
    }


if __name__ == "__main__":
    rendered = Path(sys.argv[1])
    preview = Path(sys.argv[2])
    out_dir = Path(sys.argv[3])
    result = diff(rendered, preview, out_dir)
    print(json.dumps(result, indent=2))
