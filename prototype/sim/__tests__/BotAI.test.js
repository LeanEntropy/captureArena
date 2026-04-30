import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation.js";
import { BotAI } from "../BotAI.js";

describe("BotAI", () => {
  it("planTargetDir returns a unit vector for a bot character", () => {
    const sim = new Simulation();
    sim.start();
    const bot = sim.characters[1]; // any non-human
    const dir = BotAI.planTargetDir(bot, sim);
    expect(dir).toHaveProperty("x");
    expect(dir).toHaveProperty("z");
    const len = Math.hypot(dir.x, dir.z);
    expect(len).toBeGreaterThan(0.99);
    expect(len).toBeLessThan(1.01);
  });

  it("planTargetDir does not throw across a range of positions", () => {
    const sim = new Simulation();
    sim.start();
    const bot = sim.characters[5];
    for (let i = 0; i < 50; i++) {
      bot.setPos((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
      expect(() => BotAI.planTargetDir(bot, sim)).not.toThrow();
    }
  });
});
