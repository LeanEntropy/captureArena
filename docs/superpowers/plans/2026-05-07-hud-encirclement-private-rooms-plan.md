# HUD, Encirclement, Private Rooms — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three features in one branch — (1) togglable FPS+ping HUD in multiplayer, (2) encirclement death by faction-territory connectivity, (3) Private Rooms with shareable codes, configurable factions/bots, and a waiting lobby with analytics.

**Architecture:** The repo is a pnpm monorepo with a static `prototype/` client and a `server/` Colyseus 0.16 process. The simulation lives in `prototype/sim/` and is mirror-copied into `server/src/sim/` at build/dev time via `server/scripts/copy-sim.mjs` (it auto-runs as `predev`/`prebuild`). Editing the source under `prototype/sim/` is canonical; the server copy is gitignored. Each phase below ships independently.

**Tech Stack:** Three.js (CDN importmap, no bundler) · Colyseus 0.16 (server + client) · TypeScript (server only) · ESM JS (client + sim) · Vitest · @colyseus/testing · better-sqlite3 (analytics) · pnpm workspaces.

**Spec:** [`docs/superpowers/specs/2026-05-07-hud-encirclement-private-rooms-design.md`](../specs/2026-05-07-hud-encirclement-private-rooms-design.md)

**Sequencing:** Phase 1 → Phase 2 → Phase 3 (small → medium → large; ping/pong from §1 is reused by §3 analytics).

---

## Phase 1 — Net-stats HUD (FPS + Ping)

### Task 1: Add server-side `pong` echo handler

**Files:**
- Modify: `server/src/rooms/GameRoom.ts:119-121` (just after the existing `onMessage("hello", …)` registration in `onCreate`)

- [ ] **Step 1: Add the pong handler**

In `server/src/rooms/GameRoom.ts`, inside `onCreate()`, after the existing `this.onMessage("input", …)` block (ends around line 132), add:

```ts
    // Client RTT measurement: echo back the client's send-time so the client
    // can compute round-trip latency. No schema change; payload is a number.
    this.onMessage("ping", (client, t: number) => {
      client.send("pong", t);
    });
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter template-server typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/rooms/GameRoom.ts
git commit -m "feat(server): add ping/pong echo handler for client RTT"
```

---

### Task 2: Add ping interval + `getRTT()` to multiplayer client

**Files:**
- Modify: `prototype/multiplayer.js`

- [ ] **Step 1: Add RTT state + ping interval to `MultiplayerClient`**

In `prototype/multiplayer.js`, replace the constructor (`prototype/multiplayer.js:41-67`) with this version (adds `_rttSamples`, `_pingInterval`):

```js
  constructor() {
    this.client = new Colyseus.Client(_resolveServerUrl());
    this.room = null;
    this.playerToken = null;

    // Input sequence tracking for server-confirmed reconciliation.
    this.inputSeq = 0;
    this.inputBuffer = []; // [{ seq, dirX, dirZ, t }]

    // RTT tracking — last 5 samples in ms, median reported by getRTT().
    this._rttSamples = [];
    this._pingInterval = null;

    // Event hooks (set by host renderer)
    this.onState = null;
    this.onClaim = null;
    this.onClaimResult = null;
    this.onHeal = null;
    this.onTrailVertex = null;
    this.onKill = null;
    this.onTeleport = null;
    this.onYourCharId = null;
    this.onGridSnapshot = null;
    this.onCumulativeScore = null;
    this.onNameRejected = null;
  }
```

- [ ] **Step 2: Wire `pong` handler + start ping loop in `connect()`**

In `prototype/multiplayer.js:80`, immediately after `this.room = await this.client.joinOrCreate("game", {});`, add:

```js
    this.room.onMessage("pong", (t) => {
      const rtt = performance.now() - t;
      this._rttSamples.push(rtt);
      while (this._rttSamples.length > 5) this._rttSamples.shift();
    });
    this._pingInterval = setInterval(() => {
      try { this.room?.send("ping", performance.now()); } catch {}
    }, 2000);
```

- [ ] **Step 3: Stop ping loop on disconnect**

Replace the existing `disconnect()` method at `prototype/multiplayer.js:132-134` with:

```js
  disconnect() {
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
    if (this.room) this.room.leave();
  }
```

- [ ] **Step 4: Add `getRTT()` method**

Right above `disconnect()`, add:

```js
  // Returns the median of the last 5 RTT samples in milliseconds, or null
  // if no pong has been received yet. Resistant to single-frame stalls.
  getRTT() {
    if (this._rttSamples.length === 0) return null;
    const sorted = [...this._rttSamples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
```

- [ ] **Step 5: Manual smoke**

Run: `pnpm dev:server` in one terminal, then open `http://localhost:2567/` in a browser, click ONLINE, enter a name. In DevTools console:

```js
window._game.mp.getRTT()
```

Expected: After ~2 seconds, returns a number (typically 1–20 on localhost). Returns `null` immediately on connect (before the first pong).

- [ ] **Step 6: Commit**

```bash
git add prototype/multiplayer.js
git commit -m "feat(client): ping/pong RTT measurement on multiplayer client"
```

---

### Task 3: Add `#net-stats` HUD element + CSS

**Files:**
- Modify: `prototype/index.html`

- [ ] **Step 1: Add CSS rule**

In `prototype/index.html`, find the existing `<style>` block (in `<head>`) and append the following rule near the other HUD element rules (search for `#return-to-menu` to find the section):

```css
#net-stats {
  position: fixed;
  bottom: 60px;
  right: 16px;
  z-index: 12;
  display: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: #cfd6e0;
  background: rgba(0, 0, 0, 0.55);
  padding: 4px 8px;
  border-radius: 4px;
  pointer-events: none;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
```

- [ ] **Step 2: Add the DOM element**

In `prototype/index.html`, find the `#ui` container's child list (the section that contains `#return-to-menu`, `#music-toggle-hud`, `#settings-toggle-hud`). Just BEFORE `<script src="telemetry.js" type="module"></script>` (line 624) add a new element:

```html
  <div id="net-stats">FPS — · — ms</div>
```

- [ ] **Step 3: Manual smoke**

Reload the browser at `http://localhost:2567/`. The element should NOT be visible (CSS sets `display: none`). In DevTools, run:

```js
document.getElementById("net-stats").style.display = "block"
```

Expected: A small dark badge appears in the bottom-right showing `FPS — · — ms`. It does NOT overlap the Vibe Jam widget (the 60px bottom offset clears the widget's ~50px height).

- [ ] **Step 4: Commit**

```bash
git add prototype/index.html
git commit -m "feat(hud): add #net-stats HUD element + CSS"
```

---

### Task 4: FPS measurement + DOM update timer

**Files:**
- Modify: `prototype/main.js`

- [ ] **Step 1: Add a 30-frame ring buffer at module scope**

In `prototype/main.js`, immediately above `function loop(now)` (currently at line 3276), add:

```js
// ===== Net-stats HUD (FPS + Ping) =====
// 30-frame ring buffer of dt values; FPS = 30 / sum(buffer).
const _netFpsBuf = new Float32Array(30);
let _netFpsIdx = 0;
let _netFpsCount = 0;
let _netHudLastUpdate = 0;
const _netHudEl = () => document.getElementById("net-stats");
let _netStatsVisible = (() => {
  try { return localStorage.getItem("netStatsVisible") === "1"; }
  catch { return false; }
})();

function _netStatsApplyVisibility() {
  const el = _netHudEl();
  if (!el) return;
  // Only ever VISIBLE in online mode; G has no effect in solo.
  const isOnline = window._game?.mode === "online";
  el.style.display = (isOnline && _netStatsVisible) ? "block" : "none";
}
```

- [ ] **Step 2: Hook FPS sampling + DOM update into the render loop**

Replace the existing `loop(now)` function at `prototype/main.js:3276-3285` with:

```js
function loop(now) {
  if (_stats) _stats.begin();
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  game.tick(dt);
  game.render();
  if (_stats) _stats.end();

  // Net-stats HUD: sample dt every frame; refresh DOM ~4x/sec.
  _netFpsBuf[_netFpsIdx] = dt;
  _netFpsIdx = (_netFpsIdx + 1) % _netFpsBuf.length;
  if (_netFpsCount < _netFpsBuf.length) _netFpsCount++;
  if (_netStatsVisible && now - _netHudLastUpdate > 250) {
    _netHudLastUpdate = now;
    const el = _netHudEl();
    if (el && window._game?.mode === "online") {
      let sum = 0;
      for (let i = 0; i < _netFpsCount; i++) sum += _netFpsBuf[i];
      const fps = sum > 0 ? Math.round(_netFpsCount / sum) : 0;
      const rtt = window._game?.mp?.getRTT?.();
      const rttStr = rtt == null ? "—" : Math.round(rtt) + "ms";
      el.textContent = `FPS ${fps} · ${rttStr}`;
    }
  }
}
```

- [ ] **Step 3: Manual smoke**

Reload `http://localhost:2567/`, click ONLINE, enter a name. In DevTools:

```js
localStorage.setItem("netStatsVisible", "1");
_netStatsVisible = true;
_netStatsApplyVisibility();
```

Expected: Bottom-right shows `FPS <NN> · <NN>ms` with values updating ~4x per second. FPS is typically 60 on a desktop. RTT updates every 2 seconds.

- [ ] **Step 4: Commit**

```bash
git add prototype/main.js
git commit -m "feat(hud): FPS+ping rolling sample + 4Hz DOM update"
```

---

### Task 5: G keybind + visibility toggle (with mode awareness)

**Files:**
- Modify: `prototype/main.js`

- [ ] **Step 1: Add `g` to the existing keydown listener**

In `prototype/main.js:1299-1307`, replace the existing `keydown` listener block:

```js
    window.addEventListener("keydown", e => {
      this.keysDown.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === "c") this._toggleGridOverlay();
      if (e.key.toLowerCase() === "v") this._toggleFactionMeshes();
      if (e.key.toLowerCase() === "f" && _stats) {
        // Toggle stats.js FPS/MS/MB overlay
        _stats.dom.style.display = _stats.dom.style.display === "none" ? "block" : "none";
      }
    });
```

with this version (adds the `g` case):

```js
    window.addEventListener("keydown", e => {
      this.keysDown.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === "c") this._toggleGridOverlay();
      if (e.key.toLowerCase() === "v") this._toggleFactionMeshes();
      if (e.key.toLowerCase() === "f" && _stats) {
        _stats.dom.style.display = _stats.dom.style.display === "none" ? "block" : "none";
      }
      if (e.key.toLowerCase() === "g") {
        // Toggle net-stats HUD (online only). Persist across sessions.
        if (window._game?.mode !== "online") return;
        _netStatsVisible = !_netStatsVisible;
        try { localStorage.setItem("netStatsVisible", _netStatsVisible ? "1" : "0"); } catch {}
        _netStatsApplyVisibility();
      }
    });
```

- [ ] **Step 2: Apply visibility when entering online mode**

The HUD element starts hidden by CSS. We need to apply the saved visibility once `mode` becomes `"online"`. Find `Game.startOnline` in `prototype/main.js` (search for `startOnline`) and at the end of that method (just before its closing `}`), add:

```js
    _netStatsApplyVisibility();
```

If you cannot find a single closing point (the method spans multiple statements), add the call as the last line inside `startOnline` before any `return`.

- [ ] **Step 3: Manual smoke (full flow)**

1. Refresh `http://localhost:2567/`. Click SOLO. Press G. Expected: nothing happens (solo mode ignores G).
2. Refresh again. Click ONLINE. Press G. Expected: bottom-right HUD appears showing `FPS NN · NNms`.
3. Press G again. Expected: HUD disappears.
4. Press G to turn it ON, then refresh the page and click ONLINE again. Expected: HUD is ON immediately on entering online mode (persistence works).
5. Press G to turn it OFF, refresh, click ONLINE. Expected: HUD is OFF (persistence works in both directions).

- [ ] **Step 4: Commit**

```bash
git add prototype/main.js
git commit -m "feat(hud): G key toggles net-stats; persisted in localStorage"
```

---

### Phase 1 Complete

The HUD is shippable on its own. Move to Phase 2.

---

## Phase 2 — Encirclement Death

### Task 6: Failing test #1 (split with residents in both halves survives)

**Files:**
- Create: `prototype/sim/__tests__/connectivity.test.js`

- [ ] **Step 1: Write the failing test file**

Create `prototype/sim/__tests__/connectivity.test.js` with the first test only:

```js
import { describe, it, expect } from "vitest";
import { enforceConnectivity } from "../connectivity.js";

// Tiny synthetic 8x8 grid for unit tests. Faction ids: 0=unclaimed, 1,2,3.
// We don't need sentinel/arena — connectivity helper treats any non-faction
// cell as a wall, so a rectangular bbox is fine here.
//
// `chars` mock provides only the fields the helper reads: factionId, alive,
// trailVerts.length, pos.x, pos.z (where pos maps to a grid cell index via a
// passed-in cellIndexOf function — we avoid pulling in the real worldToGrid).

function makeGrid(rows, gridSize = 8) {
  const g = new Uint8Array(gridSize * gridSize);
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      g[y * gridSize + x] = rows[y][x];
    }
  }
  return g;
}

function makeCellCounts(grid, numFactions) {
  const c = new Uint32Array(numFactions + 1);
  for (let i = 0; i < grid.length; i++) c[grid[i]]++;
  return c;
}

// Faction 1 has TWO disconnected blocks; resident in each. Both survive.
describe("enforceConnectivity", () => {
  it("split-with-resident-in-both-halves: both halves survive", () => {
    const grid = makeGrid([
      [1,1,0,0,0,0,1,1],
      [1,1,0,0,0,0,1,1],
      [1,1,0,0,0,0,1,1],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
    ]);
    const cellCounts = makeCellCounts(grid, 2);
    // residents: char A at (1,1) (left block), char B at (6,1) (right block)
    const chars = [
      { id: 0, factionId: 1, alive: true, trailVerts: [], cellIndex: 1 * 8 + 1 },
      { id: 1, factionId: 1, alive: true, trailVerts: [], cellIndex: 1 * 8 + 6 },
    ];
    const result = enforceConnectivity({
      grid, gridSize: 8, numFactions: 2,
      affectedFactions: new Set([1]),
      characters: chars, claimerFactionId: 2, cellCounts,
    });
    expect(result.capturedCells).toBe(0);
    expect(result.killedCharacters).toEqual([]);
    // Both blocks unchanged — count of faction 1 cells preserved.
    expect(cellCounts[1]).toBe(12);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm test prototype/sim/__tests__/connectivity.test.js`
Expected: FAIL with `Failed to load module ... ../connectivity.js` (the helper file doesn't exist yet).

- [ ] **Step 3: Commit (red)**

```bash
git add prototype/sim/__tests__/connectivity.test.js
git commit -m "test(sim): connectivity — first failing test (split survives)"
```

---

### Task 7: Implement minimal `enforceConnectivity` to pass test #1

**Files:**
- Create: `prototype/sim/connectivity.js`

- [ ] **Step 1: Write the helper**

Create `prototype/sim/connectivity.js`:

```js
// After-claim connectivity enforcement.
//
// Rule: a connected region of faction X's territory survives iff at least one
// living, non-trail player of faction X stands on a cell in it. Otherwise the
// region is "empty" and converts to the claimer's faction. After conversion,
// any trail-running player whose faction now has zero cells dies.
//
// Public API:
//   enforceConnectivity({
//     grid, gridSize, numFactions,
//     affectedFactions: Set<number>,
//     characters: Array<Character>,
//     claimerFactionId: number,
//     cellCounts: Uint32Array,
//   }) → { capturedCells: number, killedCharacters: Array<Character> }
//
// Each character must expose: factionId, alive (bool), trailVerts (array),
// and cellIndex (precomputed grid index of body position) OR pos.{x,z} +
// a cellIndexOf(x,z) function. The Simulation integration computes cellIndex
// inline before calling, so the helper takes it directly.

const NEIGHBORS = [1, -1, 0, 0]; // x deltas paired with the y deltas below
const NEIGHBORS_Y = [0, 0, 1, -1];

// Reused across calls to avoid per-claim allocation.
let _visited = null;
let _label = null;
let _queue = null;

function _ensureBuffers(size) {
  if (_visited && _visited.length === size) return;
  _visited = new Uint8Array(size);
  _label = new Int32Array(size);
  _queue = new Int32Array(size);
}

export function enforceConnectivity({
  grid, gridSize, numFactions,
  affectedFactions, characters, claimerFactionId, cellCounts,
}) {
  const size = gridSize * gridSize;
  _ensureBuffers(size);
  const visited = _visited;
  const label = _label;
  const queue = _queue;
  visited.fill(0);
  label.fill(-1);

  let capturedCells = 0;

  for (const F of affectedFactions) {
    if (F === claimerFactionId) continue; // claimer's own components are safe by definition
    if (cellCounts[F] === 0) continue;

    // 1. Component labeling — BFS over cells where grid[i] === F.
    let nextLabel = 0;
    const componentSize = []; // componentId → cell count
    for (let start = 0; start < size; start++) {
      if (grid[start] !== F || visited[start]) continue;
      // BFS this component.
      const cid = nextLabel++;
      let qHead = 0, qTail = 0;
      queue[qTail++] = start;
      visited[start] = 1;
      label[start] = cid;
      let count = 0;
      while (qHead < qTail) {
        const idx = queue[qHead++];
        count++;
        const cx = idx % gridSize;
        const cy = (idx - cx) / gridSize;
        for (let n = 0; n < 4; n++) {
          const ax = cx + NEIGHBORS[n];
          const ay = cy + NEIGHBORS_Y[n];
          if (ax < 0 || ax >= gridSize || ay < 0 || ay >= gridSize) continue;
          const aIdx = ay * gridSize + ax;
          if (visited[aIdx]) continue;
          if (grid[aIdx] !== F) continue;
          visited[aIdx] = 1;
          label[aIdx] = cid;
          queue[qTail++] = aIdx;
        }
      }
      componentSize.push(count);
    }

    if (nextLabel === 0) continue; // no cells of F in arena (can happen if F was wiped)

    // 2. Residency check — single pass over characters.
    const occupied = new Uint8Array(nextLabel);
    for (const c of characters) {
      if (!c.alive) continue;
      if (c.factionId !== F) continue;
      if (c.trailVerts && c.trailVerts.length > 0) continue; // trail-running ≠ resident
      const ci = c.cellIndex;
      if (ci == null || ci < 0 || ci >= size) continue;
      const cid = label[ci];
      if (cid >= 0) occupied[cid] = 1;
    }

    // 3. Convert unoccupied components to claimer.
    if (occupied.every?.((v) => v === 1) === true) continue;
    for (let i = 0; i < size; i++) {
      const cid = label[i];
      if (cid < 0) continue;
      if (occupied[cid]) continue;
      if (grid[i] !== F) continue; // safety
      grid[i] = claimerFactionId;
      cellCounts[F]--;
      cellCounts[claimerFactionId]++;
      capturedCells++;
    }
  }

  // 4. Trail-runner kill pass.
  const killedCharacters = [];
  for (const c of characters) {
    if (!c.alive) continue;
    if (!c.trailVerts || c.trailVerts.length === 0) continue;
    if (cellCounts[c.factionId] === 0) {
      killedCharacters.push(c);
    }
  }

  return { capturedCells, killedCharacters };
}
```

- [ ] **Step 2: Run test — expect pass**

Run: `pnpm test prototype/sim/__tests__/connectivity.test.js`
Expected: PASS for "split-with-resident-in-both-halves".

- [ ] **Step 3: Commit (green)**

```bash
git add prototype/sim/connectivity.js
git commit -m "feat(sim): enforceConnectivity helper — minimal impl (one test passes)"
```

---

### Task 8: Test #2 — split with resident in only one half

**Files:**
- Modify: `prototype/sim/__tests__/connectivity.test.js`

- [ ] **Step 1: Append the test**

Add this test inside the `describe("enforceConnectivity", …)` block:

```js
  it("split-with-resident-in-only-one-half: empty half captured by claimer", () => {
    const grid = makeGrid([
      [1,1,0,0,0,0,1,1],
      [1,1,0,0,0,0,1,1],
      [1,1,0,0,0,0,1,1],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
    ]);
    const cellCounts = makeCellCounts(grid, 2);
    const chars = [
      { id: 0, factionId: 1, alive: true, trailVerts: [], cellIndex: 1 * 8 + 1 }, // left block only
    ];
    const result = enforceConnectivity({
      grid, gridSize: 8, numFactions: 2,
      affectedFactions: new Set([1]),
      characters: chars, claimerFactionId: 2, cellCounts,
    });
    // Right block (6 cells) captured.
    expect(result.capturedCells).toBe(6);
    expect(result.killedCharacters).toEqual([]);
    expect(cellCounts[1]).toBe(6); // left block remains
    expect(cellCounts[2]).toBe(6); // claimer gained 6
    // Right block cells are now claimer's faction.
    expect(grid[0 * 8 + 6]).toBe(2);
    expect(grid[2 * 8 + 7]).toBe(2);
    // Left block unchanged.
    expect(grid[0 * 8 + 0]).toBe(1);
  });
```

- [ ] **Step 2: Run — expect pass**

Run: `pnpm test prototype/sim/__tests__/connectivity.test.js`
Expected: BOTH tests pass.

- [ ] **Step 3: Commit**

```bash
git add prototype/sim/__tests__/connectivity.test.js
git commit -m "test(sim): connectivity — empty half captured by claimer"
```

---

### Task 9: Test #3 — encircle a trail-runner; faction wiped, runner dies

**Files:**
- Modify: `prototype/sim/__tests__/connectivity.test.js`

- [ ] **Step 1: Append the test**

```js
  it("encircled trail-runner whose faction has only the captured region: dies", () => {
    // Faction 1 occupies a single block. The only living faction-1 char is
    // OUTSIDE that block (trail-running) — block has no resident.
    const grid = makeGrid([
      [1,1,1,0,0,0,0,0],
      [1,1,1,0,0,0,0,0],
      [1,1,1,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
    ]);
    const cellCounts = makeCellCounts(grid, 2);
    const trailRunner = {
      id: 7, factionId: 1, alive: true,
      trailVerts: [{ x: 0, z: 0 }], // non-empty = trailing
      cellIndex: 5 * 8 + 5, // outside the block
    };
    const result = enforceConnectivity({
      grid, gridSize: 8, numFactions: 2,
      affectedFactions: new Set([1]),
      characters: [trailRunner], claimerFactionId: 2, cellCounts,
    });
    // 9-cell block captured; 0 cells left for faction 1.
    expect(result.capturedCells).toBe(9);
    expect(cellCounts[1]).toBe(0);
    expect(cellCounts[2]).toBe(9);
    expect(result.killedCharacters).toHaveLength(1);
    expect(result.killedCharacters[0]).toBe(trailRunner);
  });
```

- [ ] **Step 2: Run — expect pass**

Run: `pnpm test prototype/sim/__tests__/connectivity.test.js`
Expected: ALL three tests pass.

- [ ] **Step 3: Commit**

```bash
git add prototype/sim/__tests__/connectivity.test.js
git commit -m "test(sim): connectivity — trail-runner dies on faction wipe"
```

---

### Task 10: Tests #4–#6 — multi-region coverage

**Files:**
- Modify: `prototype/sim/__tests__/connectivity.test.js`

- [ ] **Step 1: Append three more tests**

```js
  it("all residents trail-running: all components captured + all trail-runners die", () => {
    const grid = makeGrid([
      [1,1,0,0,0,0,1,1],
      [1,1,0,0,0,0,1,1],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
    ]);
    const cellCounts = makeCellCounts(grid, 2);
    const chars = [
      { id: 0, factionId: 1, alive: true, trailVerts: [{x:0,z:0}], cellIndex: 5 * 8 + 5 },
      { id: 1, factionId: 1, alive: true, trailVerts: [{x:0,z:0}], cellIndex: 6 * 8 + 5 },
    ];
    const result = enforceConnectivity({
      grid, gridSize: 8, numFactions: 2,
      affectedFactions: new Set([1]),
      characters: chars, claimerFactionId: 2, cellCounts,
    });
    expect(result.capturedCells).toBe(8); // both 4-cell blocks
    expect(cellCounts[1]).toBe(0);
    expect(result.killedCharacters).toHaveLength(2);
  });

  it("claimer's own faction has a fragment (with the claimer in it): unchanged", () => {
    // Faction 2 (the claimer) has two fragments. One has a resident (the claimer
    // body); the other doesn't. We pass affectedFactions={2} but the helper skips
    // claimer's faction entirely (own components are safe by definition).
    const grid = makeGrid([
      [2,2,0,0,0,0,2,2],
      [2,2,0,0,0,0,2,2],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
    ]);
    const cellCounts = makeCellCounts(grid, 2);
    const chars = [
      { id: 0, factionId: 2, alive: true, trailVerts: [], cellIndex: 0 * 8 + 0 },
    ];
    const before = cellCounts[2];
    const result = enforceConnectivity({
      grid, gridSize: 8, numFactions: 2,
      affectedFactions: new Set([2]),
      characters: chars, claimerFactionId: 2, cellCounts,
    });
    expect(result.capturedCells).toBe(0);
    expect(cellCounts[2]).toBe(before);
  });

  it("three regions, only one has a resident: the other two captured, no deaths", () => {
    const grid = makeGrid([
      [1,1,0,1,1,0,1,1],
      [1,1,0,1,1,0,1,1],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
    ]);
    const cellCounts = makeCellCounts(grid, 2);
    // Resident only in middle region.
    const chars = [
      { id: 0, factionId: 1, alive: true, trailVerts: [], cellIndex: 0 * 8 + 3 },
    ];
    const result = enforceConnectivity({
      grid, gridSize: 8, numFactions: 2,
      affectedFactions: new Set([1]),
      characters: chars, claimerFactionId: 2, cellCounts,
    });
    expect(result.capturedCells).toBe(8); // 4 + 4 (left + right)
    expect(cellCounts[1]).toBe(4); // middle survives
    expect(result.killedCharacters).toEqual([]); // faction still has cells; no deaths
  });
```

- [ ] **Step 2: Run — expect ALL six tests pass**

Run: `pnpm test prototype/sim/__tests__/connectivity.test.js`
Expected: 6 passes.

- [ ] **Step 3: Commit**

```bash
git add prototype/sim/__tests__/connectivity.test.js
git commit -m "test(sim): connectivity — multi-region + own-faction-fragment"
```

---

### Task 11: Integrate `enforceConnectivity` into `Simulation.claim`

**Files:**
- Modify: `prototype/sim/Simulation.js`

- [ ] **Step 1: Add import at top of file**

In `prototype/sim/Simulation.js:1-12`, add this import after the existing imports (after the `extractContours, countCells` line):

```js
import { enforceConnectivity } from "./connectivity.js";
```

- [ ] **Step 2: Track which factions had cells modified during the claim**

In the `claim(char)` method (`prototype/sim/Simulation.js:573`), the existing code already maintains a `losers` set of factions that lost cells (line 660). We extend this to include the claimer too. After the existing line 765 (`for (const loser of losers) this._contourCache.delete(loser);`), add:

```js
    // Build the set of factions whose cell counts changed during this claim.
    // The claimer always grew; every loser shrank. The connectivity sweep
    // then checks whether any of the losers' remaining territory is now
    // disconnected, capturing fragments without a resident player.
    const affectedFactions = new Set(losers);
    affectedFactions.add(factionId);
```

- [ ] **Step 3: Run the connectivity sweep just after the contour-cache invalidation**

Right after the lines you just added, append:

```js
    // Encirclement death: any disconnected region of an affected faction
    // without a resident player flips to the claimer; trail-runners whose
    // faction is now wiped die.
    {
      // Snap each character's body position to its current grid index.
      // We mutate the array temporarily by attaching a `cellIndex` field;
      // the helper reads only that field for residency lookup.
      const N = GRID_SIZE;
      for (const c of this.characters) {
        if (!c.alive) { c.cellIndex = -1; continue; }
        const { gx, gy } = this._worldToGrid(c.pos.x, c.pos.z);
        c.cellIndex = (gx >= 0 && gx < N && gy >= 0 && gy < N) ? (gy * N + gx) : -1;
      }
      const result = enforceConnectivity({
        grid,
        gridSize: N,
        numFactions: FACTION_COUNT,
        affectedFactions,
        characters: this.characters,
        claimerFactionId: factionId,
        cellCounts,
      });
      // Append captured cells to the changedCells diff so clients sync.
      // Re-iterate grid for any cell whose owner now equals factionId
      // — but only for the cells touched in this sweep. We don't know
      // exactly which indices flipped; the simplest robust approach is
      // to invalidate the contour cache for everyone whose cellCounts
      // changed and let the next-tick territoryPct sync surface them.
      // For schema sync of the actual cells, we extend changedCells
      // by scanning for grid cells == factionId that weren't already in
      // the diff. Cheap path: skip if no captures happened.
      if (result.capturedCells > 0) {
        // Recompute by walking the grid is too expensive; instead, rebuild
        // the changed set by scanning the *labeled* regions. We didn't keep
        // labels here, so we conservatively broadcast a heal of all
        // affected-faction cells. For simplicity in this MVP, push a
        // marker so the GameRoom can broadcast a heal event with all
        // changedCells from this claim plus a follow-up "connectivity"
        // event identifying captured regions. To avoid that complexity,
        // we recompute changedCells by scanning the grid bbox we already
        // have (minGX/minGY/maxGX/maxGY) for cells now equal to factionId
        // that aren't already in changedCells.
        const seen = new Set(changedCells);
        for (let gy = minGY; gy <= maxGY; gy++) {
          for (let gx = minGX; gx <= maxGX; gx++) {
            const idx = gy * N + gx;
            if (grid[idx] === factionId && !seen.has(idx)) {
              changedCells.push(idx);
            }
          }
        }
      }
      // Apply the kill pass.
      for (const v of result.killedCharacters) {
        this._killCharacter(v, char); // credit the claimer
      }
      // Invalidate contour caches for affected factions.
      for (const f of affectedFactions) this._contourCache.delete(f);
    }
```

> **Note:** the bbox scan above only catches captured cells inside the current claim's bounding box. Disconnected fragments of a faction can lie OUTSIDE the trail's bbox (e.g. a far-away chunk that was already disconnected before this claim but is now newly captured because its last resident just died this tick). For correctness in the rare case, the next step adds a second bbox-aware fallback.

- [ ] **Step 4: Add a fallback to also collect captured cells beyond the claim bbox**

Replace the `if (result.capturedCells > 0) { ... }` block in step 3 with this version, which extends to a full-grid sweep when the bbox sweep finds fewer cells than `result.capturedCells`:

```js
      if (result.capturedCells > 0) {
        const seen = new Set(changedCells);
        let foundInBbox = 0;
        for (let gy = minGY; gy <= maxGY; gy++) {
          for (let gx = minGX; gx <= maxGX; gx++) {
            const idx = gy * N + gx;
            if (grid[idx] === factionId && !seen.has(idx)) {
              changedCells.push(idx);
              seen.add(idx);
              foundInBbox++;
            }
          }
        }
        // Fragments outside the bbox: full-grid pass only when needed.
        if (foundInBbox < result.capturedCells) {
          for (let i = 0, len = grid.length; i < len; i++) {
            if (grid[i] === factionId && !seen.has(i)) {
              // Was this cell faction X before? We don't know without a snapshot.
              // Conservative path: include it. Worst case we re-broadcast a few
              // cells the client already had; never wrong.
              changedCells.push(i);
              seen.add(i);
            }
          }
        }
      }
```

- [ ] **Step 5: Run all sim tests**

Run: `pnpm test prototype/sim/__tests__/`
Expected: all existing tests pass + 6 new connectivity tests pass.

- [ ] **Step 6: Manual smoke**

Run `pnpm dev:server`, open `http://localhost:2567/`, click SOLO. Drive your player out, draw a small loop around a bot's trail-running excursion (the easiest setup: pick a bot heading away from its faction, draw a loop around its body in enemy land). Expected: when your loop closes, if the bot's faction now has 0 cells AND the bot is trailing, the bot dies and its territory is yours. (For factions with multiple regions and other residents, only the unoccupied piece flips.)

The most reliable manual test: in DevTools while running solo, run `window.game.sim.cellCounts` and observe before/after a claim that closes around an isolated chunk.

- [ ] **Step 7: Commit**

```bash
git add prototype/sim/Simulation.js
git commit -m "feat(sim): wire enforceConnectivity into claim — encirclement death"
```

---

### Phase 2 Complete

The bug fix ships independently. Move to Phase 3.

---

## Phase 3 — Private Rooms

### Sub-phase 3A: Sim parameterization

The Simulation currently hardcodes 5 factions × 6 chars. Private rooms need 3–5 factions and a chosen bots-per-faction (or zero, with bots spawned at start time).

### Task 12: Parameterize `FactionManager.init` for `numFactions`

**Files:**
- Modify: `prototype/sim/faction.js`

- [ ] **Step 1: Update `init` signature + use `numFactions` everywhere**

Replace the `init` method at `prototype/sim/faction.js:47-94` with this version (adds optional `numFactions` last param, defaults to `FACTION_COUNT` for back-compat):

```js
  init(grid, gridSize, worldMin, cellSize, arenaRadius, sentinel, numFactions = FACTION_COUNT) {
    this._factions.clear();

    const sliceAngle = (2 * Math.PI) / numFactions;
    const spawnRadius = arenaRadius * 0.6;

    for (let i = 0; i < numFactions; i++) {
      const id = i + 1;
      const midAngle = i * sliceAngle + sliceAngle / 2 - Math.PI;
      const spawnX = Math.cos(midAngle) * spawnRadius;
      const spawnZ = Math.sin(midAngle) * spawnRadius;

      this._factions.set(id, {
        id,
        name: FACTION_NAMES[i] ?? `Faction ${id}`,
        color: FACTION_COLORS[i] ?? 0xffffff,
        spawnPoint: { x: spawnX, z: spawnZ },
        alive: true,
        respawnsEnabled: true,
        endangered: false,
        characters: new Set(),
        territoryPct: 0,
      });
    }

    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const idx = gy * gridSize + gx;
        if (grid[idx] === sentinel) continue;

        const wx = worldMin + (gx + 0.5) * cellSize;
        const wy = worldMin + (gy + 0.5) * cellSize;

        let angle = Math.atan2(wy, wx);
        if (angle < 0) angle += 2 * Math.PI;

        const sectorIndex = Math.floor(angle / sliceAngle);
        const factionId = (sectorIndex % numFactions) + 1;
        grid[idx] = factionId;
      }
    }
  }
```

- [ ] **Step 2: Run sim tests — should still pass**

Run: `pnpm test prototype/sim/__tests__/`
Expected: all pass (default `numFactions = FACTION_COUNT` preserves old behavior).

- [ ] **Step 3: Commit**

```bash
git add prototype/sim/faction.js
git commit -m "refactor(sim): FactionManager.init accepts optional numFactions"
```

---

### Task 13: Parameterize `Simulation` constructor + `_initCharacters` + `start`

**Files:**
- Modify: `prototype/sim/Simulation.js`

- [ ] **Step 1: Update constructor**

Replace the constructor at `prototype/sim/Simulation.js:14-50` with this version:

```js
  constructor({ seed = 1, numFactions = FACTION_COUNT, botsPerFaction = CHARS_PER_FACTION } = {}) {
    this.seed = seed;
    this.numFactions = numFactions;
    this.botsPerFaction = botsPerFaction;
    this.grid = new Uint8Array(GRID_SIZE * GRID_SIZE);
    this.factionManager = new FactionManager();
    this.scoreTracker = new ScoreTracker();
    this.matchManager = new MatchManager(this.factionManager, this.scoreTracker);
    this.characters = [];
    this.totalArenaCells = 0;
    this.started = false;
    // cellCounts is sized to numFactions (index 0 = unclaimed).
    this.cellCounts = new Uint32Array(numFactions + 1);

    this.onClaim = null;
    this.onClaimResult = null;
    this.onHeal = null;
    this.onTrailVertex = null;
    this.onKill = null;
    this.onTeleport = null;

    this._contourCache = new Map();
    this._contourDirty = new Set();
  }
```

- [ ] **Step 2: Update `_initCharacters`**

Replace `_initCharacters` at `prototype/sim/Simulation.js:152-163`:

```js
  _initCharacters() {
    let id = 0;
    for (let f = 1; f <= this.numFactions; f++) {
      for (let i = 0; i < this.botsPerFaction; i++) {
        const name = BOT_NAMES[id % BOT_NAMES.length];
        const c = new Character({ id, factionId: f, name, respawnDelay: RESPAWN_DELAY });
        this.characters.push(c);
        this.scoreTracker.register(c);
        id++;
      }
    }
  }
```

- [ ] **Step 3: Update `start()` to pass `numFactions` to `factionManager.init`**

In `prototype/sim/Simulation.js:102-119` (`start()` method), change the existing call:

```js
    this.factionManager.init(this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL);
```

to:

```js
    this.factionManager.init(this.grid, GRID_SIZE, WORLD_MIN, CELL_SIZE, ARENA_RADIUS, GRID_SENTINEL, this.numFactions);
```

- [ ] **Step 4: Update `claim()` to use `this.numFactions` for the connectivity sweep**

In the integration block added in Task 11 (Step 3), change:

```js
        numFactions: FACTION_COUNT,
```

to:

```js
        numFactions: this.numFactions,
```

- [ ] **Step 5: Run sim tests**

Run: `pnpm test prototype/sim/__tests__/`
Expected: all pass (defaults preserve behavior).

- [ ] **Step 6: Smoke test with non-default config**

In a node REPL or a tiny throwaway test:

```js
import { Simulation } from "./prototype/sim/Simulation.js";
const s = new Simulation({ seed: 1, numFactions: 3, botsPerFaction: 2 });
s.start();
console.log(s.characters.length); // 6
console.log(s.numFactions);       // 3
```

Or just confirm via a quick test added to `prototype/sim/__tests__/Simulation.test.js`:

```js
it("can be configured with numFactions=3 and botsPerFaction=2", () => {
  const s = new Simulation({ seed: 1, numFactions: 3, botsPerFaction: 2 });
  s.start();
  expect(s.characters.length).toBe(6);
  expect(s.numFactions).toBe(3);
});
```

Run: `pnpm test prototype/sim/__tests__/Simulation.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prototype/sim/Simulation.js prototype/sim/__tests__/Simulation.test.js
git commit -m "refactor(sim): Simulation accepts numFactions/botsPerFaction"
```

---

### Sub-phase 3B: Schema additions

### Task 14: Extend `GameStateSchema` with room fields

**Files:**
- Modify: `server/src/schema/GameState.ts`

- [ ] **Step 1: Add the three new fields**

Replace `server/src/schema/GameState.ts:33-39` with:

```ts
export class GameStateSchema extends Schema {
  @type("string") phase: string = "playing"; // "waiting" | "playing" | "intermission" | "ended"
  @type("number") timeRemaining: number = 0;
  @type("number") intermissionRemaining: number = 0;
  @type([FactionSchema]) factions = new ArraySchema<FactionSchema>();
  @type([CharacterSchema]) characters = new ArraySchema<CharacterSchema>();
  // Private-room only. Public room leaves these at defaults.
  @type("string") roomCode: string = "";
  @type("number") minHumans: number = 0;
  @type("number") humanCount: number = 0;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter template-server typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/schema/GameState.ts
git commit -m "feat(schema): add roomCode/minHumans/humanCount to GameStateSchema"
```

---

### Sub-phase 3C: Room code registry

### Task 15: Failing test for `roomCodeRegistry`

**Files:**
- Create: `server/src/__tests__/roomCodeRegistry.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { generateCode, register, release, lookup, _resetForTest } from "../rooms/roomCodeRegistry.js";

describe("roomCodeRegistry", () => {
  beforeEach(() => _resetForTest());

  it("generates 6-char codes from the safe alphabet", () => {
    const c = generateCode();
    expect(c).toHaveLength(6);
    expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("register/lookup/release round-trip", () => {
    expect(lookup("ABCDEF")).toBeNull();
    expect(register("ABCDEF", "room-1")).toBe(true);
    expect(lookup("ABCDEF")).toBe("room-1");
    release("ABCDEF");
    expect(lookup("ABCDEF")).toBeNull();
  });

  it("register returns false on collision", () => {
    expect(register("ABCDEF", "room-1")).toBe(true);
    expect(register("ABCDEF", "room-2")).toBe(false);
    expect(lookup("ABCDEF")).toBe("room-1");
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm test server/src/__tests__/roomCodeRegistry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Commit (red)**

```bash
git add server/src/__tests__/roomCodeRegistry.test.ts
git commit -m "test(server): roomCodeRegistry — first failing tests"
```

---

### Task 16: Implement `roomCodeRegistry`

**Files:**
- Create: `server/src/rooms/roomCodeRegistry.ts`

- [ ] **Step 1: Write the module**

```ts
// In-memory map of human-readable 6-char codes → Colyseus roomIds.
// Codes use a 32-char alphabet that omits visually confusing pairs:
//   no 0/O, no 1/I/L. → ABCDEFGHJKLMNPQRSTUVWXYZ23456789
// 32^6 = ~1B codes; collisions are negligible. The room caller still retries
// register() up to 3 times if generateCode() happens to clash.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

const codes = new Map<string, string>(); // code → roomId

export function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  }
  return out;
}

export function register(code: string, roomId: string): boolean {
  if (codes.has(code)) return false;
  codes.set(code, roomId);
  return true;
}

export function release(code: string): void {
  codes.delete(code);
}

export function lookup(code: string): string | null {
  return codes.get(code) ?? null;
}

// Test-only reset hook.
export function _resetForTest(): void {
  codes.clear();
}
```

- [ ] **Step 2: Run — expect pass**

Run: `pnpm test server/src/__tests__/roomCodeRegistry.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit (green)**

```bash
git add server/src/rooms/roomCodeRegistry.ts
git commit -m "feat(server): roomCodeRegistry with collision-safe alphabet"
```

---

### Sub-phase 3D: PrivateGameRoom

### Task 17: Promote `private` → `protected` on `GameRoom` for subclassing

**Files:**
- Modify: `server/src/rooms/GameRoom.ts`

`PrivateGameRoom` (Task 18 below) needs to access several fields and methods on the base class. They're currently `private`. Promoting them to `protected` is the cleanest enabler — the alternative is `// @ts-expect-error` litter in the subclass.

- [ ] **Step 1: Replace every `private` modifier on instance fields and methods of class `GameRoom` with `protected`**

In `server/src/rooms/GameRoom.ts`, change the following lines (the lines listed are from the current file as inspected):

| Line | Before | After |
|---|---|---|
| 77 | `private sim!: any;` | `protected sim!: any;` |
| 78 | `private clientMeta = new Map<string, ClientMeta>();` | `protected clientMeta = new Map<string, ClientMeta>();` |
| 79 | `private prevPhase: string = "playing";` | `protected prevPhase: string = "playing";` |
| 80 | `private intermissionRemaining: number = 0;` | `protected intermissionRemaining: number = 0;` |
| 81 | `private playerScores = new Map<string, …>();` | `protected playerScores = new Map<string, …>();` |
| 82 | `private matchStartTs: number = Date.now();` | `protected matchStartTs: number = Date.now();` |
| 87 | `private lastClaimWasLarge = false;` | `protected lastClaimWasLarge = false;` |
| 144 | `private wireSimEvents(): void {` | `protected wireSimEvents(): void {` |
| 217 | `private handleHello(...) {` | `protected handleHello(...) {` |
| 309 | `private tickStats = { … };` | `protected tickStats = { … };` |
| 311 | `private tick(dt: number) {` | `protected tick(dt: number) {` |
| 345 | `private _tickInner(dt: number) {` | `protected _tickInner(dt: number) {` |
| 418 | `private emitMatchEnd() {` | `protected emitMatchEnd() {` |
| 445 | `private accumulateScores() {` | `protected accumulateScores() {` |
| 473 | `private releaseChar(...) {` | `protected releaseChar(...) {` |

Use Edit / find-replace with the exact patterns. Don't touch the `private` in `pickWeakestFaction`'s parameter list (that's not a field modifier).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter template-server typecheck`
Expected: PASS.

- [ ] **Step 3: Run existing GameRoom test**

Run: `pnpm test server/src/__tests__/GameRoom.test.ts`
Expected: PASS — no behavior change, only access modifiers.

- [ ] **Step 4: Commit**

```bash
git add server/src/rooms/GameRoom.ts
git commit -m "refactor(server): protected fields/methods on GameRoom for subclassing"
```

---

### Task 18: Implement `PrivateGameRoom`

**Files:**
- Create: `server/src/rooms/PrivateGameRoom.ts`

- [ ] **Step 1: Write the room class**

```ts
import type { Client } from "@colyseus/core";
import { GameRoom } from "./GameRoom.js";
import { CharacterSchema, FactionSchema, GameStateSchema } from "../schema/GameState.js";
import { generateCode, register, release } from "./roomCodeRegistry.js";
import { insertServerEvent } from "../stats/db.js";
// @ts-ignore — JS module, types not exported
import { Simulation } from "../sim/Simulation.js";

export interface PrivateRoomOptions {
  factions?: number;
  bots?: boolean;
  botsPerFaction?: number;
  minHumans?: number;
  code?: string;
}

interface ValidatedOptions {
  factions: number;
  botsPerFaction: number; // 0 if bots disabled
  minHumans: number;
}

const MAX_CAPACITY = 50;
const TTL_EMPTY_MS = 5 * 60 * 1000;

function validateOptions(raw: PrivateRoomOptions): ValidatedOptions {
  const factions = Math.max(3, Math.min(5, Math.floor(raw.factions ?? 5)));
  const botsOn = raw.bots !== false;
  const botsPerFaction = botsOn
    ? Math.max(1, Math.min(9, Math.floor(raw.botsPerFaction ?? 6)))
    : 0;
  const minHumans = Math.max(1, Math.min(10, Math.floor(raw.minHumans ?? 2)));
  const totalBots = factions * botsPerFaction;
  if (totalBots + minHumans > MAX_CAPACITY) {
    throw new Error(
      `Room over capacity: ${totalBots} bots + ${minHumans} min humans > ${MAX_CAPACITY}`,
    );
  }
  return { factions, botsPerFaction, minHumans };
}

export class PrivateGameRoom extends GameRoom {
  private _privateCode: string = "";
  private _config!: ValidatedOptions;
  private _emptyTimer: NodeJS.Timeout | null = null;
  private _matchStartedAt: number = 0;
  private _matchHasStarted: boolean = false;

  // We DO NOT call super.onCreate. The base spins up a 5-faction sim with bots;
  // we want a parameterized sim that starts with zero characters and a
  // "waiting" phase. We replicate the rest of the base's setup in line.
  override onCreate(rawOptions: PrivateRoomOptions = {}) {
    const cfg = validateOptions(rawOptions); // throws on bad config
    this._config = cfg;

    // Allocate a code (caller-supplied or generated). Up to 3 collision retries.
    let code = (rawOptions.code ?? "").toUpperCase();
    if (code) {
      if (!register(code, this.roomId)) throw new Error(`Code ${code} already in use`);
    } else {
      for (let i = 0; i < 3; i++) {
        const candidate = generateCode();
        if (register(candidate, this.roomId)) { code = candidate; break; }
      }
      if (!code) throw new Error("Failed to allocate a unique room code");
    }
    this._privateCode = code;

    this.maxClients = MAX_CAPACITY - cfg.factions * cfg.botsPerFaction;

    this.setState(new GameStateSchema());
    this.state.phase = "waiting";
    this.state.roomCode = code;
    this.state.minHumans = cfg.minHumans;
    this.state.humanCount = 0;

    this.patchRate = 1000 / 30;

    // Sim with NO bots yet — they get added by startMatch().
    this.sim = new Simulation({ numFactions: cfg.factions, botsPerFaction: 0 });
    this.sim.start();
    this.wireSimEvents();

    for (let f = 1; f <= cfg.factions; f++) {
      const fs = new FactionSchema();
      fs.id = f;
      this.state.factions.push(fs);
    }

    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / 30);

    // Ping/pong (shared with public room).
    this.onMessage("ping", (client, t: number) => client.send("pong", t));

    // hello/input — same as GameRoom.onCreate but inlined since we don't super.
    this.onMessage("hello", (client, msg: { name?: string; playerToken?: string | null }) => {
      this.handleHello(client, msg.name ?? "Player", msg.playerToken ?? null);
    });
    this.onMessage("input", (client, msg: { dirX: number; dirZ: number; seq?: number }) => {
      const meta = this.clientMeta.get(client.sessionId);
      if (!meta || meta.charId === null) return;
      this.sim.setTargetDir(meta.charId, msg.dirX, msg.dirZ);
      if (typeof msg.seq === "number" && msg.seq > meta.lastInputSeq) {
        meta.lastInputSeq = msg.seq;
      }
    });

    insertServerEvent("room_created", {
      code,
      factions: cfg.factions,
      botsPerFaction: cfg.botsPerFaction,
      minHumans: cfg.minHumans,
    }, { mode: "private" });
  }

  override onJoin(client: Client) {
    if (this._emptyTimer) { clearTimeout(this._emptyTimer); this._emptyTimer = null; }
    super.onJoin(client);
    this.state.humanCount = this.clients.length;
    if (!this._matchHasStarted && this.clients.length >= this._config.minHumans) {
      this.startMatch();
    }
  }

  override async onLeave(client: Client, consented: boolean) {
    await super.onLeave(client, consented);
    this.state.humanCount = this.clients.length;
    if (this.clients.length === 0 && !this._emptyTimer) {
      this._emptyTimer = setTimeout(() => this.disconnect(), TTL_EMPTY_MS);
    }
  }

  override onDispose() {
    if (this._emptyTimer) { clearTimeout(this._emptyTimer); this._emptyTimer = null; }
    if (this._privateCode) release(this._privateCode);
    insertServerEvent("room_expired", {
      code: this._privateCode,
      durationMs: this._matchStartedAt ? Date.now() - this._matchStartedAt : 0,
      started: this._matchHasStarted,
    }, { mode: "private" });
    super.onDispose();
  }

  private startMatch() {
    this._matchHasStarted = true;
    this._matchStartedAt = Date.now();
    const cfg = this._config;
    const sim = this.sim;
    for (let f = 1; f <= cfg.factions; f++) {
      for (let i = 0; i < cfg.botsPerFaction; i++) {
        const c = sim.addCharacter(f, cfg.botsPerFaction + 50);
        if (!c) continue;
        const cs = new CharacterSchema();
        cs.id = c.id;
        cs.factionId = c.factionId;
        cs.name = c.name;
        cs.posX = c.pos.x; cs.posZ = c.pos.z;
        cs.dirX = c.dir.x; cs.dirZ = c.dir.z;
        cs.alive = c.alive;
        cs.isHuman = false;
        this.state.characters.push(cs);
      }
    }
    this.state.phase = "playing";
    insertServerEvent("room_started", {
      code: this._privateCode,
      humansAtStart: this.clients.length,
      totalBots: cfg.factions * cfg.botsPerFaction,
      config: cfg,
    }, { mode: "private" });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter template-server typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/rooms/PrivateGameRoom.ts
git commit -m "feat(server): PrivateGameRoom with waiting phase + code allocation"
```

---

### Sub-phase 3E: HTTP `/api/room` endpoint + register room type

### Task 19: Register `private` room type and validate-code endpoint

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Import + register the new room**

In `server/src/index.ts`, after the existing import line `import { GameRoom } from "./rooms/GameRoom.js";` (line 7), add:

```ts
import { PrivateGameRoom } from "./rooms/PrivateGameRoom.js";
import { lookup as lookupRoomCode } from "./rooms/roomCodeRegistry.js";
```

After `gameServer.define("game", GameRoom);` (line 66), add:

```ts
gameServer.define("private", PrivateGameRoom).filterBy(["code"]);
```

- [ ] **Step 2: Add `/api/room?code=…` endpoint**

In `server/src/index.ts`, after the existing `app.use("/track", …)` line (line 49), add:

```ts
app.get("/api/room", (req, res) => {
  const codeRaw = typeof req.query.code === "string" ? req.query.code : "";
  const code = codeRaw.toUpperCase().slice(0, 6);
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    res.json({ exists: false });
    return;
  }
  res.json({ exists: lookupRoomCode(code) !== null });
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter template-server typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke**

Run `pnpm dev:server`. In another terminal:

```bash
curl 'http://localhost:2567/api/room?code=NOSUCH'
# expected: {"exists":false}
```

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): register private room + /api/room validate endpoint"
```

---

### Sub-phase 3F: Integration test for private-room flow

### Task 20: Server integration test — create + join + start

**Files:**
- Create: `server/src/__tests__/PrivateGameRoom.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { boot } from "@colyseus/testing";
import type { Server } from "@colyseus/core";
import { PrivateGameRoom } from "../rooms/PrivateGameRoom.js";
import { _resetForTest } from "../rooms/roomCodeRegistry.js";

describe("PrivateGameRoom", () => {
  it("creates with config, transitions waiting → playing on min humans", async () => {
    _resetForTest();
    const colyseus = await boot({
      initializeGameServer: (gameServer: Server) => {
        gameServer.define("private", PrivateGameRoom).filterBy(["code"]);
      },
    });
    try {
      const room = await colyseus.createRoom("private", {
        factions: 3, bots: true, botsPerFaction: 2, minHumans: 2,
      });
      // settle
      await new Promise((r) => setTimeout(r, 100));
      expect(room.state.phase).toBe("waiting");
      expect(room.state.factions.length).toBe(3);
      expect(room.state.characters.length).toBe(0); // no bots yet
      expect(room.state.roomCode).toMatch(/^[A-Z0-9]{6}$/);
      expect(room.state.minHumans).toBe(2);

      const code = room.state.roomCode;
      const c1 = await colyseus.connectTo(room, { code });
      await new Promise((r) => setTimeout(r, 100));
      expect(room.state.phase).toBe("waiting"); // 1/2 humans
      expect(room.state.humanCount).toBeGreaterThanOrEqual(1);

      const c2 = await colyseus.connectTo(room, { code });
      await new Promise((r) => setTimeout(r, 200));
      expect(room.state.phase).toBe("playing");
      expect(room.state.characters.length).toBeGreaterThanOrEqual(3 * 2); // bots spawned
    } finally {
      await colyseus.shutdown();
    }
  }, 15000);

  it("rejects oversized config", async () => {
    _resetForTest();
    const colyseus = await boot({
      initializeGameServer: (gameServer: Server) => {
        gameServer.define("private", PrivateGameRoom).filterBy(["code"]);
      },
    });
    try {
      // 5 factions × 9 bots = 45 bots; +10 min humans = 55 > 50 → reject
      await expect(
        colyseus.createRoom("private", { factions: 5, bots: true, botsPerFaction: 9, minHumans: 10 }),
      ).rejects.toThrow();
    } finally {
      await colyseus.shutdown();
    }
  }, 10000);
});
```

- [ ] **Step 2: Run — expect pass**

Run: `pnpm test server/src/__tests__/PrivateGameRoom.test.ts`
Expected: BOTH tests pass.

> If the test fails because `connectTo` complains about missing `name`, augment the test by sending a `hello` message after connect:
> `c1.send("hello", { name: "T1" })` then sleep 100ms.

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/PrivateGameRoom.test.ts
git commit -m "test(server): PrivateGameRoom integration — waiting→playing"
```

---

### Sub-phase 3G: Client multiplayer methods

### Task 21: Add `joinPrivate` / `createPrivate` to `MultiplayerClient`

**Files:**
- Modify: `prototype/multiplayer.js`

- [ ] **Step 1: Refactor `connect` so the room-binding code is reusable**

In `prototype/multiplayer.js`, extract the message-binding logic (currently inline in `connect`, lines 81-105) into a private method. Replace the existing `connect()` method (`prototype/multiplayer.js:69-108`) with:

```js
  async connect(playerName, playerToken) {
    let token = playerToken || localStorage.getItem("playerToken");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("playerToken", token);
    }
    this.playerToken = token;

    this.room = await this.client.joinOrCreate("game", {});
    this._wireRoomHandlers();
    this.room.send("hello", { name: playerName, playerToken: token });
    return this.room;
  }

  // Join a private room by 6-char code. Same hello flow.
  async joinPrivate(code, playerName) {
    let token = localStorage.getItem("playerToken");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("playerToken", token);
    }
    this.playerToken = token;

    this.room = await this.client.join("private", { code });
    this._wireRoomHandlers();
    this.room.send("hello", { name: playerName, playerToken: token });
    return this.room;
  }

  // Create a private room with the given config + immediately join it.
  async createPrivate(config, playerName) {
    let token = localStorage.getItem("playerToken");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("playerToken", token);
    }
    this.playerToken = token;

    this.room = await this.client.create("private", config);
    this._wireRoomHandlers();
    this.room.send("hello", { name: playerName, playerToken: token });
    return this.room;
  }

  _wireRoomHandlers() {
    this.room.onStateChange((state) => this.onState?.(state));

    const handlers = [
      ["claim",           "onClaim",           (m) => [m.charId, m.factionId, m.trailPoints, !!m.replayTrail]],
      ["claimResult",     "onClaimResult",     (m) => [m.charId, m.factionId, m.cells]],
      ["heal",            "onHeal",            (m) => [m.changedCells]],
      ["trailVertex",     "onTrailVertex",     (m) => [m.charId, m.x, m.z]],
      ["kill",            "onKill",            (m) => [m.killerId, m.victimId]],
      ["teleport",        "onTeleport",        (m) => [m.charId, m.posX, m.posZ, m.dirX, m.dirZ, m.reason]],
      ["yourCharId",      "onYourCharId",      (m) => [m.charId]],
      ["gridSnapshot",    "onGridSnapshot",    (m) => [m.bytes]],
      ["cumulativeScore", "onCumulativeScore", (m) => [m.score]],
      ["nameRejected",    "onNameRejected",    (m) => [{ reason: m.reason }]],
    ];
    for (const [msg, hook, mapArgs] of handlers) {
      this.room.onMessage(msg, (payload) => {
        const fn = this[hook];
        if (fn) fn(...mapArgs(payload));
      });
    }
    this.room.onMessage("pong", (t) => {
      const rtt = performance.now() - t;
      this._rttSamples.push(rtt);
      while (this._rttSamples.length > 5) this._rttSamples.shift();
    });
    this._pingInterval = setInterval(() => {
      try { this.room?.send("ping", performance.now()); } catch {}
    }, 2000);
  }
```

(The previous Task 2 ping/pong wiring lived in `connect`; now it's in `_wireRoomHandlers` and used by all three entry points.)

- [ ] **Step 2: Manual smoke (existing public flow still works)**

Run `pnpm dev:server`, open `http://localhost:2567/`, click ONLINE, enter a name. Expected: works exactly as before (the refactor is behavior-preserving for the public path). Also: `window._game.mp.getRTT()` still returns a number after a couple seconds.

- [ ] **Step 3: Commit**

```bash
git add prototype/multiplayer.js
git commit -m "refactor(client): extract _wireRoomHandlers; add joinPrivate/createPrivate"
```

---

### Sub-phase 3H: Title-screen button + private-room modal

### Task 22: Add `PRIVATE ROOM` button + modal DOM/CSS

**Files:**
- Modify: `prototype/index.html`

- [ ] **Step 1: Add the button to `#ts-button-row`**

In `prototype/index.html:611-614`, replace:

```html
      <div id="ts-button-row">
        <button id="solo-btn">SOLO</button>
        <button id="online-btn">ONLINE</button>
      </div>
```

with:

```html
      <div id="ts-button-row">
        <button id="solo-btn">SOLO</button>
        <button id="online-btn">ONLINE</button>
        <button id="private-btn">PRIVATE ROOM</button>
      </div>
```

- [ ] **Step 2: Add the modal**

In `prototype/index.html`, immediately AFTER the closing `</div>` of `#name-entry` (line 623) and BEFORE `<script src="telemetry.js" …>` (line 624), insert:

```html
  <!-- Private-room modal: create or join. Hidden by default; main.js shows it. -->
  <div id="private-modal" class="hidden">
    <div id="private-modal-backdrop"></div>
    <div id="private-modal-panel">
      <div id="private-modal-tabs">
        <button class="pm-tab active" data-tab="join">JOIN</button>
        <button class="pm-tab" data-tab="create">CREATE</button>
      </div>
      <div class="pm-body" id="pm-body-join">
        <label>ROOM CODE</label>
        <input id="pm-code" type="text" maxlength="6" placeholder="FG58R2" />
        <div id="pm-join-error" class="pm-error"></div>
        <button id="pm-join-submit">JOIN ROOM</button>
      </div>
      <div class="pm-body hidden" id="pm-body-create">
        <label>FACTIONS</label>
        <div id="pm-factions" class="pm-radios">
          <label><input type="radio" name="pm-fac" value="3"> 3</label>
          <label><input type="radio" name="pm-fac" value="4"> 4</label>
          <label><input type="radio" name="pm-fac" value="5" checked> 5</label>
        </div>
        <label class="pm-row">
          <input id="pm-bots" type="checkbox" checked> BOTS
        </label>
        <label id="pm-bots-per-row">BOTS PER FACTION <span id="pm-bots-per-val">6</span>
          <input id="pm-bots-per" type="range" min="1" max="9" value="6">
        </label>
        <label>MIN HUMANS TO START
          <input id="pm-min-humans" type="number" min="1" max="10" value="2">
        </label>
        <div id="pm-cap-readout" class="pm-readout">Capacity: 1 humans + 30 bots = 31 / 50</div>
        <button id="pm-create-submit">CREATE ROOM</button>
      </div>
      <button id="pm-cancel">CANCEL</button>
    </div>
  </div>
```

- [ ] **Step 3: Add CSS**

In `prototype/index.html`'s `<style>` block, append:

```css
#private-modal { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; }
#private-modal.hidden { display: none; }
#private-modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.6); }
#private-modal-panel {
  position: relative; min-width: 360px; max-width: 90vw;
  background: #1a1f2b; color: #eef3fb; padding: 22px 26px; border-radius: 8px;
  font-family: ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
}
#private-modal-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.pm-tab { flex: 1; padding: 8px 12px; background: transparent; color: #9aa6b8; border: 1px solid #2d3445; border-radius: 4px; cursor: pointer; font-weight: 600; letter-spacing: 0.06em; }
.pm-tab.active { background: #ffcf2a; color: #1a1f2b; border-color: #ffcf2a; }
.pm-body { display: flex; flex-direction: column; gap: 10px; }
.pm-body.hidden { display: none; }
.pm-body label { font-size: 12px; color: #9aa6b8; letter-spacing: 0.04em; text-transform: uppercase; }
.pm-body input[type="text"], .pm-body input[type="number"] {
  background: #11141d; color: #eef3fb; border: 1px solid #2d3445; border-radius: 4px;
  padding: 8px 10px; font-family: inherit; font-size: 14px;
}
#pm-code { letter-spacing: 0.4em; text-transform: uppercase; text-align: center; font-family: ui-monospace, monospace; }
.pm-radios { display: flex; gap: 14px; }
.pm-radios label { display: flex; align-items: center; gap: 4px; }
.pm-row { display: flex; align-items: center; gap: 8px; }
.pm-readout { font-size: 12px; color: #cfd6e0; padding: 6px 0; }
.pm-error { color: #e74a3f; font-size: 13px; min-height: 16px; }
#pm-join-submit, #pm-create-submit, #pm-cancel {
  background: #ffcf2a; color: #1a1f2b; border: none; border-radius: 4px;
  padding: 10px 16px; font-weight: 700; letter-spacing: 0.06em; cursor: pointer; font-family: inherit;
}
#pm-cancel { background: transparent; color: #9aa6b8; margin-top: 12px; padding: 4px; }
```

- [ ] **Step 4: Manual smoke**

Reload the page. The new PRIVATE ROOM button should appear next to ONLINE. The modal is hidden by default. In DevTools:

```js
document.getElementById("private-modal").classList.remove("hidden");
```

Expected: a centered dark modal with two tabs, JOIN tab visible by default. Clicking the CREATE tab swaps which body shows. (Tab-switch wiring comes in Task 23.)

- [ ] **Step 5: Commit**

```bash
git add prototype/index.html
git commit -m "feat(ui): add PRIVATE ROOM button and join/create modal DOM/CSS"
```

---

### Task 23: Wire the modal — open, tab-switch, capacity readout

**Files:**
- Modify: `prototype/main.js`

- [ ] **Step 1: Add modal open/close + tab logic**

In `prototype/main.js`, just before the existing `document.getElementById("solo-btn")…` block (line 3471), add:

```js
// ===== Private-room modal =====
const _pmEl = (id) => document.getElementById(id);
function _pmOpen() { _pmEl("private-modal").classList.remove("hidden"); _pmRecalcCapacity(); }
function _pmClose() { _pmEl("private-modal").classList.add("hidden"); _pmEl("pm-join-error").textContent = ""; }

document.querySelectorAll(".pm-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".pm-tab").forEach(t => t.classList.toggle("active", t === tab));
    _pmEl("pm-body-join").classList.toggle("hidden", tab.dataset.tab !== "join");
    _pmEl("pm-body-create").classList.toggle("hidden", tab.dataset.tab !== "create");
  });
});

function _pmReadCreateConfig() {
  const factionsInput = document.querySelector('input[name="pm-fac"]:checked');
  const factions = parseInt(factionsInput?.value ?? "5", 10);
  const bots = _pmEl("pm-bots").checked;
  const botsPerFaction = parseInt(_pmEl("pm-bots-per").value, 10);
  const minHumans = parseInt(_pmEl("pm-min-humans").value, 10);
  return { factions, bots, botsPerFaction, minHumans };
}

function _pmRecalcCapacity() {
  const cfg = _pmReadCreateConfig();
  const totalBots = cfg.bots ? cfg.factions * cfg.botsPerFaction : 0;
  const humanSlots = 50 - totalBots;
  const out = _pmEl("pm-cap-readout");
  out.textContent = `Capacity: ${humanSlots} human slots + ${totalBots} bot slots = ${humanSlots + totalBots} / 50`;
  // Hide the "bots per faction" row when bots disabled.
  _pmEl("pm-bots-per-row").style.display = cfg.bots ? "" : "none";
  _pmEl("pm-bots-per-val").textContent = String(cfg.botsPerFaction);
  // Disable submit if min-humans exceeds capacity.
  const overCap = humanSlots < cfg.minHumans;
  const submit = _pmEl("pm-create-submit");
  submit.disabled = overCap;
  submit.style.opacity = overCap ? "0.5" : "1";
}

["pm-bots", "pm-bots-per", "pm-min-humans"].forEach(id => {
  _pmEl(id).addEventListener("input", _pmRecalcCapacity);
});
document.querySelectorAll('input[name="pm-fac"]').forEach(r => r.addEventListener("change", _pmRecalcCapacity));

_pmEl("pm-cancel").addEventListener("click", _pmClose);
_pmEl("private-modal-backdrop").addEventListener("click", _pmClose);

document.getElementById("private-btn").addEventListener("click", _pmOpen);

// Force-uppercase + 6-char clamp on the code input.
_pmEl("pm-code").addEventListener("input", (e) => {
  const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  e.target.value = v;
});
```

- [ ] **Step 2: Manual smoke**

Reload. Click PRIVATE ROOM → modal opens. Switch tabs. Toggle bots checkbox → "bots per faction" row hides. Move slider → "bots per faction" value + capacity readout update. Set min-humans to 51 → CREATE ROOM button greys out. Click CANCEL or backdrop → modal closes.

- [ ] **Step 3: Commit**

```bash
git add prototype/main.js
git commit -m "feat(ui): private-room modal — open/close/tabs/capacity readout"
```

---

### Task 24: Wire JOIN and CREATE submission

**Files:**
- Modify: `prototype/main.js`

- [ ] **Step 1: Add submit handlers**

Append to the same modal section in `prototype/main.js` (immediately after the code-input handler from Task 23):

```js
async function _pmSubmitJoin() {
  const code = _pmEl("pm-code").value.toUpperCase();
  const errEl = _pmEl("pm-join-error");
  errEl.textContent = "";
  if (!/^[A-Z0-9]{6}$/.test(code)) { errEl.textContent = "Code must be 6 letters/numbers."; return; }
  // Validate via /api/room.
  try {
    const r = await fetch(`/api/room?code=${encodeURIComponent(code)}`);
    const j = await r.json();
    if (!j.exists) { errEl.textContent = `Room ${code} not found.`; return; }
  } catch (e) {
    errEl.textContent = "Server unreachable.";
    return;
  }
  const name = document.getElementById("name-input").value.trim() || "Player";
  document.getElementById("name-entry").classList.add("hidden");
  _pmClose();
  _onFirstGesture();
  telemetry.setPlayerName(name);
  telemetry.track("room_joined", { code, isHost: false });
  telemetry.gameStart("private");
  game.startPrivateJoin(name, code);
}

async function _pmSubmitCreate() {
  const cfg = _pmReadCreateConfig();
  const name = document.getElementById("name-input").value.trim() || "Player";
  document.getElementById("name-entry").classList.add("hidden");
  _pmClose();
  _onFirstGesture();
  telemetry.setPlayerName(name);
  telemetry.track("room_joined", { code: "(creating)", isHost: true });
  telemetry.gameStart("private");
  game.startPrivateCreate(name, cfg);
}

_pmEl("pm-join-submit").addEventListener("click", _pmSubmitJoin);
_pmEl("pm-create-submit").addEventListener("click", _pmSubmitCreate);
_pmEl("pm-code").addEventListener("keydown", (e) => { if (e.key === "Enter") _pmSubmitJoin(); });
```

- [ ] **Step 2: Add `startPrivateJoin` / `startPrivateCreate` to `Game`**

Find the `startOnline` method on `Game` in `prototype/main.js` (search for `startOnline`). Right after it, add:

```js
  async startPrivateCreate(name, cfg) {
    this.mode = "online";
    this.mp = new MultiplayerClient();
    // wire mp callbacks the same way startOnline does — copy the exact wiring
    // pattern from this file's existing startOnline implementation. Same
    // hooks: onState, onClaim, onClaimResult, onHeal, onTrailVertex,
    // onKill, onTeleport, onYourCharId, onGridSnapshot,
    // onCumulativeScore, onNameRejected.
    this._wireMpHooks();
    await this.mp.createPrivate(cfg, name);
    _netStatsApplyVisibility();
  }

  async startPrivateJoin(name, code) {
    this.mode = "online";
    this.mp = new MultiplayerClient();
    this._wireMpHooks();
    await this.mp.joinPrivate(code, name);
    _netStatsApplyVisibility();
  }
```

> **Note:** `_wireMpHooks()` should be a single helper that contains the same `mp.onState = …; mp.onClaim = …` etc. assignments used inside the existing `startOnline`. If `Game.startOnline` currently inlines those assignments, refactor them out into a private method `_wireMpHooks()` first so all three entry points share identical wiring. The refactor is mechanical: cut the assignment block out of `startOnline`, paste into `_wireMpHooks`, and call `this._wireMpHooks()` in its place inside `startOnline`.

- [ ] **Step 3: Manual smoke (CREATE path only — overlay/auto-join come next)**

Run `pnpm dev:server`. Open `http://localhost:2567/`, type a name, click PRIVATE ROOM, choose CREATE tab, accept defaults, click CREATE ROOM. Expected: name-entry screen disappears; the host enters a world with no other characters (no bots yet, since nobody else has joined and minHumans isn't met). The character is steerable. The server logs show `room_created` analytics event being inserted.

The "Waiting for players" overlay isn't wired yet — it appears in Task 25. The host *will* see the world but no overlay.

- [ ] **Step 4: Commit**

```bash
git add prototype/main.js
git commit -m "feat(ui): private modal join+create submission flows"
```

---

### Sub-phase 3I: Waiting overlay

### Task 25: Add `#waiting-overlay` DOM/CSS + reactive visibility

**Files:**
- Modify: `prototype/index.html`
- Modify: `prototype/main.js`

- [ ] **Step 1: Add DOM**

In `prototype/index.html`, immediately AFTER the `#private-modal` block from Task 22 and BEFORE `<script src="telemetry.js" …>`, add:

```html
  <!-- Waiting overlay: shown while phase==="waiting" in private rooms. -->
  <div id="waiting-overlay" class="hidden">
    <div id="wo-bg"></div>
    <div id="wo-content">
      <div id="wo-title">Waiting for players</div>
      <div id="wo-count">0 players in / 0 minimum required</div>
      <div id="wo-share">
        <span>Room code: <strong id="wo-code">______</strong></span>
        <span> &mdash; URL: <code id="wo-url">…</code></span>
        <button id="wo-copy">Copy</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Add CSS**

In the `<style>` block, append:

```css
#waiting-overlay { position: fixed; inset: 0; z-index: 40; pointer-events: none; }
#waiting-overlay.hidden { display: none; }
#wo-bg { position: absolute; left: 0; right: 0; top: 0; height: 50vh; background: linear-gradient(to bottom, rgba(0,0,0,0.78), rgba(0,0,0,0.0)); }
#wo-content { position: absolute; top: 8vh; left: 0; right: 0; text-align: center; color: #f4f8ff; font-family: ui-sans-serif, system-ui, sans-serif; }
#wo-title { font-size: 36px; font-weight: 800; letter-spacing: 0.04em; text-shadow: 0 2px 12px rgba(0,0,0,0.6); }
#wo-count { font-size: 22px; margin-top: 10px; opacity: 0.92; }
#wo-share { font-size: 14px; margin-top: 14px; }
#wo-share code { font-family: ui-monospace, monospace; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px; }
#wo-copy { pointer-events: auto; margin-left: 8px; padding: 4px 10px; background: #ffcf2a; color: #1a1f2b; border: none; border-radius: 3px; font-weight: 700; cursor: pointer; }
```

- [ ] **Step 3: Wire reactive visibility in main.js**

Find the place in `prototype/main.js` where the multiplayer client's `onState` callback is wired (in the existing `startOnline` flow or your newly extracted `_wireMpHooks`). Inside that `onState` handler (or as an additional handler), add:

```js
function _updateWaitingOverlay(state) {
  const overlay = document.getElementById("waiting-overlay");
  if (!overlay) return;
  const isWaiting = state.phase === "waiting";
  overlay.classList.toggle("hidden", !isWaiting);
  if (!isWaiting) return;
  document.getElementById("wo-count").textContent =
    `${state.humanCount} players in / ${state.minHumans} minimum required`;
  const code = state.roomCode || "";
  document.getElementById("wo-code").textContent = code;
  const url = `${location.host}/?r=${code}`;
  document.getElementById("wo-url").textContent = url;
}
```

Then call `_updateWaitingOverlay(state)` from inside the `onState` callback (alongside the existing state handling). If you have a centralized `_wireMpHooks`, the call site looks like:

```js
this.mp.onState = (state) => {
  // … existing state-handling code …
  _updateWaitingOverlay(state);
};
```

- [ ] **Step 4: Wire the Copy button**

Append to the modal-and-overlay section in `prototype/main.js`:

```js
document.getElementById("wo-copy").addEventListener("click", () => {
  const url = document.getElementById("wo-url").textContent;
  if (!url) return;
  // navigator.clipboard requires a secure context; fall back to a temp textarea.
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(`https://${url}`).catch(() => {});
  } else {
    const t = document.createElement("textarea");
    t.value = `https://${url}`;
    document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); } catch {}
    t.remove();
  }
  document.getElementById("wo-copy").textContent = "Copied";
  setTimeout(() => { document.getElementById("wo-copy").textContent = "Copy"; }, 1500);
});
```

- [ ] **Step 5: Manual smoke (full)**

Run `pnpm dev:server`. Two browser windows pointing at `http://localhost:2567/`:
- Window A: enter name "Host", click PRIVATE ROOM → CREATE → defaults (5 factions, 6 bots, min 2 humans) → CREATE ROOM. Expected: world appears. Top half of screen shows "Waiting for players · 1 / 2 · Room code: XXXXXX · URL: localhost:2567/?r=XXXXXX". Click Copy → button text flashes "Copied".
- Window B: enter name "B", click PRIVATE ROOM → JOIN → paste code from Window A → JOIN ROOM. Expected: world appears. INSTANTLY in BOTH windows: overlay disappears, bots spawn (5×6 = 30 bots fanned out into 5 factions), match starts.

- [ ] **Step 6: Commit**

```bash
git add prototype/index.html prototype/main.js
git commit -m "feat(ui): waiting overlay with room code, share URL, copy button"
```

---

### Sub-phase 3J: URL auto-join

### Task 26: `?r=CODE` URL parameter auto-join

**Files:**
- Modify: `prototype/main.js`

- [ ] **Step 1: Read `?r=` early and dispatch to `joinPrivate`**

Find the existing `?portal=true` handling block in `prototype/main.js` (search for `arrivedViaPortal`, around line 3504). Just BEFORE that block, add:

```js
// Auto-join a private room when the URL has ?r=CODE. Skip the title screen
// entirely; show it back with an error toast if the room isn't found.
{
  const urlCode = new URLSearchParams(location.search).get("r");
  if (urlCode) {
    const code = urlCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (/^[A-Z0-9]{6}$/.test(code)) {
      const name = (document.getElementById("name-input").value.trim() || "Player").slice(0, 16);
      // Validate first so a bad code doesn't blow up the join flow.
      fetch(`/api/room?code=${encodeURIComponent(code)}`)
        .then(r => r.json())
        .then(j => {
          if (!j.exists) {
            // Show title screen with error.
            const err = document.getElementById("pm-join-error");
            if (err) err.textContent = `Room ${code} not found.`;
            return;
          }
          document.getElementById("name-entry").classList.add("hidden");
          _onFirstGesture();
          telemetry.setPlayerName(name);
          telemetry.track("room_joined", { code, isHost: false });
          telemetry.gameStart("private");
          game.startPrivateJoin(name, code);
        })
        .catch(() => {
          const err = document.getElementById("pm-join-error");
          if (err) err.textContent = `Server unreachable.`;
        });
    }
  }
}
```

- [ ] **Step 2: Manual smoke**

Create a private room (Window A as in Task 25). Copy the URL from the waiting overlay. Open it in Window B (no name typed). Expected: Window B skips the title screen and lands directly in the waiting room (or in the running game if it's already going). The default name "Player" is used since no name was typed.

If the URL contains a code that doesn't exist, the title screen is shown. Try `http://localhost:2567/?r=NOSUCH` → title screen visible.

- [ ] **Step 3: Commit**

```bash
git add prototype/main.js
git commit -m "feat(client): auto-join private room from ?r=CODE URL"
```

---

### Sub-phase 3K: Stats dashboard panel

### Task 27: Add SQL queries + JSON endpoints for private-room metrics

**Files:**
- Modify: `server/src/stats/dashboard.ts`

- [ ] **Step 1: Add prepared statements + routes**

In `server/src/stats/dashboard.ts`, near the existing prepared-statement block (around line 23), add:

```ts
const stmtPrivateRoomsCounts = db.prepare<[number]>(`
  SELECT
    SUM(CASE WHEN event = 'room_created' THEN 1 ELSE 0 END) AS created,
    SUM(CASE WHEN event = 'room_started' THEN 1 ELSE 0 END) AS started,
    SUM(CASE WHEN event = 'room_expired' AND json_extract(detail, '$.started') = 0 THEN 1 ELSE 0 END) AS expired_unstarted
  FROM events
  WHERE event IN ('room_created', 'room_started', 'room_expired') AND ts >= ?
`);

const stmtPrivateRoomsAvgHumans = db.prepare<[number]>(`
  SELECT AVG(json_extract(detail, '$.humansAtStart')) AS avg_humans
  FROM events
  WHERE event = 'room_started' AND ts >= ?
`);

const stmtPrivateRoomsTopConfigs = db.prepare<[number]>(`
  SELECT
    json_extract(detail, '$.factions') AS factions,
    json_extract(detail, '$.botsPerFaction') AS bpf,
    json_extract(detail, '$.minHumans') AS min_h,
    COUNT(*) AS n
  FROM events
  WHERE event = 'room_created' AND ts >= ?
  GROUP BY factions, bpf, min_h
  ORDER BY n DESC
  LIMIT 10
`);

const stmtPrivateRoomsMedianDurationApprox = db.prepare<[number]>(`
  SELECT json_extract(detail, '$.durationMs') AS dur
  FROM events
  WHERE event = 'room_expired' AND json_extract(detail, '$.started') = 1 AND ts >= ?
  ORDER BY dur ASC
`);
```

Then near the existing route definitions, add:

```ts
router.get("/api/private-rooms", (_req: Request, res: Response) => {
  const since = Date.now() - 30 * DAY_MS;
  const counts = stmtPrivateRoomsCounts.get(since) as { created: number; started: number; expired_unstarted: number } | undefined;
  const avg = stmtPrivateRoomsAvgHumans.get(since) as { avg_humans: number | null } | undefined;
  const top = stmtPrivateRoomsTopConfigs.all(since) as Array<{ factions: number; bpf: number; min_h: number; n: number }>;
  const durs = (stmtPrivateRoomsMedianDurationApprox.all(since) as Array<{ dur: number }>).map(r => r.dur);
  const median = durs.length === 0 ? 0 : durs[Math.floor(durs.length / 2)];
  res.json({
    created: counts?.created ?? 0,
    started: counts?.started ?? 0,
    expired_unstarted: counts?.expired_unstarted ?? 0,
    avg_humans_at_start: avg?.avg_humans ?? 0,
    top_configs: top,
    median_duration_ms: median,
  });
});
```

- [ ] **Step 2: Add a "Private Rooms" panel to the dashboard HTML**

In `server/src/stats/dashboard.ts`, find the inline HTML/JS for the dashboard (it's the largest string in the file). Add a new section in the HTML structure that mirrors the existing panels — add a `<section id="private-rooms">` block with a heading, a 4-up summary (Created / Started / Avg Humans / Median Duration), and a small table of top configs. The fetcher script at the bottom should:

```js
fetch("/stats/api/private-rooms").then(r => r.json()).then(j => {
  document.getElementById("pr-created").textContent = j.created;
  document.getElementById("pr-started").textContent = j.started;
  document.getElementById("pr-expired").textContent = j.expired_unstarted;
  document.getElementById("pr-avg-humans").textContent = (j.avg_humans_at_start || 0).toFixed(1);
  document.getElementById("pr-median-dur").textContent = Math.round((j.median_duration_ms || 0) / 60000) + " min";
  const tbody = document.getElementById("pr-top");
  tbody.innerHTML = j.top_configs.map(c => `<tr><td>${c.factions}</td><td>${c.bpf}</td><td>${c.min_h}</td><td>${c.n}</td></tr>`).join("");
});
```

The exact HTML structure should follow whatever pattern the file already uses for other panels — match its h2/section/table style.

- [ ] **Step 3: Typecheck + smoke**

Run: `pnpm --filter template-server typecheck`
Expected: PASS.

Run `pnpm dev:server`. Set `STATS_PASSWORD=test` in env and visit `http://localhost:2567/stats` (basic auth: any user, password `test`). Expected: dashboard renders. After creating one private room (run through the Task 25 flow), the Private Rooms panel shows `Created: 1` (or higher).

```bash
curl -u "u:test" 'http://localhost:2567/stats/api/private-rooms'
# expected: {"created":1,...}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/stats/dashboard.ts
git commit -m "feat(stats): private-rooms panel with counts, avg humans, top configs"
```

---

### Sub-phase 3L: Final integration + manual smoke

### Task 28: End-to-end smoke (multi-window) + final commit

**Files:** none (validation only).

- [ ] **Step 1: Restart server with a clean state**

Stop any running server. Run `pnpm dev:server`.

- [ ] **Step 2: Multi-window smoke**

Open four browser windows to `http://localhost:2567/`:

1. Window A: type "Host". PRIVATE ROOM → CREATE → factions 4, bots ON, bots-per-faction 3, min-humans 3. CREATE ROOM. Expected: world visible. Overlay shows "1 / 3", code visible, share URL visible. Bots NOT yet spawned.
2. Window B: copy the URL from Window A's overlay. Paste into Window B's address bar. Open. Expected: skips title screen; world visible; both A and B overlays read "2 / 3".
3. Window C: type "C". PRIVATE ROOM → JOIN → paste code → JOIN ROOM. Expected: world visible; ALL THREE overlays disappear; 4×3=12 bots spawn; match clock starts.
4. Window D: open the URL again. Expected: late-joiner drops directly into the running match (no overlay) and gets assigned to a faction.

- [ ] **Step 3: Public room still works**

In a fifth window: ONLINE → enter name → expected: the original public game room works exactly as before. 5 factions, 30 chars total. Net-stats HUD togglable with G.

- [ ] **Step 4: Encirclement still works**

Hop into SOLO. Reproduce the original bug case: bot's faction has only one region, bot is trail-running, you encircle the region. Expected: the region is captured and the bot dies (trail-runner with zero faction cells).

- [ ] **Step 5: Final commit (no code changes — just a reminder commit)**

If anything was tweaked during smoke, commit it:

```bash
git status
# if there are changes:
git add -A
git commit -m "chore: post-smoke fixes"
```

---

## Self-Review Checklist (run before merging)

- [ ] Did all six connectivity tests pass? `pnpm test prototype/sim/__tests__/connectivity.test.js`
- [ ] Did the existing sim tests pass? `pnpm test prototype/sim/`
- [ ] Did the room-code-registry test pass? `pnpm test server/src/__tests__/roomCodeRegistry.test.ts`
- [ ] Did the PrivateGameRoom integration test pass? `pnpm test server/src/__tests__/PrivateGameRoom.test.ts`
- [ ] Server typecheck clean? `pnpm --filter template-server typecheck`
- [ ] Public room behavior unchanged in browser smoke?
- [ ] Net-stats HUD togglable with G in online mode, hidden in solo, persisted across reloads?
- [ ] Private rooms: create, join, waiting overlay, late-joiner, code-not-found error all behave as designed?
- [ ] `/stats/api/private-rooms` returns plausible numbers after a few sessions?

---

## What's intentionally NOT in this plan (per spec §"Out of scope")

- Spectator mode for the host
- Reconnect/resume tokens for private rooms
- Anti-abuse rate-limiting on room creation
- Custom map/tuning per private room beyond factions/bots/min-humans
- Public listing of private rooms

If these come up post-merge, they get their own spec → plan cycle.
