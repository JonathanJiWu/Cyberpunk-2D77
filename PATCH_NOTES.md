# Patch Notes

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
