"""PackAdapter ABC + registry.

A PackAdapter takes a source (Unity folder, Figma URL, raw scene JSON...) and
produces a uniform pack layout under <library>/packs/<slug>/:

  pack.json                 # per-pack metadata (self-contained, duplicated in catalog)
  canonical/
    screens/<name>.json     # cross-engine canonical scene JSON (see schema note below)
    components/<name>.json
  assets/
    images/<sha1>.png       # deduplicated sprites
    fonts/<name>.ttf
  thumbnails/
    pack.png                # 256x256 grid thumbnail
    screens/<name>.png
    components/<name>.png
  adapters/
    <source_type>.json      # source-specific round-trip metadata
  ingest.log

### Canonical scene JSON schema (library variant)
Superset of the three.js scene format used by experiments/ui_pack_validation/
threejs_scenes/*. Images reference disk assets by relative path rather than
embedding base64:

  image: { path?: "assets/images/<sha1>.png", data_url?: string, tint?: [r,g,b,a] }

Consumers prefer `path` when present, falling back to `data_url`.

### Adapter contract
- class attribute `source_type` matches catalog.source.type ("unity", ...).
- detect(source) returns True if it recognises the source.
- ingest(source, pack_dir, slug) populates pack_dir and returns IngestResult.

Adapters register at import time with @register_adapter.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

_REGISTRY: dict[str, type["PackAdapter"]] = {}


@dataclass
class IngestResult:
    slug: str
    display_name: str
    source_type: str
    vendor: str = ""
    version: str = ""
    screen_count: int = 0
    component_count: int = 0
    tags: list[str] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)


class PackAdapter(ABC):
    source_type: str = ""  # must be set by subclasses

    @classmethod
    @abstractmethod
    def detect(cls, source: Path | str) -> bool:
        """Return True if `source` looks like a pack this adapter can ingest."""

    @abstractmethod
    def ingest(self, source: Path | str, pack_dir: Path, slug: str) -> IngestResult:
        """Populate pack_dir with the library-standard layout and return metadata."""


def register_adapter(cls: type[PackAdapter]) -> type[PackAdapter]:
    if not cls.source_type:
        raise ValueError(f"{cls.__name__} must declare a non-empty source_type")
    _REGISTRY[cls.source_type] = cls
    return cls


def get_adapter(source_type: str) -> PackAdapter:
    if source_type not in _REGISTRY:
        raise KeyError(
            f"no adapter registered for source_type={source_type!r}; known: {all_adapters()}"
        )
    return _REGISTRY[source_type]()


def detect_adapter(source: Path | str) -> PackAdapter | None:
    for cls in _REGISTRY.values():
        if cls.detect(source):
            return cls()
    return None


def all_adapters() -> list[str]:
    return sorted(_REGISTRY.keys())
