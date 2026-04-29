import type { GameEvent, Vec2 } from "@template/shared";
import { EventType } from "@template/shared";

export class EventBus {
  private events: GameEvent[] = [];

  emit(type: EventType, playerId: string, position: Vec2, killerId?: string, data?: Record<string, unknown>) {
    this.events.push({ type, playerId, position, killerId, data });
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
