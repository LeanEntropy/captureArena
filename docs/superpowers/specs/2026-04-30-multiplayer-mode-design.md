# Multiplayer Mode Design (Railway-hosted)

## Context

The current game (`prototype/`) is single-player only — a vanilla-JS Three.js prototype with all simulation and rendering tightly coupled in `prototype/main.js`. We want a multiplayer mode hostable on Railway, while keeping single-player working.

A parallel Colyseus monorepo (`server/`, `client/`, `packages/shared`, `packages/simulation`) was scaffolded earlier but never finished — `server/src/rooms/GameRoom.ts` is a stub. The actual working game logic lives entirely in `prototype/main.js`. The multiplayer build will reuse the Colyseus server scaffolding but keep the prototype as the active client codebase (rather than migrating to the unfinished `client/`).

## Design Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Matchmaking | Single shared room. Players drop in to running game, or one auto-starts. |
| Match lifecycle | 15-min rounds. 30-sec intermission, then next round auto-starts. |
| Single-player | Preserved. Mode picker on title screen. |
| Private rooms | Out of scope for v1. Architecture must not preclude adding later (Colyseus rooms = trivial v2). |
| Bots vs humans | Always 30 entities (5 factions × 6 chars). Humans take over bot slots; characters revert to bot when human leaves. |
| Faction assignment | Auto-assign joining player to weakest faction (fewest humans, tiebreak lowest territory %). |
| Disconnection | 10-sec reconnect grace via Colyseus `allowReconnection`. Score persists per browser via `playerToken` cookie. |

## Architecture

**Stack:** Colyseus 0.16 (server) + Three.js prototype (client) + Express static serving + Railway deploy.

**Code reuse:** Extract simulation logic from `prototype/main.js` into a pure-JS `Simulation` class (no THREE.js deps). The same class runs server-side (Colyseus room ticks it) and client-side (single-player mode ticks it locally). The renderer in `main.js` becomes a thin layer that reads from a `simState` source — either local Simulation or remote Colyseus state.

**Tick rate:** 20 Hz simulation (server). 60 Hz render (client). 20 Hz input upload (client → server).

**State sync model:**
- **Per-tick state** (positions, factions, match phase) → Colyseus Schema delta encoding.
- **Territory grid** → broadcast `TerritoryClaimEvent` (charId + trail polygon) on each claim. Client runs identical `_claim()` logic on its local grid copy. Periodic gzipped grid hash for resync detection. New joiner gets one full gzipped grid snapshot (~30-80KB).
- **Trails** → per-vertex events (compact). Cleared by claim/death events.
- **Input** → `InputMessage { dirX, dirZ }` at 20 Hz. Server-authoritative. No client prediction in v1.

## File Structure

```
prototype/
  main.js              # Game class — refactored to renderer + input only
  sim/                 # NEW — pure-JS, no THREE.js imports
    Simulation.js      # Owns grid, characters, tick(), claim(), heal()
    Character.js       # Plain data: pos, dir, alive, isHuman, etc.
    BotAI.js           # Server-side bot logic (port from main.js _planBotLoop)
    faction.js         # Moved from prototype/faction.js
    scoring.js         # Moved from prototype/scoring.js
    match.js           # Moved from prototype/match.js
    constants.js       # Shared tuning constants (extract from main.js)
  multiplayer.js       # NEW — Colyseus client + state-to-render bridge
  ui.js                # Unchanged (DOM HUD)
  index.html           # Add Solo/Online mode picker

server/
  package.json         # Already present
  tsconfig.json        # Already present
  src/
    index.ts           # Already present — add Express static for prototype/
    rooms/GameRoom.ts  # FILL IN — wraps Simulation, runs tick loop
    schema/GameState.ts # REPLACE — match new schema
    sim/               # Copied from prototype/sim/ by prebuild script

Dockerfile             # NEW
railway.toml           # NEW
.dockerignore          # NEW
```

**Why copy `prototype/sim/` into `server/src/sim/` at build time:** the prototype uses ES modules with no build step; the server uses TypeScript via tsx. A `prebuild` npm script (`cp -r ../prototype/sim ./src/sim`) runs before `tsc` and before `tsx watch` in dev. This avoids inventing a third workspace package and is Docker-build-safe. The simulation files are pure JS (no TS), and tsx/tsc allow JS imports via `allowJs: true` in `tsconfig.json`.

## Network Schemas

```ts
// Colyseus schema (sync'd state)
GameStateSchema {
  phase: string                       // "playing" | "intermission" | "ended"
  timeRemaining: number               // seconds, decreases during playing
  intermissionRemaining: number       // 0-30 between rounds
  factions: ArraySchema<FactionSchema>      // 5 entries
  characters: ArraySchema<CharacterSchema>  // 30 entries (stable indices)
}

FactionSchema {
  id: number; territoryPct: number; alive: boolean; endangered: boolean
}

CharacterSchema {
  id: number; factionId: number; name: string
  isHuman: boolean
  posX: number; posZ: number
  dirX: number; dirZ: number
  alive: boolean
  invulnTimer: number
  killCount: number
  score: number
}

// One-shot messages (not in schema, sent via room.broadcast / client.send)
TerritoryClaimEvent { charId, trailPoints: [x,z,...], factionId }
HealEvent           { changedCells: [{x,y,factionId}, ...] }
TrailVertexEvent    { charId, x, z }
GridSnapshot        { gzippedBytes: Uint8Array }   // sent only on join + on resync request
GridHashEvent       { hash: number }                // periodic, every 30s
InputMessage        { dirX, dirZ }                  // client → server, 20 Hz
ClientHello         { name, playerToken? }          // first message after connect
```

## Bot Controller Model

Bots are not a separate class. Every character has `isHuman: boolean`. Each tick, in the server's Simulation:

```js
for (const char of characters) {
  if (!char.alive) continue;
  if (char.isHuman) {
    char.targetDir = inputBuffer.get(char.id) ?? char.targetDir; // last received
  } else {
    char.targetDir = BotAI.planTargetDir(char, this);            // existing waypoint logic
  }
  // ...physics step, trail, claim check
}
```

Joining a player flips `isHuman=true` on a chosen bot's character. No entity creation. Leaving (after 10s grace) flips it back.

## Match Lifecycle (Server)

```
phase=playing, timeRemaining=900s
  ↓ MatchManager.tick() decrements
  ↓ when 0: phase=ended (5s display)
  ↓ phase=intermission, intermissionRemaining=30s
  ↓ during intermission: reset grid via FactionManager.init() (re-pie-slice),
    reset character positions and per-round kill counts, keep cumulative scores
  ↓ when 0: phase=playing, timeRemaining=900s
  ↓ loop
```

Players stay connected through the cycle. New joiners during intermission slot in immediately.

## Single-Player Coexistence

`index.html` `#name-entry` screen gets two buttons:

- **Solo** — instantiates `LocalGame` (today's `Game` class, but its `simState` source is a local `Simulation` instance ticked client-side)
- **Online** — instantiates `MultiplayerGame` which connects to Colyseus, attaches the room's state as the `simState` source, sends inputs

Both use the same renderer code (mesh creation, scene setup, camera, lighting, UI). The only difference is the source of state.

## Reconnection & Score Persistence

- On first connect, client generates `playerToken = crypto.randomUUID()`, stores in `localStorage`.
- `ClientHello` message includes the token.
- Server keeps `Map<playerToken, { cumulativeScore, lastSeenAt }>`. New connect with known token resumes that score map (round-fresh kills/captures still reset per round).
- Colyseus `room.allowReconnection(client, 10)` handles within-session blip recovery (same character resumes mid-flight).
- After 10 sec without reconnect, character flips to bot; player must re-join (likely as new character, possibly new faction).

## Railway Deployment

- **One service.** Colyseus server also serves `prototype/` static files via Express middleware (`app.use(express.static(path.join(__dirname, '../../prototype')))`).
- **Dockerfile:** Node 20-alpine. Multi-stage: build stage runs `pnpm install --filter template-server` and `tsc`, runtime stage copies `dist/`, `node_modules`, `prototype/`. `CMD ["node", "dist/index.js"]`.
- **railway.toml:** declares port from `$PORT`, healthcheck `GET /` returns 200.
- **No separate static hosting.** Same container serves game + websocket.
- **No Redis** in v1 — single shared room means single-process state suffices. (Adding Redis comes only when scaling to multiple rooms.)

## Critical Files to Modify

| File | Action | Notes |
|---|---|---|
| `prototype/main.js` | Heavy refactor | Extract simulation logic to `sim/Simulation.js`, leave rendering + input |
| `prototype/sim/Simulation.js` | Create | Owns grid, characters, tick loop |
| `prototype/sim/BotAI.js` | Create | Port `_planBotLoop()` and steering logic |
| `prototype/sim/{faction,scoring,match}.js` | Move | From `prototype/` to `prototype/sim/` |
| `prototype/multiplayer.js` | Create | Colyseus client, state-to-render bridge |
| `prototype/index.html` | Modify | Mode picker (Solo/Online buttons) |
| `server/src/index.ts` | Modify | Add Express static serving |
| `server/src/rooms/GameRoom.ts` | Replace | Wrap Simulation, 20Hz tick, Colyseus message handlers |
| `server/src/schema/GameState.ts` | Replace | Match new schema above |
| `server/package.json` | Modify | Add `express`; `colyseus.js` (client) loaded via CDN in prototype |
| `Dockerfile` | Create | Multi-stage build |
| `railway.toml` | Create | Port + healthcheck |
| `.dockerignore` | Create | Exclude `prototype/*.png`, `prototype/debug_*.json`, etc. |

## Build Sequence (Phased)

1. **Phase 1 — Simulation extraction.** Refactor `prototype/main.js` to pull territory/character/match/faction/scoring logic into `prototype/sim/Simulation.js`. Single-player must play identically. Pure refactor, no new behavior.
2. **Phase 2 — Bot AI extraction.** Pull `_planBotLoop` into `prototype/sim/BotAI.js`. Single-player still works.
3. **Phase 3 — Server skeleton.** Fill in `GameRoom.ts`: instantiate Simulation, run 20Hz tick, define schemas. Server compiles and runs but no clients yet.
4. **Phase 4 — Static serving.** Add Express to `server/src/index.ts`, serve `prototype/` files. Visit `localhost:2567/` → see today's single-player game.
5. **Phase 5 — Multiplayer client.** Add `prototype/multiplayer.js`. Mode picker in `index.html`. Online mode renders server-driven state with all bots, no input yet.
6. **Phase 6 — Human takeover.** Auto-assign join → weakest faction → flip bot to human. Input sync (client → server). Score display.
7. **Phase 7 — Reconnect + persistence.** `playerToken` cookie. `allowReconnection`. Cumulative score map.
8. **Phase 8 — Railway deploy.** Dockerfile, railway.toml. Deploy and test from public URL.
9. **Phase 9 (optional) — Client prediction.** Only if multiplayer feels laggy. Local player's character moves predictively, server reconciles.

Each phase produces a working game (single-player still playable throughout; multiplayer playable from Phase 6).

## Risks & Mitigations

- **Determinism of `_claim()`** — server and client must produce identical grids from the same trail polygon. The current `_claim()` uses floating-point math, flood fill (BFS with Map iteration), and a heal pass. Verify deterministic. If not: fix iteration order (sort cells before iterating) or fall back to broadcasting affected cells from server (heavier wire cost but bulletproof).
- **Schema bandwidth** — 30 chars × ~10 fields × 20 Hz worst case ≈ 6000 field-ticks/sec. Colyseus delta encoding only sends changed fields; expected steady-state is ~50-200 changes/tick. Should be well under 100 KB/s per client. Measure in Phase 6.
- **Single-room scaling** — design assumes one room is enough for hobbyist scale. If Railway hobby box can sustain 30-entity 20Hz sim, supports many concurrent spectators. If it can't, future v2 spawns a second room (Colyseus `RoomCache` makes this a small change).
- **Asset serving from Node** — Node serving static assets is fine for this scale. If traffic grows, move `prototype/*.js` to a CDN; the WebSocket stays on the Node server.

## Verification

Each phase has its own check:

| Phase | Verification |
|---|---|
| 1 | Open `prototype/index.html` locally → play single-player → behaviors identical to before refactor (claim, kill, respawn, end-screen). |
| 2 | Same — bots play identically. |
| 3 | `pnpm --filter template-server dev` → server boots, no errors, ticks log. |
| 4 | Visit `http://localhost:2567/` in browser → game loads (single-player works as before). |
| 5 | Visit URL, click Online → see 30 bots playing on the field. No control yet. |
| 6 | Two browser tabs Online → both control characters → both see each other move and claim. Score increments. |
| 7 | Refresh tab during play → reconnect within 10 sec → resume same character. After 10 sec → new character spawns, score persists. |
| 8 | Open Railway URL from another network → game playable. |

After all phases: stable multiplayer match runs end-to-end with two browsers, then deployed to Railway with a public URL.
