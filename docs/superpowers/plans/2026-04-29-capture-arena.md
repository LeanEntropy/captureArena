# Capture Arena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Paper.io 2 clone with continuous 360° movement, smooth territory claiming, and multiplayer support for the vibejam 2026 competition.

**Architecture:** pnpm monorepo with 4 packages. `packages/shared` holds constants, types, and grid math. `packages/simulation` runs the game logic (movement, trails, territory claiming via edge-seeded BFS flood fill, collisions, AI bots). `server` wraps the simulation in a Colyseus room with schema sync. `client` renders via Three.js (DataTexture territory, ribbon trails, blocky player characters) with Zustand state and HTML overlay UI.

**Tech Stack:** Three.js, Colyseus, Vite, Zustand, TypeScript, pnpm

**Spec:** `docs/superpowers/specs/2026-04-29-capture-arena-design.md`

---

## File Structure

### packages/shared/src/
| File | Action | Responsibility |
|------|--------|---------------|
| `constants.ts` | Rewrite | All Paper.io game constants |
| `types.ts` | Rewrite | Player state types, event types, enums |
| `math.ts` | Modify | Keep clamp/lerp/randomRange, add shortestAngleDist, lerpAngle |
| `grid.ts` | Create | Grid coordinate conversion, Bresenham line rasterization, boundary init |
| `territory.ts` | Create | Edge-seeded BFS flood fill claiming algorithm |
| `protocol.ts` | Rewrite | PlayerInput (heading), GameEvent (death/claim/spawn) |
| `index.ts` | Update | Re-export new modules |

### packages/simulation/src/
| File | Action | Responsibility |
|------|--------|---------------|
| `Simulation.ts` | Rewrite | Top-level game loop: tick phases, player management |
| `TerritoryGrid.ts` | Create | Territory + trail grids, claim execution, territory counting |
| `MovementSystem.ts` | Create | Steering, position advance, boundary check |
| `TrailSystem.ts` | Create | Trail recording, trail-to-grid rasterization, collision detection |
| `BotAI.ts` | Create | AI state machine (expanding/returning/attacking) |
| `EventBus.ts` | Modify | Paper.io event types |
| `index.ts` | Update | Re-export new types |

### server/src/
| File | Action | Responsibility |
|------|--------|---------------|
| `schema/GameState.ts` | Rewrite | PlayerSchema with Paper.io fields, GameStateSchema |
| `rooms/GameRoom.ts` | Rewrite | Room lifecycle, simulation tick, state sync, territory binary broadcast |
| `index.ts` | Keep | Server bootstrap (unchanged) |

### client/src/
| File | Action | Responsibility |
|------|--------|---------------|
| `store.ts` | Rewrite | Paper.io client state: players, territory grid, trails, events |
| `main.ts` | Rewrite | Entry point with name entry flow, mode selection |
| `game/Game.ts` | Modify | Scene setup for Paper.io (light background, no fog) |
| `game/Loop.ts` | Keep | RAF loop (unchanged) |
| `game/InputHandler.ts` | Rewrite | Mouse/touch/keyboard → target heading angle |
| `game/CameraRig.ts` | Rewrite | Top-down follow camera with damping |
| `game/world/Arena.ts` | Create (replace Ground.ts) | Circular ground plane, border ring |
| `game/world/TerritoryRenderer.ts` | Create | 400x400 DataTexture on plane, color by owner |
| `game/entities/PlayerRenderer.ts` | Create (replace EntityRenderer.ts) | Blocky character meshes, name labels |
| `game/entities/TrailRenderer.ts` | Create | Catmull-Rom ribbon geometry per player |
| `game/entities/ParticleSystem.ts` | Create | Death debris cubes |
| `game/ui/HUD.ts` | Rewrite | Territory %, kills, leaderboard HTML overlay |
| `game/ui/Minimap.ts` | Create | 150x150 canvas territory minimap |
| `game/ui/NameEntry.ts` | Create | Name input overlay |
| `game/ui/DeathScreen.ts` | Create | "Killed by X" + respawn countdown |
| `game/net/NetClient.ts` | Rewrite | Colyseus connection with binary territory + trail messages |
| `game/net/Interpolation.ts` | Rewrite | Player position interpolation |
| `game/local/LocalGame.ts` | Rewrite | Single-player simulation with AI bots |
| `game/debug/DebugPanel.ts` | Modify | Paper.io debug fields |

### client/
| File | Action | Responsibility |
|------|--------|---------------|
| `index.html` | Modify | Light background, HUD containers, vibejam widget, UI overlay divs |

---

## Task 1: Shared — Constants, Types, Protocol

Replace all shared package types and constants for the Paper.io game.

**Files:**
- Rewrite: `packages/shared/src/constants.ts`
- Rewrite: `packages/shared/src/types.ts`
- Rewrite: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/math.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Rewrite constants.ts**

```typescript
// packages/shared/src/constants.ts
export const WORLD_RADIUS = 50;
export const GRID_SIZE = 400;
export const CELL_SIZE = (WORLD_RADIUS * 2) / GRID_SIZE; // 0.25
export const SERVER_TICK_RATE = 20;
export const PLAYER_SPEED = 4.0;
export const PLAYER_TURN_RATE = 3.0;
export const MAX_PLAYERS = 8;
export const MAX_TRAIL_LENGTH = 2000;
export const RESPAWN_DELAY = 3.0;
export const INVULN_DURATION = 2.0;
export const STARTING_TERRITORY_RADIUS = 5;
export const BOT_COUNT = 5;
export const BOUNDARY_CELL = 255;
export const UNCLAIMED_CELL = 0;
export const MIN_TRAIL_LENGTH_FOR_SELF_KILL = 3;
export const SPAWN_MIN_DISTANCE = 15;
export const TOTAL_GRID_CELLS = GRID_SIZE * GRID_SIZE;

export const PLAYER_COLORS = [
  0x4CAF50, // green
  0x2196F3, // blue
  0xFF9800, // orange
  0xE91E63, // pink
  0x9C27B0, // purple
  0x00BCD4, // cyan
  0xFFEB3B, // yellow
  0xFF5722, // deep orange
];
```

- [ ] **Step 2: Rewrite types.ts**

```typescript
// packages/shared/src/types.ts
export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export enum EventType {
  PlayerDeath = "PLAYER_DEATH",
  PlayerSpawn = "PLAYER_SPAWN",
  TerritoryClaim = "TERRITORY_CLAIM",
  PlayerKill = "PLAYER_KILL",
}

export enum BotState {
  Expanding = 0,
  Returning = 1,
  Attacking = 2,
}
```

- [ ] **Step 3: Rewrite protocol.ts**

```typescript
// packages/shared/src/protocol.ts
import type { Vec2 } from "./types.js";
import type { EventType } from "./types.js";

export interface PlayerInput {
  targetHeading: number;
}

export interface GameEvent {
  type: EventType;
  playerId: string;
  position: Vec2;
  killerId?: string;
  data?: Record<string, unknown>;
}

export interface PlayerSnapshot {
  id: string;
  slotId: number;
  x: number;
  y: number;
  heading: number;
  alive: boolean;
  respawnTimer: number;
  invulnTimer: number;
  killCount: number;
  territoryCount: number;
  name: string;
  color: number;
}

export interface TrailUpdate {
  playerId: string;
  trail: Vec2[];
}

export interface TerritoryPatch {
  slotId: number;
  cells: number[];
}
```

- [ ] **Step 4: Update math.ts — add angle utilities**

Keep existing `clamp`, `lerp`, `randomRange`, `randomInt`. Remove 3D-only functions (`lerpVec3`, `distanceVec3`, `normalizeVec3`, `pick3Random`). Add angle math:

```typescript
// packages/shared/src/math.ts
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randomInt(min: number, max: number): number {
  return Math.floor(randomRange(min, max + 1));
}

export function shortestAngleDist(from: number, to: number): number {
  const diff = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return diff;
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + shortestAngleDist(from, to) * t;
}

export function distance2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function angleToward(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}
```

- [ ] **Step 5: Update index.ts**

```typescript
// packages/shared/src/index.ts
export * from "./types.js";
export * from "./constants.js";
export * from "./math.js";
export * from "./protocol.js";
```

(Grid and territory modules will be added in the next task's index update.)

- [ ] **Step 6: Verify typecheck passes**

Run: `pnpm --filter @template/shared typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/
git commit -m "feat: replace shared types/constants/math for Paper.io game"
```

---

## Task 2: Shared — Grid Math & Territory Algorithm

Create the core grid utilities and the BFS flood fill territory claiming algorithm. These are pure functions, easy to test.

**Files:**
- Create: `packages/shared/src/grid.ts`
- Create: `packages/shared/src/territory.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create grid.ts — coordinate conversion and Bresenham's line**

```typescript
// packages/shared/src/grid.ts
import { GRID_SIZE, WORLD_RADIUS, CELL_SIZE, BOUNDARY_CELL } from "./constants.js";

export function worldToGrid(wx: number, wy: number): { gx: number; gy: number } {
  const gx = Math.floor((wx + WORLD_RADIUS) / CELL_SIZE);
  const gy = Math.floor((wy + WORLD_RADIUS) / CELL_SIZE);
  return {
    gx: Math.max(0, Math.min(GRID_SIZE - 1, gx)),
    gy: Math.max(0, Math.min(GRID_SIZE - 1, gy)),
  };
}

export function gridToWorld(gx: number, gy: number): { wx: number; wy: number } {
  return {
    wx: gx * CELL_SIZE - WORLD_RADIUS + CELL_SIZE / 2,
    wy: gy * CELL_SIZE - WORLD_RADIUS + CELL_SIZE / 2,
  };
}

export function gridIndex(gx: number, gy: number): number {
  return gy * GRID_SIZE + gx;
}

export function gridFromIndex(index: number): { gx: number; gy: number } {
  return {
    gx: index % GRID_SIZE,
    gy: Math.floor(index / GRID_SIZE),
  };
}

export function isInBounds(gx: number, gy: number): boolean {
  return gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE;
}

export function initBoundaryGrid(): Uint8Array {
  const grid = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const center = GRID_SIZE / 2;
  const radiusCells = WORLD_RADIUS / CELL_SIZE;
  for (let gy = 0; gy < GRID_SIZE; gy++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      const dx = gx - center + 0.5;
      const dy = gy - center + 0.5;
      if (Math.sqrt(dx * dx + dy * dy) > radiusCells) {
        grid[gy * GRID_SIZE + gx] = BOUNDARY_CELL;
      }
    }
  }
  return grid;
}

export function bresenhamLine(
  x0: number, y0: number, x1: number, y1: number,
  callback: (x: number, y: number) => void
): void {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    callback(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

export function fillCircle(
  grid: Uint8Array,
  cx: number, cy: number,
  radius: number, value: number
): number[] {
  const changed: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        const gx = cx + dx;
        const gy = cy + dy;
        if (isInBounds(gx, gy)) {
          const idx = gridIndex(gx, gy);
          if (grid[idx] !== BOUNDARY_CELL && grid[idx] !== value) {
            grid[idx] = value;
            changed.push(idx);
          }
        }
      }
    }
  }
  return changed;
}
```

- [ ] **Step 2: Create territory.ts — BFS flood fill claiming**

```typescript
// packages/shared/src/territory.ts
import { GRID_SIZE, BOUNDARY_CELL } from "./constants.js";
import { gridIndex, isInBounds } from "./grid.js";

export interface ClaimResult {
  claimedCells: number[];
  stolenFrom: Map<number, number>;
}

export function claimTerritory(
  territoryGrid: Uint8Array,
  trailGrid: Uint8Array,
  playerSlotId: number,
  trailPoints: { gx: number; gy: number }[]
): ClaimResult {
  const totalCells = GRID_SIZE * GRID_SIZE;

  // Step 1: Mark trail cells on territory grid
  for (const p of trailPoints) {
    const idx = gridIndex(p.gx, p.gy);
    if (territoryGrid[idx] !== BOUNDARY_CELL) {
      territoryGrid[idx] = playerSlotId;
    }
  }

  // Step 2: Edge-seeded BFS — find all cells reachable from outside
  const visited = new Uint8Array(totalCells); // 0 = unvisited, 1 = visited

  // Pre-mark boundary cells and player's own cells as visited (not floodable)
  for (let i = 0; i < totalCells; i++) {
    if (territoryGrid[i] === BOUNDARY_CELL || territoryGrid[i] === playerSlotId) {
      visited[i] = 1;
    }
  }

  // Seed from all grid edge cells that are not visited
  const queue: number[] = [];
  for (let gx = 0; gx < GRID_SIZE; gx++) {
    const topIdx = gridIndex(gx, 0);
    const botIdx = gridIndex(gx, GRID_SIZE - 1);
    if (!visited[topIdx]) { visited[topIdx] = 1; queue.push(topIdx); }
    if (!visited[botIdx]) { visited[botIdx] = 1; queue.push(botIdx); }
  }
  for (let gy = 1; gy < GRID_SIZE - 1; gy++) {
    const leftIdx = gridIndex(0, gy);
    const rightIdx = gridIndex(GRID_SIZE - 1, gy);
    if (!visited[leftIdx]) { visited[leftIdx] = 1; queue.push(leftIdx); }
    if (!visited[rightIdx]) { visited[rightIdx] = 1; queue.push(rightIdx); }
  }

  // BFS
  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const gx = idx % GRID_SIZE;
    const gy = (idx - gx) / GRID_SIZE;
    for (let d = 0; d < 4; d++) {
      const nx = gx + dx[d];
      const ny = gy + dy[d];
      if (!isInBounds(nx, ny)) continue;
      const nIdx = ny * GRID_SIZE + nx;
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      queue.push(nIdx);
    }
  }

  // Step 3: Every unvisited cell is enclosed — claim it
  const claimedCells: number[] = [];
  const stolenFrom = new Map<number, number>();

  for (let i = 0; i < totalCells; i++) {
    if (!visited[i] && territoryGrid[i] !== BOUNDARY_CELL && territoryGrid[i] !== playerSlotId) {
      const prevOwner = territoryGrid[i];
      if (prevOwner !== 0) {
        stolenFrom.set(prevOwner, (stolenFrom.get(prevOwner) || 0) + 1);
      }
      territoryGrid[i] = playerSlotId;
      claimedCells.push(i);
    }
  }

  // Also include the trail cells in claimed output (for delta sync)
  for (const p of trailPoints) {
    const idx = gridIndex(p.gx, p.gy);
    claimedCells.push(idx);
  }

  // Clear trail from trail grid
  for (let i = 0; i < totalCells; i++) {
    if (trailGrid[i] === playerSlotId) {
      trailGrid[i] = 0;
    }
  }

  return { claimedCells, stolenFrom };
}

export function countTerritory(grid: Uint8Array, slotId: number): number {
  let count = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === slotId) count++;
  }
  return count;
}

export function countPlayableCells(grid: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== BOUNDARY_CELL) count++;
  }
  return count;
}
```

- [ ] **Step 3: Update index.ts to export new modules**

```typescript
// packages/shared/src/index.ts
export * from "./types.js";
export * from "./constants.js";
export * from "./math.js";
export * from "./protocol.js";
export * from "./grid.js";
export * from "./territory.js";
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm --filter @template/shared typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/
git commit -m "feat: add grid math utilities and BFS territory claiming algorithm"
```

---

## Task 3: Simulation — Core, Movement, Trails, Territory

Rewrite the simulation package with all Paper.io game logic: movement with smooth steering, trail recording/collision, and territory claiming.

**Files:**
- Create: `packages/simulation/src/TerritoryGrid.ts`
- Create: `packages/simulation/src/MovementSystem.ts`
- Create: `packages/simulation/src/TrailSystem.ts`
- Rewrite: `packages/simulation/src/Simulation.ts`
- Modify: `packages/simulation/src/EventBus.ts`
- Modify: `packages/simulation/src/index.ts`

- [ ] **Step 1: Rewrite EventBus.ts for Paper.io events**

```typescript
// packages/simulation/src/EventBus.ts
import type { GameEvent, Vec2 } from "@template/shared";
import { EventType } from "@template/shared";

export class EventBus {
  private events: GameEvent[] = [];

  emit(type: EventType, playerId: string, position: Vec2, killerId?: string, data?: Record<string, unknown>) {
    this.events.push({ type, playerId, position, killerId, data });
  }

  flush(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  get count(): number {
    return this.events.length;
  }
}
```

- [ ] **Step 2: Create TerritoryGrid.ts**

```typescript
// packages/simulation/src/TerritoryGrid.ts
import {
  GRID_SIZE, BOUNDARY_CELL, STARTING_TERRITORY_RADIUS, UNCLAIMED_CELL,
  initBoundaryGrid, fillCircle, worldToGrid, gridIndex,
  claimTerritory, countTerritory, countPlayableCells,
} from "@template/shared";
import type { ClaimResult } from "@template/shared";

export class TerritoryGrid {
  grid: Uint8Array;
  trailGrid: Uint8Array;
  playableCells: number;

  constructor() {
    this.grid = initBoundaryGrid();
    this.trailGrid = new Uint8Array(GRID_SIZE * GRID_SIZE);
    this.playableCells = countPlayableCells(this.grid);
  }

  grantStartingTerritory(slotId: number, worldX: number, worldY: number): number[] {
    const { gx, gy } = worldToGrid(worldX, worldY);
    return fillCircle(this.grid, gx, gy, STARTING_TERRITORY_RADIUS, slotId);
  }

  isOnOwnTerritory(slotId: number, worldX: number, worldY: number): boolean {
    const { gx, gy } = worldToGrid(worldX, worldY);
    return this.grid[gridIndex(gx, gy)] === slotId;
  }

  isOutsideBoundary(worldX: number, worldY: number): boolean {
    const { gx, gy } = worldToGrid(worldX, worldY);
    return this.grid[gridIndex(gx, gy)] === BOUNDARY_CELL;
  }

  addTrailPoint(slotId: number, worldX: number, worldY: number): void {
    const { gx, gy } = worldToGrid(worldX, worldY);
    const idx = gridIndex(gx, gy);
    if (this.grid[idx] !== BOUNDARY_CELL) {
      this.trailGrid[idx] = slotId;
    }
  }

  getTrailOwnerAt(worldX: number, worldY: number): number {
    const { gx, gy } = worldToGrid(worldX, worldY);
    return this.trailGrid[gridIndex(gx, gy)];
  }

  claim(slotId: number, trailWorldPoints: { x: number; y: number }[]): ClaimResult {
    const gridPoints = trailWorldPoints.map(p => worldToGrid(p.x, p.y));
    return claimTerritory(this.grid, this.trailGrid, slotId, gridPoints);
  }

  clearTrail(slotId: number): void {
    for (let i = 0; i < this.trailGrid.length; i++) {
      if (this.trailGrid[i] === slotId) {
        this.trailGrid[i] = UNCLAIMED_CELL;
      }
    }
  }

  getTerritoryCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    for (let i = 0; i < this.grid.length; i++) {
      const v = this.grid[i];
      if (v !== UNCLAIMED_CELL && v !== BOUNDARY_CELL) {
        counts.set(v, (counts.get(v) || 0) + 1);
      }
    }
    return counts;
  }

  getFullGridCopy(): Uint8Array {
    return new Uint8Array(this.grid);
  }
}
```

- [ ] **Step 3: Create MovementSystem.ts**

```typescript
// packages/simulation/src/MovementSystem.ts
import {
  PLAYER_SPEED, PLAYER_TURN_RATE, WORLD_RADIUS,
  shortestAngleDist, clamp,
} from "@template/shared";

export interface Movable {
  x: number;
  y: number;
  heading: number;
  targetHeading: number;
  speed: number;
  turnRate: number;
}

export function updateMovement(entity: Movable, dt: number): void {
  // Steer toward target heading
  const angleDiff = shortestAngleDist(entity.heading, entity.targetHeading);
  const maxTurn = entity.turnRate * dt;
  if (Math.abs(angleDiff) <= maxTurn) {
    entity.heading = entity.targetHeading;
  } else {
    entity.heading += Math.sign(angleDiff) * maxTurn;
  }
  // Normalize heading to [-PI, PI]
  entity.heading = ((entity.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

  // Advance position
  entity.x += Math.cos(entity.heading) * entity.speed * dt;
  entity.y += Math.sin(entity.heading) * entity.speed * dt;
}

export function isOutOfBounds(x: number, y: number): boolean {
  return Math.sqrt(x * x + y * y) > WORLD_RADIUS;
}
```

- [ ] **Step 4: Create TrailSystem.ts**

```typescript
// packages/simulation/src/TrailSystem.ts
import type { Vec2 } from "@template/shared";
import {
  MAX_TRAIL_LENGTH, MIN_TRAIL_LENGTH_FOR_SELF_KILL,
  worldToGrid, gridIndex, GRID_SIZE,
  bresenhamLine,
} from "@template/shared";
import type { TerritoryGrid } from "./TerritoryGrid.js";

export interface TrailHolder {
  trail: Vec2[];
  slotId: number;
  wasOutsideTerritory: boolean;
}

export function recordTrailPoint(
  holder: TrailHolder,
  x: number, y: number,
  territoryGrid: TerritoryGrid
): void {
  holder.trail.push({ x, y });
  // Rasterize line from previous point to current point onto trail grid
  if (holder.trail.length >= 2) {
    const prev = holder.trail[holder.trail.length - 2];
    const curr = holder.trail[holder.trail.length - 1];
    const p0 = worldToGrid(prev.x, prev.y);
    const p1 = worldToGrid(curr.x, curr.y);
    bresenhamLine(p0.gx, p0.gy, p1.gx, p1.gy, (gx, gy) => {
      territoryGrid.addTrailPoint(holder.slotId, 
        gx * 0.25 - 50 + 0.125,  // gridToWorld inline
        gy * 0.25 - 50 + 0.125
      );
    });
  } else {
    territoryGrid.addTrailPoint(holder.slotId, x, y);
  }
}

export function isTrailTooLong(holder: TrailHolder): boolean {
  return holder.trail.length >= MAX_TRAIL_LENGTH;
}

export interface TrailCollisionResult {
  type: "none" | "self" | "enemy";
  victimSlotId?: number;
}

export function checkTrailCollision(
  movingSlotId: number,
  worldX: number, worldY: number,
  territoryGrid: TerritoryGrid,
  trailLength: number
): TrailCollisionResult {
  const trailOwner = territoryGrid.getTrailOwnerAt(worldX, worldY);
  if (trailOwner === 0) return { type: "none" };
  if (trailOwner === movingSlotId) {
    if (trailLength > MIN_TRAIL_LENGTH_FOR_SELF_KILL) {
      return { type: "self" };
    }
    return { type: "none" };
  }
  return { type: "enemy", victimSlotId: trailOwner };
}
```

- [ ] **Step 5: Rewrite Simulation.ts**

```typescript
// packages/simulation/src/Simulation.ts
import {
  PLAYER_SPEED, PLAYER_TURN_RATE, PLAYER_COLORS,
  RESPAWN_DELAY, INVULN_DURATION, WORLD_RADIUS,
  SPAWN_MIN_DISTANCE, BOT_COUNT,
  EventType, randomRange, distance2D, angleToward,
} from "@template/shared";
import type { Vec2, PlayerInput, GameEvent, TerritoryPatch, TrailUpdate } from "@template/shared";
import { EventBus } from "./EventBus.js";
import { TerritoryGrid } from "./TerritoryGrid.js";
import { updateMovement, isOutOfBounds } from "./MovementSystem.js";
import { recordTrailPoint, isTrailTooLong, checkTrailCollision } from "./TrailSystem.js";
import type { TrailHolder } from "./TrailSystem.js";

export interface SimPlayer {
  id: string;
  slotId: number;
  x: number;
  y: number;
  heading: number;
  targetHeading: number;
  speed: number;
  turnRate: number;
  trail: Vec2[];
  alive: boolean;
  respawnTimer: number;
  invulnTimer: number;
  killCount: number;
  territoryCount: number;
  name: string;
  color: number;
  wasOutsideTerritory: boolean;
  isBot: boolean;
}

export class Simulation {
  players: Map<string, SimPlayer> = new Map();
  territory: TerritoryGrid;
  events: EventBus = new EventBus();
  private nextSlotId = 1;
  private inputQueue: { playerId: string; input: PlayerInput }[] = [];
  pendingTerritoryPatches: TerritoryPatch[] = [];
  pendingTrailUpdates: TrailUpdate[] = [];

  constructor() {
    this.territory = new TerritoryGrid();
  }

  addPlayer(id: string, name: string, isBot = false): SimPlayer {
    const slotId = this.nextSlotId++;
    const color = PLAYER_COLORS[(slotId - 1) % PLAYER_COLORS.length];
    const { x, y } = this.findSpawnPosition();
    const heading = randomRange(-Math.PI, Math.PI);

    const player: SimPlayer = {
      id, slotId, x, y, heading,
      targetHeading: heading,
      speed: PLAYER_SPEED,
      turnRate: PLAYER_TURN_RATE,
      trail: [],
      alive: true,
      respawnTimer: 0,
      invulnTimer: INVULN_DURATION,
      killCount: 0,
      territoryCount: 0,
      name,
      color,
      wasOutsideTerritory: false,
      isBot,
    };

    this.players.set(id, player);

    const changed = this.territory.grantStartingTerritory(slotId, x, y);
    player.territoryCount = changed.length;

    this.pendingTerritoryPatches.push({ slotId, cells: changed });
    this.events.emit(EventType.PlayerSpawn, id, { x, y });

    return player;
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (player) {
      this.territory.clearTrail(player.slotId);
      this.players.delete(id);
    }
  }

  queueInput(playerId: string, input: PlayerInput): void {
    this.inputQueue.push({ playerId, input });
  }

  tick(dt: number): void {
    this.pendingTerritoryPatches = [];
    this.pendingTrailUpdates = [];

    this.processInputs();
    this.updateTimers(dt);
    this.updateMovement(dt);
    this.checkCollisions();
    this.checkClaims();
    this.updateTerritoryCounts();
  }

  private processInputs(): void {
    for (const { playerId, input } of this.inputQueue) {
      const player = this.players.get(playerId);
      if (player && player.alive) {
        player.targetHeading = input.targetHeading;
      }
    }
    this.inputQueue = [];
  }

  private updateTimers(dt: number): void {
    for (const player of this.players.values()) {
      if (!player.alive) {
        player.respawnTimer -= dt;
        if (player.respawnTimer <= 0) {
          this.respawnPlayer(player);
        }
      } else if (player.invulnTimer > 0) {
        player.invulnTimer -= dt;
        if (player.invulnTimer < 0) player.invulnTimer = 0;
      }
    }
  }

  private updateMovement(dt: number): void {
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      updateMovement(player, dt);

      // Boundary check
      if (isOutOfBounds(player.x, player.y)) {
        this.killPlayer(player.id);
        continue;
      }

      // Trail recording
      const onOwn = this.territory.isOnOwnTerritory(player.slotId, player.x, player.y);
      if (!onOwn && player.alive) {
        if (!player.wasOutsideTerritory) {
          player.wasOutsideTerritory = true;
        }
        recordTrailPoint(
          { trail: player.trail, slotId: player.slotId, wasOutsideTerritory: player.wasOutsideTerritory },
          player.x, player.y,
          this.territory
        );

        if (isTrailTooLong({ trail: player.trail, slotId: player.slotId, wasOutsideTerritory: true })) {
          this.killPlayer(player.id);
        }
      }
    }
  }

  private checkCollisions(): void {
    for (const player of this.players.values()) {
      if (!player.alive || player.invulnTimer > 0) continue;
      if (player.trail.length === 0 && !player.wasOutsideTerritory) continue;

      const collision = checkTrailCollision(
        player.slotId, player.x, player.y,
        this.territory, player.trail.length
      );

      if (collision.type === "self") {
        this.killPlayer(player.id);
      } else if (collision.type === "enemy" && collision.victimSlotId) {
        // Find the player whose trail was hit
        const victim = this.findPlayerBySlotId(collision.victimSlotId);
        if (victim && victim.alive && victim.invulnTimer <= 0) {
          this.killPlayer(victim.id, player.id);
          player.killCount++;
        }
      }
    }
  }

  private checkClaims(): void {
    for (const player of this.players.values()) {
      if (!player.alive || !player.wasOutsideTerritory) continue;
      if (player.trail.length === 0) continue;

      const onOwn = this.territory.isOnOwnTerritory(player.slotId, player.x, player.y);
      if (onOwn) {
        // Claim territory
        const result = this.territory.claim(player.slotId, player.trail);

        // Update stolen-from players
        for (const [stolenSlotId, count] of result.stolenFrom) {
          const victim = this.findPlayerBySlotId(stolenSlotId);
          if (victim) {
            victim.territoryCount -= count;
          }
        }

        this.pendingTerritoryPatches.push({
          slotId: player.slotId,
          cells: result.claimedCells,
        });

        this.events.emit(EventType.TerritoryClaim, player.id, { x: player.x, y: player.y }, undefined, {
          cellCount: result.claimedCells.length,
        });

        player.trail = [];
        player.wasOutsideTerritory = false;

        this.pendingTrailUpdates.push({ playerId: player.id, trail: [] });
      }
    }
  }

  private updateTerritoryCounts(): void {
    const counts = this.territory.getTerritoryCounts();
    for (const player of this.players.values()) {
      player.territoryCount = counts.get(player.slotId) || 0;
    }
  }

  killPlayer(playerId: string, killerId?: string): void {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;

    player.alive = false;
    player.respawnTimer = RESPAWN_DELAY;
    this.territory.clearTrail(player.slotId);
    player.trail = [];
    player.wasOutsideTerritory = false;

    this.events.emit(EventType.PlayerDeath, playerId, { x: player.x, y: player.y }, killerId);
    this.pendingTrailUpdates.push({ playerId, trail: [] });

    if (killerId) {
      this.events.emit(EventType.PlayerKill, killerId, { x: player.x, y: player.y }, undefined, {
        victimId: playerId,
      });
    }
  }

  private respawnPlayer(player: SimPlayer): void {
    const { x, y } = this.findSpawnPosition();
    player.x = x;
    player.y = y;
    player.heading = randomRange(-Math.PI, Math.PI);
    player.targetHeading = player.heading;
    player.alive = true;
    player.invulnTimer = INVULN_DURATION;
    player.trail = [];
    player.wasOutsideTerritory = false;

    const changed = this.territory.grantStartingTerritory(player.slotId, x, y);
    this.pendingTerritoryPatches.push({ slotId: player.slotId, cells: changed });
    this.events.emit(EventType.PlayerSpawn, player.id, { x, y });
  }

  private findSpawnPosition(): { x: number; y: number } {
    for (let attempt = 0; attempt < 50; attempt++) {
      const angle = randomRange(-Math.PI, Math.PI);
      const dist = randomRange(WORLD_RADIUS * 0.3, WORLD_RADIUS * 0.7);
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;

      let tooClose = false;
      for (const other of this.players.values()) {
        if (other.alive && distance2D({ x, y }, other) < SPAWN_MIN_DISTANCE) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) return { x, y };
    }
    // Fallback: random position
    const angle = randomRange(-Math.PI, Math.PI);
    const dist = randomRange(WORLD_RADIUS * 0.3, WORLD_RADIUS * 0.7);
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
  }

  private findPlayerBySlotId(slotId: number): SimPlayer | undefined {
    for (const player of this.players.values()) {
      if (player.slotId === slotId) return player;
    }
    return undefined;
  }

  getTrailUpdates(): TrailUpdate[] {
    const updates: TrailUpdate[] = [...this.pendingTrailUpdates];
    for (const player of this.players.values()) {
      if (player.alive && player.trail.length > 0) {
        updates.push({ playerId: player.id, trail: [...player.trail] });
      }
    }
    return updates;
  }
}
```

- [ ] **Step 6: Update index.ts**

```typescript
// packages/simulation/src/index.ts
export { Simulation } from "./Simulation.js";
export type { SimPlayer } from "./Simulation.js";
export { TerritoryGrid } from "./TerritoryGrid.js";
export { EventBus } from "./EventBus.js";
export { updateMovement, isOutOfBounds } from "./MovementSystem.js";
```

- [ ] **Step 7: Verify typecheck passes**

Run: `pnpm --filter @template/simulation typecheck`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/simulation/src/
git commit -m "feat: implement Paper.io simulation — movement, trails, territory claiming"
```

---

## Task 4: Simulation — AI Bots

Add bot AI with a simple state machine for single-player and filling multiplayer lobbies.

**Files:**
- Create: `packages/simulation/src/BotAI.ts`
- Modify: `packages/simulation/src/Simulation.ts` (add bot tick method)
- Modify: `packages/simulation/src/index.ts`

- [ ] **Step 1: Create BotAI.ts**

```typescript
// packages/simulation/src/BotAI.ts
import {
  BotState, WORLD_RADIUS,
  randomRange, distance2D, angleToward,
} from "@template/shared";
import type { SimPlayer } from "./Simulation.js";
import type { TerritoryGrid } from "./TerritoryGrid.js";

export interface BotContext {
  state: BotState;
  targetX: number;
  targetY: number;
  distanceTraveled: number;
  maxLoopDistance: number;
  attackProbability: number;
}

export function createBotContext(): BotContext {
  return {
    state: BotState.Expanding,
    targetX: 0,
    targetY: 0,
    distanceTraveled: 0,
    maxLoopDistance: randomRange(5, 15),
    attackProbability: randomRange(0.1, 0.3),
  };
}

export function updateBot(
  player: SimPlayer,
  ctx: BotContext,
  territory: TerritoryGrid,
  allPlayers: Map<string, SimPlayer>,
  dt: number
): void {
  if (!player.alive) return;

  switch (ctx.state) {
    case BotState.Expanding:
      updateExpanding(player, ctx, territory, allPlayers);
      break;
    case BotState.Returning:
      updateReturning(player, ctx, territory);
      break;
    case BotState.Attacking:
      updateExpanding(player, ctx, territory, allPlayers);
      break;
  }

  // Track distance traveled while outside territory
  if (player.wasOutsideTerritory) {
    ctx.distanceTraveled += player.speed * dt;
  }

  // Safety: if trail is getting long, return immediately
  if (player.trail.length > 200 && ctx.state !== BotState.Returning) {
    switchToReturning(player, ctx, territory);
  }

  // Danger: if another player is close and we have a trail, return
  if (player.trail.length > 10) {
    for (const other of allPlayers.values()) {
      if (other.id === player.id || !other.alive) continue;
      if (distance2D(player, other) < 8) {
        switchToReturning(player, ctx, territory);
        break;
      }
    }
  }
}

function updateExpanding(
  player: SimPlayer,
  ctx: BotContext,
  territory: TerritoryGrid,
  allPlayers: Map<string, SimPlayer>
): void {
  // If we've traveled enough distance, switch to returning
  if (ctx.distanceTraveled >= ctx.maxLoopDistance) {
    switchToReturning(player, ctx, territory);
    return;
  }

  // If we don't have a target or we're close to it, pick a new one
  const distToTarget = distance2D(player, { x: ctx.targetX, y: ctx.targetY });
  if (distToTarget < 2 || (ctx.targetX === 0 && ctx.targetY === 0)) {
    pickExpandTarget(player, ctx);
  }

  player.targetHeading = angleToward(player, { x: ctx.targetX, y: ctx.targetY });
}

function updateReturning(
  player: SimPlayer,
  ctx: BotContext,
  territory: TerritoryGrid
): void {
  // Steer toward own territory — find a point back on our territory
  // Simple: steer toward our spawn area (approximate center of our territory)
  // Better: find nearest own territory cell direction
  const onOwn = territory.isOnOwnTerritory(player.slotId, player.x, player.y);
  if (onOwn && player.trail.length > 0) {
    // We made it back — claim will happen automatically in Simulation.checkClaims
    ctx.state = BotState.Expanding;
    ctx.distanceTraveled = 0;
    ctx.maxLoopDistance = randomRange(5, 15);
    ctx.targetX = 0;
    ctx.targetY = 0;
    return;
  }

  // Steer back toward where we started our trail
  if (player.trail.length > 0) {
    const start = player.trail[0];
    player.targetHeading = angleToward(player, start);
  }
}

function switchToReturning(
  player: SimPlayer,
  ctx: BotContext,
  territory: TerritoryGrid
): void {
  ctx.state = BotState.Returning;
}

function pickExpandTarget(player: SimPlayer, ctx: BotContext): void {
  // Pick a point outside current position, roughly away from center
  const outwardAngle = Math.atan2(player.y, player.x);
  const angle = outwardAngle + randomRange(-Math.PI / 3, Math.PI / 3);
  const dist = randomRange(5, 12);
  ctx.targetX = player.x + Math.cos(angle) * dist;
  ctx.targetY = player.y + Math.sin(angle) * dist;

  // Clamp to stay within world
  const targetDist = Math.sqrt(ctx.targetX * ctx.targetX + ctx.targetY * ctx.targetY);
  if (targetDist > WORLD_RADIUS * 0.85) {
    const scale = (WORLD_RADIUS * 0.85) / targetDist;
    ctx.targetX *= scale;
    ctx.targetY *= scale;
  }
}

const BOT_NAMES = [
  "Toe", "K-9", "Lime", "Leaf Assassin", "Helmet Destroyer",
  "Star Jammer", "Sky Bully", "Daisy Stick", "Nova", "Pixel",
  "Shadow", "Blitz", "Frost", "Echo", "Spark",
];

export function pickBotName(usedNames: Set<string>): string {
  for (const name of BOT_NAMES) {
    if (!usedNames.has(name)) return name;
  }
  return `Bot_${Math.floor(Math.random() * 999)}`;
}
```

- [ ] **Step 2: Add bot management to Simulation.ts**

Add these fields and methods to the `Simulation` class. Add to the class body:

After the `players` field declaration, add:

```typescript
  botContexts: Map<string, BotContext> = new Map();
```

Add import at top of `Simulation.ts`:
```typescript
import { updateBot, createBotContext, pickBotName } from "./BotAI.js";
import type { BotContext } from "./BotAI.js";
```

Add methods to the class:

```typescript
  addBot(): SimPlayer {
    const usedNames = new Set<string>();
    for (const p of this.players.values()) usedNames.add(p.name);
    const name = pickBotName(usedNames);
    const botId = `bot_${this.nextSlotId}`;
    const player = this.addPlayer(botId, name, true);
    this.botContexts.set(botId, createBotContext());
    return player;
  }

  fillBots(targetCount: number): void {
    const botCount = Array.from(this.players.values()).filter(p => p.isBot).length;
    for (let i = botCount; i < targetCount; i++) {
      this.addBot();
    }
  }
```

In the `tick` method, add bot AI update after `this.processInputs()`:

```typescript
    // Update bot AI
    for (const [botId, ctx] of this.botContexts) {
      const player = this.players.get(botId);
      if (player) {
        updateBot(player, ctx, this.territory, this.players, dt);
      }
    }
```

In the `removePlayer` method, add cleanup:
```typescript
    this.botContexts.delete(id);
```

- [ ] **Step 3: Update index.ts exports**

```typescript
// packages/simulation/src/index.ts
export { Simulation } from "./Simulation.js";
export type { SimPlayer } from "./Simulation.js";
export { TerritoryGrid } from "./TerritoryGrid.js";
export { EventBus } from "./EventBus.js";
export { updateMovement, isOutOfBounds } from "./MovementSystem.js";
export { updateBot, createBotContext, pickBotName } from "./BotAI.js";
export type { BotContext } from "./BotAI.js";
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm --filter @template/simulation typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/
git commit -m "feat: add AI bot behavior with expanding/returning/attacking states"
```

---

## Task 5: Client — Store, HTML, Game Setup

Rewrite the client foundation: Zustand store for Paper.io state, HTML layout with UI containers and vibejam widget, and Game.ts scene setup.

**Files:**
- Rewrite: `client/src/store.ts`
- Rewrite: `client/index.html`
- Modify: `client/src/game/Game.ts`
- Rewrite: `client/src/game/CameraRig.ts`
- Create: `client/src/game/world/Arena.ts` (replaces Ground.ts)
- Delete: `client/src/game/world/Ground.ts`
- Delete: `client/src/game/entities/EntityRenderer.ts`

- [ ] **Step 1: Rewrite store.ts**

```typescript
// client/src/store.ts
import { createStore } from "zustand/vanilla";
import type { GameEvent, Vec2 } from "@template/shared";

export interface ClientPlayer {
  id: string;
  slotId: number;
  x: number;
  y: number;
  heading: number;
  alive: boolean;
  respawnTimer: number;
  invulnTimer: number;
  killCount: number;
  territoryCount: number;
  name: string;
  color: number;
  trail: Vec2[];
}

export interface GameState {
  playerId: string;
  playerName: string;
  connected: boolean;
  gameStarted: boolean;
  territoryGrid: Uint8Array | null;
  players: Map<string, ClientPlayer>;
  events: GameEvent[];
  playableCells: number;

  setPlayerId: (id: string) => void;
  setPlayerName: (name: string) => void;
  setConnected: (connected: boolean) => void;
  setGameStarted: (started: boolean) => void;
  setTerritoryGrid: (grid: Uint8Array) => void;
  setPlayers: (players: Map<string, ClientPlayer>) => void;
  updatePlayer: (id: string, updates: Partial<ClientPlayer>) => void;
  removePlayer: (id: string) => void;
  pushEvents: (events: GameEvent[]) => void;
  clearEvents: () => void;
  setPlayableCells: (count: number) => void;
}

export const useStore = createStore<GameState>((set) => ({
  playerId: "",
  playerName: "",
  connected: false,
  gameStarted: false,
  territoryGrid: null,
  players: new Map(),
  events: [],
  playableCells: 0,

  setPlayerId: (id) => set({ playerId: id }),
  setPlayerName: (name) => set({ playerName: name }),
  setConnected: (connected) => set({ connected }),
  setGameStarted: (started) => set({ gameStarted: started }),
  setTerritoryGrid: (grid) => set({ territoryGrid: grid }),
  setPlayers: (players) => set({ players }),
  updatePlayer: (id, updates) =>
    set((state) => {
      const players = new Map(state.players);
      const existing = players.get(id);
      if (existing) {
        players.set(id, { ...existing, ...updates });
      }
      return { players };
    }),
  removePlayer: (id) =>
    set((state) => {
      const players = new Map(state.players);
      players.delete(id);
      return { players };
    }),
  pushEvents: (newEvents) =>
    set((state) => ({ events: [...state.events, ...newEvents] })),
  clearEvents: () => set({ events: [] }),
  setPlayableCells: (count) => set({ playableCells: count }),
}));
```

- [ ] **Step 2: Rewrite index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <title>Capture Arena</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #e8f4f8; font-family: 'Segoe UI', system-ui, sans-serif; }
    canvas { display: block; width: 100%; height: 100%; }
    #ui-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 10;
    }
    #hud-top-left {
      position: absolute; top: 16px; left: 16px;
      pointer-events: auto;
    }
    #hud-top-right {
      position: absolute; top: 16px; right: 16px;
      pointer-events: auto;
    }
    #minimap-container {
      position: absolute; bottom: 16px; left: 16px;
      pointer-events: auto;
    }
    #name-entry {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      background: rgba(255,255,255,0.85); z-index: 100;
      pointer-events: auto;
    }
    #name-entry.hidden { display: none; }
    #death-screen {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: none; align-items: center; justify-content: center;
      z-index: 50; pointer-events: none;
    }
    #death-screen.visible { display: flex; }
  </style>
  <script async src="https://vibej.am/2026/widget.js"></script>
</head>
<body>
  <div id="ui-overlay">
    <div id="hud-top-left"></div>
    <div id="hud-top-right"></div>
    <div id="minimap-container"></div>
  </div>
  <div id="name-entry">
    <div style="text-align:center;">
      <h1 style="font-size:48px; margin-bottom:8px; color:#333;">Capture Arena</h1>
      <p style="color:#666; margin-bottom:24px;">Claim territory. Cut trails. Dominate.</p>
      <input id="name-input" type="text" placeholder="Enter your name" maxlength="16"
        style="font-size:20px; padding:12px 24px; border:2px solid #ccc; border-radius:8px; outline:none; text-align:center; width:280px;" />
      <br/>
      <button id="play-btn"
        style="margin-top:16px; font-size:20px; padding:12px 48px; background:#4CAF50; color:white; border:none; border-radius:8px; cursor:pointer;">
        Play
      </button>
    </div>
  </div>
  <div id="death-screen">
    <div style="text-align:center; background:rgba(0,0,0,0.6); padding:32px 48px; border-radius:16px;">
      <p id="death-message" style="font-size:28px; color:white; margin-bottom:8px;"></p>
      <p id="death-timer" style="font-size:20px; color:#ccc;"></p>
    </div>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 3: Rewrite CameraRig.ts — top-down follow camera**

```typescript
// client/src/game/CameraRig.ts
import * as THREE from "three";
import { lerp } from "@template/shared";

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  private targetX = 0;
  private targetZ = 0;
  private currentX = 0;
  private currentZ = 0;
  private height = 25;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.position.set(0, this.height, 12);
    this.camera.lookAt(0, 0, 0);
  }

  setTarget(x: number, z: number) {
    this.targetX = x;
    this.targetZ = z;
  }

  update(dt: number) {
    const smoothing = 1 - Math.pow(0.03, dt);
    this.currentX = lerp(this.currentX, this.targetX, smoothing);
    this.currentZ = lerp(this.currentZ, this.targetZ, smoothing);
    this.camera.position.set(this.currentX, this.height, this.currentZ + 12);
    this.camera.lookAt(this.currentX, 0, this.currentZ);
  }
}
```

- [ ] **Step 4: Create Arena.ts (replaces Ground.ts)**

```typescript
// client/src/game/world/Arena.ts
import * as THREE from "three";
import { WORLD_RADIUS } from "@template/shared";

export class Arena {
  group: THREE.Group;

  constructor() {
    this.group = new THREE.Group();

    // Ground circle
    const groundGeom = new THREE.CircleGeometry(WORLD_RADIUS, 128);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xf0f0f0,
      roughness: 0.9,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Border ring
    const ringGeom = new THREE.RingGeometry(WORLD_RADIUS - 0.2, WORLD_RADIUS + 0.2, 128);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xcccccc,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.group.add(ring);

    // Faint grid dots for spatial reference
    const dotCount = 40;
    const spacing = (WORLD_RADIUS * 2) / dotCount;
    const dotGeom = new THREE.CircleGeometry(0.08, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    for (let i = 0; i <= dotCount; i++) {
      for (let j = 0; j <= dotCount; j++) {
        const x = -WORLD_RADIUS + i * spacing;
        const z = -WORLD_RADIUS + j * spacing;
        if (Math.sqrt(x * x + z * z) < WORLD_RADIUS - 1) {
          const dot = new THREE.Mesh(dotGeom, dotMat);
          dot.rotation.x = -Math.PI / 2;
          dot.position.set(x, 0.01, z);
          this.group.add(dot);
        }
      }
    }
  }
}
```

- [ ] **Step 5: Rewrite Game.ts for Paper.io scene**

```typescript
// client/src/game/Game.ts
import * as THREE from "three";
import { Loop } from "./Loop.js";
import { CameraRig } from "./CameraRig.js";
import { InputHandler } from "./InputHandler.js";
import { Arena } from "./world/Arena.js";

export class Game {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  cameraRig: CameraRig;
  inputHandler: InputHandler;
  private loop: Loop | null = null;

  onUpdate: ((dt: number) => void) | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8f4f8);

    this.camera = new THREE.PerspectiveCamera(
      50, window.innerWidth / window.innerHeight, 0.1, 200
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(10, 20, 10);
    this.scene.add(directional);

    // Arena
    const arena = new Arena();
    this.scene.add(arena.group);

    // Camera
    this.cameraRig = new CameraRig(this.camera);

    // Input
    this.inputHandler = new InputHandler(this.camera, this.renderer.domElement);

    window.addEventListener("resize", this.onResize);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  update(dt: number) {
    this.cameraRig.update(dt);
    if (this.onUpdate) this.onUpdate(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    this.loop = new Loop(
      (dt) => this.update(dt),
      () => this.render()
    );
    this.loop.start();
  }
}
```

- [ ] **Step 6: Delete old files**

```bash
rm client/src/game/world/Ground.ts
rm client/src/game/entities/EntityRenderer.ts
```

- [ ] **Step 7: Commit**

```bash
git add client/src/ client/index.html
git commit -m "feat: client foundation — store, arena, camera, HTML layout with vibejam widget"
```

---

## Task 6: Client — Input Handler

Rewrite the input handler for Paper.io controls: mouse position relative to player determines target heading. Support keyboard WASD/arrows as fallback.

**Files:**
- Rewrite: `client/src/game/InputHandler.ts`

- [ ] **Step 1: Rewrite InputHandler.ts**

```typescript
// client/src/game/InputHandler.ts
import * as THREE from "three";

export class InputHandler {
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLCanvasElement;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private mouseWorld = new THREE.Vector3();
  private mouseNDC = new THREE.Vector2();
  private keysDown = new Set<string>();

  targetHeading: number = 0;
  hasInput: boolean = false;
  playerWorldX: number = 0;
  playerWorldZ: number = 0;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLCanvasElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.domElement.addEventListener("mousemove", this.onMouseMove);
    this.domElement.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.domElement.addEventListener("touchstart", this.onTouchMove, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.domElement.getBoundingClientRect();
    this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.updateHeadingFromMouse();
  };

  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      const rect = this.domElement.getBoundingClientRect();
      this.mouseNDC.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseNDC.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
      this.updateHeadingFromMouse();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    this.keysDown.add(e.key.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.key.toLowerCase());
  };

  private updateHeadingFromMouse(): void {
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      this.mouseWorld.copy(hit);
      // Note: in our game, world Y maps to Three.js Z
      const dx = hit.x - this.playerWorldX;
      const dz = hit.z - this.playerWorldZ;
      if (Math.abs(dx) > 0.5 || Math.abs(dz) > 0.5) {
        // Game uses (x, y) where y maps to three.js z. heading = atan2(dy, dx) in game coords.
        // In three.js: dx is game dx, dz is negative game dy (three.js z = -game y typically)
        // But in our setup: game y maps to three.js -z (since three.js z is forward-toward-camera)
        // So game heading = atan2(-dz, dx)
        this.targetHeading = Math.atan2(-dz, dx);
        this.hasInput = true;
      }
    }
  }

  update(): void {
    // Keyboard overrides mouse
    let kx = 0;
    let ky = 0;
    if (this.keysDown.has("w") || this.keysDown.has("arrowup")) ky += 1;
    if (this.keysDown.has("s") || this.keysDown.has("arrowdown")) ky -= 1;
    if (this.keysDown.has("a") || this.keysDown.has("arrowleft")) kx -= 1;
    if (this.keysDown.has("d") || this.keysDown.has("arrowright")) kx += 1;
    if (kx !== 0 || ky !== 0) {
      this.targetHeading = Math.atan2(ky, kx);
      this.hasInput = true;
    }
  }

  setPlayerPosition(worldX: number, worldZ: number): void {
    this.playerWorldX = worldX;
    this.playerWorldZ = worldZ;
  }

  dispose() {
    this.domElement.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/game/InputHandler.ts
git commit -m "feat: input handler — mouse/touch/keyboard steering for Paper.io controls"
```

---

## Task 7: Client — Territory Renderer & Trail Renderer

Create the visual renderers for territory (DataTexture on a plane) and trails (ribbon geometry).

**Files:**
- Create: `client/src/game/world/TerritoryRenderer.ts`
- Create: `client/src/game/entities/TrailRenderer.ts`

- [ ] **Step 1: Create TerritoryRenderer.ts**

```typescript
// client/src/game/world/TerritoryRenderer.ts
import * as THREE from "three";
import { GRID_SIZE, WORLD_RADIUS, PLAYER_COLORS, BOUNDARY_CELL } from "@template/shared";

export class TerritoryRenderer {
  private mesh: THREE.Mesh;
  private texture: THREE.DataTexture;
  private textureData: Uint8Array;
  private colorCache: Map<number, [number, number, number]> = new Map();

  constructor(scene: THREE.Scene) {
    this.textureData = new Uint8Array(GRID_SIZE * GRID_SIZE * 4);
    this.texture = new THREE.DataTexture(
      this.textureData, GRID_SIZE, GRID_SIZE, THREE.RGBAFormat
    );
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;

    const geom = new THREE.PlaneGeometry(WORLD_RADIUS * 2, WORLD_RADIUS * 2);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.02;
    scene.add(this.mesh);

    // Pre-cache default colors
    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      const c = PLAYER_COLORS[i];
      this.colorCache.set(i + 1, [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]);
    }
  }

  getColorForSlot(slotId: number): [number, number, number] {
    let cached = this.colorCache.get(slotId);
    if (!cached) {
      const c = PLAYER_COLORS[(slotId - 1) % PLAYER_COLORS.length];
      cached = [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
      this.colorCache.set(slotId, cached);
    }
    return cached;
  }

  registerPlayerColor(slotId: number, color: number): void {
    this.colorCache.set(slotId, [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]);
  }

  updateFromGrid(grid: Uint8Array): void {
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      const cell = grid[i];
      const pi = i * 4;
      if (cell === 0 || cell === BOUNDARY_CELL) {
        this.textureData[pi] = 0;
        this.textureData[pi + 1] = 0;
        this.textureData[pi + 2] = 0;
        this.textureData[pi + 3] = 0;
      } else {
        const [r, g, b] = this.getColorForSlot(cell);
        this.textureData[pi] = r;
        this.textureData[pi + 1] = g;
        this.textureData[pi + 2] = b;
        this.textureData[pi + 3] = 180;
      }
    }
    this.texture.needsUpdate = true;
  }
}
```

- [ ] **Step 2: Create TrailRenderer.ts**

```typescript
// client/src/game/entities/TrailRenderer.ts
import * as THREE from "three";
import type { Vec2 } from "@template/shared";

const TRAIL_WIDTH = 0.4;
const TRAIL_HEIGHT = 0.15;

export class TrailRenderer {
  private scene: THREE.Scene;
  private meshes: Map<string, THREE.Mesh> = new Map();
  private materials: Map<string, THREE.MeshBasicMaterial> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  updateTrail(playerId: string, trail: Vec2[], color: number): void {
    let mesh = this.meshes.get(playerId);

    if (trail.length < 2) {
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.meshes.delete(playerId);
      }
      return;
    }

    // Get or create material
    let mat = this.materials.get(playerId);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      });
      this.materials.set(playerId, mat);
    }

    // Build ribbon geometry from trail points
    // Each segment: 2 triangles forming a quad, extruded perpendicular to the trail direction
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      // Compute perpendicular direction
      let dx = 0, dy = 0;
      if (i < trail.length - 1) {
        dx = trail[i + 1].x - p.x;
        dy = trail[i + 1].y - p.y;
      } else if (i > 0) {
        dx = p.x - trail[i - 1].x;
        dy = p.y - trail[i - 1].y;
      }
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      // Game y → three.js -z
      const wx = p.x;
      const wz = -p.y;

      // Bottom-left, bottom-right, top-left, top-right of the ribbon cross-section
      const hw = TRAIL_WIDTH / 2;
      positions.push(
        wx + nx * hw, 0, wz - ny * hw,            // bottom-left
        wx - nx * hw, 0, wz + ny * hw,            // bottom-right
        wx + nx * hw, TRAIL_HEIGHT, wz - ny * hw,  // top-left
        wx - nx * hw, TRAIL_HEIGHT, wz + ny * hw,  // top-right
      );

      if (i > 0) {
        const base = (i - 1) * 4;
        const curr = i * 4;
        // Bottom face
        indices.push(base, base + 1, curr + 1, base, curr + 1, curr);
        // Top face
        indices.push(base + 2, curr + 2, curr + 3, base + 2, curr + 3, base + 3);
        // Left side
        indices.push(base, curr, curr + 2, base, curr + 2, base + 2);
        // Right side
        indices.push(base + 1, base + 3, curr + 3, base + 1, curr + 3, curr + 1);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geom;
    } else {
      mesh = new THREE.Mesh(geom, mat);
      this.scene.add(mesh);
      this.meshes.set(playerId, mesh);
    }
  }

  removeTrail(playerId: string): void {
    const mesh = this.meshes.get(playerId);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(playerId);
    }
    const mat = this.materials.get(playerId);
    if (mat) {
      mat.dispose();
      this.materials.delete(playerId);
    }
  }

  dispose(): void {
    for (const [id] of this.meshes) {
      this.removeTrail(id);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/game/world/TerritoryRenderer.ts client/src/game/entities/TrailRenderer.ts
git commit -m "feat: territory DataTexture renderer and trail ribbon renderer"
```

---

## Task 8: Client — Player Renderer & Particles

Create player character meshes (blocky Paper.io style) and death debris particle system.

**Files:**
- Create: `client/src/game/entities/PlayerRenderer.ts`
- Create: `client/src/game/entities/ParticleSystem.ts`

- [ ] **Step 1: Create PlayerRenderer.ts**

```typescript
// client/src/game/entities/PlayerRenderer.ts
import * as THREE from "three";
import type { ClientPlayer } from "../../store.js";

export class PlayerRenderer {
  private scene: THREE.Scene;
  private meshes: Map<string, THREE.Group> = new Map();
  private labels: Map<string, HTMLDivElement> = new Map();
  private camera: THREE.PerspectiveCamera;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
  }

  update(players: Map<string, ClientPlayer>): void {
    // Remove meshes for players that left
    for (const [id, group] of this.meshes) {
      if (!players.has(id)) {
        this.scene.remove(group);
        this.meshes.delete(id);
        const label = this.labels.get(id);
        if (label) { label.remove(); this.labels.delete(id); }
      }
    }

    for (const [id, player] of players) {
      if (!player.alive) {
        const existing = this.meshes.get(id);
        if (existing) existing.visible = false;
        const label = this.labels.get(id);
        if (label) label.style.display = "none";
        continue;
      }

      let group = this.meshes.get(id);
      if (!group) {
        group = this.createPlayerMesh(player.color);
        this.scene.add(group);
        this.meshes.set(id, group);
      }

      group.visible = true;

      // Game coords: x → three.js x, y → three.js -z
      group.position.set(player.x, 0.4, -player.y);
      group.rotation.y = -player.heading + Math.PI / 2;

      // Invulnerability flash
      if (player.invulnTimer > 0) {
        const flash = Math.sin(performance.now() * 0.01) > 0;
        group.visible = flash;
      }

      // Name label
      this.updateLabel(id, player, group);
    }
  }

  private createPlayerMesh(color: number): THREE.Group {
    const group = new THREE.Group();

    // Body
    const bodyGeom = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.0;
    group.add(body);

    // Head
    const headGeom = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    const headMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 0.5;
    group.add(head);

    // Eyes
    const eyeGeom = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilGeom = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

    const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
    leftEye.position.set(-0.1, 0.52, 0.22);
    group.add(leftEye);
    const leftPupil = new THREE.Mesh(pupilGeom, pupilMat);
    leftPupil.position.set(-0.1, 0.52, 0.25);
    group.add(leftPupil);

    const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
    rightEye.position.set(0.1, 0.52, 0.22);
    group.add(rightEye);
    const rightPupil = new THREE.Mesh(pupilGeom, pupilMat);
    rightPupil.position.set(0.1, 0.52, 0.25);
    group.add(rightPupil);

    return group;
  }

  private updateLabel(id: string, player: ClientPlayer, group: THREE.Group): void {
    let label = this.labels.get(id);
    if (!label) {
      label = document.createElement("div");
      label.style.cssText = "position:fixed;pointer-events:none;font-size:12px;font-weight:bold;color:#333;text-shadow:0 0 3px white;white-space:nowrap;transform:translate(-50%,-100%);z-index:5;";
      document.getElementById("ui-overlay")!.appendChild(label);
      this.labels.set(id, label);
    }

    label.style.display = "";
    label.textContent = player.name;

    // Project 3D position to screen
    const pos = new THREE.Vector3().copy(group.position);
    pos.y += 1.2;
    pos.project(this.camera);
    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
  }

  dispose(): void {
    for (const [id, group] of this.meshes) {
      this.scene.remove(group);
    }
    this.meshes.clear();
    for (const label of this.labels.values()) {
      label.remove();
    }
    this.labels.clear();
  }
}
```

- [ ] **Step 2: Create ParticleSystem.ts**

```typescript
// client/src/game/entities/ParticleSystem.ts
import * as THREE from "three";

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: Particle[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawnDeathEffect(worldX: number, worldZ: number, color: number): void {
    const count = 20;
    const geom = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const mat = new THREE.MeshBasicMaterial({ color });

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(worldX, 0.5, worldZ);
      this.scene.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * speed,
        vy: 2 + Math.random() * 3,
        vz: Math.sin(angle) * speed,
        life: 1.0,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 9.8 * dt;
      p.life -= dt * 1.5;
      p.mesh.scale.setScalar(Math.max(0, p.life));

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        this.particles.splice(i, 1);
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/game/entities/
git commit -m "feat: player character renderer and death particle system"
```

---

## Task 9: Client — HUD, Minimap, Name Entry, Death Screen

Build all the HTML overlay UI components.

**Files:**
- Rewrite: `client/src/game/ui/HUD.ts`
- Create: `client/src/game/ui/Minimap.ts`
- Create: `client/src/game/ui/NameEntry.ts`
- Create: `client/src/game/ui/DeathScreen.ts`

- [ ] **Step 1: Rewrite HUD.ts**

```typescript
// client/src/game/ui/HUD.ts
import { useStore } from "../../store.js";
import { PLAYER_COLORS } from "@template/shared";

export class HUD {
  private topLeft: HTMLElement;
  private topRight: HTMLElement;

  constructor() {
    this.topLeft = document.getElementById("hud-top-left")!;
    this.topRight = document.getElementById("hud-top-right")!;

    this.topLeft.style.cssText = "color:#333; font-size:16px; font-weight:bold;";
    this.topRight.style.cssText = "color:#333; font-size:14px; min-width:180px; background:rgba(255,255,255,0.7); border-radius:8px; padding:8px 12px;";
  }

  update(): void {
    const state = useStore.getState();
    const myPlayer = state.players.get(state.playerId);
    const playable = state.playableCells || 1;

    // Top-left: territory % and kills
    if (myPlayer) {
      const pct = ((myPlayer.territoryCount / playable) * 100).toFixed(1);
      const color = `#${myPlayer.color.toString(16).padStart(6, "0")}`;
      this.topLeft.innerHTML = `
        <div style="background:${color}; color:white; padding:4px 12px; border-radius:4px; display:inline-block; margin-bottom:4px;">
          ${pct}%
        </div>
        <div style="margin-top:4px;">Kills: ${myPlayer.killCount}</div>
      `;
    }

    // Top-right: leaderboard
    const sorted = Array.from(state.players.values())
      .filter(p => p.alive)
      .sort((a, b) => b.territoryCount - a.territoryCount)
      .slice(0, 5);

    let lb = "<div style='font-weight:bold; margin-bottom:4px;'>Leaderboard</div>";
    sorted.forEach((p, i) => {
      const pct = ((p.territoryCount / playable) * 100).toFixed(1);
      const color = `#${p.color.toString(16).padStart(6, "0")}`;
      const isMe = p.id === state.playerId;
      lb += `<div style="display:flex; align-items:center; gap:6px; margin:2px 0; ${isMe ? "font-weight:bold;" : ""}">
        <span style="display:inline-block; width:10px; height:10px; background:${color}; border-radius:2px;"></span>
        <span>${i + 1}.</span>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis;">${p.name}</span>
        <span>${pct}%</span>
      </div>`;
    });
    this.topRight.innerHTML = lb;
  }
}
```

- [ ] **Step 2: Create Minimap.ts**

```typescript
// client/src/game/ui/Minimap.ts
import { GRID_SIZE, PLAYER_COLORS, BOUNDARY_CELL } from "@template/shared";

const MINIMAP_SIZE = 150;

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = MINIMAP_SIZE;
    this.canvas.height = MINIMAP_SIZE;
    this.canvas.style.cssText = "border-radius:50%; border:3px solid rgba(0,0,0,0.2); background:#f0f0f0;";
    document.getElementById("minimap-container")!.appendChild(this.canvas);

    this.ctx = this.canvas.getContext("2d")!;
    this.imageData = this.ctx.createImageData(MINIMAP_SIZE, MINIMAP_SIZE);
  }

  update(grid: Uint8Array | null): void {
    if (!grid) return;

    const scale = GRID_SIZE / MINIMAP_SIZE;
    const data = this.imageData.data;
    const centerX = MINIMAP_SIZE / 2;
    const centerY = MINIMAP_SIZE / 2;
    const radius = MINIMAP_SIZE / 2;

    for (let my = 0; my < MINIMAP_SIZE; my++) {
      for (let mx = 0; mx < MINIMAP_SIZE; mx++) {
        const pi = (my * MINIMAP_SIZE + mx) * 4;

        // Circular mask
        const dx = mx - centerX;
        const dy = my - centerY;
        if (dx * dx + dy * dy > radius * radius) {
          data[pi] = 0; data[pi + 1] = 0; data[pi + 2] = 0; data[pi + 3] = 0;
          continue;
        }

        const gx = Math.floor(mx * scale);
        const gy = Math.floor(my * scale);
        const cell = grid[gy * GRID_SIZE + gx];

        if (cell === 0 || cell === BOUNDARY_CELL) {
          data[pi] = 240; data[pi + 1] = 240; data[pi + 2] = 240; data[pi + 3] = 255;
        } else {
          const c = PLAYER_COLORS[(cell - 1) % PLAYER_COLORS.length];
          data[pi] = (c >> 16) & 0xff;
          data[pi + 1] = (c >> 8) & 0xff;
          data[pi + 2] = c & 0xff;
          data[pi + 3] = 255;
        }
      }
    }

    this.ctx.putImageData(this.imageData, 0, 0);
  }
}
```

- [ ] **Step 3: Create NameEntry.ts**

```typescript
// client/src/game/ui/NameEntry.ts
export class NameEntry {
  private container: HTMLElement;
  private input: HTMLInputElement;
  private button: HTMLButtonElement;
  private onPlay: ((name: string) => void) | null = null;

  constructor() {
    this.container = document.getElementById("name-entry")!;
    this.input = document.getElementById("name-input") as HTMLInputElement;
    this.button = document.getElementById("play-btn") as HTMLButtonElement;

    this.button.addEventListener("click", () => this.submit());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit();
    });

    this.input.focus();
  }

  setOnPlay(callback: (name: string) => void): void {
    this.onPlay = callback;
  }

  private submit(): void {
    const name = this.input.value.trim() || `Player${Math.floor(Math.random() * 999)}`;
    this.container.classList.add("hidden");
    if (this.onPlay) this.onPlay(name);
  }

  show(): void {
    this.container.classList.remove("hidden");
    this.input.focus();
  }

  hide(): void {
    this.container.classList.add("hidden");
  }
}
```

- [ ] **Step 4: Create DeathScreen.ts**

```typescript
// client/src/game/ui/DeathScreen.ts
export class DeathScreen {
  private container: HTMLElement;
  private message: HTMLElement;
  private timer: HTMLElement;

  constructor() {
    this.container = document.getElementById("death-screen")!;
    this.message = document.getElementById("death-message")!;
    this.timer = document.getElementById("death-timer")!;
  }

  show(killerName?: string): void {
    this.message.textContent = killerName
      ? `Killed by ${killerName}`
      : "You died!";
    this.container.classList.add("visible");
  }

  updateTimer(secondsLeft: number): void {
    this.timer.textContent = `Respawning in ${Math.ceil(secondsLeft)}...`;
  }

  hide(): void {
    this.container.classList.remove("visible");
  }
}
```

- [ ] **Step 5: Delete old debug panel (optional — can keep for dev)**

Keep `DebugPanel.ts` but it will be updated later or can be ignored. No action needed.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/ui/
git commit -m "feat: HUD, minimap, name entry, and death screen UI overlays"
```

---

## Task 10: Client — LocalGame & Main Entry Point (Single-Player Playable)

Wire everything together: LocalGame runs the simulation with bots, main.ts handles the name entry → game start flow. This makes single-player playable.

**Files:**
- Rewrite: `client/src/game/local/LocalGame.ts`
- Rewrite: `client/src/main.ts`
- Modify: `client/src/game/debug/DebugPanel.ts`
- Delete: `client/src/game/net/Interpolation.ts` (will be rebuilt if needed for multiplayer)

- [ ] **Step 1: Rewrite LocalGame.ts**

```typescript
// client/src/game/local/LocalGame.ts
import { Simulation } from "@template/simulation";
import type { SimPlayer } from "@template/simulation";
import {
  BOT_COUNT, SERVER_TICK_RATE, countPlayableCells,
} from "@template/shared";
import { useStore } from "../../store.js";
import type { ClientPlayer } from "../../store.js";

export class LocalGame {
  sim: Simulation;
  private tickAccumulator = 0;
  private tickInterval = 1 / SERVER_TICK_RATE;

  constructor() {
    this.sim = new Simulation();
  }

  start(playerName: string): void {
    const store = useStore.getState();

    // Add human player
    const player = this.sim.addPlayer("local", playerName);
    store.setPlayerId("local");
    store.setGameStarted(true);
    store.setPlayableCells(this.sim.territory.playableCells);

    // Add bots
    this.sim.fillBots(BOT_COUNT);

    this.syncToStore();
  }

  tick(dt: number): void {
    this.tickAccumulator += dt;
    while (this.tickAccumulator >= this.tickInterval) {
      this.sim.tick(this.tickInterval);
      this.tickAccumulator -= this.tickInterval;
    }

    // Flush events
    const events = this.sim.events.flush();
    if (events.length > 0) {
      useStore.getState().pushEvents(events);
    }

    this.syncToStore();
  }

  sendHeading(targetHeading: number): void {
    this.sim.queueInput("local", { targetHeading });
  }

  private syncToStore(): void {
    const store = useStore.getState();

    // Sync players
    const newPlayers = new Map<string, ClientPlayer>();
    for (const [id, p] of this.sim.players) {
      newPlayers.set(id, {
        id: p.id,
        slotId: p.slotId,
        x: p.x,
        y: p.y,
        heading: p.heading,
        alive: p.alive,
        respawnTimer: p.respawnTimer,
        invulnTimer: p.invulnTimer,
        killCount: p.killCount,
        territoryCount: p.territoryCount,
        name: p.name,
        color: p.color,
        trail: [...p.trail],
      });
    }
    store.setPlayers(newPlayers);

    // Sync territory grid
    store.setTerritoryGrid(this.sim.territory.getFullGridCopy());
  }
}
```

- [ ] **Step 2: Rewrite main.ts**

```typescript
// client/src/main.ts
import { Game } from "./game/Game.js";
import { LocalGame } from "./game/local/LocalGame.js";
import { HUD } from "./game/ui/HUD.js";
import { Minimap } from "./game/ui/Minimap.js";
import { NameEntry } from "./game/ui/NameEntry.js";
import { DeathScreen } from "./game/ui/DeathScreen.js";
import { TerritoryRenderer } from "./game/world/TerritoryRenderer.js";
import { TrailRenderer } from "./game/entities/TrailRenderer.js";
import { PlayerRenderer } from "./game/entities/PlayerRenderer.js";
import { ParticleSystem } from "./game/entities/ParticleSystem.js";
import { useStore } from "./store.js";
import { EventType } from "@template/shared";

const game = new Game();
const hud = new HUD();
const minimap = new Minimap();
const nameEntry = new NameEntry();
const deathScreen = new DeathScreen();
const territoryRenderer = new TerritoryRenderer(game.scene);
const trailRenderer = new TrailRenderer(game.scene);
const playerRenderer = new PlayerRenderer(game.scene, game.camera);
const particleSystem = new ParticleSystem(game.scene);

let localGame: LocalGame | null = null;
let wasAlive = true;

nameEntry.setOnPlay((name) => {
  useStore.getState().setPlayerName(name);
  localGame = new LocalGame();
  localGame.start(name);
});

game.onUpdate = (dt: number) => {
  const store = useStore.getState();

  if (!localGame || !store.gameStarted) return;

  // Send input
  game.inputHandler.update();
  const myPlayer = store.players.get(store.playerId);
  if (myPlayer && myPlayer.alive) {
    game.inputHandler.setPlayerPosition(myPlayer.x, -myPlayer.y);
    if (game.inputHandler.hasInput) {
      localGame.sendHeading(game.inputHandler.targetHeading);
    }
  }

  // Tick simulation
  localGame.tick(dt);

  // Re-read store after tick
  const freshStore = useStore.getState();
  const freshPlayer = freshStore.players.get(freshStore.playerId);

  // Register player colors for territory renderer
  for (const p of freshStore.players.values()) {
    territoryRenderer.registerPlayerColor(p.slotId, p.color);
  }

  // Update renderers
  territoryRenderer.updateFromGrid(freshStore.territoryGrid!);
  playerRenderer.update(freshStore.players);

  // Update trails
  for (const p of freshStore.players.values()) {
    if (p.trail.length > 1) {
      trailRenderer.updateTrail(p.id, p.trail, p.color);
    } else {
      trailRenderer.updateTrail(p.id, [], p.color);
    }
  }

  // Camera follow
  if (freshPlayer && freshPlayer.alive) {
    game.cameraRig.setTarget(freshPlayer.x, -freshPlayer.y);
  }

  // Process events for VFX
  const events = freshStore.events;
  for (const ev of events) {
    if (ev.type === EventType.PlayerDeath) {
      const deadPlayer = freshStore.players.get(ev.playerId);
      const color = deadPlayer?.color ?? 0xffffff;
      particleSystem.spawnDeathEffect(ev.position.x, -ev.position.y, color);
    }
  }
  freshStore.clearEvents();

  // Death screen
  if (freshPlayer) {
    if (freshPlayer.alive && !wasAlive) {
      deathScreen.hide();
    } else if (!freshPlayer.alive && wasAlive) {
      const lastDeath = events.find(
        e => e.type === EventType.PlayerDeath && e.playerId === freshStore.playerId
      );
      const killerName = lastDeath?.killerId
        ? freshStore.players.get(lastDeath.killerId)?.name
        : undefined;
      deathScreen.show(killerName);
    }
    if (!freshPlayer.alive) {
      deathScreen.updateTimer(freshPlayer.respawnTimer);
    }
    wasAlive = freshPlayer.alive;
  }

  particleSystem.update(dt);
  hud.update();
  minimap.update(freshStore.territoryGrid);
};

// Start render loop immediately (scene renders behind name entry)
game.start();
```

- [ ] **Step 3: Update DebugPanel.ts (minimal changes)**

```typescript
// client/src/game/debug/DebugPanel.ts
import { Pane } from "tweakpane";
import { useStore } from "../../store.js";

export class DebugPanel {
  private pane: any;
  private params = {
    fps: 0,
    playerCount: 0,
    territoryPct: "0%",
    alive: true,
  };

  constructor() {
    this.pane = new Pane({ title: "Debug" });
    this.pane.addBinding(this.params, "fps", { readonly: true, format: (v: number) => v.toFixed(0) });
    this.pane.addBinding(this.params, "playerCount", { readonly: true });
    this.pane.addBinding(this.params, "territoryPct", { readonly: true });
    this.pane.addBinding(this.params, "alive", { readonly: true });
  }

  update(dt: number) {
    const state = useStore.getState();
    const myPlayer = state.players.get(state.playerId);
    this.params.fps = dt > 0 ? 1 / dt : 0;
    this.params.playerCount = state.players.size;
    if (myPlayer) {
      const pct = state.playableCells > 0
        ? ((myPlayer.territoryCount / state.playableCells) * 100).toFixed(1)
        : "0";
      this.params.territoryPct = `${pct}%`;
      this.params.alive = myPlayer.alive;
    }
    this.pane.refresh();
  }
}
```

- [ ] **Step 4: Delete obsolete files**

```bash
rm -f client/src/game/net/Interpolation.ts
```

- [ ] **Step 5: Verify the client builds**

Run: `pnpm --filter template-client build`
Expected: Build succeeds (may have warnings, no errors)

- [ ] **Step 6: Commit**

```bash
git add client/src/ 
git commit -m "feat: wire up single-player — LocalGame, main entry, all renderers connected"
```

- [ ] **Step 7: Manual test — start dev server and play**

Run: `pnpm dev:client`
Open: `http://localhost:3000`

Expected behavior:
1. Name entry overlay appears over the rendered scene
2. Type name, click Play or press Enter
3. Player spawns with small green territory circle
4. Mouse movement steers the player (continuous 360° movement)
5. Leaving territory creates a visible trail
6. Returning to territory claims the enclosed area (territory texture updates)
7. AI bots are visible, moving, claiming territory
8. Leaderboard shows top 5 by territory %
9. Minimap shows territory overview in bottom-left
10. Getting killed shows death screen, respawns after 3 seconds
11. Killing a bot shows debris particles

Debug any issues found during manual testing before moving on.

---

## Task 11: Server — Colyseus Schema & GameRoom (Multiplayer)

Rewrite the server for Paper.io multiplayer with binary territory sync and trail broadcasts.

**Files:**
- Rewrite: `server/src/schema/GameState.ts`
- Rewrite: `server/src/rooms/GameRoom.ts`

- [ ] **Step 1: Rewrite GameState.ts schema**

```typescript
// server/src/schema/GameState.ts
import { Schema, type, MapSchema } from "@colyseus/schema";

export class PlayerSchema extends Schema {
  @type("uint8") slotId: number = 0;
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") heading: number = 0;
  @type("boolean") alive: boolean = true;
  @type("float32") respawnTimer: number = 0;
  @type("float32") invulnTimer: number = 0;
  @type("uint16") killCount: number = 0;
  @type("uint16") territoryCount: number = 0;
  @type("string") name: string = "";
  @type("uint32") color: number = 0;
}

export class GameStateSchema extends Schema {
  @type("uint8") version: number = 1;
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
```

- [ ] **Step 2: Rewrite GameRoom.ts**

```typescript
// server/src/rooms/GameRoom.ts
import { Room, Client } from "colyseus";
import { GameStateSchema, PlayerSchema } from "../schema/GameState.js";
import { SERVER_TICK_RATE, BOT_COUNT, GRID_SIZE } from "@template/shared";
import { Simulation } from "@template/simulation";

export class GameRoom extends Room<GameStateSchema> {
  state = new GameStateSchema();
  sim!: Simulation;
  private trailBroadcastTimer = 0;
  private trailBroadcastInterval = 1 / 5; // 5Hz

  onCreate() {
    this.sim = new Simulation();

    // Fill with bots initially
    this.sim.fillBots(BOT_COUNT);
    this.syncPlayersToSchema();

    this.setSimulationInterval(
      (delta) => this.tick(delta),
      1000 / SERVER_TICK_RATE
    );

    this.onMessage("input", (client, data: { targetHeading: number }) => {
      if (typeof data.targetHeading === "number") {
        this.sim.queueInput(client.sessionId, { targetHeading: data.targetHeading });
      }
    });
  }

  onJoin(client: Client, options?: { name?: string }) {
    const name = (options?.name || `Player${Math.floor(Math.random() * 999)}`).slice(0, 16);
    this.sim.addPlayer(client.sessionId, name);
    this.syncPlayersToSchema();

    // Send full territory grid to new player
    const gridCopy = this.sim.territory.getFullGridCopy();
    client.sendBytes("territory_full", gridCopy);
  }

  onLeave(client: Client) {
    this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  private tick(delta: number) {
    const dt = delta / 1000;
    this.sim.tick(dt);

    // Sync player schema
    this.syncPlayersToSchema();

    // Broadcast territory patches
    for (const patch of this.sim.pendingTerritoryPatches) {
      const buffer = new Uint8Array(1 + patch.cells.length * 3);
      buffer[0] = patch.slotId;
      for (let i = 0; i < patch.cells.length; i++) {
        const cellIdx = patch.cells[i];
        buffer[1 + i * 3] = cellIdx & 0xff;
        buffer[1 + i * 3 + 1] = (cellIdx >> 8) & 0xff;
        buffer[1 + i * 3 + 2] = (cellIdx >> 16) & 0xff;
      }
      this.broadcast("territory_patch", buffer);
    }

    // Broadcast trail updates at reduced rate
    this.trailBroadcastTimer += dt;
    if (this.trailBroadcastTimer >= this.trailBroadcastInterval) {
      this.trailBroadcastTimer = 0;
      const trailUpdates = this.sim.getTrailUpdates();
      if (trailUpdates.length > 0) {
        this.broadcast("trails", trailUpdates);
      }
    }

    // Broadcast events
    const events = this.sim.events.flush();
    if (events.length > 0) {
      this.broadcast("events", events);
    }
  }

  private syncPlayersToSchema() {
    const activeIds = new Set<string>();
    for (const [id, p] of this.sim.players) {
      activeIds.add(id);
      let schema = this.state.players.get(id);
      if (!schema) {
        schema = new PlayerSchema();
        this.state.players.set(id, schema);
      }
      schema.slotId = p.slotId;
      schema.x = p.x;
      schema.y = p.y;
      schema.heading = p.heading;
      schema.alive = p.alive;
      schema.respawnTimer = p.respawnTimer;
      schema.invulnTimer = p.invulnTimer;
      schema.killCount = p.killCount;
      schema.territoryCount = p.territoryCount;
      schema.name = p.name;
      schema.color = p.color;
    }
    for (const key of this.state.players.keys()) {
      if (!activeIds.has(key)) this.state.players.delete(key);
    }
  }
}
```

- [ ] **Step 3: Verify server typecheck**

Run: `pnpm --filter template-server typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/src/
git commit -m "feat: Colyseus GameRoom with binary territory sync and trail broadcasts"
```

---

## Task 12: Client — NetClient (Multiplayer Connection)

Rewrite the network client to connect to the Colyseus server, receive territory patches and trail updates.

**Files:**
- Rewrite: `client/src/game/net/NetClient.ts`
- Modify: `client/src/main.ts` (add multiplayer mode toggle)

- [ ] **Step 1: Rewrite NetClient.ts**

```typescript
// client/src/game/net/NetClient.ts
import { Client, Room, getStateCallbacks } from "colyseus.js";
import { GRID_SIZE, initBoundaryGrid } from "@template/shared";
import type { GameEvent, TrailUpdate } from "@template/shared";
import { useStore } from "../../store.js";
import type { ClientPlayer } from "../../store.js";

export class NetClient {
  private client: Client;
  private room: Room | null = null;
  private localGrid: Uint8Array;

  constructor(serverUrl: string) {
    this.client = new Client(serverUrl);
    this.localGrid = initBoundaryGrid();
  }

  async connect(playerName: string): Promise<void> {
    this.room = await this.client.joinOrCreate("game_room", { name: playerName });
    const store = useStore.getState();
    store.setPlayerId(this.room.sessionId);
    store.setConnected(true);

    const $ = getStateCallbacks(this.room);

    // Player listeners
    $(this.room.state).players.onAdd((player: any, key: string) => {
      this.syncPlayer(key, player);
      $(player).onChange(() => this.syncPlayer(key, player));
    });

    $(this.room.state).players.onRemove((_: any, key: string) => {
      useStore.getState().removePlayer(key);
    });

    // Territory: full grid
    this.room.onMessage("territory_full", (data: Uint8Array) => {
      this.localGrid = new Uint8Array(data);
      useStore.getState().setTerritoryGrid(new Uint8Array(this.localGrid));
    });

    // Territory: delta patch
    this.room.onMessage("territory_patch", (data: Uint8Array) => {
      const slotId = data[0];
      for (let i = 0; i < (data.length - 1) / 3; i++) {
        const cellIdx = data[1 + i * 3] | (data[1 + i * 3 + 1] << 8) | (data[1 + i * 3 + 2] << 16);
        if (cellIdx >= 0 && cellIdx < this.localGrid.length) {
          this.localGrid[cellIdx] = slotId;
        }
      }
      useStore.getState().setTerritoryGrid(new Uint8Array(this.localGrid));
    });

    // Trail updates
    this.room.onMessage("trails", (updates: TrailUpdate[]) => {
      const store = useStore.getState();
      const players = new Map(store.players);
      for (const update of updates) {
        const p = players.get(update.playerId);
        if (p) {
          players.set(update.playerId, { ...p, trail: update.trail });
        }
      }
      store.setPlayers(players);
    });

    // Game events
    this.room.onMessage("events", (events: GameEvent[]) => {
      useStore.getState().pushEvents(events);
    });
  }

  private syncPlayer(key: string, player: any): void {
    const store = useStore.getState();
    const players = new Map(store.players);
    const existing = players.get(key);
    const updated: ClientPlayer = {
      id: key,
      slotId: player.slotId,
      x: player.x,
      y: player.y,
      heading: player.heading,
      alive: player.alive,
      respawnTimer: player.respawnTimer,
      invulnTimer: player.invulnTimer,
      killCount: player.killCount,
      territoryCount: player.territoryCount,
      name: player.name,
      color: player.color,
      trail: existing?.trail ?? [],
    };
    players.set(key, updated);
    store.setPlayers(players);
  }

  sendHeading(targetHeading: number): void {
    this.room?.send("input", { targetHeading });
  }

  disconnect(): void {
    this.room?.leave();
    this.room = null;
    useStore.getState().setConnected(false);
  }
}
```

- [ ] **Step 2: Update main.ts to support multiplayer mode**

Add a multiplayer toggle. For now, single-player is default. Add a `?mp=true` query parameter to enable multiplayer. Insert this near the top of `main.ts`, after imports:

```typescript
const params = new URLSearchParams(window.location.search);
const isMultiplayer = params.get("mp") === "true";
```

Then modify the `nameEntry.setOnPlay` callback to branch:

```typescript
let netClient: NetClient | null = null;

nameEntry.setOnPlay(async (name) => {
  useStore.getState().setPlayerName(name);
  if (isMultiplayer) {
    const { NetClient } = await import("./game/net/NetClient.js");
    netClient = new NetClient("ws://localhost:2567");
    await netClient.connect(name);
    useStore.getState().setGameStarted(true);
    useStore.getState().setPlayableCells(
      // Approximate — will be corrected when grid arrives
      Math.floor(Math.PI * 200 * 200)
    );
  } else {
    localGame = new LocalGame();
    localGame.start(name);
  }
});
```

In the `game.onUpdate` callback, the input sending section should also handle multiplayer:

```typescript
  // Send input — replace the existing localGame.sendHeading call
  if (myPlayer && myPlayer.alive && game.inputHandler.hasInput) {
    if (localGame) {
      localGame.sendHeading(game.inputHandler.targetHeading);
    } else if (netClient) {
      netClient.sendHeading(game.inputHandler.targetHeading);
    }
  }
```

And skip the `localGame.tick(dt)` call when in multiplayer mode:

```typescript
  if (localGame) {
    localGame.tick(dt);
  }
```

Add import for NetClient type at the top:

```typescript
import type { NetClient as NetClientType } from "./game/net/NetClient.js";
```

- [ ] **Step 3: Commit**

```bash
git add client/src/
git commit -m "feat: multiplayer NetClient with binary territory sync and trail updates"
```

---

## Task 13: Polish & Final Testing

Final integration testing, bug fixes, and competition compliance.

**Files:**
- Various fixes as needed

- [ ] **Step 1: Test single-player mode**

Run: `pnpm dev:client`
Open: `http://localhost:3000`

Verify all 11 behaviors from Task 10 Step 7.

- [ ] **Step 2: Test multiplayer mode**

Run in terminal 1: `pnpm dev:server`
Run in terminal 2: `pnpm dev:client`
Open: `http://localhost:3000?mp=true` in two browser tabs

Verify:
- Both players see each other
- Territory claiming syncs between clients
- Trail visibility syncs
- Killing works between players
- Leaderboard shows all players

- [ ] **Step 3: Verify vibejam compliance**

Check:
- [ ] `<script async src="https://vibej.am/2026/widget.js"></script>` is in index.html
- [ ] No loading screen — game scene renders immediately, name entry is an overlay
- [ ] No login/signup required
- [ ] Works in desktop browser
- [ ] Page title is "Capture Arena" (not "Template Game")

- [ ] **Step 4: Fix any bugs found during testing**

Address issues found during manual testing. Common things to check:
- Territory texture orientation (may need Y-flip)
- Coordinate mapping between game (x, y) and Three.js (x, -z)
- Trail rendering alignment with player position
- Camera follow smoothness
- Death/respawn cycle working cleanly
- Bots behaving reasonably (not all dying instantly, not stuck)

- [ ] **Step 5: Build production client**

Run: `pnpm --filter template-client build`
Expected: Clean build with no errors

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: Capture Arena — Paper.io 2 clone for vibejam 2026"
```

---

## Appendix: Coordinate Mapping Reference

The simulation uses a 2D coordinate system where:
- `x` is horizontal (left/right)
- `y` is vertical (forward/backward in top-down view)
- `heading = 0` means facing right (+x direction)
- `heading = Math.atan2(dy, dx)` follows standard math convention

Three.js uses:
- `x` → same as game `x`
- `y` → height (up)
- `z` → opposite of game `y` (Three.js z+ is toward camera in default view)

**Mapping:** game `(x, y)` → Three.js `(x, 0, -y)`

This mapping applies everywhere:
- Player position: `mesh.position.set(player.x, height, -player.y)`
- Camera target: `cameraRig.setTarget(player.x, -player.y)`
- Input heading: `heading = Math.atan2(-dz, dx)` (from Three.js ground intersection)
- Trail points: same mapping per point
- Territory texture: rendered with standard UV mapping on a rotated plane
