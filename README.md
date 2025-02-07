Cyberpunk 2D77 (don't sue me ProjectRed)

Live website: https://cyberpunk-2d77.netlify.app

Overview
  Welcome to Cyber city, this is a fast-paced 2D action game where you control a cyber warrior battling against a demonic goat. Use your agility and powerful attacks to survive and defeat your enemy.

Features
  Pixel-art sprite animation with smooth movement
  Keyboard controls (WASD/Arrow keys for movement, Spacebar for fire, 'K' for energy ball)
  Dynamic enemy AI with randomized movement
  Health system for both the player and the enemy
  Collision detection for attacks and enemy hits
  Game over conditions with restart options

Installation & Setup
  Clone or download the repository.
  Place all assets (images and sounds) inside the img and sounds folders.
  Open index.html in a browser to start the game.

Controls
  Move: W, A, S, D or Arrow Keys
  Fire attack: Spacebar
  Energy blast: K
  Restart game: Click after Game Over

Game Mechanics
  Player Movement: The player moves within the boundaries of the canvas.
  Enemy AI: The enemy moves randomly within a defined area, reversing direction when hitting limits.
  Attack System: The player can fire using the spacebar and shoot energy with 'K'.
  Health System: Health bars decrease upon taking damage.
  Game Over: The game ends when either the player’s or enemy’s health reaches zero.

Code Structure
  canvas setup: Initializes the game resolution and drawing context.
  player and enemy objects: Defines properties like position, speed, and sprite animations.
  movePlayer(): Handles player movement and animations.
  moveEnemy(): Moves the enemy randomly.
  detectCollision(): Checks for player-enemy collisions.
  detectCollisionToE(): Handles enemy damage when hit by player attacks.
  detectDeath(): Displays game-over screens based on health.
  animate(): Runs the game loop, updating the screen at 25 FPS.
  startAnimating(fps): Controls the frame rate for smooth gameplay.

Dependencies
  SweetAlert for game start pop-up (Swal.fire()).

Future Enhancements
  Sound effect improvements
  Additional enemy types and AI behaviors
  Power-ups and health regeneration
  Multiplayer mode

License
  This project is open-source and available for modification. Have fun hacking and improving it! 

