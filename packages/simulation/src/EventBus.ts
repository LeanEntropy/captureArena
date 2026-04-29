import type { GameEvent, Vec3 } from "@template/shared";
import { EventType } from "@template/shared";

export class EventBus {
  private events: GameEvent[] = [];

  emit(
    type: EventType,
    entityId: number,
    position: Vec3,
    playerId?: string,
    data?: Record<string, unknown>,
  ) {
    this.events.push({ type, entityId, position, playerId, data });
  }

  flush(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  get count(): number {
    return this.events.length;
  }
}
