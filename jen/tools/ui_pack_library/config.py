"""Resolve the UI Packs Library root directory.

Order of resolution:
1. JEN_UI_PACKS_LIBRARY environment variable (absolute or ~-expanded path).
2. Platform default: %USERPROFILE%\\UIPacksLibrary on Windows,
   ~/.uipacks-library everywhere else.

Every script in tools/ui_pack_library goes through library_root(); no absolute
paths are hardcoded elsewhere.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

ENV_VAR = "JEN_UI_PACKS_LIBRARY"


def library_root() -> Path:
    """Absolute path to the library root. Creates it (and packs/) on first access."""
    env = os.environ.get(ENV_VAR)
    if env:
        root = Path(env).expanduser().resolve()
    elif os.name == "nt":
        root = Path(os.environ.get("USERPROFILE", str(Path.home()))) / "UIPacksLibrary"
    else:
        root = Path.home() / ".uipacks-library"
    root.mkdir(parents=True, exist_ok=True)
    (root / "packs").mkdir(parents=True, exist_ok=True)
    return root


def catalog_path() -> Path:
    return library_root() / "catalog.json"


def pack_dir(slug: str) -> Path:
    return library_root() / "packs" / slug


def library_status() -> dict:
    """Introspection for the ui-pack-browse skill and the config CLI."""
    root = library_root()
    return {
        "root": str(root),
        "catalog": str(catalog_path()),
        "source": "env" if os.environ.get(ENV_VAR) else "default",
        "exists": root.is_dir(),
        "catalog_exists": catalog_path().exists(),
    }


if __name__ == "__main__":
    print(json.dumps(library_status(), indent=2))
