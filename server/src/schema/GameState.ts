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
  @type("number") score: number = 0;
}

export class GameStateSchema extends Schema {
  @type("string") phase: string = "playing"; // "playing" | "intermission" | "ended"
  @type("number") timeRemaining: number = 0;
  @type("number") intermissionRemaining: number = 0;
  @type([FactionSchema]) factions = new ArraySchema<FactionSchema>();
  @type([CharacterSchema]) characters = new ArraySchema<CharacterSchema>();
}
