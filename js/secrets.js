"use strict";
// =============================================================================
// Easter eggs: homages to cyberpunk classics.
//   Tears in Rain      stand still in the acid rain          (Blade Runner)
//   Interlinked        look up at the giant hologram ad      (Blade Runner 2049)
//   Mantis Blades      visit the ripperdoc                   (Cyberpunk 2077)
//   Katana             grab it from the highest platform     (deflects shots)
//   Sandevistan        77 kills: time slows when you're hurt (Edgerunners)
//   Ghost in the Shell dive off a rooftop -> thermoptic camo
//   Jack In            breach a data terminal                (netrunning)
//   To the Moon        reach the end of the street           (Edgerunners)
// =============================================================================

// ------------------------------------------------------------ Persistence ---
const secretsFound = new Set();
const runSecrets = new Set();
try {
  JSON.parse(localStorage.getItem("cp2d77-secrets") || "[]").forEach((id) => secretsFound.add(id));
} catch (err) {
  /* storage unavailable */
}

function unlockSecret(id) {
  runSecrets.add(id);
  if (secretsFound.has(id)) return;
  secretsFound.add(id);
  try {
    localStorage.setItem("cp2d77-secrets", JSON.stringify([...secretsFound]));
  } catch (err) {
    /* storage unavailable */
  }
  const s = SECRETS.find((x) => x.id === id);
  neonNote(`SECRET FOUND: ${s.name.toUpperCase()}`, "#ff2fd6", 4.5);
  sfx.levelUp.play({ rate: 1.6 });
  renderSecretsList();
}

// Easter-egg lines show as small neon signs down the left edge of the screen,
// out of the way of the action
function cinematic(text, duration = 5) {
  neonNote(text, "#9ffcff", duration);
}
const neonNotes = [];
function neonNote(text, color, duration = 4) {
  neonNotes.push({ text, color, time: duration, max: duration, seed: Math.random() * 10 });
  if (neonNotes.length > 3) neonNotes.shift();
}

function slowMo(duration, scale) {
  game.slowmo = { time: duration, scale };
}

// Enemies (and their shots) run on this clock: Sandevistan and the
// cinematic moments slow them down while you keep full speed.
function enemyTimeScale() {
  let s = 1;
  if (player.sandyTime > 0) s = Math.min(s, 0.25);
  // Hackerman's Time Dilation (either player's, in co-op)
  forEachPlayer(() => {
    if (player.dilation > 0) s = Math.min(s, stats.dilation.scale);
  });
  if (game.slowmo && game.slowmo.time > 0) s = Math.min(s, game.slowmo.scale);
  return s;
}

// -------------------------------------------------------------- Run state ---
const weather = { raining: false, timer: 0, amount: 0, idle: 0, tearsDone: false, drops: [], lastCam: 0 };
const holo = { x: EASTER.hologram.x, look: 0, done: false, pulse: 0, frame: 0, glitch: 0, act: "idle", actT: 0, kissCd: 3, face: 1, slice: 0 };
const kisses = []; // hearts the billboard blows at you
const ripper = { x: EASTER.ripperdoc.x, hold: 0, near: false };
const terminals = EASTER.terminals.map((x) => ({ x, hold: 0, cooldown: 0, near: false }));
const katanaPickup = { taken: false };
const moonState = { done: false, glow: 0 };
const doves = [];
const slashes = [];

const breachRun = { datamined: 0 }; // per-run breach bookkeeping
const KISS_HEAL_MAX = 30; // HP a run the billboard's kisses can heal

function resetSecretsRun() {
  runSecrets.clear();
  breachRun.datamined = 0;
  Object.assign(weather, { raining: false, timer: EASTER.rain.firstAt, amount: 0, idle: 0, tearsDone: false });
  Object.assign(holo, { look: 0, done: false, pulse: 0, act: "idle", actT: 0, kissCd: 3, healed: 0 });
  kisses.length = 0;
  ripper.hold = 0;
  terminals.forEach((t) => Object.assign(t, { hold: 0, cooldown: 0 }));
  katanaPickup.taken = false;
  Object.assign(moonState, { done: false, glow: 0 });
  doves.length = 0;
  slashes.length = 0;
  resetChrome(player);
}

// The chrome a player can pick up (co-op's player 2 starts without any too)
function resetChrome(p) {
  Object.assign(p, {
    mantis: false,
    mantisCd: 0,
    katana: false,
    katanaCd: 0,
    sandy: false,
    sandyTime: 0,
    sandyCd: 0,
    camo: 0,
    camoCd: 0,
    airTop: undefined,
    lookUp: false,
    trail: [],
    trailTimer: 0,
  });
}

const holdingDown = () => {
  const m = moveAxis();
  return m.y > 0.6 && Math.abs(m.x) < 0.45;
};
// Keyboard only: on touch the stick's "up" is jump
const lookingUp = () => keyHeld("up") && !keyHeld("left") && !keyHeld("right");

// ----------------------------------------------------------------- Update ---
function updateSecrets(dt) {
  const pc = centerOf(player);
  const onStreet = player.onGround && player.standingOn === GROUND;

  // Weather cycle
  weather.timer -= dt;
  if (weather.timer <= 0) {
    weather.raining = !weather.raining;
    weather.timer = weather.raining ? EASTER.rain.duration : rand(EASTER.rain.gap[0], EASTER.rain.gap[1]);
    if (weather.raining) {
      weather.tearsDone = false;
      popup("ACID RAIN", pc.x, player.y - 40, "#9fc8ff", 24, 1.4);
    }
  }
  weather.amount = clamp(weather.amount + ((weather.raining ? 1 : -1) * dt) / 3, 0, 1);
  if (weather.amount > 0.2 && Math.random() < weather.amount * 0.9 && !perfMode()) {
    // splashes on the street
    particles.push({ x: camera.x + rand(0, W), y: GROUND_Y - 2, vx: rand(-40, 40), vy: rand(-160, -60), life: 0.25, size: 3, color: "#9fc8ff" });
  }

  // Tears in rain: stand perfectly still in the rain for a few seconds
  const m = moveAxis();
  const still = player.onGround && Math.abs(m.x) < 0.1 && !zapHeld() && !flameHeld() && !input.shots.length;
  if (weather.amount > 0.6 && still && !weather.tearsDone) {
    weather.idle += dt;
    if (weather.idle > 4) {
      weather.tearsDone = true;
      doves.push({ x: pc.x, y: pc.y - 30, vx: 150, vy: -250, anim: 0, life: 7 });
      cinematic("All those moments... lost, like tears in rain.", 5.5);
      slowMo(4, 0.3);
      player.hp = Math.min(stats.maxHp, player.hp + 25);
      unlockSecret("tears");
    }
  } else {
    weather.idle = 0;
  }

  // Interlinked: stand under the giant hologram and look up at her (hold Up,
  // or just stand still there for a moment)
  const nearHolo = onStreet && Math.abs(pc.x - holo.x) < 200;
  const idle = Math.abs(moveAxis().x) < 0.1 && !zapHeld() && !flameHeld();
  holo.idle = nearHolo && idle ? (holo.idle || 0) + dt : 0;
  player.lookUp = nearHolo && (lookingUp() || holo.idle > 0.8);
  if (player.lookUp && !holo.done) {
    holo.look += dt;
    if (holo.look > 2) {
      holo.done = true;
      holo.pulse = 5;
      cinematic("“You look lonely...”", 4.5);
      popup("CELLS INTERLINKED", pc.x, player.y - 50, "#ff8fe0", 26, 2);
      gainXp(15);
      unlockSecret("interlinked");
    }
  } else {
    holo.look = 0;
  }
  holo.pulse = Math.max(0, holo.pulse - dt);
  updateBillboard(dt, pc);

  // Ripperdoc: hold down at the booth to install Mantis Blades
  ripper.near = !player.mantis && onStreet && Math.abs(pc.x - ripper.x) < 90;
  if (ripper.near && holdingDown()) {
    ripper.hold += dt;
    if (ripper.hold >= 1.2) {
      player.mantis = true;
      ripper.hold = 0;
      popup("MANTIS BLADES INSTALLED", pc.x, player.y - 50, "#5aff7a", 26, 2);
      burst(pc.x, pc.y, 24, "#5aff7a", 380);
      sfx.powerup.play({ rate: 0.8 });
      unlockSecret("mantis");
    }
  } else {
    ripper.hold = 0;
  }

  // Data terminals: hold down to jack in
  terminals.forEach((t) => {
    t.cooldown = Math.max(0, t.cooldown - dt);
    t.near = t.cooldown <= 0 && onStreet && Math.abs(pc.x - t.x) < 80;
    if (t.near && holdingDown()) {
      t.hold += dt;
      if (t.hold >= 0.8) {
        t.hold = 0;
        openBreach(t);
      }
    } else {
      t.hold = 0;
    }
  });
  if (game.state !== "playing") return;

  // Katana on the highest moving platform
  if (!katanaPickup.taken) {
    const k = katanaBox();
    if (overlaps(k, player)) {
      katanaPickup.taken = true;
      player.katana = true;
      popup("KATANA", pc.x, player.y - 50, "#19f5ff", 30, 2);
      burst(pc.x, pc.y, 20, "#19f5ff", 360);
      sfx.powerup.play({ rate: 1.6 });
      unlockSecret("katana");
    }
  }

  // Sandevistan: 77 kills (sound familiar?)
  if (!player.sandy && game.kills >= EASTER.sandevistanKills) {
    player.sandy = true;
    game.banner = { text: "SANDEVISTAN ONLINE", time: 2.2, color: "#5aff7a" };
    activateSandevistan(2.5);
    unlockSecret("sandevistan");
  }
  player.sandyTime = Math.max(0, player.sandyTime - dt);
  player.sandyCd = Math.max(0, player.sandyCd - dt);

  // Ghost in the Shell: a long dive onto the street turns on thermoptic camo
  if (!player.onGround) {
    player.airTop = Math.min(player.airTop === undefined ? 1e9 : player.airTop, player.y + player.h);
  } else {
    if (player.airTop !== undefined && onStreet && GROUND_Y - player.airTop >= EASTER.diveHeight && player.camoCd <= 0) {
      player.camo = 8;
      player.camoCd = 25;
      cinematic("The net is vast and infinite.", 4);
      burst(pc.x, player.y + player.h, 24, "#19f5ff", 420);
      ring(pc.x, player.y + player.h, 220, "#19f5ff");
      unlockSecret("ghost");
    }
    player.airTop = undefined;
  }
  player.camo = Math.max(0, player.camo - dt);
  player.camoCd = Math.max(0, player.camoCd - dt);

  // To the moon: the end of the street
  if (!moonState.done && player.x + player.w > WORLD_W - 230) {
    moonState.done = true;
    moonState.glow = 6;
    cinematic("Take me to the moon...", 4.5);
    player.hp = Math.min(stats.maxHp, player.hp + 30);
    unlockSecret("moon");
  }
  moonState.glow = Math.max(0, moonState.glow - dt);

  updateChrome(dt);

  for (let i = doves.length - 1; i >= 0; i--) {
    const d = doves[i];
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vy += (-160 - d.vy) * dt;
    d.anim += dt * 10;
    if ((d.life -= dt) <= 0) doves.splice(i, 1);
  }
  for (let i = slashes.length - 1; i >= 0; i--) if ((slashes[i].life -= dt) <= 0) slashes.splice(i, 1);
  if (game.slowmo) game.slowmo.time -= dt;
  for (let i = neonNotes.length - 1; i >= 0; i--) if ((neonNotes[i].time -= dt) <= 0) neonNotes.splice(i, 1);
  if (game.toast && (game.toast.time -= dt) <= 0) game.toast = null;
}

function katanaBox() {
  const p = platforms[EASTER.katana.platform];
  return { x: p.x + EASTER.katana.offset, y: p.y - 34, w: 80, h: 30 };
}

function activateSandevistan(duration) {
  player.sandyTime = duration;
  player.sandyCd = 35;
  popup("SANDEVISTAN", player.x + player.w / 2, player.y - 30, "#5aff7a", 26, 1.4);
  sfx.chain.play({ rate: 0.5 });
}

// Called from hurtPlayer(): Sandevistan kicks in when you're badly hurt
function onPlayerHurt() {
  if (player.sandy && player.sandyCd <= 0 && player.hp > 0 && player.hp / stats.maxHp <= 0.4) activateSandevistan(5);
}

// Mantis Blades, the katana and the Sandevistan afterimages
function updateChrome(dt) {
  const p = player;
  const pc = centerOf(p);

  if (p.mantis) {
    p.mantisCd -= dt;
    if (p.mantisCd <= 0) {
      const range = 170;
      const targets = enemies.filter((e) => !e.dead && circleHitsBox(pc.x, pc.y, range, e));
      if (targets.length) {
        const sides = new Set();
        targets.forEach((e) => {
          const c = centerOf(e);
          const dir = c.x >= pc.x ? 1 : -1;
          sides.add(dir);
          damageEnemy(e, 18, { source: "mantis", kbX: dir * 420 });
          burst(c.x, c.y, 6, "#ff2fd6", 260);
        });
        sides.forEach((dir) => slashes.push({ x: pc.x, y: pc.y, dir, life: 0.16, color: "#ff8fe0" }));
        crates.forEach((c) => c.alive && circleHitsBox(pc.x, pc.y, range, c) && damageCrate(c, 18));
        sfx.zapHit.play({ rate: 0.7 });
        p.mantisCd = 0.55 * stats.cdMul;
      }
    }
  }

  if (p.katana) {
    p.katanaCd -= dt;
    if (p.katanaCd <= 0) {
      let best = -1;
      let bestD = 140;
      enemyShots.forEach((s, i) => {
        const d = Math.hypot(s.x - pc.x, s.y - pc.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        // Parry: send it back at the nearest enemy, 3x as strong
        const s = enemyShots.splice(best, 1)[0];
        const target = nearestEnemy(s.x, s.y, 1400, onScreen);
        const c = target ? centerOf(target) : { x: s.x - s.vx, y: s.y - s.vy };
        const a = Math.atan2(c.y - s.y, c.x - s.x);
        playerShots.push({
          x: s.x,
          y: s.y,
          vx: Math.cos(a) * 1100,
          vy: Math.sin(a) * 1100,
          r: s.r,
          angle: a,
          life: 1.6,
          damage: s.damage * 3,
          pierce: 0,
          hit: new Set(),
          kind: s.kind,
        });
        slashes.push({ x: s.x, y: s.y, dir: s.x >= pc.x ? 1 : -1, life: 0.14, color: "#9ffcff" });
        popup("PARRY", s.x, s.y - 20, "#9ffcff", 20, 0.6);
        sfx.zapHit.play({ rate: 2 });
        p.katanaCd = 0.5;
      }
    }
  }

  // Sandevistan afterimages
  if (p.sandyTime > 0 || p.trail.length) {
    p.trailTimer -= dt;
    if (p.sandyTime > 0 && p.trailTimer <= 0) {
      p.trailTimer = 0.035;
      p.trail.push({ x: p.x, y: p.y, frameX: p.frameX, frameY: p.lookUp ? 3 : p.frameY, t: 0 });
    }
    p.trail.forEach((t) => (t.t += dt));
    while (p.trail.length && p.trail[0].t > 0.4) p.trail.shift();
  }
}

// ---------------------------------------------------- Jack in: the breach ---
// A hacker-movie terminal in five stages:
//   RECON    mash any key (or tap): it "types" `nmap`, the scan lists ports
//   EXPLOIT  pick the service the scan flagged with a CVE
//   CRACK    `john`: lock in each password char while it glows green
//   ROOT     `sudo ...`
//   PAYLOAD  choose a daemon (the reward) and upload it
// An ICE trace fills slowly. Mistakes only add to it, and the run fails only
// when it reaches 100%. Everything runs off updateBreach(dt), with no timers,
// so closeBreach() can stop it at any moment.
const BREACH = {
  traceRate: 1.4, // % per second: sitting idle flatlines after ~70 s
  wrongTarget: 12, // % for exploiting a patched service
  crackMiss: 4, // % for a mistimed lock
  grace: 0.45, // s: presses ignored as a pick or the crack starts (no mashing through)
  holdRepeat: 0.11, // s between auto-typed chunks while a key, button or finger is held
};
const BREACH_STEPS = ["recon", "exploit", "crack", "root", "payload"];
const BREACH_HOSTS = ["goldhorn-edge-04", "verity-feed-03", "calm-bureau-09", "adfarm-node-77"];
const BREACH_ICE = ["AUDITOR", "COMPLIANCE", "GAG ORDER", "PAYWALL", "LIQUIDATOR"];
const BREACH_DECOYS = [
  { port: "22/tcp", svc: "ssh", ver: "OpenSSH 9.9p1", fail: "OpenSSH is patched. Someone actually read the changelog." },
  { port: "80/tcp", svc: "http", ver: 'nginx 1.27 ("works on my machine")', fail: "HTTP 418 I'm a teapot. It refuses to brew your exploit." },
  { port: "443/tcp", svc: "https", ver: "GoldhornWeb 4.2 (TLS 1.7)", fail: "Cert pinned harder than a board member's ego." },
  { port: "3306/tcp", svc: "mysql", ver: "MySQL 9.4 (prod, no backups)", fail: "Access denied for user 'you'@'%'. Rude." },
  { port: "6379/tcp", svc: "redis", ver: "Redis 8.0 (protected-mode yes)", fail: "protected-mode yes. A sysadmin did their job today." },
  { port: "8080/tcp", svc: "jenkins", ver: "Jenkins 3.1 (build failing since 2061)", fail: "Jenkins is already broken. You can't break it more." },
];
const BREACH_VULNS = [
  { port: "2077/tcp", svc: "braindance", ver: "BDstream 0.9-beta", cve: "CVE-2077-1337", why: "trusts user input (CVSS 11/10)", how: "stack" },
  { port: "9229/tcp", svc: "node-debug", ver: "node --inspect=0.0.0.0 (left on in prod)", cve: "CVE-2077-0404", why: "auth not found", how: "debug" },
  { port: "23/tcp", svc: "telnet", ver: "telnetd (since 1969)", cve: "CVE-2077-0023", why: "it's telnet", how: "telnet" },
];
const BREACH_PASSWORDS = [
  { pw: "hunter2", joke: "funny, all I see is *******" },
  { pw: "hunter2", joke: "funny, all I see is *******" },
  { pw: "letmein", joke: "security through politeness" },
  { pw: "trustno1", joke: "and yet, here we are" },
  { pw: "goat666", joke: "a Demon Goat fan, apparently" },
];
const BREACH_WORDS = ["123456", "password", "qwerty", "iloveyou", "dragon", "monkey", "goldhorn4ever", "chooms", "preem", "samurai", "nova2077", "shareholder1", "admin", "correcthorse", "trustme", "letmein1"];
const BREACH_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const BREACH_DAEMONS = [
  { file: "short_circuit.daemon", size: "2.0M", name: "SHORT CIRCUIT", desc: "EMP: fries every bot on screen" },
  { file: "datamine.daemon", size: "7.7M", name: "DATAMINE", desc: "siphons their XP: +1 LEVEL (halves each time)" },
  { file: "overclock.daemon", size: "1.0M", name: "OVERCLOCK", desc: "overdrive: 10 s of rapid fire" },
];
const BREACH_WARNINGS = [
  [50, "is sniffing your packets", "warn"],
  [75, "is tracing your deck: hop 5 of 7", "err"],
  [90, "is LOCKING ON. Hurry, or jack out", "err"],
];
const BREACH_HINTS = {
  auto: 'Running... <span class="kb-only">any key</span><span class="touch-only">tap</span> = <b>--fast</b>',
  type: '<b class="kb-only">MASH ANY KEY</b><b class="touch-only">TAP THE SCREEN</b> to hack. <span class="kb-only">Clicks work too. </span>Hold to auto-type.',
  "pick-exploit": '<b>Exploit the service the scan flagged with a CVE.</b> <span class="kb-only">&uarr; &darr; + ENTER, or click it</span><span class="touch-only">Tap it</span>',
  crack: '<b>LOCK each char while it glows green:</b> <span class="kb-only">any key or click</span><span class="touch-only">tap anywhere</span>. Misses add trace.',
  "pick-payload": '<b>Choose your daemon.</b> <span class="kb-only">&uarr; &darr; + ENTER, 1-3, or click</span><span class="touch-only">Tap one</span>',
};
const BREACH_STAGE_SR = {
  recon: "Stage 1 of 5, recon. Press any key or tap to type the scan.",
  exploit: "Stage 2 of 5, exploit. Pick the service flagged with a CVE: arrow keys and Enter, or tap it.",
  crack: "Stage 3 of 5, crack. Press any key or tap while the highlighted character glows green.",
  root: "Stage 4 of 5, root. Keep typing.",
  payload: "Stage 5 of 5, payload. Choose a daemon: 1 short circuit, 2 datamine, 3 overclock.",
};
// "JACK IN" in block letters for the boot screen
const BREACH_BANNER = (() => {
  const font = {
    J: ["     ██ ", "     ██ ", "     ██ ", "██   ██ ", " █████  "],
    A: [" █████  ", "██   ██ ", "███████ ", "██   ██ ", "██   ██ "],
    C: [" ██████ ", "██      ", "██      ", "██      ", " ██████ "],
    K: ["██   ██ ", "██  ██  ", "█████   ", "██  ██  ", "██   ██ "],
    I: ["██ ", "██ ", "██ ", "██ ", "██ "],
    N: ["███    ██", "████   ██", "██ ██  ██", "██  ██ ██", "██   ████"],
    " ": ["  ", "  ", "  ", "  ", "  "],
  };
  return [0, 1, 2, 3, 4].map((r) => [..."JACK IN"].map((ch) => font[ch][r]).join(""));
})();
const BREACH_ICE_RGB = [
  [25, 245, 255],
  [255, 176, 46],
  [255, 59, 92],
];
// Keys the terminal leaves to the browser
const BREACH_PASS_KEYS = /^(Tab|Shift|Control|Alt|Meta|OS|Fn|CapsLock|NumLock|ScrollLock|ContextMenu|PrintScreen|F\d+$|Audio|Media|Browser|Launch|Volume)/;

const breachEl = document.getElementById("breach");
const breachScreenEl = document.getElementById("breach-screen");
const breachTermEl = document.getElementById("breach-term");
const breachStepsEl = document.getElementById("breach-steps");
const breachHintEl = document.getElementById("breach-hint");
const breachIceEl = document.getElementById("breach-ice");
const breachIceNameEl = document.getElementById("breach-ice-name");
const breachIceCanvas = document.getElementById("breach-ice-canvas");
const breachIceStatusEl = document.getElementById("breach-ice-status");
const breachTraceBarEl = document.getElementById("breach-trace-bar");
const breachTracePctEl = document.getElementById("breach-trace-pct");
const breachFlashEl = document.getElementById("breach-flash");
const breachSrEl = document.getElementById("breach-sr");
const breach = {
  terminal: null,
  stage: "", // boot | recon | exploit | crack | root | payload | done
  mode: "off", // off | auto (output printing) | type | pick | crack
  trace: 0,
  done: false,
  success: false,
  reward: -1,
  mistakes: 0,
  queue: [],
};
const breachAny = (list) => list[Math.floor(Math.random() * list.length)];
const breachPs1 = (user) => (user === "root" ? `root@${breach.host}:~# ` : `${user}@${breach.host}:~$ `);

function openBreach(term) {
  const vuln = breachAny(BREACH_VULNS);
  const decoys = BREACH_DECOYS.map((s) => [Math.random(), s])
    .sort((a, b) => a[0] - b[0])
    .slice(0, 4)
    .map((x) => x[1]);
  Object.assign(breach, {
    terminal: term,
    stage: "",
    mode: "auto",
    trace: 0,
    shown: 0,
    traceOn: false,
    warned: 0,
    done: false,
    success: false,
    melting: false,
    reward: -1,
    mistakes: 0,
    queue: [],
    qt: 0,
    cmd: null,
    pick: null,
    crack: null,
    inputLine: null,
    host: breachAny(BREACH_HOSTS),
    ip: `10.20.77.${10 + Math.floor(Math.random() * 240)}`,
    ice: breachAny(BREACH_ICE),
    services: [...decoys, vuln].map((s) => ({ ...s, ok: s === vuln })).sort((a, b) => parseInt(a.port) - parseInt(b.port)),
    pass: breachAny(BREACH_PASSWORDS),
    time: 0,
    hitT: 0,
    holdId: null,
    holdT: 0,
    pct: -1,
    heat: "",
    status: "",
  });
  sfx.flame.stopLoop();
  clearInput();
  breachTermEl.textContent = "";
  breachFlashEl.hidden = true;
  breachIceEl.className = "breach-ice";
  breachIceNameEl.textContent = `BLACK ICE // ${breach.ice} v${2 + Math.floor(Math.random() * 8)}.7`;
  breachScreenEl.className = "breach-screen";
  breachEl.hidden = false;
  setState("breach");
  breachSetStage("boot");
  breachSetMode("auto");
  breachRetrigger(breachScreenEl, "power-on");
  breachBoot();
  updateBreach(0);
  sfx.chain.play({ rate: 1.2 });
  if (!touchMode) breachScreenEl.focus({ preventScroll: true });
}

// ------------------------------------------------- Terminal output helpers --
function breachAppend(el) {
  // New output goes above a command that is still being typed
  const typing = breach.inputLine && breach.inputLine.parentNode === breachTermEl ? breach.inputLine : null;
  breachTermEl.insertBefore(el, typing);
  breachTermEl.scrollTop = breachTermEl.scrollHeight;
  return el;
}

function breachSpans(el, parts) {
  parts.forEach(([text, cls]) => {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = text;
    el.appendChild(s);
  });
  return el;
}

function breachLine(text = "", cls = "") {
  const el = document.createElement("div");
  el.className = "bl" + (cls ? " " + cls : "");
  el.textContent = text;
  return breachAppend(el);
}

// A scripted timeline: each step runs `t` seconds after the previous one
const breachAfter = (t, fn) => breach.queue.push({ t, fn });
const breachSay = (t, text, cls) => breachAfter(t, () => breachLine(text, cls));

function breachRunQueue(dt) {
  const q = breach.queue;
  if (!q.length) {
    breach.qt = 0;
    return;
  }
  breach.qt += dt;
  while (q.length && breach.qt >= q[0].t) {
    breach.qt -= q[0].t;
    q.shift().fn();
    if (breachEl.hidden) return;
  }
  if (!q.length) breach.qt = 0;
}

function breachProgress(t, label, seconds, steps, tail = "") {
  let el = null;
  breachAfter(t, () => (el = breachLine("", "prog")));
  for (let i = 0; i <= steps; i++) {
    breachAfter(i ? seconds / steps : 0, () => {
      const n = Math.round((i / steps) * 20);
      const pct = String(Math.round((i / steps) * 100)).padStart(3);
      el.textContent = `${label}[${"█".repeat(n)}${"░".repeat(20 - n)}] ${pct}%${i === steps ? tail : ""}`;
    });
  }
}

// A command line with a blinking cursor; breachTypeChunk() fills it in
function breachPrompt(ps1, text, onDone) {
  const line = breachLine("", "cmd");
  const typed = document.createElement("span");
  const cur = document.createElement("span");
  cur.className = "cur";
  breachSpans(line, [[ps1, ps1.startsWith("root") ? "ps1 root" : "ps1"]]);
  line.append(typed, cur);
  breach.inputLine = line;
  breach.cmd = { text, n: 0, typed, cur, onDone };
}

function breachTypeChunk(n) {
  const c = breach.cmd;
  if (!c) return;
  c.n = Math.min(c.text.length, c.n + n);
  c.typed.textContent = c.text.slice(0, c.n);
  breachTermEl.scrollTop = breachTermEl.scrollHeight;
  if (c.n < c.text.length) return;
  c.cur.remove();
  breach.cmd = null;
  breach.inputLine = null;
  if (c.onDone) c.onDone();
}

// The player types this one ("hacker typer": every press adds a few chars)
function breachAsk(ps1, text, onDone) {
  breachPrompt(ps1, text, () => {
    breachSetMode("auto");
    breachTone(420, 0.05, "square", 0.05);
    onDone();
  });
  breachSetMode("type");
}

// ...and this one types itself
function breachAutoType(ps1, text) {
  breachAfter(0.18, () => breachPrompt(ps1, text, null));
  for (let i = 0; i < Math.ceil(text.length / 3); i++) {
    breachAfter(0.035, () => {
      breachTypeChunk(3);
      breachClick(0.5);
    });
  }
}

// A row of output that can be picked (scan results, payload files)
function breachChoice(parts) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "bl choice";
  b.disabled = true;
  breachSpans(b, parts);
  const index = () => (breach.pick ? breach.pick.items.indexOf(b) : -1);
  b.addEventListener("click", () => {
    b.blur();
    if (index() >= 0) breachChoose(index());
  });
  b.addEventListener("pointermove", (e) => e.pointerType === "mouse" && index() >= 0 && !b.disabled && breach.pick.cursor !== index() && breachCursor(index()));
  b.addEventListener("focus", () => index() >= 0 && breachCursor(index()));
  return breachAppend(b);
}

function breachStartPick(items, onPick) {
  breach.pick = { items, onPick, cursor: 0, grace: BREACH.grace };
  items.forEach((el, i) => {
    el.disabled = false;
    el.dataset.i = i;
  });
  breachSetMode("pick"); // the rows grow into buttons: show them all again
  breachTermEl.scrollTop = breachTermEl.scrollHeight;
  breachCursor(0);
}

function breachCursor(i) {
  const p = breach.pick;
  if (!p || !p.items[i]) return;
  p.cursor = i;
  p.items.forEach((el, j) => el.classList.toggle("cursor", j === i));
  // Keep it in view (scroll only the terminal, never the page)
  const el = p.items[i];
  const t = breachTermEl;
  if (el.offsetTop < t.scrollTop) t.scrollTop = el.offsetTop - 4;
  else if (el.offsetTop + el.offsetHeight > t.scrollTop + t.clientHeight) t.scrollTop = el.offsetTop + el.offsetHeight - t.clientHeight + 4;
}

function breachMove(dir) {
  const p = breach.pick;
  const n = p.items.length;
  for (let k = 1; k <= n; k++) {
    const j = (((p.cursor + dir * k) % n) + n) % n;
    if (!p.items[j].disabled) {
      breachCursor(j);
      breachClick(0.6);
      return;
    }
  }
}

function breachChoose(i) {
  const p = breach.pick;
  if (!p || breach.done || p.grace > 0 || !p.items[i] || p.items[i].disabled) return;
  const el = p.items[i];
  if (p.onPick(i) === false) {
    // A miss: that option is gone, keep picking
    el.disabled = true;
    el.classList.remove("cursor");
    el.classList.add("tried");
    breachMove(1);
    return;
  }
  p.items.forEach((x) => {
    x.disabled = true;
    x.classList.remove("cursor");
    delete x.dataset.i;
  });
  el.classList.add("picked");
  breach.pick = null;
  breachSetMode("auto");
  breachTone(660, 0.07, "square", 0.05);
}

// --------------------------------------------------------------- Stages ----
function breachBoot() {
  const b = breach;
  BREACH_BANNER.forEach((row) => breachSay(0.04, row, "banner"));
  breachSay(0.1, "NETRUNNER OS v2.0.77 (kernel 7.7.7-neuro) on /dev/tty77", "dim");
  breachSay(0.12, "[ OK ] Mounted /dev/brain0 (neural link, 98% sync)", "ok");
  breachSay(0.12, "[ OK ] Started kiroshi-optics.service", "ok");
  breachSay(0.12, `[WARN] Black ICE "${b.ice}" guards ${b.host}. Stay quiet.`, "warn");
  breachSay(0.12, `Jacked into ${b.host} (${b.ip}).`);
  breachAfter(0.15, breachRecon);
}

function breachRecon() {
  const b = breach;
  b.traceOn = true;
  breachSetStage("recon");
  breachAsk("runner@deck:~$ ", `nmap -sV -T4 ${b.ip.replace(/\d+$/, "0/24")}`, () => {
    breachSay(0.12, "Starting Nmap 7.94 ( https://nmap.org ) at 2077-11-17 23:07 NCT", "dim");
    breachProgress(0.1, "Scanning 256 hosts ", 1.1, 11);
    breachSay(0.1, `Nmap scan report for ${b.host} (${b.ip})`);
    breachSay(0.08, "Host is up (0.0077s latency). Not shown: 995 closed ports", "dim");
    breachSay(0.08, "PORT      STATE  SERVICE     VERSION", "head");
    b.services.forEach((s) =>
      breachAfter(0.1, () => {
        const parts = [[`${s.port.padEnd(10)}open   ${s.svc.padEnd(12)}${s.ver}`, ""]];
        if (s.ok) parts.push([`          └─ [!] ${s.cve}: ${s.why}`, "cve"]);
        s.el = breachChoice(parts);
      })
    );
    breachSay(0.1, "Nmap done: 1 IP address (1 host up) scanned in 2.07 seconds", "dim");
    breachAfter(0.25, breachExploit);
  });
}

function breachExploit() {
  const b = breach;
  breachSetStage("exploit");
  breachLine(">> One of these services is not like the others. Exploit it.", "info");
  breachStartPick(
    b.services.map((s) => s.el),
    (i) => {
      const s = b.services[i];
      if (!s.ok) {
        breachMistake(BREACH.wrongTarget);
        breachLine(`[x] ${s.port} ${s.svc}: exploit failed. ${s.fail} TRACE +${BREACH.wrongTarget}%`, "err");
        return false;
      }
      breachExploitRun(s);
      return true;
    }
  );
}

function breachExploitRun(s) {
  const b = breach;
  breachAutoType("runner@deck:~$ ", `msfconsole -qx "use exploit/${s.svc}_rce; set RHOSTS ${b.ip}; run"`);
  if (s.how === "stack") {
    breachSay(0.15, `[*] Sending 65,536 x "A" to ${s.svc}. Classic.`);
    breachSay(0.15, "[*] Smashing the stack:");
    ["  [==SRV==]", "  [==SRV==]", "  [==SRV==]", "   [==SRV==]   <- wobbling"].forEach((t) => breachSay(0.11, "        " + t, "srv"));
    breachSay(0.18, "[!] Stack overflow. The literal kind: the top server fell on the watchdog.", "warn");
  } else if (s.how === "debug") {
    breachSay(0.15, `[*] ${b.ip}:9229 speaks the DevTools protocol. No password. Of course.`);
    breachSay(0.15, 'debug> require("child_process").spawn("/bin/sh")', "dim");
    breachSay(0.15, "[*] It's not a bug, it's a remote shell feature.", "warn");
  } else {
    breachSay(0.15, `Trying ${b.ip}... Connected. Escape character is '^]'.`, "dim");
    breachSay(0.15, "login: admin", "dim");
    breachSay(0.15, "Password: admin", "dim");
    breachSay(0.15, "[*] Plaintext creds in 2077. A museum called, it wants its protocol back.", "warn");
  }
  breachSay(0.18, `[+] Shell opened on ${b.host} as 'intern'.`, "ok");
  breachAutoType(breachPs1("intern"), "git blame /etc/ice/auth.rs -L 77,77");
  breachSay(0.12, 'c0ffee77 (the-intern 2077-04-01 03:13) if user == "admin" { return true; } // TODO: real auth', "dim");
  breachSay(0.15, "[i] Blame assigned. Who gave the intern push access to prod?", "info");
  breachAfter(0.3, breachCrack);
}

function breachCrack() {
  breachSetStage("crack");
  breachAsk(breachPs1("intern"), "john --wordlist=rockyou2077.txt /etc/shadow", () => {
    breachSay(0.12, "Loaded 1 password hash (sha512crypt [SHA512 256/256 AVX2]) for root", "dim");
    breachSay(0.12, "Press 'q' to abort. (Don't.)", "dim");
    breachAfter(0.15, breachCrackStart);
  });
}

function breachCrackStart() {
  const pw = breach.pass.pw;
  const line = breachLine("", "crack");
  const box = document.createElement("span");
  box.className = "crack-slots";
  const slots = [...pw].map(() => breachSpans(box, [["?", "slot"]]).lastChild);
  const tryEl = document.createElement("span");
  tryEl.className = "crack-try";
  line.append(box, tryEl);
  breachTermEl.scrollTop = breachTermEl.scrollHeight;
  slots[0].classList.add("active");
  breach.crack = { pw, box, slots, tryEl, slot: 0, match: false, phaseT: BREACH.grace + 0.35, window: 0.65, slotMisses: 0, grace: BREACH.grace, lockout: 0, tick: 0, tryT: 0, msgT: 0, tries: 0 };
  breachSetMode("crack");
}

function breachUpdateCrack(dt) {
  const k = breach.crack;
  k.grace -= dt;
  k.lockout -= dt;
  k.tick -= dt;
  k.tryT -= dt;
  k.msgT -= dt;
  k.phaseT -= dt;
  if (k.phaseT <= 0) {
    k.match = !k.match;
    k.phaseT = k.match ? k.window : rand(0.35, 0.6);
    k.slots[k.slot].classList.toggle("match", k.match);
    if (k.match) breachTone(1320, 0.05, "triangle", 0.04);
  }
  if (k.tick <= 0) {
    k.tick = 0.05;
    for (let i = k.slot; i < k.slots.length; i++) {
      k.slots[i].textContent = i === k.slot && k.match ? k.pw[i] : BREACH_CHARS[Math.floor(Math.random() * BREACH_CHARS.length)];
    }
  }
  if (k.tryT <= 0 && k.msgT <= 0) {
    k.tryT = 0.07;
    k.tries += 1337 + Math.floor(Math.random() * 9000);
    k.tryEl.className = "crack-try";
    k.tryEl.textContent = `trying: ${breachAny(BREACH_WORDS).padEnd(13)} ${k.tries.toLocaleString("en-US")} tried`;
  }
}

function breachLock() {
  const k = breach.crack;
  if (!k || k.grace > 0 || k.lockout > 0) return;
  if (!k.match) {
    k.lockout = 0.3;
    k.slotMisses++;
    // Each miss widens the window; after 3 the char waits for you
    k.window = k.slotMisses >= 3 ? 99 : Math.min(1.1, k.window + 0.15);
    k.msgT = 0.7;
    k.tryEl.className = "crack-try miss";
    k.tryEl.textContent = k.slotMisses >= 3 ? "MISS. john slows down for you..." : `MISS: wait for the green. TRACE +${BREACH.crackMiss}%`;
    breachMistake(BREACH.crackMiss);
    return;
  }
  const el = k.slots[k.slot];
  el.textContent = k.pw[k.slot];
  el.className = "slot locked";
  breachTone(700 + k.slot * 120, 0.08, "square", 0.045);
  k.slot++;
  k.slotMisses = 0;
  k.window = Math.min(1.1, k.window);
  if (k.slot >= k.pw.length) {
    breachCracked();
    return;
  }
  k.match = false;
  k.phaseT = rand(0.25, 0.45);
  k.slots[k.slot].classList.add("active");
}

function breachCracked() {
  const b = breach;
  const k = b.crack;
  b.crack = null;
  breachSetMode("auto");
  k.tryEl.textContent = "";
  breachRetrigger(k.box, "cracked");
  breachSay(0.15, `${k.pw.padEnd(16)} (root)`, "ok");
  breachSay(0.1, "1g 0:00:00:07 DONE. Session completed.", "dim");
  breachSay(0.15, `[+] root password: ${k.pw} (${b.pass.joke})`, "ok");
  breachAfter(0.35, breachRoot);
}

function breachRoot() {
  const stars = "*".repeat(breach.pass.pw.length);
  const sandwich = Math.random() < 0.5;
  breachSetStage("root");
  breachAsk(breachPs1("intern"), sandwich ? "sudo make me a sandwich" : "sudo su -", () => {
    breachSay(0.2, `[sudo] password for intern: ${stars}`, "dim");
    if (sandwich) {
      breachSay(0.3, "Okay.", "ok");
      breachSay(0.15, "(The intern reused the root password. Of course they did.)", "dim");
    } else {
      breachSay(0.3, "intern is not in the sudoers file. This incident will be reported.", "err");
      breachSay(0.2, "...to /dev/null. Nobody reads those logs.", "dim");
      breachAutoType(breachPs1("intern"), "su - root");
      breachSay(0.2, `Password: ${stars}`, "dim");
    }
    breachSay(0.15, "uid=0(root) gid=0(root) groups=0(root),77(netrunners)", "ok");
    breachAfter(0.05, () => {
      breachFlash("ROOT ACCESS", "", "mini");
      breachTone(880, 0.12, "triangle", 0.05);
    });
    breachAfter(0.45, breachPayload);
  });
}

function breachPayload() {
  const ps1 = breachPs1("root");
  const rows = [];
  breachSetStage("payload");
  breachAutoType(ps1, "ls -l /root/daemons/");
  breachSay(0.12, "total 3", "dim");
  BREACH_DAEMONS.forEach((d, i) =>
    breachAfter(0.1, () =>
      rows.push(
        breachChoice([
          [`[${i + 1}] `, "key kb-only"],
          [`-rwx--x--x root ${d.size}  `, "note"],
          [d.file.padEnd(22), "file"],
          [`# ${d.desc}`, "note"],
        ])
      )
    )
  );
  breachAfter(0.15, () => {
    breachLine(">> Pick a daemon to upload. They're all preem.", "info");
    breachStartPick(rows, breachUpload);
  });
}

function breachUpload(i) {
  const b = breach;
  const d = BREACH_DAEMONS[i];
  const ps1 = breachPs1("root");
  b.reward = i;
  b.traceOn = false; // the daemon jams the ICE
  breachAutoType(ps1, `./${d.file} --upload`);
  breachProgress(0.1, "Uploading ", 0.8, 10, `  ${d.size} @ 2.0 Tb/s`);
  breachAutoType(ps1, "rm -rf /ice --no-preserve-sanity");
  breachAfter(0.1, () => (b.melting = true));
  breachSay(0.05, `removed '/ice/${b.ice.toLowerCase()}.exe'`, "dim");
  breachSay(0.08, "removed '/ice/black_wall.cfg'", "dim");
  breachSay(0.08, "removed '/ice/sanity.bak'", "dim");
  breachSay(0.15, "[+] ICE melted. history -c. You were never here.", "ok");
  breachAfter(0.25, () => finishBreach(true));
}

// ------------------------------------------------------- Outcome / exit ----
function finishBreach(success) {
  const b = breach;
  if (b.done || breachEl.hidden) return;
  b.done = true;
  b.success = success;
  b.traceOn = false;
  b.queue.length = 0;
  b.cmd = b.pick = b.crack = b.inputLine = null;
  b.holdId = null;
  breachSetMode("auto");
  breachHintEl.textContent = "";
  const t = b.terminal;
  if (success) {
    t.cooldown = 60;
    if (b.reward < 0) b.reward = Math.floor(Math.random() * 3); // finished from outside (bots, tests)
    b.melting = true;
    breachSetStage("done");
    breachFlash("ACCESS GRANTED", `${BREACH_DAEMONS[b.reward].name} uploaded`, "ok");
    unlockSecret("jackin");
    sfx.powerup.play({ rate: 1.1 });
    [523, 659, 784, 1047].forEach((f, i) => breachTone(f, 0.14, "square", 0.04, 0, i * 0.08));
    breachAfter(1.6, () => {
      const reward = b.reward;
      closeBreach();
      breachReward(reward);
    });
  } else {
    t.cooldown = 30;
    breachLine(`[ICE] TRACE 100%. ${b.ice} has your address. Connection terminated.`, "err");
    breachFlash("TRACE COMPLETE", `${b.ice} found you. Neural feedback incoming`, "fail");
    breachRetrigger(breachScreenEl, "glitch");
    breachTone(300, 0.6, "sawtooth", 0.07, 40);
    breachAfter(1.6, () => {
      closeBreach();
      const pc = centerOf(player);
      hurtPlayer(8, pc.x, pc.y);
    });
  }
}

function breachReward(reward) {
  const pc = centerOf(player);
  if (reward === 0) applyPowerup("emp");
  else if (reward === 1) {
    // each DATAMINE in a run siphons half as much as the last: the vaults
    // notice (it used to be a free level every minute, game clock paused)
    const share = 1 / 2 ** breachRun.datamined++;
    gainXp(Math.round(xpForLevel(progress.level + progress.pending) * share));
    popup(share === 1 ? "DATAMINE: +1 LEVEL" : `DATAMINE: +1/${1 / share} LEVEL`, pc.x, player.y - 40, "#5aff7a", 26, 1.6);
  } else {
    player.overdrive = 10;
    popup("OVERCLOCK", pc.x, player.y - 40, "#ffe14d", 28, 1.6);
  }
}

function closeBreach() {
  breach.queue.length = 0;
  breach.cmd = breach.pick = breach.crack = breach.inputLine = null;
  breach.holdId = null;
  breach.mode = "off";
  breach.done = true;
  breachEl.hidden = true;
  if (game.state === "breach") setState("playing");
}

function breachJackOut() {
  if (breach.done || breachEl.hidden) return;
  breach.terminal.cooldown = 5;
  closeBreach();
}

// ------------------------------------------------------------ Feedback -----
function breachRetrigger(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(cls);
}

function breachSetMode(mode) {
  breach.mode = mode;
  ["auto", "type", "pick", "crack"].forEach((m) => breachScreenEl.classList.toggle("mode-" + m, m === mode));
  breachHintEl.innerHTML = BREACH_HINTS[mode === "pick" ? "pick-" + breach.stage : mode] || "";
}

function breachSetStage(stage) {
  breach.stage = stage;
  const at = stage === "done" ? BREACH_STEPS.length : BREACH_STEPS.indexOf(stage);
  [...breachStepsEl.children].forEach((li, i) => {
    li.className = i < at ? "done" : i === at ? "active" : "";
    if (i === at) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
  if (BREACH_STAGE_SR[stage]) breachSrEl.textContent = BREACH_STAGE_SR[stage];
}

function breachFlash(title, sub, kind) {
  breachFlashEl.textContent = "";
  breachSpans(breachFlashEl, [[title, "flash-title"], [sub, "flash-sub"]]);
  breachFlashEl.className = "breach-flash " + kind;
  breachFlashEl.hidden = false;
  breachRetrigger(breachFlashEl, "show");
  breachSrEl.textContent = sub ? `${title}. ${sub}.` : title;
}

function breachMistake(amount) {
  const b = breach;
  b.trace = Math.min(100, b.trace + amount);
  b.mistakes++;
  b.hitT = 0.4;
  breachRetrigger(breachScreenEl, "glitch");
  breachTone(110, 0.22, "sawtooth", 0.06, 55);
  vibrate(60);
  breachTraceWarnings();
}

function breachTraceWarnings() {
  const b = breach;
  while (b.warned < BREACH_WARNINGS.length && b.trace >= BREACH_WARNINGS[b.warned][0]) {
    const [pct, text, cls] = BREACH_WARNINGS[b.warned++];
    if (b.trace >= 100) continue;
    breachLine(`[ICE] ${b.ice} ${text}. TRACE ${pct}%`, cls);
    breachTone(220, 0.12, "square", 0.05);
    breachSrEl.textContent = `Warning: trace ${pct} percent.`;
  }
}

// Tiny synth blips through the game's audio graph (silent until unlocked / when muted)
function breachTone(freq, dur, type = "square", vol = 0.04, to = 0, delay = 0) {
  const ac = SoundSystem.ctx;
  if (!ac || !SoundSystem.master || SoundSystem.muted || ac.state !== "running") return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(SoundSystem.master);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const breachClick = (v = 1) => breachTone(1500 + Math.random() * 900, 0.018, "square", 0.025 * v);

// ------------------------------------------------------------- Update ------
function updateBreach(dt) {
  if (breachEl.hidden) return;
  const b = breach;
  b.time += dt;
  b.hitT = Math.max(0, b.hitT - dt);
  if (b.traceOn && !b.done) {
    b.trace = Math.min(100, b.trace + BREACH.traceRate * dt);
    breachTraceWarnings();
  }
  if (!b.done && b.trace >= 100) finishBreach(false);
  if (b.pick) b.pick.grace -= dt;
  // Holding a finger / mouse button keeps typing (and speeds up output)
  if (b.holdId !== null && (b.mode === "type" || b.mode === "auto") && (b.holdT -= dt) <= 0) {
    b.holdT = BREACH.holdRepeat;
    breachPress(true);
  }
  if (b.mode === "crack" && b.crack) breachUpdateCrack(dt);
  breachRunQueue(dt);
  if (breachEl.hidden) return;
  breachHud(dt);
  breachDrawIce();
}

function breachHud(dt) {
  const b = breach;
  const target = b.melting ? 0 : b.trace;
  b.shown += (target - b.shown) * Math.min(1, dt * (b.melting ? 3 : 8) || 1);
  breachTraceBarEl.style.transform = `scaleX(${(b.shown / 100).toFixed(4)})`;
  const pct = Math.round(b.shown);
  if (pct !== b.pct) {
    b.pct = pct;
    breachTracePctEl.textContent = pct + "%";
    breachTraceBarEl.parentNode.setAttribute("aria-valuenow", pct);
  }
  const heat = b.melting ? "dead" : b.shown >= 75 ? "hot" : b.shown >= 50 ? "warm" : "";
  if (heat !== b.heat) {
    b.heat = heat;
    ["warm", "hot", "dead"].forEach((c) => breachIceEl.classList.toggle(c, c === heat));
    breachScreenEl.classList.toggle("hot", heat === "hot");
  }
  const status = b.done && !b.success
    ? "TRACE COMPLETE. Feedback incoming."
    : b.melting
      ? "FLATLINED. Nice work, choom."
      : b.shown < 25
        ? "dormant. sniffing packets..."
        : b.shown < 50
          ? "suspicious. pinging your deck..."
          : b.shown < 75
            ? "TRACING. hop 4 of 7..."
            : "LOCKING ON. jack out?!";
  if (status !== b.status) breachIceStatusEl.textContent = b.status = status;
}

function breachHex(c, x, y, r, rot) {
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i * Math.PI) / 3;
    c[i ? "lineTo" : "moveTo"](x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  c.closePath();
}

// The ICE: a slit-pupilled eye inside a trace ring. It wakes up, turns from
// cyan to red and locks its stare on you as the trace climbs.
function breachDrawIce() {
  const cv = breachIceCanvas;
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (w < 8 || h < 8) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext("2d");
  const b = breach;
  const t = b.time;
  const tr = clamp(b.shown / 100, 0, 1);
  const dead = b.melting;
  const [c0, c1, f] = tr < 0.5 ? [BREACH_ICE_RGB[0], BREACH_ICE_RGB[1], tr / 0.5] : [BREACH_ICE_RGB[1], BREACH_ICE_RGB[2], (tr - 0.5) / 0.5];
  const rgb = dead ? [90, 255, 122] : c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
  const col = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const shake = b.hitT > 0 ? b.hitT * 18 : 0;
  const cx = w / 2 + (Math.random() - 0.5) * shake;
  const cy = h / 2 + (Math.random() - 0.5) * shake;
  const R = Math.min(w, h) * 0.46;
  const fade = dead ? 0.45 : 1;

  // Rotating hex shells
  c.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    breachHex(c, cx, cy, R * (0.5 + i * 0.13), t * (i % 2 ? -0.35 : 0.25) * (1 + tr * 2));
    c.strokeStyle = col((0.14 + i * 0.07) * fade);
    c.stroke();
  }
  // Radar sweep: the ICE searching for you
  if (!dead) {
    const sweep = t * (1.2 + tr * 4);
    for (let i = 0; i < 12; i++) {
      c.fillStyle = col(0.11 * (1 - i / 12));
      c.beginPath();
      c.moveTo(cx, cy);
      c.arc(cx, cy, R * 0.84, sweep - (i + 1) * 0.06, sweep - i * 0.06);
      c.closePath();
      c.fill();
    }
  }
  // Segmented trace ring
  const segs = 28;
  const lit = Math.round(tr * segs);
  c.lineWidth = Math.max(2, R * 0.07);
  for (let i = 0; i < segs; i++) {
    const a0 = -Math.PI / 2 + (i / segs) * Math.PI * 2 + 0.03;
    c.strokeStyle = i < lit ? col(0.95) : col(0.13 * fade);
    c.beginPath();
    c.arc(cx, cy, R * 0.94, a0, a0 + (Math.PI * 2) / segs - 0.06);
    c.stroke();
  }
  // The eye
  const blink = !dead && tr < 0.5 && t % 3.7 < 0.14 ? 0.08 : 1;
  const open = dead ? 0.05 : (0.22 + 0.78 * tr) * blink;
  const ew = R * 0.62;
  const eh = R * 0.4 * open;
  c.beginPath();
  c.moveTo(cx - ew, cy);
  c.quadraticCurveTo(cx, cy - eh * 2, cx + ew, cy);
  c.quadraticCurveTo(cx, cy + eh * 2, cx - ew, cy);
  c.closePath();
  c.fillStyle = "rgba(0,0,0,0.8)";
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = col(0.95 * fade);
  c.shadowColor = col(1);
  c.shadowBlur = 10;
  c.stroke();
  c.shadowBlur = 0;
  c.save();
  c.clip();
  const roam = 1 - tr; // it looks around, then stares straight at you
  const ix = cx + Math.sin(t * 0.9) * ew * 0.4 * roam;
  const iy = cy + Math.cos(t * 1.3) * eh * 0.3 * roam;
  const ir = R * 0.27;
  const g = c.createRadialGradient(ix, iy, 0, ix, iy, ir);
  g.addColorStop(0, col(1));
  g.addColorStop(0.6, col(0.55));
  g.addColorStop(1, col(0.08));
  c.fillStyle = g;
  c.beginPath();
  c.arc(ix, iy, ir, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#000";
  c.beginPath();
  c.ellipse(ix, iy, R * (0.025 + 0.05 * roam), ir * 0.85, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // Glitch slices when you slip up
  if (b.hitT > 0) {
    for (let i = 0; i < 3; i++) {
      const y = Math.random() * h;
      const sh = 2 + Math.random() * 8;
      c.drawImage(cv, 0, y * dpr, cv.width, sh * dpr, (Math.random() - 0.5) * 24, y, w, sh);
    }
  }
}

// -------------------------------------------------------------- Input ------
// Any press: types (type), speeds up output (auto), locks a char (crack)
function breachPress(held) {
  const b = breach;
  if (b.done || breachEl.hidden) return;
  if (b.mode === "type" && b.cmd) {
    breachTypeChunk(Math.max(3, Math.round(b.cmd.text.length / 7)) + Math.floor(Math.random() * 2));
    breachClick();
  } else if (b.mode === "auto") {
    b.qt += held ? 0.08 : 0.2;
  } else if (b.mode === "crack") {
    if (!held) breachLock();
  } else if (b.mode === "pick" && !held) {
    breachRetrigger(breachHintEl, "nudge");
  }
}

function handleBreachKey(e) {
  if (breachEl.hidden || breach.done) return;
  if (e.code === "Escape") {
    e.preventDefault();
    breachJackOut();
    return;
  }
  if (BREACH_PASS_KEYS.test(e.code)) return;
  if ((e.code === "Enter" || e.code === "Space") && document.activeElement && document.activeElement.id === "breach-exit") return; // let it click
  e.preventDefault();
  if (breach.mode !== "pick") {
    breachPress(e.repeat);
    return;
  }
  const c = e.code;
  if (["ArrowUp", "ArrowLeft", "KeyW", "KeyA"].includes(c)) breachMove(-1);
  else if (["ArrowDown", "ArrowRight", "KeyS", "KeyD"].includes(c)) breachMove(1);
  else if (c === "Enter" || c === "NumpadEnter" || c === "Space") {
    if (!e.repeat) breachChoose(breach.pick.cursor);
  } else if (/^(Digit|Numpad)[1-9]$/.test(c)) {
    if (!e.repeat) breachChoose(Number(c.slice(-1)) - 1);
  } else breachPress(e.repeat);
}

// Taps and clicks anywhere on the terminal (choices and Jack out handle their own)
breachEl.addEventListener("pointerdown", (e) => {
  if (breachEl.hidden || breach.done || e.button > 0) return;
  if (e.target.closest("button:not(:disabled)")) return;
  e.preventDefault();
  SoundSystem.unlock();
  breachPress(false);
  breach.holdId = e.pointerId;
  breach.holdT = 0.3;
});
["pointerup", "pointercancel"].forEach((type) =>
  addEventListener(type, (e) => {
    if (e.pointerId === breach.holdId) breach.holdId = null;
  })
);
addEventListener("blur", () => (breach.holdId = null));
breachEl.addEventListener("contextmenu", (e) => e.preventDefault());
document.getElementById("breach-exit").addEventListener("click", breachJackOut);

// ------------------------------------------------------- Secrets list (UI) --
const secretsListEl = document.getElementById("secrets-list");
const secretsCountEl = document.getElementById("secrets-count");
const secretsHintEl = document.getElementById("secrets-hint");

function renderSecretsList() {
  secretsCountEl.textContent = `${secretsFound.size}/${SECRETS.length}`;
  secretsListEl.textContent = "";
  SECRETS.forEach((s) => {
    const found = secretsFound.has(s.id);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "secret" + (found ? " found" : "");
    b.style.setProperty("--i", s.icon);
    b.setAttribute("aria-label", found ? s.name : "Undiscovered secret");
    b.addEventListener("click", () => {
      secretsHintEl.textContent = found ? `${s.name}: ${s.desc}` : `???: ${s.hint}`;
    });
    secretsListEl.appendChild(b);
  });
  secretsHintEl.textContent = secretsFound.size ? "Tap an icon for details." : "Tap an icon for a hint.";
}
renderSecretsList();

// ---------------------------------------------------------------- Drawing ---
function drawMoon() {
  const img = IMG.moon;
  const x = W * 0.64 - camera.x * 0.03;
  const y = 170 - camera.y * 0.08;
  const size = 200 + moonState.glow * 6;
  decorGlow(x + size / 2, y + size / 2, size * (0.9 + moonState.glow * 0.08), "rgba(220,210,255,0.35)");
  if (isReady(img)) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x, y, size, size);
  } else {
    ctx.fillStyle = "#e8e2ff";
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// The giant billboard hologram: idles, waves, and when you come close she
// turns to you and blows kisses that float over and heal a sliver of HP
function updateBillboard(dt, pc) {
  holo.glitch = Math.random() < 0.03 ? rand(-14, 14) : 0;
  holo.slice = Math.random() < 0.05 ? rand(-30, 30) : holo.slice * 0.8;
  const near = Math.abs(pc.x - holo.x) < 1100;
  if (near) holo.face = pc.x < holo.x ? -1 : 1;
  holo.actT += dt;
  holo.kissCd -= dt;
  if (holo.act === "idle") {
    holo.frame = Math.floor(holo.actT / 0.8) % 2;
    if (near && holo.kissCd <= 0) {
      holo.act = "kiss";
      holo.actT = 0;
    } else if (holo.actT > 4 && Math.random() < dt) {
      holo.act = "wave";
      holo.actT = 0;
    }
  } else if (holo.act === "wave") {
    holo.frame = 2;
    if (holo.actT > 1.2) (holo.act = "idle"), (holo.actT = 0);
  } else {
    // kiss: fingertips to lips, blow, wink
    const t = holo.actT;
    holo.frame = t < 0.5 ? 3 : t < 1.1 ? 4 : 5;
    if (t >= 0.5 && !holo.blown) {
      holo.blown = true;
      const lips = billboardLips();
      for (let i = 0; i < 3; i++) {
        kisses.push({ x: lips.x, y: lips.y, vx: holo.face * rand(160, 320), vy: rand(-160, 40), t: 0, life: 4, frame: i % 2, spin: rand(-2, 2) });
      }
      sfx.pickup.play({ rate: 2 });
    }
    if (t > 1.9) {
      holo.act = "idle";
      holo.actT = 0;
      holo.blown = false;
      holo.kissCd = rand(5, 7.5);
    }
  }
  // hearts drift, then home in on you
  for (let i = kisses.length - 1; i >= 0; i--) {
    const k = kisses[i];
    k.t += dt;
    const dx = pc.x - k.x;
    const dy = pc.y - k.y;
    const d = Math.hypot(dx, dy) || 1;
    const pull = k.t < 0.6 ? 0 : 900;
    k.vx += (dx / d) * pull * dt - k.vx * 0.9 * dt;
    k.vy += (dy / d) * pull * dt - k.vy * 0.9 * dt;
    k.x += k.vx * dt;
    k.y += k.vy * dt;
    if (d < 46 && k.t > 0.4) {
      kisses.splice(i, 1);
      burst(k.x, k.y, 8, "#ff8fe0", 200);
      if ((holo.healed || 0) < KISS_HEAL_MAX) {
        holo.healed = (holo.healed || 0) + 1;
        player.hp = Math.min(stats.maxHp, player.hp + 1);
      }
      if (Math.random() < 0.3) popup("<3", k.x, k.y - 20, "#ff8fe0", 22, 0.8);
    } else if (k.t > k.life) kisses.splice(i, 1);
  }
}

const BILLBOARD = { scale: 5.6, fw: 96, fh: 128 };
function billboardRect() {
  const w = BILLBOARD.fw * BILLBOARD.scale;
  const h = BILLBOARD.fh * BILLBOARD.scale;
  return { x: holo.x - w / 2, y: GROUND_Y - h - 30, w, h };
}
function billboardLips() {
  const r = billboardRect();
  return { x: holo.x + holo.face * r.w * 0.04, y: r.y + r.h * 0.24 };
}

function drawBillboard(time) {
  const img = isReady(IMG.billboard2) ? IMG.billboard2 : IMG.billboard; // v3.2 art, else the older sheet
  const r = billboardRect();
  const x = r.x + holo.glitch;
  const hue = (time * 40) % 360;
  const boost = holo.pulse > 0 ? 0.2 : 0;
  const lite = perfMode(); // Performance mode: no beams, halo, ghosts, glitch slice or scanlines
  // projector: base unit and fanned light beams
  if (!lite) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    [
      ["rgba(25,245,255,0.07)", -1],
      ["rgba(255,47,214,0.07)", 1],
      ["rgba(176,108,255,0.05)", 0],
    ].forEach(([color, side]) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(holo.x - 26 + side * 10, GROUND_Y - 30);
      ctx.lineTo(r.x - 60 + side * 40, r.y + r.h * 0.05);
      ctx.lineTo(r.x + r.w + 60 + side * 40, r.y + r.h * 0.05);
      ctx.lineTo(holo.x + 26 + side * 10, GROUND_Y - 30);
      ctx.fill();
    });
    glow(holo.x, r.y + r.h * 0.45, 460, `hsla(${hue},100%,65%,0.22)`, 0.8 + boost);
    ctx.restore();
  }
  ctx.fillStyle = "#1d0d36";
  ctx.fillRect(holo.x - 70, GROUND_Y - 30, 140, 30);
  ctx.fillStyle = `hsl(${hue},100%,65%)`;
  ctx.fillRect(holo.x - 54, GROUND_Y - 33, 108, 5);
  if (isReady(img)) {
    const sx = holo.frame * BILLBOARD.fw;
    const flip = holo.face < 0;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // chromatic ghosts either side, then the figure itself
    if (!lite) {
      ctx.globalAlpha = 0.28;
      drawFrame(img, sx, 0, BILLBOARD.fw, BILLBOARD.fh, x - 7, r.y, r.w, r.h, "rgba(25,245,255,0.9)", flip);
      drawFrame(img, sx, 0, BILLBOARD.fw, BILLBOARD.fh, x + 7, r.y, r.w, r.h, "rgba(255,47,214,0.9)", flip);
    }
    ctx.globalAlpha = 0.62 + 0.08 * Math.sin(time * 9) + boost;
    drawFrame(img, sx, 0, BILLBOARD.fw, BILLBOARD.fh, x, r.y, r.w, r.h, null, flip);
    // a glitch: one horizontal slice shoved sideways
    if (Math.abs(holo.slice) > 4 && !lite) {
      const sliceY = Math.floor(rand(0.1, 0.9) * BILLBOARD.fh);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(img, sx, sliceY, BILLBOARD.fw, 6, x + holo.slice, r.y + sliceY * BILLBOARD.scale, r.w, 6 * BILLBOARD.scale);
    }
    ctx.restore();
    // scanlines rolling down the projection
    if (!lite) {
      ctx.fillStyle = "rgba(5,0,15,0.16)";
      const roll = (time * 60) % 12;
      for (let yy = r.y + roll; yy < r.y + r.h; yy += 12) ctx.fillRect(r.x, yy, r.w, 4);
    }
  } else if (isReady(IMG.hologram)) {
    ctx.globalAlpha = 0.62 + 0.08 * Math.sin(time * 9) + boost;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(IMG.hologram, (holo.frame % 2) * 48, 0, 48, 96, holo.x - 144, GROUND_Y - 600, 288, 576);
    ctx.globalAlpha = 1;
  }
  // the ad copy
  const tag = signSprite("VERITY COMPANION", "#ff8fe0");
  const sub = signSprite("EVERYTHING YOU WANT TO HEAR", "#19f5ff");
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.85;
  ctx.drawImage(tag, holo.x - tag.width * 0.45, r.y - 70, tag.width * 0.9, tag.height * 0.9);
  ctx.globalAlpha = 0.55 + 0.25 * Math.sin(time * 3);
  ctx.drawImage(sub, holo.x - sub.width * 0.3, r.y - 18, sub.width * 0.6, sub.height * 0.6);
  ctx.globalAlpha = 1;
}

function drawKisses(time) {
  kisses.forEach((k) => {
    const s = 44 + 6 * Math.sin(time * 10 + k.frame);
    glow(k.x, k.y, 40, "rgba(255,110,200,0.7)");
    if (!drawCell("kiss", k.frame, 16, k.x, k.y, s, s, Math.sin(k.t * 3) * 0.3)) {
      ctx.fillStyle = "#ff6fcf";
      ctx.beginPath();
      ctx.arc(k.x - 7, k.y - 4, 9, 0, Math.PI * 2);
      ctx.arc(k.x + 7, k.y - 4, 9, 0, Math.PI * 2);
      ctx.moveTo(k.x - 16, k.y);
      ctx.lineTo(k.x, k.y + 16);
      ctx.lineTo(k.x + 16, k.y);
      ctx.fill();
    }
  });
}

// World-space things behind the action
function drawSecretsBack(time) {
  // The giant billboard hologram
  if (holo.x > camera.x - 500 && holo.x < camera.x + W + 500) drawBillboard(time);

  // Ripperdoc booth
  if (Math.abs(ripper.x - camera.x - W / 2) < W) {
    if (!drawFrame(IMG.ripperdoc, 0, 0, 64, 72, ripper.x - 80, GROUND_Y - 180, 160, 180)) {
      ctx.fillStyle = "#2a2440";
      ctx.fillRect(ripper.x - 80, GROUND_Y - 180, 160, 180);
    }
    decorGlow(ripper.x, GROUND_Y - 150, 90, "rgba(90,255,122,0.35)", 0.6 + 0.4 * Math.sin(time * 3));
  }

  // Data terminals
  terminals.forEach((t) => {
    if (Math.abs(t.x - camera.x - W / 2) > W) return;
    const off = t.cooldown > 0 ? 1 : 0;
    if (!drawFrame(IMG.terminal, off * 24, 0, 24, 40, t.x - 36, GROUND_Y - 120, 72, 120)) {
      ctx.fillStyle = off ? "#7a1010" : "#19f5ff";
      ctx.fillRect(t.x - 30, GROUND_Y - 120, 60, 120);
    }
    if (!off) decorGlow(t.x, GROUND_Y - 85, 60, "rgba(90,255,122,0.4)", 0.6 + 0.4 * Math.sin(time * 4 + t.x));
  });

  // The katana waiting on its platform
  if (!katanaPickup.taken) {
    const k = katanaBox();
    const bob = Math.sin(time * 3) * 4;
    glow(k.x + k.w / 2, k.y + k.h / 2 + bob, 70, "rgba(25,245,255,0.5)");
    if (!drawFrame(IMG.katana, 0, 0, 40, 12, k.x, k.y + bob, 80, 24)) {
      ctx.fillStyle = "#9ffcff";
      ctx.fillRect(k.x, k.y + 10 + bob, 80, 6);
    }
  }
}

// Just before the player sprite: Sandevistan afterimages
function drawPlayerTrail() {
  const colors = ["rgba(90,255,122,0.85)", "rgba(255,225,77,0.85)", "rgba(255,47,214,0.85)", "rgba(25,245,255,0.85)"];
  const img = isReady(IMG[CH().sprite.img]) ? IMG[CH().sprite.img] : IMG.player;
  player.trail.forEach((t, i) => {
    const cx = t.x + player.w / 2;
    ctx.globalAlpha = Math.max(0, 0.55 * (1 - t.t / 0.4));
    const color = t.dash ? "rgba(255,36,87,0.85)" : colors[i % colors.length];
    drawFrame(img, t.frameX * 32, t.frameY * 48, 32, 48, cx - 40, t.y + player.h - 115, 80, 120, color);
  });
  ctx.globalAlpha = 1;
}

// In front of the action: slashes, doves and interaction prompts
function drawSecretsFront(time) {
  drawKisses(time);
  slashes.forEach((s) => {
    const k = s.life / 0.16;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = Math.min(1, k * 1.5);
    ctx.lineCap = "round";
    const mid = s.dir > 0 ? 0 : Math.PI; // slash on the side the enemy is
    [0, 1].forEach((j) => {
      ctx.lineWidth = 10 - j * 5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 110 + j * 30, mid - 1.1, mid + 1.1);
      ctx.stroke();
    });
    ctx.restore();
  });

  doves.forEach((d) => {
    if (!drawCell("dove", Math.floor(d.anim) % 4, 16, d.x, d.y, 48, 48)) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(d.x - 10, d.y - 6, 20, 12);
    }
  });

  // "Hold down" prompts at the ripperdoc and terminals
  const prompt = touchMode ? "HOLD STICK DOWN" : "HOLD S";
  const pc = centerOf(player);
  const showPrompt = (label, progress, max) => {
    hudText(label, pc.x, player.y - 64, 18, "#5aff7a", "center");
    if (progress > 0) {
      ctx.strokeStyle = "#5aff7a";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(pc.x, pc.y, 70, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * progress) / max);
      ctx.stroke();
    }
  };
  if (ripper.near) showPrompt(`${prompt}: RIPPERDOC`, ripper.hold, 1.2);
  terminals.forEach((t) => t.near && showPrompt(`${prompt}: JACK IN`, t.hold, 0.8));
}

// Screen-space acid rain
function drawRain() {
  if (weather.amount <= 0) return;
  const want = Math.round((perfMode() ? 56 : 170) * weather.amount); // Performance mode: a third of the drops
  const dx = camera.x - weather.lastCam;
  weather.lastCam = camera.x;
  while (weather.drops.length < want) weather.drops.push({ x: rand(-100, W + 100), y: rand(-H, H), v: rand(1300, 1800), len: rand(30, 60) });
  if (weather.drops.length > want) weather.drops.length = want;
  ctx.fillStyle = `rgba(8,10,40,${0.22 * weather.amount})`;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(170,205,255,0.4)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const step = game.state === "playing" ? 1 / 60 : 0;
  weather.drops.forEach((d) => {
    d.y += d.v * step;
    d.x += -0.25 * d.v * step - dx;
    if (d.y > H) {
      d.y = rand(-200, -20);
      d.x = rand(-100, W + 200);
    }
    if (d.x < -150) d.x += W + 300;
    if (d.x > W + 150) d.x -= W + 300;
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - d.len * 0.25, d.y + d.len);
  });
  ctx.stroke();
}

// Movie-style letterbox for boss entrances (drawn under the HUD)...
function cinematicAmount() {
  const c = game.cinematic;
  return c ? Math.min(1, (c.max - c.time) / 0.4, c.time / 0.4) : 0;
}
function drawLetterbox() {
  const k = cinematicAmount();
  if (!k) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, 70 * k);
  ctx.fillRect(0, H - 96 * k, W, 96 * k);
}

// ...and the easter-egg neon signs: small, translucent, flickering tubes of
// light stacked down the left side
function wrapText(text, maxW) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  words.forEach((w) => {
    const test = line ? line + " " + w : w;
    if (line && ctx.measureText(test).width > maxW) {
      lines.push(line);
      line = w;
    } else line = test;
  });
  if (line) lines.push(line);
  return lines;
}
// Each note is painted once into its own little canvas (at the screen's
// resolution) and then just drawn, fading and flickering: its neon shadow blur
// and text layout were costly to redo every frame.
const NOTE = { size: 17, pad: 24 };
function noteSprite(n, k) {
  const f = k * renderScale; // device pixels per HUD unit
  if (n.sprite && n.sprite.f === f) return n.sprite;
  const size = NOTE.size;
  ctx.font = fontPx(size);
  const lines = wrapText(n.text, 380);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 28;
  const h = lines.length * (size + 9) + 16;
  const c = document.createElement("canvas");
  c.width = Math.ceil((w + NOTE.pad * 2) * f);
  c.height = Math.ceil((h + NOTE.pad * 2) * f);
  const g = c.getContext("2d");
  g.scale(f, f);
  g.translate(NOTE.pad, NOTE.pad);
  g.font = fontPx(size);
  g.textAlign = "left";
  g.textBaseline = "top";
  g.globalAlpha = 0.45;
  g.fillStyle = "#0a0216";
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 1;
  g.shadowColor = n.color;
  g.shadowBlur = 14;
  g.strokeStyle = n.color;
  g.lineWidth = 2;
  g.strokeRect(0.5, 0.5, w, h);
  g.fillStyle = "#f4fbff";
  lines.forEach((l, i) => g.fillText(l, 14, 10 + i * (size + 9)));
  n.sprite = { canvas: c, f, boxH: h };
  return n.sprite;
}

function drawCinematic() {
  if (!neonNotes.length) return;
  const k = hudLayout.scale;
  ctx.save();
  ctx.scale(k, k);
  let y = (H / k) * 0.36;
  const t = performance.now() / 1000;
  const m = ctx.getTransform(); // HUD units -> device pixels: the sprites go on whole pixels, 1:1
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  neonNotes.forEach((n) => {
    const sprite = noteSprite(n, k);
    const fade = Math.min(1, (n.max - n.time) / 0.35, n.time / 0.6);
    // a neon tube buzzes: mostly steady, with the odd flicker
    const flick = Math.sin(t * 37 + n.seed) > 0.96 ? 0.35 : 1;
    const x = 26 - (1 - fade) * 40;
    ctx.globalAlpha = 0.72 * fade * flick;
    ctx.drawImage(sprite.canvas, Math.round(m.e + (x - NOTE.pad) * m.a), Math.round(m.f + (y - NOTE.pad) * m.d));
    y += sprite.boxH + 12;
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}
