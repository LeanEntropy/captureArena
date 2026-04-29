"""End-to-end ingest: detect adapter → ingest → thumbnails → catalog upsert.

Usage:
  python -m tools.ui_pack_library.ingest <source_path> [--slug <slug>]
      [--license-tier <tier>] [--allowed-in <scope> ...] [--tag <tag> ...]
      [--source-type <type>]

The source path must exist. The adapter is auto-detected (currently only Unity),
or can be forced with --source-type. The library root comes from
JEN_UI_PACKS_LIBRARY or the platform default — see config.py.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from . import catalog, config
from .adapters import all_adapters, detect_adapter, get_adapter
from .thumbnails import generate_thumbnails

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    return _SLUG_RE.sub("_", name.lower()).strip("_")


def run_ingest(
    source: Path,
    *,
    slug: str | None = None,
    source_type: str | None = None,
    license_tier: str = "personal+commercial",
    allowed_in: list[str] | None = None,
    tags: list[str] | None = None,
) -> dict:
    if not source.exists():
        raise FileNotFoundError(f"source does not exist: {source}")

    adapter = get_adapter(source_type) if source_type else detect_adapter(source)
    if adapter is None:
        raise RuntimeError(
            f"no adapter recognised the source {source}; known: {all_adapters()}. "
            "Try passing --source-type explicitly."
        )

    slug = slug or slugify(source.name)
    pack_dir = config.pack_dir(slug)
    ingest_result = adapter.ingest(source, pack_dir, slug)
    thumb_result = generate_thumbnails(pack_dir)

    entry = catalog.PackEntry(
        id=_make_id(ingest_result.source_type, slug, ingest_result.version),
        slug=slug,
        display_name=ingest_result.display_name,
        source=catalog.PackSource(
            type=ingest_result.source_type,
            vendor=ingest_result.vendor,
            version=ingest_result.version,
        ),
        license=catalog.PackLicense(
            tier=license_tier,
            allowed_in=allowed_in or ["director_games"],
        ),
        path=f"packs/{slug}",
        thumbnail=f"packs/{slug}/{thumb_result['pack_thumbnail']}",
        screen_count=ingest_result.screen_count,
        component_count=ingest_result.component_count,
        ingested_at=catalog.today_iso(),
        ingest_version=catalog.INGEST_VERSION,
        tags=tags or [],
    )
    catalog.upsert(entry)

    return {
        "library_root": str(config.library_root()),
        "pack_dir": str(pack_dir),
        "entry": json.loads(json.dumps(entry, default=lambda o: o.__dict__)),
        "ingest": {
            "screen_count": ingest_result.screen_count,
            "component_count": ingest_result.component_count,
            "errors": ingest_result.errors,
        },
        "thumbnails": thumb_result,
    }


def _make_id(source_type: str, slug: str, version: str) -> str:
    v = (version or "unversioned").replace(" ", "")
    return f"{source_type}__{slug}__{v}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", type=Path)
    ap.add_argument("--slug", default=None)
    ap.add_argument("--source-type", default=None)
    ap.add_argument("--license-tier", default="personal+commercial")
    ap.add_argument("--allowed-in", nargs="*", default=None)
    ap.add_argument("--tag", action="append", dest="tags", default=None)
    args = ap.parse_args()

    result = run_ingest(
        args.source,
        slug=args.slug,
        source_type=args.source_type,
        license_tier=args.license_tier,
        allowed_in=args.allowed_in,
        tags=args.tags,
    )
    print(json.dumps({
        "library_root": result["library_root"],
        "pack_dir": result["pack_dir"],
        "id": result["entry"]["id"],
        "screens": result["ingest"]["screen_count"],
        "components": result["ingest"]["component_count"],
        "errors": len(result["ingest"]["errors"]),
        "thumbnails": {
            "screens": result["thumbnails"]["screens"],
            "components": result["thumbnails"]["components"],
        },
    }, indent=2))
    if result["ingest"]["errors"]:
        print("\nErrors (first 10):", file=sys.stderr)
        for e in result["ingest"]["errors"][:10]:
            print(f"  {Path(e['prefab']).name}: {e['error']}", file=sys.stderr)


if __name__ == "__main__":
    main()
