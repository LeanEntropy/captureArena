"""Canonical three.js UI scene format.

Picked pixel-based, y-down coordinates (matches Figma) so the two pipelines
(threejs_to_figma, figma_to_threejs) share one intermediate without per-pipeline
coordinate flipping. A small loader in the three.js runtime (see docs) mounts
the scene into a THREE.Scene with an OrthographicCamera that maps 1 px -> 1 unit.

Schema:
  {
    "metadata": { "generator": "ui-pack-ingest", "canvas": [w, h], "name": "..." },
    "objects": [
      {
        "id": "<unique string>",
        "name": "<readable>",
        "kind": "image" | "text" | "group",
        "rect":          { "x": 0, "y": 0, "w": 100, "h": 50 },   # top-left origin, y-down, px
        "rotation_deg":  0,
        "opacity":       1,
        "image":         { "data_url": "data:image/png;base64,...", "tint": [r,g,b,a] },  # kind=image
        "text":          { "characters": "...", "family": "Lilita One", "size": 36,
                           "color": [r,g,b,a], "align_h": "CENTER"|"LEFT"|"RIGHT",
                           "align_v": "TOP"|"CENTER"|"BOTTOM",
                           "outline_px": 0, "outline_color": [r,g,b,a],
                           "shadow_offset": [dx, dy], "shadow_color": [r,g,b,a] },   # kind=text
        "children":      []                                                            # kind=group
      }
    ]
  }

Flat-or-tree: both `children` nesting and a flat object list are valid. The
three.js loader handles both.
"""
from __future__ import annotations

VERSION = 1
