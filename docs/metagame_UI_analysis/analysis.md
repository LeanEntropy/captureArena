# Paper.io 2 - Metagame & UI Analysis

Research compiled April 2026. Paper.io 2 is developed by Voodoo, available on iOS, Android, Steam, Xbox, and browser.

---

## 1. Main Menu / Title Screen

### Layout
- **Logo**: "PAPER.io 2" rendered in 3D metallic/stone text at top-center, with a golden orbital ring around the "2". Stylized, chunky font with depth and shadow.
- **Character Preview**: A 3D cube (the player character) displayed center-screen, slowly rotating. The cube's color/skin reflects the currently selected skin. It sits on the teal-green game arena background, which extends to fill the entire screen.
- **Play Button**: Large yellow circular button at bottom-center with a white play-arrow icon. Primary CTA.
- **Best Score**: Bottom-left corner. Label "Best score" in white text above a dark rounded pill/bar showing the player's all-time best percentage (e.g., "0%") in yellow/orange text.
- **Pseudo (Name Input)**: Bottom-right corner. Label "Pseudo" in white text above a dark rounded pill/textbox containing the player name (default: "Player") in yellow/orange text. Tappable to edit.
- **Coin Counter**: Top-left corner. Small golden coin icon followed by the coin count (e.g., "0") in white text.
- **Settings Gear**: Top-left, next to coin counter. Small grey gear icon.
- **"Start x5 Bigger" Bubble**: Dark speech bubble emanating from the character, offering a rewarded ad to start with 5x territory. Contains "START" in white bold, "x5" in large yellow text, "bigger" in orange text, and a yellow video-play button below.
- **"Unlock new skins!" Button**: To the right of the character. Small dark circular icon with a paint roller, and orange text "Unlock new skins!" below.
- **Background**: Muted teal-green (the same color as the game arena), giving a sense of continuity between menu and gameplay.

### Bottom Navigation (Mobile App)
Four icons at the bottom for different game modes and features (not visible in web version but present in mobile):
- Mode selection icons for standard play, teams, world map, etc.

### Color Palette (Main Menu)
- Background: Muted teal-green (~#6B9E8E)
- Primary accent: Golden yellow (~#F5A623) used for play button, text highlights, coin icon
- Secondary text: White
- Dark elements: Charcoal/dark grey (~#2D2D2D) for input bars, speech bubble
- Character: Varies by selected skin (default is a solid-color 3D cube)

---

## 2. Gameplay HUD

### Camera & Viewport
- **Perspective**: Slight isometric/angled top-down 3D view. Camera follows the player's cube from above with a gentle tilt, giving depth to the flat arena.
- **Field of View**: Limited/restricted -- players cannot see the entire map. This is a deliberate design choice that increases difficulty as territory grows (less visible free space relative to owned space).
- **Arena Shape**: Circular (changed from square in Paper.io 1), which creates more fluid gameplay and eliminates corner-camping advantages.

### HUD Elements During Gameplay

#### Top-Left: Score & Kills
- **Territory Percentage**: Displayed as a large, bold percentage number (e.g., "12.5%"). Shows the player's current territory coverage. Updates in real-time after each successful capture loop.
- **Kill Counter**: Below or beside the percentage. Shows total kills in the current run (e.g., "Kills: 3").

#### Top-Right: Leaderboard
- **Mini Leaderboard**: Shows the top 5 players ranked by territory percentage. Each entry displays:
  - Rank number (1-5)
  - Player name (colored to match their territory color)
  - Territory percentage
- The current player's entry is highlighted if they are in the top 5.
- Updates in real-time as territory changes.

#### Player Character
- The player appears as a small 3D cube (or their equipped skin shape) gliding across the arena surface.
- **Player Name Label**: Displayed directly above the player's cube in white text with a subtle shadow/outline for readability. Visible to the player and to others.
- **Crown**: A small golden crown icon appears above the player who currently holds the highest territory percentage ("the king"). This is visible to all players as a motivational target.
- **Trail**: When outside owned territory, the cube leaves a colored trail/line behind it. The trail is the same color as the player's territory but slightly darker or more saturated.

#### Territory Visuals
- **Owned Territory**: Flat colored region on the arena floor matching the player's color. Distinctly colored from the neutral arena and other players' zones.
- **Neutral/Unclaimed Space**: White or light grey area.
- **Enemy Territory**: Colored in each opponent's distinct color.
- **Particles**: Particles shoot up when a player is traversing someone else's territory, providing visual feedback.
- **Capture Animation**: When a loop is closed and territory is claimed, the enclosed area fills with the player's color with a satisfying fill animation.

#### Kill Notifications
- **Kill Popups**: When killing another player (crossing their trail), a notification appears on screen. Multi-kill streaks show special text:
  - "DOUBLE KILL!" for two rapid kills
  - Additional streak notifications for higher combos
- These appear center-screen or near the kill location as floating text.

#### Banner Ad (Mobile)
- A banner ad appears at the bottom of the screen during gameplay on mobile. Not present in the browser/Steam versions.

### Arena Boundaries
- The circular arena has a visible edge/boundary. Players moving along the edge can use it defensively (one side protected by the wall).

---

## 3. Death Screen & Respawn Flow

### Death Animation (3-Step Sequence)
1. **Trail Disappears**: The player's unclosed trail line vanishes instantly.
2. **Explosion**: The player's cube explodes in a burst particle animation (satisfying visual feedback for the killer, dramatic for the victim).
3. **Territory Fade**: The dead player's territory gradually fades away from the arena, freeing it for others to claim.

### Post-Death View
- After the death animation, the camera zooms out to show a **full-arena overview** of the territory the player conquered during their run. This is a unique design choice -- since players have limited vision during gameplay, this provides a satisfying "reveal" of their total accomplishment.
- The territory percentage and kill count for the run are displayed prominently.

### Revive Offer
- A popup appears offering the player a **second chance by watching a rewarded video ad**.
- UI: Prominent "Revive" button with a video icon, and a smaller "No Thanks" button.
- If accepted: Player respawns with their territory intact and continues the run.
- If declined: An interstitial ad plays, then the player returns to the main menu or results screen.
- The revive can only be used once per run.
- The revive option is strategically valuable when players have accumulated significant territory.

### Results / Return to Menu
- After declining revive (or after the ad), the player returns to the main menu.
- The main menu updates with the new "Best score" if the run exceeded the previous record.
- The game is designed to minimize time between death and the next game -- there is no explicit "results screen" beyond the territory reveal. This is a deliberate Voodoo design philosophy of "not wasting a single second."

---

## 4. 100% Completion / Bonus Game

### Triggering
- If a player captures 100% of the arena (eliminates all opponents and fills all space), a special "100% BONUS GAME!" event triggers.
- Even if some white space remains, the clear can be recognized once all opponents are eliminated.

### Bonus Game
- A 6-second standalone mini-round where the player is alone on the arena.
- Collectibles (coins, gems, chests) are scattered across the map.
- The player moves rapidly to collect as many rewards as possible in the time limit.
- Chests can contain skins/heroes.

### Post-Bonus
- An extension offer may appear to add more time via rewarded ad.
- After the bonus game, the player progresses to the next country in the world map progression system.

---

## 5. Skin / Cosmetic System

### Skin Categories

#### Achievement-Based Skins (Unlocked via Gameplay Milestones)

**Coverage Skins:**
| Skin | Unlock Condition |
|------|-----------------|
| Moose | Cover 10% of the map in one round |
| Elephant | Cover 25% of the map in one round |
| Giraffe | Cover 50% of the map in one round |
| Hippo | Cover 80% of the map |
| Unicorn | Cover 100% of the map |

**Kill Skins:**
| Skin | Unlock Condition |
|------|-----------------|
| Duck | Kill 10 players in one game |
| Pig | Kill 25 players in one game |
| Tank | Kill 50 players in one game |
| Donut | Kill the king (player with highest %) |
| Toilet | Kill 3 players in a row |

**Survival Skins:**
| Skin | Unlock Condition |
|------|-----------------|
| Rhinoceros | Stay outside your area for 5 seconds continuously |
| Paint Roller | Stay outside your area for 10 seconds continuously |
| Mouse | Stay outside your area for 15 seconds continuously |

**Pacifist Skins:**
| Skin | Unlock Condition |
|------|-----------------|
| Car | Cover 10% with zero kills |
| Woolly Mammoth | Cover 25% with zero kills |
| Police Car | Cover 50% with zero kills |

**Misc Skins:**
| Skin | Unlock Condition |
|------|-----------------|
| Cube with Hole | Use the revive feature 10 times total |

**Loyalty Skins:**
| Skin | Unlock Condition |
|------|-----------------|
| Cheeseburger | Play the game once |
| Box Truck | Play 3 days in a row |
| Airplane | Play 7 days in a row |

#### Secret Name-Based Skins
Typing specific names in the name field unlocks special skins:
- "thanos" -- Thanos hand/gauntlet skin
- "Thor" -- Thor's hammer skin
- "Doctor Doom" -- Doctor Doom skin

#### Heroes System (Recent Addition)
- Skins evolved into a "Heroes" system with stats and abilities.
- **Rarity tiers**: Common, Rare, Epic, Legendary.
- Heroes are obtained through:
  - Gacha-style chest openings
  - Card offers in the shop
  - Achievement rewards
- Unlike classic skins, heroes offer unique skills in addition to cosmetics.
- Heroes no longer auto-equip upon acquisition (changed in a recent update).

### Skin Selector Interface
- Accessed via the **paint roller icon** on the main menu (labeled "Unlock new skins!").
- Displays a gallery/grid of available skins.
- Locked skins show their unlock condition.
- Unlocked skins can be tapped to equip.
- The selected skin is immediately reflected on the 3D character preview on the main menu.

---

## 6. Progression System

### Country/World Map Progression
- The core metagame loop is **conquering countries** on a world map.
- Each "country" represents a level/stage that must be cleared.
- **Flexible completion**: Countries can be completed in one attempt (100% clear) or through accumulated progress across multiple attempts.
- If a player dies, their progress (percentage captured) is banked toward completing the current country.
- Completing a country unlocks:
  - The next country/region
  - New skins, power-ups, and bonuses
- After clearing ~7 maps, new continents are unlocked.
- Upon completing a country, the player chooses from 2-3 neighboring territories for their next target.

### Power-Up Upgrade System
Power-ups can be upgraded using earned currency. Each has multiple levels up to a max:

| Power-Up | Effect | Max Level |
|----------|--------|-----------|
| Starting Territory | Begin with more pre-claimed territory | Max level (achievement at level 5) |
| Extra Lives | Additional revives without watching ads | Max level (achievement at level 2) |
| Eagle Eye | Expanded field of view during gameplay | Max level (achievement at level 5) |
| Zone Defence | Protection for owned territory | Max level (achievement at level 5) |
| Fever | Speed boost or enhanced capture ability | Max level (achievement at level 5) |

### Currency System
- **Coins**: Earned through gameplay, bonus games, and daily rewards. Used to purchase skins and upgrade power-ups.
- **Gems**: Premium currency. Earned in smaller quantities through gameplay, purchasable with real money ($0.99 - $19.99). Used for premium purchases and chests.
- **Chests**: Gacha containers that yield hero cards. Available in the shop.

### Daily Rewards
- Free daily login rewards including coins, gems, and occasionally exclusive skin options.
- "Collect to Win" seasonal events where collectible items appear on the map during gameplay.

---

## 7. Game Modes

### Standard Mode (Default)
- Free-for-all territory capture on a circular arena.
- Player vs. AI bots (the game primarily uses bots, not real-time multiplayer).
- Goal: Capture as much territory as possible / reach 100%.

### Teams Mode
- Players are divided into two teams (Red vs. Blue).
- Each player's captures contribute to their team's total score.
- **Team Progress Chart**: Displayed on the bottom-right showing percentage of territory held by each team.
- Win conditions based on team territory dominance.

### World Map Mode
- Territories on the map correspond to real-world geographic locations.
- Players capture real countries (USA, Russia, China, etc.).
- Geographic progression system.

### Battle Royale Mode
- The playable arena shrinks periodically (like battle royale games).
- Forces increasingly close encounters.
- Last player standing or highest territory wins.

### World Conflict Mode
- Players represent their real-world country.
- All captures contribute to the country's global leaderboard score.
- Competitive geopolitical metagame.

### Event/Seasonal Modes
- Time-limited modes tied to seasonal updates (e.g., Winter Event).
- "Collect to Win" events with special collectibles on the map.
- Team events where winning games for your team earns prizes.
- Mode rotation with event banners showing what is active and when it ends.

---

## 8. Settings & Options

### Available Settings
- **Sound**: Toggle on/off, sound effects for kills, captures, and key events.
- **Sensitivity**: Adjustable control sensitivity for mobile.
- **Rotation**: Option to turn off rotation (recommended by pro players).
- **Controls**: WASD or Arrow keys on desktop; swipe on mobile; drag on tablet.
- **Colorblind Mode**: Available accessibility option.
- **Visual Effects Intensity**: Adjustable.
- **Language**: 19 languages supported.

### Settings Access
- Gear icon in the top-left of the main menu.
- Options button during gameplay (mobile).

---

## 9. Monetization

### Ad Placements
1. **Banner Ad**: Persistent at bottom of screen during gameplay (mobile only).
2. **Interstitial Ads**: Shown after death (especially when declining the revive offer). Approximately one interstitial every ~2 minutes of play. ~32% are Voodoo cross-promotion ads.
3. **Rewarded Video Ads**:
   - "Start x5 Bigger" on main menu (start with 5x territory).
   - Revive after death (continue run with territory intact).
   - Bonus game time extension.
   - Power-up activation during "Break Time."
4. **"Break Time" System**: At ~1:55 into a game, a 5-second "Break Time" popup appears. Frames ad-watching as an earned rest. "No Thanks" still triggers an interstitial.

### In-App Purchases
| Item | Price |
|------|-------|
| Remove Ads | $9.99 (one-time) |
| Gem Pack (Small) | $0.99 |
| Gem Pack (Large) | $19.99 |
| Skin Bundles | $4.99 |
| Special Offers | Varies |

### Monetization Philosophy (Voodoo)
- No tutorial -- players jump straight into gameplay, maximizing time-to-first-ad.
- Every moment outside of core gameplay is a monetization opportunity.
- Death frustration is leveraged to reduce ad resistance.
- "Skin + Remove Ads" bundle offers appear after specific game counts.

---

## 10. Game Flow (App Open to Gameplay)

### First-Time Flow
1. App opens directly to main menu (no splash/loading screen beyond brief load).
2. No tutorial, no onboarding. Player is presented with the Play button immediately.
3. Player taps Play, game starts instantly.
4. Player learns through trial and error (dying, restarting).
5. After first death, revive ad offer appears.
6. After ~3 plays, achievement skins begin unlocking, providing progression hooks.

### Returning Player Flow
1. App opens to main menu showing current skin, best score, and name.
2. Daily reward popup if applicable.
3. Event banners if seasonal events are active.
4. Player can: change skin, change name, check achievements, or hit Play.
5. Game starts. Core loop repeats.

### Core Session Loop
```
Main Menu -> Play -> Gameplay -> Death -> [Revive Ad?]
                                           |
                              Yes: Continue playing
                              No:  [Interstitial Ad] -> Territory Reveal -> Main Menu
                                                                              |
                                                                         OR: 100% -> Bonus Game -> Country Progress -> Main Menu
```

### Key Design Observations
- **No lobby/matchmaking**: Instant game start against bots.
- **Minimal friction**: 1 tap from menu to gameplay.
- **Session length**: Typically 30 seconds to 3 minutes per run.
- **Retention hooks**: Country progression, skin unlocks, daily rewards, achievement milestones.

---

## 11. Social Features

- **Name Display**: Player-chosen names visible to all in-match.
- **No Friend System**: No social graph, friend lists, or direct invites (standard .io game approach).
- **No Chat**: No in-game communication.
- **Leaderboards**: Global leaderboards on platform services (Xbox, Steam achievements). In-game leaderboard is session-based.
- **World Conflict**: Country representation creates implicit national competition.
- **Sharing**: Platform-standard screenshot/recording sharing.

---

## 12. Audio Design

- Short, punchy sound effects for:
  - Territory capture (satisfying "fill" sound)
  - Player elimination (explosion/pop)
  - Death (dramatic failure tone)
  - Kill streaks (escalating celebration sounds)
- Minimal/no background music during gameplay (focus on spatial awareness).
- Audio cues function as gameplay signals -- players can react to kills and captures even without looking directly at the action.

---

## Reference URLs

### Game
- Official (Voodoo): https://games.voodoo.io/paperio2/
- App Store: https://apps.apple.com/us/app/paper-io-2/id1423046460
- Google Play: https://play.google.com/store/apps/details?id=io.voodoo.paper2
- Steam: https://steamcommunity.com/app/2751310

### Analysis & Reviews
- Game Developer - Natural Difficulty Curve: https://www.gamedeveloper.com/design/paper-io-2-a-natural-difficulty-curve
- Gamigion - 1-Hour Analysis: https://www.gamigion.com/1-hour-analysis-paper-io-2-by-voodoo/
- Medium - Difficulty Curve Analysis: https://medium.com/@olinolmstead/paper-io-2-a-natural-difficulty-curve-6527a27b84fb

### Guides
- Gamlio Complete Guide: https://gamlio.com/paper-io-2-complete-guide-online-play-tips/
- Game Duddles Guide: https://www.gameduddles.com/blog/paperio-2-complete-guide-2026
- WriterParty Skins List: https://writerparty.com/party/paper-io-2-list-of-secret-hidden-skins-and-how-to-unlock-them/
- Freshdesk Progression: https://paper2-help.freshdesk.com/support/solutions/articles/202000095753-how-to-progress-in-paper-io-2-

### Screenshots
- Main menu screenshot captured directly: `screenshots/01_main_menu.png` (in this directory)
