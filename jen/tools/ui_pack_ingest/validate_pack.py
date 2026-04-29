"""Batch render every ingested screen that has a matching vendor preview, diff them,
and produce an aggregate fidelity report.

Outputs go under experiments/ui_pack_validation/<slug>/.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from diff_report import diff
from render_back import render_screen


def _collect_text_rects(node: dict, out: list[tuple[int, int, int, int]]) -> None:
    for c in node.get("components", []):
        if c.get("type") in ("Text", "TextMeshProUGUI") and str(c.get("text") or "").strip():
            r = node.get("abs_rect")
            if r:
                out.append((int(r["x"]), int(r["y"]), int(r["x"] + r["w"]), int(r["y"] + r["h"])))
            break
    for ch in node.get("children", []):
        _collect_text_rects(ch, out)


def _text_mask_pct(screen_json: Path, canvas_w: int, canvas_h: int) -> float:
    tree = json.loads(screen_json.read_text(encoding="utf-8"))
    rects: list[tuple[int, int, int, int]] = []
    _collect_text_rects(tree["root"], rects)
    covered = set()
    for x0, y0, x1, y1 in rects:
        x0 = max(0, x0); y0 = max(0, y0)
        x1 = min(canvas_w, x1); y1 = min(canvas_h, y1)
        for y in range(y0, y1):
            for x in range(x0, x1):
                covered.add(y * canvas_w + x)
    return 100.0 * len(covered) / max(1, canvas_w * canvas_h)


def validate(pack_slug: str, pack_dir: Path) -> dict:
    repo = Path(__file__).resolve().parents[2]
    screens_dir = repo / "references" / "ui_packs" / pack_slug / "screens"
    previews_dir = repo / "references" / "ui_packs" / pack_slug / "previews"
    out_dir = repo / "experiments" / "ui_pack_validation" / pack_slug
    (out_dir / "rendered").mkdir(parents=True, exist_ok=True)

    results: list[dict] = []
    for screen_json in sorted(screens_dir.glob("*.json")):
        preview = previews_dir / f"{screen_json.stem}.png"
        if not preview.is_file():
            continue
        rendered = out_dir / "rendered" / f"{screen_json.stem}.png"
        w, h = render_screen(screen_json, pack_dir, rendered)
        text_pct = _text_mask_pct(screen_json, w, h)
        metrics = diff(rendered, preview, out_dir / "diffs")
        results.append({
            "screen": screen_json.stem,
            "mean_abs_diff": round(metrics["mean_abs_diff"], 3),
            "pct_pixels_nonzero": round(metrics["pct_pixels_nonzero"], 3),
            "painted_pct": round(metrics["painted_pct"], 3),
            "painted_mean_abs_diff": round(metrics["painted_mean_abs_diff"], 3),
            "painted_pct_nonzero": round(metrics["painted_pct_nonzero"], 3),
            "painted_pct_significant": round(metrics["painted_pct_significant"], 3),
            "text_coverage_pct": round(text_pct, 3),
            "canvas": metrics["canvas_size"],
        })

    # Sort by painted-region fidelity (significant-diff threshold)
    results.sort(key=lambda r: r["painted_pct_significant"])
    report = {
        "slug": pack_slug,
        "count": len(results),
        "median_painted_mean_abs_diff": _median([r["painted_mean_abs_diff"] for r in results]),
        "median_painted_pct_nonzero": _median([r["painted_pct_nonzero"] for r in results]),
        "median_painted_pct_significant": _median([r["painted_pct_significant"] for r in results]),
        "best": results[:10],
        "worst": results[-5:],
        "all": results,
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def _median(xs: list[float]) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


if __name__ == "__main__":
    slug = sys.argv[1]
    pack_dir = Path(sys.argv[2])
    report = validate(slug, pack_dir)
    print(f"screens validated: {report['count']}")
    print(f"median painted mean-abs-diff (0-255): {report['median_painted_mean_abs_diff']}")
    print(f"median painted pct significant:       {report['median_painted_pct_significant']}%  (diff > 32/255 per pixel)")
    hdr = f"  {'screen':35s} {'paint%':>7s} {'sig_pct':>8s} {'mean_abs':>9s} {'text%':>6s}"
    print("\nTop 10 (best painted-region fidelity):")
    print(hdr)
    for r in report["best"]:
        print(f"  {r['screen']:35s} {r['painted_pct']:6.1f}% {r['painted_pct_significant']:7.2f}% {r['painted_mean_abs_diff']:8.2f}  {r['text_coverage_pct']:5.1f}%")
    print("\nBottom 5 (worst painted-region fidelity):")
    print(hdr)
    for r in report["worst"]:
        print(f"  {r['screen']:35s} {r['painted_pct']:6.1f}% {r['painted_pct_significant']:7.2f}% {r['painted_mean_abs_diff']:8.2f}  {r['text_coverage_pct']:5.1f}%")
