import { Pane } from "tweakpane";
import { useStore } from "../../store.js";

export class DebugPanel {
  private pane: any;
  private params = {
    fps: 0,
    entityCount: 0,
    resourceCount: 0,
    matchPhase: "waiting",
    matchTime: 0,
  };

  constructor() {
    this.pane = new Pane({ title: "Debug" });
    this.pane.addBinding(this.params, "fps", { readonly: true, format: (v: number) => v.toFixed(0) });
    this.pane.addBinding(this.params, "entityCount", { readonly: true });
    this.pane.addBinding(this.params, "resourceCount", { readonly: true });
    this.pane.addBinding(this.params, "matchPhase", { readonly: true });
    this.pane.addBinding(this.params, "matchTime", { readonly: true, format: (v: number) => v.toFixed(1) });
  }

  update(dt: number) {
    const state = useStore.getState();
    this.params.fps = dt > 0 ? 1 / dt : 0;
    this.params.entityCount = state.entities.size;
    this.params.resourceCount = state.resources.size;
    this.params.matchPhase = state.matchPhase;
    this.params.matchTime = state.matchTime;
    this.pane.refresh();
  }
}
