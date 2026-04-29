import { useStore } from "../../store.js";
import { MATCH_DURATION } from "@template/shared";

export class HUD {
  private el: HTMLElement;

  constructor() {
    this.el = document.getElementById("hud")!;
  }

  update() {
    const state = useStore.getState();
    const remaining = Math.max(0, MATCH_DURATION - state.matchTime);
    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60);
    const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    const entityCount = state.entities.size;
    const player = state.players.get(state.playerId);
    const score = player ? Math.floor(player.score) : 0;
    const resources = player ? Math.floor(player.resources) : 0;

    this.el.innerHTML = [
      `Time: ${timeStr}`,
      `Entities: ${entityCount}`,
      `Score: ${score}`,
      `Resources: ${resources}`,
    ].join("<br>");
  }
}
