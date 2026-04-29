import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import http from "http";
import { GameRoom } from "./rooms/GameRoom.js";

const port = Number(process.env.PORT) || 2567;
const server = http.createServer();

const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define("game_room", GameRoom);

server.listen(port, () => {
  console.log(`Game server listening on port ${port}`);
});
