// Module-level handle to the live GameRoom instance.
//
// The concurrent-sampler in stats/concurrency.ts reads `currentRoom?.clients.length`
// on a 60s interval. GameRoom registers itself in onCreate and clears the slot in
// onDispose. At most one GameRoom is created at a time in this single-room server.

import type { Room } from "@colyseus/core";

let currentRoom: Room | null = null;

export function setCurrentRoom(room: Room | null): void {
  currentRoom = room;
}

export function getCurrentRoom(): Room | null {
  return currentRoom;
}
