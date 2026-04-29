import { Pane } from "tweakpane";
import { useStore } from "../../store.js";

export class DebugPanel {
  private pane: any;
  private params = {
    fps: 0,
    playerCount: 0,
    territoryPct: "0%",
    alive: true,
  };

  constructor() {
    this.pane = new Pane({ title: "Debug" });
    this.pane.addBinding(this.params, "fps", { readonly: true, format: (v: number) => v.toFixed(0) });
    this.pane.addBinding(this.params, "playerCount", { readonly: true });
    this.pane.addBinding(this.params, "territoryPct", { readonly: true });
    this.pane.addBinding(this.params, "alive", { readonly: true });
  }

  update(dt: number) {
    const state = useStore.getState();
    const myPlayer = state.players.get(state.playerId);
    this.params.fps = dt > 0 ? 1 / dt : 0;
    this.params.playerCount = state.players.size;
    if (myPlayer) {
      const pct = state.playableCells > 0
        ? ((myPlayer.territoryCount / state.playableCells) * 100).toFixed(1)
        : "0";
      this.params.territoryPct = `${pct}%`;
      this.params.alive = myPlayer.alive;
    }
    this.pane.refresh();
  }
}
