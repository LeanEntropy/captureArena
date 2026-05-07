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
    // Prevent base _tickInner from overwriting state.phase with the sim's
    // "playing" phase while we're still in the "waiting" lobby.
    // Cleared in startMatch() once we're ready to hand phase control back.
    this.skipPhaseSync = true;
    this.state.roomCode = code;
    this.state.minHumans = cfg.minHumans;
    this.state.humanCount = 0;

    // Note: we deliberately do NOT call setCurrentRoom(this). The
    // concurrency sampler in stats/concurrency.ts tracks ONE current room
    // (the public game room). Private rooms get their own analytics events
    // (room_created, room_started, room_expired); they're not double-counted
    // in the concurrent-online sampler.

    this.patchRate = 1000 / 30;

    // Sim with NO bots yet — bots spawn in startMatch() once minHumans is met
    // so the host plays alone with empty arena (showing "Waiting for players").
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
        // The 2nd arg is a per-faction cap. We pass a generous slack
        // (botsPerFaction + 50) because humans may have grown the faction
        // during waiting; the actual bot count comes from this loop, not
        // the cap. addCharacter only refuses if we'd exceed the cap.
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
    // Re-enable normal phase syncing now that the sim's phase can be trusted.
    this.skipPhaseSync = false;
    this.state.phase = "playing";
    insertServerEvent("room_started", {
      code: this._privateCode,
      humansAtStart: this.clients.length,
      totalBots: cfg.factions * cfg.botsPerFaction,
      config: cfg,
    }, { mode: "private" });
  }
}
