import { Schema, type, MapSchema } from "@colyseus/schema";
import { SCHEMA_VERSION, MATCH_DURATION } from "@template/shared";

export class EntitySchema extends Schema {
  @type("uint16") id: number = 0;
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") z: number = 0;
  @type("float32") vx: number = 0;
  @type("float32") vy: number = 0;
  @type("float32") vz: number = 0;
  @type("float32") heading: number = 0;
  @type("float32") hp: number = 0;
  @type("float32") maxHp: number = 100;
  @type("uint8") actionState: number = 0;
  @type("string") ownerId: string = "";
  @type("float32") size: number = 1;
}

export class ResourceSchema extends Schema {
  @type("uint16") id: number = 0;
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") z: number = 0;
  @type("float32") remaining: number = 0;
}

export class PlayerSchema extends Schema {
  @type("string") id: string = "";
  @type("float32") score: number = 0;
  @type("float32") resources: number = 0;
}

export class GameStateSchema extends Schema {
  @type("uint8") version: number = SCHEMA_VERSION;
  @type("uint8") tickRate: number = 0;
  @type("float32") matchTime: number = 0;
  @type("float32") matchDuration: number = MATCH_DURATION;
  @type("string") phase: string = "waiting";
  @type({ map: EntitySchema }) entities = new MapSchema<EntitySchema>();
  @type({ map: ResourceSchema }) resources = new MapSchema<ResourceSchema>();
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
