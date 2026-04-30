# Paper.io 2 Clone — Architecture Analysis

Reverse-engineered Paper.io 2 clone analyzed at `/mnt/c/projects/ai/webanim_convert/wasm_analysis_2/`:
- Recovery report: `abandoned_game_2/ANALYSIS.md` (10 KB)
- Cleaned source: `webcrack_out/synchrony_input.cleaned.js` (344 KB, 8620 lines)

This document captures findings from a deep dive on how that clone implements territory, capture, and rendering. Kept as a reference if we ever want to experiment with a polygon-based representation.

## Architecture overview

| Aspect | Paper.io 2 clone | Our captureArena |
|---|---|---|
| Renderer | Canvas 2D + WebGL2 batched primitives + Preact UI | Three.js + CanvasTexture on plane |
| Territory | **Polygon** (vertex list, mutable in place) | **Grid** (1024×1024 Uint8Array) |
| Trail | Polyline (`polyline` + simplified `simplyline`) | Polyline (`trailVerts`) |
| Capture detect | `Base.handleSelfIntersect()` (~line 4569) | Re-entry to own grid cell (`_stepCharacterTrail`) |
| Capture math | Shoelace area on simplified trail closed via "nearest base edge point" | Currently: extract contour, find arc, stamp polygon → rasterize |
| Multiplayer | Single-player only (local AI bots) | Yes (Colyseus, server-authoritative) |

## Key code locations in the clone

- Territory polygon ops: ~lines 4400–4640
- `Polygon.simplify()`: line 4044
- `Polygon.calcPath()` (Path2D builder): line 4027
- `handleSelfIntersect()`: line 4569
- `handleReturn()` (per-unit return-to-base): line 6635
- Bot capture-state AI: ~lines 4969–5050
- Polygon left/right (carve) ops: line 3924 / 3945
- Render loop fill: line 4443 (`ctx.fillStyle; ctx.fill(path)`)

## How they capture territory

1. Trail crosses own base polygon edge → `handleSelfIntersect()` fires.
2. `handleReturn(unit)` finds two indices into the polygon by linear scan (`findIndex` with object-identity comparison).
3. Splices trail points into the polygon points array, constructs a new polygon.
4. Area is computed via shoelace formula on the simplified trail closed through the nearest base-edge point.
5. If the trail cut another player's territory: builds two candidate polygons (`splice(...)`), keeps the one the victim is currently standing on, **throws away the other half**.

## How they render territory

Pure Canvas 2D. Each polygon mutation rebuilds a `Path2D`; the renderer just calls `ctx.fillStyle = color; ctx.fill(path)`. The browser tessellates internally. Trails are stroked: `ctx.stroke(track.polyline.path)`. Territory uses a two-pass fill (offset by ±5px) for a 3D bevel effect.

```js
// line 4443
function fillPolygon(ctx, path, color) {
  ctx.fillStyle = color;
  ctx.fill(path);
}
```

No triangulation, no GPU buffers. The browser does the heavy lifting.

## Performance characteristics

- **Capture cost:** O(trail_length + base_perimeter). For small/medium territories: microseconds. For huge territories: comparable to a 1024² grid scan (~10ms).
- **Per-frame cost:** unit update does linear scan over `polygon.simplify` (~50–500 vertices) for nearest-base-point. No grid scan exists. Orders of magnitude less work than walking 1M cells.
- **Memory:** `polygon.segments` grows linearly with capture count (no simplification on segments). After many captures, several thousand segments per base. `polygon.simplify` is bounded via 25px collapse threshold.

## Stability findings (the surprises)

### 1. Disconnected fragments are silently DELETED

When player A cuts player B's territory in two, the implementation builds two candidate polygons and keeps the one B is currently standing on. The other half just vanishes. No event, no animation, no transfer of ownership.

```js
// line ~6761 (paraphrased — uses obfuscated names in source)
const [polyA, polyB] = polygon.splice(...);
const survivor = polyA.inside(victim.pos) ? polyA : polyB;
victim.polygon = survivor;
// the other half is dropped on the floor
```

This is a **single-player-only shortcut**. In multiplayer it would be a bug — territory disappears with no synchronization event clients can replicate deterministically.

### 2. No floating-point tolerance constants

Polygon intersection decisions use raw sign comparisons (`rawSquare()` sign at line 6666) with no epsilon. In single-player, this is fine. In multiplayer, two clients running the same operation with slightly different float values can pick different sides → divergence.

### 3. Self-trail crossing handled separately

If a player crosses their OWN trail (not the base boundary), it triggers a kill (kill reason 4 at line 6683), not a polygon operation. The polygon code only handles base-boundary crossings.

## "Nearest base point" closure trick

Worth stealing. Each unit maintains `baseNearestPoint` updated each frame via linear scan over `polygon.simplify`:

```js
// line 5209 (paraphrased)
let bestDist = Infinity, bestPoint = null;
for (const p of base.polygon.simplify) {
  const d = head.distance2(p);
  if (d < bestDist) { bestDist = d; bestPoint = p; }
}
unit.baseNearestPoint = bestPoint;
```

When the trail returns to the base, the closure isn't done at the literal re-entry coordinate — it's done at this nearest base point. This produces visually smoother territory edges (no jagged "kink" where the trail meets the boundary).

**Portable to grid representation.** Don't need polygons to use this idea — scan boundary cells of own faction in the grid for the nearest cell to the trail's start/end, then close through there.

## Multiplayer fitness assessment

| Concern | Polygon approach | Grid approach |
|---|---|---|
| State sync via Colyseus | Variable-length lists rewriting on each capture | Fixed-size Uint8Array delta-syncs naturally |
| Determinism | Sign comparisons with no epsilon → cancellation risk | Integer ops, no FP, bulletproof |
| Bandwidth | Polygon update can be larger than trail polyline | Trail polyline is compact |
| Disconnected fragments | "Just delete it" hack incompatible with replicated state | BFS doesn't touch them; truly enclosed only |

The polygon approach is **architecturally hostile to multiplayer**. The clone's design choices (object identity, raw float compares, drop-the-fragment) all assume a single authoritative process.

## What's portable to a grid representation

- **The "nearest base point" closure idea** — applicable to any representation. Snap the trail closure to the nearest boundary cell.
- **The `simplify()` collapse threshold (25px)** — useful if we ever simplify the trail polyline before processing.
- **The two-pass fill bevel** — could be replicated on our texture by drawing twice with offset.

## What's NOT portable

- The polygon `insert/unsplice` ops — fundamentally tied to polygon storage.
- The `Path2D.fill()` rendering — we're under Three.js; would need triangulation per polygon.
- The fragment-deletion semantics — single-player only.

## Bottom line

Polygon approach wins on:
- Single-player visual polish
- Smooth boundaries
- Tiny memory
- Cheap capture math

Grid approach wins on:
- Multiplayer determinism
- Robust topology (no FP cancellation)
- Simple state sync
- Predictable cost
- Fits our existing renderer

For our project (server-authoritative Colyseus multiplayer), the grid + flood-fill approach is the better fit. Polygon experimentation should happen in a branch if we ever want to explore it for a single-player variant.
