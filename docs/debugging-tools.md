# Debugging Tools — Territory War

Quick reference for profiling and debugging this Three.js + Colyseus game.

---

## The 3 tools you'll use 90% of the time

| Problem | Tool |
|---|---|
| "Frame rate is low / game feels janky" | **stats.js overlay** (press F in-game) |
| "My JS is slow — which function?" | **Chrome DevTools → Performance tab** |
| "Server-side weirdness / room state looks wrong" | **Colyseus Monitor** at `http://localhost:2567/colyseus` |

---

## 1. Frame-rate / GPU profiling (Three.js client)

### stats.js overlay — live FPS/MS/MB panel

**When to use:** First thing to check when the game feels slow. Zero cost when hidden.

**How to use:** Already integrated. Press **F** in-game to toggle the panel on/off.
The panel cycles between three modes on click: FPS → MS (frame time) → MB (JS heap).

**What to look for:**
- FPS dropping below 60 → something is spiking each frame
- MS spiking unevenly → JS stutter (check Performance tab next)
- MB climbing over time → memory leak (check Memory tab)

---

### Three.js `renderer.info` — built-in render stats

**When to use:** The GPU side looks heavy — too many draw calls, geometries not being disposed.

**How to access:** Already available. From DevTools console while game is running:

```js
game.renderer.info
// → { render: { calls, triangles, points, lines }, memory: { geometries, textures }, programs }
```

**What to look for:** `render.calls` should be low (under 30 for this scene). `memory.geometries` or `memory.textures` growing over time = disposal leak.

---

### Spector.js — WebGL frame capture

**When to use:** A specific frame looks wrong or a draw call is expensive and you need to see every WebGL command.

**How to install:** [Chrome extension](https://chrome.google.com/webstore/detail/spectorjs/denbgaamihkadbghdceggmchnflmhpmk). Click the extension icon, then "Capture frame". No code changes needed.

**What to look for:** Redundant state changes, unintended texture uploads (`texImage2D` each frame = a bug), expensive shader programs.

---

### Chrome DevTools → Performance tab — JS flamegraph

**When to use:** stats.js shows MS spikes but you don't know which function. This is the most powerful JS profiler you have.

**How to use:**
1. Open DevTools → Performance
2. Click Record, play the game for 5–10 seconds, stop recording
3. Look at the flame chart — find tall stacks in the "Main" thread

**What to look for:** `loop()` → `game.tick()` → `BotAI` / territory painting tend to be the hottest paths in this game. Any function taking > 2ms per frame is a candidate.

---

### `chrome://gpu` — GPU info

**When to use:** Checking if hardware acceleration is active (affects Three.js heavily).

**How to use:** Paste `chrome://gpu` in the address bar. Look for "Hardware accelerated" next to WebGL. If it says "Software only", Three.js will be slow regardless of your code.

---

## 2. Memory profiling (client)

### Chrome DevTools → Memory tab — heap snapshots

**When to use:** MB panel in stats.js is climbing over time, or the game slows down after long play sessions.

**How to use:**
1. DevTools → Memory → Heap snapshot
2. Play for a few minutes
3. Take another snapshot, select "Comparison" view
4. Look for Three.js objects (`THREE.BufferGeometry`, `THREE.Texture`, `THREE.Mesh`) with positive delta

**Common cause in Three.js games:** Forgetting to call `geometry.dispose()` / `material.dispose()` / `texture.dispose()` when removing objects from the scene.

---

### `performance.memory` API — scriptable heap check

**When to use:** Quick sanity check from DevTools console (no UI needed).

```js
// Paste in DevTools console
const m = performance.memory;
console.log(`Heap: ${(m.usedJSHeapSize/1e6).toFixed(1)} MB / ${(m.jsHeapSizeLimit/1e6).toFixed(0)} MB limit`);
```

Note: only available in Chrome. Values update lazily (not per-frame).

---

## 3. Network / Colyseus debugging

### Colyseus Monitor — live room inspector

**When to use:** Investigating server-side issues — wrong faction assignments, room state not matching client, tick rate problems.

**How to access:** Only available in development (`NODE_ENV !== "production"`).
Start the dev server and open: `http://localhost:2567/colyseus`

Features:
- Lists all active rooms with client counts
- Click a room → see the full serialized room state
- See connected client IDs and session info
- Kick clients, inspect messages (depending on monitor version)

Already wired into `server/src/index.ts`. Does not run in production (Railway).

---

### Browser DevTools → Network tab → WS filter

**When to use:** Verifying that the client and server are actually exchanging the right messages — claim events, input messages, state patches.

**How to use:**
1. DevTools → Network → filter by "WS"
2. Click the WebSocket connection
3. "Messages" tab shows every frame sent/received in real time

**What to look for:** Message frequency should match 20 Hz. Large binary payloads (> a few KB per tick) may indicate state sync is sending too much.

---

### Console logging with `dlog()`

**When to use:** Already integrated throughout main.js. Fires on game events (claims, kills, respawns, grid init). Kept in memory only — no per-event localStorage writes.

```js
// From DevTools console, dump the current log to localStorage for inspection:
dumpDebug()   // returns entry count

// Then read it:
JSON.parse(localStorage.getItem("captureArena_debug"))
```

**Caution:** `dlog()` calls `console.log` on every event, which adds overhead under heavy gameplay. If profiling hot paths, disable browser console logging or filter it.

---

## 4. Three.js scene debugging

### Three.js Inspector — Chrome extension

**When to use:** You want to explore the live scene graph, see object hierarchies, or isolate which mesh is causing a visual bug.

**How to install:** [Three.js Developer Tools](https://chrome.google.com/webstore/detail/threejs-developer-tools/ebpneggegjmngleioiofgneidgaorhma) (Chrome extension). No code changes.

**What you get:** Panel showing the full scene graph. Click any object to highlight it in the viewport. Edit material properties live.

---

### Built-in visual helpers (add temporarily to the scene)

```js
// From DevTools console while game is running:

// Show world origin axes (red=X, green=Y, blue=Z)
game.scene.add(new THREE.AxesHelper(10));

// Show a grid at Y=0
game.scene.add(new THREE.GridHelper(50, 50));

// Show bounding box of any mesh
const box = new THREE.BoxHelper(game.characters[0].mesh, 0xffff00);
game.scene.add(box);
```

No install needed — these are part of Three.js core. Remove them after debugging.

---

## 5. JavaScript profiling

### `PerformanceObserver` — programmatic task timing

**When to use:** You want to measure a specific code path without the overhead of recording a full DevTools profile.

```js
// Paste in DevTools console to watch for long tasks (> 50 ms)
const obs = new PerformanceObserver(list => {
  list.getEntries().forEach(e => console.warn(`Long task: ${e.duration.toFixed(1)}ms`));
});
obs.observe({ type: "longtask", buffered: true });
```

Also useful for measuring specific operations:

```js
performance.mark("tick-start");
// ... code ...
performance.mark("tick-end");
performance.measure("tick", "tick-start", "tick-end");
performance.getEntriesByName("tick").at(-1).duration;
```

---

## 6. Project-specific helpers

| Helper | How |
|---|---|
| `window.game` | Direct access to the `Game` instance from DevTools console |
| `game.renderer.info` | Three.js render stats (calls, triangles, memory) |
| `dumpDebug()` | Flush the in-memory `dlog()` ring buffer to localStorage |
| `game.sim` | Direct access to the `Simulation` instance |
| **C key** | Toggle territory texture filter (nearest vs. linear) — shows grid cell boundaries |
| **V key** | Toggle territory mesh visibility |
| **F key** | Toggle stats.js FPS/MS/MB overlay |

---

## Key bindings summary

| Key | Effect |
|---|---|
| F | stats.js overlay on/off |
| C | Territory grid debug filter |
| V | Territory mesh visibility |
