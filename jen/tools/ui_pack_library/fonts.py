"""Extract fonts from a Unity pack's TMP SDF .asset files.

For each `.asset` under `<source>/ResourcesData/Fonts/`, read:
  m_FamilyName:         "Lilita One"       # human-readable
  m_SourceFontFileGUID: "18656ef7..."      # GUID → original TTF

Resolve the TTF in this order:
1. The pack's guid_index — works only if the pack shipped the TTF.
2. `references/fonts/*.ttf` with a family-name substring match (e.g.
   "Lilita One" → "LilitaOne-Regular.ttf") — works for fonts Director
   has dropped into the project's shared references dir.

Copy the resolved TTF to `<pack_dir>/assets/fonts/<safe>.ttf` and return
a map { "<asset path rel to pack>" → "assets/fonts/<safe>.ttf" } that the
Unity adapter threads into `text.font_file` for every TMP text that
references the .asset.

Unresolved fonts are logged as `[font-missing]` lines the caller writes
to the pack's ingest.log; ingest does not fail.
"""
from __future__ import annotations

import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
_REFERENCES_FONTS = REPO / "references" / "fonts"

_FAMILY_RE = re.compile(r"^\s*m_FamilyName:\s*(.+?)\s*$", re.MULTILINE)
_GUID_RE = re.compile(r"^\s*m_SourceFontFileGUID:\s*([0-9a-fA-F]+)\s*$", re.MULTILINE)
_NONALNUM_RE = re.compile(r"[^a-zA-Z0-9]+")


@dataclass
class FontExtractResult:
    # asset_path (POSIX, relative to source pack) -> font_file path relative to pack_dir
    asset_to_font: dict[str, str] = field(default_factory=dict)
    # lines to append to ingest.log (one per missing / resolved, informational)
    log_lines: list[str] = field(default_factory=list)


def extract_fonts(
    source_pack: Path, guid_index: dict, pack_dir: Path
) -> FontExtractResult:
    out = FontExtractResult()
    fonts_src = source_pack / "ResourcesData" / "Fonts"
    if not fonts_src.is_dir():
        return out

    fonts_dst = pack_dir / "assets" / "fonts"
    fonts_dst.mkdir(parents=True, exist_ok=True)

    # Cache resolved files so multiple SDF variants of the same font (Regular,
    # Outline, different sizes) share one copy.
    resolved_cache: dict[tuple[str, str], str] = {}

    for asset in sorted(fonts_src.rglob("*.asset")):
        family, guid = _read_asset(asset)
        asset_rel = asset.relative_to(source_pack).as_posix()
        if not family and not guid:
            out.log_lines.append(f"[font-skip] {asset_rel} (no FaceInfo)")
            continue

        cache_key = (family or "", guid or "")
        if cache_key in resolved_cache:
            out.asset_to_font[asset_rel] = resolved_cache[cache_key]
            continue

        ttf_src: Path | None = None
        resolution = ""

        # 1. Pack-local GUID lookup
        if guid and guid in guid_index:
            candidate_rel = guid_index[guid].get("path", "")
            if candidate_rel.lower().endswith((".ttf", ".otf")):
                ttf_src = source_pack / candidate_rel
                if ttf_src.is_file():
                    resolution = f"pack:{candidate_rel}"
                else:
                    ttf_src = None

        # 2. references/fonts/ substring match by family
        if ttf_src is None and family:
            ttf_src, ref_rel = _find_reference_font(family)
            if ttf_src:
                resolution = f"ref:{ref_rel}"

        if ttf_src is None:
            out.log_lines.append(
                f"[font-missing] {asset_rel} "
                f"family={family!r} guid={guid or '-'} — renderer will use Lilita One fallback"
            )
            continue

        safe_name = _safe_stem(family or ttf_src.stem) + ttf_src.suffix.lower()
        dst = fonts_dst / safe_name
        if not dst.exists():
            shutil.copy2(ttf_src, dst)
        rel_out = f"assets/fonts/{safe_name}"
        out.asset_to_font[asset_rel] = rel_out
        resolved_cache[cache_key] = rel_out
        out.log_lines.append(f"[font-ok] {asset_rel} -> {rel_out} ({resolution})")

    return out


def _read_asset(asset: Path) -> tuple[str, str]:
    # Don't full-parse the YAML — just regex over the header, it's consistent.
    try:
        text = asset.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return "", ""
    fm = _FAMILY_RE.search(text)
    gm = _GUID_RE.search(text)
    return (fm.group(1).strip() if fm else ""), (gm.group(1).strip() if gm else "")


def _find_reference_font(family: str) -> tuple[Path | None, str]:
    if not _REFERENCES_FONTS.is_dir():
        return None, ""
    target = _NONALNUM_RE.sub("", family).lower()
    if not target:
        return None, ""
    # Prefer exact-stem match, then substring
    exacts: list[Path] = []
    substrs: list[Path] = []
    for p in _REFERENCES_FONTS.glob("*"):
        if p.suffix.lower() not in (".ttf", ".otf"):
            continue
        stem = _NONALNUM_RE.sub("", p.stem).lower()
        if target == stem:
            exacts.append(p)
        elif target in stem or stem in target:
            substrs.append(p)
    chosen = (exacts or substrs)
    if not chosen:
        return None, ""
    pick = chosen[0]
    return pick, pick.name


def _safe_stem(s: str) -> str:
    s2 = _NONALNUM_RE.sub("_", s).strip("_")
    return s2 or "font"
