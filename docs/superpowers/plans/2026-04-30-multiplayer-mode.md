# Multiplayer Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-authoritative multiplayer mode to captureArena, hosted on Railway, with single-player preserved.

**Architecture:** Extract simulation logic from `prototype/main.js` into a pure-JS `Simulation` class shared by both modes. Single-player ticks the Simulation locally; multiplayer ticks it on a Colyseus server and syncs state to clients. State sync uses Colyseus Schema for per-tick fields and broadcast events for territory claims (each client re-runs the same `_claim()` logic for grid updates).

**Tech Stack:** Three.js (renderer), Colyseus 0.16 (server framework), Express (static serving), vitest (unit tests), Docker + Railway (deploy).

---

## File Structure

```
prototype/
  main.js              # Refactored to renderer + input only
  multiplayer.js       # NEW — Colyseus client + state-to-render bridge
  ui.js                # Unchanged
  index.html           # Add Solo/Online mode picker
  package.json         # NEW — minimal, for vitest
  sim/                 # NEW — pure-JS, no THREE.js imports
    Simulation.js      # Owns grid, characters, tick(), claim(), heal()
    Character.js       # Plain data class
    BotAI.js           # Bot logic
    faction.js         # Moved from prototype/faction.js
    match.js           # Moved from prototype/match.js
    scoring.js         # Moved from prototype/scoring.js
    constants.js       # Tuning constants
    __tests__/         # Unit tests

server/
  src/
    index.ts           # Add Express static middleware
    rooms/GameRoom.ts  # Filled in (was stub)
    schema/GameState.ts # Replaced
    sim/               # Copied from prototype/sim/ via prebuild script
    __tests__/         # Server unit tests
  package.json         # Add express, vitest

Dockerfile             # NEW
railway.toml           # NEW
.dockerignore          # NEW
```

---

## Pre-Flight: Test Infrastructure

### Task 0: Set up vitest at workspace root

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`
- Create: `prototype/package.json`

- [ ] **Step 1: Add vitest to root devDependencies**

Run:
```bash
pnpm add -D -w vitest @vitest/ui
```

Expected: `package.json` updated, `pnpm-lock.yaml` updated.

- [ ] **Step 2: Create vitest.config.js at workspace root**

Create `vitest.config.js`:
```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "prototype/sim/__tests__/**/*.test.js",
      "server/src/__tests__/**/*.test.ts",
    ],
    environment: "node",
  },
});
```

- [ ] **Step 3: Add test script to root package.json**

Edit `package.json` `scripts` section to add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create prototype/package.json (minimal — for ES module resolution)**

Create `prototype/package.json`:
```json
{
  "name": "captureArena-prototype",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 5: Verify vitest runs (no tests yet)**

Run: `pnpm test`
Expected: `No test files found, exiting with code 0` or similar — vitest installed and configured.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.js prototype/package.json
git commit -m "chore: add vitest at workspace root for sim + server tests"
```

---

## Phase 1: Simulation Extraction

This phase refactors `prototype/main.js` to extract simulation logic into `prototype/sim/`. Single-player must play identically when finished. **Manual verification at end of phase: load `prototype/index.html`, play single-player, confirm claim/kill/respawn/end-screen all work.**

### Task 1: Move existing pure-logic files into sim/

**Files:**
- Move: `prototype/faction.js` → `prototype/sim/faction.js`
- Move: `prototype/match.js` → `prototype/sim/match.js`
- Move: `prototype/scoring.js` → `prototype/sim/scoring.js`
- Modify: `prototype/main.js` (update imports)
- Modify: `prototype/ui.js` (update imports)

- [ ] **Step 1: Create sim/ directory and move files**

```bash
mkdir -p prototype/sim
git mv prototype/faction.js prototype/sim/faction.js
git mv prototype/match.js prototype/sim/match.js
git mv prototype/scoring.js prototype/sim/scoring.js
```

- [ ] **Step 2: Update imports in main.js**

In `prototype/main.js`, replace:
```js
import { FactionManager, FACTION_COUNT, CHARS_PER_FACTION, FACTION_NAMES, FACTION_COLORS } from "./faction.js";
import { MatchManager } from "./match.js";
import { ScoreTracker } from "./scoring.js";
```

with:
```js
import { FactionManager, FACTION_COUNT, CHARS_PER_FACTION, FACTION_NAMES, FACTION_COLORS } from "./sim/faction.js";
import { MatchManager } from "./sim/match.js";
import { ScoreTracker } from "./sim/scoring.js";
```

- [ ] **Step 3: Update imports in ui.js**

In `prototype/ui.js`, replace:
```js
import { FACTION_COLORS, FACTION_COUNT } from "./faction.js";
```

with:
```js
import { FACTION_COLORS, FACTION_COUNT } from "./sim/faction.js";
```

- [ ] **Step 4: Verify single-player still works**

Run: `cd prototype && python3 -m http.server 8000`
Open `http://localhost:8000/` in browser.
Expected: Title screen → click Play → game loads → can move and claim territory.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move faction/match/scoring into prototype/sim/"
```

### Task 2: Extract tuning constants into sim/constants.js

**Files:**
- Create: `prototype/sim/constants.js`
- Modify: `prototype/main.js` (replace literals with imports)

- [ ] **Step 1: Identify constants in main.js**

Look at `prototype/main.js` lines 1-22 (the const declarations near the top: `GRID_SIZE`, `WORLD_SIZE`, `CELL_SIZE`, `ARENA_RADIUS`, `SENTINEL`, `TRAIL_VERTEX_GAP`, `SELF_TRAIL_SKIP`, `BOT_COUNT`, `RESPAWN_DELAY`, `INVULN_TIME`, `CAMERA_HEIGHT`, `CAMERA_Z_OFFSET`, `CONTINUOUS_LAND`, `BOT_NAMES`).

- [ ] **Step 2: Create prototype/sim/constants.js**

Create `prototype/sim/constants.js`:
```js
import { FACTION_COUNT, CHARS_PER_FACTION } from "./faction.js";

export const GRID_SIZE = 1024;
export const WORLD_SIZE = 49.0;
export const CELL_SIZE = WORLD_SIZE / GRID_SIZE;
export const ARENA_RADIUS = 24.5;
export const SENTINEL = 255;

export const TRAIL_VERTEX_GAP = 0.25;
export const SELF_TRAIL_SKIP = 5;

export const BOT_COUNT = FACTION_COUNT * CHARS_PER_FACTION - 1;
export const RESPAWN_DELAY = 3;
export const INVULN_TIME = 2;

export const CAMERA_HEIGHT = 34;
export const CAMERA_Z_OFFSET = 26;

export const CONTINUOUS_LAND = true;

export const BOT_NAMES = [
  "K-9","Lime","Toe","Leaf Assassin","Helmet Destroyer","Star Jammer",
  "Sky Bully","Daisy Stick","Claw","Blitz","Nova","Shade","Rook","Pixel",
  "Echo","Drift","Fang","Jinx","Bolt"
];
```

**Important:** The actual numeric values must match what's currently in `prototype/main.js` — read those exact values from main.js and use them here. The values shown above are placeholders; copy from the actual source.

- [ ] **Step 3: Replace declarations in main.js with imports**

In `prototype/main.js` near the top, remove the const declarations for the names listed in Step 1 and add:
```js
import {
  GRID_SIZE, WORLD_SIZE, CELL_SIZE, ARENA_RADIUS, SENTINEL,
  TRAIL_VERTEX_GAP, SELF_TRAIL_SKIP,
  BOT_COUNT, RESPAWN_DELAY, INVULN_TIME,
  CAMERA_HEIGHT, CAMERA_Z_OFFSET,
  CONTINUOUS_LAND, BOT_NAMES,
} from "./sim/constants.js";
```

- [ ] **Step 4: Manual verification**

Run: `cd prototype && python3 -m http.server 8000`
Expected: Game still plays identically — same arena size, same speeds, same camera, same bot names appear.

- [ ] **Step 5: Commit**

```bash
git add prototype/sim/constants.js prototype/main.js
git commit -m "refactor: extract tuning constants into sim/constants.js"
```

### Task 3: Create Character data class with tests

**Files:**
- Create: `prototype/sim/Character.js`
- Create: `prototype/sim/__tests__/Character.test.js`

- [ ] **Step 1: Write the failing test**

Create `prototype/sim/__tests__/Character.test.js`:
```js
import { describe, it, expect } from "vitest";
import { Character } from "../Character.js";

describe("Character", () => {
  it("constructs with default state", () => {
    const c = new Character({ id: 0, factionId: 1, name: "Alpha" });
    expect(c.id).toBe(0);
    expect(c.factionId).toBe(1);
    expect(c.name).toBe("Alpha");
    expect(c.alive).toBe(true);
    expect(c.isHuman).toBe(false);
    expect(c.pos).toEqual({ x: 0, z: 0 });
    expect(c.dir).toEqual({ x: 0, z: 1 });
    expect(c.targetDir).toEqual({ x: 0, z: 1 });
    expect(c.trailVerts).toEqual([]);
    expect(c.killCount).toBe(0);
    expect(c.invulnTimer).toBe(0);
    expect(c.respawnTimer).toBe(0);
  });

  it("setPos updates position immutably (new object)", () => {
    const c = new Character({ id: 0, factionId: 1, name: "X" });
    const before = c.pos;
    c.setPos(3, 5);
    expect(c.pos).toEqual({ x: 3, z: 5 });
    expect(before).toEqual({ x: 0, z: 0 }); // original not mutated
  });

  it("kill sets alive=false and starts respawn timer", () => {
    const c = new Character({ id: 0, factionId: 1, name: "X", respawnDelay: 3 });
    c.kill();
    expect(c.alive).toBe(false);
    expect(c.respawnTimer).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

Run: `pnpm test`
Expected: FAIL — `Character` not defined.

- [ ] **Step 3: Implement Character.js**

Create `prototype/sim/Character.js`:
```js
export class Character {
  constructor({ id, factionId, name, respawnDelay = 3 }) {
    this.id = id;
    this.factionId = factionId;
    this.name = name;
    this.respawnDelay = respawnDelay;

    this.alive = true;
    this.isHuman = false;
    this.pos = { x: 0, z: 0 };
    this.dir = { x: 0, z: 1 };
    this.targetDir = { x: 0, z: 1 };
    this.speed = 6;
    this.trailVerts = [];
    this.invulnTimer = 0;
    this.respawnTimer = 0;
    this.killCount = 0;
  }

  setPos(x, z) {
    this.pos = { x, z };
  }

  setDir(x, z) {
    this.dir = { x, z };
  }

  kill() {
    this.alive = false;
    this.respawnTimer = this.respawnDelay;
    this.trailVerts = [];
    this.invulnTimer = 0;
  }

  respawn(x, z) {
    this.alive = true;
    this.pos = { x, z };
    this.respawnTimer = 0;
    this.invulnTimer = 2;
    this.trailVerts = [];
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

Run: `pnpm test`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add prototype/sim/Character.js prototype/sim/__tests__/Character.test.js
git commit -m "feat: add Character data class with tests"
```

### Task 4: Create Simulation skeleton with grid + character lifecycle

**Files:**
- Create: `prototype/sim/Simulation.js`
- Create: `prototype/sim/__tests__/Simulation.test.js`

- [ ] **Step 1: Write the failing tests**

Create `prototype/sim/__tests__/Simulation.test.js`:
```js
import { describe, it, expect, beforeEach } from "vitest";
import { Simulation } from "../Simulation.js";
import { GRID_SIZE, SENTINEL, ARENA_RADIUS } from "../constants.js";
import { FACTION_COUNT, CHARS_PER_FACTION } from "../faction.js";

describe("Simulation", () => {
  let sim;
  beforeEach(() => {
    sim = new Simulation({ seed: 1234 });
    sim.start();
  });

  it("creates a 1024x1024 grid initialized with sentinel outside arena", () => {
    expect(sim.grid).toBeInstanceOf(Uint8Array);
    expect(sim.grid.length).toBe(GRID_SIZE * GRID_SIZE);
    // top-left corner is outside the circular arena → sentinel
    expect(sim.grid[0]).toBe(SENTINEL);
    // center of arena is inside → not sentinel
    const ci = (GRID_SIZE / 2) * GRID_SIZE + (GRID_SIZE / 2);
    expect(sim.grid[ci]).not.toBe(SENTINEL);
  });

  it("creates 30 characters spread across 5 factions", () => {
    expect(sim.characters.length).toBe(FACTION_COUNT * CHARS_PER_FACTION);
    const byFaction = new Map();
    for (const c of sim.characters) {
      byFaction.set(c.factionId, (byFaction.get(c.factionId) ?? 0) + 1);
    }
    for (let f = 1; f <= FACTION_COUNT; f++) {
      expect(byFaction.get(f)).toBe(CHARS_PER_FACTION);
    }
  });

  it("all characters start with isHuman=false", () => {
    expect(sim.characters.every(c => c.isHuman === false)).toBe(true);
  });

  it("has a tick method that decrements match timeRemaining", () => {
    const before = sim.matchManager.timeRemaining;
    sim.tick(0.1);
    expect(sim.matchManager.timeRemaining).toBeCloseTo(before - 0.1, 5);
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

Run: `pnpm test`
Expected: FAIL — `Simulation` not defined.

- [ ] **Step 3: Implement Simulation.js skeleton**

Create `prototype/sim/Simulation.js`:
```js
import { GRID_SIZE, WORLD_SIZE, CELL_SIZE, ARENA_RADIUS, SENTINEL,
         RESPAWN_DELAY, BOT_NAMES } from "./constants.js";
import { FactionManager, FACTION_COUNT, CHARS_PER_FACTION } from "./faction.js";
import { MatchManager } from "./match.js";
import { ScoreTracker } from "./scoring.js";
import { Character } from "./Character.js";

const WORLD_MIN = -WORLD_SIZE / 2;

export class Simulation {
  constructor({ seed = 1 } = {}) {
    this.seed = seed;
    this.grid = new Uint8Array(GRID_SIZE * GRID_SIZE);
    this.factionManager = new FactionManager();
    this.matchManager = new MatchManager();
    this.scoreTracker = new ScoreTracker();
    this.characters = [];
    this.started = false;

    // Event hooks (set by host: server or client). Optional.
    this.onClaim = null;       // (charId, trailPoints, factionId) => void
    this.onHeal = null;        // (changedCells) => void
    this.onTrailVertex = null; // (charId, x, z) => void
    this.onKill = null;        // (killerId, victimId) => void
  }

  start() {
    this._initGrid();
    this._initCharacters();
    this.factionManager.init(this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, SENTINEL);
    for (const c of this.characters) {
      this.factionManager.addCharacter(c, c.factionId);
    }
    this.matchManager.start();
    this.started = true;
  }

  _initGrid() {
    const cx = GRID_SIZE / 2;
    const cz = GRID_SIZE / 2;
    const r2 = (ARENA_RADIUS / CELL_SIZE) ** 2;
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const dx = x - cx, dz = y - cz;
        this.grid[y * GRID_SIZE + x] = (dx * dx + dz * dz > r2) ? SENTINEL : 0;
      }
    }
  }

  _initCharacters() {
    const total = FACTION_COUNT * CHARS_PER_FACTION;
    let id = 0;
    for (let f = 1; f <= FACTION_COUNT; f++) {
      for (let i = 0; i < CHARS_PER_FACTION; i++) {
        const name = BOT_NAMES[id % BOT_NAMES.length];
        const c = new Character({ id, factionId: f, name, respawnDelay: RESPAWN_DELAY });
        this.characters.push(c);
        id++;
      }
    }
  }

  tick(dt) {
    if (!this.started) return;
    this.matchManager.update(dt);
    // Physics, claim, heal will be added in later tasks.
  }
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `pnpm test`
Expected: 4 Simulation tests pass.

- [ ] **Step 5: Commit**

```bash
git add prototype/sim/Simulation.js prototype/sim/__tests__/Simulation.test.js
git commit -m "feat: add Simulation skeleton with grid + character init"
```

### Task 5: Migrate physics, trail, claim, heal logic into Simulation

This is the core refactor. The current logic is in the `Game` class in `prototype/main.js`. We'll move pure simulation methods (no THREE.js) into `Simulation` while keeping rendering in main.js.

**Files:**
- Modify: `prototype/sim/Simulation.js`
- Modify: `prototype/main.js` (delete migrated logic)
- Modify: `prototype/sim/__tests__/Simulation.test.js`

- [ ] **Step 1: Identify methods to migrate**

Read `prototype/main.js` and identify these methods on the `Game` class:
- `_updateCharacters(dt)` — physics step, position update, boundary, trail recording
- `_updateTrails(dt)` — adds trail vertices when char moves far enough
- `_checkTrailKills()` — collision detection for trail kills
- `_claim(char)` — when a character closes a loop, claim enclosed cells
- `_floodFillConnected(ownerId, reassignTo)` — territory fragment management
- `_healUnclaimedCells()` — heal pass to fill unclaimed cells
- `_checkCutoff()` — kill characters standing on enemy territory
- `_respawnChar(char)` — respawn logic

**Note their line ranges so you can find them again.**

- [ ] **Step 2: Write test for claim behavior**

Append to `prototype/sim/__tests__/Simulation.test.js`:
```js
describe("Simulation.claim", () => {
  it("claim with a triangle trail fills enclosed cells with the faction id", () => {
    const sim = new Simulation();
    sim.start();
    const char = sim.characters[0]; // faction 1
    char.factionId = 1;
    char.setPos(0, 0); // arena center
    // Create a small triangle trail in world coords near center
    char.trailVerts = [
      { x: -0.5, z: -0.5 },
      { x: 0.5,  z: -0.5 },
      { x: 0.0,  z: 0.5 },
    ];
    const claimedBefore = countCellsOwnedBy(sim.grid, 1);
    sim.claim(char);
    const claimedAfter = countCellsOwnedBy(sim.grid, 1);
    expect(claimedAfter).toBeGreaterThan(claimedBefore);
    expect(char.trailVerts.length).toBe(0); // trail cleared
  });

  it("claim with too-short trail is a no-op", () => {
    const sim = new Simulation();
    sim.start();
    const char = sim.characters[0];
    char.trailVerts = [{ x: 0, z: 0 }];
    const before = countCellsOwnedBy(sim.grid, 1);
    sim.claim(char);
    expect(countCellsOwnedBy(sim.grid, 1)).toBe(before);
  });
});

function countCellsOwnedBy(grid, factionId) {
  let n = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === factionId) n++;
  return n;
}
```

- [ ] **Step 3: Run tests (expect fail)**

Run: `pnpm test`
Expected: FAIL — `sim.claim is not a function`.

- [ ] **Step 4: Migrate methods from main.js to Simulation.js**

For each method listed in Step 1, copy it from `prototype/main.js` Game class into `Simulation` class in `prototype/sim/Simulation.js`. Adjust:
- Replace `this.grid` references — same name, works as-is
- Replace `THREE.Vector3(x, 0, z)` → `{ x, z }` plain objects
- Replace any `char.pos.x`, `char.pos.z` — same in both worlds
- Replace render-related calls (e.g., `this.territoryDirty = true`) — remove these from sim methods; the host sets these on its renderer in response to `onClaim` callback
- Where the migrated method calls a renderer method (e.g., `this._updateTrailMesh(char)`), remove that call from the sim copy

**Public API exposed on Simulation:**
- `tick(dt)` — full per-tick update
- `claim(char)` — call when a character closes a loop. Used both by sim's own claim-detection (solo) and by client receiving a TerritoryClaimEvent (set `char.trailVerts` from event payload, then call `claim(char)`).
- `setHumanControl(charId, isHuman)` — flip flag
- `setTargetDir(charId, dirX, dirZ)` — input from human or bot
- `respawnChar(char)` — public so callers can trigger respawn timing
- `restart()` — full re-init of grid, factions, characters (used by server between rounds; not used in solo)

Each migrated method is renamed to drop the leading `_` if it becomes part of the public API; keep `_` for internal helpers.

The full `tick(dt)` body should be:
```js
tick(dt) {
  if (!this.started) return;
  this.matchManager.update(dt);
  if (this.matchManager.phase !== "playing") return;
  this._stepCharacters(dt);
  this._stepTrails(dt);
  this._checkTrailKills();
  this._checkCutoff();
  this._handleRespawns(dt);
  this.factionManager.updateTerritoryPcts(this.grid, GRID_SIZE, SENTINEL);
}
```

Also add a `restart()` method (used by server between rounds; safe to leave unused in solo):
```js
restart() {
  // Reset grid + factions + characters back to fresh-match state
  this._initGrid();
  this.factionManager = new (this.factionManager.constructor)();
  this.factionManager.init(this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, SENTINEL);
  for (const c of this.characters) {
    c.alive = true;
    c.trailVerts = [];
    c.killCount = 0;
    c.invulnTimer = 0;
    c.respawnTimer = 0;
    this.factionManager.addCharacter(c, c.factionId);
  }
  this.matchManager = new (this.matchManager.constructor)();
  this.matchManager.start();
}
```

- [ ] **Step 5: Run tests (expect pass)**

Run: `pnpm test`
Expected: All Simulation tests pass.

- [ ] **Step 6: Commit**

```bash
git add prototype/sim/Simulation.js prototype/sim/__tests__/Simulation.test.js
git commit -m "feat: migrate physics, trail, claim, heal into Simulation class"
```

### Task 6: Refactor main.js Game class to consume Simulation

**Files:**
- Modify: `prototype/main.js`

This is the largest mechanical change. The Game class becomes a thin renderer + input layer over a `Simulation` instance.

- [ ] **Step 1: Add a Simulation instance to Game**

In `prototype/main.js`, in the `Game` class constructor:
```js
import { Simulation } from "./sim/Simulation.js";

// constructor:
this.sim = new Simulation();
this.sim.onClaim = (charId, trailPoints, factionId) => {
  this.territoryDirty = true;
  // also clear that char's trail mesh
  const char = this.sim.characters[charId];
  if (char) this._clearTrailMesh(char);
};
this.sim.onHeal = () => { this.territoryDirty = true; };
this.sim.onTrailVertex = (charId, x, z) => {
  const char = this.sim.characters[charId];
  if (char) this._appendTrailMesh(char, x, z);
};
this.sim.onKill = (killerId, victimId) => {
  // visual/audio FX for kill
};
```

- [ ] **Step 2: Wire game start to sim.start**

In `Game.start()`, after the existing setup but before the render-only initialization, call:
```js
this.sim.start();
this.factionManager = this.sim.factionManager;   // alias for existing code
this.matchManager = this.sim.matchManager;       // alias for existing code
this.scoreTracker = this.sim.scoreTracker;       // alias
this.grid = this.sim.grid;                       // alias
this.characters = this.sim.characters;           // alias
```

The aliases let the existing rendering code keep working without modification. We'll remove them in a later cleanup if desired.

- [ ] **Step 3: Replace per-frame sim work with sim.tick**

In `Game.tick(dt)`, find where the existing code does physics, trail, claim, kill, cutoff, faction-pct. Replace those calls with:
```js
// Push player's keyboard input into the sim
this.sim.setTargetDir(this.player.id, this.player.targetDir.x, this.player.targetDir.z);
// Run one simulation step
this.sim.tick(dt);
```

Keep all rendering-only work (camera tracking, mesh updates, UI updates, `_updateTerritoryTexture`, `_updateMinimap`).

- [ ] **Step 4: Verify single-player works identically**

Run: `cd prototype && python3 -m http.server 8000`
Open `http://localhost:8000/` in browser.

Manual checks:
- Title screen → Solo button (or current Play button) → game starts
- Player can move with WASD + mouse
- Player can claim territory by closing a loop
- Bots move and claim
- Player can kill a bot by crossing their trail
- Player gets killed if they cross a bot's trail
- Death → respawn cycle works
- 15-min timer counts down
- End screen appears at 0:00

- [ ] **Step 5: Commit**

```bash
git add prototype/main.js
git commit -m "refactor: Game class now consumes Simulation; renderer-only"
```

---

## Phase 2: Bot AI Extraction

### Task 7: Move bot AI logic into sim/BotAI.js

**Files:**
- Create: `prototype/sim/BotAI.js`
- Create: `prototype/sim/__tests__/BotAI.test.js`
- Modify: `prototype/sim/Simulation.js`
- Modify: `prototype/main.js` (remove bot AI code)

- [ ] **Step 1: Identify bot AI in main.js**

Locate in `prototype/main.js`:
- `_planBotLoop(char)` — waypoint planning (around lines 1129-1225 originally)
- The per-tick bot steering loop that converts waypoints into `targetDir`

- [ ] **Step 2: Write a smoke test for BotAI**

Create `prototype/sim/__tests__/BotAI.test.js`:
```js
import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation.js";
import { BotAI } from "../BotAI.js";

describe("BotAI", () => {
  it("planTargetDir returns a unit vector for a bot character", () => {
    const sim = new Simulation();
    sim.start();
    const bot = sim.characters[1];
    bot.setPos(0, 0);
    const dir = BotAI.planTargetDir(bot, sim);
    expect(dir).toHaveProperty("x");
    expect(dir).toHaveProperty("z");
    const len = Math.hypot(dir.x, dir.z);
    expect(len).toBeGreaterThan(0.99);
    expect(len).toBeLessThan(1.01);
  });

  it("planTargetDir does not throw when called repeatedly", () => {
    const sim = new Simulation();
    sim.start();
    const bot = sim.characters[5];
    for (let i = 0; i < 100; i++) {
      bot.setPos(Math.random() * 20 - 10, Math.random() * 20 - 10);
      expect(() => BotAI.planTargetDir(bot, sim)).not.toThrow();
    }
  });
});
```

- [ ] **Step 3: Run test (expect fail — module not found)**

Run: `pnpm test`
Expected: FAIL — `BotAI` module not found.

- [ ] **Step 4: Create BotAI.js by porting from main.js**

Create `prototype/sim/BotAI.js`. Port the contents of the `_planBotLoop` method and any helpers it depends on. Public API:
```js
export class BotAI {
  /**
   * @param {Character} char
   * @param {Simulation} sim
   * @returns {{x:number,z:number}} unit vector
   */
  static planTargetDir(char, sim) {
    // Port of _planBotLoop logic.
    // - Read sim.grid, sim.characters, sim.factionManager
    // - Choose a waypoint goal (claim arc, defense, etc.)
    // - Steer char.targetDir toward next waypoint
    // - Return a unit vector { x, z }
    // ...
  }
}
```

The porting rules:
- Replace `this.grid` → `sim.grid`
- Replace `this.factionManager` → `sim.factionManager`
- Replace `this.characters` → `sim.characters`
- Replace any THREE.Vector3 with `{ x, z }` plain objects
- Function returns the new target dir; does not assign to `char.targetDir` directly

- [ ] **Step 5: Hook BotAI into Simulation tick**

In `prototype/sim/Simulation.js`, in the `_stepCharacters(dt)` method (or wherever per-character pre-step happens):
```js
import { BotAI } from "./BotAI.js";

// in _stepCharacters loop, before applying movement:
for (const char of this.characters) {
  if (!char.alive) continue;
  if (!char.isHuman) {
    const newDir = BotAI.planTargetDir(char, this);
    char.targetDir = newDir;
  }
  // ... existing movement code applies char.targetDir to char.dir / pos
}
```

- [ ] **Step 6: Remove bot logic from main.js**

Delete the original `_planBotLoop` method and the per-frame bot-steering loop from `prototype/main.js`. Game class no longer touches bot AI.

- [ ] **Step 7: Run tests + manual verification**

Run: `pnpm test`
Expected: All tests pass.

Run: `cd prototype && python3 -m http.server 8000`
Manual: bots move, claim territory, fight, die, respawn — same as before.

- [ ] **Step 8: Commit**

```bash
git add prototype/sim/BotAI.js prototype/sim/__tests__/BotAI.test.js prototype/sim/Simulation.js prototype/main.js
git commit -m "feat: extract bot AI into sim/BotAI.js"
```

---

## Phase 3: Server Skeleton

After this phase: Colyseus server runs, ticks the Simulation, no clients connect yet.

### Task 8: Set up sim copy script and verify server compiles

**Files:**
- Modify: `server/package.json`
- Modify: `server/tsconfig.json`
- Create: `server/scripts/copy-sim.mjs`

- [ ] **Step 1: Create the copy-sim script**

Create `server/scripts/copy-sim.mjs`:
```js
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../prototype/sim");
const dst = path.resolve(here, "../src/sim");

await rm(dst, { recursive: true, force: true });
await mkdir(dst, { recursive: true });
await cp(src, dst, { recursive: true, filter: p => !p.includes("__tests__") });
console.log(`Copied ${src} → ${dst}`);
```

- [ ] **Step 2: Add prebuild and predev hooks to server/package.json**

Edit `server/package.json` `scripts`:
```json
"prebuild": "node scripts/copy-sim.mjs",
"predev": "node scripts/copy-sim.mjs",
"dev": "tsx watch src/index.ts",
"build": "tsc",
"start": "node dist/index.js",
"typecheck": "node scripts/copy-sim.mjs && tsc --noEmit"
```

- [ ] **Step 3: Update tsconfig.json to allow JS imports**

In `server/tsconfig.json` `compilerOptions`, ensure:
```json
"allowJs": true,
"checkJs": false,
"resolveJsonModule": true,
"moduleResolution": "Bundler"
```

(Add any of these that are missing. Do not remove existing options.)

- [ ] **Step 4: Run the copy script**

Run: `cd server && node scripts/copy-sim.mjs`
Expected: prints `Copied .../prototype/sim → .../server/src/sim`. Verify with `ls server/src/sim/` — should see `Simulation.js`, `Character.js`, `BotAI.js`, `faction.js`, `match.js`, `scoring.js`, `constants.js`. No `__tests__/` folder.

- [ ] **Step 5: Verify server typechecks**

Run: `pnpm --filter template-server typecheck`
Expected: 0 errors. (If the existing GameRoom.ts stub references missing imports, comment those out for now — they'll be replaced in Task 10.)

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/tsconfig.json server/scripts/copy-sim.mjs
git commit -m "build: copy prototype/sim into server/src/sim before compile"
```

### Task 9: Define Colyseus schema for game state

**Files:**
- Replace: `server/src/schema/GameState.ts`

- [ ] **Step 1: Replace schema file**

Replace contents of `server/src/schema/GameState.ts` with:
```ts
import { Schema, ArraySchema, type } from "@colyseus/schema";

export class FactionSchema extends Schema {
  @type("uint8") id: number = 0;
  @type("number") territoryPct: number = 0;
  @type("boolean") alive: boolean = true;
  @type("boolean") endangered: boolean = false;
}

export class CharacterSchema extends Schema {
  @type("uint8") id: number = 0;
  @type("uint8") factionId: number = 0;
  @type("string") name: string = "";
  @type("boolean") isHuman: boolean = false;
  @type("number") posX: number = 0;
  @type("number") posZ: number = 0;
  @type("number") dirX: number = 0;
  @type("number") dirZ: number = 1;
  @type("boolean") alive: boolean = true;
  @type("number") invulnTimer: number = 0;
  @type("uint16") killCount: number = 0;
  @type("number") score: number = 0;
}

export class GameStateSchema extends Schema {
  @type("string") phase: string = "playing"; // "playing" | "intermission" | "ended"
  @type("number") timeRemaining: number = 0;
  @type("number") intermissionRemaining: number = 0;
  @type([FactionSchema]) factions = new ArraySchema<FactionSchema>();
  @type([CharacterSchema]) characters = new ArraySchema<CharacterSchema>();
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter template-server typecheck`
Expected: 0 errors related to schema.

- [ ] **Step 3: Commit**

```bash
git add server/src/schema/GameState.ts
git commit -m "feat: define Colyseus schema for multiplayer game state"
```

### Task 10: Fill in GameRoom with Simulation tick loop

**Files:**
- Replace: `server/src/rooms/GameRoom.ts`
- Create: `server/src/__tests__/GameRoom.test.ts`

- [ ] **Step 1: Write a smoke test for GameRoom**

Create `server/src/__tests__/GameRoom.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { boot } from "@colyseus/testing";
import { Server } from "@colyseus/core";
import { GameRoom } from "../rooms/GameRoom.js";

describe("GameRoom", () => {
  it("creates a room with 30 characters and 5 factions", async () => {
    const colyseus = await boot({
      initializeGameServer: (gameServer: Server) => {
        gameServer.define("game", GameRoom);
      },
    });
    const room = await colyseus.createRoom("game", {});
    // wait one tick for state to populate
    await new Promise(r => setTimeout(r, 100));
    expect(room.state.characters.length).toBe(30);
    expect(room.state.factions.length).toBe(5);
    expect(room.state.phase).toBe("playing");
    await colyseus.shutdown();
  });
});
```

Note: this test requires `@colyseus/testing`. Add it next.

- [ ] **Step 2: Add @colyseus/testing as devDep**

Run: `pnpm --filter template-server add -D @colyseus/testing`

- [ ] **Step 3: Run test (expect fail)**

Run: `pnpm test`
Expected: FAIL — current GameRoom is a stub.

- [ ] **Step 4: Implement GameRoom**

Replace contents of `server/src/rooms/GameRoom.ts` with:
```ts
import { Room, Client } from "@colyseus/core";
import { GameStateSchema, FactionSchema, CharacterSchema } from "../schema/GameState.js";
// JS imports — copied by prebuild script:
// @ts-ignore
import { Simulation } from "../sim/Simulation.js";

const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;

interface ClientMeta {
  charId: number | null;
  playerToken: string | null;
}

export class GameRoom extends Room<GameStateSchema> {
  private sim!: any;
  private clientMeta = new Map<string, ClientMeta>();
  private prevPhase: string = "playing";
  private intermissionRemaining: number = 0;
  private static INTERMISSION_SECONDS = 30;

  onCreate() {
    this.setState(new GameStateSchema());
    this.sim = new Simulation();
    this.sim.start();

    // Hook sim events to broadcast to clients
    this.sim.onClaim = (charId: number, trailPoints: number[], factionId: number) => {
      this.broadcast("claim", { charId, trailPoints, factionId });
    };
    this.sim.onHeal = (changedCells: any[]) => {
      this.broadcast("heal", { changedCells });
    };
    this.sim.onTrailVertex = (charId: number, x: number, z: number) => {
      this.broadcast("trailVertex", { charId, x, z });
    };
    this.sim.onKill = (killerId: number, victimId: number) => {
      this.broadcast("kill", { killerId, victimId });
    };

    // Initialize schema with simulation entities
    for (let f = 1; f <= 5; f++) {
      const fs = new FactionSchema();
      fs.id = f;
      this.state.factions.push(fs);
    }
    for (const c of this.sim.characters) {
      const cs = new CharacterSchema();
      cs.id = c.id;
      cs.factionId = c.factionId;
      cs.name = c.name;
      this.state.characters.push(cs);
    }

    // Start tick loop
    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), TICK_MS);
  }

  private tick(dt: number) {
    if (this.state.phase === "intermission") {
      this.intermissionRemaining = Math.max(0, this.intermissionRemaining - dt);
      this.state.intermissionRemaining = this.intermissionRemaining;
      if (this.intermissionRemaining <= 0) {
        this.sim.restart();
        this.prevPhase = "playing";
        this.state.phase = "playing";
      }
      // Don't tick simulation during intermission
      return;
    }

    this.sim.tick(dt);

    // Detect end-of-round transition
    if (this.prevPhase === "playing" && this.sim.matchManager.phase === "ended") {
      this.intermissionRemaining = GameRoom.INTERMISSION_SECONDS;
      this.state.phase = "intermission";
      this.state.intermissionRemaining = this.intermissionRemaining;
      this.prevPhase = "intermission";
      return;
    }
    this.prevPhase = this.sim.matchManager.phase;

    // Sync sim → schema (per-tick fields only)
    this.state.phase = this.sim.matchManager.phase;
    this.state.timeRemaining = this.sim.matchManager.timeRemaining;
    this.state.intermissionRemaining = 0;

    const factions = this.sim.factionManager.getAllFactions();
    for (let i = 0; i < factions.length; i++) {
      const fs = this.state.factions[i];
      const f = factions[i];
      fs.territoryPct = f.territoryPct;
      fs.alive = f.alive;
      fs.endangered = f.endangered;
    }

    for (let i = 0; i < this.sim.characters.length; i++) {
      const c = this.sim.characters[i];
      const cs = this.state.characters[i];
      cs.factionId = c.factionId;
      cs.isHuman = c.isHuman;
      cs.posX = c.pos.x;
      cs.posZ = c.pos.z;
      cs.dirX = c.dir.x;
      cs.dirZ = c.dir.z;
      cs.alive = c.alive;
      cs.invulnTimer = c.invulnTimer;
      cs.killCount = c.killCount;
    }
  }

  onJoin(client: Client) {
    this.clientMeta.set(client.sessionId, { charId: null, playerToken: null });
    console.log(`[GameRoom] join: ${client.sessionId}`);
  }

  onLeave(client: Client) {
    const meta = this.clientMeta.get(client.sessionId);
    if (meta?.charId !== null && meta?.charId !== undefined) {
      this.sim.setHumanControl(meta.charId, false);
    }
    this.clientMeta.delete(client.sessionId);
    console.log(`[GameRoom] leave: ${client.sessionId}`);
  }
}
```

- [ ] **Step 5: Run prebuild + test**

Run: `pnpm --filter template-server predev && pnpm test`
Expected: GameRoom test passes.

- [ ] **Step 6: Manual verify server boots**

Run: `pnpm dev:server`
Expected: log `[GameServer] listening on ws://localhost:2567` (or similar). No errors. Tick log if you added one.

Stop with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add server/src/rooms/GameRoom.ts server/src/__tests__/GameRoom.test.ts server/package.json
git commit -m "feat: GameRoom wraps Simulation with 20Hz tick + state sync"
```

### Task 11: Faction auto-assign helper

**Files:**
- Modify: `server/src/rooms/GameRoom.ts`
- Create: `server/src/__tests__/factionAssign.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/factionAssign.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { pickWeakestFaction } from "../rooms/GameRoom.js";

describe("pickWeakestFaction", () => {
  it("picks faction with fewest humans", () => {
    const factions = [
      { id: 1, territoryPct: 30, alive: true },
      { id: 2, territoryPct: 25, alive: true },
      { id: 3, territoryPct: 20, alive: true },
    ];
    const humanCounts = new Map([[1, 3], [2, 1], [3, 2]]);
    expect(pickWeakestFaction(factions, humanCounts)).toBe(2);
  });

  it("breaks tie by lowest territoryPct", () => {
    const factions = [
      { id: 1, territoryPct: 30, alive: true },
      { id: 2, territoryPct: 20, alive: true },
      { id: 3, territoryPct: 25, alive: true },
    ];
    const humanCounts = new Map([[1, 0], [2, 0], [3, 0]]);
    expect(pickWeakestFaction(factions, humanCounts)).toBe(2);
  });

  it("ignores eliminated factions", () => {
    const factions = [
      { id: 1, territoryPct: 0, alive: false },
      { id: 2, territoryPct: 50, alive: true },
    ];
    const humanCounts = new Map([[1, 0], [2, 5]]);
    expect(pickWeakestFaction(factions, humanCounts)).toBe(2);
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

Run: `pnpm test`
Expected: FAIL — `pickWeakestFaction` not exported.

- [ ] **Step 3: Add pickWeakestFaction to GameRoom.ts**

Add at top of `server/src/rooms/GameRoom.ts` (above the class):
```ts
export function pickWeakestFaction(
  factions: Array<{ id: number; territoryPct: number; alive: boolean }>,
  humanCounts: Map<number, number>,
): number | null {
  const alive = factions.filter(f => f.alive);
  if (alive.length === 0) return null;
  let best = alive[0];
  let bestHumans = humanCounts.get(best.id) ?? 0;
  for (const f of alive) {
    const h = humanCounts.get(f.id) ?? 0;
    if (h < bestHumans || (h === bestHumans && f.territoryPct < best.territoryPct)) {
      best = f;
      bestHumans = h;
    }
  }
  return best.id;
}
```

- [ ] **Step 4: Run tests (expect pass)**

Run: `pnpm test`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/GameRoom.ts server/src/__tests__/factionAssign.test.ts
git commit -m "feat: add pickWeakestFaction faction auto-assignment helper"
```

---

## Phase 4: Static Asset Serving

### Task 12: Express static middleware in server

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/package.json`

- [ ] **Step 1: Add express to server deps**

Run: `pnpm --filter template-server add express`
Run: `pnpm --filter template-server add -D @types/express`

- [ ] **Step 2: Modify server/src/index.ts**

Read the current `server/src/index.ts` to see its structure. Modify it to use Express:
```ts
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom.js";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOTYPE_DIR = path.resolve(__dirname, "../../prototype");

const app = express();
app.use(express.static(PROTOTYPE_DIR));
app.get("/health", (_req, res) => { res.send("ok"); });

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("game", GameRoom);

const PORT = Number(process.env.PORT ?? 2567);
httpServer.listen(PORT, () => {
  console.log(`[Server] listening on http://localhost:${PORT}`);
  console.log(`[Server] static: ${PROTOTYPE_DIR}`);
});
```

- [ ] **Step 3: Run dev server**

Run: `pnpm dev:server`
Expected: log `[Server] listening on http://localhost:2567`.

- [ ] **Step 4: Manual verify static serving works**

Open browser to `http://localhost:2567/`.
Expected: title screen of the game loads. Click Play (or current button) → single-player still works.

(Single-player runs entirely client-side, so it works the moment static serving is wired up.)

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/package.json pnpm-lock.yaml
git commit -m "feat: serve prototype/ static files from Colyseus server"
```

---

## Phase 5: Multiplayer Client

### Task 13: Mode picker UI

**Files:**
- Modify: `prototype/index.html`
- Modify: `prototype/main.js`

- [ ] **Step 1: Edit name-entry screen in index.html**

In `prototype/index.html`, replace the existing single Play button inside `#name-entry` with a Solo + Online pair:

```html
<div id="name-entry">
  <div style="text-align:center;">
    <h1 style="font-size:48px; margin-bottom:8px; color:#333;">Territory War</h1>
    <p style="color:#666; margin-bottom:24px;">Claim territory. Fight for your faction. Dominate.</p>
    <input id="name-input" type="text" placeholder="Enter your name" maxlength="16"
      style="font-size:20px; padding:12px 24px; border:2px solid #ccc; border-radius:8px; outline:none; text-align:center; width:280px;" />
    <br/>
    <div style="margin-top:16px; display:flex; gap:12px; justify-content:center;">
      <button id="solo-btn"
        style="font-size:18px; padding:12px 32px; background:#4CAF50; color:white; border:none; border-radius:8px; cursor:pointer;">
        Solo
      </button>
      <button id="online-btn"
        style="font-size:18px; padding:12px 32px; background:#2196F3; color:white; border:none; border-radius:8px; cursor:pointer;">
        Online
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Wire buttons in main.js**

In `prototype/main.js`, find the existing `play-btn` click handler and replace its setup with:
```js
document.getElementById("solo-btn").addEventListener("click", () => {
  const name = document.getElementById("name-input").value.trim() || "Player";
  document.getElementById("name-entry").classList.add("hidden");
  game.startSolo(name);
});

document.getElementById("online-btn").addEventListener("click", () => {
  const name = document.getElementById("name-input").value.trim() || "Player";
  document.getElementById("name-entry").classList.add("hidden");
  game.startOnline(name);
});
```

In the `Game` class, add:
```js
startSolo(name) {
  this.mode = "solo";
  this.player.name = name;
  this.start();  // existing logic — local Simulation
}

startOnline(name) {
  this.mode = "online";
  this.playerName = name;
  // Stub — Task 14 will implement
  console.log("[online] connecting...");
}
```

- [ ] **Step 3: Manual verify**

Open `http://localhost:2567/`.
Expected: Solo + Online buttons. Click Solo → game runs locally as before. Click Online → console logs "[online] connecting..." and the screen is blank (expected — Task 14+ wires it up).

- [ ] **Step 4: Commit**

```bash
git add prototype/index.html prototype/main.js
git commit -m "feat: add Solo/Online mode picker to title screen"
```

### Task 14: Colyseus client connection

**Files:**
- Create: `prototype/multiplayer.js`
- Modify: `prototype/index.html` (importmap)
- Modify: `prototype/main.js`

- [ ] **Step 1: Add colyseus.js to importmap**

In `prototype/index.html`, modify the existing importmap script:
```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "colyseus.js": "https://cdn.jsdelivr.net/npm/colyseus.js@0.16.7/+esm"
  }
}
</script>
```

- [ ] **Step 2: Create multiplayer.js**

Create `prototype/multiplayer.js`:
```js
import * as Colyseus from "colyseus.js";

export class MultiplayerClient {
  constructor() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}`;
    this.client = new Colyseus.Client(url);
    this.room = null;

    // Event hooks (set by host renderer)
    this.onState = null;       // (state) => void
    this.onClaim = null;       // (charId, trailPoints, factionId) => void
    this.onHeal = null;        // (changedCells) => void
    this.onTrailVertex = null; // (charId, x, z) => void
    this.onKill = null;        // (killerId, victimId) => void
    this.onYourCharId = null;  // (charId) => void
  }

  async connect(playerName, playerToken) {
    this.room = await this.client.joinOrCreate("game", { name: playerName, playerToken });
    this.room.onStateChange((state) => { if (this.onState) this.onState(state); });
    this.room.onMessage("claim", ({ charId, trailPoints, factionId }) => {
      if (this.onClaim) this.onClaim(charId, trailPoints, factionId);
    });
    this.room.onMessage("heal", ({ changedCells }) => {
      if (this.onHeal) this.onHeal(changedCells);
    });
    this.room.onMessage("trailVertex", ({ charId, x, z }) => {
      if (this.onTrailVertex) this.onTrailVertex(charId, x, z);
    });
    this.room.onMessage("kill", ({ killerId, victimId }) => {
      if (this.onKill) this.onKill(killerId, victimId);
    });
    this.room.onMessage("yourCharId", ({ charId }) => {
      if (this.onYourCharId) this.onYourCharId(charId);
    });
    return this.room;
  }

  sendInput(dirX, dirZ) {
    if (!this.room) return;
    this.room.send("input", { dirX, dirZ });
  }

  disconnect() {
    if (this.room) this.room.leave();
  }
}
```

- [ ] **Step 3: Wire startOnline to MultiplayerClient**

In `prototype/main.js`:
```js
import { MultiplayerClient } from "./multiplayer.js";

// In Game class:
async startOnline(name) {
  this.mode = "online";
  this.playerName = name;
  this.mp = new MultiplayerClient();
  await this.mp.connect(name, null);
  console.log("[online] connected, sessionId =", this.mp.room.sessionId);
  // Task 15 implements rendering from server state.
}
```

- [ ] **Step 4: Manual verify connection**

Run: `pnpm dev:server`
Open `http://localhost:2567/`. Click Online.
Expected: console shows `[online] connected, sessionId = <id>`. Server log shows `[GameRoom] join: <id>`.

- [ ] **Step 5: Commit**

```bash
git add prototype/index.html prototype/multiplayer.js prototype/main.js
git commit -m "feat: add Colyseus client connection for multiplayer mode"
```

### Task 15: Render from server state (positions only)

**Files:**
- Modify: `prototype/main.js`

- [ ] **Step 1: Branch the renderer to read from sim or server state**

In `prototype/main.js`, the existing `Game.tick(dt)` runs the local simulation and reads from `this.sim.characters`. For online mode, we want to read from `this.mp.room.state.characters` instead.

Add a helper:
```js
_currentCharacters() {
  if (this.mode === "online" && this.mp?.room) {
    // Map schema characters to a per-frame snapshot the renderer can consume
    return this.mp.room.state.characters.map(c => ({
      id: c.id,
      factionId: c.factionId,
      name: c.name,
      isHuman: c.isHuman,
      pos: { x: c.posX, z: c.posZ },
      dir: { x: c.dirX, z: c.dirZ },
      alive: c.alive,
      invulnTimer: c.invulnTimer,
      killCount: c.killCount,
    }));
  }
  return this.sim.characters;
}

_currentMatchState() {
  if (this.mode === "online" && this.mp?.room) {
    return {
      phase: this.mp.room.state.phase,
      timeRemaining: this.mp.room.state.timeRemaining,
      intermissionRemaining: this.mp.room.state.intermissionRemaining,
    };
  }
  return {
    phase: this.sim.matchManager.phase,
    timeRemaining: this.sim.matchManager.timeRemaining,
    intermissionRemaining: this.sim.matchManager.intermissionRemaining ?? 0,
  };
}
```

- [ ] **Step 2: Replace direct sim accesses in renderer**

In `Game.tick(dt)` and any rendering helper that previously read `this.sim.characters` or `this.matchManager`, route through the helpers above.

The character meshes (a Map<charId, mesh>) should be created/destroyed based on the entries returned by `_currentCharacters()`. Each frame, update each mesh's position from `char.pos` and rotation from `char.dir`.

- [ ] **Step 3: Skip local sim.tick when in online mode**

In `Game.tick(dt)`, conditionally:
```js
if (this.mode === "solo") {
  this.sim.setTargetDir(this.player.id, this.player.targetDir.x, this.player.targetDir.z);
  this.sim.tick(dt);
}
// Online: state arrives via Colyseus; we don't tick locally
```

- [ ] **Step 4: Manual verify online rendering**

Run: `pnpm dev:server`
Open `http://localhost:2567/`. Click Online.
Expected: Game loads. Bots are visible moving around. Territory is white (no claims rendered yet — Task 16 handles this).

- [ ] **Step 5: Commit**

```bash
git add prototype/main.js
git commit -m "feat: render character positions from Colyseus server state"
```

### Task 16: Territory grid sync (initial snapshot + claim events)

**Files:**
- Modify: `prototype/main.js`
- Modify: `prototype/multiplayer.js`
- Modify: `server/src/rooms/GameRoom.ts`

- [ ] **Step 1: Server sends initial grid snapshot on join**

In `server/src/rooms/GameRoom.ts`, modify `onJoin`:
```ts
import { gzipSync } from "zlib";
// ...
onJoin(client: Client) {
  this.clientMeta.set(client.sessionId, { charId: null, playerToken: null });
  // Send initial grid snapshot so client can populate its local grid
  const compressed = gzipSync(Buffer.from(this.sim.grid));
  client.send("gridSnapshot", { bytes: compressed.toString("base64") });
  console.log(`[GameRoom] join: ${client.sessionId}`);
}
```

- [ ] **Step 2: Client receives + applies snapshot**

In `prototype/multiplayer.js`, add to the `connect` method message handlers:
```js
this.room.onMessage("gridSnapshot", ({ bytes }) => {
  if (this.onGridSnapshot) this.onGridSnapshot(bytes);
});
```

And add `this.onGridSnapshot = null;` in the constructor.

- [ ] **Step 3: Client decodes snapshot into local grid**

In `prototype/main.js`, in `startOnline`:
```js
async startOnline(name) {
  this.mode = "online";
  this.playerName = name;
  // Online mode owns its own grid (separate from sim used in solo)
  this.onlineSim = new Simulation();
  this.onlineSim.start();   // creates grid + characters; we'll overwrite grid from snapshot
  this.grid = this.onlineSim.grid;

  this.mp = new MultiplayerClient();
  this.mp.onGridSnapshot = (b64) => {
    const compressed = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    // pako or DecompressionStream — use the latter (built-in)
    this._inflateGzip(compressed).then(raw => {
      this.onlineSim.grid.set(new Uint8Array(raw));
      this.territoryDirty = true;
    });
  };
  this.mp.onClaim = (charId, trailPoints, factionId) => {
    // Reconstruct char.trailVerts from flat array, then run claim
    const char = this.onlineSim.characters[charId];
    if (!char) return;
    char.trailVerts = [];
    for (let i = 0; i < trailPoints.length; i += 2) {
      char.trailVerts.push({ x: trailPoints[i], z: trailPoints[i + 1] });
    }
    char.factionId = factionId;
    this.onlineSim.claim(char);
    this.territoryDirty = true;
  };
  this.mp.onHeal = ({ changedCells }) => {
    for (const { x, y, factionId } of changedCells) {
      this.onlineSim.grid[y * GRID_SIZE + x] = factionId;
    }
    this.territoryDirty = true;
  };

  await this.mp.connect(name, null);
}

async _inflateGzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Response(stream).arrayBuffer();
}
```

- [ ] **Step 4: Manual verify**

Run: `pnpm dev:server`. Two browser tabs open to `http://localhost:2567/`. Both click Online.
Expected: Both tabs show identical territory state. As bots claim territory, both update.

- [ ] **Step 5: Commit**

```bash
git add prototype/main.js prototype/multiplayer.js server/src/rooms/GameRoom.ts
git commit -m "feat: sync territory grid via snapshot + per-claim events"
```

---

## Phase 6: Human Takeover

### Task 17: Server handles ClientHello + faction assignment + bot→human flip

**Files:**
- Modify: `server/src/rooms/GameRoom.ts`

- [ ] **Step 1: Add `setHumanControl` to Simulation**

In `prototype/sim/Simulation.js`:
```js
setHumanControl(charId, isHuman) {
  const c = this.characters[charId];
  if (!c) return;
  c.isHuman = isHuman;
}
```

(If not already present from Task 5.)

- [ ] **Step 2: Handle "hello" message + assign faction**

In `server/src/rooms/GameRoom.ts`, add to `onCreate`:
```ts
this.onMessage("hello", (client, { name, playerToken }) => {
  this.handleHello(client, name, playerToken);
});
```

Add the method to the class:
```ts
private handleHello(client: Client, name: string, playerToken: string | null) {
  // Count humans per faction
  const humanCounts = new Map<number, number>();
  for (const c of this.sim.characters) {
    if (c.isHuman) humanCounts.set(c.factionId, (humanCounts.get(c.factionId) ?? 0) + 1);
  }
  const factionsForPick = this.sim.factionManager.getAllFactions().map((f: any) => ({
    id: f.id, territoryPct: f.territoryPct, alive: f.alive,
  }));
  const factionId = pickWeakestFaction(factionsForPick, humanCounts);
  if (factionId === null) return;

  // Find a bot character in that faction to take over
  const target = this.sim.characters.find((c: any) =>
    c.factionId === factionId && !c.isHuman && c.alive,
  ) ?? this.sim.characters.find((c: any) => c.factionId === factionId && !c.isHuman);
  if (!target) return;

  target.isHuman = true;
  if (name) target.name = name;

  const meta = this.clientMeta.get(client.sessionId)!;
  meta.charId = target.id;
  meta.playerToken = playerToken;

  client.send("yourCharId", { charId: target.id });
  console.log(`[GameRoom] ${client.sessionId} took over char ${target.id} (faction ${factionId})`);
}
```

- [ ] **Step 3: Modify onLeave to flip back to bot**

Already done in Task 10 — verify the `onLeave` method calls `this.sim.setHumanControl(meta.charId, false)`.

- [ ] **Step 4: Client sends Hello after connect**

In `prototype/multiplayer.js`, modify `connect`:
```js
async connect(playerName, playerToken) {
  this.room = await this.client.joinOrCreate("game", {});
  // ... handlers ...
  this.room.send("hello", { name: playerName, playerToken });
  return this.room;
}
```

- [ ] **Step 5: Manual verify**

Run: `pnpm dev:server`. Open `http://localhost:2567/` → Online → enter name "Alice".
Expected: server log shows `Alice took over char N (faction F)`. The client receives `yourCharId`, can be logged.

- [ ] **Step 6: Commit**

```bash
git add server/src/rooms/GameRoom.ts prototype/sim/Simulation.js prototype/multiplayer.js
git commit -m "feat: human joiner takes over a bot in weakest faction"
```

### Task 18: Input handler — client sends, server applies

**Files:**
- Modify: `server/src/rooms/GameRoom.ts`
- Modify: `prototype/main.js`

- [ ] **Step 1: Server stores input per character**

In `server/src/rooms/GameRoom.ts`, add to `onCreate`:
```ts
this.onMessage("input", (client, { dirX, dirZ }) => {
  const meta = this.clientMeta.get(client.sessionId);
  if (!meta || meta.charId === null) return;
  this.sim.setTargetDir(meta.charId, dirX, dirZ);
});
```

Make sure `setTargetDir` exists on Simulation:
```js
setTargetDir(charId, dirX, dirZ) {
  const c = this.characters[charId];
  if (!c) return;
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-6) return;
  c.targetDir = { x: dirX / len, z: dirZ / len };
}
```

- [ ] **Step 2: Client sends input each frame in online mode**

In `prototype/main.js`, in the input-handling section of `tick(dt)`:
```js
if (this.mode === "online" && this.mp) {
  // player.targetDir is set by keyboard/mouse handlers (existing)
  this.mp.sendInput(this.player.targetDir.x, this.player.targetDir.z);
}
```

(Throttle to 20 Hz: only send every other render frame, or use a small accumulator.)

- [ ] **Step 3: Bind player to your-char-id**

In `prototype/main.js`, in `startOnline`:
```js
this.mp.onYourCharId = (charId) => {
  this.myCharId = charId;
  this.player = this._currentCharacters().find(c => c.id === charId);
  // Camera now follows this character's position via _currentCharacters()
};
```

- [ ] **Step 4: Manual verify**

Run: `pnpm dev:server`. Two tabs to `http://localhost:2567/`, both Online with different names.
Expected: each tab can move its character with WASD. Both tabs see both characters move. Server log shows input messages.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/GameRoom.ts prototype/sim/Simulation.js prototype/main.js
git commit -m "feat: client sends targetDir input to server at 20Hz"
```

---

## Phase 7: Reconnection + Persistence

### Task 19: playerToken cookie + cumulative score

**Files:**
- Modify: `prototype/multiplayer.js`
- Modify: `server/src/rooms/GameRoom.ts`

- [ ] **Step 1: Client generates and stores playerToken**

In `prototype/multiplayer.js`, modify `connect`:
```js
async connect(playerName, playerToken) {
  let token = playerToken;
  if (!token) {
    token = localStorage.getItem("playerToken");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("playerToken", token);
    }
  }
  this.room = await this.client.joinOrCreate("game", {});
  // ... handlers ...
  this.room.send("hello", { name: playerName, playerToken: token });
  return this.room;
}
```

- [ ] **Step 2: Server keeps cumulative score map**

In `server/src/rooms/GameRoom.ts`, add a class property:
```ts
private playerScores = new Map<string, { cumulativeScore: number; lastSeenAt: number }>();
```

Modify `handleHello`:
```ts
// After binding meta.charId:
if (playerToken) {
  const prior = this.playerScores.get(playerToken) ?? { cumulativeScore: 0, lastSeenAt: 0 };
  prior.lastSeenAt = Date.now();
  this.playerScores.set(playerToken, prior);
  client.send("cumulativeScore", { score: prior.cumulativeScore });
}
```

When a round ends (in `tick` when `phase` transitions to `intermission`):
```ts
private accumulateScores() {
  for (const [sessionId, meta] of this.clientMeta) {
    if (!meta.charId === null || !meta.playerToken) continue;
    const c = this.sim.characters[meta.charId!];
    if (!c) continue;
    const roundScore = this.sim.scoreTracker.getScore?.(c)?.total ?? 0;
    const prior = this.playerScores.get(meta.playerToken!) ?? { cumulativeScore: 0, lastSeenAt: Date.now() };
    prior.cumulativeScore += roundScore;
    this.playerScores.set(meta.playerToken!, prior);
  }
}
```

Call `accumulateScores()` from inside `tick()`, in the same branch that detects `prevPhase === "playing" && sim.matchManager.phase === "ended"` (just before setting `intermissionRemaining`).

- [ ] **Step 3: Client displays cumulative score**

In `prototype/multiplayer.js`, add handler:
```js
this.room.onMessage("cumulativeScore", ({ score }) => {
  if (this.onCumulativeScore) this.onCumulativeScore(score);
});
```

In `prototype/main.js`, plumb to `UIManager` (display next to round score).

- [ ] **Step 4: Manual verify**

Run: `pnpm dev:server`. Open Online, play a bit. Refresh page. Click Online again with same name.
Expected: server log shows the same playerToken arrived; client receives `cumulativeScore` with prior round's accumulated score.

- [ ] **Step 5: Commit**

```bash
git add prototype/multiplayer.js prototype/main.js server/src/rooms/GameRoom.ts
git commit -m "feat: persist cumulative score per playerToken across rounds"
```

### Task 20: Reconnection grace period

**Files:**
- Modify: `server/src/rooms/GameRoom.ts`

- [ ] **Step 1: Use Colyseus allowReconnection in onLeave**

In `server/src/rooms/GameRoom.ts`, modify `onLeave`:
```ts
async onLeave(client: Client, consented: boolean) {
  const meta = this.clientMeta.get(client.sessionId);
  if (!meta || meta.charId === null || consented) {
    if (meta?.charId !== null && meta?.charId !== undefined) {
      this.sim.setHumanControl(meta.charId, false);
    }
    this.clientMeta.delete(client.sessionId);
    return;
  }

  console.log(`[GameRoom] ${client.sessionId} disconnected, allowing 10s reconnect`);
  try {
    await this.allowReconnection(client, 10);
    console.log(`[GameRoom] ${client.sessionId} reconnected`);
    // Keep their charId binding; clientMeta still has it
  } catch {
    console.log(`[GameRoom] ${client.sessionId} timed out — bot resumes`);
    if (meta.charId !== null) this.sim.setHumanControl(meta.charId, false);
    this.clientMeta.delete(client.sessionId);
  }
}
```

- [ ] **Step 2: Client retains sessionId across reload using rejoin**

For now, on page reload the Colyseus session is gone (browsers don't persist the websocket sessionId). Real reconnect is for transient network blips, not browser refresh — for refresh, the playerToken (Task 19) restores the cumulative score; the character is re-acquired via Hello.

This is a v1-acceptable design. Document this:

Add a comment in `prototype/multiplayer.js`:
```js
// Browser refresh = new sessionId. Reconnection grace covers transient
// network blips only. Score persistence across refresh is via playerToken.
```

- [ ] **Step 3: Manual verify**

Run: `pnpm dev:server`. Open Online tab. Disconnect wifi for 5 seconds, reconnect.
Expected: server log shows `disconnected, allowing 10s reconnect`, then `reconnected`. Character keeps moving as a bot during the gap, then resumes.

(Test this by opening DevTools → Network → set throttling to "Offline" briefly.)

- [ ] **Step 4: Commit**

```bash
git add server/src/rooms/GameRoom.ts prototype/multiplayer.js
git commit -m "feat: 10s reconnect grace period for transient disconnects"
```

---

## Phase 8: Railway Deploy

### Task 21: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

Create `.dockerignore`:
```
node_modules
**/node_modules
**/dist
.git
.gitignore
prototype/*.png
prototype/debug_*.json
prototype/test_*.js
prototype/test_*.png
prototype/game_*.png
prototype/screenshot_*.png
**/__tests__
**/*.test.js
**/*.test.ts
docs/
jen/
tools/
*.md
```

- [ ] **Step 2: Create Dockerfile**

Create `Dockerfile`:
```dockerfile
# Stage 1: build
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json ./server/
COPY prototype/package.json ./prototype/
COPY packages/shared/package.json ./packages/shared/
COPY packages/simulation/package.json ./packages/simulation/

RUN pnpm install --frozen-lockfile --filter "template-server..."

COPY prototype ./prototype
COPY server ./server
COPY packages ./packages

RUN pnpm --filter template-server build

# Stage 2: runtime
FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/prototype/package.json ./prototype/
COPY --from=build /app/packages ./packages

RUN pnpm install --frozen-lockfile --prod --filter "template-server..."

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/prototype ./prototype

ENV NODE_ENV=production
EXPOSE 2567
WORKDIR /app/server
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: Build locally to verify**

Run: `docker build -t capturearena .`
Expected: build completes without errors.

Run: `docker run --rm -p 2567:2567 capturearena`
Expected: server starts. Visit `http://localhost:2567/` → game loads.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile + .dockerignore for Railway deploy"
```

### Task 22: Railway configuration

**Files:**
- Create: `railway.toml`

- [ ] **Step 1: Create railway.toml**

Create `railway.toml`:
```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node dist/index.js"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 5
```

- [ ] **Step 2: Add health endpoint (already done in Task 12)**

Verify `server/src/index.ts` has:
```ts
app.get("/health", (_req, res) => { res.send("ok"); });
```

- [ ] **Step 3: Commit**

```bash
git add railway.toml
git commit -m "feat: add Railway deployment config"
```

### Task 23: Production smoke test

**Files:** none (deployment + verification)

- [ ] **Step 1: Push branch to GitHub**

```bash
git push -u origin territory-war
```

- [ ] **Step 2: Connect Railway to GitHub repo**

In Railway dashboard:
1. New Project → Deploy from GitHub repo
2. Select the captureArena repository, `territory-war` branch
3. Railway auto-detects Dockerfile + railway.toml
4. Set environment: `PORT=2567` (Railway also sets `PORT` automatically — code reads `process.env.PORT ?? 2567`)
5. Deploy

- [ ] **Step 3: Smoke test the deployed URL**

Once deploy succeeds:
1. Open Railway-generated URL in browser
2. Click Online → enter name → game should load with 30 entities
3. Open same URL in second browser (or different network) → second player joins
4. Verify: both players see each other; both can move; territory claims sync

- [ ] **Step 4: Document the URL**

Append the deployed URL to the bottom of this plan file (`docs/superpowers/plans/2026-04-30-multiplayer-mode.md`):
```
## Deployed URL
https://<railway-generated-url>.railway.app
```

- [ ] **Step 5: Commit the URL note**

```bash
git add docs/superpowers/plans/2026-04-30-multiplayer-mode.md
git commit -m "docs: record Railway production URL"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✓ Single shared room — Task 10 (one GameRoom defined)
- ✓ Drop-in/drop-out — Tasks 17, 20
- ✓ 15-min rounds, 30s intermission — relies on existing MatchManager (already built)
- ✓ Single-player preserved — Task 13 (mode picker), Task 6 (Game uses Simulation in solo)
- ✓ Bots = humans flag flip — Task 17
- ✓ Auto-assign weakest — Task 11 + Task 17
- ✓ 10s reconnect grace — Task 20
- ✓ playerToken score persistence — Task 19
- ✓ 20Hz tick, 60Hz render — Task 10 (TICK_HZ = 20)
- ✓ Per-tick state via Schema — Task 9 + Task 10
- ✓ Territory via claim events + snapshot — Task 16
- ✓ Server-authoritative input — Task 18
- ✓ Express static serving — Task 12
- ✓ Dockerfile + railway.toml — Tasks 21, 22

**Future scope (deferred):**
- Trail vertex events fully wired client-side (Task 16 covers basics; deeper polish in renderer is incremental)
- Periodic grid hash resync — not needed unless drift observed in practice
- Client prediction for local player — Phase 9 in spec, deferred until measured latency proves it necessary

**Type consistency:** The `Character` data shape (`{ pos: {x,z}, dir: {x,z}, ... }`) is consistent across Simulation, schema mapping, and client renderer. The schema fields (`posX`, `posZ`, etc.) are flat and converted in `_currentCharacters()`.

**Manual verification checkpoints:**
- After Phase 1 (Task 6): single-player plays identically
- After Phase 2 (Task 7): bots play identically
- After Phase 3 (Task 11): server tests pass, server boots
- After Phase 4 (Task 12): visit `localhost:2567/` → single-player works
- After Phase 5 (Task 16): two browser tabs see same territory
- After Phase 6 (Task 18): two human players can play together
- After Phase 7 (Task 20): refresh during play resumes; brief offline reconnects
- After Phase 8 (Task 23): public Railway URL works for two players on different networks
