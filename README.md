Cyberpunk 2D77 (don't sue me ProjectRed)

Play it: https://jonathanjiwu.github.io/Cyberpunk-2D77/
Old site: https://cyberpunk-2d77.netlify.app

Overview
  It's year 2D77 and you're a cyber badass running the neon streets of Cyber City. This is a side-scrolling action platformer with a Vampire Survivors style run: pick one of three Individual Contributors (ICs) and two starting skills, drop into the city with a superhero landing, and fight off hordes of enemies that drop XP chips; every level-up lets you install one of three hardware upgrades. You have 3 lives. At 2:30 the Overseer (the city's security AI, now in a combat chassis) shows up, and once it falls, the Demon GOAT comes for the final fight. It plays on desktop (keyboard and mouse) and on phones and tablets (touch).

Individual Contributors
  PAINE // Pyro Runner (110 HP). Energy Ball + Flame Aura, on HEAT. The all-rounder: fire and keep the flame lit at the same time; the flame burns everything around you and melts incoming bullets. Hot-blooded: earns heat 20% faster.
  TETSU // Chrome Ronin (150 HP, blocks 25% of all damage). Monoblade + Iaido Dash, on FOCUS. Melee: a three-hit combo whose last hit is a 360-degree finisher that breaks shields, and swings parry bullets. The dash slices through everything in its path and leaves him guarded.
  SUDO // Netrunner (80 HP). Glitch Orb + System Overload, on RAM. The crowd-control "wizard": orbs explode in an area and slow, the overload stuns and exposes a whole crowd (and deletes their bullets), and a firewall shrugs off one hit every 10 seconds.
  Each IC has their own sprite, attack animations, hero landing, portrait, voice lines and upgrade path (8 levels for the primary, 6 for the special).
  Swap ICs from the pause menu at any time: levels, upgrades, lives and resource carry over.

Features
  A tall, scrolling neon city: parallax skylines, flying-car traffic, rooftops to climb, rain-slick reflections, one-way and moving platforms, and breakable supply crates
  Eight kinds of cyberpunk enemies, joining as the run goes on: Glitch Crawlers, Chrome Reapers, Security Drones, Cyber Ninjas (wind up, then dash), Mecha Wyrms, Bomber Drones (arm and explode), Enforcers (riot shield: hit them from behind, stun them, or break the guard) and Sniper Sentries (a laser sight, then a fast shot). Golden elites hit harder and drop more XP.
  Two bosses that fight like rival ICs, on the ground, with telegraphed attacks, trash talk and cinematic entrances (letterbox + name card). Minions derez when a boss arrives (their XP stays) and nothing else spawns until it's down.
    The Overseer: runs, double-jumps onto rooftops, fires arm-cannon bursts, dashes through you, leaps and slams the ground (shockwaves: jump them) and sweeps its eye laser, after which it overheats and kneels with its core exposed.
    The Demon GOAT (final boss): crashes down from a burning sky, then charges (make it hit the wall and it's dazed), leaps and quakes the ground, breathes fire, and calls down meteors. Three phases, the last one "FINAL FORM", and a proper death scene.
  Three lives: dying rolls back to your last stable build and drops you back in
  Hardware level-ups: three cards in a row, each a piece of PC hardware (GPU, CPU, RAM, PSU, NIC...). Installing one plays a short animation (the game pauses for half a second). Rare cards give +2 levels. 3 rerolls per run.
  Pre-drop loadout: pick 2 starting skills. They start a level up and show up 3x as often (and are 3x as likely to be rare) in level-ups.
  Respec (pause menu): refund every skill point and spend them again
  THE LEGEND: a hologram that hangs around the loadout and level-up screens dispensing zen and debugging wisdom
  The DATABASE screen (from the menu): every IC, enemy, boss and skill. Enemies and bosses stay encrypted until you meet them.
  Your IC faces the way they're firing, with attack animations, squash and stretch on jumps and landings, dust, muzzle flashes and speech bubbles
  Software-developer humor throughout: tips, respawns, game over screens, bosses, ICs and the Legend
  Level-up upgrades: 6 weapons (Energy Ball, Flame Aura, Orbit Shards, Seeker Missiles, Shock Stomp, Chain Lightning) and 6 passives (Cyber Heart, Servo Legs, Magnet Coil, Nano Armor, Heat Sink, Overclock)
  Power-ups dropped by crates and enemies: health, heat cell, Overdrive (rapid fire), Shield, Magnet and an EMP blast
  Heat / Focus / RAM: each IC's special runs on a resource that only builds up when you deal or take damage (it never refills on its own)
  Optional auto-fire with assisted aim, and optional auto special
  Touch controls: twin-stick (left stick runs and jumps, right stick aims and fires) or tap to fire
  An original darksynth soundtrack, "Neon Inferno", generated live in the browser. It builds up, then gets nastier when the boss arrives. The original "Disconnected" track is still available in the menu.
  Scales to any screen size, portrait or landscape, with fullscreen support where available
  Pause, mute and restart without reloading the page; hitbox debug view
  8 hidden easter eggs (see below)
  Jacking in is a real-feeling hack: a full-screen terminal where you nmap the network, pick the vulnerable service, crack the password, sudo, and upload a daemon of your choice, while the ICE traces you
  A leaderboard: enter a display name at the end of a run; scores (with time, kills, level, IC and result) are saved in your browser and survive refreshes and restarts. Score = kills x10 + seconds x2 + levels x50 + bosses x1000 + 5000 for a win - 250 per life lost.
  Audio that starts on your first click, tap or key press (Chrome's autoplay rules), recovers when the tab is hidden or the device interrupts it, with Music and SFX volume sliders
  Automated browser tests that run before every deploy

Settings (start and pause menus, remembered between visits)
  Individual Contributor: Paine, Tetsu or Sudo (the cards at the top of the menu; also in the pause menu to hot-swap mid-run).
  Loadout: the two starting skills you pick on the pre-drop screen.
  Auto-fire: your primary attack fires on its own at the nearest enemy, leading moving targets. Aiming yourself still overrides it.
  Manual aim (touch, when auto-fire is off): Twin-stick or Tap.
  Auto special: Paine's flame lights when enemies or bullets get close; Tetsu dashes into nearby enemies; Sudo hacks crowds of 3+ (or a boss). Only when you have enough of the resource.
  Music: Darksynth (generated) or Original.
  Music volume and SFX volume sliders (M or the speaker button still mutes everything).

Controls
  Keyboard and mouse
    Run: A / D or Left / Right
    Aim: W / S or Up / Down (combine with A / D for diagonals)
    Jump: Space (press again in the air to double jump; S + Space drops through a platform)
    Primary attack: J (hold to keep attacking) or left mouse button (aims at the cursor)
    Special: K or right mouse button. Paine: hold for the flame. Tetsu: dash (aim with the keys or the mouse). Sudo: overload at the cursor, or the biggest crowd nearby.
    Level-up cards: 1 / 2 / 3, or arrows + Enter, or click. R rerolls (3 per run).
    Pause: P or Esc (the pause menu has Respec and the IC hot-swap)
    Mute: M
    Show hitboxes: B (or open the page with ?debug)
  Touch
    Left stick (left half of the screen): run. Flick it up to jump, flick it up again in the air to double jump. Hold it down on a platform to drop through.
    Twin-stick: the right half of the screen is a second stick. Push it in a direction to aim and fire that way.
    Tap: tap anywhere on the right to fire toward that exact spot; keep your finger down to rapid-fire and drag to aim.
    SPECIAL: the button in the bottom-right corner (FLAME / DASH / HACK). Paine's flame toggles on and off with a tap, so your right thumb stays free to aim. The ring around it shows your heat / focus / RAM.

How a run works
  Press Start, pick your two loadout skills, and Drop In: your IC leaps off a rooftop and lands in the street.
  Enemies come from both sides of the screen, and more of them come (and tougher) as time goes on.
  Kill them to drop XP chips. Walk near the chips to pull them in (Magnet Coil pulls from further away).
  New enemy types join at 0:45 (ninjas), 1:20 (bombers), 1:50 (enforcers) and 2:20 (snipers), and elites get more common.
  Each level-up pauses the game and offers three hardware upgrades (reroll if you don't like them). Weapons fire on their own once you have them, except your primary and special.
  Break crates for power-ups. Crates come back after a while.
  At 2:30 the Overseer arrives. Beat it and you get a breather (and some HP back); 40 seconds later the Demon GOAT, the final boss, crashes down. Destroy it to win.
  If your HP hits zero you lose a life and drop back in with full HP. Lose all 3 and the run is over.

Difficulty
  The curve is tuned with bot runs that play full games for each IC (auto-fire and auto special on, basic dodging):
  the pressure ramps up (faster spawns, tougher enemies, new types, golden elites) until the Overseer, and again in the
  interlude before the GOAT. Bots (perfect aim, clumsy dodging) always beat the
  Overseer and win about 5 runs in 6 with every IC, but they lose 1 to 2 of their 3 lives along the way, mostly to the bosses.
  On a single life, most of those runs would end at a boss.
  Learn the tells: the Overseer's cannon glow, dash flash and red laser line; the GOAT pawing the ground, crouching
  before a leap, its glowing mouth, and the red markers where meteors will land. Jump the shockwaves.
  With auto-fire on, your attacks prefer a boss unless a minion is right on top of you.

Easter eggs
  Cyber City hides 8 secrets, little homages to the cyberpunk classics: Blade Runner, Blade Runner 2049,
  Ghost in the Shell, Cyberpunk 2077 and Cyberpunk: Edgerunners. The start and pause menus track the ones
  you've found across runs. Tap an undiscovered icon for a hint.
  Spoilers:
    Tears in Rain: stand completely still in the acid rain for a few seconds.
    Interlinked: stand still under the giant billboard hologram (or hold Up) to look up at her. Get close and she blows you kisses (they heal a little).
    Mantis Blades: hold Down at the RIPPERDOC booth to install arm blades that auto-slash.
    Katana: ride the highest moving platform in the arena. It parries enemy shots back.
    Sandevistan: get 77 kills in a run. When you're badly hurt, time slows down.
    Ghost in the Shell: dive from a rooftop all the way down to the street for thermoptic camo.
    Jack In: hold Down at a data terminal and hack it (mash keys or tap) before the ICE traces you: pick your daemon.
    To the Moon: run to the far east end of the street.

Tests
  npm install, then npm test. This plays the game in headless Chromium (desktop and an emulated phone):
  controls, auto-fire, auto special, the pre-drop loadout and hero landing, skill weighting, rare cards and rerolls, the
  half-second install pause, respec, 3 lives, IC hot-swap, neon easter-egg notes and the billboard, the climbing camera,
  a fast-forwarded 3-minute run, character select, each IC's kit,
  facing while firing, firing with the flame lit, the new enemies, both bosses (entrances, no minions, vent, GOAT phases)
  through to a win, the DATABASE screen,
  the touch SPECIAL button, some easter eggs and the soundtrack.
  GitHub Actions runs the same tests on every push, and only deploys if they pass.

Installation & Setup
  Clone or download the repository.
  Open index.html in a browser, or serve the folder with any static server
  (for example: npx serve . or python3 -m http.server) for the best audio on mobile.

Deploying (GitHub Pages)
  The workflow in .github/workflows/pages.yml publishes the game to GitHub Pages
  on every push to main (or run it by hand from the Actions tab).
  Pull requests run a quick build check only.

Code Structure
  index.html: the page, menus, level-up screen and touch controls
  style.css: responsive layout, menus, cards and touch controls
  js/config.js: the balance numbers, upgrades, power-ups and the map layout
  js/database.js: the DATABASE: Individual Contributors (stats, kits, voice lines, lore), enemy types, bosses (HP, taunts), the hardware look of each upgrade and all the jokes. Start here to tweak characters and enemies.
  js/core.js: canvas, asset loading, drawing helpers and visual effects
  js/sound.js: Web Audio unlock (autoplay rules), music/SFX volume buses, sound effects (falls back to <audio>) and the original mp3 soundtrack
  js/leaderboard.js: scoring runs, the name entry and the leaderboard panel (saved in localStorage)
  js/music.js: the generated darksynth soundtrack and the music setting
  tests/game.test.cjs: the automated browser tests
  js/input.js: keyboard, mouse, joystick, buttons and tap gestures
  js/world.js: platforms, crates, the street and the shared platformer physics
  js/lives.js: the rooftop drop and hero landing, the 3 lives and the IC hot-swap
  js/player.js: movement, jumping, stats, Paine's energy ball and flame, the auto weapons and drawing the hero
  js/heroes.js: Tetsu's and Sudo's kits, plus facing, animation, effects and speech bubbles for all three
  js/enemies.js: the spawn director, enemy AI (ninja, bomber, enforcer, sniper...), status effects and enemy shots
  js/bosses.js: shared boss machinery: cinematic entrances, minion derez, grounded movement, shockwaves, speech, the name card
  js/overseer.js: the Overseer, the first boss
  js/goat.js: the Demon GOAT, the final boss
  js/codex.js: the Individual Contributor cards and the DATABASE screen
  js/pickups.js: XP chips and power-ups
  js/upgrades.js: XP, levels, the hardware upgrade cards, rerolls, the pre-drop loadout, respec and THE LEGEND
  js/secrets.js: the easter eggs (rain, the billboard hologram, ripperdoc, katana, Sandevistan, camo, jack-in, moon) and the neon notes
  js/render.js: drawing the scene and the HUD
  js/main.js: game state, menus, layout and the main loop
  tools/make_sprites.py: generates the new pixel-art sprite sheets in img/ (Tetsu, Sudo, Paine's attack frames, portraits, the new enemies, the Overseer, effects, pickups, icons, the city and the easter-egg art)

Credits
  Player, Demon Goat, Reaper and Dragon sprites, backgrounds and sounds are the original assets from this repository.
  The other pixel art in img/ is generated by tools/make_sprites.py.

License
  This project is open-source and available for modification. Have fun hacking and improving it!
