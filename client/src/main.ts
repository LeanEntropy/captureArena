import { Game } from "./game/Game.js";
import { LocalGame } from "./game/local/LocalGame.js";
import { HUD } from "./game/ui/HUD.js";
import { DebugPanel } from "./game/debug/DebugPanel.js";

const game = new Game();
const localGame = new LocalGame();
const hud = new HUD();
const debugPanel = new DebugPanel();

// Wire input commands to local game
game.inputHandler.onCommand = (input) => {
  localGame.sendCommand(input);
};

// Wrap game update to drive simulation, HUD, and debug
game.onUpdate = (dt: number) => {
  localGame.tick(dt);
  hud.update();
  debugPanel.update(dt);
};

// Start local game and render loop
localGame.start();
game.start();
