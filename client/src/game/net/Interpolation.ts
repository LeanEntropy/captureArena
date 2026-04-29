import type { ClientEntity } from "../../store.js";
import { SERVER_TICK_RATE, lerp } from "@template/shared";

const TICK_INTERVAL = 1 / SERVER_TICK_RATE;

export function interpolateEntities(entities: Map<number, ClientEntity>, dt: number) {
  for (const entity of entities.values()) {
    entity.interpT = Math.min(entity.interpT + dt / TICK_INTERVAL, 1);
    entity.x = lerp(entity.prevX, entity.targetX, entity.interpT) + entity.vx * dt * (1 - entity.interpT);
    entity.z = lerp(entity.prevZ, entity.targetZ, entity.interpT) + entity.vz * dt * (1 - entity.interpT);
  }
}
