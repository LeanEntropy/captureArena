import { Room, Client } from "@colyseus/core";
import { GameStateSchema } from "../schema/GameState.js";

export class GameRoom extends Room<GameStateSchema> {
  onCreate() {
    this.setState(new GameStateSchema());
  }
  onJoin(_client: Client) {}
  onLeave(_client: Client) {}
}
