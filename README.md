Cyberpunk 2D77 (don't sue me ProjectRed)

Play it: https://jonathanjiwu.github.io/Cyberpunk-2D77/
Old site: https://cyberpunk-2d77.netlify.app

Overview
  It's year 2D77 and you're a cyber badass running the neon streets of Cyber City. This is a side-scrolling action platformer with a Vampire Survivors style run: hordes of enemies keep coming, they drop XP chips, and every level-up lets you pick one of three upgrades. Survive until 2:30 and the Demon Goat shows up for the final fight. It plays on desktop (keyboard and mouse) and on phones and tablets (touch).

Features
  A tall, scrolling neon city: parallax skylines, flying-car traffic, rooftops to climb, rain-slick reflections, one-way and moving platforms, and breakable supply crates
  Four kinds of cyberpunk minions, melee and ranged: Glitch Crawlers, Chrome Reapers, Security Drones and Mecha Wyrms
  The Demon Goat boss (now with cyberware), which chases you, rains fireballs and gets enraged at half health
  Level-up upgrades: 6 weapons (Energy Ball, Flame Aura, Orbit Shards, Seeker Missiles, Shock Stomp, Chain Lightning) and 6 passives (Cyber Heart, Servo Legs, Magnet Coil, Nano Armor, Heat Sink, Overclock)
  Power-ups dropped by crates and enemies: health, heat cell, Overdrive (rapid fire), Shield, Magnet and an EMP blast
  Heat: the flame runs on heat, which only builds up when you deal or take damage (it never refills on its own)
  Optional auto-fire with assisted aim, and optional auto flame
  Touch controls: twin-stick (left stick runs and jumps, right stick aims and fires) or tap to fire
  An original darksynth soundtrack, "Neon Inferno", generated live in the browser. It builds up, then gets nastier when the boss arrives. The original "Disconnected" track is still available in the menu.
  Scales to any screen size, portrait or landscape, with fullscreen support where available
  Pause, mute and restart without reloading the page; hitbox debug view
  8 hidden easter eggs (see below)
  Automated browser tests that run before every deploy

Settings (start and pause menus, remembered between visits)
  Auto-fire: the energy ball fires on its own at the nearest enemy, leading moving targets. Aiming yourself still overrides it.
  Manual aim (touch, when auto-fire is off): Twin-stick or Tap.
  Auto flame: the flame lights itself when enemies get close and you have enough heat, and goes out when they're gone.
  Music: Darksynth (generated) or Original.

Controls
  Keyboard and mouse
    Run: A / D or Left / Right
    Aim: W / S or Up / Down (combine with A / D for diagonals)
    Jump: Space (press again in the air to double jump; S + Space drops through a platform)
    Energy ball: J (hold to keep firing) or left mouse button (fires at the cursor)
    Flame: K or right mouse button (hold). Burns everything around you and the goat can't touch you while it's lit. Costs heat.
    Level-up cards: 1 / 2 / 3, or arrows + Enter, or click
    Pause: P or Esc
    Mute: M
    Show hitboxes: B (or open the page with ?debug)
  Touch
    Left stick (left half of the screen): run. Flick it up to jump, flick it up again in the air to double jump. Hold it down on a platform to drop through.
    Twin-stick: the right half of the screen is a second stick. Push it in a direction to aim and fire that way.
    Tap: tap anywhere on the right to fire toward that exact spot; keep your finger down to rapid-fire and drag to aim.
    FLAME: the button in the bottom-right corner (hold). The ring around it shows your heat.

How a run works
  Enemies come from both sides of the screen, and more of them come (and tougher) as time goes on.
  Kill them to drop XP chips. Walk near the chips to pull them in (Magnet Coil pulls from further away).
  Each level-up pauses the game and offers three upgrades. Weapons fire on their own once you have them, except the Energy Ball and Flame.
  Break crates for power-ups. Crates come back after a while.
  At 2:30 the Demon Goat arrives. Beat it to win. If your HP hits zero, the run is over.

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
  controls, auto-fire, auto flame, the climbing camera, a fast-forwarded 3-minute run, some easter eggs and the soundtrack.
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
  js/config.js: all the balance numbers, enemy types, upgrades, power-ups and the map layout. Start here to tweak the game.
  js/core.js: canvas, asset loading, drawing helpers and visual effects
  js/sound.js: Web Audio sound effects (falls back to <audio>) and the original mp3 soundtrack
  js/music.js: the generated darksynth soundtrack and the music setting
  tests/game.test.cjs: the automated browser tests
  js/input.js: keyboard, mouse, joystick, buttons and tap gestures
  js/world.js: platforms, crates, the street and the shared platformer physics
  js/player.js: movement, jumping, the energy ball, the flame and the auto weapons
  js/enemies.js: the spawn director, enemy AI, enemy shots and the Demon Goat
  js/pickups.js: XP chips and power-ups
  js/upgrades.js: XP, levels and the upgrade cards
  js/secrets.js: the easter eggs (rain, hologram, ripperdoc, katana, Sandevistan, camo, breach, moon)
  js/render.js: drawing the scene and the HUD
  js/main.js: game state, menus, layout and the main loop
  tools/make_sprites.py: generates the new pixel-art sprite sheets in img/ (drone, crawler, pickups, icons, projectiles, platform, crate, skyline, ground, and the easter-egg art)

Credits
  Player, Demon Goat, Reaper and Dragon sprites, backgrounds and sounds are the original assets from this repository.
  The other pixel art in img/ is generated by tools/make_sprites.py.

License
  This project is open-source and available for modification. Have fun hacking and improving it!
