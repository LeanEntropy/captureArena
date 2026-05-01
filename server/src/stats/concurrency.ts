// Concurrent-online sampler.
//
// Every 60s, write one `concurrent_sample` event whose `detail.onlineNow`
// is the current number of WebSocket clients in the live GameRoom.
// Idempotent — only one interval is ever installed.

import { insertServerEvent } from "./db.js";
import { getCurrentRoom } from "../rooms/registry.js";

const SAMPLE_INTERVAL_MS = 60_000;
let timer: NodeJS.Timeout | null = null;

function sample(): void {
  const room = getCurrentRoom();
  const onlineNow = room?.clients.length ?? 0;
  insertServerEvent("concurrent_sample", { onlineNow });
}

export function startConcurrencySampler(): void {
  if (timer) return;
  timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[stats] concurrency sampler started (every ${SAMPLE_INTERVAL_MS}ms)`);
}
