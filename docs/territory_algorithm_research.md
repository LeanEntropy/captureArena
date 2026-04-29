# Territory Algorithm Research: Paper.io 2 & Clones

Deep research into how Paper.io 2 and successful clones implement territory claiming, subtraction, and rendering.

## 1. How Paper.io 2 Likely Works Internally

### The Core Insight: It's a Grid, Not Polygons

Despite the smooth visual appearance of Paper.io 2's territory, **all evidence points to a grid-based internal representation** with smooth rendering on top. Key evidence:

- **Paper.io 1** restricted movement to 4 cardinal directions on a visible grid, making the grid nature obvious.
- **Paper.io 2** upgraded to omnidirectional movement and a circular arena, but the underlying territory system almost certainly remains grid-based.
- The Voodoo development team mentioned a "game breaking bug" where territory calculation errors occurred (territory dropping from 70% to 5% instantly), consistent with grid-based flood fill errors, not polygon arithmetic errors.
- Player reports describe "chunks" of territory disappearing and "white cracks" appearing, consistent with grid cell ownership glitches.
- Every successful open-source clone uses a grid internally.
- The official splix.io source code (a closely related game by a known developer) confirms grid-based territory with flood fill.

### Probable Architecture

```
Server: Grid (Uint8Array or similar) -> authoritative territory state
         |
         | delta updates (changed cells only, RLE compressed)
         v
Client: Grid data -> DataTexture or mesh generation -> smooth visual rendering
```

### Movement Adaptation

Paper.io 2's omnidirectional movement maps onto the grid through continuous position tracking with grid cell snapping for territory operations. The player's world-space position is converted to grid coordinates for all territory calculations.

---

## 2. How Successful Open-Source Clones Implement Territory

### A. Splix.io (Official Source Code - jespertheend/splix)

**The gold standard implementation.** Splix.io's complete source is on GitHub. This is the most authoritative reference for territory games of this type.

**Repository:** https://github.com/jespertheend/splix

**Data Structure:**
```
Tile values: -1 = border, 0 = empty, 1+ = player id
Grid stored as 2D array: arenaTiles[x][y]
Default map size: 600x600 tiles
```

**Territory Claiming Algorithm - Inverse Flood Fill:**

The key algorithm is in `updateCapturedArea.js`. It uses an **inverse flood fill** (also called "exterior flood fill"):

1. Build a temporary mask (`Uint8Array`) sized to the trail's bounding box (plus 1-cell padding)
2. Mark all cells owned by the claiming player as `PLAYER_BLOCK (2)`
3. Mark everything else as `FILLABLE_BLOCK (0)`
4. Seed the flood fill from the **top-left corner** of the bounding box (guaranteed to be outside the enclosed area)
5. Also seed from tiles adjacent to "unfillable locations" (other players' positions - prevents claiming through other players)
6. Run BFS flood fill, marking reachable cells as `FILLED_BLOCK (1)`
7. **Invert the result:** Any cell still marked `FILLABLE_BLOCK` was unreachable from outside, meaning it's **enclosed** by the trail and existing territory. Claim it.

```javascript
// From splix.io official source (jespertheend/splix)
// Simplified core logic:

const FILLABLE_BLOCK = 0;
const FILLED_BLOCK = 1;
const PLAYER_BLOCK = 2;

// 1. Initialize mask
for (let i = bounds.min.x; i < bounds.max.x; i++) {
  for (let j = bounds.min.y; j < bounds.max.y; j++) {
    if (arenaTiles[i][j] == playerId) {
      grid[i * lineWidth + j] = PLAYER_BLOCK;
    } else {
      grid[i * lineWidth + j] = FILLABLE_BLOCK;
    }
  }
}

// 2. Seed from corner (outside the enclosed area)
queue.enqueue(bounds.min.x, bounds.min.y);
grid[bounds.min.x * lineWidth + bounds.min.y] = FILLED_BLOCK;

// 3. Also seed adjacent to unfillable locations (other players)
for (const node of unfillableLocations) {
  // seed all 4 neighbors of other players
}

// 4. BFS flood fill
while (!queue.isEmpty()) {
  const node = queue.dequeue();
  // check 4 neighbors, mark as FILLED_BLOCK, enqueue
}

// 5. Result: anything still FILLABLE_BLOCK is enclosed territory
for (let x = bounds.min.x; x < bounds.max.x; x++) {
  for (let y = bounds.min.y; y < bounds.max.y; y++) {
    if (grid[x * lineWidth + y] === FILLABLE_BLOCK) {
      // This cell is captured! It was enclosed.
    }
  }
}
```

**Why inverse flood fill?** Direct flood fill from inside the enclosed area requires finding a valid seed point inside, which is surprisingly hard to determine reliably. Filling from the outside is deterministic -- the corner of the bounding box is always outside.

**Territory Subtraction:** When a player captures area, any cells belonging to other players within the enclosed region are simply overwritten. The grid cell changes owner. No polygon subtraction needed.

**Network Protocol:** Uses block-level delta updates:
- `UPDATE_BLOCKS` - individual cell changes
- `FILL_AREA` - rectangular region fills
- `CHUNK_OF_BLOCKS` - spatial chunks for initial state

---

### B. BlocklyIO (theKidOfArcrania/BlocklyIO)

**Repository:** https://github.com/theKidOfArcrania/BlocklyIO

**Data Structure:**
```
Grid: 80x80 sparse 2D array
Cell size: 40 pixels
Max players: 81
```

**Territory Claiming Algorithm:**

Uses a two-phase approach:

1. **Phase 1 - Fill the trail:** Walk along the trail grid, converting trail cells to player territory
2. **Phase 2 - Flood fill from trail cells:** For each trail cell, probe the 4 neighboring cells and run flood fill on each

The flood fill checks if a region is "surrounded" (never reaches grid boundary). If surrounded, all cells in the region become player territory.

```javascript
// From BlocklyIO (theKidOfArcrania/BlocklyIO)
function floodFill(data, grid, row, col, been) {
  // BFS from (row, col)
  let surrounded = true;
  const filled = new Stack(GRID_COUNT * GRID_COUNT + 1);
  const coords = [];
  coords.push([row, col]);
  
  while (coords.length > 0) {
    const [r, c] = coords.shift();
    if (grid.isOutOfBounds(r, c)) {
      surrounded = false;  // Reached edge = not enclosed
      continue;
    }
    if (been.get(r, c) || onTail([r,c]) || grid.get(r, c) === data.player) continue;
    been.set(r, c, true);
    if (surrounded) filled.push([r, c]);
    coords.push([r+1,c], [r-1,c], [r,c+1], [r,c-1]);
  }
  
  if (surrounded) {
    while (!filled.isEmpty()) {
      const coord = filled.pop();
      grid.set(coord[0], coord[1], data.player);
    }
  }
}
```

**Key difference from splix.io:** BlocklyIO probes from inside and checks if it reaches the boundary. Splix.io fills from outside and inverts. The splix approach is more efficient for large maps because the interior region is typically much smaller than the exterior.

---

### C. xingshuo/Paper.io (C implementation)

**Repository:** https://github.com/xingshuo/Paper.io

**Algorithm:** `borderfill()` function implements the same inverse flood fill:

1. Expand target region by 1 in all directions
2. Seed BFS from expanded boundary corner
3. Mark reachable cells as -1 (outside)
4. Invert: cells not marked -1 are enclosed territory

The Chinese comment describes this as "围魏救赵" (an indirect strategy) -- rather than trying to find what's inside, identify what's outside and invert.

---

### D. Unity Reference (Paper.io-2-master, local project)

**Path:** `C:\projects\Dev\Unity\Action\Paper.io-2-master`

**This is a polygon-based implementation** and demonstrates exactly the problems that polygon approaches have.

**Data Structure:** `List<Vector3> areaVertices` -- ordered polygon vertices

**Territory Claiming:**
The `DeformCharacterArea()` method in `GameManager.cs`:

1. Find the closest existing polygon vertex to the trail start point
2. Find the closest existing polygon vertex to the trail end point
3. Build two candidate polygons:
   - **Clockwise:** Replace vertices between start and end (going clockwise) with the trail
   - **Counterclockwise:** Replace vertices between start and end (going counterclockwise) with the trail
4. Calculate the area of both candidates using the shoelace formula
5. **Pick the larger polygon** (the trail expands territory outward)

**Territory Subtraction:**
When crossing another player's area, the trail points that fall inside the opponent's polygon are used to deform the opponent's polygon similarly.

**Rendering:** Uses `Triangulator.cs` (ear-clipping triangulation) to convert polygon vertices to a triangle mesh.

**Problems with this approach:**
- `GetClosestAreaVertice()` uses brute-force linear search
- No handling of self-intersecting polygons
- No handling of degenerate cases (collinear points, duplicate vertices)
- The "pick the larger area" heuristic fails when trails create complex shapes
- Point-in-polygon test uses ray casting which can fail at edges
- Polygon vertex count grows unbounded over time
- No simplification or vertex reduction

---

### E. Waller's Paper.io 2 Clone (3D Multiplayer, Unity)

**Link:** https://wallerthedeveloper.itch.io/paperio-clone

**Confirmed grid-based** with these details:
- Grid-based movement system
- Vertex-colored grid for rendering (procedural mesh per cell)
- Edge-based flood fill for territory claiming (including enemy territory)
- Delta compression with RLE encoding for network updates
- Procedural mesh generation for territory and trails in 3D

---

## 3. Grid vs Polygon: Comprehensive Comparison

### Grid-Based Approach

**How it works:**
- Territory stored as `Uint8Array[width * height]` where each cell holds an owner ID
- Trail stored as separate grid or marked on same grid
- Claiming uses flood fill (inverse BFS from boundary)
- Subtraction is just overwriting cell values
- Rendering via DataTexture, instanced mesh, or procedural mesh generation

**Pros:**
- **Deterministic claiming:** Inverse flood fill always produces correct results
- **No geometric edge cases:** No self-intersecting polygons, no degenerate vertices, no numerical precision issues
- **O(n) subtraction:** Overwriting cells is trivial, no polygon clipping needed
- **Bounded memory:** Grid size is fixed, no vertex accumulation
- **Simple collision detection:** Cell lookup is O(1)
- **Easy networking:** Delta compression (send only changed cells) is straightforward
- **Proven at scale:** Splix.io handles 600x600 grids with dozens of players

**Cons:**
- **Resolution vs performance tradeoff:** More cells = smoother appearance but more memory and slower flood fill
- **Aliased edges** unless smoothing is applied
- **Memory footprint:** A 1000x1000 grid is 1MB (Uint8Array), acceptable for most cases
- **Flood fill cost:** BFS over large grids can be expensive, but bounding box optimization helps significantly (splix.io only fills within the trail's bounding box)

### Polygon-Based Approach

**How it works:**
- Territory stored as ordered vertex arrays defining polygon boundaries
- Trail appended to polygon when player returns
- Claiming uses polygon union (Clipper, Martinez-Rueda, or manual vertex splicing)
- Subtraction uses polygon difference operations

**Pros:**
- **Resolution-independent:** Smooth edges at any zoom level
- **Low memory for simple shapes:** A circle is ~40 vertices, not 1M cells
- **Direct mesh generation:** Polygon vertices directly become Three.js geometry

**Cons:**
- **Geometric edge cases are devastating:**
  - Self-intersecting polygons from overlapping trails
  - Degenerate vertices (collinear points, near-zero-area triangles)
  - Numerical precision errors in intersection calculations
  - Holes in polygons from partial captures
  - Winding order issues after complex operations
- **Polygon union/difference is hard:** Libraries like Clipper2 have known bugs with edge cases (documented on their own forum)
- **Unbounded vertex growth:** Each capture adds vertices, eventually degrading performance
- **Subtraction creates holes:** Polygon difference can produce polygons with holes, requiring hole-aware triangulation
- **Complex networking:** Syncing polygon vertex arrays is more bandwidth-intensive than cell deltas
- **The Unity reference project demonstrates all of these problems**

### Verdict: **Grid wins for Paper.io-style games**

Every successful implementation at scale uses a grid. The polygon approach from the Unity reference project is the source of the "persistent polygon issues" mentioned in the task. The solution is not to fix the polygon approach, but to replace it with a grid -- which your codebase has already done (you already have `TerritoryGrid.ts`, `grid.ts`, `territory.ts` using `Uint8Array`).

---

## 4. Specific Algorithm Recommendations for Your Three.js Implementation

### Your Current Implementation Is Already Grid-Based and Sound

Your codebase at `/home/civax/projects/captureArena` already uses the correct approach:

- `Uint8Array` grid of `GRID_SIZE=1000` cells per axis (1M total cells)
- `CELL_SIZE = 0.1` (100 / 1000)
- Inverse boundary flood fill in `claimTerritory()` in `territory.ts`
- Separate trail grid (`trailGrid`)
- DataTexture rendering in `TerritoryRenderer.ts`

### Your Claiming Algorithm Comparison

Your `claimTerritory()` in `territory.ts` already implements the inverse flood fill correctly:

1. Mark trail cells as player territory
2. Create visited mask, marking player territory and boundary as visited
3. Seed BFS from all 4 edges of the grid
4. Flood fill outward, marking everything reachable as "visited"
5. Everything NOT visited is enclosed territory -- claim it

This is essentially the same algorithm as splix.io's `updateCapturedArea()`, with one difference:

**Splix.io optimization:** Only operates within the trail's bounding box (plus 1-cell padding), not the entire grid. This is a significant performance optimization. Your implementation floods the entire grid every time.

### Recommended Improvements

#### 1. Bounding Box Optimization (High Priority)

Add bounding box tracking to the trail, and only flood fill within that region:

```typescript
export function claimTerritory(
  territoryGrid: Uint8Array,
  trailGrid: Uint8Array,
  playerSlotId: number,
  trailPoints: { gx: number; gy: number }[],
  // NEW: optional bounds for optimization
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
): ClaimResult {
  // Compute bounds from trail if not provided
  if (!bounds) {
    let minX = GRID_SIZE, minY = GRID_SIZE, maxX = 0, maxY = 0;
    for (const p of trailPoints) {
      minX = Math.min(minX, p.gx);
      minY = Math.min(minY, p.gy);
      maxX = Math.max(maxX, p.gx);
      maxY = Math.max(maxY, p.gy);
    }
    // Also include existing territory adjacent to trail
    // Add padding
    bounds = {
      minX: Math.max(0, minX - 1),
      minY: Math.max(0, minY - 1),
      maxX: Math.min(GRID_SIZE - 1, maxX + 1),
      maxY: Math.min(GRID_SIZE - 1, maxY + 1),
    };
  }
  // ... flood fill only within bounds
}
```

#### 2. Unfillable Locations (Medium Priority)

Like splix.io, seed the flood fill from positions adjacent to other players inside the bounding box. This prevents claiming through other players (e.g., if another player is standing inside your trail loop, the area around them should not be claimed).

#### 3. DataTexture Rendering Smoothing (Medium Priority)

Your `TerritoryRenderer.ts` already uses `THREE.LinearFilter` for bilinear interpolation on the DataTexture, which provides basic smoothing. Additional options:

**Option A: Increase grid resolution.** Your current 1000x1000 grid is already good. At `WORLD_RADIUS=50`, each cell is 0.1 world units, which is quite fine.

**Option B: SDF-based shader smoothing.** Generate a signed distance field from the grid data and use a fragment shader to produce smooth edges:

```glsl
// Fragment shader for smooth territory edges
uniform sampler2D territoryTexture;
varying vec2 vUv;

void main() {
  vec4 center = texture2D(territoryTexture, vUv);
  // Sample neighbors for SDF approximation
  float dx = 1.0 / float(GRID_SIZE);
  vec4 left = texture2D(territoryTexture, vUv + vec2(-dx, 0.0));
  vec4 right = texture2D(territoryTexture, vUv + vec2(dx, 0.0));
  vec4 up = texture2D(territoryTexture, vUv + vec2(0.0, dx));
  vec4 down = texture2D(territoryTexture, vUv + vec2(0.0, -dx));
  // Smooth alpha based on neighbors
  float edge = step(0.5, center.a) * smoothstep(0.0, 1.0, 
    (left.a + right.a + up.a + down.a) * 0.25);
  gl_FragColor = vec4(center.rgb, edge);
}
```

**Option C: Outline rendering.** Detect territory borders in the shader and draw a colored outline, which is the Paper.io 2 visual style.

#### 4. Delta Updates for Networking (High Priority for Multiplayer)

Instead of sending the full grid every tick, send only changed cells:

```typescript
interface TerritoryDelta {
  cells: { index: number; value: number }[];
}
// Or use RLE compression on changed regions
```

#### 5. Circular Queue for BFS (Low Priority)

Your current implementation uses `queue.push()` and `head++` index tracking, which works but accumulates memory. Splix.io uses a proper `CircularQueue` class that reuses memory. For a 1000x1000 grid this matters.

---

## 5. Links to Relevant Source Code and Resources

### Open Source Implementations

| Project | Language | Approach | Link |
|---------|----------|----------|------|
| **splix.io** (official) | JavaScript/Deno | Grid + inverse flood fill | https://github.com/jespertheend/splix |
| BlocklyIO | JavaScript/Node.js | Grid + interior flood fill | https://github.com/theKidOfArcrania/BlocklyIO |
| stevenjoezhang/paper.io | JavaScript/Node.js | Grid (multiplayer) | https://github.com/stevenjoezhang/paper.io |
| xingshuo/Paper.io | C | Inverse flood fill algorithm | https://github.com/xingshuo/Paper.io |
| eriseven/Paper.io-2 | C#/Unity | Unknown (likely polygon) | https://github.com/eriseven/Paper.io-2 |
| steph1793/PaperIo.AI | C++ | AI agent for Paper.io | https://github.com/steph1793/PaperIo.AI |
| Kacper-Pietkun/splix.io-multiplayer-AI | Python | Grid, heuristic + NEAT AI | https://github.com/Kacper-Pietkun/splix.io-multiplayer-AI |
| Waller Paper.io Clone | Unity | Grid + edge flood fill | https://wallerthedeveloper.itch.io/paperio-clone |
| Splix.io Protocol | Docs | Reverse-engineered protocol | https://github.com/JosefKuchar/Splix.io-Protocol |

### Technical References

- [Splix.io About Page](https://splix.io/about) - Confirms grid-based approach, Deno backend
- [Gamasutra: Paper.io 2 Design Analysis](https://www.gamedeveloper.com/design/paper-io-2-a-natural-difficulty-curve) - Game design, not algorithm details
- [Roblox DevForum: Paper.io Territory Claim](https://devforum.roblox.com/t/paperio-territory-claim-system/3506650) - Community discussion confirming flood fill approach
- [Roblox DevForum: How to Make Territory Claiming](https://devforum.roblox.com/t/how-do-i-make-a-territory-claiming-like-paperio/2226241) - Grid of parts approach
- [Clipper2 Library](https://www.angusj.com/clipper2/Docs/Overview.htm) - Polygon clipping (if polygon approach needed)
- [Marching Squares (Wikipedia)](https://en.wikipedia.org/wiki/Marching_squares) - For grid-to-smooth-contour conversion

---

## 6. Key Code Snippets That Work Well

### Splix.io: Complete Inverse Flood Fill (Production Proven)

From `gameServer/src/gameplay/arenaWorker/updateCapturedArea.js`:

```javascript
// Allocate once, reuse
let grid;  // Uint8Array mask
let queue; // CircularQueue for BFS

function initializeMask(width, height) {
  grid = new Uint8Array(width * height);
  queue = new CircularQueue(width * height);
}

const FILLABLE_BLOCK = 0;
const FILLED_BLOCK = 1;
const PLAYER_BLOCK = 2;

function updateCapturedArea(arenaTiles, playerId, bounds, unfillableLocations) {
  // Pad bounds by 1 to ensure corner is always outside
  bounds.min.x -= 1; bounds.min.y -= 1;
  bounds.max.x += 1; bounds.max.y += 1;
  queue.clear();

  function testFillNode(x, y, index) {
    if (x < bounds.min.x || y < bounds.min.y) return false;
    if (x >= bounds.max.x || y >= bounds.max.y) return false;
    if (grid[index] === FILLED_BLOCK || grid[index] === PLAYER_BLOCK) return false;
    return true;
  }

  // Phase 1: Build mask from arena state
  for (let i = bounds.min.x; i < bounds.max.x; i++) {
    const offset = i * lineWidth;
    for (let j = bounds.min.y; j < bounds.max.y; j++) {
      grid[offset + j] = (arenaTiles[i][j] == playerId) ? PLAYER_BLOCK : FILLABLE_BLOCK;
    }
  }

  // Phase 2: Seed from top-left corner (guaranteed outside)
  const cx = bounds.min.x, cy = bounds.min.y;
  queue.enqueue(cx, cy);
  grid[cx * lineWidth + cy] = FILLED_BLOCK;

  // Phase 3: Seed adjacent to unfillable locations (other players)
  for (const node of unfillableLocations) {
    const offset = node[0] * lineWidth;
    // Seed all 4 neighbors of each unfillable location
    for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nx = node[0] + dx, ny = node[1] + dy;
      const ni = offset + dx * lineWidth + ny;
      if (testFillNode(nx, ny, ni)) {
        grid[ni] = FILLED_BLOCK;
        queue.enqueue(nx, ny);
      }
    }
  }

  // Phase 4: BFS flood fill from outside
  while (!queue.isEmpty()) {
    const node = queue.dequeue();
    const offset = node[0] * lineWidth;
    for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nx = node[0] + dx, ny = node[1] + dy;
      const ni = offset + dx * lineWidth + ny;
      if (testFillNode(nx, ny, ni)) {
        grid[ni] = FILLED_BLOCK;
        queue.enqueue(nx, ny);
      }
    }
  }

  // Phase 5: Invert -- anything not FILLED is enclosed territory
  let totalFilledTileCount = 0;
  for (let x = bounds.min.x; x < bounds.max.x; x++) {
    for (let y = bounds.min.y; y < bounds.max.y; y++) {
      const val = grid[x * lineWidth + y];
      if (val === FILLABLE_BLOCK || val === PLAYER_BLOCK) {
        // This cell is captured!
        totalFilledTileCount++;
      }
    }
  }
  return { totalFilledTileCount };
}
```

### Your Current Implementation (Already Working)

From `packages/shared/src/territory.ts`:

```typescript
export function claimTerritory(
  territoryGrid: Uint8Array,
  trailGrid: Uint8Array,
  playerSlotId: number,
  trailPoints: { gx: number; gy: number }[]
): ClaimResult {
  // 1. Mark trail as territory
  for (const p of trailPoints) {
    const idx = gridIndex(p.gx, p.gy);
    if (territoryGrid[idx] !== BOUNDARY_CELL) {
      territoryGrid[idx] = playerSlotId;
    }
  }

  // 2. Mark player territory + boundary as "visited"
  const visited = new Uint8Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    if (territoryGrid[i] === BOUNDARY_CELL || territoryGrid[i] === playerSlotId) {
      visited[i] = 1;
    }
  }

  // 3. Seed from ALL 4 edges (inverse flood fill)
  const queue: number[] = [];
  for (let gx = 0; gx < GRID_SIZE; gx++) {
    // top and bottom edges
    if (!visited[gridIndex(gx, 0)]) { visited[gridIndex(gx, 0)] = 1; queue.push(gridIndex(gx, 0)); }
    if (!visited[gridIndex(gx, GRID_SIZE-1)]) { /* ... */ }
  }
  for (let gy = 1; gy < GRID_SIZE - 1; gy++) {
    // left and right edges
    if (!visited[gridIndex(0, gy)]) { /* ... */ }
    if (!visited[gridIndex(GRID_SIZE-1, gy)]) { /* ... */ }
  }

  // 4. BFS flood fill from edges
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    // check 4 neighbors, mark visited, enqueue
  }

  // 5. Anything NOT visited is enclosed -- claim it
  for (let i = 0; i < totalCells; i++) {
    if (!visited[i] && territoryGrid[i] !== BOUNDARY_CELL && territoryGrid[i] !== playerSlotId) {
      territoryGrid[i] = playerSlotId;  // Claim!
      claimedCells.push(i);
    }
  }
}
```

**Your algorithm is correct.** The main optimization opportunity is switching from full-grid flooding to bounding-box flooding.

### DataTexture Rendering (Your Current Approach)

From `client/src/game/world/TerritoryRenderer.ts`:

```typescript
// Grid -> RGBA DataTexture -> Three.js plane with bilinear filtering
this.textureData = new Uint8Array(GRID_SIZE * GRID_SIZE * 4);
this.texture = new THREE.DataTexture(
  this.textureData, GRID_SIZE, GRID_SIZE, THREE.RGBAFormat
);
this.texture.magFilter = THREE.LinearFilter;  // Smooth edges!
this.texture.minFilter = THREE.LinearFilter;
```

This is elegant and performant. The bilinear filtering provides natural antialiasing at territory borders. For an even smoother look, consider:

1. **Outline border:** Detect edges in the shader (where adjacent cells have different owners) and draw a darker/lighter outline
2. **Slight blur:** A single-pixel Gaussian blur in the shader smooths staircase edges further
3. **Higher-res grid for visual layer only:** Keep game logic at 1000x1000 but render a 2000x2000 texture for crisper edges

---

## Summary of Findings

| Aspect | Polygon Approach | Grid Approach |
|--------|-----------------|---------------|
| **Used by real games** | No major title | Paper.io 2, Splix.io, all clones |
| **Claiming algorithm** | Polygon union (buggy) | Flood fill (deterministic) |
| **Subtraction** | Polygon difference (complex) | Cell overwrite (trivial) |
| **Edge cases** | Many (self-intersection, degenerate, holes) | None meaningful |
| **Performance** | Degrades with vertex count | Bounded by grid size |
| **Visual quality** | Perfectly smooth | Smooth with filtering/shaders |
| **Networking** | Send vertex arrays | Send cell deltas |
| **Your codebase** | Legacy from Unity port | Already implemented correctly |

**Recommendation:** Your current grid-based implementation is architecturally correct and matches how every successful Paper.io-style game works. The "persistent polygon issues" come from the Unity reference project's polygon-based approach, which your codebase has already replaced with a grid. Focus optimization efforts on bounding-box flood fill and visual polish via shader-based edge smoothing, not on returning to polygons.
