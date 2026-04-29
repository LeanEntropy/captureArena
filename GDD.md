# Game Design Document — Capture Arena

## Overview

Capture Arena is a multiplayer territory-capture game inspired by Paper.io 2. Players move continuously across a circular arena, venturing outside their territory to draw trails that claim new land when they return. Cut another player's trail to eliminate them. The player with the most territory wins.

**Genre**: Competitive .io / Territory Capture
**Platform**: Web (desktop + mobile)
**Target**: Vibejam 2026 competition
**Players**: 1–8 (bots fill empty slots)

## Core Fantasy

You are a tiny explorer claiming land on a shared map. Every excursion outside your safe zone is a risk — the longer your trail, the more you can claim, but the more vulnerable you are. One touch to your trail and you're dead.

## Core Loop (30 seconds)

1. **Leave territory** — steer out of your safe zone
2. **Draw trail** — your path is recorded as a visible trail
3. **Return to territory** — close the loop to claim everything enclosed
4. **Score grows** — territory percentage increases
5. **Repeat** — push further, steal enemy land, avoid getting cut

## Core Loop (5 minutes)

- Early game: claim unclaimed land near spawn, grow from ~1% to ~10%
- Mid game: borders collide with other players, start stealing territory
- Late game: aggressive trail-cutting duels, leaderboard jockeying
- Match is continuous (no time limit) — players join/leave freely

## Entities

### Player
- Continuous position (x, y) + heading angle
- Constant forward speed (~4 units/sec)
- Smooth turning toward input direction
- Has a color, name, territory, and trail
- States: alive, dead (3s respawn), invulnerable (2s post-spawn)

### Territory
- Owned region on the map, rendered as a colored filled area
- Stored as a 400x400 grid internally, rendered as a smooth texture
- Starting territory: small circle (~5-cell radius) at spawn point
- Persists through death (territory is not lost when you die)

### Trail
- Polyline of positions recorded while outside own territory
- Visible as a colored curved ribbon/tube
- Vulnerable: any player crossing it kills the trail owner
- Self-intersection also kills the player
- Converted to territory when the player returns to their own zone

### Collectibles (stretch goal)
- Large colored spheres scattered on the map
- Grant bonus score or temporary speed boost when collected

## Movement & Controls

- **Mouse/Touch**: Player steers toward cursor/finger position relative to their character. Always moving forward.
- **Keyboard**: WASD/Arrow keys map to 8 directions
- **Mobile**: Virtual joystick (stretch goal) or touch-to-steer
- Turning is smooth — heading lerps toward target direction, creating curved paths

## Territory Claiming

When a player steps from unclaimed/enemy territory back onto their own territory:

1. Trail points are rasterized onto the 400x400 grid (Bresenham's line)
2. Edge-seeded BFS flood fill runs from all border cells not owned by the claiming player
3. All unreachable cells = enclosed = now owned by the claiming player
4. Enemy cells within the enclosed area are stolen
5. Trail is cleared
6. Score (territory %) is recalculated

## Death & Respawn

**Death triggers:**
- Another player crosses your trail
- You cross your own trail

**On death:**
- Trail is removed
- Territory persists (not lost)
- Block-debris particle effect at death location
- Killer gets credit (kill count +1)

**Respawn:**
- 3-second delay with death screen ("Killed by X")
- Spawn at random position far from other players
- Small circular starting territory granted
- 2-second invulnerability window (visual indicator: pulsing/flashing)

## Scoring & Leaderboard

- **Primary score**: Territory percentage (your cells / total playable cells)
- **Secondary**: Kill count
- **Leaderboard**: Top 5 players by territory %, shown top-right
- No match end — continuous play. Leaderboard is live.

## AI Bots

- 4-6 bots fill the lobby, join/leave to maintain player count
- **Wander behavior**: Leave territory, make medium-sized loops, return to claim
- **Expand behavior**: Target unclaimed areas adjacent to own territory
- **Attack behavior**: Occasionally target enemy territory edges
- **Survival**: Avoid own trail, avoid other players when trail is long
- Difficulty varies by turning speed and loop aggressiveness

## Art Direction

- **Style**: Clean, flat, colorful — like Paper.io 2
- **Palette**: Bright saturated player colors on a light/white background
- **Territory**: Solid filled color per player, smooth edges via texture filtering
- **Trails**: Slightly transparent ribbons with subtle glow
- **Players**: Small 3D blocky characters (cube body + simple features)
- **Camera**: Top-down with slight isometric tilt, follows local player
- **Map border**: Circular arena edge, visible as a subtle ring — acts as a solid wall players slide along
- **Background**: Light neutral color, faint grid lines for spatial reference

## HUD

- **Top-left**: Territory % bar, kill count
- **Top-right**: Leaderboard (top 5 by territory %)
- **Bottom-left**: Minimap showing territory overview
- **Center**: Death/respawn overlay when dead
- **Entry**: Name input overlay on first visit (no loading screen)

## Multiplayer Architecture

- **Server-authoritative**: Colyseus server runs the simulation at 20Hz
- **State sync**: Player positions synced via Colyseus Schema. Territory grid synced as raw binary (full on join, delta patches on claims). Trails synced via broadcast messages.
- **Input**: Client sends heading direction, server processes movement
- **Single-player**: Same simulation runs client-side with AI bots via LocalGame
- **Seamless join**: No lobby — players drop into a running game instantly, bots backfill

## Technical Constraints

- No loading screen (vibejam requirement)
- Web-accessible, no login required, free-to-play
- Must include vibejam widget script
- Three.js for rendering
- Colyseus for multiplayer
- Must work on desktop and mobile browsers

## Progression (stretch goals)

- Player skins/colors selectable at name entry
- Speed boost collectibles on the map
- Vibejam portal integration (spawn/exit portals)
