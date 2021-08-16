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
  frameY: 0,
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
// animation of background & player
function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
  drawSprite(
    playerSprite,
    0,
    0,
    player.width,
    player.height,
    player.x,
    player.y,
    player.width,
    player.height
  );
  requestAnimationFrame(animate);
}
animate();

window.addEventListener("keydown", function (e) {
  keys[e.keyCode] = true;
  console.log(keys);
});
window.addEventListener("keyup", function (e) {
  delete keys[e.keyCode];
});

function movePlayer(){
    if (keys[38]){
        player.y-=player.speed
    }
}