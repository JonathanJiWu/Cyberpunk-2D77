const canvas = document.getElementById("canvas1");
const ctx = canvas.getContext("2d");
canvas.width = 800;
canvas.height = 500;

const keys = [];
const player = {
  x: 88,
  y: 300,
  width: 32,
  height: 48,
  frameX: 0,
  frameY: 2,
  speed: 9,
  moving: false,
};

const playerSprite = new Image();
playerSprite.src = "img/paine.png";
const background = new Image();
background.src = "img/61XwaKr8EdL.jpg";

function drawSprite(img, sX, sY, sW, sH, dX, dY, dW, dH) {
  ctx.drawImage(img, sX, sY, sW, sH, dX, dY, dW, dH);
}

setInterval(function () {});
// keep track what user press/control
// add the key into the array when user pressed it; and delete it a once we released it, keyup and keydowns be firing over each other
window.addEventListener("keydown", function (e) {
  keys[e.keyCode] = true;
  player.moving = true;
});
window.addEventListener("keyup", function (e) {
  delete keys[e.keyCode];
  player.moving = false;
});

function movePlayer() {
  // how high can it go up player.y
  if (keys[38] && player.y > 30) {
    player.y -= player.speed;
    // Render the correct frames from the spritesheet
    player.frameY = 3;
    player.moving = true;
  }
  if (keys[37] && player.x > 0) {
    player.x -= player.speed;
    player.frameY = 1;
    player.moving = true;
  }
  if (keys[40] && player.y < canvas.height - player.height) {
    player.y += player.speed;
    player.frameY = 0;
    player.moving = true;
  }
  if (keys[39] && player.x < canvas.width - player.width) {
    player.x += player.speed;
    player.frameY = 2;
    player.moving = true;
  }
}
// Alternate rendering frame of the player so it can appear that it is walking
function handlePlayerFrame() {
  if (player.framex < 3 && player.moving) {
    player.frameX++;
  } else {
    player.frameX = 0;
  }
}

// animation of background & player
// function animate() {
//   ctx.clearRect(0, 0, canvas.width, canvas.height);
//   ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
//   drawSprite(
//     playerSprite,
//     player.width * player.frameX,
//     player.height * player.frameY,
//     player.width,
//     player.height,
//     player.x,
//     player.y,
//     player.width,
//     player.height
//   );
//   movePlayer();
//   handlePlayerFrame();
//   requestAnimationFrame(animate);
// }
// animate();

let fps, fpsInterval, startTime, now, then, elapsed;
function startAnimating(fps) {
  fpsInterval = 1000 / fps;
  then = Date.now();
  startTime = then;
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  now = Date.now();
  elapsed = now - then;
  if (elapsed > fpsInterval) {
    then = now - (elapsed % fpsInterval);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
    drawSprite(
      playerSprite,
      player.width * player.frameX,
      player.height * player.frameY,
      player.width,
      player.height,
      player.x,
      player.y,
      player.width,
      player.height
    );
    movePlayer();
    handlePlayerFrame();
  }
}
startAnimating(20)