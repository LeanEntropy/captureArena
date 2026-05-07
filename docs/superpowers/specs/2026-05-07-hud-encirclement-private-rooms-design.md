# Design — Net-stats HUD, encirclement death, and private rooms

**Date:** 2026-05-07
**Author:** brainstorming session w/ Claude (Opus 4.7)
**Status:** approved by user, ready for implementation plan

## Context

This document specs three independent changes to Land Capture (`prototype/` static client + Colyseus server):

1. A togglable FPS + ping HUD shown only in multiplayer.
2. A bug fix: trail-running players whose home territory gets encircled should now die, and the encircled region should be captured.
3. A "Private Room" feature with shareable codes, configurable factions/bots, and a "waiting for players" lobby.

All three share the same release; the spec is unified so an implementation plan can sequence them and share helper work (e.g. the ping/pong messages added in §1 are reused by analytics in §3).

---

## §1 — Net-stats HUD (FPS + Ping)

### 1.1 User-visible behavior

- New single-line HUD element in the **bottom-right** of the viewport, sitting **above** the Vibe Jam widget.
- Format: `FPS 58 · 42ms` — monospace, semi-transparent dark background.
- Visible **only** when `mode === "online"`.
- Toggled with the **G** key.
- **Off by default** on first multiplayer entry. State persisted in `localStorage` under key `netStatsVisible` (`"1"` or absent).

### 1.2 DOM & CSS

- Element id: `#net-stats`. Inserted into `#ui` in `prototype/index.html`.
- Positioned `position: fixed; bottom: 60px; right: 16px; z-index: 12;` — same layer as `#settings-toggle-hud`. The 60px offset clears the Vibe Jam widget.
- Hidden via `display: none` (not `visibility`) so it occupies no layout when off.

### 1.3 FPS measurement

- Hook into the existing render loop at `prototype/main.js:3276` (`function loop(now)`).
- Maintain a 30-frame ring buffer of `dt` values; FPS = `30 / sum(buffer)`.
- DOM is updated **4×/sec** (every ~250ms) — the ring buffer keeps updating every frame, but we only re-render the element on a separate timer to avoid layout cost.

### 1.4 Ping/RTT

Colyseus 0.16 has no native RTT. Implement a manual ping/pong:

- **Client** (`prototype/multiplayer.js`):
  - On `onJoin`, start a `setInterval(2000)` that calls `room.send("ping", performance.now())`.
  - `room.onMessage("pong", (t) => …)` computes `RTT = performance.now() - t` and pushes into a rolling 5-sample buffer; reported value is the **median** (resistant to single-frame stalls).
  - Cleared on `onLeave`.
- **Server** (`server/src/rooms/GameRoom.ts`):
  - Add `this.onMessage("ping", (client, t) => client.send("pong", t))` in `onCreate`.
  - One line; no schema change.

The same handler must also be registered in `PrivateGameRoom` (§3). Implementation choice: extract a tiny `registerPongHandler(room)` helper used by both rooms, or have `PrivateGameRoom` extend `GameRoom`. The spec doesn't mandate one; the plan picks.

### 1.5 Keybinding

- Add `"g"` to the existing keydown listener at `prototype/main.js:1299` (same pattern as `"c"`, `"v"`, `"f"`).
- Handler:
  1. Toggle `localStorage.netStatsVisible` between `"1"` and absent.
  2. Update `#net-stats` `display` style.
  3. No-op if `mode !== "online"` (G does nothing in solo).

### 1.6 Files touched

- `prototype/index.html` — add `#net-stats` element + CSS.
- `prototype/main.js` — keybind, FPS loop hook, DOM update timer.
- `prototype/multiplayer.js` — ping interval, pong handler, expose `getRTT()` getter.
- `server/src/rooms/GameRoom.ts` — pong echo handler.

---

## §2 — Encirclement death

### 2.1 The rule

After every territory claim, for each faction whose cell count changed during the claim, find connected components (4-connectivity) of that faction's territory.

A component is **alive** iff at least one **living, non-trail-running** player of that faction has body position on a cell inside it.

Dead components — those with no resident player — are **converted to the claimer's faction**.

After the conversion pass, any **trail-running** player whose faction now has `cellCounts[F] === 0` is killed via the existing `_killCharacter()` path with death-cause `"isolated"`.

This rule replaces no existing rule — death by trail-cut and self-trail-collision are unchanged.

### 2.2 Why this rule (justification)

The user explicitly chose this over "largest-region-survives":
- A faction can be an archipelago as long as someone is home in each piece.
- The bug being fixed is specifically: trail-runner's home gets enclosed, no resident is left, so the region is empty and falls to the encircler. The trail-runner then dies because they have nowhere to return.
- A non-trail player physically standing in a region is enough to keep that region alive — even if the rest of the faction is destroyed. (Camping = anchoring.)

### 2.3 Implementation

- **New file:** `prototype/sim/connectivity.js` (~80 lines).
  - Exports `enforceConnectivity(grid, gridSize, affectedFactions, characters, claimerFactionId, cellCounts) → { capturedCells, killedCharacters }`.
  - Single visited `Uint8Array` reused across calls (module-scope, lazy-allocated to grid size).
  - Standard iterative BFS for component labeling. Re-uses a queue array.
- **Integration point:** `prototype/sim/Simulation.js` claim function (~line 800, just before the "claim done" event emits). Track which faction ids had cells modified during the claim; pass them in.
- The `affectedFactions` set is computed by snapshotting `cellCounts` before the existing claim loop, then diffing after; any faction whose count changed is in the set. Always includes the claimer.

#### 2.3.1 Component labeling

For each faction `F` in `affectedFactions`:
1. Reset visited buffer (`fill(0)`).
2. For each cell `i` where `grid[i] === F` and not visited: BFS, label all reachable cells with a component id, count cells.
3. Build `componentCells: Map<componentId, number[]>` and `componentResidents: Map<componentId, boolean>`.
4. **Single pass over `characters`:** for each living, non-trail char of faction `F`, look up `componentLabelOf(charCellIndex)` and set `componentResidents[id] = true`.
5. For each component with `!componentResidents[id]`: convert all its cells to `claimerFactionId`, update `cellCounts` deltas.

#### 2.3.2 Kill pass

After all faction conversions are done, iterate `characters` once more:
- If char is **trail-running** (has an active trail) AND `cellCounts[char.factionId] === 0` → `_killCharacter(char, "isolated")`.

The kill pass runs *once* after all conversions; faction X's territory might be wiped by claimer's claim removing X's last cell either via the original claim or via the connectivity sweep. Either way the trail-runner's faction has zero cells, so they die.

### 2.4 Performance

- Worst-case faction has up to ~1M cells (1024² grid). BFS over typed arrays is ~5–15ms in modern V8.
- Affected factions per claim is typically 1–3 (claimer + adjacent enemies).
- Claims are sparse: a few per second across all players in busy moments.
- Total claim work currently: ~1–3ms. New work: ~5–15ms × ≤3 factions = up to ~45ms in extreme cases.
- This fits inside the 33ms server tick budget for the *normal* case (1–2 factions, smaller per-faction cell count). If profiling shows hotness on large-grid claims, optimize to "BFS only the bounding box of cells modified by the claim, plus their connected neighbors" — deferred until measured.

### 2.5 Edge cases

| Scenario | Outcome |
|---|---|
| Faction split into 2 pieces, residents in both | Both survive |
| Faction split into 2 pieces, resident in only one | Other piece → claimer |
| Faction split, all residents trail-running | All pieces empty → all → claimer; all that faction's trail-runners die |
| Claimer creates a disconnected fragment of *their own* faction | Fragment has the claimer in it → survives |
| Player respawning (dead, no body) at moment of check | Doesn't count as resident |
| Trail-runner's faction had cells captured directly by the claim (no connectivity work needed) | Still triggers the kill pass — `cellCounts === 0` is the trigger, not "this specific cell was their home" |

### 2.6 Tests

In `prototype/sim/__tests__/connectivity.test.js` (or extend an existing file):

1. Two-half split, residents in both → both survive, no captures.
2. Two-half split, resident in only one → other half captured, no deaths (no trail-runners).
3. Encircle a trail-runner whose faction's home is the only region → captured, trail-runner dies.
4. Two regions, both unoccupied (all trail-running) → both captured, all faction's trail-runners die.
5. Self-disconnect: claimer accidentally leaves their own fragment → fragment retains claimer faction (claimer is a resident).
6. Mixed: faction has 3 regions; one with resident, two without → the two captured, faction shrinks but no trail-runners die because `cellCounts > 0`.

### 2.7 Files touched

- `prototype/sim/connectivity.js` — **new**.
- `prototype/sim/Simulation.js` — integration call at end of claim.
- `prototype/sim/__tests__/connectivity.test.js` — **new**.
- (Server side: nothing — the simulation is shared via the `copy-sim.mjs` build step.)

---

## §3 — Private Rooms

### 3.1 User flow

1. Title screen has a third button: **PRIVATE ROOM** (alongside SOLO / ONLINE).
2. Click → modal with two tabs:
   - **Join with code**: 6-char code input, JOIN button.
   - **Create new**: factions radio (3/4/5), bots toggle, bots-per-faction slider (1–9), min-humans number (1–10), live capacity readout, CREATE ROOM button.
3. **Joining**: client calls `/api/room?code=…` to validate; on success, joins; on failure, shows inline error.
4. **Creating**: client calls `client.create("private", config)`. Server generates a code, registers the room, returns; client now sees the world alone with the **waiting overlay**.
5. Host can play (move, draw trails) immediately; bots are not yet spawned.
6. As humans join via the code, `humanCount` increments. When `humanCount >= minHumans`, server transitions `phase: "waiting" → "playing"`, spawns bots, starts the match clock. Overlay disappears for everyone.
7. Late-joiners after start drop straight into the running match (no waiting screen).
8. URL `?r=CODE` auto-joins straight into the room (skips title screen).

### 3.2 Server architecture

#### 3.2.1 New room type

**File:** `server/src/rooms/PrivateGameRoom.ts` (~150 lines).

Extends or composes the existing `GameRoom`. Differences:

- `onCreate(options)`:
  - Validate `options`: `{ factions: 3|4|5, bots: boolean, botsPerFaction: 1..9, minHumans: 1..10, code?: string }`.
  - Compute total capacity: `humans + factions * (bots ? botsPerFaction : 0) <= 50`. Reject if violated.
  - If no `code` passed, generate one and register in `roomCodeRegistry`.
  - Initialize sim with `numFactions` and **no bots yet** (pass `botsPerFaction: 0` to sim, then spawn them at start time).
  - Set `state.phase = "waiting"`, `state.roomCode = code`, `state.minHumans = minHumans`.
  - Store `botsPerFactionAtStart = botsPerFaction` (and `factions`) on the room instance for use at `startMatch()`.
  - Emit analytics: `room_created` with config.
- `onAuth(client, options)`:
  - For joins (not creates), Colyseus will attempt to match by `code` filter — if no room exists, Colyseus rejects automatically. We don't need to check explicitly.
- `onJoin(client)`:
  - Increment `state.humanCount`.
  - Cancel any pending TTL timer.
  - If `phase === "waiting"` and `humanCount >= minHumans`: call `startMatch()`.
  - Emit analytics: `room_joined`.
- `startMatch()`:
  - Spawn `factions × botsPerFactionAtStart` bots into the sim (using existing bot-spawn calls, just looped per-faction).
  - Set `state.phase = "playing"`.
  - Start the existing 15-min match clock.
  - Emit analytics: `room_started` with `{ humansAtStart, totalBots, config }`.
- `onLeave(client)`:
  - Decrement `state.humanCount`.
  - If `humanCount === 0`: schedule a 5-minute TTL timer that calls `this.disconnect()`.
  - Note: per §3.1, the game **continues running** even if humans drop below `minHumans` mid-match. The TTL only fires on truly-empty rooms.
- `onDispose()`:
  - `roomCodeRegistry.release(code)`.
  - Emit analytics: `room_expired` with `{ code, durationMs, startedFlag }`.

#### 3.2.2 Room code registry

**File:** `server/src/rooms/roomCodeRegistry.ts` (~40 lines).

- In-memory `Map<string, string>` (code → roomId). Single Node process per the existing architecture.
- `generateCode(): string` — 6 chars uniform-random from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (omits `0/O/1/I/L`). Retry on collision (max 3 attempts; with 32^6 = 1B codes, collisions are negligible).
- `register(code, roomId): boolean` — returns `false` if collision (caller retries).
- `release(code): void`.
- `lookup(code): string | null`.

#### 3.2.3 HTTP validate endpoint

**Modify `server/src/index.ts`:** add

```
GET /api/room?code=XYZ
→ 200 { exists: true } | 200 { exists: false }
```

Used by the join modal to give the user inline feedback before triggering a Colyseus join attempt. Pure registry lookup — no auth, no rate limit (each request is O(1)).

#### 3.2.4 Sim parameterization

**Modify `prototype/sim/Simulation.js` and `prototype/sim/faction.js`:**

- `Simulation` constructor: `constructor({ seed = 1, numFactions = 5, botsPerFaction = 6 } = {})`. Defaults match current behavior, so the public room is unaffected.
- `faction.js`: `initFactions(grid, gridSize, numFactions)` — current code hardcodes 5; turn into a parameter. Slice angles are `2π / numFactions`.
- Spawn-point computation already uses faction id; works for any count.

### 3.3 Schema additions

**Modify `server/src/schema/GameState.ts`:**

```ts
@type("string") phase: string = "playing"; // existing → also "waiting"
@type("string") roomCode: string = "";     // new
@type("number") minHumans: number = 0;     // new (0 in public room)
@type("number") humanCount: number = 0;    // new (live count)
```

`humanCount` is updated in `onJoin` / `onLeave` of both rooms (public room can update it too — useful for general telemetry, but `minHumans=0` means the waiting overlay never shows).

### 3.4 Client UI

#### 3.4.1 Title screen

**Modify `prototype/index.html` near line 611:**

```html
<div id="ts-button-row">
  <button id="solo-btn">SOLO</button>
  <button id="online-btn">ONLINE</button>
  <button id="private-btn">PRIVATE ROOM</button>
</div>
```

Wire `#private-btn` in `prototype/main.js:3471–3489` (same area as the existing buttons) to open the private modal.

#### 3.4.2 Private room modal

New DOM in `prototype/index.html`: `#private-modal` with two tabs.

- **Join tab:** code input (auto-uppercases, 6 char limit, monospace), JOIN button. On submit: `fetch('/api/room?code=…')` → if exists, call `multiplayer.joinPrivate(code)`; else inline error.
- **Create tab:**
  - Factions radio group (3 / 4 / 5; default 5).
  - Bots checkbox (default on).
  - Bots-per-faction slider (1–9; default 6; hidden when bots off).
  - Min-humans input (1–10; default 2).
  - Live readout: `Capacity: X human slots + Y bot slots = Z / 50` — recomputes on any change. CREATE ROOM disabled if Z > 50 or min-humans > capacity.
  - CREATE ROOM button → `multiplayer.createPrivate({factions, bots, botsPerFaction, minHumans})`.

CSS reuses the existing modal styling pattern (settings popup at `prototype/main.js:3410`).

#### 3.4.3 URL auto-join

In `prototype/main.js`, near where `portals.js` is wired (it already uses `URLSearchParams`):

```js
const urlCode = new URLSearchParams(location.search).get('r');
if (urlCode) {
  hideTitleScreen();
  multiplayer.joinPrivate(urlCode.toUpperCase()).catch(err => {
    showTitleScreen({ error: `Room ${urlCode} not found` });
  });
}
```

Skip the title screen entirely on auto-join; show it with an error toast on failure.

#### 3.4.4 Multiplayer client

**Modify `prototype/multiplayer.js`:**

- New methods:
  - `joinPrivate(code)` → `await client.join("private", { code })`.
  - `createPrivate(config)` → `await client.create("private", config)`.
- Add ping/pong loop here (also serves §1).

### 3.5 Waiting overlay

New DOM `#waiting-overlay` injected into `#ui`:

- Covers the top half of the screen with a semi-transparent dark backdrop.
- Three lines:
  1. `Waiting for players` (~36px, bold).
  2. `<humanCount> players in / <minHumans> minimum required` (~22px). Bound to schema fields.
  3. `Room code: FG58R2 — URL: landcapture.up.railway.app/?r=FG58R2` (regular weight, ~16px). Followed by a small **Copy** button that copies the URL to clipboard.
- Visibility: shown iff `state.phase === "waiting"`. Reactive — disappears the instant the schema flips.
- `pointer-events: none` on backdrop; `pointer-events: auto` on the Copy button only. Host can still steer the character behind the overlay.
- The hostname for the URL: read from `window.location.host` — works regardless of deployment (localhost dev shows `localhost:2567/?r=…`; production shows `landcapture.up.railway.app/?r=…`).

### 3.6 Analytics

The dashboard at `/stats` (server/src/stats/) gets four new event types ingested via the existing `/track` pipeline (`prototype/telemetry.js`):

| Event | Source | Payload |
|---|---|---|
| `room_created` | server (`onCreate` after validation) | `{ factions, bots, botsPerFaction, minHumans, code }` |
| `room_joined` | client (each joining client emits) | `{ code, isHost }` |
| `room_started` | server (`startMatch`) | `{ code, humansAtStart, totalBots, config }` |
| `room_expired` | server (`onDispose`) | `{ code, durationMs, started: bool }` |

All four are written via the same SQLite ingest pipeline `prototype/telemetry.js` already targets — server-sourced events go through the new `recordEvent(name, payload)` helper in `server/src/index.ts` (§3.2.3), client-sourced events use the existing `/track` beacon.

**Server-side track injection:** the server already serves `/track` for client beacons. Add an internal helper `recordEvent(name, payload)` that calls the same SQLite ingest path used by HTTP. Use it in `startMatch()` and `onDispose()`.

**Dashboard additions** (`server/src/stats/`):
- New "Private Rooms" panel showing:
  - Rooms created (last 24h / 7d).
  - Rooms started vs. expired-empty (conversion %).
  - Average `humansAtStart`.
  - Top configurations (e.g. "5 factions, 6 bots, 2 humans" → 14 rooms).
  - Median room duration.
- Implementation: SQL queries over the existing events table; render with the existing Chart.js setup.

### 3.7 Files touched

| File | Action |
|---|---|
| `server/src/rooms/PrivateGameRoom.ts` | **new** |
| `server/src/rooms/roomCodeRegistry.ts` | **new** |
| `server/src/rooms/GameRoom.ts` | small: add `pong` handler, `humanCount` tracking |
| `server/src/index.ts` | register `"private"` room, add `/api/room` endpoint, register internal `recordEvent` |
| `server/src/schema/GameState.ts` | add `roomCode`, `minHumans`, `humanCount`; widen `phase` |
| `server/src/stats/*` | new "Private Rooms" panel + queries |
| `prototype/sim/Simulation.js` | accept `numFactions`, `botsPerFaction` in constructor |
| `prototype/sim/faction.js` | parameterize `numFactions` |
| `prototype/index.html` | add `#private-btn`, `#private-modal`, `#waiting-overlay`, `#net-stats` |
| `prototype/main.js` | wire private button, modal, URL auto-join, G key, FPS loop |
| `prototype/multiplayer.js` | `joinPrivate`, `createPrivate`, ping loop |
| `prototype/telemetry.js` | helper for the new event names (optional — can pass them as generic events) |
| `prototype/sim/connectivity.js` | **new** (§2) |
| `prototype/sim/__tests__/connectivity.test.js` | **new** (§2) |

### 3.8 Tests

- **Unit:** `roomCodeRegistry` — collision retry, release frees the code, lookup returns null after release.
- **Server integration (Vitest + colyseus testing-utils if available, otherwise direct):**
  - Create private room with `minHumans=2`, no bots → join 1 client, verify `phase === "waiting"` and bot count = 0. Join 2nd client → verify `phase === "playing"` and bots spawned.
  - Capacity validation: try to create a room that would exceed 50 → server rejects.
  - TTL: empty room for 5min → disposes, code released.
- **Client smoke (Playwright):** load `?r=NOSUCH` → title screen with error. Load `?r=<valid>` → waiting overlay visible.

---

## Out of scope

- Spectator mode for the host before the match starts (host plays solo).
- Reconnect/resume tokens for private rooms (Colyseus default reconnect behavior is sufficient).
- Anti-abuse for room-creation flooding (no rate limiting) — relies on the "single hobbyist instance" deployment.
- Custom map/tuning per private room (only factions / bots / min-humans are configurable).
- Public listing of private rooms (rooms are discoverable only via shared code).
- Ping display in solo mode (only multiplayer).
- A spectator-only mode for the host.

## Sequencing recommendation for the implementation plan

A natural build order, since later pieces depend on earlier ones:

1. **§1 — Net-stats HUD.** Adds the ping/pong infrastructure used by analytics in §3 and is the smallest piece — good warm-up.
2. **§2 — Encirclement death.** Pure-sim change with strong test coverage; no UI dependency. Can land independently.
3. **§3 — Private rooms.** The largest piece; pulls in the schema additions, two new server files, three new client UI surfaces, and the analytics dashboard panel.
