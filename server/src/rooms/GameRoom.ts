import { Room, Client } from "@colyseus/core";
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

  onCreate() {
    this.setState(new GameStateSchema());
    this.sim = new Simulation();
    this.sim.start();

    // Wire sim event hooks → broadcast to clients
    this.sim.onClaim = (charId: number, trailPoints: number[], factionId: number) => {
      this.broadcast("claim", { charId, trailPoints, factionId });
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
  }

  private tick(dt: number) {
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
