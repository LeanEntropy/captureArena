"""UI Packs Library — cross-engine, cross-project home for Jen's licensed UI packs.

See docs/ui_packs_library.md for architecture. The library root is resolved by
`config.library_root()` and lives outside any game or research repo. Adapters
convert source-specific formats (Unity prefabs today; Figma/Godot/raw tomorrow)
into a uniform per-pack layout: canonical/, assets/, thumbnails/, adapters/.
"""
