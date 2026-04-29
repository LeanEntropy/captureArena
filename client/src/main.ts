// client/src/main.ts
import { Game } from "./game/Game.js";
import { LocalGame } from "./game/local/LocalGame.js";
import { HUD } from "./game/ui/HUD.js";
import { Minimap } from "./game/ui/Minimap.js";
import { NameEntry } from "./game/ui/NameEntry.js";
import { DeathScreen } from "./game/ui/DeathScreen.js";
import { TerritoryRenderer } from "./game/world/TerritoryRenderer.js";
import { TrailRenderer } from "./game/entities/TrailRenderer.js";
import { PlayerRenderer } from "./game/entities/PlayerRenderer.js";
import { ParticleSystem } from "./game/entities/ParticleSystem.js";
import { useStore } from "./store.js";
import { EventType } from "@template/shared";

const game = new Game();
const hud = new HUD();
const minimap = new Minimap();
const nameEntry = new NameEntry();
const deathScreen = new DeathScreen();
const territoryRenderer = new TerritoryRenderer(game.scene);
const trailRenderer = new TrailRenderer(game.scene);
const playerRenderer = new PlayerRenderer(game.scene, game.camera);
const particleSystem = new ParticleSystem(game.scene);

let localGame: LocalGame | null = null;
let wasAlive = true;

nameEntry.setOnPlay((name) => {
  useStore.getState().setPlayerName(name);
  localGame = new LocalGame();
  localGame.start(name);
});

game.onUpdate = (dt: number) => {
  const store = useStore.getState();

  if (!localGame || !store.gameStarted) return;

  // Send input
  game.inputHandler.update();
  const myPlayer = store.players.get(store.playerId);
  if (myPlayer && myPlayer.alive) {
    game.inputHandler.setPlayerPosition(myPlayer.x, -myPlayer.y);
    if (game.inputHandler.hasInput) {
      localGame.sendHeading(game.inputHandler.targetHeading);
    }
  }

  // Tick simulation
  localGame.tick(dt);

  // Re-read store after tick
  const freshStore = useStore.getState();
  const freshPlayer = freshStore.players.get(freshStore.playerId);

  // Register player colors for territory renderer
  for (const p of freshStore.players.values()) {
    territoryRenderer.registerPlayerColor(p.slotId, p.color);
  }

  // Update renderers
  if (freshStore.territoryGrid) {
    territoryRenderer.updateFromGrid(freshStore.territoryGrid);
  }
  playerRenderer.update(freshStore.players);

  // Update trails
  for (const p of freshStore.players.values()) {
    if (p.trail.length > 1) {
      trailRenderer.updateTrail(p.id, p.trail, p.color);
    } else {
      trailRenderer.updateTrail(p.id, [], p.color);
    }
  }

  // Camera follow
  if (freshPlayer && freshPlayer.alive) {
    game.cameraRig.setTarget(freshPlayer.x, -freshPlayer.y);
  }

  // Process events for VFX
  const events = freshStore.events;
  for (const ev of events) {
    if (ev.type === EventType.PlayerDeath) {
      const deadPlayer = freshStore.players.get(ev.playerId);
      const color = deadPlayer?.color ?? 0xffffff;
      particleSystem.spawnDeathEffect(ev.position.x, -ev.position.y, color);
    }
  }
  freshStore.clearEvents();

  // Death screen
  if (freshPlayer) {
    if (freshPlayer.alive && !wasAlive) {
      deathScreen.hide();
    } else if (!freshPlayer.alive && wasAlive) {
      const lastDeath = events.find(
        e => e.type === EventType.PlayerDeath && e.playerId === freshStore.playerId
      );
      const killerName = lastDeath?.killerId
        ? freshStore.players.get(lastDeath.killerId)?.name
        : undefined;
      deathScreen.show(killerName);
    }
    if (!freshPlayer.alive) {
      deathScreen.updateTimer(freshPlayer.respawnTimer);
    }
    wasAlive = freshPlayer.alive;
  }

  particleSystem.update(dt);
  hud.update();
  minimap.update(freshStore.territoryGrid);
};

// Start render loop immediately (scene renders behind name entry)
game.start();
