// sound system
function Sound(src) {
    this.sound = document.createElement("audio");
    this.sound.src = src;
    this.sound.setAttribute("preload", "auto");
    this.sound.setAttribute("controls", "none");
    this.sound.style.display = "none";
    document.body.appendChild(this.sound);
    this.play = function () {
      this.sound.play();
    };
    this.stop = function () {
      this.sound.pause();
    };
  }
  score = new Sound("sound/Disconnected.mp3");
  fireSound = new Sound("sound/fire.wav");
  damageSound = new Sound("sound/damage.wav");
  hitSound = new Sound("sound/hit.wav");
  gameOverSound = new Sound("sound/gameover.wav");
  energySound = new Sound("sound/energy.wav");