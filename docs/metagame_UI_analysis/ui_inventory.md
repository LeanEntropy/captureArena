# Paper.io 2 - UI Component Inventory

A flat checklist of every distinct UI element in Paper.io 2, organized by screen. Use this as a build reference for Capture Arena.

---

## MAIN MENU SCREEN

| # | Component | Position | Purpose | Visual Style |
|---|-----------|----------|---------|-------------|
| 1 | Game Logo | Top-center | Branding | 3D metallic/stone text "PAPER.io 2" with golden orbital ring around "2". Chunky font with depth/shadow. |
| 2 | Character Preview | Center | Show current skin | 3D cube slowly rotating on the arena-colored background. Reflects equipped skin color/shape. |
| 3 | Play Button | Bottom-center | Start game (primary CTA) | Large yellow circle (~100px diameter) with white play-arrow icon. Slight shadow/depth. |
| 4 | Best Score Display | Bottom-left | Show all-time best | Label "Best score" in white above dark rounded pill bar. Percentage in yellow/orange text inside bar. |
| 5 | Name Input Field | Bottom-right | Set player name | Label "Pseudo" in white above dark rounded pill/textbox. Player name in yellow/orange text, tappable to edit. |
| 6 | Coin Counter | Top-left | Show currency | Small golden coin icon + white number text. |
| 7 | Settings Gear | Top-left (next to coins) | Access settings | Small grey gear icon, tappable. |
| 8 | "Start x5 Bigger" Bubble | Left of center (speech bubble from character) | Rewarded ad offer for boosted start | Dark speech bubble with "START" (white bold), "x5" (large yellow), "bigger" (orange), yellow video-play button at bottom. |
| 9 | "Unlock new skins!" Button | Right of center | Access skin gallery | Dark circle icon with paint roller graphic + "Unlock new skins!" text in orange below. |
| 10 | Mode Selection Icons | Bottom row (mobile) | Switch game modes | Row of 4 circular icons for Standard, Teams, World Map, Battle Royale/Conflict modes. |
| 11 | Event Banner | Top or overlay (when active) | Promote active events | Banner showing event name, timer/countdown, call to action. |
| 12 | Daily Reward Popup | Center overlay (on login) | Daily login incentive | Modal popup with reward items (coins, gems, skin) and claim button. |
| 13 | Package Offer Popup | Center overlay (after N games) | Monetization upsell | "Skin + Remove Ads" bundle with price and purchase button. |

---

## GAMEPLAY HUD

| # | Component | Position | Purpose | Visual Style |
|---|-----------|----------|---------|-------------|
| 14 | Territory Percentage | Top-left | Show current map control | Large bold percentage text (e.g., "12.5%"). Updates in real-time on each capture. White or light text with shadow. |
| 15 | Kill Counter | Top-left (below percentage) | Track kills this run | Text like "Kills: 3". Smaller than percentage display. |
| 16 | Leaderboard | Top-right | Show top 5 players | Vertical list: rank number, player name (colored), percentage. Current player highlighted. Semi-transparent background panel. |
| 17 | Player Cube/Character | Center (follows player) | The player avatar | 3D cube or skin shape gliding on arena surface. Leaves colored trail when outside territory. |
| 18 | Player Name Label | Above player character | Identify the player | White text with subtle shadow/outline directly above cube. Visible at all times. |
| 19 | Crown Icon | Above leader's name label | Identify the "king" | Small golden crown floating above the name of whoever has the highest percentage. |
| 20 | Trail Line | Behind player (when outside territory) | Shows capture path | Colored line matching player color, slightly darker/more saturated than territory fill. |
| 21 | Territory Fill | Arena floor | Show owned area | Flat colored region on arena. Player's distinct color. |
| 22 | Neutral Space | Arena floor | Unclaimed area | White or light grey area. |
| 23 | Enemy Territory | Arena floor | Other players' zones | Different distinct colors per opponent. |
| 24 | Capture Particles | At player position (in enemy territory) | Feedback for risky traversal | Particles shooting upward when crossing enemy territory. |
| 25 | Territory Fill Animation | Enclosed loop area | Celebrate successful capture | Color fills enclosed area from trail line inward with satisfying spread animation. |
| 26 | Kill Notification | Center-screen (floating text) | Celebrate player kill | "DOUBLE KILL!" and similar streak text. Large, bold, brief popup with fade-out. |
| 27 | Arena Boundary | Edge of circular arena | Define playable area | Visible circle edge. Players cannot move beyond it. |
| 28 | Banner Ad | Bottom of screen (mobile only) | Monetization | Standard banner ad bar. Not in browser/Steam. |
| 29 | Break Time Popup | Center overlay (~1:55 into game) | Rewarded ad prompt | 5-second countdown, "Break Time" label, rewarded ad button, "No Thanks" button. |
| 30 | Minimap | Corner (varies by version) | Awareness of nearby enemies | Small overview showing nearby players and territory. Not always visible in all versions. |
| 31 | Enemy Name Labels | Above enemy characters | Identify opponents | Same style as player name label but for other cubes. |
| 32 | Team Progress Chart | Bottom-right (Teams mode only) | Show team scores | Bar chart or percentage display showing Red vs Blue team territory. |

---

## DEATH SCREEN / POST-DEATH FLOW

| # | Component | Position | Purpose | Visual Style |
|---|-----------|----------|---------|-------------|
| 33 | Trail Disappear Animation | In-game (at trail location) | Death feedback step 1 | Player's unclosed trail line vanishes instantly. |
| 34 | Explosion Animation | At player death location | Death feedback step 2 | Burst particle animation at cube position. Satisfying pop/explosion. |
| 35 | Territory Fade Animation | Across dead player's territory | Death feedback step 3 | Territory gradually fades/dissolves, returning area to neutral. |
| 36 | Full-Arena Territory Reveal | Full screen (camera zooms out) | Show total accomplishment | Overhead view of entire arena showing all territory captured during the run. |
| 37 | Run Statistics Display | Overlay on territory reveal | Summarize performance | Territory percentage and kill count shown prominently. |
| 38 | Revive Offer Popup | Center overlay | Monetization + retention | "Revive" button with video icon (watch ad to continue), "No Thanks" button below. One use per run. |
| 39 | Interstitial Ad | Full screen (after declining revive) | Monetization | Full-screen ad before returning to menu. |

---

## SKIN SELECTOR / GALLERY

| # | Component | Position | Purpose | Visual Style |
|---|-----------|----------|---------|-------------|
| 40 | Skin Grid | Center of screen | Browse available skins | Grid/gallery layout of skin thumbnails. Scrollable. |
| 41 | Locked Skin Card | Within skin grid | Show unavailable skins | Greyed out or locked icon with unlock condition text overlay (e.g., "Cover 10% in one round"). |
| 42 | Unlocked Skin Card | Within skin grid | Show available skins | Full-color skin preview, tappable to equip. |
| 43 | Equipped Indicator | On selected skin card | Show current skin | Highlight border or checkmark on the currently equipped skin. |
| 44 | Back/Close Button | Top corner | Return to main menu | Arrow or X button. |
| 45 | Heroes Tab | Top of skin screen (recent versions) | Switch to Heroes view | Tab selector for "Skins" vs "Heroes" categories. |
| 46 | Rarity Indicator | On hero cards | Show hero tier | Color-coded border: Common (grey), Rare (blue), Epic (purple), Legendary (gold). |

---

## SHOP / STORE

| # | Component | Position | Purpose | Visual Style |
|---|-----------|----------|---------|-------------|
| 47 | Card Offers Section | Shop screen | Hero card packs | Purchasable card bundles with price tags. |
| 48 | Chests Section | Shop screen | Gacha chests | Chest graphics with rarity tiers and gem prices. |
| 49 | Gem Purchase Options | Shop screen | Buy premium currency | Gem pack icons with real-money prices ($0.99 - $19.99). |
| 50 | Remove Ads Button | Shop or settings | One-time ad removal | $9.99 purchase button. |
| 51 | Special Offer Banner | Shop screen | Limited-time deals | Highlighted deal with countdown timer. |

---

## BONUS GAME (100% COMPLETION)

| # | Component | Position | Purpose | Visual Style |
|---|-----------|----------|---------|-------------|
| 52 | "100% BONUS GAME!" Banner | Top-center | Announce bonus round | Large celebratory text with animation. |
| 53 | Countdown Timer | Top or center | Show remaining time | 6-second countdown (e.g., "5...4...3..."). |
| 54 | Collectible Coins | Scattered on arena | Rewards to collect | Golden coin pickups on the arena floor. |
| 55 | Collectible Gems | Scattered on arena | Premium rewards | Gem pickups (less frequent than coins). |
| 56 | Collectible Chests | Scattered on arena | Gacha rewards | Chest pickups (rare). |
| 57 | Time Extension Offer | End of bonus game | Rewarded ad for more time | "Watch ad for more time" button. |

---

## SETTINGS SCREEN

| # | Component | Position | Purpose | Visual Style |
|---|-----------|----------|---------|-------------|
| 58 | Sound Toggle | Settings panel | Mute/unmute audio | On/off toggle switch. |
| 59 | Sensitivity Slider | Settings panel | Adjust control sensitivity | Horizontal slider. |
| 60 | Rotation Toggle | Settings panel | Enable/disable auto-rotation | On/off toggle. |
| 61 | Colorblind Mode Toggle | Settings panel | Accessibility | On/off toggle. |
| 62 | Effects Intensity | Settings panel | Adjust visual effects | Slider or toggle. |
| 63 | Language Selector | Settings panel | Change language | Dropdown or list of 19 languages. |

---

## WORLD MAP / PROGRESSION

| # | Component | Position | Purpose | Visual Style |
|---|-----------|----------|---------|-------------|
| 64 | World Map View | Full screen | Show country progression | Stylized world map with countries as selectable regions. |
| 65 | Country Progress Bar | On selected country | Show completion toward unlock | Progress bar filling toward 100% for current country. |
| 66 | Country Selection | After completing a country | Choose next target | 2-3 neighboring country options to select from. |
| 67 | Continent Unlock Notification | Overlay | Celebrate new continent | Popup/animation when ~7 countries completed and new continent unlocks. |
| 68 | Power-Up Upgrade Cards | Progression or shop screen | Upgrade power-ups | Card for each power-up (Starting Territory, Extra Lives, Eagle Eye, Zone Defence, Fever) with level indicator and upgrade cost. |

---

## COLLECT TO WIN EVENT

| # | Component | Position | Purpose | Visual Style |
|---|-----------|----------|---------|-------------|
| 69 | Event Banner | Main menu overlay | Promote current event | Seasonal themed banner with timer and event rules. |
| 70 | In-Game Collectibles | On arena during gameplay | Event pickups | Special themed items (e.g., branches in winter event) attracted to nearby players. |
| 71 | Event Progress Tracker | HUD overlay or event screen | Track collection progress | Progress bar or counter toward event rewards. |
| 72 | Event Rewards Display | Event screen | Show available prizes | List of rewards earned at collection milestones. |

---

## TEAM EVENTS

| # | Component | Position | Purpose | Visual Style |
|---|-----------|----------|---------|-------------|
| 73 | Team Selection Screen | Pre-game overlay | Choose Red or Blue | Two team color options with join buttons. |
| 74 | Team Leaderboard | Bottom-right during teams gameplay | Track team scores | Bar chart showing each team's territory percentage. |
| 75 | Team Event Results | Post-match or event end | Show team winners | Prize display and team standings. |

---

## GENERAL UI PATTERNS

| # | Pattern | Where Used | Notes |
|---|---------|-----------|-------|
| 76 | Dark Rounded Pill/Bar | Name input, score display, buttons | Charcoal/dark grey (#2D2D2D) with rounded ends, ~40px height. |
| 77 | Yellow/Orange Accent Text | CTAs, scores, important values | Primary highlight color (~#F5A623). Bold weight. |
| 78 | White Label Text | Section headers, secondary info | Clean white text, medium weight. |
| 79 | Semi-transparent Panels | Leaderboard, overlays | Dark background with ~50-70% opacity for readability over gameplay. |
| 80 | Floating Text Popups | Kill notifications, percentage gains | Appear at event location, scale up, then fade out over ~1-2 seconds. |
| 81 | Speech Bubble Tooltips | Rewarded ad offers | Dark rounded bubble with pointer/tail toward relevant character/item. |
| 82 | Circular Icon Buttons | Settings, skins, modes | Dark circle with icon inside, ~48px diameter. |
| 83 | Teal-Green Arena Color | Background everywhere | Muted teal-green (~#6B9E8E) unifying menu and gameplay visuals. |
