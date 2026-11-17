Cyberpunk 2D77 (don't sue me ProjectRed)

Live website: https://cyberpunk-2d77.netlify.app
GitHub Pages: https://jonathanjiwu.github.io/Cyberpunk-2D77/

Overview
  Welcome to Cyber City. This is a fast-paced 2D action game where you control a cyber warrior battling a demonic goat. Use your agility and powerful attacks to survive and defeat your enemy. It plays on desktop (keyboard) and on phones and tablets (on-screen touch controls).

Features
  Pixel-art sprite animation with smooth, frame-rate independent movement
  Keyboard controls and mobile touch controls (floating joystick + buttons)
  Scales to any screen size, portrait or landscape, with fullscreen support where available
  Demon Goat AI that chases you, flies up to throw fireballs, and becomes enraged at half health
  Hitboxes that match what you see on screen (press B to show them)
  Health, heat and damage feedback (hit flashes, screen shake, particles)
  Pause, mute and restart without reloading the page

Installation & Setup
  Clone or download the repository.
  Open index.html in a browser, or serve the folder with any static server
  (for example: npx serve . or python3 -m http.server) for the best audio on mobile.

Deploying (GitHub Pages)
  The workflow in .github/workflows/pages.yml publishes the game to GitHub Pages.
  One-time setup: Settings -> Pages -> Build and deployment -> Source: GitHub Actions.
  After that, every push to main redeploys automatically (or run the workflow by hand
  from the Actions tab). Pull requests run a quick build check only.

Controls
  Keyboard
    Move / aim: W, A, S, D or Arrow keys
    Energy ball: J (hold to keep firing in the direction you last moved)
    Flame: K (hold). While you're on fire the goat can't hurt you by touching you, and it gets burned. The flame uses heat, and if you overheat you have to wait for it to cool down.
    Jump: Spacebar (press again in the air to double jump; jump over fireballs to dodge them)
    Pause: P or Esc
    Mute: M
    Show hitboxes: B (or open the page with ?debug)
  Touch
    Drag anywhere on the left half of the screen to move and aim
    ZAP, FLAME and JUMP buttons on the right (hold ZAP or FLAME)
    The ring around FLAME shows your remaining heat

Game Mechanics
  Player Movement: The player moves along the neon street at the bottom of the screen.
  Enemy AI: The goat chases you, then flies into the sky, glows as a warning and throws a volley of fireballs at you. Below 50% health it gets enraged: it moves faster and throws three fireballs at a time.
  Damage: Touching the goat or getting hit by a fireball hurts you. After a hit you flash and are briefly invulnerable.
  Game Over: The game ends when either your health or the goat's reaches zero.

Code Structure
  index.html: the page, menus, HUD buttons and touch controls
  style.css: responsive layout and the touch control styling
  sound.js: Web Audio sound effects (falls back to <audio> elements) and the background music
  app.js:
    TUNING: all the balance numbers (speeds, damage, cooldowns) in one place
    layout(): fits the 1920x1080 game into the screen and sets the canvas resolution
    updatePlayer() / updateEnemy(): movement, jumping, attacks and the goat's state machine
    playerBox() / goatBox() / flameBox(): hitboxes used for all collisions
    updateProjectiles() / detectCollision(): energy balls, fireballs and body contact
    render(): draws the scene, effects and HUD
    frame(): the requestAnimationFrame game loop, using delta time

Future Enhancements
  Additional enemy types and AI behaviors
  Power-ups and health regeneration
  Multiplayer mode

License
  This project is open-source and available for modification. Have fun hacking and improving it!
