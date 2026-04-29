---
description: Ingest a UI pack (Unity today; Figma/three.js/raw later) into the local UI Packs Library so Jen can browse it and place screens into any game project
globs: ["**/Prefabs/**", "**/GUI*/**"]
---

# UI Pack Ingest

## When to Use

- Director points at a Unity UI pack folder and wants it added to the library.
- Director says "ingest this pack", "add this to the library", or names a specific pack (e.g. "ingest the LayerLab casual game pack").
- A pack was previously ingested and needs to be re-run (schema update, new version, fix).

This skill does **not** place pack content into a game. Placement is a separate step (see the `ui-pack-place` skill).

## What It Does

1. Detects the pack type (only `unity` ships in v1; schema ready for figma/threejs/raw).
2. Parses every prefab into the library-standard canonical scene JSON.
3. Deduplicates sprites into `assets/images/<sha1>.png`.
4. Copies bundled `Preview/*.png` screenshots as thumbnails where name-matched; renders canonical-JSON fallbacks otherwise.
5. Generates a 256x256 pack thumbnail.
6. Upserts a catalog entry in `<library>/catalog.json`.

## Prerequisites

- Python environment with the repo on `PYTHONPATH`.
- Pillow installed (`pip install pillow`).
- The library root exists (auto-created on first call). Location:
  - `$JEN_UI_PACKS_LIBRARY` if set
  - else `%USERPROFILE%\UIPacksLibrary` on Windows, `~/.uipacks-library` elsewhere

## Workflow

### Step 1. Confirm the source and license with the Director

Before running ingest, restate:
- **Source path** (absolute; will be passed as the first positional arg)
- **License tier** (default `personal+commercial`)
- **Allowed in** scopes (default `["director_games"]`; use `["*"]` for CC0 only)
- **Tags** (free-form; e.g. `casual`, `bright`, `cartoon` — help search later)

If the source is not a Unity pack (no `Prefabs/` subdir), stop and ask the Director to pick a Unity pack, or wait for a non-Unity adapter to be implemented.

### Step 2. Run the ingest CLI

```bash
python -m tools.ui_pack_library.ingest "<absolute source path>" \
    --slug <slug> \
    --license-tier personal+commercial \
    --allowed-in director_games \
    --tag casual --tag bright
```

- `--slug` is optional; default is `slugify(source.name)`. Prefer an explicit vendor-prefixed slug (e.g. `layerlab_gui_pro_casual_game`) for readability.
- Output is JSON with `library_root`, `pack_dir`, `id`, screen/component counts, and any per-prefab errors.

### Step 3. Check for errors

Errors are appended to `<pack_dir>/ingest.log` and printed to stderr. Before reporting success, open `ingest.log` and scan for `[X]` lines. Common causes:
- Missing fonts → the font GUID didn't resolve; the font file may be in a sub-package we didn't walk.
- Non-prefab files in `Prefabs_Component_*/` → safely skipped.
- Unknown TMP alignment enums → default to `LEFT`/`TOP`.

Surface any non-trivial errors to the Director before moving on.

### Step 4. Verify thumbnails

Inspect `<pack_dir>/thumbnails/pack.png` and 2-3 screen thumbnails visually. If the renderer fallback produced something clearly wrong (e.g. a mostly-empty image), note it — the adapter's Unity→canonical conversion likely needs a fix, not the thumbnail renderer.

### Step 5. Update the catalog reference in the session

Report to the Director:
- Library root
- Pack id and slug
- Screen count, component count, error count
- Path to the ingest log for audit

After this skill runs successfully, the pack is immediately visible to:
- `ui-pack-browse` (standalone library companion)
- `ui-pack-place` (per-game picker in a game project's companion)

## Idempotency

Re-running ingest with the same slug:
- Overwrites `canonical/`, `assets/images/`, `thumbnails/`, `adapters/unity/`, `pack.json`, `ingest.log`.
- Upserts the catalog entry by `id = <source_type>__<slug>__<version>`.
- Old assets that no longer exist in the pack remain in `assets/images/` (no garbage collection in v1 — safe, avoids breaking a game that already placed a screen).

## What Ends Up Where

```
<library root>/
  catalog.json                           # upsert target
  packs/<slug>/
    pack.json                            # per-pack manifest
    canonical/
      screens/<PrefabName>.json          # cross-engine canonical scene
      components/<PrefabName>.json
    assets/images/<sha1>.png             # deduplicated sprites
    thumbnails/
      pack.png                           # 256x256 grid thumbnail
      screens/<PrefabName>.png           # 640-wide preview
      components/<PrefabName>.png
    adapters/unity/
      guid_index.json                    # GUID → asset map
      screens/<PrefabName>.json          # Unity-internal tree (round-trip)
      components/<PrefabName>.json
    ingest.log
```

## Non-Unity packs (future)

When adding a new adapter (figma, threejs, raw):
1. Implement `tools/ui_pack_library/adapters/<name>.py` subclassing `PackAdapter`, register with `@register_adapter`, and write into the same per-pack layout.
2. Import it in `adapters/__init__.py`.
3. No catalog or skill changes are needed — the source-type field already exists.

## Out of Scope

- Placing a screen into a game (use `ui-pack-place`).
- Deleting packs (manual: remove `packs/<slug>/` and call `catalog.remove(pack_id)` from Python).
- Multi-machine sync of the library (tracked separately in `memory/project_per_instance_storage.md`).
