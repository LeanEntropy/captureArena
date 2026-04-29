import { Schema, type, MapSchema } from "@colyseus/schema";

export class PlayerSchema extends Schema {
  @type("uint8") slotId: number = 0;
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") heading: number = 0;
  @type("boolean") alive: boolean = true;
  @type("float32") respawnTimer: number = 0;
  @type("float32") invulnTimer: number = 0;
  @type("uint16") killCount: number = 0;
  @type("uint16") territoryCount: number = 0;
  @type("string") name: string = "";
  @type("uint32") color: number = 0;
}

export class GameStateSchema extends Schema {
  @type("uint8") version: number = 1;
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
