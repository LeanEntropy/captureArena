# Territory System Review Feedback

Reviewer's analysis of our polygon-based territory system. Received 2026-04-29.

## Critical Issues Identified

1. **Using floating-point Martinez/polygon-clipping for live gameplay** — numerically fragile
2. **Single polygon representation** — should be MultiPolygon with holes
3. **"Largest polygon" selection after boolean** — destroys valid territory fragments
4. **Closest vertex instead of closest edge/intersection** — creates skinny triangles and micro-loops
5. **Post-boolean cleanup instead of pre-boolean prevention** — aggressive RDP (0.12) destroys valid topology
6. **2D problem treated as 3D** — unnecessary complexity

## Recommended Stack

- **Clipper2 WASM** (integer-based clipping) instead of polygon-clipping (Martinez-Rueda)
- **SCALE = 1000** for fixed-point coordinates (world [-25,25] → integer [-25000,25000])
- **Edge projection** for trail exit/entry instead of closest vertex
- **MultiPolygon** territory representation
- **Conservative cleanup** (RDP ε=0.025-0.04, not 0.12)
- **Clipper offset** for morphological sliver cleanup: `offset(offset(poly, -0.04), +0.04)`
- **earcut.deviation()** for triangulation validation
- **Visual expand +0.015** for rendering (hide hairline gaps)

## Two Architecture Options

### Option A: Clipper2 Fixed-Point Polygons (7-day prototype)
Replace polygon-clipping with Clipper2 integer clipping. Fix edge projection, MultiPolygon support, conservative cleanup.

### Option B: Grid-First Gameplay (serious multiplayer)
384x384 or 512x512 ownership grid. Rasterize trail polygons. Marching squares contour → simplified polygon → Earcut mesh for rendering.

## Key Parameters
```
SCALE = 1000
MIN_POINT_DIST = 0.28
MIN_EDGE_LENGTH = 0.04
COLLINEAR_EPS = 0.025
TRAIL_RDP_EPS = 0.03
POST_BOOLEAN_RDP_EPS = 0.025
MIN_CAPTURE_AREA = 0.08
MIN_FRAGMENT_AREA = 0.05
SLIVER_OFFSET = 0.04
MAX_EARCUT_DEVIATION = 1e-4
VISUAL_EXPAND = 0.015
MAX_TERRITORY_VERTICES = 600
MAX_TRAIL_POINTS = 300
```
