# Cyberpunk 2D77
*(don't sue me ProjectRed)*

**▶ Play it: https://jonathanjiwu.github.io/Cyberpunk-2D77/**
(old site: https://cyberpunk-2d77.netlify.app)

It's year 2D77 and you're a cyber badass running the neon streets of Cyber City. **Cyberpunk 2D77** is a side-scrolling action platformer with a Vampire Survivors-style run. Each run goes like this:

1. Pick an **Individual Contributor** (IC) and two starting skills.
2. Drop into the city with a superhero landing.
3. Fight off hordes of enemies that drop XP chips. Every level-up lets you install one of three hardware upgrades.
4. At **2:30** the **Overseer** arrives. Next comes **NULL**, the assassin who isn't there. Once it falls, the **Demon GOAT** comes for the final fight.

You have **3 lives**. The game plays on desktop (keyboard and mouse, or a game controller) and on phones and tablets (touch).

## What's new in v3.1: The Desktop & Signature Update
- **Desktop app** (Electron) for Windows, Linux and Intel macOS, plus **fullscreen and resolution** options.
- **Game controllers**: Xbox, PlayStation and generic pads, with dual-stick aiming that works with auto-fire.
- **Signature kits**:
  - **PAINE** is now the **Cyber Widow**, with a cyber bow and a Flame On heat wave.
  - **TETSU** reflects damage back at his attackers.
  - **SUDO** is now **Hackerman**, with an EM projector, System Glitch and Time Dilation bullet time.
- **A third boss**, NULL, "the assassin who isn't there".
- **Coordinated enemy squads**.
- **Skill cards as 3:4 posters**, an unmissable reroll button, guidance on every starting skill, and XP that drops as **shiny RAM, NVMe and CPU parts**.
- **Unique sounds** for every IC, boss and pickup, synthesized live.
- **Performance mode** and **local 2-player co-op** (see below).

Full details are in **[PATCH_NOTES.md](PATCH_NOTES.md)**.

## Individual Contributors

| IC | HP | Primary | Special (resource) | Style |
|---|---|---|---|---|
| **PAINE** // Cyber Widow | 110, blocks 30% of damage | Cyber Bow | Flame On (HEAT) | Precision archer. Draw and release one heavy arrow at a time: it knocks enemies back and usually pierces (15% + 2% per level + the bow's 60-80% bonus, max 90%). Arrows shoot flyers out of the sky, and enemies knocked off ledges take fall damage. Bosses can't be shoved but bleed. Flame On is a radial heat wave from her heat-proof suit: it shoves, burns and melts bullets, on a short cooldown. |
| **TETSU** // Chrome Ronin | 150, blocks 50% of damage | Monoblade | Iaido Dash (FOCUS) | Melee. A three-hit combo with a 360° shield-breaking finisher; swings parry bullets. The dash slices through everything and leaves him guarded. **Mirror Steel** reflects 15% of all incoming damage back at the attacker (+1% per level, max 40%). From level 8 reflections stagger minions; from level 16 they splash to two more enemies. The Monoblade and the dash are weaker on bosses. |
| **SUDO** // Hackerman | 80, blocks 10% of damage | EM Projector | Time Dilation (RAM) | Electronic warfare. A hacked EM wave projector, wired to his laptop and a backpack battery, fires tall waves that pass through everything and slow it. **System Glitch**: each hit has a 15%+ chance to make the whole area stutter. Time Dilation is bullet time: the world slows to a crawl while he moves at full speed and hits 40%+ harder, in a rain of green code. |

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
- **Screens**: it scales to any screen size, portrait or landscape, with fullscreen where available and a resolution setting (lower runs faster).
- **Desktop app** for Windows, macOS and Linux (see [Desktop app](#desktop-app)). The web version needs no internet once loaded either: the font is bundled.
- **8 hidden easter eggs** (see below).
- **80 automated browser tests** run before every deploy, plus 6 tests that play the packaged desktop app.

## Settings
These are on the start and pause menus and remembered between visits.

| Setting | What it does |
|---|---|
| Individual Contributor | Paine, Tetsu or Sudo. On the start screen, or in the pause menu to hot-swap mid-run. |
| Loadout | The two starting skills you pick on the pre-drop screen. |
| Auto-fire | Your primary attack fires on its own at the nearest enemy, leading moving targets. It prefers a boss unless a minion is right on top of you. Aiming yourself overrides it. |
| Manual aim (touch) | Twin-stick or Tap, when auto-fire is off. |
| Auto special | When you have enough of your resource: Paine's Flame On fires when enemies or bullets get close, Tetsu dashes into nearby enemies, and Sudo's Time Dilation kicks in against crowds, bullet storms or a boss when he's hurt. It waits while a boss makes its entrance. |
| Music | Darksynth (generated) or Original. |
| Music / SFX volume | Sliders from 0 to 100. M or the speaker button still mutes everything. |
| Rumble | Controller rumble on hits and hero landings. Shown while a pad is in use. |
| Display | Windowed or Fullscreen, kept in sync with the fullscreen button at the top right. In the browser it uses the browser's fullscreen (hidden on iPhones, which have none), and a page always opens windowed. In the desktop app it is the real window, also on F11, and it is remembered. |
| Resolution | Auto, or 1280x720 up to 3840x2160 (4K). In the browser and in fullscreen it is the game's internal render size: the picture still fills the screen, so a lower one runs faster and a higher one looks sharper. Auto matches your screen, up to 1080p. In the desktop app's windowed mode it also resizes the window to that size, shrunk to fit your screen. The line under it says what it does and the size the game is rendering at. |
| Performance mode | For slower computers and phones: fewer effects and, with Resolution on Auto, a lower render size. See [Performance](#performance). |

## Controls

**Keyboard and mouse**

| Action | Keys |
|---|---|
| Run | A / D or ← / → |
| Aim | W / S or ↑ / ↓ (combine with A / D for diagonals) |
| Jump | Space (again in the air to double jump; S + Space drops through a platform) |
| Primary attack | J (hold to keep attacking) or left click (aims at the cursor) |
| Special | K or right click: Paine's Flame On, Tetsu's Iaido Dash, Sudo's Time Dilation. |
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
| SPECIAL (bottom-right corner) | FLAME ON, DASH or SLOW-MO. The ring shows your heat, focus or RAM. |

## Controllers
Plug in a pad (USB or Bluetooth) and press any button. A toast confirms it (**CONTROLLER CONNECTED: Xbox**) and every prompt switches to that pad's buttons. It uses the standard Gamepad API, so it works the same in Chrome, Edge and the Electron app.

**Supported pads**
- **Xbox** 360, One and Series pads (XInput), and any pad that reports itself as one.
- **PlayStation** DualShock 4 and DualSense.
- **Generic** USB and Bluetooth pads. A pad without the browser's "standard" mapping gets a fallback: axes 0/1 run, axes 2/3 aim (3/4 on six-axis pads, whose triggers sit on 2 and 5), and buttons 0-3 are the face buttons.

| Action | Xbox | PlayStation | Generic |
|---|---|---|---|
| Run | Left stick or D-pad | Left stick or D-pad | Left stick or D-pad |
| Jump (again in the air to double jump) | A | ✕ | 1 |
| Drop through a platform | Down + A | Down + ✕ | Down + 1 |
| Primary attack | RT (or RB, X) | R2 (or R1, □) | R2 (or R1, 3) |
| Special | LT (or LB, B) | L2 (or L1, ○) | L2 (or L1, 2) |
| Aim and fire that way | Right stick | Right stick | Right stick |
| Pause and resume | MENU | OPTIONS | START |
| DATABASE (from menus) | VIEW | SHARE | SELECT |

**Menus**: every screen works with a pad. The D-pad or left stick moves a neon focus ring, A selects, B goes back, Y rerolls the level-up cards, and LB / RB switch the DATABASE tabs. Start starts a run on the title screen, drops in from the loadout, and pauses or resumes. The right stick scrolls long panels. In the hacking terminal, A types (hold it to keep typing) and locks, and the D-pad picks. On the game-over screen, A on **Save score** saves the prefilled name (or an anonymous one), so there's no typing.

**Auto-fire**: the two sticks stay independent. The left stick only moves. While you push the right stick, it aims and fires that way; once it's centred, auto-fire picks the target again. The touch twin-stick works the same way.

**Rumble**: taking damage and hero landings rumble the pad. Turn it off with the Rumble setting, which shows while a pad is in use. Losing player 1's pad mid-run pauses the game.

**More than one pad**: the first pad you use is player 1, alongside the keyboard and touch. Another pad pressing Start or A joins as player 2 (see [Local co-op](#local-co-op-2-players)).

**For developers** (`js/gamepad.js`):
- `padPrompt("A")` returns the label for the pad in use (`"A"`, `"✕"` or `"1"`), or `null` when the player isn't on a pad.
- `<body>` gets `pad-xbox`, `pad-ps`, `pad-generic` or `pad-none`, following the last-used input device.
- Elements with `data-pad="Y"` are relabelled automatically, and `window` gets a `padchange` event when the device changes.
- `gamepads.slots`, `gamepads.read(slot)`, `gamepads.onJoinRequest = (padIndex) => {}` and `gamepads.onSlotPoll = (screen, dt) => {}` are the hooks `js/coop.js` uses.

## Local co-op (2 players)
Optional: with one player nothing changes. A second player joins with a controller and you fight side by side on one screen.

**Joining**
- Press **Start** or **A** on a second controller (MENU / OPTIONS, A / ✕).
  - On a menu, player 2 is ready: a toast confirms it, a **P2** tag marks their IC on the cards, and they drop in with player 1 when the run starts.
  - Mid-run, a join panel opens at the top right. Left / right picks an IC, A or Start drops in (after 12 seconds it drops in by itself) and B backs out. Player 2 falls in next to player 1 with the hero landing.
- Player 2 starts as a different IC from player 1. To change it later, pause and pick an IC card **with player 2's pad**: a hot-swap applies to the player whose controller clicked it.
- Keyboard plus one controller? Pause and pick **Pad to P2**. Player 1 keeps the keyboard, mouse and touch, and the pad becomes player 2's.
- **P2: Leave** (pause menu, game-over screen or title menu) takes player 2 out. Their pad can join again at any time.

**Controls**: player 1 keeps the keyboard, mouse, touch and pad 1. Player 2 uses only their own pad, with the same layout: left stick run, right stick aim and fire, A jump, RT / LT primary and special, Start pause. Either pad can drive the menus, including the level-up cards.

**Rules**
- **Shared by the team**: XP, levels and upgrades (one level-up screen; the primary and special cards upgrade each player's own IC), the rerolls, respec and the 3 lives.
- **Per player**: IC, HP, resource, stats, power-ups and specials.
- **Lives**: a downed player drops back in after 3 seconds, spending a life from the team's pool. With no life left to spend they're out until the team gets one back (NULL's reward), while the other fights on. The run ends only when both are down with no life left.
- **Enemies** go after the nearest player (a boss commits to its target for a few seconds). Contact, shots, bomber blasts, shockwaves, the Overseer's laser and NULL's slashes and rail shot hit whichever player they reach. Ronin's reflection, the Widow's Flame On and Hackerman's specials work per player. Time Dilation slows the enemies for both players, but only Hackerman gets its damage bonus.
- **Pickups**: XP chips fly to the nearest player, and a power-up goes to whoever touches it. Beating a boss heals both players.
- **Difficulty**: enemies spawn 1.5x as fast, up to 1.25x as many at once, with 1.25x HP. Bosses have 1.4x HP, rescaled if player 2 joins or leaves mid-fight. These were tuned with bot runs: each player takes about the damage a solo player does, the team loses about as many lives, and boss fights take about as long.
- **Camera**: it frames both players. Neither can walk out of view: whoever walks away is held at the edge. Climbing far above the other player is capped, and a player stranded high above their partner for 1.5 seconds is pulled down next to them.
- **HUD**: player 2's panel at the top right (portrait, HP, resource and passive), P1 / P2 tags over the heroes, and cyan / amber outlines.
- **Leaderboard**: co-op runs are marked **2P**.

**Limitations**
- Two players at most, and player 2 needs a controller: there is no second keyboard or touch player.
- The easter eggs, jacking in, and the chrome they give (Mantis Blades, the katana, Sandevistan, camo) are player 1's. Jacking in pauses the run for both.
- The assists (auto-fire, auto special) and the rumble setting are shared.
- On the title menu the first pad used is always player 1's, so joining there needs two pads. With one, use **Pad to P2** from the pause menu.
- One shared screen, no split screen.

**For developers** (`js/coop.js`): the game was written around one global `player`, with `stats`, `input`, `intro` and the hero effect arrays (`playerShots`, `missiles`, `slashFx`, `heatWaves`, `kitFx`...) next to it. Those are now `let` bindings, and each player has a context with its own copies. `withPlayer(ctx, fn)` points the globals at a player while a per-player system runs. `forEachPlayer(fn)` loops over every player, and `eachTarget(fn)` over the players an attack can reach. Enemies think with their target bound (`coopTargetFor`). Outside those calls the globals are player 1's, so single player runs the same code paths as before. `upg` and `progress` stay global: they are the team's.

## How a run works
1. Press **Start**, pick your two loadout skills, and **Drop In**. Your IC leaps off a rooftop and lands in the street.
2. Enemies come from both sides, more of them and tougher as time goes on. New types join at 0:45 (ninjas), 1:20 (bombers), 1:50 (enforcers) and 2:20 (snipers), and elites get more common.
   - From 0:55, **coordinated squads** arrive together, announced on screen:
     - **PINCER**: ninjas from both sides;
     - **DRONE ESCORT**: a wyrm behind a drone screen;
     - **BOMBING RUN**: bombers diving from the sky;
     - **SHIELD WALL**: an enforcer covering two snipers.
3. Kill enemies to drop XP, which lands as shiny hardware: RAM sticks, NVMe SSDs and, from the biggest kills, CPUs. Walk near it to pull it in. Anything left lying around for a few seconds slowly drifts toward you. Each level-up pauses the game and offers three hardware upgrades; reroll if you don't like them. Weapons fire on their own once you have them, except your primary and special.
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
Run `npm install`, then `npm test`. This plays the game in headless Chromium, on desktop and an emulated phone, through 80 tests:
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
- the touch controls, including the twin-stick with auto-fire on;
- game controllers (mocked pads): connecting, play, auto-fire with two sticks, every menu, the hacking terminal and the button prompts;
- local co-op (mocked pads): joining mid-run and on the menus, independent movement and kits, the camera, nearest-player targeting, hits on the right player, shared lives and respawns, a shared level-up, all three bosses;
- the bundled font (no internet, canvas text waits for it) and the display settings: fullscreen in sync with the HUD button, a refused fullscreen request, resolution, persistence and the phone layout;
- Performance mode: it persists and applies live, the slow-frame tip, far fewer expensive canvas calls in a heavy scene, and a frame-time check in both modes.

GitHub Actions runs the same tests on every push and only deploys if they pass. The desktop app has its own tests, see [Desktop app](#desktop-app).

## Performance
**Performance mode** (on the start and pause menus) is for slower computers and phones. Everything you need to read a fight looks the same: enemies, bullets, telegraphs (laser lines, NULL's glyphs and aim lines, meteor markers, wind-ups), hit flashes, boss tells and the HUD. It cuts the rest:
- **Resolution**: with Resolution on Auto it renders at two thirds of your screen's pixels across, up to 720p. A resolution you pick yourself is kept.
- **Particles**: half as many per burst, at most 90 at once (instead of 260), and fewer damage numbers.
- **Glows**: no decorative ones (street lamps, signs, platform under-glow, street reflections, boss auras, the moon), and no glitch ghosting on enemies.
- **Backdrop and weather**: no stars or flying traffic, and a third of the rain without splashes.
- **Effects**: a plainer billboard hologram, XP chips without their glow, shorter Time Dilation code rain, lighter Flame On rings, and cheap flat overlays instead of full-screen gradients for the hit flash and bullet time.

If frames stay slow (under about 45 fps for 5 seconds of play), the game suggests Performance mode, once.

The normal mode got faster too, with the same look. The backdrop photo is scaled once instead of every frame, the sky, haze and building shading come from cached gradient strips, and the sky gradient is skipped on the street, where it is invisible. Tinted sprites (hit flashes, stuns, ghosts) are cached, and glow sprites no longer pile up a new canvas every frame for animated colours. Particles are recycled, and the neon notes are painted once. The touch SPECIAL button only touches the page when its state changes.

**Benchmark**: `npm run bench` plays heavy scenes in headless Chromium in both modes: a late-game swarm, each boss (the Overseer's laser, NULL with copies, the GOAT's meteors and fire breath), Hackerman's Time Dilation, the Widow's Flame On, and rain with the billboard. For each it prints per-frame update, render and raster times (mean / p95 / worst), the expensive canvas calls per frame (gradients, shadow blur, text, images, save/restore, new canvases) and the allocation rate. Options:
- `--scene=swarm,goat` and `--mode=normal|perf`;
- `--viewport=1280x720`, `--frames=300`, `--repeat=3` (medians);
- `--baseline=<another checkout>` runs an older copy side by side and prints before → after;
- `--sites` (top allocation sites), `--profile` (CPU time per function), `--ablate=drawRain` (stub a function out to see what it costs), `--json=out.json`.

Headless Chromium has no GPU, so "raster" is the software pixel cost; compare runs from the same machine.

## Installation and setup
1. Clone or download the repository.
2. Open `index.html` in a browser, or serve the folder with any static server (for example `npx serve .` or `python3 -m http.server`) for the best audio on mobile. Nothing is loaded from the internet: the font is in `fonts/`.

Or install the desktop app from the [Releases](https://github.com/JonathanJiWu/Cyberpunk-2D77/releases) page.

## Desktop app
The same game, packaged with Electron as a desktop app for Windows, macOS and Linux:
- it works offline;
- audio starts without a click;
- it remembers the window's size and position, and fullscreen;
- the menu has a **Quit** button;
- keys: **F11** fullscreen, **Ctrl+Q** quit. There is no menu bar (macOS keeps its usual app menu).

Settings, the leaderboard and the window state live in the app's own data folder, separate from the browser's: `~/.config/Cyberpunk 2D77` (Linux), `%APPDATA%\Cyberpunk 2D77` (Windows), `~/Library/Application Support/Cyberpunk 2D77` (macOS). Its log is `logs/main.log` in there.

**Run it from the source**

```sh
npm install
npm run desktop
```

In development, F12 (or Ctrl+Shift+I) opens the developer tools and Ctrl+R reloads.

**Build the installers.** They appear in `dist/`, named with the version and architecture:

| Command | Builds | Build it on |
|---|---|---|
| `npm run dist:linux` | `Cyberpunk-2D77-3.1.0-linux-x86_64.AppImage` and `Cyberpunk-2D77-3.1.0-linux-amd64.deb` (x64) | Linux |
| `npm run dist:win` | `Cyberpunk-2D77-3.1.0-win-x64.exe`, an NSIS installer (x64) | Windows (elsewhere it needs Wine) |
| `npm run dist:mac` | `Cyberpunk-2D77-3.1.0-mac-x64.dmg` (Intel x64) | macOS |
| `npm run dist` | the installers for the system you are on | |
| `npm run pack:linux` | just the unpacked app, `dist/linux-unpacked/cyberpunk-2d77` (the quickest, for testing) | Linux |

Only the game goes in: `index.html`, `style.css`, `js/`, `img/`, `sound/`, `fonts/` and `desktop/`, not the tests or tools. The icon, `desktop/icon.png`, is Paine's portrait, made by `python3 tools/make_icon.py`.

**Test the packaged app.** `npm run test:electron` builds `dist/linux-unpacked` and plays it with Playwright, under `xvfb-run` when there is no display. It checks that:
- the menu renders offline with the bundled font and no console errors;
- the page has no Node.js and no devtools;
- audio runs without a click;
- a run starts (Start, loadout, Drop In) and takes input;
- fullscreen, F11 and the resolution apply live and stay in sync with the HUD button;
- everything comes back after a relaunch;
- Quit closes the app.

If there is an AppImage in `dist/` (from `npm run dist:linux`), it is launched too, with the update check running offline. `node tests/electron.test.cjs` tests an existing build, and `node tests/electron.test.cjs --dev` tests `npm run desktop` instead.

**Release a version**
1. Bump the version: `npm version 3.1.0 --no-git-tag-version`, then commit.
2. Tag it and push the tag: `git tag v3.1.0 && git push origin v3.1.0`. The tag must match `package.json`.
3. `.github/workflows/desktop.yml` then:
   - builds the installers on Linux, Windows and macOS (Intel);
   - smoke-tests the packaged Linux app;
   - attaches the installers to the tag's GitHub Release, on the [Releases](https://github.com/JonathanJiWu/Cyberpunk-2D77/releases) page. Tags with a `-` (`v3.1.0-beta.1`) become pre-releases.

   Run it by hand from the Actions tab to only build: the installers are then under that run's **Artifacts**.

**Updates.** The AppImage and the Windows version check the GitHub Releases a few seconds after they start. A newer version downloads in the background and installs when you quit. There are never any pop-ups. Offline or failed checks are only logged. The .dmg and the .deb don't update themselves: download the new version from Releases. (macOS only installs signed updates, and the .deb belongs to your package manager.) Set `CP2D77_NO_UPDATE=1` to turn updates off.

**Unsigned builds.** The repository has no code-signing certificates, so:
- **Windows**: SmartScreen may say "Windows protected your PC". Choose *More info*, then *Run anyway*.
- **macOS**: the app isn't signed or notarized. Right-click it and choose *Open* the first time, or run `xattr -dr com.apple.quarantine "/Applications/Cyberpunk 2D77.app"`.

To sign, add the certificates as repository secrets (`CSC_LINK` and `CSC_KEY_PASSWORD`; for macOS notarization, also `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`), pass them to the build step, and remove `CSC_IDENTITY_AUTO_DISCOVERY: "false"` from the workflow.

**Security.** The game page runs sandboxed, with context isolation and no Node.js. It only sees `window.desktop`: display mode, window size and quit. It only loads files from the game folder (served as `app://cp2d77/`, with a strict Content-Security-Policy), and it can't navigate away or open windows.

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
| `js/core.js` | Canvas, asset loading, drawing helpers (cached glows, tinted sprites, gradient strips), visual effects and `perfMode()` |
| `js/sound.js` | Web Audio unlock (autoplay rules), music and SFX volume buses, sound effects, and the original mp3 soundtrack |
| `js/music.js` | The generated darksynth soundtrack and the music setting |
| `js/synthfx.js` | Procedural sound effects (every IC, boss, pickup and UI sound), synthesized live; open the game with `?sounds` for a sound lab |
| `js/input.js` | Keyboard, mouse, joysticks, buttons, tap gestures and settings |
| `js/gamepad.js` | Game controllers: pad types, deadzones, gameplay mapping, menu navigation, button prompts, rumble and player slots |
| `js/world.js` | Platforms, crates, the street and the shared platformer physics |
| `js/pickups.js` | XP chips and power-ups |
| `js/player.js` | Movement, jumping, stats, the arrow/EM/shot projectiles, damage to the player (with Ronin's reflection), auto weapons and drawing the hero |
| `js/heroes.js` | Tetsu's blade and dash, plus facing, animation, effects and speech bubbles for all three ICs |
| `js/lives.js` | The rooftop drop and hero landing, the 3 lives and the IC hot-swap |
| `js/kits.js` | The signature kits: the Widow's bow and Flame On, Ronin's Mirror Steel, Hackerman's EM projector, System Glitch and Time Dilation, and the enemy effects they cause (downed flyers, fall damage, bleeding, glitch stutter) |
| `js/coop.js` | Local co-op: player contexts and binding, joining and leaving, targets, shared lives, the camera leash and player 2's HUD |
| `js/enemies.js` | The spawn director, enemy AI, status effects and enemy shots |
| `js/bosses.js` | Shared boss machinery: cinematic entrances, minion derez, grounded movement, shockwaves, speech and the name card |
| `js/overseer.js` | The Overseer, the first boss |
| `js/null.js` | NULL, the second boss |
| `js/goat.js` | The Demon GOAT, the final boss |
| `js/upgrades.js` | XP, levels, hardware cards, rerolls, the pre-drop loadout, respec and THE LEGEND |
| `js/secrets.js` | The easter eggs, the billboard hologram, the hacking terminal and the neon notes |
| `js/codex.js` | The IC cards and the DATABASE screen |
| `js/leaderboard.js` | Scoring runs, name entry and the leaderboard panel (saved in localStorage) |
| `js/render.js` | Drawing the scene and the HUD |
| `js/main.js` | Game state, menus, layout and the main loop |
| `tests/game.test.cjs` | The automated browser tests |
| `tools/make_sprites.py` | Generates the new pixel art in `img/` |
| `tools/bench.cjs` | The performance benchmark (`npm run bench`) |
| `js/display.js` | The display settings (fullscreen, resolution, Performance mode and its slow-frame tip) and the desktop app's Quit button |
| `fonts/` | Press Start 2P, bundled so the game needs no internet |
| `desktop/main.js` | The desktop app (Electron): the window and its saved state, keys, serving the game, auto-update |
| `desktop/preload.js` | The small `window.desktop` API the page gets in the desktop app |
| `tests/electron.test.cjs` | Tests that play the packaged desktop app |
| `tools/make_icon.py` | Makes the desktop app's icon, `desktop/icon.png`, from Paine's portrait |
| `.github/workflows/desktop.yml` | Builds the desktop installers and attaches them to a release |

**Leaderboard score** = kills ×10 + seconds survived ×2 + levels ×50 + bosses defeated ×1000 + 5000 for a win − 250 per life lost.

## Credits
- The Player, Demon Goat, Reaper and Dragon sprites, the backgrounds and the sounds are the original assets from this repository.
- All other pixel art in `img/` is generated by `tools/make_sprites.py`. That includes the ICs' new frames, the enemies, both bosses, THE LEGEND, the billboard and the hardware cards.
- THE LEGEND and the billboard are original characters: homages to the genre, not likenesses of real people.
- The font is [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) by CodeMan38, under the SIL Open Font License 1.1 (`fonts/OFL.txt`).

## License
This project is open-source and available for modification. Have fun hacking and improving it!
