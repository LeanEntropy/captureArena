import { Room, Client } from "@colyseus/core";
import { gzipSync } from "zlib";
import { GameStateSchema, FactionSchema, CharacterSchema } from "../schema/GameState.js";
// @ts-ignore — JS module, types not exported
import { Simulation } from "../sim/Simulation.js";

const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;
const INTERMISSION_SECONDS = 30;

interface ClientMeta {
  charId: number | null;
  playerToken: string | null;
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
  private sim!: any;
  private clientMeta = new Map<string, ClientMeta>();
  private prevPhase: string = "playing";
  private intermissionRemaining: number = 0;
  private playerScores = new Map<string, { cumulativeScore: number; lastSeenAt: number }>();

  onCreate() {
    this.setState(new GameStateSchema());
    this.sim = new Simulation();
    this.sim.start();

    // Wire sim event hooks → broadcast to clients.
    //
    // Two paths for grid-sync:
    //   - claimResult: server-authoritative cell-diff. Client applies the diff
    //     directly to its grid copy without re-running the algorithm. This is
    //     the primary path; clients always trust the server and skip any local
    //     algorithmic re-run.
    //   - claim: legacy trail-only event. Still broadcast so the renderer can
    //     clear the trail mesh by charId; no longer used for grid changes.
    //
    // For very large claims the cell-diff can grow big; fall back to broadcasting
    // only the trail (and let clients re-run the algorithm) above this threshold.
    const CLAIM_DIFF_MAX_CELLS = 5000;
    this.sim.onClaimResult = (
      charId: number,
      factionId: number,
      changedCells: number[],
      _trailPoints: number[],
    ) => {
      // Telemetry: only log slow claims (>10ms) — under normal load claims
      // run in 2-5ms and don't need a log line each.
      const ms = (this.sim as any)._lastClaimMs ?? 0;
      if (ms > 10) {
        console.log(`[claim slow] charId=${charId} faction=${factionId} cells=${changedCells.length} ms=${ms.toFixed(1)}`);
      }
      if (changedCells.length === 0) return;
      if (changedCells.length <= CLAIM_DIFF_MAX_CELLS) {
        // Plain number[] — Colyseus encodes via msgpack. For ~200-cell claims
        // this is ~600B over the wire, far cheaper than ~50ms client compute.
        this.broadcast("claimResult", { charId, factionId, cells: changedCells });
      } else {
        // Large claim: leave grid sync to the legacy claim event (trail replay).
        // Mark this so onClaim broadcasts the trail.
        (this.sim as any)._lastClaimWasLarge = true;
      }
    };
    this.sim.onClaim = (charId: number, trailPoints: number[], factionId: number) => {
      const isLarge = (this.sim as any)._lastClaimWasLarge === true;
      (this.sim as any)._lastClaimWasLarge = false;
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

    // Initialize schema from sim's initial state
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
      cs.posX = c.pos.x;
      cs.posZ = c.pos.z;
      cs.dirX = c.dir.x;
      cs.dirZ = c.dir.z;
      this.state.characters.push(cs);
    }

    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), TICK_MS);

    this.onMessage("hello", (client, msg: { name?: string; playerToken?: string | null }) => {
      this.handleHello(client, msg.name ?? "Player", msg.playerToken ?? null);
    });

    this.onMessage("input", (client, msg: { dirX: number; dirZ: number }) => {
      const meta = this.clientMeta.get(client.sessionId);
      if (!meta || meta.charId === null) return;
      this.sim.setTargetDir(meta.charId, msg.dirX, msg.dirZ);
    });
  }

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
    if (factionId === null) {
      console.log(`[GameRoom] hello from ${client.sessionId}: no alive factions`);
      return;
    }

    // Prefer alive bot in that faction
    let target = this.sim.characters.find((c: any) =>
      c.factionId === factionId && !c.isHuman && c.alive,
    );
    // Fallback: any non-human in that faction
    if (!target) {
      target = this.sim.characters.find((c: any) => c.factionId === factionId && !c.isHuman);
    }
    if (!target) {
      console.log(`[GameRoom] hello from ${client.sessionId}: no available bots in faction ${factionId}`);
      return;
    }

    target.isHuman = true;
    if (name) target.name = name;

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

  // Sliding window stats: every 5s, log max + p99 tick duration. Useful for
  // confirming that the 1Hz updateTerritoryPcts stall is gone after the
  // incremental-cellCounts fix.
  private _tickStatsMaxMs = 0;
  private _tickStatsLastDumpMs = 0;
  private _tickStatsCount = 0;
  private _tickStatsSumMs = 0;

  private tick(dt: number) {
    const tickStart = performance.now();
    try {
      this._tickInner(dt);
    } finally {
      const elapsed = performance.now() - tickStart;
      if (elapsed > this._tickStatsMaxMs) this._tickStatsMaxMs = elapsed;
      this._tickStatsCount++;
      this._tickStatsSumMs += elapsed;
      if (this._tickStatsLastDumpMs === 0) this._tickStatsLastDumpMs = tickStart;
      if (tickStart - this._tickStatsLastDumpMs >= 5000) {
        const avg = this._tickStatsSumMs / Math.max(1, this._tickStatsCount);
        console.log(`[tick stats] window=${(tickStart - this._tickStatsLastDumpMs).toFixed(0)}ms ticks=${this._tickStatsCount} max=${this._tickStatsMaxMs.toFixed(1)}ms avg=${avg.toFixed(2)}ms`);
        this._tickStatsLastDumpMs = tickStart;
        this._tickStatsMaxMs = 0;
        this._tickStatsCount = 0;
        this._tickStatsSumMs = 0;
      }
      if (elapsed > 50) {
        // Tick exceeded the 50ms budget. Log the simulation's phase breakdown
        // so we can attribute the cost. With incremental cellCounts the 1Hz
        // territoryPcts scan is gone; remaining outliers are rare big claims.
        const claimMs = ((this.sim as any)._lastClaimMs ?? 0);
        const phaseLog = (this.sim as any)._lastTickPhases ?? "";
        console.warn(`[GameRoom] tick OVER BUDGET: ${elapsed.toFixed(1)}ms (claim=${claimMs.toFixed(1)}ms ${phaseLog})`);
      }
    }
  }

  private _tickInner(dt: number) {
    // Round-rolling: handle intermission countdown
    if (this.state.phase === "intermission") {
      this.intermissionRemaining = Math.max(0, this.intermissionRemaining - dt);
      this.state.intermissionRemaining = this.intermissionRemaining;
      if (this.intermissionRemaining <= 0) {
        this.sim.restart();
        // Reset transient state for the new round.
        this.prevPhase = "playing";
        this.state.phase = "playing";
      }
      return; // don't tick simulation during intermission
    }

    // Normal sim tick
    this.sim.tick(dt);

    // Detect end-of-round transition
    const simPhase: string = this.sim.matchManager.phase;
    if (this.prevPhase === "playing" && simPhase === "ended") {
      this.accumulateScores();
      this.intermissionRemaining = INTERMISSION_SECONDS;
      this.state.phase = "intermission";
      this.state.intermissionRemaining = this.intermissionRemaining;
      this.prevPhase = "intermission";
      return;
    }
    this.prevPhase = simPhase;

    // Sync sim → schema (per-tick mutable fields only — id/name/factionId rarely change)
    this.state.phase = simPhase;
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

    for (let i = 0; i < this.sim.characters.length; i++) {
      const c = this.sim.characters[i];
      const cs = this.state.characters[i];
      if (!cs || !c) continue;
      cs.factionId = c.factionId;
      cs.isHuman = c.isHuman;
      cs.name = c.name;
      cs.posX = c.pos.x;
      cs.posZ = c.pos.z;
      cs.dirX = c.dir.x;
      cs.dirZ = c.dir.z;
      cs.alive = c.alive;
      cs.invulnTimer = c.invulnTimer ?? 0;
      cs.killCount = c.killCount ?? 0;
      // score will come from scoreTracker in Task 19; for now leave at 0
    }
  }

  private accumulateScores() {
    for (const [, meta] of this.clientMeta) {
      if (meta.charId === null || !meta.playerToken) continue;
      const c = this.sim.characters[meta.charId];
      if (!c) continue;
      const score = this.sim.scoreTracker?.getScore?.(c)?.total ?? 0;
      const prior = this.playerScores.get(meta.playerToken) ?? { cumulativeScore: 0, lastSeenAt: Date.now() };
      prior.cumulativeScore += score;
      prior.lastSeenAt = Date.now();
      this.playerScores.set(meta.playerToken, prior);
    }
  }

  onJoin(client: Client) {
    this.clientMeta.set(client.sessionId, { charId: null, playerToken: null });
    // Send the current territory grid as a gzipped snapshot so the new client
    // can populate its local grid copy. Subsequent claim/heal events keep the
    // copy in sync.
    const compressed = gzipSync(Buffer.from(this.sim.grid));
    client.send("gridSnapshot", { bytes: compressed.toString("base64") });
    console.log(`[GameRoom] join: ${client.sessionId} (snapshot ${compressed.length} bytes gzip)`);
  }

  async onLeave(client: Client, consented: boolean) {
    const meta = this.clientMeta.get(client.sessionId);
    if (!meta) {
      console.log(`[GameRoom] leave: ${client.sessionId} (no meta)`);
      return;
    }

    // Consented leave (explicit close from client) → immediate cleanup
    if (consented) {
      if (meta.charId !== null) {
        this.sim.setHumanControl(meta.charId, false);
      }
      this.clientMeta.delete(client.sessionId);
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
      // Timeout — clean up
      if (meta.charId !== null) {
        this.sim.setHumanControl(meta.charId, false);
      }
      this.clientMeta.delete(client.sessionId);
      console.log(`[GameRoom] ${client.sessionId} reconnection timed out — bot resumes`);
    }
  }
}
