# Patch Notes

## v3.2: The Truth & Freedom Update (2026-11-20)

> *"Patched. Not fixed, patched. Story of this city."* (THE LEGEND)

### The world and its narrator
- **The story, in one breath:** "It's 2D77. The corps own the city, the cameras and the truth, and they rent all three back to you. Stop paying." It surfaces through the menu, run-start notes, DATABASE lore, boss intros and the city's own propaganda:
  - **Goldhorn** owns the city and the Overseer;
  - **Verity** sells the news and fills the billboards;
  - the **Bureau of Public Calm** flies the drones;
  - **NULL** is the assassin the Board denies hiring;
  - the **Demon GOAT** is the scapegoat monster Goldhorn built to excuse the curfews.
- **THE LEGEND is your narrator and skill guide.** He is an original hologram: dark hair with a silver streak, a beard, a cyan temple implant and a lot of opinions. He:
  - sizes up every level-up offer: rare cards, a heal when you need it, nothing for defense when you're bleeding;
  - explains the card you point at (hover, keyboard/pad focus, or a long press on phones), one short line per level of every skill, with the real numbers;
  - reacts to picks, rerolls, the loadout and respec;
  - is sarcastic, rebellious and anti-corporate: "Reroll. Refusing what you're offered is the first freedom."
- **Voice hooks:** every line has a stable id (`legend.skill.paine.zap.3`), goes through `narrator.say`, fires a `narrator:line` event and calls a voice player that only plays ids listed in its manifest. Drop in recordings and they play.
- New expressive art for him: talk, smirk and raised-eyebrow frames that follow his mood.

### Human characters, redrawn
- **Paine, Tetsu and Sudo:**
  - new 80x120 sprites drawn 1:1, with realistic-heroic proportions, faces and real idle and airborne poses;
  - one top-left key light and a rim light in each IC's color;
  - new superhero landings and portraits;
  - silhouettes you can tell apart at a glance: Paine the slim archer, Tetsu the armoured tank, Sudo slouched under his battery pack.
- **Tetsu is electric blue** (he shared Paine's red), and FOCUS is gold. The three ICs read as red, blue and green.
- **Also redrawn:** NULL (an armoured hooded ninja with a faceplate and energy blades), the billboard model (a confident, PG neon ad star) and the Cyber Ninja. THE LEGEND also gets a big bust.

### Character select
- **The centerpiece of the menu:**
  - a large stage with the IC's bust;
  - their dossier: role, difficulty, personality, background, playstyle and a quote;
  - weapon, special and passive with icons;
  - mechanics, resource, and stat bars scaled across the three ICs.
- Mouse, keyboard, pad and touch, with motion that respects reduced-motion settings.
- **Everywhere you pick an IC:** the pause menu's hot-swap shows the same stage, and so does player 2's join screen. The action holds while player 2 picks.

### Five new enemies
- **Fork Bomb** (fast pressure): rolls in, climbs after you, leaps; splits into two child processes when killed (three from an elite).
- **Packet Lobber** (artillery): keeps its distance on high ground. It lobs packets onto a floor marker where you're headed, so standing still gets you hit. Shoot the packets down, burn them, slice them or parry them back.
- **Legacy Monolith** (heavy armour):
  - three steel plates give it flat damage reduction, so chip damage barely scratches it;
  - plates break off and expose its glowing core;
  - piercing arrows, finishers and the dash get through;
  - no knockback, a slow turn, a slam that sends shockwaves along its floor, and a shoulder charge.
- **Hotfix** (support): a flying medic that tethers to the enemy that needs it most, heals it and gives it a one-hit shield bubble. Kill it first; arrows shoot it out of the sky.
- **Rate Limiter** (control): a walking signal tower whose 429 field halves your fire rate and locks your special. Step out, or collapse the field with a finisher or a dash.
- **New squads:** FORK STORM, ARTILLERY (an Enforcer shielding two Lobbers) and SIEGE (a Monolith with two Hotfixes).

### Enemy navigation, rebuilt
- **The bug:** enemies couldn't reach the top platforms. Walkers ran straight at your x and hopped at random. The city's zig-zag stairs (and routes that lead away from you first) left them piled up under you, hopping in place.
- **The fix:**
  - a navigation graph built from each mover's real jump physics: double jumps, drop-throughs, the Enforcer's grapple line, and moving platforms timed in flight;
  - shared route fields;
  - turn-taking at take-off points, and a watchdog that bans failing moves.
- **Now:** every walker type and every boss can reach every platform you can stand on, rooftops included. Flyers keep their spacing, and walkers spawn on a floor with a route to you. `?navdebug` draws the graph and every enemy's route.

### Hackerman's EMP: hijack
- **The trigger:** every System Glitch burst has a chance to **hijack** nearby enemies: 30% +1% per level, max 55%; up to 1-3 enemies per burst and 2-4 at once.
- **While hijacked (4-7 s), an enemy:**
  - fights its former allies with its own moves and attacks;
  - **taunts** nearby enemies into attacking it;
  - never hurts you, and ignores your bullet time.
- **Afterwards:** it reboots and is patched (immune) for 8 s.
- **Limits:**
  - bosses and NULL's decoys are immune;
  - elites and heavy types (Enforcer, Mecha Wyrm, Monolith, Rate Limiter) resist;
  - nothing a hijacked enemy does can glitch or hijack;
  - hijack damage earns no resource (no loops, no farming).
- **With the new enemies:** a hijacked Hotfix heals your pawns, a hijacked Rate Limiter jams enemies, and a hijacked Fork Bomb's children join you too.
- A green tint and a "PWNED" tag with a countdown ring show who's hijacked. The HUD shows GLITCH and HIJACK chances.

### The balance sheet
Your edits from `design/characters-and-skills.xlsx` are in:
- **Base stats:** Paine armour 0.3, speed 480, jump 1200; Tetsu armour 0.5, jump 1000; Sudo armour 0.1, speed 440, jump 900.
- **Cyber Bow:** one heavy arrow at every level; draw 0.5/0.4/0.35/0.33 s; pierce bonus +60/70/80% (the pierce cap rose to 90%). Its old multishot levels now give faster arrows (level 3) and longer boss bleeds (level 6).
- **Iaido Dash:** 480/490 px at levels 5/6.
- **EM Projector:** 0.7 s cooldown (0.6 s from level 6), waves 100-140 tall, 16 damage from level 7.
- **Time Dilation:** 1.5 s, 2 s from level 4, 2.5 s at level 6.

### Consistency audit fixes
- **Broken:**
  - Hot-swapping away from Hackerman (or dying) mid Time Dilation left the world in slow motion for good.
  - Expired bleeds and burns kept their strength.
  - Time Dilation's heartbeat kept playing on pause and game over.
- **Exploits:**
  - The hacking terminals gave a free level every minute; each DATAMINE in a run is now worth half the last.
  - The billboard's kisses were free regen; they now heal at most 30 HP a run.
  - A knocked-out player 2 could leave and re-join at full HP without spending a life.
- **Bosses:**
  - Boss intros ran on slow-motion time.
  - Auto specials fired during intros.
  - Tetsu's level-8 stagger cancelled the Overseer's laser and its vent window.
  - System Glitch kept bosses stuttering 38% of a fight (now at most once every 2.5 s).
  - Sniper shots couldn't be reflected.
- **Visuals:** parried shuriken, meteors and rings turned into the old energy ball, and fx2 skill icons were cropped.
- **Phones:** the HUD's boss block moved to the bottom edge, lives no longer cover the boss countdown, and the touch hint wraps.
- **Texts:**
  - Tetsu blocks 50% (not 25%), and the Monoblade is weaker on bosses.
  - Chain Lightning hits up to 7.
  - The Repair Kit heals 48.
  - The resource pickup names HEAT, FOCUS or RAM.
  - Rare passive cards add up both levels.
  - The co-op skill card describes both ICs.
  - Lose lines fit what ended the run.
  - The how-to text describes the current kits.
- **Names:** borrowed franchise corporation and ICE names in signs and terminals were replaced with the game's own world. The eight secrets are untouched.

### Tests
- 116 browser tests (80 in v3.1), plus the desktop app's.
- `ONLY="name part" npm test` runs a subset.

## v3.1: The Desktop & Signature Update (2026-11-18)

> *"There is no spoon. There is only technical debt."* (THE LEGEND)

### Desktop app and display
- **Cyberpunk 2D77 is a desktop app** (Electron) for Windows x64, Linux x64 (AppImage and .deb) and Intel macOS.
  - It runs fully offline with the pixel font bundled.
  - It needs no click to start the audio.
  - It remembers its window, and the AppImage and Windows builds update themselves in the background.
  - Tagging a version (`v3.1.0`) builds every installer and attaches it to a GitHub Release.
- **Display settings:**
  - Windowed or Fullscreen, kept in sync with the fullscreen button and F11.
  - A **Resolution** list (Auto, 720p up to 4K): in fullscreen and in the browser it sets the internal render size, and in the desktop app's window it resizes the window.
- The browser version now uses the bundled font too, so it no longer needs Google Fonts.

### Controllers
- **Xbox, PlayStation (DualShock 4 / DualSense) and generic pads** in both the browser and the desktop app.
- **Mapping:** left stick moves, A jumps, RT is primary, LT is special, and the right stick aims and fires.
- **Menus:** every menu, the loadout, level-ups, respec, the DATABASE, the leaderboard and the hacking terminal work with a pad, with the right button prompts (A/B/X/Y or ✕/○/□/△).
- **Dual-stick with auto-fire:** the left stick always moves and the right stick aims. Auto-fire fires where the right stick points, and picks its own target only when the stick is centered. The touch twin-stick works the same way.
- Optional rumble.

### Local co-op (2 players)
- **Joining:** press Start or A on a second controller, on the menu or mid-run, to drop in as Player 2. Single player stays the default.
- **Shared:** team XP, level-ups and upgrades, and a shared pool of 3 lives. A downed partner drops back in after a few seconds.
- **Enemies:** they hunt the nearest player.
- **Camera:** it frames you both.
- **HUD:** P2 gets its own panel and a tag over its head.
- **Two-player scaling:** spawns ×1.5, enemy HP ×1.25, boss HP ×1.4.
- **Limitations:** Player 2 needs a controller, easter eggs are Player 1's, and there's no split screen.

### Signature kits
- **PAINE is now the CYBER WIDOW.** The energy ball is gone.
  - **Cyber Bow:** draw and release heavy arrows, with a visible draw pose and sound; letting go early cancels the shot.
  - **Arrow effects:**
    - they knock enemies back;
    - they have a **15% chance to pierce**, rising 2% per level (shown on the HUD);
    - they **shoot flyers out of the sky**, and downed bombers explode;
    - enemies knocked off ledges take **fall damage** that grows with the height.
  - **Bosses** can't be shoved, but **bleed**.
  - **Flame On** (special): a radial heat wave from her heat-proof suit. It shoves enemies, burns them, and melts bullets, on a 3.5 s cooldown.
- **TETSU, the Ronin: Mirror Steel.**
  - Reflects **15% of all incoming damage** back at whoever dealt it, +1% per level up to 40%.
  - From level 8, reflections stagger; from level 16, they splash to two more enemies.
  - Reflected damage can never loop.
- **SUDO is now HACKERMAN.**
  - **EM Projector:** a hacked electromagnetic wave projector, wired to his laptop and a backpack battery. Its waves grow, pass through everything and slow it.
  - **System Glitch:** every hit has a 15%+ chance to make the whole area stutter like a lagging stream.
  - **Time Dilation** (special): bullet time. Enemies and bullets slow to a crawl while he moves at full speed and hits 40%+ harder, in a rain of green code.
- New art for the Widow and Hackerman (sprites, landings, portraits), new attack effects, and **unique synthesized sounds** for every IC: bow creak and twang, arrow thunk, falling whistle, heat-wave roar, steel ricochet, EM zaps, glitch stutter, bullet-time drop.

### A third boss: NULL
- **NULL, "the assassin who isn't there"**, arrives between the Overseer and the GOAT. Its moves:
  - **Copies:** it splits into holographic copies, and only the real one casts a shadow. Hitting a copy pops it and reveals the real one.
  - **Blink strikes:** it teleports to a glowing glyph and slashes.
  - **Shuriken fans.**
  - **Rail snipe:** a shot from the rooftops, after a locking aim line.
  - **Smoke bombs.**
- It has its own glitch entrance, its own boss bar ("REAL TARGET: ?") and its own sounds.
- **Phases:** below 60% it's MULTITHREADED, and below 25% it hits STACK OVERFLOW.
- **Rewards:** +1 life and a **RARE CACHE** (your next level-up is all rare cards).

### Difficulty
- **Coordinated squads** arrive together, announced on screen:
  - **PINCER**: ninjas from both sides;
  - **DRONE ESCORT**: a wyrm behind a drone screen;
  - **BOMBING RUN**: bombers diving from the sky;
  - **SHIELD WALL**: an enforcer covering two snipers.
- Busier interludes between bosses, a few more elites late in a run, and slightly shorter boss weak-point windows.
- In bot playtests every IC still usually wins, but loses 1–2 of its 3 lives along the way.

### Skills and XP
- **Skill cards are 3:4 movie posters.** Three in a row on level-up; the pre-drop loadout is a **4 × 3 wall**.
- **Guidance on every loadout skill:** a color-coded role (OFFENSE, DEFENSE, MOBILITY or UTILITY), what it does, its edge, its mechanic, and a limitation or synergy.
- **The reroll button** is a big amber arcade button. It shows "3 LEFT", its keyboard key and controller button, spins its die, and greys out at zero.
- **XP drops as shiny hardware:**
  - RAM sticks, NVMe SSDs and, from big kills, CPUs;
  - a shine sweep, a glow and a satisfying zip-in with sparkles, "+XP" and rising chimes;
  - chips left lying around slowly drift to you.

### Performance
- **A performance pass**, measured with a new benchmark (`npm run bench`). Frames are about 30% cheaper in heavy scenes:
  - glow sprites are cached and the cache stays bounded (it used to leak a canvas every frame);
  - tinted sprites are cached;
  - the backdrop is pre-scaled, and the sky gradient is skipped when it's invisible;
  - particles are pooled;
  - per-frame page updates are gone;
  - the desktop package is smaller.
- **Performance mode** (a setting next to Resolution):
  - renders at a lower internal resolution;
  - halves the particles;
  - drops purely decorative glows, glitch ghosting and most of the rain;
  - simplifies the effects.

  Frames are 4–6× cheaper in heavy scenes. Enemies, bullets, every boss tell and the HUD look the same. If the game keeps running slowly, it suggests the mode once.

### Fixes
- Fixed a crash when Ronin's reflection killed a boss while bullets were in flight.
- Fixed a long bow draw swallowing quick taps in tap-to-fire mode.
- Fixed several timing-sensitive tests.

---

## v3.0: The Individual Contributor Update (2026-11-17)

> *"Every bug is a feature you haven't met yet."* (THE LEGEND)

The biggest update yet: new bosses that fight back like players, a full hardware-themed upgrade system, lives, a leaderboard, real hacking, and working audio in Chrome.

### Individual Contributors
- The playable characters (Paine, Tetsu and Sudo) are now called **Individual Contributors** (ICs).
- **Hot-swap**: change IC from the pause menu at any time. Levels, upgrades, lives and HP percentage carry over.
- **The Drop**: every run opens with your IC leaping off a rooftop and slamming into the street in a superhero landing (new landing art for all three). Enemies near the impact get knocked away.
- **3 lives**: when your HP hits zero you "roll back to the last stable build". You glitch out, then drop back in with full HP while nearby enemies get shoved back. Your third death ends the run. The HUD shows your remaining lives next to your health.

### Skills and level-ups
- **Hardware level-ups**: the level-up screen is bigger and always shows three cards in a single row, even on phones. Each card is a piece of PC hardware: a GPU for your primary, a neural chip for your special, CPUs, RAM, PSUs, network cards and coolers for the rest.
- **Install animation**: picking a card slams it forward with sparks and an **INSTALLED** stamp while the others drop away. The game stays paused for half a second, then a ring bursts out around you.
- **Rare cards**: "overclocked" parts with a rainbow edge that give **+2 levels** at once.
- **Rerolls**: 3 per run. Use the button or press **R**.
- **Pre-drop loadout**: before each run, pick **2 starting skills**. They start a level higher, appear **3x as often** in level-ups, and are **3x as likely to be rare**.
- **Respec**: from the pause menu, refund every skill point and redistribute them however you like.

### Bosses
- **Boss fights are one-on-one**: when a boss arrives, every minion glitches out of existence (their XP stays behind) and nothing else spawns until it's down.
- **Cinematic entrances**: letterbox bars, the camera frames you both, the boss crashes in, and a big name card slides across the screen.
- Bosses now **fight like rival characters**: on the ground, with running, jumping, platform-hopping, a telegraph before every attack, and trash talk in speech bubbles.
- **The Overseer** (first boss, 2:30) now pilots a humanoid combat chassis. It has five attacks:
  - arm-cannon bursts, with a glow before it fires;
  - a dash straight through you, with a flash before it goes;
  - a leaping ground slam that sends shockwaves both ways (jump them);
  - a sweeping eye laser that starts as a red aiming line;
  - after every laser, it **overheats and kneels with its core exposed** and takes 50% extra damage.

  Below half health it rages.
- **The Demon GOAT is now the final boss.** It crashes down from a burning sky as a towering cyber-demon and fights on the ground:
  - **Charge**: it paws the ground first. Dodge it into a wall and it's **dazed**.
  - **Leap**: it lands with a quake and shockwaves.
  - **Fire breath**: a sweeping cone.
  - **Meteor rain**: red markers show where they'll land.

  Three phases: normal, ENRAGED, and **FINAL FORM**. Killing it plays a slow-motion death scene.
- Boss taunts: *"BAAAH. Your pull request is REJECTED."*

### Hacking
- **Jacking in is redesigned** as a full-screen hacker terminal, with CRT glow, scanlines and an ICE eye that watches you as the trace meter fills. In order, you:
  1. type `nmap` (any key or tap auto-types);
  2. pick the vulnerable service (watch for CVE-2077-1337);
  3. crack the password by locking in characters;
  4. run `sudo`;
  5. choose which daemon to upload: SHORT CIRCUIT, DATAMINE or OVERCLOCK.

  It takes about 15–20 seconds and is generous with timing. If the ICE traces you, you take a little damage.

### Leaderboard
- Enter a **display name** at the end of a run and **save your score**. The leaderboard lives in your browser, so it survives refreshes and restarts.
- A **Leaderboard** button on the menu shows the top 10: name, IC, score, time, kills, level, and WIN or KIA.
- Score = kills ×10 + seconds ×2 + levels ×50 + bosses ×1000 + 5000 for a win − 250 per life lost.

### Presentation
- **Easter-egg messages** are now small, translucent neon signs down the **left side** of the screen, instead of letterbox subtitles over the action.
- **The billboard hologram** is now a giant, flashy projection, Blade Runner style. It has light beams, color cycling, chromatic ghosting, scanlines and glitch slices. Get close and she turns toward you and **blows kisses** that float over and heal a little.
- **THE LEGEND** is a zen action-hero hologram who appears on the loadout and level-up screens. He comments on your choices with wise, sometimes philosophical, always nerdy one-liners.
- **Software-developer humor** throughout:
  - menu tips;
  - respawn messages ("git revert HEAD // LIFE RESTORED");
  - game over ("Process exited with code 137: OOM-killed by a goat");
  - boss taunts, new IC voice lines, and the hacking terminal.

### Audio
- **Fixed: no sound in Chrome.** Audio now unlocks on your first click, tap or key press, as Chrome's autoplay rules require. It also comes back after the tab was hidden or the device interrupted it.
- A saved mute is now shown in the menu (**MUTED**). Errors are no longer swallowed silently.
- New **Music volume** and **SFX volume** sliders, remembered between visits. M still mutes everything.

### Balance
- Bosses hit much harder.
- Bosses ignore Paine's flame immunity, and the GOAT's hellfire and meteors can't be melted.
- Tetsu's blade and dash do 55% damage to bosses.
- In bot playtests every IC wins about 5 runs in 6 but loses 1–2 lives along the way, mostly to the bosses.

### Fixes
- Fixed a crash when the Overseer was stunned in the middle of its laser.
- Fixed starting a new run after losing a life: enemies didn't spawn until the old death time.
- Long banners shrink to fit the screen.
- Made a timing-sensitive automated test less flaky.

### Under the hood
- New files:
  - `js/lives.js`: drop, lives, hot-swap
  - `js/bosses.js`: shared boss machinery
  - `js/goat.js`: the final boss
  - `js/leaderboard.js`
- New art: hero landings, the billboard and kisses, THE LEGEND, hardware cards, the Overseer chassis and the final GOAT, all generated by `tools/make_sprites.py`.
- **44 automated browser tests**, desktop and phone, run on every push before deploying.

---

## v2.0: Runners

- Two new playable characters: **Tetsu**, a melee ronin with a monoblade and the Iaido Dash, and **Sudo**, a netrunner with AoE Glitch Orbs and the System Overload crowd stun.
- Characters face the way they fire, with attack animations, squash and stretch, and speech bubbles.
- Four new enemies (Cyber Ninja, Bomber Drone, shielded Enforcer, Sniper Sentry) plus golden elites and status effects.
- A second boss, the **Overseer**.
- The **DATABASE** screen.
- A difficulty curve tuned with bot simulations.

## v1.5: Neon City

- Cyberpunk re-skins for the enemies.
- Auto-fire with assisted aim, and auto flame.
- Twin-stick touch controls; a flick up on the left stick jumps.
- A much taller neon-drenched city.
- An edgier darksynth soundtrack.
- The first automated tests, plus CI.

## v1.4: Synthwave

- A generated synthwave soundtrack.
- A reworked tap-to-fire scheme on touch.

## v1.3: Easter Eggs

- 8 hidden homages to Blade Runner, Ghost in the Shell, Cyberpunk 2077 and Edgerunners.

## v1.2: Survivors

- Vampire Survivors-style upgrades and power-ups.
- Heat only comes from dealing or taking damage.
- Easier melee and ranged enemies.
- Platforms and a scrollable map.
- New art.
- Touch tap controls.

## v1.1: Polish and mobile

- Hitbox fixes and gameplay polish.
- Mobile support.
- Deployed to GitHub Pages.

## v1.0: Original release

- Paine versus the Demon Goat.
