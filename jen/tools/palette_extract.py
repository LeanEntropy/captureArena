#!/usr/bin/env python3
"""
palette_extract.py — extract dominant colors from reference images.

Used by the `concept-moodboard` skill to produce a starting palette for
an art-direction.json. Uses Pillow's median-cut quantizer (no sklearn
dependency) so it runs anywhere Pillow runs.

Output is intended as a STARTING POINT for hand curation, not a final
palette. A pixel-frequency palette is not an art-director palette — always
review and re-name the output before committing to art-direction.json.

Smoke-tested 2026-04-10 on two real project images:
  - experiments/comfyui_terrain_textures/grass_512.png (monochromatic,
    returned 6 near-identical greens as expected)
  - experiments/artgen/images/daily_bonus_figma_export.png (UI screen,
    returned 6 colors with clear role differentiation)
Full validation on 3 classical art references (Japanese woodblock,
Persian miniature, Art Nouveau) is RB-152 (concept-moodboard dry run).

Known deprecation: Pillow 14 (Oct 2027) will remove Image.getdata() in
favor of get_flattened_data(). A ~5-line update will be needed before
then — not urgent.

Usage:
    python tools/palette_extract.py <image_or_dir> [--out PATH] [--colors N]

Examples:
    python tools/palette_extract.py references/projects/myproj/palette_refs/ \\
        --out experiments/myproj/palette_draft.json --colors 6
    python tools/palette_extract.py single_image.jpg --colors 8
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.stderr.write("ERROR: Pillow is required. pip install Pillow\n")
    sys.exit(1)

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".gif"}


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def extract_palette(img_path: Path, n_colors: int = 6) -> list[dict]:
    """Extract n dominant colors from an image using Pillow's median-cut quantizer.

    Returns a list of dicts sorted by pixel frequency (most common first):
        [{"hex": "#a0925e", "rgb": [160, 146, 94], "weight": 0.34}, ...]
    """
    img = Image.open(img_path).convert("RGB")
    # Downscale large refs to keep quantization fast. 512px on longest edge
    # is plenty for palette-intent — more pixels don't produce meaningfully
    # different dominant colors.
    img.thumbnail((512, 512))

    quantized = img.quantize(colors=n_colors, method=Image.Quantize.MEDIANCUT)
    palette_raw = quantized.getpalette()  # flat list: r,g,b,r,g,b,...
    counts = Counter(quantized.getdata())
    total = sum(counts.values()) or 1

    out: list[dict] = []
    for idx, count in counts.most_common(n_colors):
        base = idx * 3
        rgb = (palette_raw[base], palette_raw[base + 1], palette_raw[base + 2])
        out.append({
            "hex": rgb_to_hex(rgb),
            "rgb": list(rgb),
            "weight": round(count / total, 4),
        })
    return out


def aggregate_palettes(per_image: list[dict], n_colors: int) -> list[dict]:
    """Merge per-image palettes into a single weighted aggregate.

    Strategy: bucket all colors into a coarse grid (quantize each channel
    to 32 levels), sum weights per bucket, return top-N. Crude but
    deterministic and dependency-free.
    """
    buckets: Counter = Counter()
    bucket_sample: dict[tuple[int, int, int], tuple[int, int, int]] = {}

    for entry in per_image:
        for color in entry["colors"]:
            r, g, b = color["rgb"]
            key = (r // 32, g // 32, b // 32)
            buckets[key] += color["weight"]
            # Keep the first RGB seen in this bucket as the representative.
            bucket_sample.setdefault(key, (r, g, b))

    total = sum(buckets.values()) or 1
    out: list[dict] = []
    for key, weight in buckets.most_common(n_colors):
        rgb = bucket_sample[key]
        out.append({
            "hex": rgb_to_hex(rgb),
            "rgb": list(rgb),
            "weight": round(weight / total, 4),
        })
    return out


def collect_images(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix.lower() in IMAGE_EXTS else []
    if path.is_dir():
        return sorted(
            p for p in path.rglob("*") if p.suffix.lower() in IMAGE_EXTS
        )
    return []


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract palettes from reference images.")
    ap.add_argument("input", help="Image file or directory of images")
    ap.add_argument("--out", help="Write JSON to this path (default: stdout)")
    ap.add_argument("--colors", type=int, default=6, help="Colors per palette (default 6)")
    args = ap.parse_args()

    in_path = Path(args.input)
    images = collect_images(in_path)
    if not images:
        sys.stderr.write(f"ERROR: no images found at {in_path}\n")
        return 1

    per_image: list[dict] = []
    for img_path in images:
        try:
            colors = extract_palette(img_path, n_colors=args.colors)
            per_image.append({"image": str(img_path), "colors": colors})
            print(f"[V] {img_path.name}: {', '.join(c['hex'] for c in colors)}",
                  file=sys.stderr)
        except Exception as exc:  # noqa: BLE001 — CLI tool, report and continue
            print(f"[X] {img_path.name}: {exc}", file=sys.stderr)

    result = {
        "input": str(in_path),
        "image_count": len(per_image),
        "colors_per_image": args.colors,
        "per_image": per_image,
        "aggregate": aggregate_palettes(per_image, args.colors) if len(per_image) > 1 else None,
        "note": "This is a pixel-frequency palette. Curate by hand before committing to art-direction.json.",
    }

    out_text = json.dumps(result, indent=2)
    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(out_text, encoding="utf-8")
        print(f"[V] wrote {out_path}", file=sys.stderr)
    else:
        print(out_text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
