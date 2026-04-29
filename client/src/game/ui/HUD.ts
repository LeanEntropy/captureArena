import { useStore } from "../../store.js";
import { PLAYER_COLORS } from "@template/shared";

export class HUD {
  private topLeft: HTMLElement;
  private topRight: HTMLElement;

  constructor() {
    this.topLeft = document.getElementById("hud-top-left")!;
    this.topRight = document.getElementById("hud-top-right")!;

    this.topLeft.style.cssText = "color:#333; font-size:16px; font-weight:bold;";
    this.topRight.style.cssText = "color:#333; font-size:14px; min-width:180px; background:rgba(255,255,255,0.7); border-radius:8px; padding:8px 12px;";
  }

  update(): void {
    const state = useStore.getState();
    const myPlayer = state.players.get(state.playerId);
    const playable = state.playableCells || 1;

    // Top-left: territory % and kills
    if (myPlayer) {
      const pct = ((myPlayer.territoryCount / playable) * 100).toFixed(1);
      const color = `#${myPlayer.color.toString(16).padStart(6, "0")}`;
      this.topLeft.innerHTML = `
        <div style="background:${color}; color:white; padding:4px 12px; border-radius:4px; display:inline-block; margin-bottom:4px;">
          ${pct}%
        </div>
        <div style="margin-top:4px;">Kills: ${myPlayer.killCount}</div>
      `;
    }

    // Top-right: leaderboard
    const sorted = Array.from(state.players.values())
      .filter(p => p.alive)
      .sort((a, b) => b.territoryCount - a.territoryCount)
      .slice(0, 5);

    let lb = "<div style='font-weight:bold; margin-bottom:4px;'>Leaderboard</div>";
    sorted.forEach((p, i) => {
      const pct = ((p.territoryCount / playable) * 100).toFixed(1);
      const color = `#${p.color.toString(16).padStart(6, "0")}`;
      const isMe = p.id === state.playerId;
      lb += `<div style="display:flex; align-items:center; gap:6px; margin:2px 0; ${isMe ? "font-weight:bold;" : ""}">
        <span style="display:inline-block; width:10px; height:10px; background:${color}; border-radius:2px;"></span>
        <span>${i + 1}.</span>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis;">${p.name}</span>
        <span>${pct}%</span>
      </div>`;
    });
    this.topRight.innerHTML = lb;
  }
}
