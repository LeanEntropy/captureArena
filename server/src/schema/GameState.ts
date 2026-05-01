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
  @type("uint16") deaths: number = 0;
  @type("uint32") cellsCaptured: number = 0;
  @type("number") score: number = 0;
  // Last input seq number applied by the server for the client bound to this
  // character. The bound client uses this to drop confirmed inputs from its
  // pending buffer and replay only the unacked inputs against its predicted
  // state, eliminating drift between client prediction and server truth.
  // 0 for unbound characters / bots.
  @type("uint32") lastAppliedInputSeq: number = 0;
}

export class GameStateSchema extends Schema {
  @type("string") phase: string = "playing"; // "playing" | "intermission" | "ended"
  @type("number") timeRemaining: number = 0;
  @type("number") intermissionRemaining: number = 0;
  @type([FactionSchema]) factions = new ArraySchema<FactionSchema>();
  @type([CharacterSchema]) characters = new ArraySchema<CharacterSchema>();
}
