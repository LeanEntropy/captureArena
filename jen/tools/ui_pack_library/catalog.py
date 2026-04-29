"""Read/write the UI packs library catalog.json with idempotent upserts.

Schema v1:
{
  "schema_version": 1,
  "packs": [ PackEntry, ... ]
}

PackEntry fields — see the dataclass below. Identity is `id`; re-ingesting a
pack with the same id replaces the existing entry.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

from . import config

SCHEMA_VERSION = 1
INGEST_VERSION = 1


@dataclass
class PackSource:
    type: str  # "unity" | "figma" | "godot" | "raw"
    vendor: str = ""
    version: str = ""


@dataclass
class PackLicense:
    tier: str  # "personal+commercial" | "cc0" | ...
    allowed_in: list[str] = field(default_factory=list)  # ["director_games"] or ["*"]
    notes: str = ""


@dataclass
class PackEntry:
    id: str
    slug: str
    display_name: str
    source: PackSource
    license: PackLicense
    path: str  # relative to library root, e.g. "packs/<slug>"
    thumbnail: str  # relative to library root
    screen_count: int = 0
    component_count: int = 0
    ingested_at: str = ""  # YYYY-MM-DD
    ingest_version: int = INGEST_VERSION
    tags: list[str] = field(default_factory=list)


def load_catalog() -> dict:
    p = config.catalog_path()
    if not p.exists():
        return {"schema_version": SCHEMA_VERSION, "packs": []}
    raw = json.loads(p.read_text(encoding="utf-8"))
    if raw.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(
            f"unsupported catalog schema_version {raw.get('schema_version')}; expected {SCHEMA_VERSION}"
        )
    return raw


def save_catalog(cat: dict) -> None:
    p = config.catalog_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cat, indent=2, sort_keys=True), encoding="utf-8")


def upsert(entry: PackEntry) -> dict:
    cat = load_catalog()
    entries = cat.get("packs", [])
    d = asdict(entry)
    for i, existing in enumerate(entries):
        if existing.get("id") == entry.id:
            entries[i] = d
            break
    else:
        entries.append(d)
    cat["packs"] = sorted(entries, key=lambda e: e["slug"])
    save_catalog(cat)
    return cat


def remove(pack_id: str) -> bool:
    cat = load_catalog()
    before = len(cat.get("packs", []))
    cat["packs"] = [e for e in cat.get("packs", []) if e.get("id") != pack_id]
    if len(cat["packs"]) < before:
        save_catalog(cat)
        return True
    return False


def find(pack_id: str) -> dict | None:
    for e in load_catalog().get("packs", []):
        if e.get("id") == pack_id:
            return e
    return None


def today_iso() -> str:
    return date.today().isoformat()
