"""Walk a Unity pack, parse every .meta file, produce a GUID index.

Output schema (guid_index.json):
  {
    "<guid>": {
      "path": "Prefabs/.../Loading.prefab",   # pack-relative
      "type": "prefab" | "texture" | "script" | "font" | "scene" | "material" | ...,
      "sprite": {                              # only for TextureImporter assets used as sprites
        "border": [33, 144, 31, 31],           # L, B, R, T
        "pivot": [0.5, 0.5],
        "pixels_per_unit": 100
      }
    }
  }
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

_IMPORTER_TO_TYPE = {
    "TextureImporter": "texture",
    "PrefabImporter": "prefab",
    "NativeFormatImporter": "asset",
    "MonoImporter": "script",
    "TrueTypeFontImporter": "font",
    "DefaultImporter": "scene",
    "ShaderImporter": "shader",
    "AudioImporter": "audio",
}


def _asset_type(meta: dict, asset_path: Path) -> str:
    for key in _IMPORTER_TO_TYPE:
        if key in meta:
            return _IMPORTER_TO_TYPE[key]
    suffix = asset_path.suffix.lower()
    return {".mat": "material", ".asset": "asset", ".shader": "shader"}.get(suffix, "unknown")


def _sprite_info(meta: dict, asset_path: Path) -> dict | None:
    ti = meta.get("TextureImporter")
    if not ti:
        return None
    border = ti.get("spriteBorder") or {}
    pivot = ti.get("spritePivot") or {}
    native: list[int] | None = None
    try:
        from PIL import Image
        with Image.open(asset_path) as im:
            native = [im.size[0], im.size[1]]
    except Exception:
        native = None
    info: dict = {
        "border": [border.get("x", 0), border.get("y", 0), border.get("z", 0), border.get("w", 0)],
        "pivot": [pivot.get("x", 0.5), pivot.get("y", 0.5)],
        "pixels_per_unit": ti.get("spritePixelsToUnits", 100),
    }
    if native:
        info["native_size"] = native
    return info


def build_guid_index(pack_root: Path) -> dict[str, dict]:
    index: dict[str, dict] = {}
    for meta_path in pack_root.rglob("*.meta"):
        asset_path = meta_path.with_suffix("")
        if not asset_path.is_file():
            continue  # skip folder .meta
        try:
            meta = yaml.safe_load(meta_path.read_text(encoding="utf-8"))
        except yaml.YAMLError:
            continue
        if not isinstance(meta, dict):
            continue
        guid = meta.get("guid")
        if not guid:
            continue
        rel = asset_path.relative_to(pack_root).as_posix()
        entry: dict = {"path": rel, "type": _asset_type(meta, asset_path)}
        sprite = _sprite_info(meta, asset_path)
        if sprite is not None:
            entry["sprite"] = sprite
        index[guid] = entry
    return index


if __name__ == "__main__":
    pack_root = Path(sys.argv[1])
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    idx = build_guid_index(pack_root)
    payload = json.dumps(idx, indent=2, sort_keys=True)
    if out_path:
        out_path.write_text(payload, encoding="utf-8")
    print(f"indexed {len(idx)} assets")
    # summary by type
    by_type: dict[str, int] = {}
    for v in idx.values():
        by_type[v["type"]] = by_type.get(v["type"], 0) + 1
    print(json.dumps(by_type, indent=2, sort_keys=True))
