import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { GameRoom } from "./rooms/GameRoom.js";
import { PrivateGameRoom } from "./rooms/PrivateGameRoom.js";
import { lookup as lookupRoomCode } from "./rooms/roomCodeRegistry.js";
import { statsAuth } from "./stats/auth.js";
import { startConcurrencySampler } from "./stats/concurrency.js";
import { dashboardRouter } from "./stats/dashboard.js";
import { trackHandler } from "./stats/ingest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In dev (`tsx watch src/index.ts`), __dirname is server/src/.
// In prod (`node dist/index.js`), __dirname is server/dist/.
// Both resolve to the repo root via "../.." then we go to "prototype/".
const PROTOTYPE_DIR = path.resolve(__dirname, "../../prototype");

// CORS for cross-origin embeds. Same static client may be hosted on
// itch.io (under *.itch.zone iframes) and POST telemetry / WS-connect to
// this Railway server. Allow itch's known origins; reflect the request's
// Origin header when it matches so each response has the exact origin
// rather than "*". Required for /track POSTs from the iframe; the
// Colyseus WebSocket transport accepts cross-origin handshakes by default.
const ITCH_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?itch\.(zone|io)$/;
function itchCors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && ITCH_ORIGIN_RE.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
  }
  next();
}

const app = express();
app.use(express.static(PROTOTYPE_DIR));
app.get("/health", (_req, res) => { res.send("ok"); });
app.use(itchCors);

// Self-hosted analytics — must come BEFORE the Colyseus mount and any catch-all.
// `trust proxy` lets `req.ip` reflect X-Forwarded-For when running behind
// Railway / a load balancer, so geo lookups work in production.
app.set("trust proxy", true);
app.use("/track", express.json({ limit: "16kb" }), trackHandler);

app.get("/api/room", (req, res) => {
  const codeRaw = typeof req.query.code === "string" ? req.query.code : "";
  const code = codeRaw.toUpperCase().slice(0, 6);
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    res.json({ exists: false });
    return;
  }
  res.json({ exists: lookupRoomCode(code) !== null });
});

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
gameServer.define("private", PrivateGameRoom).filterBy(["code"]);

// Self-hosted analytics — start the 60s concurrent-online sampler.
// Idempotent; reads currentRoom?.clients.length each tick and writes one row.
startConcurrencySampler();

const PORT = Number(process.env.PORT ?? 2567);
httpServer.listen(PORT, () => {
  console.log(`[Server] listening on http://localhost:${PORT}`);
  console.log(`[Server] static: ${PROTOTYPE_DIR}`);
});
