# Cyberpunk 2D77
*(don't sue me ProjectRed)*

**▶ Play it: https://jonathanjiwu.github.io/Cyberpunk-2D77/**
(old site: https://cyberpunk-2d77.netlify.app)

It's year 2D77 and you're a cyber badass running the neon streets of Cyber City. **Cyberpunk 2D77** is a side-scrolling action platformer with a Vampire Survivors-style run. Each run goes like this:

1. Pick an **Individual Contributor** (IC) and two starting skills.
2. Drop into the city with a superhero landing.
3. Fight off hordes of enemies that drop XP chips. Every level-up lets you install one of three hardware upgrades.
4. At **2:30** the **Overseer** arrives. Next comes **NULL**, the assassin who isn't there. Once it falls, the **Demon GOAT** comes for the final fight.

You have **3 lives**. The game plays on desktop (keyboard and mouse) and on phones and tablets (touch).

## What's new in v3.0: The Individual Contributor Update
- **Bosses**: both fight like rival characters, on the ground, with cinematic entrances. The **GOAT is the final boss**, with three phases.
- **3 lives**, a **hero-landing drop** at the start of every run, and **hot-swapping** your IC from the pause menu.
- **Hardware level-ups**: PC-part cards with an install animation, rare +2 cards, 3 rerolls, a **pre-drop loadout**, and **respec**.
- **A real-feeling hacking minigame** when you jack in.
- A **leaderboard** with custom names.
- **Audio fixed in Chrome**, plus music and SFX volume sliders.
- A giant **billboard hologram** that blows kisses, **THE LEGEND**, neon easter-egg notes, and plenty of dev humor.

Full details are in **[PATCH_NOTES.md](PATCH_NOTES.md)**.

## Individual Contributors

| IC | HP | Primary | Special (resource) | Style |
|---|---|---|---|---|
| **PAINE** // Pyro Runner | 110 | Energy Ball | Flame Aura (HEAT) | The all-rounder. Fire and keep the flame lit at the same time. The flame burns everything around you, melts incoming bullets, and keeps minions from touching you. Earns heat 20% faster. |
| **TETSU** // Chrome Ronin | 150, blocks 25% of damage | Monoblade | Iaido Dash (FOCUS) | Melee. A three-hit combo whose last hit is a 360° finisher that breaks shields. Swings parry bullets. The dash slices through everything and leaves him guarded. |
| **SUDO** // Netrunner | 80 | Glitch Orb | System Overload (RAM) | The crowd-control "wizard". Orbs explode in an area and slow enemies. The overload stuns and exposes a whole crowd and deletes their bullets. A firewall shrugs off one hit every 10 seconds. |

Each IC has their own:
- sprite, attack animations and hero landing;
- portrait and voice lines;
- upgrade path: 8 levels for the primary, 6 for the special.

Swap ICs from the pause menu at any time: levels, upgrades, lives and resource carry over.

## Features
- **A tall, scrolling neon city**:
  - parallax skylines and flying-car traffic;
  - rooftops to climb and rain-slick reflections;
  - one-way and moving platforms;
  - breakable supply crates.
- **Eight kinds of enemies**, joining as the run goes on:
  - Glitch Crawlers, Chrome Reapers, Security Drones and Mecha Wyrms;
  - Cyber Ninjas: wind up, then dash;
  - Bomber Drones: arm, then explode;
  - Enforcers: riot shield, so hit them from behind, stun them, or break the guard;
  - Sniper Sentries: laser sight, then a fast shot.

  Golden elites hit harder and drop more XP.
- **Three bosses that fight like rival ICs**, on the ground, with telegraphed attacks, trash talk and cinematic entrances (letterbox plus a name card).
  - When a boss arrives, every minion derezzes, leaving its XP behind, and nothing else spawns until the boss is down.
  - **The Overseer**:
    - runs and double-jumps onto rooftops;
    - fires arm-cannon bursts and dashes through you;
    - leaps and slams the ground (jump the shockwaves);
    - sweeps its eye laser, then overheats and kneels with its core exposed.
  - **NULL** // the assassin who isn't there: glitch fragments converge into a cyber-ninja, which splits into holographic copies. Then it:
    - fights among its copies: only the real one casts a shadow; hitting a copy pops it and reveals the real one;
    - blinks out and reappears where a glyph glows, behind you (a slash) or above you (a plunge);
    - throws fans of shuriken at different speeds;
    - double-jumps onto a rooftop and fires a rail shot down a telegraphed aim line;
    - vanishes in smoke and relocates.

    Below 60% it makes more copies; below 25%, STACK OVERFLOW: chained blinks, then a core dump. Beating it gives a life back (or a big heal) and a **RARE CACHE**: every card of your next level-up is rare.
  - **The Demon GOAT** (final boss) crashes down from a burning sky. Then it:
    - charges (make it hit the wall and it's dazed);
    - leaps and quakes the ground;
    - breathes fire;
    - calls down meteors.

    Three phases, the last one "FINAL FORM", and a proper death scene.
- **Three lives**: dying rolls back to your last stable build and drops you back in.
- **Hardware level-ups**:
  - three cards in a row, each a piece of PC hardware (GPU, CPU, RAM, PSU, network card, cooler);
  - installing one plays a short animation while the game pauses for half a second;
  - rare cards give +2 levels;
  - 3 rerolls per run.
- **Pre-drop loadout**: pick 2 starting skills. They start a level up and appear 3x as often (and 3x as likely rare) in level-ups.
- **Respec** from the pause menu: refund every skill point and spend them again.
- **12 upgrades**:
  - 6 weapons: your primary, your special, Orbit Shards, Seeker Missiles, Shock Stomp, Chain Lightning;
  - 6 passives: Cyber Heart, Servo Legs, Magnet Coil, Nano Armor, Heat Sink, Overclock.
- **Power-ups** from crates and enemies: health, heat cell, Overdrive (rapid fire), Shield, Magnet and an EMP blast.
- **Heat / Focus / RAM**: each IC's special runs on a resource that only builds up when you deal or take damage. It never refills on its own.
- **Jacking in** is a real-feeling hack. In a full-screen terminal you:
  1. nmap the network;
  2. exploit the vulnerable service;
  3. crack the password;
  4. sudo;
  5. upload the daemon of your choice.

  All the while the ICE traces you.
- **Leaderboard**: enter a display name at the end of a run. Scores, with time, kills, level, IC and result, are saved in your browser and survive refreshes and restarts.
- **THE LEGEND**, a hologram on the loadout and level-up screens, dispenses zen and debugging wisdom.
- **The DATABASE** screen lists every IC, enemy, boss and skill. Enemies and bosses stay encrypted until you meet them.
- **Feel**: your IC faces the way they're firing. You get attack animations, squash and stretch, dust, muzzle flashes and speech bubbles.
- **Software-developer humor** throughout: tips, respawns, game over screens, bosses, ICs and the Legend.
- **Music**: "Neon Inferno", an original darksynth soundtrack generated live in the browser, which gets nastier during boss fights. The original "Disconnected" track is still available.
- **Audio**: it starts on your first click, tap or key press, recovers when the tab is hidden, and has music and SFX volume sliders.
- **Optional assists**: auto-fire with assisted aim, and auto special.
- **Screens**: it scales to any screen size, portrait or landscape, with fullscreen where available.
- **8 hidden easter eggs** (see below).
- **45 automated browser tests** run before every deploy.

## Settings
These are on the start and pause menus and remembered between visits.

| Setting | What it does |
|---|---|
| Individual Contributor | Paine, Tetsu or Sudo. On the start screen, or in the pause menu to hot-swap mid-run. |
| Loadout | The two starting skills you pick on the pre-drop screen. |
| Auto-fire | Your primary attack fires on its own at the nearest enemy, leading moving targets. It prefers a boss unless a minion is right on top of you. Aiming yourself overrides it. |
| Manual aim (touch) | Twin-stick or Tap, when auto-fire is off. |
| Auto special | When you have enough of your resource: Paine's flame lights when enemies or bullets get close, Tetsu dashes into nearby enemies, and Sudo hacks crowds of 3+ (or a boss). |
| Music | Darksynth (generated) or Original. |
| Music / SFX volume | Sliders from 0 to 100. M or the speaker button still mutes everything. |

## Controls

**Keyboard and mouse**

| Action | Keys |
|---|---|
| Run | A / D or ← / → |
| Aim | W / S or ↑ / ↓ (combine with A / D for diagonals) |
| Jump | Space (again in the air to double jump; S + Space drops through a platform) |
| Primary attack | J (hold to keep attacking) or left click (aims at the cursor) |
| Special | K or right click. Paine: hold for the flame. Tetsu: dash. Sudo: overload at the cursor (or the biggest crowd). |
| Level-up cards | 1 / 2 / 3, arrows + Enter, or click. **R** rerolls (3 per run). |
| Pause | P or Esc. The pause menu has Respec and the IC hot-swap. |
| Mute | M |
| Show hitboxes | B (or open the page with `?debug`) |

**Touch**

| Control | What it does |
|---|---|
| Left stick (left half of the screen) | Run. Flick up to jump, and again in the air to double jump. Hold down on a platform to drop through. |
| Twin-stick (right half) | A second stick: push it in a direction to aim and fire that way. |
| Tap (right half) | Tap to fire toward that exact spot. Keep your finger down to rapid-fire, and drag to aim. |
| SPECIAL (bottom-right corner) | FLAME, DASH or HACK. Paine's flame toggles on and off with a tap. The ring shows your heat, focus or RAM. |

## How a run works
1. Press **Start**, pick your two loadout skills, and **Drop In**. Your IC leaps off a rooftop and lands in the street.
2. Enemies come from both sides, more of them and tougher as time goes on. New types join at 0:45 (ninjas), 1:20 (bombers), 1:50 (enforcers) and 2:20 (snipers), and elites get more common.
3. Kill enemies to drop XP chips, and walk near the chips to pull them in. Each level-up pauses the game and offers three hardware upgrades; reroll if you don't like them. Weapons fire on their own once you have them, except your primary and special.
4. Break crates for power-ups. Crates come back after a while.
5. At **2:30 the Overseer** arrives. Beat it and you get a breather (and some HP back).
6. 35 seconds later **NULL** materializes. Beat it for a life back and the RARE CACHE.
7. 35 seconds after that the **Demon GOAT**, the final boss, crashes down. Destroy it to win.
8. If your HP hits zero you lose a life and drop back in with full HP. Lose all 3 and the run is over.

## Difficulty
The curve is tuned with bot runs that play full games for each IC, with auto-fire and auto special on and basic dodging.
- **The pressure ramps up** until the Overseer, and again in the interludes after each boss: faster spawns, tougher enemies, new types and golden elites.
- **Bots** (perfect aim, clumsy dodging) always beat the Overseer and win about **5 runs in 6 with every IC**. They lose 1–2 of their 3 lives along the way, mostly to the bosses, so on a single life most of those runs would end at a boss.

**Learn the tells:**
- **The Overseer**: its cannon glow, the flash before a dash, and the red laser line.
- **NULL**: the shadow (only the real one has one), the violet glyph where it will reappear, the glint before a shuriken fan, and the aim line turning white before the rail shot.
- **The GOAT**: pawing the ground, crouching before a leap, a glowing mouth, and the red markers where meteors will land.
- **Shockwaves**: jump them.

## Easter eggs
Cyber City hides 8 secrets, little homages to the cyberpunk classics: *Blade Runner*, *Blade Runner 2049*, *Ghost in the Shell*, *Cyberpunk 2077* and *Cyberpunk: Edgerunners*.
- The start and pause menus track the ones you've found across runs.
- Tap an undiscovered icon for a hint.
- When you find one, a small neon sign lights up on the left side of the screen.

<details>
<summary>Spoilers</summary>

- **Tears in Rain**: stand completely still in the acid rain for a few seconds.
- **Interlinked**: stand still under the giant billboard hologram (or hold Up) to look up at her. Get close and she blows you kisses, which heal a little.
- **Mantis Blades**: hold Down at the RIPPERDOC booth to install arm blades that auto-slash.
- **Katana**: ride the highest moving platform in the arena. It parries enemy shots back.
- **Sandevistan**: get 77 kills in a run. When you're badly hurt, time slows down.
- **Ghost in the Shell**: dive from a rooftop all the way down to the street for thermoptic camo.
- **Jack In**: hold Down at a data terminal and hack it before the ICE traces you, then pick your daemon.
- **To the Moon**: run to the far east end of the street.

</details>

## Tests
Run `npm install`, then `npm test`. This plays the game in headless Chromium, on desktop and an emulated phone, through 45 tests:
- controls, auto-fire and auto special;
- the pre-drop loadout and hero landing;
- skill weighting, rare cards, rerolls and the half-second install pause;
- respec, 3 lives and the IC hot-swap;
- every IC's kit, facing and fire-plus-flame;
- the new enemies;
- all three bosses (entrances, no minions, the Overseer's vent, NULL's copies, blinks, shuriken, rail snipe and rewards, the GOAT's phases) through to a win;
- the DATABASE;
- the leaderboard (names, saving, persistence, keyboard safety);
- the hacking terminal on keyboard and phone;
- real audio under Chrome's autoplay policy, and the volume sliders;
- easter eggs, the billboard and the soundtrack;
- the touch controls.

GitHub Actions runs the same tests on every push and only deploys if they pass.

## Installation and setup
1. Clone or download the repository.
2. Open `index.html` in a browser, or serve the folder with any static server (for example `npx serve .` or `python3 -m http.server`) for the best audio on mobile.

## Deploying (GitHub Pages)
- The workflow in `.github/workflows/pages.yml` publishes the game to GitHub Pages on every push to `main`. You can also run it by hand from the Actions tab.
- Pull requests run the tests and a build check only.

## Code structure

| File | What's in it |
|---|---|
| `index.html` | The page, menus, level-up, loadout, respec, hacking terminal, leaderboard and touch controls |
| `style.css` | Responsive layout, menus, hardware cards, terminal, leaderboard and touch controls |
| `js/config.js` | Balance numbers, upgrades, power-ups and the map layout |
| `js/database.js` | The DATABASE: ICs (stats, kits, voice lines, lore), enemy types, bosses (HP, taunts), each upgrade's hardware look, and all the jokes. **Start here to tweak characters and enemies.** |
| `js/core.js` | Canvas, asset loading, drawing helpers and visual effects |
| `js/sound.js` | Web Audio unlock (autoplay rules), music and SFX volume buses, sound effects, and the original mp3 soundtrack |
| `js/music.js` | The generated darksynth soundtrack and the music setting |
| `js/input.js` | Keyboard, mouse, joysticks, buttons, tap gestures and settings |
| `js/world.js` | Platforms, crates, the street and the shared platformer physics |
| `js/pickups.js` | XP chips and power-ups |
| `js/player.js` | Movement, jumping, stats, Paine's energy ball and flame, auto weapons and drawing the hero |
| `js/heroes.js` | Tetsu's and Sudo's kits, plus facing, animation, effects and speech bubbles for all three |
| `js/lives.js` | The rooftop drop and hero landing, the 3 lives and the IC hot-swap |
| `js/enemies.js` | The spawn director, enemy AI, status effects and enemy shots |
| `js/bosses.js` | Shared boss machinery: cinematic entrances, minion derez, grounded movement, shockwaves, speech and the name card |
| `js/overseer.js` | The Overseer, the first boss |
| `js/null.js` | NULL, the second boss (with procedural fallback art until `img/null.png` lands) |
| `js/goat.js` | The Demon GOAT, the final boss |
| `js/upgrades.js` | XP, levels, hardware cards, rerolls, the pre-drop loadout, respec and THE LEGEND |
| `js/secrets.js` | The easter eggs, the billboard hologram, the hacking terminal and the neon notes |
| `js/codex.js` | The IC cards and the DATABASE screen |
| `js/leaderboard.js` | Scoring runs, name entry and the leaderboard panel (saved in localStorage) |
| `js/render.js` | Drawing the scene and the HUD |
| `js/main.js` | Game state, menus, layout and the main loop |
| `tests/game.test.cjs` | The automated browser tests |
| `tools/make_sprites.py` | Generates the new pixel art in `img/` |

**Leaderboard score** = kills ×10 + seconds survived ×2 + levels ×50 + bosses defeated ×1000 + 5000 for a win − 250 per life lost.

## Credits
- The Player, Demon Goat, Reaper and Dragon sprites, the backgrounds and the sounds are the original assets from this repository.
- All other pixel art in `img/` is generated by `tools/make_sprites.py`. That includes the ICs' new frames, the enemies, both bosses, THE LEGEND, the billboard and the hardware cards.
- THE LEGEND and the billboard are original characters: homages to the genre, not likenesses of real people.

## License
This project is open-source and available for modification. Have fun hacking and improving it!
