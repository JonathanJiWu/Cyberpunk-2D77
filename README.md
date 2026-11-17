Cyberpunk 2D77 (don't sue me ProjectRed)

Play it: https://jonathanjiwu.github.io/Cyberpunk-2D77/
Old site: https://cyberpunk-2d77.netlify.app

Overview
  It's year 2D77 and you're a cyber badass running the neon streets of Cyber City. This is a side-scrolling action platformer with a Vampire Survivors style run: pick one of three runners, then fight off hordes of enemies that drop XP chips; every level-up lets you pick one of three upgrades. At 2:30 the Demon Goat shows up, and once it falls, the Overseer (the city's security AI) comes online for the final fight. It plays on desktop (keyboard and mouse) and on phones and tablets (touch).

Runners
  PAINE // Pyro Runner (120 HP). Energy Ball + Flame Aura, on HEAT. The all-rounder: fire and keep the flame lit at the same time; the flame burns everything around you and melts incoming bullets. Hot-blooded: earns heat 40% faster.
  TETSU // Chrome Ronin (150 HP, blocks 25% of all damage). Monoblade + Iaido Dash, on FOCUS. Melee: a three-hit combo whose last hit is a 360-degree finisher that breaks shields, and swings parry bullets. The dash slices through everything in its path and leaves him guarded.
  SUDO // Netrunner (70 HP). Glitch Orb + System Overload, on RAM. The crowd-control "wizard": orbs explode in an area and slow, the overload stuns and exposes a whole crowd (and deletes their bullets), and a firewall shrugs off one hit every 10 seconds.
  Each runner has their own sprite, attack animations, portrait, voice lines and upgrade path (8 levels for the primary, 6 for the special).

Features
  A tall, scrolling neon city: parallax skylines, flying-car traffic, rooftops to climb, rain-slick reflections, one-way and moving platforms, and breakable supply crates
  Eight kinds of cyberpunk enemies, joining as the run goes on: Glitch Crawlers, Chrome Reapers, Security Drones, Cyber Ninjas (wind up, then dash), Mecha Wyrms, Bomber Drones (arm and explode), Enforcers (riot shield: hit them from behind, stun them, or break the guard) and Sniper Sentries (a laser sight, then a fast shot). Golden elites hit harder and drop more XP.
  Two bosses: the Demon Goat (now with cyberware), which charges, rains fireballs and enrages at half health; then the Overseer, which fires bullet rings, sweeps a telegraphed laser across the street, fires aimed barrages and calls in drones
  The DATABASE screen (from the menu): every runner, enemy, boss and skill. Enemies and bosses stay encrypted until you meet them.
  Your runner faces the way they're firing, with attack animations, squash and stretch on jumps and landings, dust, muzzle flashes and speech bubbles
  Level-up upgrades: 6 weapons (Energy Ball, Flame Aura, Orbit Shards, Seeker Missiles, Shock Stomp, Chain Lightning) and 6 passives (Cyber Heart, Servo Legs, Magnet Coil, Nano Armor, Heat Sink, Overclock)
  Power-ups dropped by crates and enemies: health, heat cell, Overdrive (rapid fire), Shield, Magnet and an EMP blast
  Heat / Focus / RAM: each runner's special runs on a resource that only builds up when you deal or take damage (it never refills on its own)
  Optional auto-fire with assisted aim, and optional auto special
  Touch controls: twin-stick (left stick runs and jumps, right stick aims and fires) or tap to fire
  An original darksynth soundtrack, "Neon Inferno", generated live in the browser. It builds up, then gets nastier when the boss arrives. The original "Disconnected" track is still available in the menu.
  Scales to any screen size, portrait or landscape, with fullscreen support where available
  Pause, mute and restart without reloading the page; hitbox debug view
  8 hidden easter eggs (see below)
  Automated browser tests that run before every deploy

Settings (start and pause menus, remembered between visits)
  Runner: Paine, Tetsu or Sudo (the cards at the top of the menu).
  Auto-fire: your primary attack fires on its own at the nearest enemy, leading moving targets. Aiming yourself still overrides it.
  Manual aim (touch, when auto-fire is off): Twin-stick or Tap.
  Auto special: Paine's flame lights when enemies or bullets get close; Tetsu dashes into nearby enemies; Sudo hacks crowds of 3+ (or a boss). Only when you have enough of the resource.
  Music: Darksynth (generated) or Original.

Controls
  Keyboard and mouse
    Run: A / D or Left / Right
    Aim: W / S or Up / Down (combine with A / D for diagonals)
    Jump: Space (press again in the air to double jump; S + Space drops through a platform)
    Primary attack: J (hold to keep attacking) or left mouse button (aims at the cursor)
    Special: K or right mouse button. Paine: hold for the flame. Tetsu: dash (aim with the keys or the mouse). Sudo: overload at the cursor, or the biggest crowd nearby.
    Level-up cards: 1 / 2 / 3, or arrows + Enter, or click
    Pause: P or Esc
    Mute: M
    Show hitboxes: B (or open the page with ?debug)
  Touch
    Left stick (left half of the screen): run. Flick it up to jump, flick it up again in the air to double jump. Hold it down on a platform to drop through.
    Twin-stick: the right half of the screen is a second stick. Push it in a direction to aim and fire that way.
    Tap: tap anywhere on the right to fire toward that exact spot; keep your finger down to rapid-fire and drag to aim.
    SPECIAL: the button in the bottom-right corner (FLAME / DASH / HACK). Paine's flame toggles on and off with a tap, so your right thumb stays free to aim. The ring around it shows your heat / focus / RAM.

How a run works
  Enemies come from both sides of the screen, and more of them come (and tougher) as time goes on.
  Kill them to drop XP chips. Walk near the chips to pull them in (Magnet Coil pulls from further away).
  New enemy types join at 0:45 (ninjas), 1:20 (bombers), 1:50 (enforcers) and 2:20 (snipers), and elites get more common.
  Each level-up pauses the game and offers three upgrades. Weapons fire on their own once you have them, except your primary and special.
  Break crates for power-ups. Crates come back after a while.
  At 2:30 the Demon Goat arrives. Beat it and you get a breather (and some HP back); 40 seconds later the Overseer comes online. Destroy it to win. If your HP hits zero, the run is over.

Difficulty
  The curve is tuned with bot runs that play full games for each runner (auto-fire and auto special on, basic dodging):
  bots almost always reach the goat, beat it most of the time, and win roughly 15 to 50% of runs depending on the runner.
  The Overseer is the real test: learn its laser telegraph and jump the bullet rings.

Easter eggs
  Cyber City hides 8 secrets, little homages to the cyberpunk classics: Blade Runner, Blade Runner 2049,
  Ghost in the Shell, Cyberpunk 2077 and Cyberpunk: Edgerunners. The start and pause menus track the ones
  you've found across runs. Tap an undiscovered icon for a hint.
  Spoilers:
    Tears in Rain: stand completely still in the acid rain for a few seconds.
    Interlinked: stand still under the giant hologram ad (or hold Up) to look up at her.
    Mantis Blades: hold Down at the RIPPERDOC booth to install arm blades that auto-slash.
    Katana: ride the highest moving platform in the arena. It parries enemy shots back.
    Sandevistan: get 77 kills in a run. When you're badly hurt, time slows down.
    Ghost in the Shell: dive from a rooftop all the way down to the street for thermoptic camo.
    Jack In: hold Down at a data terminal and solve the breach grid for a daemon.
    To the Moon: run to the far east end of the street.

Tests
  npm install, then npm test. This plays the game in headless Chromium (desktop and an emulated phone):
  controls, auto-fire, auto special, the climbing camera, a fast-forwarded 3-minute run, character select, each runner's kit,
  facing while firing, firing with the flame lit, the new enemies, both bosses through to a win, the DATABASE screen,
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
  js/database.js: the DATABASE: runners (stats, kits, voice lines, lore), enemy types and bosses. Start here to tweak characters and enemies.
  js/core.js: canvas, asset loading, drawing helpers and visual effects
  js/sound.js: Web Audio sound effects (falls back to <audio>) and the original mp3 soundtrack
  js/music.js: the generated darksynth soundtrack and the music setting
  tests/game.test.cjs: the automated browser tests
  js/input.js: keyboard, mouse, joystick, buttons and tap gestures
  js/world.js: platforms, crates, the street and the shared platformer physics
  js/player.js: movement, jumping, stats, Paine's energy ball and flame, the auto weapons and drawing the hero
  js/heroes.js: Tetsu's and Sudo's kits, plus facing, animation, effects and speech bubbles for all three
  js/enemies.js: the spawn director, enemy AI (ninja, bomber, enforcer, sniper...), status effects, enemy shots and the Demon Goat
  js/overseer.js: the Overseer, the final boss
  js/codex.js: the character select cards and the DATABASE screen
  js/pickups.js: XP chips and power-ups
  js/upgrades.js: XP, levels and the upgrade cards
  js/secrets.js: the easter eggs (rain, hologram, ripperdoc, katana, Sandevistan, camo, breach, moon)
  js/render.js: drawing the scene and the HUD
  js/main.js: game state, menus, layout and the main loop
  tools/make_sprites.py: generates the new pixel-art sprite sheets in img/ (Tetsu, Sudo, Paine's attack frames, portraits, the new enemies, the Overseer, effects, pickups, icons, the city and the easter-egg art)

Credits
  Player, Demon Goat, Reaper and Dragon sprites, backgrounds and sounds are the original assets from this repository.
  The other pixel art in img/ is generated by tools/make_sprites.py.

License
  This project is open-source and available for modification. Have fun hacking and improving it!
