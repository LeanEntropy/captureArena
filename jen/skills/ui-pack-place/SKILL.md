---
description: Place a UI pack screen/component into a game project — three.js, Godot, or Figma round-trip — with a visual picker in the companion
globs: []
---

# UI Pack Place

## When to Use

- Director says "add [screen] to this game", "pick a screen", "place the lobby here".
- After browsing the library (`ui-pack-browse`) and deciding on a target.
- Director wants to try a screen in Figma first before engine commit.

## What It Does

- License-guards every placement against the target game's scope (`.artgen/project.json`).
- Copies the canonical scene + sprite assets into a sandboxed directory under `<game>/.artgen/packs_imports/<slug>/<name>/` so multiple packs never clash.
- Emits an export in the requested form: Figma plugin bundle, three.js scene JSON, or Godot .tscn + assets.
- Tracks adaptations in `adaptation.json` (empty in v1 — Stage 6 will populate it).

## Prerequisites

- Ingested pack in the library (use `ui-pack-ingest` first).
- The target game has an `.artgen/project.json` with a `scope` key. If absent, the guard falls back to `"director_games"` and will block packs restricted to other scopes.
- For three.js targets (default for this project), the `<game>` is expected to be the project root (so the three.js loader can read scene JSON from `.artgen/...` paths).
- For Figma round-trip, the existing `ui-pack-figma-plugin` is installed in Figma Desktop.
- Godot is also supported as an alternate target — only relevant if porting an asset to a Godot project.

## Three Entry Points

### A. Interactive picker (primary)

Launches the companion in picker mode with a server-side event listener that dispatches `pack_pick` events to `place.place()` automatically.

```bash
python -m tools.ui_pack_library.picker --game-dir <game path> --engine threejs
```

The Director opens the URL, clicks **Figma first** or **Direct to engine** on any screen card, and the placement runs in the picker's foreground process. Each placement prints `[placed]` with the export paths.

Default engine is `threejs`. Pass `--engine godot` only when porting to a Godot target.

### B. Direct CLI (scripting / replays)

```bash
python -m tools.ui_pack_library.place <pack_id> screen <name> \
    --mode engine --engine threejs \
    --game-dir <game path>
```

- `--mode engine --engine threejs` (default) → writes `exports/threejs/<name>.json`, reads the assets from the sibling `assets/` dir. Load with the existing `lobby.js` loader.
- `--mode figma` → writes `<game>/.artgen/packs_imports/<slug>/<name>/exports/figma/<name>_bundle.json`. Open the Figma plugin, drop the JSON in.
- `--mode engine --engine godot` → writes `exports/godot/<name>.tscn` + copies assets as Godot resources. Only used when porting to a Godot target.

### C. Library function (programmatic)

```python
from tools.ui_pack_library.place import place
r = place("unity__layerlab_gui_pro_casual_game__4.1.1",
          "screen", "Lobby",
          mode="engine", engine="threejs",
          game_dir=Path("~/my-game").expanduser())
```

## Workflow

1. **Confirm with the Director**: target game, pack, screen/component, mode, and engine. If Figma-first, restate that they'll edit in Figma then re-export to the engine.
2. **Check license scope**: does `<game>/.artgen/project.json` exist and list a scope the pack allows? If missing, create it.
3. **Run placement** via the picker (preferred) or the direct CLI.
4. **Surface outcomes** — print `import_dir`, export paths, and any licensed-guard or missing-asset errors. Confirm visually where possible (reload the three.js demo, open Figma, or — for Godot ports — open the `.tscn`).
5. **Offer the adaptation step** (Stage 6 when implemented): strings to swap, sprites to replace. Until Stage 6 ships, v1 placements are identical to the pack's canonical.

## Output Layout

```
<game>/.artgen/packs_imports/<slug>/<name>/
  canonical.json          # library canonical, image.path rewritten to ./assets/
  adaptation.json         # {"applied": [], "version": 1} — Stage 6 will populate
  assets/<sha1>.png       # sprites (deduplicated per import)
  exports/
    figma/<name>_bundle.json     # if mode=figma
    threejs/<name>.json          # if mode=engine threejs
    godot/<name>.tscn            # if mode=engine godot
```

Each placement overwrites its own `<name>/` directory. To place multiple variants, clone the directory or tag the name (`Lobby_v2`).

## License Scopes

- Pack `license.allowed_in` is a list: `["director_games"]` for Director's private packs; `["*"]` for CC0 / freely redistributable.
- Game `scope` must be in the pack's list (or pack is unrestricted with `"*"`).
- If the Director wants to add a new scope (e.g. `"demo_reels"`), bump it in both the game's `project.json` and — if the pack should reach that scope — re-ingest with `--allowed-in director_games demo_reels`.

## Adaptation (after placement)

After every placement the picker also generates a per-import `adapt-<slug>-<name>.html` in `<library>/.companion/` and prints its URL. The page surfaces:

- **Every text object** with its current string, inline-editable.
- **Every swappable sprite** — filtered by name heuristic (`logo|hero|character|icon|avatar|portrait|mascot|banner|title`) — with a file picker for a replacement PNG.

Submitting the form posts an `adapt` event; the picker backend applies the edits, writes a history row to `adaptation.json`, and re-runs the same mode/engine export so the result is immediately live. Run the adapt flow as many times as you like — each submission rewrites the canonical, re-exports, and appends another history entry.

Direct CLI access (without the picker) is possible via:

```python
from tools.ui_pack_library.adapt import apply
apply(game_dir, import_key="<slug>/<name>", mode="engine", engine="threejs",
      text_edits=[{"id": "...", "characters": "New String"}],
      sprite_edits=[{"id": "...", "png_b64": "<base64 of PNG>"}])
```

## Known Limits (v1)

- three.js export: scene JSON with assets referenced by relative path; loader handles atlasing.
- Godot export (alt target): no rotation, no image fill modes (simple/sliced only), no rich-text TMP markup.
- Figma round-trip back to engine is still manual: edit in Figma, re-export via `figma_to_threejs.py` (or `figma_to_godot.py` for Godot targets), and drop the result back into `exports/`.
- Adaptation v1 covers text replacement + sprite swap only. Palette re-skin and layout reflow are v2.
- No rollback: placements/adaptations always overwrite. Git or manual backup before placing a variant you might want to revert.
