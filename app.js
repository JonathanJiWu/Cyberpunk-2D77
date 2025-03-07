// target html <canvas> using id
const canvas = document.getElementById("canvas1");
// save it to a var called ctx; getContext("2d") gives all the canvas methods
const ctx = canvas.getContext("2d");
// Resolution
canvas.width = 1920;
canvas.height = 1080;
// empty array to put all the key press in
const keys = [];
// player
const player = {
  // Horizontal and vertical positions of the player
  x: 220,
  y: 850,
  // Player width and height, which is calculated on the base of the Sprite sheet used
  width: 32,
  height: 48,
  // Horizontal and vertical frame that we cut out of from the sprite sheet
  frameX: 0,
  frameY: 2,
  // How many pixels moved per animation
  speed: 20,
  // Use boolean -moving- to switch between standing and walking animations
  moving: false,
};
const enemy = {
  // Horizontal and vertical positions of the enemy
  x: 1600,
  y: 800,
  // enemy width and height, which is calculated on the base of the Sprite sheet used
  width: 80,
  height: 80,
  // Horizontal and vertical frame that we cut out of from the sprite sheet
  frameX: 0,
  frameY: 1,
  // How many pixels moved per animation
  speedX: 18,
  speedY: 13,
};
// load in player sprite
const playerSprite = new Image();
playerSprite.src = "img/paine.png";
// load in enemy sprite
const enemySprite = new Image();
enemySprite.src = "img/redgoat.png";
// load in background img
const background = new Image();
background.src = "img/background1.jpg";
// load in gameover img
const endGame = new Image();
endGame.src = "img/endgame.jpg";
// load in gameover img
const initial = new Image();
initial.src = "img/BG2.jpg";
// load in WASD img
const WASD = new Image();
WASD.src = "img/wasd.png";
// load in spacebar img
const spacebar = new Image();
spacebar.src = "img/spacebar.png";
// Fire
const fire = new Image();
fire.src = "img/fire.png";
// blue flame, energy
const blueFlame = new Image();
blueFlame.src = "img/blue-flame.png";
// healthbar
let health = document.getElementById("health");
let healthE = document.getElementById("healthE");
// give parameters and cut out the sprite img
function drawSprite(img, sX, sY, sW, sH, dX, dY, dW, dH) {
  ctx.drawImage(img, sX, sY, sW, sH, dX, dY, dW, dH);
}
// keep track what user press/control
// add the key into the array when user pressed it; and delete it a once we released it, keyup and keydowns be firing over each other
addEventListener("keydown", function (e) {
  keys[e.keyCode] = true;
  player.moving = true;
  if (e.keyCode === 32) { // Spacebar
    jump();
  }
  if (e.keyCode === 75) { // Key K
    godMode = true;
    drawFiring();
    fireSound.play();
  }
  if (e.keyCode === 74) { // Key J
    fireEnergy();
  }
});
addEventListener("keyup", function (e) {
  delete keys[e.keyCode];
  player.moving = false;
  if (e.keyCode === 32) { // Spacebar
    canJump = true;
    jumpCount = 0;
  }
  if (e.keyCode === 75) { // Key K
    godMode = false;
  }
});
function movePlayer() {
  // how high can it go up player.y -up-
  if ((keys[38] && player.y > 840) || (keys[87] && player.y > 840)) {
    player.y -= player.speed;
    // Render the correct frames from the spritesheet
    player.frameY = 3;
    // walking animation
    player.moving = true;
  }
  // left
  if ((keys[37] && player.x > 0) || (keys[65] && player.x > 0)) {
    player.x -= player.speed;
    player.frameY = 1;
    player.moving = true;
  }
  // down
  if (
    (keys[40] && player.y < canvas.height - player.height) ||
    (keys[83] && player.y < canvas.height - player.height)
  ) {
    player.y += player.speed;
    player.frameY = 0;
    player.moving = true;
  }
  // right
  if (
    (keys[39] && player.x < canvas.width - player.width) ||
    (keys[68] && player.x < canvas.width - player.width)
  ) {
    player.x += player.speed;
    player.frameY = 2;
    player.moving = true;
  }
  // spacebar & fire
  godMode = false;
  burnE = false;
  // haveEnergy==true
  if (keys[75]) { // Key K
    drawFiring();
    fireSound.play();
    burnE = true;
    godMode = true;
  }
  zapE = false;
  if (keys[74]) { // Key J
    fireEnergy();
    zapE = true;
    player.moving = false;
  }
}
// Array to store active projectiles
const projectiles = [];
const enemyProjectiles = [];
let lastFireTime = 0;
const fireCooldown = 500; // Cooldown time in milliseconds

// shoot out energy
function fireEnergy() {
  const now = Date.now();
  if (now - lastFireTime < fireCooldown) return; // Check cooldown
  lastFireTime = now;

  const projectile = {
    x: player.x + 30,
    y: player.y + 20,
    width: 55,
    height: 40,
    speed: 5,
    direction: player.frameY // Use player.frameY to determine the direction
  };
  projectiles.push(projectile);
  energySound.play();
}

// shoot out enemy projectiles
function fireEnemyProjectile() {
  const projectile = {
    x: enemy.x + 30,
    y: enemy.y + 20,
    width: 55,
    height: 40,
    speed: 5,
    direction: 2 // Always shoot downwards
  };
  enemyProjectiles.push(projectile);
}

// Update and draw projectiles
function updateProjectiles() {
  for (let i = 0; i < projectiles.length; i++) {
    const projectile = projectiles[i];
    switch (projectile.direction) {
      case 0: // Down
        projectile.y += projectile.speed;
        break;
      case 1: // Left
        projectile.x -= projectile.speed;
        break;
      case 2: // Right
        projectile.x += projectile.speed;
        break;
      case 3: // Up
        projectile.y -= projectile.speed;
        break;
    }
    ctx.save();
    switch (projectile.direction) {
      case 0: // Down
        ctx.translate(projectile.x + projectile.width / 2, projectile.y + projectile.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.translate(-projectile.x - projectile.width / 2, -projectile.y - projectile.height / 2);
        break;
      case 1: // Left
        ctx.translate(projectile.x + projectile.width / 2, projectile.y + projectile.height / 2);
        ctx.rotate(Math.PI);
        ctx.translate(-projectile.x - projectile.width / 2, -projectile.y - projectile.height / 2);
        break;
      case 3: // Up
        ctx.translate(projectile.x + projectile.width / 2, projectile.y + projectile.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.translate(-projectile.x - projectile.width / 2, -projectile.y - projectile.height / 2);
        break;
    }
    ctx.drawImage(blueFlame, projectile.x, projectile.y, projectile.width, projectile.height);
    ctx.restore();

    // Remove projectile if it goes off-screen
    if (projectile.x < 0 || projectile.x > canvas.width || projectile.y < 0 || projectile.y > canvas.height) {
      projectiles.splice(i, 1);
      i--;
    }
  }

  // Update and draw enemy projectiles
  for (let i = 0; i < enemyProjectiles.length; i++) {
    const projectile = enemyProjectiles[i];
    projectile.y += projectile.speed;
    ctx.drawImage(blueFlame, projectile.x, projectile.y, projectile.width, projectile.height);

    // Remove projectile if it goes off-screen
    if (projectile.x < 0 || projectile.x > canvas.width || projectile.y < 0 || projectile.y > canvas.height) {
      enemyProjectiles.splice(i, 1);
      i--;
    }
  }
}

// enemy random movements, make this into a array maybe? and randomlize
// distants on X and Y
let verticalDis = enemy.x - player.x + 80;
let horizontalDis = enemy.y - player.y + 170;
function moveEnemy() {
  const dx = player.x - enemy.x;
  const dy = player.y - enemy.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 0) {
    enemy.x += (dx / distance) * enemy.speedX * 1.5; // Increase speed by 50%
    enemy.y += (dy / distance) * enemy.speedY * 1.5; // Increase speed by 50%
  }

  // Add some randomness to enemy movement
  if (Math.random() < 0.01) {
    enemy.speedX = (Math.random() - 0.5) * 20;
    enemy.speedY = (Math.random() - 0.5) * 20;
  }

  // Ensure enemy stays within the frame
  if (enemy.x < 0) enemy.x = 0;
  if (enemy.x > canvas.width - enemy.width) enemy.x = canvas.width - enemy.width;
  if (enemy.y < 0) enemy.y = 0;
  if (enemy.y > canvas.height - enemy.height) enemy.y = canvas.height - enemy.height;

  // Enemy shoots projectiles when in the top half of the screen
  if (enemy.y < canvas.height / 2 && Math.random() < 0.01) {
    fireEnemyProjectile();
  }
}
function drawFiring() {
  ctx.drawImage(fire, player.x + 3, player.y - 32, 60, 75);
}
// Alternate rendering frame of the player so it can appear that it is walking
function handlePlayerFrame() {
  if (player.frameX < 3 && player.moving) {
    player.frameX++;
  } else {
    player.frameX = 0;
  }
}
function handleEnemyrFrame() {
  if (enemy.frameX < 3 && enemy.moving) {
    enemy.frameX++;
  } else {
    enemy.frameX = 0;
  }
}
// detect collision
function detectCollision() {
  let horizontalDis = enemy.x - player.x + 120;
  let verticalDis = enemy.y - player.y + 100;
  if (
    Math.abs(verticalDis) < 50 &&
    Math.abs(horizontalDis) < 50 &&
    godMode == false
  ) {
    damageSound.play();
    health.value -= 2;
  }

  // Check for enemy projectile collisions
  for (let i = 0; i < enemyProjectiles.length; i++) {
    const projectile = enemyProjectiles[i];
    if (
      projectile.x < player.x + player.width &&
      projectile.x + projectile.width > player.x &&
      projectile.y < player.y + player.height &&
      projectile.y + projectile.height > player.y
    ) {
      health.value -= 1;
      hitSound.play();
      enemyProjectiles.splice(i, 1);
      i--;
    }
  }
}
function detectCollisionToE() {
  let horizontalDis = enemy.x - player.x + 120;
  let verticalDis = enemy.y - player.y + 100;
  if (
    Math.abs(verticalDis) < 50 &&
    Math.abs(horizontalDis) < 50 &&
    burnE == true
  ) {
    setTimeout(() => {
      healthE.value -= 1;
      hitSound.play();
    }, 200);
  }
  if (
    Math.abs(verticalDis) < 40 &&
    Math.abs(horizontalDis) < 40 &&
    zapE == true
  ) {
    setTimeout(() => {
      healthE.value -= 3;
      hitSound.play();
    }, 100);
  }

  // Check for projectile collisions
  for (let i = 0; i < projectiles.length; i++) {
    const projectile = projectiles[i];
    if (
      projectile.x < enemy.x + enemy.width &&
      projectile.x + projectile.width > enemy.x &&
      projectile.y < enemy.y + enemy.height &&
      projectile.y + projectile.height > enemy.y
    ) {
      healthE.value -= 1;
      hitSound.play();
      projectiles.splice(i, 1);
      i--;
    }
  }
}
function detectDeath() {
  if (health.value <= 0) {
    ctx.drawImage(endGame, 0, 0, canvas.width, canvas.height);
    play = false;
    gameOverSound.play();
    ctx.font = "250px serif";
    canvas.fillStyle = "#de2312";
    ctx.fillText("Click to Continue", 450, 900, 1200);
    ctx.font = "150px serif";
    ctx.fillText("The Goat Got Your Soul!", 150, 500, 1900);
    document.addEventListener("click", function () {
      this.location.reload();
    });
    return; // Stop the game loop
  }
  if (healthE.value <= 0) {
    ctx.drawImage(endGame, 0, 0, canvas.width, canvas.height);
    play = false;
    ctx.font = "250px serif";
    canvas.fillStyle = "#de2312";
    ctx.fillText("Click to Eat Lamp Chops", 450, 900, 1200);
    ctx.font = "150px serif";
    ctx.fillText("Lamb Chops for Dinna!", 150, 500, 1900);
    document.addEventListener("click", function () {
      this.location.reload();
    });
    return; // Stop the game loop
  }
}
// let browser to server frame Consistently across all machines
let fps, fpsInterval, startTime, now, then, elapsed;
// kick off animation, limit fps
function startAnimating(fps) {
  // One second has 1000 milliseconds
  fpsInterval = 1000 / fps;
  // How long has it passed since the last frame, Date.now() is builtin JS
  then = Date.now();
  startTime = then;
  // call animate
  animate();
}
// animate loop
function animate() {
  if (!play) return; // Stop the game loop if play is false

  // start the score
  score.play();
  // -requestAnimationFrame()-: more accurate version of setInterval(), everytime the browser refresh, (animate), make smoother animation
  // written without the window. the method belong to the window object, writting window is optional
  // it will call itself recursively
  requestAnimationFrame(animate);
  now = Date.now();
  elapsed = now - then;
  // How much time have elapsed between then and now,
  // If the elapsed time is more than FPS interval, reasign the value of -then- to the current time
  if (elapsed > fpsInterval) {
    then = now - (elapsed % fpsInterval);
    // clear the frame from last loop
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // -drawImage- is a buildin canvas method, taking 5 arguments: what img want it to draw(line 30), top Coordinate, left Coordinate, width, height
    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
    if (Date.now() - startTime < 20000) {
      ctx.drawImage(WASD, 130, 200, 200, 200);
      ctx.drawImage(spacebar, 700, 80, 650, 500);
    }
    ctx.fillText('K', 1200, 200)
    // croping out the player width and height, drawSprite is global function
    drawSprite(
      playerSprite,
      player.width * player.frameX,
      player.height * player.frameY,
      player.width,
      player.height,
      player.x,
      player.y,
      player.width * 2,
      player.height * 2
    );
    drawSprite(
      enemySprite,
      enemy.width * enemy.frameX,
      enemy.height * enemy.frameY,
      enemy.width,
      enemy.height,
      enemy.x,
      enemy.y,
      enemy.width * 3,
      enemy.height * 3
    );
    detectCollision();
    detectCollisionToE();
    movePlayer();
    moveEnemy();
    handlePlayerFrame();
    updateProjectiles(); // Update and draw projectiles
    detectDeath();
  }
}
// play switch
let play = false;
if (play == false) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // ctx.drawImage(BG2, 0, 0, canvas.width, canvas.height);
}
// start popup
Swal.fire({
  title: "It's year 2D77, You're a Cyber Badass, Don't kiss the Demon Goat",
  text: "Use W, A, S, D or Arrow keys to move; use Spacebar to light it up, press 'K' to shot energy ball",
  confirmButtonText: "Start Game",
}).then(() => {
  play = true;
  startAnimating(25);
});

// Player jump with double jump
let canJump = true;
let jumpCount = 0;
const maxJumps = 2;
const jumpHeight = 50;

function jump() {
  if (jumpCount < maxJumps) {
    player.y -= jumpHeight;
    jumpCount++;
    setTimeout(() => {
      player.y += jumpHeight;
    }, 300);
  }
}
