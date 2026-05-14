import { Client, Room } from "@colyseus/core";
import { gzipSync } from "zlib";
import { CharacterSchema, FactionSchema, GameStateSchema } from "../schema/GameState.js";
// @ts-ignore — JS module, types not exported
import { Simulation } from "../sim/Simulation.js";
import { BOT_NAMES } from "../sim/constants.js";
import { MAX_CHARS_PER_FACTION } from "../sim/faction.js";
import { insertServerEvent } from "../stats/db.js";
import { setCurrentRoom } from "./registry.js";

const TICK_HZ = 30;
const TICK_MS = 1000 / TICK_HZ;
const INTERMISSION_SECONDS = 30;
// For very large claims the cell-diff can grow big; fall back to broadcasting
// only the trail (and let clients re-run the algorithm) above this threshold.
const CLAIM_DIFF_MAX_CELLS = 5000;
// Clamp dt to a sane upper bound. setSimulationInterval normally fires
// every TICK_MS=33ms (dt≈0.033s), but if the server stalls (GC pause,
// expensive claim, host load spike), the next tick's dt can balloon to
// hundreds of ms. An unclamped dt × PLAYER_SPEED produces a single-tick
// pos jump of >1 world unit, which broadcasts as a visible mid-movement
// teleport on the client. Cap dt so the worst-case is <1 cell of jump.
// 60ms (≈ 2× nominal tick) preserves smooth motion for routine scheduling
// jitter while bounding the visible damage from real stalls.
const MAX_DT = 0.06;

interface ClientMeta {
  charId: number | null;
  playerToken: string | null;
  lastInputSeq: number;
}

// Sim-side character shape — sim is JS, so we type the touched fields here.
interface SimCharacter {
  id: number;
  factionId: number;
  name: string;
  isHuman: boolean;
  alive: boolean;
  pos: { x: number; z: number };
  dir: { x: number; z: number };
  invulnTimer?: number;
  killCount?: number;
}

// Copy the per-tick mutable fields. Schema `id` is set once at create-time;
// don't re-write it here to avoid spurious dirty-flag flips on every tick.
function syncCharacterSchema(cs: CharacterSchema, c: SimCharacter): void {
  cs.factionId = c.factionId;
  cs.name = c.name;
  cs.posX = c.pos.x;
  cs.posZ = c.pos.z;
  cs.dirX = c.dir.x;
  cs.dirZ = c.dir.z;
}

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

export class GameRoom extends Room<GameStateSchema> {
  // typed loosely — sim is JS
  protected sim!: any;
  protected clientMeta = new Map<string, ClientMeta>();
  protected prevPhase: string = "playing";
  protected intermissionRemaining: number = 0;
  protected playerScores = new Map<string, { cumulativeScore: number; lastSeenAt: number }>();
  protected matchStartTs: number = Date.now();

  // Set by onClaimResult when the diff is too big to send; consumed (and
  // cleared) by the immediately-following onClaim to decide whether the
  // legacy claim event needs to carry the trail for client replay.
  protected lastClaimWasLarge = false;

  // When true, _tickInner skips the `state.phase = simPhase` write so a
  // subclass can manage state.phase manually (e.g. PrivateGameRoom holds
  // "waiting" until minHumans is met, then flips to "playing" in startMatch).
  protected skipPhaseSync = false;

  onCreate() {
    this.setState(new GameStateSchema());
    setCurrentRoom(this);
    // Align patch rate with sim tick rate. Colyseus default is 50ms (20Hz);
    // sim runs at 30Hz, so the default coalesces ~1.5 sim ticks per patch and
    // produces bursty client-side state arrival (measured: mean 50ms with
    // many <5ms intervals from coalescing, p99 171ms when a patch slips).
    // Matching patchRate to TICK_MS gives clients exactly one patch per sim
    // tick, evening out the snapshot interpolation buffer's input cadence.
    this.patchRate = TICK_MS;
    this.sim = new Simulation();
    this.sim.start();

    this.wireSimEvents();

    // Initialize schema from sim's initial state
    for (let f = 1; f <= 5; f++) {
      const fs = new FactionSchema();
      fs.id = f;
      this.state.factions.push(fs);
    }
    for (const c of this.sim.characters as SimCharacter[]) {
      const cs = new CharacterSchema();
      cs.id = c.id;
      syncCharacterSchema(cs, c);
      this.state.characters.push(cs);
    }

    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), TICK_MS);

    this.onMessage("hello", (client, msg: { name?: string; playerToken?: string | null }) => {
      this.handleHello(client, msg.name ?? "Player", msg.playerToken ?? null);
    });

    this.onMessage("input", (client, msg: { dirX: number; dirZ: number; seq?: number }) => {
      const meta = this.clientMeta.get(client.sessionId);
      if (!meta || meta.charId === null) return;
      this.sim.setTargetDir(meta.charId, msg.dirX, msg.dirZ);
      // Track the highest seq we've applied for this client so the per-tick
      // schema sync can echo it back. Monotonic-only — drop out-of-order/dup.
      if (typeof msg.seq === "number" && msg.seq > meta.lastInputSeq) {
        meta.lastInputSeq = msg.seq;
      }
    });

    // Client RTT measurement: echo back the client's send-time so the client
    // can compute round-trip latency. No schema change; payload is a number.
    this.onMessage("ping", (client, t: number) => {
      client.send("pong", t);
    });
  }

  // Wire sim event hooks → broadcast to clients.
  //
  // Two paths for grid-sync:
  //   - claimResult: server-authoritative cell-diff. Client applies the diff
  //     directly to its grid copy without re-running the algorithm. This is
  //     the primary path; clients always trust the server and skip any local
  //     algorithmic re-run.
  //   - claim: legacy trail-only event. Still broadcast so the renderer can
  //     clear the trail mesh by charId; no longer used for grid changes.
  protected wireSimEvents(): void {
    this.sim.onClaimResult = (
      charId: number,
      factionId: number,
      changedCells: number[],
      trailPoints: number[],
    ) => {
      // Telemetry: only log slow claims (>10ms) — under normal load claims
      // run in 2-5ms and don't need a log line each.
      const ms = this.sim._lastClaimMs ?? 0;
      if (ms > 10) {
        console.log(`[claim slow] charId=${charId} faction=${factionId} cells=${changedCells.length} ms=${ms.toFixed(1)}`);
      }
      // Thin-line diagnostic: capture suspicious claims for analysis.
      const trailLen = trailPoints.length / 2;
      const cellsFlipped = changedCells.length;
      const ratio = trailLen > 0 ? cellsFlipped / trailLen : 0;
      // Catch: short trails with no fill (ratio<5 + ANY length)
      // OR long trails with low fill (trailLen>20 + ratio<10) — the real "I drew a shape and it didn't fill" case
      const suspicious = (cellsFlipped > 0 && ratio < 5) || (trailLen > 20 && ratio < 10);
      if (suspicious) {
        const ts = new Date().toISOString().substring(11, 19);
        const trailPreview = JSON.stringify(trailPoints.slice(0, 200));
        const truncated = trailPoints.length > 200 ? `...(${trailPoints.length - 200} more)` : "";
        console.log(`[CLAIM_THIN ${ts}] char=${charId} faction=${factionId} trailLen=${trailLen} cellsFlipped=${cellsFlipped} ratio=${ratio.toFixed(2)} trail=${trailPreview}${truncated}`);
      }
      if (changedCells.length === 0) return;
      if (changedCells.length <= CLAIM_DIFF_MAX_CELLS) {
        // Plain number[] — Colyseus encodes via msgpack. For ~200-cell claims
        // this is ~600B over the wire, far cheaper than ~50ms client compute.
        this.broadcast("claimResult", { charId, factionId, cells: changedCells });
      } else {
        // Large claim: leave grid sync to the legacy claim event (trail replay).
        this.lastClaimWasLarge = true;
      }
    };
    this.sim.onClaim = (charId: number, trailPoints: number[], factionId: number) => {
      const isLarge = this.lastClaimWasLarge;
      this.lastClaimWasLarge = false;
      // Always broadcast claim so the renderer can clear the trail mesh.
      // For LARGE claims, include trailPoints (clients will replay the algorithm).
      // For small claims, omit trailPoints (claimResult already synced the grid).
      if (isLarge) {
        this.broadcast("claim", { charId, trailPoints, factionId, replayTrail: true });
      } else {
        this.broadcast("claim", { charId, factionId, replayTrail: false });
      }
    };
    this.sim.onHeal = (changedCells: number[]) => {
      this.broadcast("heal", { changedCells });
    };
    this.sim.onTrailVertex = (charId: number, x: number, z: number) => {
      this.broadcast("trailVertex", { charId, x, z });
    };
    this.sim.onKill = (killerId: number | null, victimId: number) => {
      this.broadcast("kill", { killerId, victimId });
    };
    // Position discontinuity (respawn / restart / faction reassignment).
    // Broadcast separately from schema state so clients can clear their
    // interpolation buffers and snap directly to the new pos rather than
    // smoothing along the artificial line between old and new.
    this.sim.onTeleport = (
      charId: number,
      posX: number,
      posZ: number,
      dirX: number,
      dirZ: number,
      reason: string,
    ) => {
      this.broadcast("teleport", { charId, posX, posZ, dirX, dirZ, reason });
    };
  }

  protected handleHello(client: Client, name: string, playerToken: string | null) {
    const characters = this.sim.characters as SimCharacter[];

    // Count humans per faction
    const humanCounts = new Map<number, number>();
    for (const c of characters) {
      if (c.isHuman) humanCounts.set(c.factionId, (humanCounts.get(c.factionId) ?? 0) + 1);
    }
    const factionsForPick = this.sim.factionManager.getAllFactions().map((f: any) => ({
      id: f.id, territoryPct: f.territoryPct, alive: f.alive,
    }));
    const factionId = pickWeakestFaction(factionsForPick, humanCounts);
    if (factionId === null) {
      console.log(`[GameRoom] hello from ${client.sessionId}: no alive factions`);
      return;
    }

    // Prefer alive bot in that faction; fallback to any non-human; finally
    // grow the faction up to MAX_CHARS_PER_FACTION (10). Pushing a fresh
    // CharacterSchema entry on growth surfaces the new char via
    // state.characters.onAdd. Solo never hits the grow path.
    let target =
      characters.find(c => c.factionId === factionId && !c.isHuman && c.alive) ??
      characters.find(c => c.factionId === factionId && !c.isHuman);
    if (!target) {
      const grown = this.sim.addCharacter(factionId, MAX_CHARS_PER_FACTION) as SimCharacter | null;
      if (grown) {
        const cs = new CharacterSchema();
        cs.id = grown.id;
        syncCharacterSchema(cs, grown);
        this.state.characters.push(cs);
        target = grown;
        console.log(`[GameRoom] grew faction ${factionId} → ${characters.length} chars total`);
      }
    }
    if (!target) {
      console.log(`[GameRoom] hello from ${client.sessionId}: faction ${factionId} at cap ${MAX_CHARS_PER_FACTION}`);
      client.send("nameRejected", { reason: "Server is full. Try again in a moment." });
      return;
    }

    // Reject if any OTHER human already holds this name (case-insensitive).
    // Client surfaces this as "name in use, pick another" in the title screen.
    const trimmedName = name.trim();
    const trimmedLower = trimmedName.toLowerCase();
    if (trimmedName) {
      const conflict = characters.find(c =>
        c.isHuman && c !== target && (c.name || "").toLowerCase() === trimmedLower,
      );
      if (conflict) {
        client.send("nameRejected", { reason: "Name already in use. Pick a different one." });
        console.log(`[GameRoom] hello from ${client.sessionId} rejected: name "${name}" taken`);
        return;
      }
    }

    // Route through setHumanControl so speed flips from BOT_SPEED to
    // PLAYER_SPEED — without this, server moves ~30% slower than client predicts.
    this.sim.setHumanControl(target.id, true);
    if (name) target.name = name;

    // Rename any BOT that shares the player's name so player + bot never share.
    // Pick a fresh name from BOT_NAMES that nobody else is using; fallback to
    // a synthetic "Bot-{id}" if all canonical names are taken.
    if (trimmedName) {
      const used = new Set<string>(characters.map(c => (c.name || "").toLowerCase()));
      for (const c of characters) {
        if (c === target || c.isHuman) continue;
        if ((c.name || "").toLowerCase() !== trimmedLower) continue;
        const fresh = BOT_NAMES.find((n: string) => !used.has(n.toLowerCase())) ?? `Bot-${c.id}`;
        used.delete((c.name || "").toLowerCase());
        used.add(fresh.toLowerCase());
        c.name = fresh;
      }
    }

    const meta = this.clientMeta.get(client.sessionId)!;
    meta.charId = target.id;
    meta.playerToken = playerToken;

    if (playerToken) {
      const prior = this.playerScores.get(playerToken) ?? { cumulativeScore: 0, lastSeenAt: 0 };
      prior.lastSeenAt = Date.now();
      this.playerScores.set(playerToken, prior);
      client.send("cumulativeScore", { score: prior.cumulativeScore });
    }

    client.send("yourCharId", { charId: target.id });
    console.log(`[GameRoom] ${client.sessionId} ("${name}") took over char ${target.id} (faction ${factionId})`);
  }

  // Sliding window stats: every 5s, log max + avg + p95 + p99 tick duration.
  // p95/p99 added to surface periodic outliers that the mean hides. Samples
  // are bounded by the 5s window (~150 ticks at 30Hz) so the sort is cheap.
  protected tickStats = { maxMs: 0, sumMs: 0, count: 0, windowStartMs: 0, samples: [] as number[] };

  protected tick(dt: number) {
    const tickStart = performance.now();
    // Diagnostic: capture whether the 1Hz match-manager faction check fired
    // this tick, so the OVER BUDGET warn can attribute itself to the 1Hz
    // boundary vs. an unrelated outlier.
    const preFactionTimer: number = this.sim?.matchManager?.factionCheckTimer ?? 0;
    if (dt > MAX_DT) {
      console.warn(`[GameRoom] tick dt clamp: ${(dt * 1000).toFixed(1)}ms → ${(MAX_DT * 1000).toFixed(0)}ms`);
      dt = MAX_DT;
    }
    try {
      this._tickInner(dt);
    } finally {
      const elapsed = performance.now() - tickStart;
      const postFactionTimer: number = this.sim?.matchManager?.factionCheckTimer ?? 0;
      const factionCheckFired = postFactionTimer < preFactionTimer;
      const stats = this.tickStats;
      if (elapsed > stats.maxMs) stats.maxMs = elapsed;
      stats.count++;
      stats.sumMs += elapsed;
      stats.samples.push(elapsed);
      if (stats.windowStartMs === 0) stats.windowStartMs = tickStart;
      if (tickStart - stats.windowStartMs >= 5000) {
        const avg = stats.sumMs / Math.max(1, stats.count);
        const sorted = stats.samples.slice().sort((a, b) => a - b);
        const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
        const p95 = p(0.95);
        const p99 = p(0.99);
        console.log(`[tick stats] window=${(tickStart - stats.windowStartMs).toFixed(0)}ms ticks=${stats.count} max=${stats.maxMs.toFixed(1)}ms p99=${p99.toFixed(1)}ms p95=${p95.toFixed(1)}ms avg=${avg.toFixed(2)}ms`);
        stats.windowStartMs = tickStart;
        stats.maxMs = 0;
        stats.count = 0;
        stats.sumMs = 0;
        stats.samples.length = 0;
      }
      if (elapsed > 50) {
        // Tick exceeded the 50ms budget. Log the simulation's phase breakdown
        // so we can attribute the cost. `1Hz=Y` means the match.js faction
        // block ran this tick — the only known 1Hz scheduled work in the sim.
        const claimMs = this.sim._lastClaimMs ?? 0;
        const phaseLog = this.sim._lastTickPhases ?? "";
        console.warn(`[GameRoom] tick OVER BUDGET: ${elapsed.toFixed(1)}ms (1Hz=${factionCheckFired ? "Y" : "N"} claim=${claimMs.toFixed(1)}ms ${phaseLog})`);
      }
    }
  }

  protected _tickInner(dt: number) {
    // Round-rolling: handle intermission countdown
    if (this.state.phase === "intermission") {
      this.intermissionRemaining = Math.max(0, this.intermissionRemaining - dt);
      this.state.intermissionRemaining = this.intermissionRemaining;
      if (this.intermissionRemaining <= 0) {
        this.sim.restart();
        // Reset transient state for the new round.
        this.prevPhase = "playing";
        this.state.phase = "playing";
        this.matchStartTs = Date.now();
      }
      return; // don't tick simulation during intermission
    }

    // Normal sim tick
    this.sim.tick(dt);

    // Detect end-of-round transition
    const simPhase: string = this.sim.matchManager.phase;
    if (this.prevPhase === "playing" && simPhase === "ended") {
      this.accumulateScores();
      this.emitMatchEnd();
      this.intermissionRemaining = INTERMISSION_SECONDS;
      this.state.phase = "intermission";
      this.state.intermissionRemaining = this.intermissionRemaining;
      this.prevPhase = "intermission";
      return;
    }
    this.prevPhase = simPhase;

    // Sync sim → schema (per-tick mutable fields only — id/name/factionId rarely change)
    if (!this.skipPhaseSync) this.state.phase = simPhase;
    this.state.timeRemaining = this.sim.matchManager.timeRemaining ?? 0;
    this.state.intermissionRemaining = 0;

    const factions = this.sim.factionManager.getAllFactions?.() ?? [];
    for (let i = 0; i < factions.length; i++) {
      const fs = this.state.factions[i];
      const f = factions[i];
      if (!fs || !f) continue;
      fs.territoryPct = f.territoryPct ?? 0;
      fs.alive = f.alive ?? true;
      fs.endangered = f.endangered ?? false;
    }

    // Build a charId -> lastInputSeq map so each schema char can echo back the
    // most recent input seq applied for the client bound to it. The bound
    // client reads this field to drop confirmed inputs and replay unacked ones
    // against its predicted state. Unbound chars (bots) get 0.
    const seqByCharId = new Map<number, number>();
    for (const meta of this.clientMeta.values()) {
      if (meta.charId !== null) seqByCharId.set(meta.charId, meta.lastInputSeq);
    }

    const characters = this.sim.characters as SimCharacter[];
    for (let i = 0; i < characters.length; i++) {
      const c = characters[i];
      const cs = this.state.characters[i];
      if (!cs || !c) continue;
      syncCharacterSchema(cs, c);
      cs.isHuman = c.isHuman;
      cs.alive = c.alive;
      cs.invulnTimer = c.invulnTimer ?? 0;
      cs.killCount = c.killCount ?? 0;
      cs.lastAppliedInputSeq = seqByCharId.get(c.id) ?? 0;
      const sc = this.sim.scoreTracker?.getScore?.(c);
      cs.score = sc?.total ?? 0;
      cs.deaths = sc?.deaths ?? 0;
      cs.cellsCaptured = sc?.cellsCaptured ?? 0;
    }
  }

  protected emitMatchEnd() {
    try {
      const durationMs = Date.now() - this.matchStartTs;
      const factionWinner = this.sim.matchManager?.winner?.name ?? null;
      const players = (this.sim.characters as SimCharacter[])
        .filter(c => c.isHuman)
        .map(c => {
          const sc = this.sim.scoreTracker?.getScore?.(c) ?? {};
          return {
            name: c.name ?? "",
            kills: sc.kills ?? 0,
            captured: sc.cellsCaptured ?? 0,
            score: sc.total ?? 0,
            isHuman: true,
            factionId: c.factionId,
          };
        });
      insertServerEvent(
        "match_end",
        { durationMs, factionWinner, players },
        { mode: "online" },
      );
    } catch (err) {
      console.error("[GameRoom] emitMatchEnd failed:", err);
    }
  }

  protected accumulateScores() {
    const now = Date.now();
    for (const meta of this.clientMeta.values()) {
      if (meta.charId === null || !meta.playerToken) continue;
      const c = this.sim.characters[meta.charId];
      if (!c) continue;
      const score = this.sim.scoreTracker?.getScore?.(c)?.total ?? 0;
      const prior = this.playerScores.get(meta.playerToken) ?? { cumulativeScore: 0, lastSeenAt: now };
      prior.cumulativeScore += score;
      prior.lastSeenAt = now;
      this.playerScores.set(meta.playerToken, prior);
    }
  }

  onJoin(client: Client) {
    this.clientMeta.set(client.sessionId, { charId: null, playerToken: null, lastInputSeq: 0 });
    // Send the current territory grid as a gzipped snapshot so the new client
    // can populate its local grid copy. Subsequent claim/heal events keep the
    // copy in sync.
    const compressed = gzipSync(Buffer.from(this.sim.grid));
    client.send("gridSnapshot", { bytes: compressed.toString("base64") });
    console.log(`[GameRoom] join: ${client.sessionId} (snapshot ${compressed.length} bytes gzip)`);
  }

  onDispose() {
    setCurrentRoom(null);
  }

  protected releaseChar(sessionId: string, meta: ClientMeta): void {
    if (meta.charId !== null) this.sim.setHumanControl(meta.charId, false);
    this.clientMeta.delete(sessionId);
  }

  async onLeave(client: Client, consented: boolean) {
    const meta = this.clientMeta.get(client.sessionId);
    if (!meta) {
      console.log(`[GameRoom] leave: ${client.sessionId} (no meta)`);
      return;
    }

    // Consented leave (explicit close from client) → immediate cleanup
    if (consented) {
      this.releaseChar(client.sessionId, meta);
      console.log(`[GameRoom] leave: ${client.sessionId} (consented)`);
      return;
    }

    // Unconsented disconnect (network drop) → allow 10s reconnect
    console.log(`[GameRoom] ${client.sessionId} disconnected, allowing 10s reconnect`);
    try {
      await this.allowReconnection(client, 10);
      // Successful reconnection — meta still in place, char still bound
      console.log(`[GameRoom] ${client.sessionId} reconnected`);
    } catch {
      this.releaseChar(client.sessionId, meta);
      console.log(`[GameRoom] ${client.sessionId} reconnection timed out — bot resumes`);
    }
  }
}
