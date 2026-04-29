---
description: Launch the UI Packs Library companion in browse mode so the Director can visually shop through ingested packs and screens
globs: []
---

# UI Pack Browse

## When to Use

- Director says "open the library", "show me what packs I have", "browse packs", "let me pick a screen".
- Director wants to pre-shop designs before committing to a game integration.
- Before running the `ui-pack-place` skill — browse first to pick the pack/screen by id.

This skill does **not** place a screen into a game. It's read-only exploration. For placement, use `ui-pack-place`.

## What It Does

Starts the existing artgen companion server pointed at the UI Packs Library:
- Serves `<library>/.companion/library-browser.html` as the entry point.
- Loads `packs.json` (projection of `catalog.json` + per-pack manifests).
- Lets the Director click into any pack, switch between Screens and Components tabs, and visually review thumbnails.

## Prerequisites

- At least one pack has been ingested (use `ui-pack-ingest` first).
- Node.js installed (the companion server is Node).
- Python + Pillow (the HTML/JSON generator is Python).

## Workflow

### Step 1. Regenerate companion data

This is idempotent and fast — always do it so `packs.json` reflects the latest catalog:

```bash
python -c "from tools.ui_pack_library import companion_data; print(companion_data.write_companion_data('library'))"
```

### Step 2. Start the server

```bash
python -m tools.ui_pack_library.browse --mode library
```

The process stays in the foreground and prints the URL. The browser opens automatically. Use `--no-open` for headless testing and `--port N` to pin the port.

### Step 3. Tell the Director the URL

Expected format: `http://127.0.0.1:<port>/library-browser.html`. If running over SSH/remote, share the tunnel-forwarded URL.

### Step 4. Shut down when done

```bash
python -m tools.ui_pack_library.browse --stop
```

Or send Ctrl-C to the foreground process.

## Picker mode vs library mode

The same companion data/pages are reused by `ui-pack-place`, which calls
`companion_data.write_companion_data('picker')`. In picker mode, each screen
card grows two buttons ("Figma first", "Direct to engine") that post a
`pack_pick` event to the server. **Do not** run picker mode with this skill —
use `ui-pack-place` instead; it needs a game project context.

## Out of Scope

- Placing a screen (see `ui-pack-place`).
- Ingesting a new pack (see `ui-pack-ingest`).
- Searching / filtering by tag (v1 grid is flat; tag filter is v2).
