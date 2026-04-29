# Capture Arena — Technical Design Spec

**Date**: 2026-04-29
**Deadline**: 2026-05-01 13:37 UTC
**Stack**: Three.js + Colyseus + Vite + Zustand, pnpm monorepo

## 1. Architecture Overview

```
packages/shared/       → Types, constants, grid math, protocol definitions
packages/simulation/   → Game simulation (territory grid, movement, trail, claiming, collisions, AI)
server/                → Colyseus server, GameRoom, schema sync
client/                → Three.js renderer, input, HUD, networking
```

**Data flow:**
- Input: Client InputHandler → Colyseus message (heading direction) → Server → Simulation.queueInput
- State: Simulation tick → Colyseus Schema sync → Client Store → Renderer
- Single-player: Client InputHandler → LocalGame → Simulation → Store → Renderer

## 2. World & Grid

- **Arena**: Circular, world radius = 50 units, centered at (0, 0)
- **Territory grid**: 400x400 `Uint8Array`, flat array indexed `y * GRID_SIZE + x`
- **Cell values**: 0 = unclaimed, 1–255 = player owner slot ID
- **Coordinate mapping**:
  - World → Grid: `gx = Math.floor((wx + WORLD_RADIUS) / CELL_SIZE)`, same for gy
  - Grid → World: `wx = gx * CELL_SIZE - WORLD_RADIUS + CELL_SIZE / 2`
  - `CELL_SIZE = (WORLD_RADIUS * 2) / GRID_SIZE = 0.25 units`
- **Circular boundary**: Cells outside the circle radius are marked as `255` (boundary, impassable). Precomputed at init.

## 3. Player State

```typescript
interface SimPlayer {
  id: string;
  slotId: number;          // 1-254, used as grid cell value
  x: number;               // continuous world position
  y: number;
  heading: number;         // current heading in radians
  targetHeading: number;   // input-driven target heading
  speed: number;           // units per second (constant ~4)
  turnRate: number;        // radians per second for steering
  trail: { x: number; y: number }[];  // trail points while outside territory
  alive: boolean;
  respawnTimer: number;    // countdown in seconds (0 = alive)
  invulnTimer: number;     // countdown in seconds (0 = vulnerable)
  killCount: number;
  territoryCount: number;  // cached cell count for score
  name: string;
  color: number;           // hex color
}
```

## 4. Movement System

Each tick (50ms at 20Hz):

1. **Steer**: Lerp `heading` toward `targetHeading` at `turnRate * dt`. Use shortest-angle rotation.
2. **Advance**: `x += cos(heading) * speed * dt`, `y += sin(heading) * speed * dt`
3. **Boundary check**: If `sqrt(x² + y²) > WORLD_RADIUS` → kill player
4. **Grid position**: Compute current grid cell from (x, y)
5. **Territory check**: Is current cell owned by this player?
   - If was outside territory and now on own territory → **claim** (see Section 6)
   - If outside own territory → **record trail point**

## 5. Trail System

- **Recording**: Every tick while outside own territory, push `{x, y}` to the player's trail array.
- **Max trail length**: 2000 points (~100 seconds of trail). If exceeded, kill the player (prevents infinite trails).
- **Trail collision detection**: Each tick, for each player that moved:
  - Compute their current grid cell
  - Check if that cell is occupied by any other player's trail (use a separate `Uint8Array` trail grid, 400x400, stores trail owner slot IDs)
  - If cell has a trail from a different player → that trail owner dies, moving player gets the kill
  - If cell has the player's own trail (and trail length > minimum threshold) → self-intersection → player dies
- **Trail grid**: Updated each tick — when a trail point is recorded, rasterize it to the trail grid. When a player dies or claims, clear their trail from the trail grid.

## 6. Territory Claiming Algorithm

Triggered when a player returns to their own territory after having a trail:

1. **Rasterize trail to territory grid**: For each consecutive pair of trail points, run Bresenham's line algorithm to mark intermediate grid cells as owned by the player.
2. **Also mark the trail on the territory grid**: All trail cells → player's slotId.
3. **Edge-seeded BFS flood fill**:
   - Create a `visited` boolean array (400x400), pre-mark all boundary cells (255) as visited
   - Seed queue with all grid-edge cells (row 0, row 399, col 0, col 399) that are NOT owned by the claiming player and NOT boundary (255). Also seed from any non-boundary, non-player cell adjacent to a boundary cell (ensures the flood enters from the circular edge).
   - BFS in 4 directions: visit all reachable cells that are NOT owned by the claiming player and NOT boundary
   - After BFS completes: every unvisited, non-boundary cell that is NOT already owned by the claiming player → set to player's slotId (these are the enclosed cells)
4. **Territory stealing**: Any cells that were owned by another player and are now overwritten → decrement that player's territoryCount, increment the claiming player's.
5. **Update territory counts**: Recount the claiming player's cells (or maintain incrementally).
6. **Clear trail**: Empty the player's trail array, clear their entries from the trail grid.

**Performance**: BFS over 160K cells at 20Hz only happens when a player completes a claim (not every tick). Typical frequency: once every 3-10 seconds per player. Budget: <5ms per claim.

## 7. Death & Respawn

**Death triggers** (checked each tick):
- Trail collision (another player hits your trail)
- Self-intersection (you hit your own trail)
- Boundary escape (position outside world radius)

**On death**:
- `alive = false`, `respawnTimer = 3.0`
- Clear trail from trail grid
- Emit death event (position, killer ID) for VFX
- Territory is NOT removed

**Respawn** (when respawnTimer reaches 0):
- Find spawn position: random angle, radius = WORLD_RADIUS * 0.3–0.7, must be >15 units from all alive players
- Grant starting territory: fill a circle of radius 5 cells around spawn grid position
- `alive = true`, `invulnTimer = 2.0`
- During invulnerability: player cannot be killed by trail collisions (but can still die to boundary)

## 8. AI Bots

**States**: `expanding`, `attacking`, `returning`

- **Expanding**: Pick a target point outside territory (adjacent unclaimed area), steer toward it. After traveling 5-15 units, switch to `returning`.
- **Returning**: Steer back toward nearest own territory cell. On arrival, claim triggers automatically.
- **Attacking**: If enemy territory is nearby, target a point inside it, then return. Lower probability, higher risk.
- **Survival**: If another player is close and the bot has a long trail, switch to `returning` immediately.
- **Steering**: Set `targetHeading` toward target point. Add slight noise for natural-looking curves.
- **Difficulty knobs**: `speed` (3.5–4.5), `turnRate` (2–4 rad/s), `loopSize` (5–15 units), `attackProbability` (0.1–0.3).

## 9. Colyseus Schema

```typescript
class PlayerSchema extends Schema {
  @type("uint8") slotId: number;
  @type("float32") x: number;
  @type("float32") y: number;
  @type("float32") heading: number;
  @type("boolean") alive: boolean;
  @type("float32") respawnTimer: number;
  @type("float32") invulnTimer: number;
  @type("uint16") killCount: number;
  @type("uint16") territoryCount: number;
  @type("string") name: string;
  @type("uint32") color: number;
  // Trail synced as a separate message (not schema) to avoid per-point schema overhead
}

class GameStateSchema extends Schema {
  @type("uint8") version: number;
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  // Territory grid synced as raw binary via room.broadcast (not schema — too large for schema diffing)
}
```

**Territory sync strategy**:
- On join: send full 400x400 grid as binary ArrayBuffer
- On claim events: send delta patch `{ slotId, cells: [gridIndex, ...] }` — only the cells that changed
- Client maintains local copy of the grid, applies patches

**Trail sync**:
- Broadcast trail updates per player as messages: `{ playerId, trail: [{x,y}, ...] }` at reduced rate (5Hz) or on claim/death
- Client interpolates trail points between updates

## 10. Client Rendering (Three.js)

### Territory
- `PlaneGeometry` covering the world area
- `DataTexture` (400x400, RGBA format) mapped onto the plane
- Each cell: RGB = owner's color, A = 255 if owned, 0 if unclaimed
- `texture.magFilter = THREE.LinearFilter` for smooth edges
- Update texture data when territory changes, call `texture.needsUpdate = true`
- Slight Y offset (0.01) above ground plane to prevent z-fighting

### Trail
- Per-player: `BufferGeometry` ribbon/tube built from trail points
- Use Catmull-Rom spline interpolation for smooth curves
- Rebuild geometry when trail points update
- Material: `MeshBasicMaterial` with player color, slight transparency, emissive glow via `AdditiveBlending`

### Player Character
- Small 3D model: box body + smaller box head (like Paper.io 2's blocky characters)
- Rotates to face heading direction
- Pulsing/flashing effect during invulnerability
- Name label above (HTML overlay or sprite)

### Camera
- Perspective camera, top-down with ~60° tilt
- Follows local player with smooth damping
- Height ~20 units above ground
- Slight zoom-out when player is moving fast

### Ground
- Large plane with light neutral color
- Faint grid lines or dot pattern for spatial reference
- Circular arena border: `RingGeometry` or line circle at world radius

### Particles
- On death: spawn 20-30 small colored cubes that scatter outward and fade (simple particle system using `Points` or instanced meshes)

## 11. Client Architecture

```
main.ts                    → Entry point, mode selection, game start
game/Game.ts               → Three.js scene setup, render loop
game/InputHandler.ts       → Mouse/touch/keyboard → target heading
game/CameraRig.ts          → Follow camera with damping
game/world/Arena.ts        → Ground plane, border ring, grid overlay
game/world/TerritoryRenderer.ts → DataTexture-based territory display
game/entities/PlayerRenderer.ts → Player character mesh + name label
game/entities/TrailRenderer.ts  → Smooth trail ribbon geometry
game/entities/ParticleSystem.ts → Death debris VFX
game/ui/HUD.ts             → Territory %, kills, leaderboard (HTML overlay)
game/ui/Minimap.ts         → Canvas-based minimap
game/ui/NameEntry.ts       → Initial name input overlay
game/ui/DeathScreen.ts     → Death/respawn overlay
game/net/NetClient.ts      → Colyseus connection, message handling
game/local/LocalGame.ts    → Single-player simulation + AI bots
store.ts                   → Zustand store for client state
```

## 12. HUD & UI

- **Name entry**: Centered overlay with text input + "Play" button. No loading screen — renders immediately behind the overlay.
- **In-game HUD** (HTML overlays, not Three.js):
  - Top-left: Territory % bar (colored), kill count icon + number
  - Top-right: Leaderboard — top 5 players, name + territory %, colored squares
  - Bottom-left: Minimap (small canvas, ~150x150px, draws territory colors)
  - Center (on death): "Killed by [name]" + respawn countdown
- **Vibejam widget**: `<script async src="https://vibej.am/2026/widget.js"></script>` in index.html

## 13. Constants (packages/shared/src/constants.ts)

```typescript
export const WORLD_RADIUS = 50;
export const GRID_SIZE = 400;
export const CELL_SIZE = (WORLD_RADIUS * 2) / GRID_SIZE; // 0.25
export const SERVER_TICK_RATE = 20;
export const PLAYER_SPEED = 4.0;
export const PLAYER_TURN_RATE = 3.0; // rad/s
export const MAX_PLAYERS = 8;
export const MAX_TRAIL_LENGTH = 2000;
export const RESPAWN_DELAY = 3.0;
export const INVULN_DURATION = 2.0;
export const STARTING_TERRITORY_RADIUS = 5; // grid cells
export const BOT_COUNT = 5;
export const BOUNDARY_CELL = 255;
```

## 14. Stretch Goals (if time permits)

1. Vibejam portal integration (spawn/exit portals)
2. Collectible spheres (speed boost, score bonus)
3. Player skin selection at name entry
4. Sound effects (claim, kill, death)
5. Mobile virtual joystick
6. Spectator mode after death (before respawn)
