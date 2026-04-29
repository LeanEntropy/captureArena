# ui_pack_ingest

Deterministic parser for Unity UI packs. Produces portable JSON that downstream exporters (Figma, Godot, HTML preview) can render pixel-perfectly.

## Pipeline

```
<pack_dir>
  └── parse_meta.py   -> guid_index.json  (guid -> asset path + metadata)
  └── parse_prefab.py -> screens/*.json   (layout tree, abs rects, resolved sprites)
  └── parse_scene.py  -> canvases list    (for demo scene composition)
  └── ingest.py       -> references/ui_packs/<slug>/
```

## Usage

```bash
python tools/ui_pack_ingest/ingest.py "C:/path/to/Assets/Vendor/PackName" --slug pack_slug
```

## Component coverage (phase 1)

Parsed precisely: RectTransform, Image (sliced/simple/tiled), RawImage, Text, TextMeshPro, Button, Mask, RectMask2D, ScrollRect (viewport only), Canvas, LayoutGroup, GridLayoutGroup.

Preserved as ref + note (not simulated): Particle systems, Animators, custom MonoBehaviour scripts, shaders.

## Why parse instead of VLM

Pixel-perfect recreation requires deterministic values (anchors, pivots, 9-slice borders, absolute rects). VLMs approximate; parsers don't.
