# Research: existing multiplayer territory game implementations

Date: 2026-04-30
Status: read-only research, no code changes
Scope: prior-art survey for our Three.js + Colyseus paper.io-style game. Focus on the three pain points we are hitting: jittery remote-player motion at 30 Hz, capture-algorithm "thin line" failures, and intermittent teleports.

## Reference projects

### 1. theKidOfArcrania/BlocklyIO (the canonical paper.io clone lineage)

- Repo: <https://github.com/theKidOfArcrania/BlocklyIO>. Node.js + Socket.IO, Canvas client, grid-based, server-authoritative.
- Notable: every other "node paper.io" repo (`stevenjoezhang/paper.io`, `samuelscheit/paper.io`, `barpig/paper.io`, etc.) is a fork. This is the de-facto reference on GitHub.
- Capture algorithm: **two-phase BFS**, not a global flood-fill (`game-core/player.js`, `fillTail`):
  1. Walk the trail (`tailGrid`) cell by cell with a BFS.
  2. At every neighbour of every trail cell, kick off a bounded sub-flood-fill. The sub-fill aborts and discards its results if it touches an out-of-bounds cell (`surrounded = false`).
  3. Only sub-fills that never escaped the trail get committed.
  - Quote (`game-core/player.js`):
    ```js
    if (grid.isOutOfBounds(r, c)) { surrounded = false; continue; }
    // ...
    if (surrounded) { while (!filled.isEmpty()) { coord = filled.pop(); grid.set(coord[0], coord[1], data.player); } }
    ```
  - **This design is immune to "thin line" leaks.** Our flood-from-edges treats any single-cell gap as a leak path; theirs only fills local pockets adjacent to the trail and bails on bad pockets, keeping good ones. **Highest-impact pattern in the report.**
- Tick: `setInterval(() => game.tickFrame(), 1000/60)` — 60 Hz (maintained `stevenjoezhang` fork's `server.js`).
- Bots: **separate Node processes** connecting via WebSocket as real clients. Uniform input path; over-engineered for our scale.

### 2. jespertheend/splix (official splix.io)

- Repo: <https://github.com/jespertheend/splix>. Deno backend, JS client, custom binary WebSocket protocol.
- Wire format: **raw `Uint8Array`, packet-id byte + fixed-width fields** (per `JosefKuchar/Splix.io-Protocol`):
  - `PLAYER_POS`: 1B type + 2B x (u16) + 2B y (u16) + 2B id (u16) = 7B. Compare with Schema diffs (typically 20-40B per moved entity).
- Shows a shipped, polished io-game runs on **hand-rolled binary** instead of a high-level state-sync framework. Bandwidth ~5-10× lower than Schema at the same tick rate.

### 3. Kacper-Pietkun/splix.io-multiplayer-AI

- Repo: <https://github.com/Kacper-Pietkun/splix.io-multiplayer-AI>
- Stack: Python, hybrid TCP + UDP, NEAT/heuristic bots.
- Notable architectural decision: **TCP for join/leave + heartbeat, UDP for in-game position updates.** This is the exact split that mainstream FPS netcode uses.
- Quote (paraphrased from project docs): "Initial connection: TCP for reliability ... During gameplay: UDP for speed ... Heartbeat: 1 byte per few seconds TCP keepalive."
- Why this matters for us: we cannot use UDP from the browser, but the principle (don't put position deltas through a reliable, ordered channel) explains a chunk of why our remote motion feels jittery — see "Smoothness" below.

### 4. xingshuo/Paper.io (algorithm reference, contrast)

- Repo: <https://github.com/xingshuo/Paper.io>. Standalone C demo of "flood from outside, then invert" — BFS seeded at `(minx-1, miny-1)`, anything not reached becomes captured territory. This is essentially **our current approach**. Correct *only if border rasterization is watertight*. xingshuo dodges this by hand-coding the input grid; we cannot.

### 5. geckosio/snapshot-interpolation + Gabriel Gambetta's articles

- Repo: <https://github.com/geckosio/snapshot-interpolation>
- Articles: <https://www.gabrielgambetta.com/entity-interpolation.html>, <https://gafferongames.com/post/snapshot_interpolation/>
- Canonical reference for the smoothness side. Two key facts we aren't fully exploiting:
  - Render delay should be **~3× the snapshot interval** plus a dejitter margin. At 30 Hz (33 ms) we have 100 ms which is exactly 3×; one TCP retransmit collapses the buffer.
  - Snapshot interpolation expects **fixed-cadence snapshots**. Colyseus' `patchRate` is wall-clock-based and emits *only when state changed*; t deltas of 16/50 ms cause visible jitter.

## Patterns they use that we don't (prioritized by likely impact)

1. **(High)** **Two-phase capture: walk the trail, sub-fill local pockets, discard sub-fills that escape.** Eliminates the "thin line" failure mode entirely without requiring a watertight rasterization. This is what BlocklyIO and all its forks do. Switching capture from "flood from outside, anything not reached is captured" to "flood from each trail-adjacent cell, keep only the bounded ones" is likely a 1-day change and would directly fix our enclosure bug.
2. **(High)** **Don't put position deltas through Schema.** Schema is a very good fit for low-frequency state (territory ownership, scores, joins). For 30 Hz position updates, send via `room.send` / `client.sendBytes` with a fixed-layout `ArrayBuffer` (e.g. 12 bytes per entity: u16 id + i16 x + i16 y + i16 vx + i16 vy + u16 seq). 30 entities × 12 bytes × 30 Hz = ~10.5 KB/s/client — vs. roughly 60-80 KB/s with Schema diffs, per the Colyseus 0.15 protobuf example. See Endel's reference: <https://github.com/endel/colyseus-0.15-protocol-buffers>.
3. **(Medium)** **Ship snapshots on a fixed cadence, regardless of state change.** Even if nothing moved this tick, send a heartbeat with the current sequence number. This is what gives the interpolator a stable t-axis to interpolate over and is the single biggest reason a 30 Hz Colyseus game can feel worse than a 20 Hz hand-rolled one.
4. **(Medium)** **60 Hz server tick.** Both BlocklyIO and the maintained `stevenjoezhang` fork run at 60 Hz with 30 entities and have no problem on a hobby VM. With our state already on a `Uint8Array` grid this is well within budget. Doubling the tick halves the client-side extrapolation distance, which is the main visible source of jitter on direction changes.
5. **(Low)** **Bots as in-process actors with the same input shape as humans.** stevenjoezhang's "fork a Node child process per bot" pattern is over-engineered for our scale. The right pattern for us is what BlocklyIO's pre-fork ancestor does: bots produce the same `{seq, dir}` input record that human input handlers produce, fed into the same simulation queue. Our current architecture is already close — make sure the input-application path is identical.

## Patterns we use that they avoided (with reasoning)

- **High-level state-sync framework (Colyseus Schema) on the position-update hot path.** No shipped paper.io/splix.io clone uses one — all hand-roll binary or use socket.io custom payloads. Keep Schema for slow state (grid, scores), use raw bytes for the position hot loop.
- **Single 1024×1024 `Uint8Array` grid.** Splix is ~600×600, BlocklyIO is 100×100 with larger cells. Our grid is fine server-side; the risk is syncing it whole — splix uses `CHUNK_OF_BLOCKS` packets for region deltas.
- **Three.js for a 2D-grid game.** No shipped clone uses it; they use Canvas2D / PixiJS. Keep for the 3D camera, but recognize Three.js buys us no networking advantage.
- **30 Hz tick.** Most performant clones run 60 Hz. See takeaway #4.

## Five actionable takeaways

1. **Replace the global flood-fill capture with the BlocklyIO-style "BFS-along-trail + bounded sub-fill" algorithm.** This is the single change most likely to fix the "thin line" / leak bug, and it does not depend on having a perfectly rasterized trail. Reference implementation in 60 lines of JS at `game-core/player.js#fillTail` in <https://github.com/theKidOfArcrania/BlocklyIO>.
2. **Move position updates off Schema onto raw `ArrayBuffer` messages via `room.send` / `client.sendBytes`.** Keep Schema for territory grid, scores, alive/dead. Pattern: <https://github.com/endel/colyseus-0.15-protocol-buffers>. Expected bandwidth drop: 4-8×. Side effect: sequence-numbered position packets give us a clean axis for interpolation that is independent of Colyseus' patch scheduler.
3. **Send position snapshots at a fixed cadence regardless of state change.** Pair it with the buffer rule of thumb (render delay ≥ 3× snapshot interval, currently 100 ms at 30 Hz, fine). Without fixed cadence the interpolator's input is uneven and 100 ms of buffer is not enough.
4. **Bump server tick to 60 Hz behind a feature flag and measure.** 30 entities is well within budget per the BlocklyIO precedent. If CPU stays under target, leave it on; the visible jitter on direction changes will halve.
5. **Investigate the teleport bug as a reconciliation-overshoot symptom, not a server-state bug.** With the wire protocol changes above, every position carries a `seq`. Add a guard on the client: if a server-correction overshoots the predicted position by more than `N × maxStepDistance`, snap-with-tween rather than instant-snap. Many of the "teleport" reports in similar Colyseus games on the forum trace back to a single dropped patch followed by a compounded reconciliation when the next patch lands. (See Colyseus FAQ note: "client-prediction support isn't yet built-in" — every Colyseus game rolls its own, and most do it slightly wrong on the first pass.)

## Honest gaps in this research

- No Three.js + Colyseus territory-game reference exists. There are Babylon/PlayCanvas + Colyseus tutorials but none are paper.io-style. Compose the 2D-clone networking patterns onto our existing Three.js renderer.
- I read `jespertheend/splix` via search summaries, not file-by-file. Before adopting its chunked grid sync, worth a deeper read of its `studio/server/`.
- Blog postmortems on shipped paper.io clones are scarce. Treat the code in BlocklyIO and jespertheend/splix as the documentation.

## Sources

- <https://github.com/theKidOfArcrania/BlocklyIO> — canonical paper.io clone, two-phase capture algorithm
- <https://github.com/stevenjoezhang/paper.io> — maintained fork, 60 Hz tick reference
- <https://github.com/jespertheend/splix> — official splix.io source
- <https://github.com/JosefKuchar/Splix.io-Protocol> — splix.io binary protocol reverse-engineered
- <https://github.com/Kacper-Pietkun/splix.io-multiplayer-AI> — TCP+UDP split + bot AI patterns
- <https://github.com/xingshuo/Paper.io> — alternative "flood from outside + invert" capture
- <https://github.com/endel/colyseus-0.15-protocol-buffers> — Colyseus raw-bytes pattern
- <https://github.com/geckosio/snapshot-interpolation> — snapshot-interp library + buffer sizing rules
- <https://www.gabrielgambetta.com/entity-interpolation.html> — entity-interpolation theory
- <https://gafferongames.com/post/snapshot_interpolation/> — snapshot-interpolation theory
- <https://docs.colyseus.io/faq> — Colyseus tuning guidance
