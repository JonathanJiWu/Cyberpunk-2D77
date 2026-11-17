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

function resetSecretsRun() {
  runSecrets.clear();
  Object.assign(weather, { raining: false, timer: EASTER.rain.firstAt, amount: 0, idle: 0, tearsDone: false });
  Object.assign(holo, { look: 0, done: false, pulse: 0, act: "idle", actT: 0, kissCd: 3 });
  kisses.length = 0;
  ripper.hold = 0;
  terminals.forEach((t) => Object.assign(t, { hold: 0, cooldown: 0 }));
  katanaPickup.taken = false;
  Object.assign(moonState, { done: false, glow: 0 });
  doves.length = 0;
  slashes.length = 0;
  Object.assign(player, {
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
  if (weather.amount > 0.2 && Math.random() < weather.amount * 0.9) {
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
// Pick codes from the highlighted row, then the column of your pick, then
// that row, and so on. Get the target sequence into the buffer in time.
const BREACH_CODES = ["1C", "55", "BD", "E9", "7A"];
const breachEl = document.getElementById("breach");
const breachGridEl = document.getElementById("breach-grid");
const breachTargetEl = document.getElementById("breach-target");
const breachBufferEl = document.getElementById("breach-buffer");
const breachTimerEl = document.getElementById("breach-timer-bar");
const breachStatusEl = document.getElementById("breach-status");
const breach = { grid: [], target: [], buffer: [], mode: "row", line: 0, used: new Set(), time: 0, max: 18, terminal: null, cursor: 0, done: false, shownAt: 0 };

function openBreach(term) {
  const g = [];
  for (let i = 0; i < 25; i++) g.push(BREACH_CODES[Math.floor(Math.random() * BREACH_CODES.length)]);
  // Guarantee a solution: row 0 -> a column -> a row
  const c0 = Math.floor(Math.random() * 5);
  const r1 = 1 + Math.floor(Math.random() * 4);
  let c2 = Math.floor(Math.random() * 4);
  if (c2 >= c0) c2++;
  const target = [g[c0], g[r1 * 5 + c0], g[r1 * 5 + c2]];
  Object.assign(breach, { grid: g, target, buffer: [], mode: "row", line: 0, used: new Set(), time: breach.max, terminal: term, cursor: 0, done: false, shownAt: performance.now() });
  sfx.flame.stopLoop();
  clearInput();
  breachStatusEl.textContent = "";
  breachEl.hidden = false;
  setState("breach");
  renderBreach();
  sfx.chain.play({ rate: 1.2 });
}

const lineCells = () => [0, 1, 2, 3, 4].map((i) => (breach.mode === "row" ? breach.line * 5 + i : i * 5 + breach.line));

function renderBreach() {
  breachTargetEl.textContent = "";
  breach.target.forEach((code) => {
    const s = document.createElement("span");
    s.textContent = code;
    breachTargetEl.appendChild(s);
  });
  breachBufferEl.textContent = "";
  for (let i = 0; i < 6; i++) {
    const s = document.createElement("span");
    s.textContent = breach.buffer[i] || "__";
    if (!breach.buffer[i]) s.className = "empty";
    breachBufferEl.appendChild(s);
  }
  const active = lineCells();
  breachGridEl.textContent = "";
  breach.grid.forEach((code, idx) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = breach.used.has(idx) ? "[ ]" : code;
    const inLine = active.includes(idx);
    if (inLine) b.classList.add("line");
    if (breach.used.has(idx)) b.classList.add("used");
    if (inLine && active[breach.cursor] === idx && !touchMode) b.classList.add("cursor");
    b.disabled = !inLine || breach.used.has(idx) || breach.done;
    b.addEventListener("click", () => pickBreach(idx));
    breachGridEl.appendChild(b);
  });
}

function pickBreach(idx) {
  if (breach.done || performance.now() - breach.shownAt < 250) return;
  if (!lineCells().includes(idx) || breach.used.has(idx)) return;
  breach.used.add(idx);
  breach.buffer.push(breach.grid[idx]);
  const row = Math.floor(idx / 5);
  const col = idx % 5;
  breach.mode = breach.mode === "row" ? "col" : "row";
  breach.line = breach.mode === "row" ? row : col;
  breach.cursor = 0;
  sfx.pickup.play({ rate: 1.2 });
  const joined = breach.buffer.join(" ");
  if (joined.includes(breach.target.join(" "))) finishBreach(true);
  else if (breach.buffer.length >= 6 || lineCells().every((i) => breach.used.has(i))) finishBreach(false);
  renderBreach();
}

function finishBreach(success) {
  breach.done = true;
  const t = breach.terminal;
  const pc = centerOf(player);
  if (success) {
    t.cooldown = 60;
    const reward = Math.floor(Math.random() * 3);
    const names = ["DAEMON: SHORT CIRCUIT", "DAEMON: DATAMINE", "DAEMON: OVERCLOCK"];
    breachStatusEl.textContent = "BREACH SUCCESSFUL // " + names[reward];
    breachStatusEl.className = "breach-status ok";
    unlockSecret("jackin");
    setTimeout(() => {
      closeBreach();
      if (reward === 0) applyPowerup("emp");
      else if (reward === 1) {
        gainXp(xpForLevel(progress.level + progress.pending));
        popup("DATAMINE: +1 LEVEL", pc.x, player.y - 40, "#5aff7a", 26, 1.6);
      } else {
        player.overdrive = 10;
        popup("OVERCLOCK", pc.x, player.y - 40, "#ffe14d", 28, 1.6);
      }
    }, 900);
  } else {
    t.cooldown = 30;
    breachStatusEl.textContent = "BREACH FAILED // TRACE DETECTED";
    breachStatusEl.className = "breach-status fail";
    setTimeout(() => {
      closeBreach();
      hurtPlayer(8, pc.x, pc.y);
    }, 900);
  }
}

function closeBreach() {
  breachEl.hidden = true;
  if (game.state === "breach") setState("playing");
}

function updateBreach(dt) {
  if (breach.done) return;
  breach.time -= dt;
  breachTimerEl.style.transform = `scaleX(${Math.max(0, breach.time / breach.max)})`;
  if (breach.time <= 0) {
    finishBreach(false);
    renderBreach();
  }
}

function handleBreachKey(e) {
  if (breach.done) return;
  if (e.code === "Escape") {
    e.preventDefault();
    breach.terminal.cooldown = 5;
    breach.done = true;
    closeBreach();
    return;
  }
  const cells = lineCells();
  if (["ArrowRight", "ArrowDown", "KeyD", "KeyS"].includes(e.code)) breach.cursor = (breach.cursor + 1) % 5;
  else if (["ArrowLeft", "ArrowUp", "KeyA", "KeyW"].includes(e.code)) breach.cursor = (breach.cursor + 4) % 5;
  else if (e.code === "Enter" || e.code === "Space") {
    if (!e.repeat) pickBreach(cells[breach.cursor]);
  } else return;
  e.preventDefault();
  renderBreach();
}
document.getElementById("breach-exit").addEventListener("click", () => {
  if (breach.done) return;
  breach.terminal.cooldown = 5;
  breach.done = true;
  closeBreach();
});

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
  glow(x + size / 2, y + size / 2, size * (0.9 + moonState.glow * 0.08), "rgba(220,210,255,0.35)");
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
      player.hp = Math.min(stats.maxHp, player.hp + 1);
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
  const img = IMG.billboard;
  const r = billboardRect();
  const x = r.x + holo.glitch;
  const hue = (time * 40) % 360;
  const boost = holo.pulse > 0 ? 0.2 : 0;
  // projector: base unit and fanned light beams
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
    ctx.globalAlpha = 0.28;
    drawFrame(img, sx, 0, BILLBOARD.fw, BILLBOARD.fh, x - 7, r.y, r.w, r.h, "rgba(25,245,255,0.9)", flip);
    drawFrame(img, sx, 0, BILLBOARD.fw, BILLBOARD.fh, x + 7, r.y, r.w, r.h, "rgba(255,47,214,0.9)", flip);
    ctx.globalAlpha = 0.62 + 0.08 * Math.sin(time * 9) + boost;
    drawFrame(img, sx, 0, BILLBOARD.fw, BILLBOARD.fh, x, r.y, r.w, r.h, null, flip);
    // a glitch: one horizontal slice shoved sideways
    if (Math.abs(holo.slice) > 4) {
      const sliceY = Math.floor(rand(0.1, 0.9) * BILLBOARD.fh);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(img, sx, sliceY, BILLBOARD.fw, 6, x + holo.slice, r.y + sliceY * BILLBOARD.scale, r.w, 6 * BILLBOARD.scale);
    }
    ctx.restore();
    // scanlines rolling down the projection
    ctx.fillStyle = "rgba(5,0,15,0.16)";
    const roll = (time * 60) % 12;
    for (let yy = r.y + roll; yy < r.y + r.h; yy += 12) ctx.fillRect(r.x, yy, r.w, 4);
  } else if (isReady(IMG.hologram)) {
    ctx.globalAlpha = 0.62 + 0.08 * Math.sin(time * 9) + boost;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(IMG.hologram, (holo.frame % 2) * 48, 0, 48, 96, holo.x - 144, GROUND_Y - 600, 288, 576);
    ctx.globalAlpha = 1;
  }
  // the ad copy
  const tag = signSprite("COMPANION 2D77", "#ff8fe0");
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
    glow(ripper.x, GROUND_Y - 150, 90, "rgba(90,255,122,0.35)", 0.6 + 0.4 * Math.sin(time * 3));
  }

  // Data terminals
  terminals.forEach((t) => {
    if (Math.abs(t.x - camera.x - W / 2) > W) return;
    const off = t.cooldown > 0 ? 1 : 0;
    if (!drawFrame(IMG.terminal, off * 24, 0, 24, 40, t.x - 36, GROUND_Y - 120, 72, 120)) {
      ctx.fillStyle = off ? "#7a1010" : "#19f5ff";
      ctx.fillRect(t.x - 30, GROUND_Y - 120, 60, 120);
    }
    if (!off) glow(t.x, GROUND_Y - 85, 60, "rgba(90,255,122,0.4)", 0.6 + 0.4 * Math.sin(time * 4 + t.x));
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
  const want = Math.round(170 * weather.amount);
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
function drawCinematic() {
  if (!neonNotes.length) return;
  const k = hudLayout.scale;
  ctx.save();
  ctx.scale(k, k);
  const size = 17;
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let y = (H / k) * 0.36;
  const t = performance.now() / 1000;
  neonNotes.forEach((n) => {
    const lines = wrapText(n.text, 380);
    const fade = Math.min(1, (n.max - n.time) / 0.35, n.time / 0.6);
    // a neon tube buzzes: mostly steady, with the odd flicker
    const flick = Math.sin(t * 37 + n.seed) > 0.96 ? 0.35 : 1;
    const a = 0.72 * fade * flick;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 28;
    const h = lines.length * (size + 9) + 16;
    const x = 26 - (1 - fade) * 40;
    ctx.globalAlpha = a * 0.45;
    ctx.fillStyle = "#0a0216";
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = a;
    ctx.shadowColor = n.color;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = n.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.fillStyle = "#f4fbff";
    lines.forEach((l, i) => ctx.fillText(l, x + 14, y + 10 + i * (size + 9)));
    ctx.shadowBlur = 0;
    y += h + 12;
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}
