import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom.js";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { trackHandler } from "./stats/ingest.js";
import { statsAuth } from "./stats/auth.js";
import { dashboardRouter } from "./stats/dashboard.js";
import { startConcurrencySampler } from "./stats/concurrency.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In dev (`tsx watch src/index.ts`), __dirname is server/src/.
// In prod (`node dist/index.js`), __dirname is server/dist/.
// Both resolve to the repo root via "../.." then we go to "prototype/".
const PROTOTYPE_DIR = path.resolve(__dirname, "../../prototype");

const app = express();
app.use(express.static(PROTOTYPE_DIR));
app.get("/health", (_req, res) => { res.send("ok"); });

// Self-hosted analytics — must come BEFORE the Colyseus mount and any catch-all.
// `trust proxy` lets `req.ip` reflect X-Forwarded-For when running behind
// Railway / a load balancer, so geo lookups work in production.
app.set("trust proxy", true);
app.use("/track", express.json({ limit: "16kb" }), trackHandler);
app.use("/stats", statsAuth, dashboardRouter);

// Colyseus Monitor — development only. Access at http://localhost:2567/colyseus
// Gives a live web UI: active rooms, connected clients, full room state.
if (process.env.NODE_ENV !== "production") {
  const { monitor } = await import("@colyseus/monitor");
  app.use("/colyseus", monitor());
  console.log("[Server] Colyseus Monitor: http://localhost:2567/colyseus");
}

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("game", GameRoom);

// Self-hosted analytics — start the 60s concurrent-online sampler.
// Idempotent; reads currentRoom?.clients.length each tick and writes one row.
startConcurrencySampler();

const PORT = Number(process.env.PORT ?? 2567);
httpServer.listen(PORT, () => {
  console.log(`[Server] listening on http://localhost:${PORT}`);
  console.log(`[Server] static: ${PROTOTYPE_DIR}`);
});
