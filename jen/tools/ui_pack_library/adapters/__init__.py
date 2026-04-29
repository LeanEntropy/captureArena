"""Adapter registry for the UI packs library.

Each adapter is responsible for one source type (unity, figma, godot, raw).
Unity ships in v1; the others are schema-ready extension points.
"""
from .base import (
    IngestResult,
    PackAdapter,
    all_adapters,
    detect_adapter,
    get_adapter,
    register_adapter,
)

# Registered adapters — import for side-effect (@register_adapter).
from . import unity  # noqa: F401,E402

__all__ = [
    "IngestResult",
    "PackAdapter",
    "all_adapters",
    "detect_adapter",
    "get_adapter",
    "register_adapter",
]
