"""Unity pack adapter — wraps tools/ui_pack_ingest for the library layout.

Consumes a Unity package folder (Prefabs/*.prefab + .meta GUID files + sprite
PNGs) and writes the library-standard layout:

  <pack_dir>/
    pack.json
    canonical/screens/<name>.json          # cross-engine canonical scene JSON
    canonical/components/<name>.json
    assets/images/<sha1>.png               # deduplicated sprites
    thumbnails/pack.png, screens/<name>.png, components/<name>.png
    adapters/unity/
      guid_index.json                      # GUID → (path, native_size, border) map
      screens/<name>.json                  # Unity-internal tree for round-trip
      components/<name>.json
    ingest.log

The existing Unity parse pipeline (parse_meta, parse_prefab, layout_solver,
rect_math) stays unmodified — this adapter calls it and converts its output
to the cross-engine canonical form expected by the library.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import traceback
from pathlib import Path

from ..catalog import INGEST_VERSION
from ..fonts import extract_fonts
from .base import IngestResult, PackAdapter, register_adapter

# Make the existing ui_pack_ingest modules importable (they use flat imports).
_UI_PACK_INGEST = Path(__file__).resolve().parents[2] / "ui_pack_ingest"
if str(_UI_PACK_INGEST) not in sys.path:
    sys.path.insert(0, str(_UI_PACK_INGEST))

from layout_solver import solve as solve_layout  # type: ignore  # noqa: E402
from parse_meta import build_guid_index  # type: ignore  # noqa: E402
from parse_prefab import parse_prefab  # type: ignore  # noqa: E402
from rect_math import annotate_abs_rects  # type: ignore  # noqa: E402
from tmp_text import parse_segments, strip_tags  # type: ignore  # noqa: E402


@register_adapter
class UnityAdapter(PackAdapter):
    source_type = "unity"

    @classmethod
    def detect(cls, source: Path | str) -> bool:
        p = Path(source)
        return p.is_dir() and (p / "Prefabs").is_dir()

    def ingest(self, source: Path | str, pack_dir: Path, slug: str) -> IngestResult:
        source = Path(source)
        if not self.detect(source):
            raise ValueError(f"{source} is not a Unity pack (no Prefabs/ subdir)")

        _mkdirs(pack_dir)
        _clear_rendered_thumbnails(pack_dir)
        log_lines: list[str] = [f"# unity ingest log — {slug}", f"source: {source}"]
        errors: list[dict] = []

        # 1. GUID index (mandatory — drives sprite and font resolution)
        guid_index = build_guid_index(source)
        (pack_dir / "adapters" / "unity" / "guid_index.json").write_text(
            json.dumps(guid_index, indent=2, sort_keys=True), encoding="utf-8",
        )
        log_lines.append(f"guid_index: {len(guid_index)} entries")

        # 2. Copy pack-bundled preview screenshots as thumbnails when names match
        bundled_previews = _copy_bundled_previews(source, pack_dir)
        log_lines.append(f"bundled_previews: {bundled_previews} copied")

        # 2b. Extract TTFs referenced by TMP SDF .asset files (pack-local GUID
        # first, then references/fonts/ by family). Unresolvable fonts are
        # logged; renderer falls back to family substring match.
        font_result = extract_fonts(source, guid_index, pack_dir)
        log_lines.extend(font_result.log_lines)
        font_map = font_result.asset_to_font

        # 3. Parse prefabs → Unity-internal tree → canonical scene
        sprite_index: dict[str, str] = {}  # source sprite path (rel) → sha1 hex
        screen_dirs = [source / "Prefabs" / "Prefabs_DemoScene_Panels"]
        component_dirs = sorted((source / "Prefabs").glob("Prefabs_Component_*"))

        screens_written: list[dict] = []
        components_written: list[dict] = []

        for prefab_dir, out_bucket, sub in [
            *[(sd, screens_written, "screens") for sd in screen_dirs],
            *[(cd, components_written, "components") for cd in component_dirs],
        ]:
            if not prefab_dir.is_dir():
                continue
            for prefab in sorted(prefab_dir.glob("*.prefab")):
                name = prefab.stem
                try:
                    tree = parse_prefab(prefab, guid_index, source)
                    solve_layout(tree["root"])
                    annotate_abs_rects(tree["root"])
                    # Unity-internal tree (for round-trip) → adapters/unity/<sub>/<name>.json
                    (pack_dir / "adapters" / "unity" / sub).mkdir(parents=True, exist_ok=True)
                    (pack_dir / "adapters" / "unity" / sub / f"{name}.json").write_text(
                        json.dumps(tree, indent=2, sort_keys=True), encoding="utf-8",
                    )
                    # Cross-engine canonical scene → canonical/<sub>/<name>.json
                    canonical = _tree_to_canonical(
                        tree, name=name, prefab=prefab.name,
                        source_pack=source, pack_dir=pack_dir, sprite_index=sprite_index,
                        font_map=font_map,
                    )
                    (pack_dir / "canonical" / sub).mkdir(parents=True, exist_ok=True)
                    (pack_dir / "canonical" / sub / f"{name}.json").write_text(
                        json.dumps(canonical, indent=2, sort_keys=True), encoding="utf-8",
                    )
                    out_bucket.append({"name": name, "object_count": len(canonical["objects"])})
                    log_lines.append(f"[V] {sub}/{name}: {len(canonical['objects'])} objects")
                except Exception as exc:
                    errors.append({
                        "prefab": str(prefab),
                        "error": f"{type(exc).__name__}: {exc}",
                    })
                    log_lines.append(f"[X] {sub}/{name}: {type(exc).__name__}: {exc}")

        # 4. Write pack.json manifest (self-contained)
        display_name = _display_name_from_slug(slug)
        vendor_info = _read_vendor(source)
        manifest = {
            "schema_version": 1,
            "slug": slug,
            "display_name": display_name,
            "source": {
                "type": "unity",
                "vendor": vendor_info.get("packageName", "") or vendor_info.get("productId", ""),
                "version": vendor_info.get("packageVersion", ""),
                "path": str(source),
            },
            "screens": sorted(screens_written, key=lambda e: e["name"]),
            "components": sorted(components_written, key=lambda e: e["name"]),
            "asset_count": len(sprite_index),
            "ingest_version": INGEST_VERSION,
            "errors": errors,
        }
        (pack_dir / "pack.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8",
        )
        (pack_dir / "ingest.log").write_text("\n".join(log_lines) + "\n", encoding="utf-8")

        return IngestResult(
            slug=slug,
            display_name=display_name,
            source_type="unity",
            vendor=manifest["source"]["vendor"],
            version=manifest["source"]["version"],
            screen_count=len(screens_written),
            component_count=len(components_written),
            errors=errors,
        )


# ---------- helpers ----------


_SLUG_WORD_RE = re.compile(r"[a-z0-9]+")


def _mkdirs(pack_dir: Path) -> None:
    for sub in (
        "canonical/screens", "canonical/components",
        "assets/images", "assets/fonts",
        "thumbnails/screens", "thumbnails/components",
        "adapters/unity",
    ):
        (pack_dir / sub).mkdir(parents=True, exist_ok=True)


def _display_name_from_slug(slug: str) -> str:
    return " ".join(w.capitalize() for w in _SLUG_WORD_RE.findall(slug))


def _read_vendor(pack_dir: Path) -> dict:
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


def _copy_bundled_previews(source: Path, pack_dir: Path) -> int:
    """Match bundled Preview/*.png files to their prefabs and copy them as
    thumbnails so the thumbnailer skips re-rendering those screens.

    Layer Lab's Preview/ files don't always match the prefab stem exactly:
    - `0_Daily_Bonus_30Day.png` ↔ `Daily_Bonus_30Day.prefab` (leading index)
    - `ADRemove.png` ↔ `Ad_Remove.prefab` (punctuation stripped)

    We normalize both sides (lowercase + strip non-alphanumeric, with a
    leading numeric/underscore-index pass) and compare. Previews without a
    prefab match (e.g. generic `0_Component_0.png`) are skipped.
    """
    preview_src = source / "Preview"
    if not preview_src.is_dir():
        return 0

    # Collect screen prefabs separately from components so each thumbnail
    # lands in the right thumbnails/<kind>/ dir.
    screen_prefabs: dict[str, str] = {}
    component_prefabs: dict[str, str] = {}
    for p in (source / "Prefabs" / "Prefabs_DemoScene_Panels").glob("*.prefab"):
        screen_prefabs[_norm_stem(p.stem)] = p.stem
    for d in (source / "Prefabs").glob("Prefabs_Component_*"):
        for p in d.glob("*.prefab"):
            component_prefabs[_norm_stem(p.stem)] = p.stem

    (pack_dir / "thumbnails" / "screens").mkdir(parents=True, exist_ok=True)
    (pack_dir / "thumbnails" / "components").mkdir(parents=True, exist_ok=True)

    count = 0
    for png in preview_src.glob("*.png"):
        stem = png.stem
        stripped = re.sub(r"^\d+[_\-]*", "", stem)
        keys = {_norm_stem(stem), _norm_stem(stripped)}
        for key in keys:
            if not key:
                continue
            if key in screen_prefabs:
                shutil.copy2(png, pack_dir / "thumbnails" / "screens" / f"{screen_prefabs[key]}.png")
                count += 1
                break
            if key in component_prefabs:
                shutil.copy2(png, pack_dir / "thumbnails" / "components" / f"{component_prefabs[key]}.png")
                count += 1
                break
    return count


def _norm_stem(s: str) -> str:
    return "".join(c for c in s.lower() if c.isalnum())


def _clear_rendered_thumbnails(pack_dir: Path) -> None:
    """Delete previously-rendered thumbnails so a re-ingest doesn't reuse
    stale renders when the canonical changes."""
    for sub in ("screens", "components"):
        d = pack_dir / "thumbnails" / sub
        if not d.is_dir():
            continue
        for p in d.glob("*.png"):
            try:
                p.unlink()
            except OSError:
                pass


# TMP alignment enums (copied shape from export_figma._align_h/_align_v).
_ALIGN_H = {2: "CENTER", 32: "CENTER", 4: "RIGHT"}
_ALIGN_V = {512: "CENTER", 4096: "CENTER", 8192: "CENTER", 1024: "BOTTOM"}


def _align_h(flag: int | None) -> str:
    return _ALIGN_H.get(int(flag or 0), "LEFT")


def _align_v(flag: int | None) -> str:
    return _ALIGN_V.get(int(flag or 0), "TOP")


def _font_family(font_info: dict | None) -> str:
    if not font_info:
        return "Inter"
    asset = (font_info.get("path") or "").lower()
    if "lilitaone" in asset:
        return "Lilita One"
    stem = Path(asset).stem.replace("_", " ").replace("-", " ")
    return stem.title() or "Inter"


_IMAGE_TYPE_MAP = {0: "simple", 1: "sliced", 2: "tiled", 3: "filled"}


def _sprite_to_asset(
    sprite: dict, source_pack: Path, pack_dir: Path, sprite_index: dict[str, str]
) -> str | None:
    """Copy sprite PNG into assets/images/<sha1>.png (deduped). Returns the
    asset path relative to pack_dir ('assets/images/<sha1>.png') or None if
    the source PNG is missing."""
    rel = sprite.get("path")
    if not rel:
        return None
    if rel in sprite_index:
        return f"assets/images/{sprite_index[rel]}.png"
    src_png = source_pack / rel
    if not src_png.is_file():
        return None
    raw = src_png.read_bytes()
    sha1 = hashlib.sha1(raw).hexdigest()
    dst = pack_dir / "assets" / "images" / f"{sha1}.png"
    if not dst.exists():
        dst.write_bytes(raw)
    sprite_index[rel] = sha1
    return f"assets/images/{sha1}.png"


def _tree_to_canonical(
    tree: dict, *,
    name: str, prefab: str,
    source_pack: Path, pack_dir: Path, sprite_index: dict[str, str],
    font_map: dict[str, str] | None = None,
) -> dict:
    """Convert a Unity-internal parsed tree into cross-engine canonical scene.

    Canvas sizing: prefabs rooted under a Canvas/CanvasScaler don't carry the
    reference resolution themselves (the Canvas lives in the scene, not the
    prefab). So when the root rect is 0x0 (common in mobile/portrait packs),
    we compute the canvas from the bounding box of visible descendants and
    shift objects so min-x, min-y = 0. Works for any orientation.

    Per-object extensions beyond rect + image/text:
    - `rotation_deg`: read from node.rect.rotation_z (local rotation).
    - `clip_rect`: the abs_rect of the nearest Mask / RectMask2D ancestor,
      so the renderer can clip this object's draw to that rect.
    - `text.segments`: list of styled spans when the raw TMP string carries
      `<size>/<color>/<b>/<i>` markup. `text.characters` stays as the
      plain-string fallback for consumers that don't handle segments.
    - `text.font_file`: relative path (e.g. `assets/fonts/LilitaOne.ttf`)
      when font_map resolved the TMP asset to a real TTF.
    """
    font_map = font_map or {}
    root = tree.get("root") or {}
    rect = root.get("abs_rect") or {}
    root_w = int(round(rect.get("w") or 0))
    root_h = int(round(rect.get("h") or 0))

    objects: list[dict] = []

    def walk(node: dict, parent_id: str, clip_rect: dict | None) -> None:
        node_id = f"{parent_id}/{node.get('name') or '?'}" if parent_id else (node.get("name") or "?")
        comps = [c for c in (node.get("components") or []) if c]
        rect_ = node.get("abs_rect") or {}
        rotation_deg = float((node.get("rect") or {}).get("rotation_z") or 0)

        # Pass-through clip_rect for this subtree; promote to this node's rect
        # if it hosts a Mask / RectMask2D component AND has a non-zero rect
        # (root-level 0x0 masks would otherwise invalidate every descendant).
        child_clip = clip_rect
        if any((c.get("type") in ("Mask", "RectMask2D")) for c in comps):
            mask_rect = _rect_out(rect_)
            if mask_rect["w"] > 0 and mask_rect["h"] > 0:
                child_clip = mask_rect

        # Emit one canonical object per visible component on this node.
        for comp in comps:
            ctype = comp.get("type")
            if ctype == "Image":
                sprite = comp.get("sprite") or {}
                asset_path = _sprite_to_asset(sprite, source_pack, pack_dir, sprite_index)
                tint = comp.get("color") or [1, 1, 1, 1]
                img: dict = {"tint": tint}
                if asset_path:
                    img["path"] = asset_path
                border = sprite.get("border")
                if border and any(float(b) for b in border):
                    img["border_ltrb"] = [float(b) for b in border]
                img_type = _IMAGE_TYPE_MAP.get(int(comp.get("image_type") or 0))
                if img_type and img_type != "simple":
                    img["render_type"] = img_type
                obj_out: dict = {
                    "id": node_id,
                    "name": node.get("name") or "",
                    "kind": "image",
                    "rect": _rect_out(rect_),
                    "rotation_deg": rotation_deg,
                    "opacity": 1.0,
                    "image": img,
                }
                if clip_rect is not None and clip_rect.get("w", 0) > 0 and clip_rect.get("h", 0) > 0:
                    obj_out["clip_rect"] = dict(clip_rect)
                objects.append(obj_out)
            elif ctype == "TextMeshProUGUI":
                font_info = comp.get("font") or {}
                font_path = (font_info.get("path") or "")
                size = int(comp.get("font_size") or 36)
                outline_w = float(comp.get("outline_width") or 0)
                outline_px = int(round(outline_w * max(4, int(size * 0.08)))) if outline_w > 0 else 0
                if outline_px == 0 and "outline" in font_path.lower():
                    outline_px = max(2, int(round(size * 0.09)))
                raw_text = str(comp.get("text") or "")
                segments = parse_segments(raw_text)
                text_obj: dict = {
                    "characters": strip_tags(raw_text),
                    "family": _font_family(font_info),
                    "size": size,
                    "color": comp.get("face_color") or comp.get("color") or [1, 1, 1, 1],
                    "align_h": _align_h(comp.get("alignment_h")),
                    "align_v": _align_v(comp.get("alignment_v")),
                }
                if font_map and font_path in font_map:
                    text_obj["font_file"] = font_map[font_path]
                if _segments_are_non_trivial(segments):
                    text_obj["segments"] = segments
                if outline_px > 0:
                    text_obj["outline_px"] = outline_px
                    text_obj["outline_color"] = comp.get("outline_color") or [0, 0, 0, 1]
                    # Outline-SDF fonts also carry a small baked drop shadow in
                    # the source material; mirror it so downstream renderers
                    # match the Unity preview.
                    text_obj["shadow_offset"] = [2, 2]
                    text_obj["shadow_color"] = [0, 0, 0, 0.5]
                obj_out = {
                    "id": node_id,
                    "name": node.get("name") or "",
                    "kind": "text",
                    "rect": _rect_out(rect_),
                    "rotation_deg": rotation_deg,
                    "opacity": 1.0,
                    "text": text_obj,
                }
                if clip_rect is not None and clip_rect.get("w", 0) > 0 and clip_rect.get("h", 0) > 0:
                    obj_out["clip_rect"] = dict(clip_rect)
                objects.append(obj_out)
        for child in (node.get("children") or []):
            walk(child, node_id, child_clip)

    walk(root, "", None)

    # Compute tight bbox of all emitted objects — use it to fix canvas + shift
    # objects when the root had no explicit size (common in mobile/portrait
    # prefabs whose Canvas lives in the scene, not the prefab).
    canvas_w, canvas_h, shift_x, shift_y = _resolve_canvas(objects, root_w, root_h)
    if shift_x or shift_y:
        for obj in objects:
            r = obj.get("rect") or {}
            r["x"] = float(r.get("x", 0)) - shift_x
            r["y"] = float(r.get("y", 0)) - shift_y
            obj["rect"] = r
            cr = obj.get("clip_rect")
            if cr:
                cr["x"] = float(cr.get("x", 0)) - shift_x
                cr["y"] = float(cr.get("y", 0)) - shift_y
                obj["clip_rect"] = cr

    return {
        "metadata": {
            "generator": "tools.ui_pack_library.adapters.unity",
            "version": 1,
            "canvas": [canvas_w, canvas_h],
            "name": name,
            "source": {"type": "unity", "prefab": prefab},
        },
        "objects": objects,
    }


def _segments_are_non_trivial(segments: list[dict]) -> bool:
    """True iff the segment list encodes more than the single plain span."""
    if len(segments) != 1:
        return len(segments) > 1
    s = segments[0]
    if s.get("color") or s.get("size"):
        return True
    if s.get("bold") or s.get("italic"):
        return True
    return False


def _resolve_canvas(
    objects: list[dict], root_w: int, root_h: int
) -> tuple[int, int, float, float]:
    """Pick a canvas size + shift for the scene.

    Preference order:
    1. Explicit non-zero root rect.
    2. Tight bbox of objects, shifted so min-x, min-y = 0.
    3. Landscape HD fallback (2560x1440) if no objects.
    """
    if root_w > 0 and root_h > 0:
        return root_w, root_h, 0.0, 0.0
    if not objects:
        return 2560, 1440, 0.0, 0.0
    xs: list[float] = []
    ys: list[float] = []
    xes: list[float] = []
    yes: list[float] = []
    for o in objects:
        r = o.get("rect") or {}
        w = float(r.get("w") or 0)
        h = float(r.get("h") or 0)
        if w <= 0 or h <= 0:
            continue
        x = float(r.get("x") or 0)
        y = float(r.get("y") or 0)
        xs.append(x); ys.append(y); xes.append(x + w); yes.append(y + h)
    if not xs:
        return 2560, 1440, 0.0, 0.0
    min_x, min_y = min(xs), min(ys)
    bbox_w = max(xes) - min_x
    bbox_h = max(yes) - min_y
    return int(round(bbox_w)), int(round(bbox_h)), min_x, min_y


def _rect_out(rect: dict) -> dict:
    return {
        "x": float(rect.get("x") or 0),
        "y": float(rect.get("y") or 0),
        "w": float(rect.get("w") or 0),
        "h": float(rect.get("h") or 0),
    }


# Re-raise cleanly if a downstream run wants the traceback
def _fmt_exc() -> str:
    return traceback.format_exc()
