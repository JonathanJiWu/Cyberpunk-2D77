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
  x: 1000,
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
class Bullet {
  constructor(x, y, radius, color, velocity) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.color = color;
    this.velocity = velocity;
  }
}
// load in player sprite
const playerSprite = new Image();
playerSprite.src = "img/paine.png";
// load in enemy sprite
const enemySprite = new Image();
enemySprite.src = "img/redgoat.png";
// load in background img
const background = new Image();
background.src = "img/background1.jpg";
// healthbar
let health = document.getElementById("health");
let healthE = document.getElementById("healthE");

// give parameters and cut out the sprite img
function drawSprite(img, sX, sY, sW, sH, dX, dY, dW, dH) {
  ctx.drawImage(img, sX, sY, sW, sH, dX, dY, dW, dH);
}

setInterval(function () {});
// keep track what user press/control
// add the key into the array when user pressed it; and delete it a once we released it, keyup and keydowns be firing over each other
addEventListener("keydown", function (e) {
  keys[e.keyCode] = true;
  player.moving = true;
});
addEventListener("keyup", function (e) {
  delete keys[e.keyCode];
  player.moving = false;
});
// player fire
addEventListener("click", function (e) {
  const fire = new Bullet(e.clientX, e.clientY, 5, "yellow", null);
});

function movePlayer() {
  // how high can it go up player.y -up-
  if (keys[38] && player.y > 840) {
    player.y -= player.speed;
    // Render the correct frames from the spritesheet
    player.frameY = 3;
    // walking animation
    player.moving = true;
  }
  // down
  if (keys[37] && player.x > 0) {
    player.x -= player.speed;
    player.frameY = 1;
    player.moving = true;
  }
  // left
  if (keys[40] && player.y < canvas.height - player.height) {
    player.y += player.speed;
    player.frameY = 0;
    player.moving = true;
  }
  // right
  if (keys[39] && player.x < canvas.width - player.width) {
    player.x += player.speed;
    player.frameY = 2;
    player.moving = true;
  }
  // spacebar & fire
  if (keys[32]) {
    player.moving = false;
  }
}
// enemy random movements, make this into a array maybe? and randomlize
// distants on X and Y
let verticalDis = enemy.x - player.x + 80;
let horizontalDis = enemy.y - player.y + 170;
function moveEnemy() {
  // to the left if E is on the right of the P
  enemy.x += enemy.speedX;
  enemy.y += enemy.speedY;
  if (enemy.x < 0 || enemy.x > 1800) {
    enemy.speedX = -enemy.speedX;
  }
  if (enemy.y < 700 || enemy.y > 900) {
    enemy.speedY = -enemy.speedY;
  }
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
  if (Math.abs(verticalDis) < 50 && Math.abs(horizontalDis) < 50) {
    health.value -= 5;
  }
}
function detectDeath() {
  if (health.value <= 0) {
    alert("ded");
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
    console.log(player.x, player.y);
    console.log(enemy.x, enemy.y);
    movePlayer();
    moveEnemy();
    handlePlayerFrame();
    if(health.value<=0){
      alert('dd')
    }
  }
}
let startConvo = prompt('Are You ready for This?')
// startAnimating(25);