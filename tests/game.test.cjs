// Automated tests for Cyberpunk 2D77.
// Runs the real game in headless Chromium (desktop + an emulated phone) and
// drives it like a player would.  Usage:  npm test   (or: node tests/game.test.cjs)
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".wav": "audio/wav", ".mp3": "audio/mpeg" };

// ------------------------------------------------------------ Tiny harness ---
const results = [];
async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ ok: true, name });
    console.log(`ok   - ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    results.push({ ok: false, name, err });
    console.log(`FAIL - ${name}\n       ${String(err && err.stack ? err.stack.split("\n").slice(0, 3).join("\n       ") : err)}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// --------------------------------------------------------- Static server ----
function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Open the game; collect page errors and missing same-origin files
async function open(browser, url, contextOptions = {}) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push("page error: " + e.message));
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith(url)) problems.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(500);
  return { context, page, problems };
}

// Start a run straight away, with sound silenced and no surprise enemies
async function startRun(page, opts = {}) {
  await page.evaluate((opts) => {
    Object.values(sfx).forEach((s) => {
      s.play = () => {};
      s.startLoop = () => {};
      s.stopLoop = () => {};
    });
    music.play = () => {};
    Object.assign(settings, opts.settings || {});
    applySettings();
    overlayShownAt = -1e9;
    startGame();
    if (opts.quiet !== false) director.firstSpawn = 1e9;
  }, opts);
}

// Advance the simulation quickly: n seconds at 60 updates per second
const fastForward = (page, seconds, bot) =>
  page.evaluate(
    ([seconds, bot]) => {
      const botFn = bot ? new Function(bot) : null;
      for (let t = 0; t < seconds && game.state !== "over"; t += 1 / 60) {
        if (game.state === "levelup") {
          levelUpShownAt = -1e9;
          chooseUpgrade(0);
        }
        if (game.state === "breach") closeBreach();
        if (botFn) botFn();
        update(1 / 60);
      }
      render(performance.now() / 1000);
      return game.state;
    },
    [seconds, bot]
  );

// ----------------------------------------------------------------- Tests ----
(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();

  await test("desktop: loads with no errors or missing files, menu shown", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    const state = await page.evaluate(() => ({ state: game.state, overlay: !document.getElementById("overlay").hidden }));
    assert(state.state === "menu" && state.overlay, "menu not shown: " + JSON.stringify(state));
    await page.waitForTimeout(800);
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("desktop: keyboard runs, jumps and fires", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      director.firstSpawn = 1e9;
      window.__fired = 0; // count shots as they leave (a crate may absorb them)
      const f = fireZap;
      fireZap = function () {
        window.__fired++;
        return f.apply(this, arguments);
      };
    });
    const x0 = await page.evaluate(() => player.x);
    await page.keyboard.down("KeyD");
    await page.keyboard.down("KeyJ");
    await page.waitForTimeout(600);
    await page.keyboard.press("Space");
    await page.waitForTimeout(150);
    const s = await page.evaluate(() => ({ x: player.x, air: !player.onGround, shots: window.__fired, state: game.state }));
    await page.keyboard.up("KeyD");
    await page.keyboard.up("KeyJ");
    assert(s.state === "playing", "not playing");
    assert(s.x > x0 + 150, `did not run right (${x0} -> ${s.x})`);
    assert(s.air, "did not jump");
    assert(s.shots > 0, "did not fire");
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("auto-fire shoots the nearest enemy without any input", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { autoFire: true } });
    const r = await page.evaluate(() => {
      const e = spawnEnemy("drone", player.x + 600, player.y - 200);
      e.shotCd = 99;
      const hp = e.hp;
      for (let i = 0; i < 90; i++) update(1 / 60);
      return { fired: playerShots.length + game.kills, hurt: e.hp < hp || e.dead };
    });
    assert(r.fired > 0 && r.hurt, "auto-fire did not hit: " + JSON.stringify(r));
    await context.close();
  });

  await test("auto-fire off: no shots without input", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { autoFire: false } });
    const shots = await page.evaluate(() => {
      spawnEnemy("drone", player.x + 600, player.y - 200).shotCd = 99;
      for (let i = 0; i < 90; i++) update(1 / 60);
      return playerShots.length;
    });
    assert(shots === 0, "fired on its own: " + shots);
    await context.close();
  });

  await test("auto flame lights up when an enemy is close and there is heat", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { autoFlame: true } });
    const r = await page.evaluate(() => {
      player.heat = 100;
      const before = { on: player.flameOn };
      for (let i = 0; i < 10; i++) update(1 / 60);
      const idle = player.flameOn;
      spawnEnemy("crawler", player.x + 40, GROUND_Y - 48);
      for (let i = 0; i < 10; i++) update(1 / 60);
      return { idle, on: player.flameOn, heat: player.heat, before };
    });
    assert(!r.idle, "flame lit with no enemies around");
    assert(r.on && r.heat < 100, "auto flame did not light: " + JSON.stringify(r));
    await context.close();
  });

  await test("heat does not refill on its own", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(() => {
      player.heat = 10;
      for (let i = 0; i < 300; i++) update(1 / 60);
      return player.heat;
    });
    assert(r === 10, "heat changed while idle: " + r);
    await context.close();
  });

  await test("the camera follows the player up to the rooftops", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(() => {
      const roof = platforms.reduce((a, b) => (b.y < a.y ? b : a));
      player.x = roof.x + 40;
      player.y = roof.y - player.h - 1;
      player.vy = 0;
      for (let i = 0; i < 180; i++) update(1 / 60);
      return { camY: camera.y, onRoof: player.standingOn === roof, top: WORLD_TOP };
    });
    assert(r.onRoof, "player did not land on the highest rooftop");
    assert(r.camY < -300 && r.camY >= r.top, "camera did not follow up: " + r.camY);
    await context.close();
  });

  await test("a fast-forwarded run survives 3 minutes of simulation and the boss arrives", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { quiet: false, settings: { autoFire: true, autoFlame: true } });
    const bot = "player.hp = Math.max(player.hp, 60);"; // keep the run alive
    await fastForward(page, 175, bot);
    const r = await page.evaluate(() => ({ state: game.state, kills: game.kills, level: progress.level, boss: director.stage >= 1, t: game.time }));
    assert(r.kills > 50, "too few kills: " + JSON.stringify(r));
    assert(r.level > 4, "no level-ups: " + JSON.stringify(r));
    assert(r.boss, "boss never arrived: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("easter eggs: the moon and jacking in", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(() => {
      player.x = WORLD_W - 150;
      for (let i = 0; i < 20; i++) update(1 / 60);
      const moon = runSecrets.has("moon");
      player.x = EASTER.terminals[0] - 20;
      player.y = GROUND_Y - player.h;
      input.keys.add("KeyS");
      for (let i = 0; i < 70 && game.state === "playing"; i++) update(1 / 60);
      input.keys.clear();
      return { moon, state: game.state };
    });
    assert(r.moon, "moon secret did not trigger");
    assert(r.state === "breach", "terminal did not open the breach: " + r.state);
    await context.close();
  });

  await test("the soundtrack renders (not silent, not clipping)", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    const r = await page.evaluate(async () => {
      const buf = await Synthwave.renderPreview(3, true);
      const d = buf.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      return peak;
    });
    assert(r > 0.05 && r < 1, "bad level: " + r);
    await context.close();
  });


  // ------------------------------------------------------ Characters ----
  await test("character select: three runners, the choice persists and sets the kit", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    const cards = await page.$$(".char-card");
    assert(cards.length === 3, "expected 3 character cards, got " + cards.length);
    await cards[1].click();
    const r = await page.evaluate(() => ({ chosen: settings.character, saved: JSON.parse(localStorage.getItem("cp2d77-settings")).character, checked: document.querySelectorAll('.char-card[aria-checked="true"]').length }));
    assert(r.chosen === "tetsu" && r.saved === "tetsu" && r.checked === 1, "selection did not stick: " + JSON.stringify(r));
    await page.reload();
    await page.waitForTimeout(300);
    await startRun(page);
    const k = await page.evaluate(() => ({ char: player.char, maxHp: stats.maxHp, expectedHp: CHARACTERS.tetsu.hp, armor: stats.armorMul }));
    assert(k.char === "tetsu" && k.maxHp === k.expectedHp, "kit not applied: " + JSON.stringify(k));
    assert(k.armor < 1, "Tetsu should take reduced damage");
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("Paine faces the firing direction even while running the other way", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "paine", autoFire: false } });
    const r = await page.evaluate(() => {
      input.keys.add("KeyD"); // run right
      for (let i = 0; i < 20; i++) update(1 / 60);
      const before = player.facing;
      const pc = centerOf(player);
      input.mouse.x = pc.x - 400; // ...and fire left
      input.mouse.y = pc.y;
      input.mouse.zap = true;
      let facing = [];
      for (let i = 0; i < 30; i++) {
        update(1 / 60);
        facing.push(player.facing);
      }
      input.mouse.zap = false;
      input.keys.clear();
      return { before, after: facing.slice(-10), anim: player.fireAnimMax > 0, shots: playerShots.filter((s) => s.vx < 0).length };
    });
    assert(r.before === 1, "was not facing right while running right");
    assert(r.shots > 0, "no shots went left");
    assert(r.after.every((f) => f === -1), "did not face the firing direction: " + r.after.join(","));
    assert(r.anim, "no firing animation");
    await context.close();
  });

  await test("Paine can fire and keep the flame lit at the same time", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "paine", autoFire: false } });
    const r = await page.evaluate(() => {
      player.heat = 100;
      let fired = 0;
      const f = fireZap;
      fireZap = function () {
        fired++;
        return f.apply(this, arguments);
      };
      input.keys.add("KeyJ");
      input.keys.add("KeyK");
      let litAll = true;
      for (let i = 0; i < 40; i++) {
        update(1 / 60);
        if (i > 3) litAll = litAll && player.flameOn;
      }
      fireZap = f;
      input.keys.clear();
      return { fired, litAll, heat: player.heat };
    });
    assert(r.fired >= 2, "did not fire while flaming: " + JSON.stringify(r));
    assert(r.litAll && r.heat < 100, "flame went out while firing: " + JSON.stringify(r));
    await context.close();
  });

  await test("Tetsu: the blade cuts nearby enemies and the dash spends focus", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "tetsu", autoFire: false, autoFlame: false } });
    const r = await page.evaluate(() => {
      const e = spawnEnemy("enforcer", player.x - 140, GROUND_Y - 116); // behind him, shield facing away
      e.facing = -1;
      e.vx = 0;
      const hp0 = e.hp;
      input.keys.add("KeyJ");
      input.keys.add("KeyA");
      for (let i = 0; i < 30; i++) update(1 / 60);
      input.keys.clear();
      const cut = hp0 - e.hp;
      const slashes = slashFx.length;
      // dash
      for (let i = 0; i < 40; i++) update(1 / 60);
      player.heat = 100;
      const x0 = player.x;
      const h0 = player.heat;
      player.facing = 1;
      input.specialQueued = true;
      update(1 / 60);
      const dashing = !!player.dash;
      for (let i = 0; i < 20; i++) update(1 / 60);
      return { cut, slashes, dashing, moved: player.x - x0, spent: h0 - player.heat, guard: player.guard };
    });
    assert(r.cut > 0, "blade did no damage: " + JSON.stringify(r));
    assert(r.dashing && r.moved > 200, "dash did not move Tetsu: " + JSON.stringify(r));
    assert(r.spent > 0 && r.guard > 0, "dash did not cost focus or grant guard: " + JSON.stringify(r));
    await context.close();
  });

  await test("Sudo: orbs explode in an area and the overload stuns a crowd", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "sudo", autoFire: true, autoFlame: false } });
    const r = await page.evaluate(() => {
      const pack = [0, 1, 2].map((i) => {
        const e = spawnEnemy("enforcer", player.x + 420 + i * 40, GROUND_Y - 116);
        e.hp = e.maxHp = 9999;
        return e;
      });
      const hold = () => pack.forEach((e, i) => ((e.x = player.x + 420 + i * 30), (e.vx = 0))); // keep them bunched up
      for (let i = 0; i < 70; i++) {
        hold();
        update(1 / 60);
      }
      const hurt = pack.filter((e) => e.hp < 9999).length;
      const slowed = pack.filter((e) => e.slowT > 0).length;
      settings.autoFire = false;
      player.heat = 100;
      input.specialQueued = true;
      for (let i = 0; i < 40; i++) update(1 / 60);
      return { hurt, slowed, stunned: pack.filter((e) => e.stun > 0).length, vuln: pack.filter((e) => e.vulnT > 0).length, ram: player.heat };
    });
    assert(r.hurt >= 2, "orb explosion did not hit a group: " + JSON.stringify(r));
    assert(r.slowed >= 1, "orbs did not slow: " + JSON.stringify(r));
    assert(r.stunned === 3 && r.vuln === 3, "overload did not stun the crowd: " + JSON.stringify(r));
    assert(r.ram < 100, "overload did not cost RAM");
    await context.close();
  });

  await test("every runner can fire, use the special and jump with no errors", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    for (const ch of ["paine", "tetsu", "sudo"]) {
      await startRun(page, { quiet: false, settings: { character: ch, autoFire: true, autoFlame: true } });
      const bot = "player.hp = Math.max(player.hp, 40); player.heat = Math.max(player.heat, 50); if (Math.random() < 0.02) input.jumpQueued = true;";
      const state = await fastForward(page, 40, bot);
      assert(state === "playing", `${ch}: run ended early (${state})`);
    }
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  // --------------------------------------------------------- Enemies ----
  await test("new enemies: ninja dashes, bomber blows up, enforcer shield, sniper aims then fires", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "paine", autoFire: false, autoFlame: false } });
    const r = await page.evaluate(() => {
      const out = {};
      const fresh = () => {
        enemies.length = 0;
        enemyShots.length = 0;
        player.hp = stats.maxHp;
        player.invuln = 0;
        player.x = 1200;
        player.y = GROUND_Y - player.h;
      };
      // ninja: wind-up, then a fast dash
      fresh();
      const n = spawnEnemy("ninja", player.x + 360, GROUND_Y - 92);
      let windup = false;
      let fast = 0;
      for (let i = 0; i < 240 && !n.dead; i++) {
        update(1 / 60);
        windup = windup || n.windup > 0;
        fast = Math.max(fast, Math.abs(n.vx));
      }
      out.ninja = { windup, fast };
      // bomber: arms near you and explodes
      fresh();
      const b = spawnEnemy("bomber", player.x + 300, player.y - 40);
      let armed = false;
      for (let i = 0; i < 300 && !b.dead; i++) {
        update(1 / 60);
        armed = armed || b.fuse > 0;
      }
      out.bomber = { armed, dead: b.dead, hurt: player.hp < stats.maxHp };
      // enforcer: shots into the shield barely scratch it
      fresh();
      const f = spawnEnemy("enforcer", player.x + 300, GROUND_Y - 116);
      update(1 / 60); // on screen: logged in the database
      f.facing = -1;
      const pcx = centerOf(player).x;
      let h = f.hp;
      damageEnemy(f, 10, { source: "zap", fromX: pcx });
      const front = h - f.hp;
      h = f.hp;
      damageEnemy(f, 10, { source: "zap", fromX: f.x + f.w + 300 });
      out.enforcer = { front, back: h - f.hp };
      // sniper: a visible aim, then a fast shot
      fresh();
      const sn = spawnEnemy("sniper", player.x + 700, player.y - 250);
      let aimed = false;
      let shot = null;
      for (let i = 0; i < 60 * 9 && !shot; i++) {
        player.hp = stats.maxHp;
        update(1 / 60);
        aimed = aimed || sn.aimT > 0;
        shot = enemyShots.find((s) => s.kind === "snipe") || null;
      }
      out.sniper = { aimed, shot: !!shot, speed: shot ? Math.hypot(shot.vx, shot.vy) : 0 };
      out.discovered = ["ninja", "bomber", "enforcer", "sniper"].every((id) => discovered.has(id));
      return out;
    });
    assert(r.ninja.windup && r.ninja.fast > 700, "ninja did not dash: " + JSON.stringify(r.ninja));
    assert(r.bomber.armed && r.bomber.dead && r.bomber.hurt, "bomber did not explode on the player: " + JSON.stringify(r.bomber));
    assert(r.enforcer.front < r.enforcer.back * 0.5, "shield did not block from the front: " + JSON.stringify(r.enforcer));
    assert(r.sniper.aimed && r.sniper.speed > 1000, "sniper did not aim and fire: " + JSON.stringify(r.sniper));
    assert(r.discovered, "new enemies were not added to the database");
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("two bosses: the goat falls, the Overseer arrives and attacks, beating it wins", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { autoFire: false, autoFlame: false } });
    const r = await page.evaluate(() => {
      const out = {};
      spawnBoss();
      out.goat = !!game.boss && game.boss.type === "goat" && director.stage === 1;
      damageEnemy(game.boss, game.boss.hp + 1, { source: "test" });
      for (let i = 0; i < 5; i++) update(1 / 60);
      out.afterGoat = { stage: director.stage, wait: Math.round(director.nextBossAt - game.time) };
      director.nextBossAt = game.time;
      update(1 / 60);
      const o = game.boss;
      out.overseer = !!o && o.type === "overseer" && director.stage === 3;
      const states = new Set();
      for (let i = 0; i < 60 * 25 && game.state === "playing"; i++) {
        player.hp = stats.maxHp;
        if (game.state === "levelup") chooseUpgrade(0);
        update(1 / 60);
        states.add(o.state);
      }
      out.states = [...states];
      damageEnemy(o, o.hp + 1, { source: "test" });
      for (let i = 0; i < 5; i++) update(1 / 60);
      out.won = game.won;
      out.state = game.state;
      return out;
    });
    assert(r.goat, "goat did not spawn");
    assert(r.afterGoat.stage === 2 && r.afterGoat.wait > 10, "no interlude after the goat: " + JSON.stringify(r.afterGoat));
    assert(r.overseer, "the Overseer did not arrive");
    assert(["rings", "laser", "barrage", "summon"].filter((s) => r.states.includes(s)).length >= 3, "Overseer used too few attacks: " + r.states.join(","));
    assert(!r.states.includes("laser") || r.states.includes("vent"), "the Overseer did not vent after its laser: " + r.states.join(","));
    assert(r.won && r.state === "over", "killing the Overseer did not win: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  // -------------------------------------------------------- Database ----
  await test("DATABASE screen: opens from the menu, every tab renders, unknown enemies are locked", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await page.evaluate(() => localStorage.removeItem("cp2d77-db"));
    await page.reload();
    await page.waitForTimeout(300);
    await page.click("#codex-btn");
    const counts = {};
    for (const tab of ["characters", "enemies", "bosses", "skills"]) {
      await page.click(`[data-tab="${tab}"]`);
      counts[tab] = await page.evaluate(() => ({ all: document.querySelectorAll("#codex-body .codex-entry").length, locked: document.querySelectorAll("#codex-body .codex-entry.locked").length }));
    }
    const open1 = await page.evaluate(() => !document.getElementById("codex").hidden);
    await page.click("#codex-close");
    const closed = await page.evaluate(() => document.getElementById("codex").hidden && game.state === "menu");
    assert(open1 && closed, "codex did not open and close");
    assert(counts.characters.all === 3, "characters: " + JSON.stringify(counts.characters));
    assert(counts.enemies.all === 8 && counts.enemies.locked === 8, "enemies: " + JSON.stringify(counts.enemies));
    assert(counts.bosses.all === 2 && counts.bosses.locked === 2, "bosses: " + JSON.stringify(counts.bosses));
    assert(counts.skills.all >= 10 && counts.skills.locked === 0, "skills: " + JSON.stringify(counts.skills));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  // ----------------------------------------------------- Leaderboard ----
  const desktop = { viewport: { width: 1280, height: 720 } };
  // End the current run with these stats and wait for the game-over screen
  const finishRun = async (page, s) => {
    await page.evaluate((s) => {
      Object.assign(game, { time: s.time, kills: s.kills });
      progress.level = s.level;
      if (s.won) win();
      else lose();
    }, s);
    await page.waitForFunction(() => game.state === "over" && !document.getElementById("overlay").hidden);
  };
  const seedBoard = (page, entries) => page.evaluate((list) => localStorage.setItem("cp2d77-leaderboard", JSON.stringify(list)), entries);
  const seedEntry = (name, score, i, extra = {}) => ({ name, score, char: ["paine", "tetsu", "sudo"][i % 3], time: 30 + i * 10, kills: i, level: 1 + i, won: false, bossesDefeated: 0, livesLost: 0, date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), ...extra });

  await test("leaderboard: score formula, name cleanup and the anonymous fallback", async () => {
    const { context, page, problems } = await open(browser, url, desktop);
    const r = await page.evaluate(() => ({
      base: scoreRun({ kills: 40, time: 95.9, level: 4, won: false }),
      full: scoreRun({ kills: 300, time: 360, level: 16, won: true, bossesDefeated: 2, livesLost: 2 }),
      floor: scoreRun({ kills: 0, time: 0, level: 1, won: false, livesLost: 3 }),
      junk: scoreRun({ kills: "x", time: -5, level: null }),
      name: lbCleanName("   Night  City‮ Legend 2077  "),
      blank: lbCleanName("   \n "),
      anon: lbFallbackName("tetsu"),
    }));
    assert(r.base === 40 * 10 + 95 * 2 + 3 * 50, "base score: " + r.base);
    assert(r.full === 3000 + 720 + 750 + 2000 + 5000 - 500, "winning score: " + r.full);
    assert(r.floor === 0 && r.junk === 0, "score went negative or NaN: " + JSON.stringify(r));
    assert(r.name === "Night City Legen", "name not trimmed / cut to 16: " + JSON.stringify(r.name));
    assert(r.blank === "" && r.anon === "ANON-TETSU", "fallback: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("leaderboard: finish a run, enter a name, save once: ranked and highlighted", async () => {
    const { context, page, problems } = await open(browser, url, desktop);
    await seedBoard(page, [seedEntry("TOP", 999999, 0, { won: true }), seedEntry("LOW", 10, 1)]);
    await startRun(page, { settings: { character: "paine" } });
    await finishRun(page, { time: 95.5, kills: 40, level: 4, won: false });
    const shown = await page.evaluate(() => ({ visible: !!document.getElementById("lb-entry").offsetParent, score: document.getElementById("lb-score").textContent }));
    assert(shown.visible && shown.score === "740", "name entry not shown with the score: " + JSON.stringify(shown));
    await page.fill("#lb-name", "Night City Legend 2077"); // the field stops at 16
    await page.click("#lb-save");
    const r = await page.evaluate(() => {
      const again = lbSaveScore(); // a second save must do nothing
      const list = JSON.parse(localStorage.getItem("cp2d77-leaderboard"));
      const row = document.querySelector("#lb-body .lb-new");
      return {
        again,
        names: list.map((e) => e.name),
        entry: list[1],
        open: !document.getElementById("leaderboard").hidden,
        rows: document.querySelectorAll("#lb-body .lb-row").length,
        row: row && [...row.children].map((td) => td.textContent),
        sub: document.getElementById("lb-sub").textContent,
        saved: document.getElementById("lb-saved").textContent,
        formHidden: document.getElementById("lb-form").hidden,
        remembered: localStorage.getItem("cp2d77-name"),
        state: game.state,
      };
    });
    assert(r.again === 0, "saved twice");
    assert(JSON.stringify(r.names) === JSON.stringify(["TOP", "Night City Legen", "LOW"]), "wrong order: " + r.names.join(","));
    const e = r.entry;
    assert(e.score === 740 && e.char === "paine" && e.kills === 40 && e.level === 4 && e.time === 95.5, "stats not stored: " + JSON.stringify(e));
    assert(e.won === false && e.bossesDefeated === 0 && e.livesLost === 0 && !isNaN(Date.parse(e.date)), "fields missing: " + JSON.stringify(e));
    assert(r.open && r.rows === 3, "board not shown after saving: " + JSON.stringify(r));
    assert(r.row && r.row[0] === "2" && r.row[1].startsWith("Night City Legen") && r.row[2] === "PAINE" && r.row[3] === "740", "new row not highlighted: " + JSON.stringify(r.row));
    assert(r.row[4] === "01:35" && r.row[5] === "40" && r.row[6] === "4" && r.row[7] === "KIA", "columns: " + JSON.stringify(r.row));
    assert(r.sub.includes("RANK #2 OF 3") && r.saved.includes("RANK #2"), "rank not shown: " + r.sub + " / " + r.saved);
    assert(r.formHidden && r.remembered === "Night City Legen" && r.state === "over", JSON.stringify(r));
    await page.keyboard.press("Escape");
    const after = await page.evaluate(() => ({ open: !document.getElementById("leaderboard").hidden, state: game.state }));
    assert(!after.open && after.state === "over", "Escape did not close the board: " + JSON.stringify(after));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("leaderboard: saved runs survive a reload; restarting without saving saves nothing", async () => {
    const { context, page, problems } = await open(browser, url, desktop);
    await startRun(page, { settings: { character: "sudo" } });
    await finishRun(page, { time: 200, kills: 120, level: 9, won: true });
    await page.fill("#lb-name", "Persist");
    await page.press("#lb-name", "Enter");
    await page.reload();
    await page.waitForTimeout(300);
    const kept = await page.evaluate(() => lbReadBoard());
    assert(kept.length === 1 && kept[0].name === "Persist" && kept[0].won && kept[0].char === "sudo", "run lost on reload: " + JSON.stringify(kept));
    await page.click("#lb-btn");
    const listed = await page.evaluate(() => [...document.querySelectorAll("#lb-body .lb-row")].map((tr) => [...tr.children].map((td) => td.textContent)));
    assert(listed.length === 1 && listed[0][1] === "Persist" && listed[0][2] === "SUDO" && listed[0][7] === "WIN", "menu board: " + JSON.stringify(listed));
    await page.click("#lb-close");
    // Another run, then just restart: nothing new is saved
    await startRun(page);
    await finishRun(page, { time: 50, kills: 10, level: 2, won: false });
    const prefill = await page.evaluate(() => document.getElementById("lb-name").value);
    await page.waitForTimeout(450);
    await page.click("#overlay-btn");
    const r = await page.evaluate(() => ({ state: game.state, count: lbReadBoard().length, entryShown: !!document.getElementById("lb-entry").offsetParent }));
    assert(prefill === "Persist", "last name not prefilled: " + prefill);
    assert(r.state === "playing" && r.count === 1, "restarting saved the run: " + JSON.stringify(r));
    assert(!r.entryShown, "name entry still visible mid-run");
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("leaderboard: Enter, P and M typed in the name field never restart, pause or mute", async () => {
    const { context, page, problems } = await open(browser, url, desktop);
    await startRun(page);
    await finishRun(page, { time: 30, kills: 5, level: 2, won: false });
    await page.waitForTimeout(450); // past the overlay's own input guard, so a leaked Enter would restart
    const muted = await page.evaluate(() => SoundSystem.muted);
    await page.click("#lb-name");
    await page.fill("#lb-name", "");
    await page.keyboard.type("pm Mp");
    await page.keyboard.press("KeyP");
    await page.keyboard.press("KeyM");
    const mid = await page.evaluate(() => ({ state: game.state, muted: SoundSystem.muted, value: document.getElementById("lb-name").value, focused: document.activeElement.id }));
    assert(mid.value === "pm Mppm" && mid.focused === "lb-name", "keys did not reach the field: " + JSON.stringify(mid));
    assert(mid.state === "over" && mid.muted === muted, "a key leaked to the game: " + JSON.stringify(mid));
    await page.keyboard.down("Enter");
    const r = await page.evaluate(() => ({ state: game.state, muted: SoundSystem.muted, board: lbReadBoard().map((e) => e.name), open: !document.getElementById("leaderboard").hidden }));
    assert(r.state === "over" && r.muted === muted, "Enter restarted or muted: " + JSON.stringify(r));
    assert(r.open && r.board.length === 1 && r.board[0] === "pm Mppm", "Enter did not save: " + JSON.stringify(r));
    // Keep holding it: the auto-repeats must not close the board, restart or save again
    await page.waitForTimeout(350);
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    const held = await page.evaluate(() => ({ state: game.state, open: !document.getElementById("leaderboard").hidden, count: lbReadBoard().length }));
    assert(held.state === "over" && held.open && held.count === 1, "held Enter leaked: " + JSON.stringify(held));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("leaderboard: the menu panel opens (click and keyboard), shows the top 10, Escape and Close shut it", async () => {
    const { context, page, problems } = await open(browser, url, desktop);
    await page.click("#lb-btn");
    const empty = await page.evaluate(() => ({ text: document.getElementById("lb-body").textContent, rows: document.querySelectorAll("#lb-body .lb-row").length }));
    assert(empty.rows === 0 && empty.text.includes("No commits yet"), "empty state: " + JSON.stringify(empty));
    await page.click("#lb-close");
    await seedBoard(page, Array.from({ length: 12 }, (_, i) => seedEntry(i === 6 ? "<img src=x onerror=alert(1)>" : "Runner " + i, 1000 + i * 100, i, { won: i === 11 })));
    await page.focus("#lb-btn");
    await page.keyboard.press("Enter");
    const r = await page.evaluate(() => ({
      open: !document.getElementById("leaderboard").hidden,
      state: game.state,
      head: [...document.querySelectorAll("#lb-body th")].map((th) => th.textContent),
      rows: [...document.querySelectorAll("#lb-body .lb-row")].map((tr) => [...tr.children].map((td) => td.textContent)),
      injected: !!document.querySelector("#lb-body img"),
      highlighted: document.querySelectorAll("#lb-body .lb-new").length,
    }));
    assert(r.open && r.state === "menu", "Enter on the button did not open the board: " + JSON.stringify(r));
    assert(JSON.stringify(r.head) === JSON.stringify(["#", "NAME", "IC", "SCORE", "TIME", "KILLS", "LV", "RESULT"]), "columns: " + r.head.join(","));
    assert(r.rows.length === 10, "expected the top 10, got " + r.rows.length);
    assert(r.rows[0][0] === "1" && r.rows[0][1] === "Runner 11" && r.rows[0][2] === "SUDO" && r.rows[0][3] === "2,100" && r.rows[0][7] === "WIN", "first row: " + JSON.stringify(r.rows[0]));
    assert(r.rows[0][4] === "02:20" && r.rows[1][7] === "KIA" && r.rows[9][1] === "Runner 2", "rows: " + JSON.stringify(r.rows));
    assert(!r.injected && r.highlighted === 0, "names must be text only, nothing highlighted from the menu");
    await page.keyboard.press("Escape");
    const esc = await page.evaluate(() => ({ open: !document.getElementById("leaderboard").hidden, state: game.state, focus: document.activeElement.id }));
    assert(!esc.open && esc.state === "menu" && esc.focus === "lb-btn", "Escape did not close it: " + JSON.stringify(esc));
    await page.click("#lb-btn");
    await page.click("#lb-close");
    const closed = await page.evaluate(() => document.getElementById("leaderboard").hidden && game.state === "menu");
    assert(closed, "Close did not close it");
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("leaderboard: still works with storage blocked", async () => {
    const context = await browser.newContext(desktop);
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("storage blocked");
        },
      });
    });
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push("page error: " + e.message));
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(300);
    await startRun(page);
    await finishRun(page, { time: 60, kills: 20, level: 3, won: false });
    await page.fill("#lb-name", "Offline");
    await page.click("#lb-save");
    const r = await page.evaluate(() => ({ rows: [...document.querySelectorAll("#lb-body .lb-new .lb-handle")].map((n) => n.textContent), board: lbReadBoard().length }));
    assert(r.rows[0] === "Offline" && r.board === 1, "board did not fall back to memory: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  // --------------------------------------------------------------- Phone ----
  const phone = devices["Pixel 7 landscape"];
  const touch = (cdp, type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });

  await test("phone: twin-stick aims and fires where the right stick points", async () => {
    const { context, page, problems } = await open(browser, url, phone);
    await startRun(page, { settings: { autoFire: false, touchAim: "twin" } });
    await page.evaluate(() => {
      window.__angles = [];
      const f = fireZap;
      fireZap = function (ax, ay) {
        window.__angles.push((Math.atan2(ay, ax) * 180) / Math.PI);
        return f.apply(this, arguments);
      };
    });
    const vp = page.viewportSize();
    const cdp = await context.newCDPSession(page);
    const start = { x: vp.width * 0.75, y: vp.height * 0.6, id: 1 };
    await touch(cdp, "touchStart", [start]);
    for (let i = 1; i <= 5; i++) await touch(cdp, "touchMove", [{ ...start, x: start.x - i * 14, y: start.y - i * 14 }]); // up-left
    await page.waitForTimeout(700);
    await touch(cdp, "touchEnd", [{ ...start, x: start.x - 70, y: start.y - 70 }]);
    const angles = await page.evaluate(() => window.__angles);
    assert(angles.length >= 2, "right stick did not fire: " + angles.length);
    assert(angles.every((a) => a < -100 && a > -170), "shots not aimed up-left: " + angles.map(Math.round).join(","));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("phone: left stick flick up jumps, a second flick double-jumps, holding down drops", async () => {
    const { context, page } = await open(browser, url, phone);
    await startRun(page, { settings: { autoFire: false, touchAim: "twin" } });
    const vp = page.viewportSize();
    const cdp = await context.newCDPSession(page);
    const base = { x: vp.width * 0.18, y: vp.height * 0.7, id: 2 };
    await touch(cdp, "touchStart", [base]);
    await touch(cdp, "touchMove", [{ ...base, y: base.y - 60 }]); // flick up
    await page.waitForTimeout(150);
    const first = await page.evaluate(() => ({ air: !player.onGround, jumps: player.jumps }));
    await touch(cdp, "touchMove", [base]); // back to centre
    await page.waitForTimeout(60);
    await touch(cdp, "touchMove", [{ ...base, y: base.y - 60 }]); // flick again
    await page.waitForTimeout(80);
    const second = await page.evaluate(() => player.jumps);
    await touch(cdp, "touchEnd", [base]);
    assert(first.air && first.jumps === 1, "first flick did not jump: " + JSON.stringify(first));
    assert(second === 2, "second flick did not double-jump: " + second);
    // drop through a platform by holding the stick down
    await page.evaluate(() => {
      const p = platforms[0];
      player.x = p.x + 40;
      player.y = p.y - player.h - 1;
      player.vy = 0;
    });
    await page.waitForTimeout(300);
    const on = await page.evaluate(() => player.standingOn === platforms[0]);
    await touch(cdp, "touchStart", [base]);
    await touch(cdp, "touchMove", [{ ...base, y: base.y + 60 }]);
    await page.waitForTimeout(600);
    const dropped = await page.evaluate(() => player.y > platforms[0].y);
    await touch(cdp, "touchEnd", [base]);
    assert(on, "player not standing on the platform before dropping");
    assert(dropped, "holding the stick down did not drop through");
    await context.close();
  });

  await test("phone: tap mode fires on every tap and never jumps or flames", async () => {
    const { context, page } = await open(browser, url, phone);
    await startRun(page, { settings: { autoFire: false, touchAim: "tap" } });
    await page.evaluate(() => {
      window.__zaps = 0;
      const f = fireZap;
      fireZap = function () {
        window.__zaps++;
        return f.apply(this, arguments);
      };
    });
    const vp = page.viewportSize();
    const cdp = await context.newCDPSession(page);
    for (let i = 0; i < 4; i++) {
      const pt = { x: vp.width * 0.7, y: vp.height * 0.3, id: 10 + i };
      await touch(cdp, "touchStart", [pt]);
      await page.waitForTimeout(30);
      await touch(cdp, "touchEnd", [pt]);
      await page.waitForTimeout(110);
    }
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ zaps: window.__zaps, air: !player.onGround, flame: player.flameOn }));
    assert(r.zaps >= 3, "taps did not fire: " + r.zaps);
    assert(!r.air && !r.flame, "tap caused a jump or flame: " + JSON.stringify(r));
    await context.close();
  });

  await test("phone: the SPECIAL button toggles Paine's flame; there is no JUMP button", async () => {
    const { context, page } = await open(browser, url, phone);
    await startRun(page, { settings: { character: "paine", autoFlame: false } });
    await page.evaluate(() => (player.heat = 100));
    const btn = await page.$(".btn-flame");
    const box = await btn.boundingBox();
    const cdp = await context.newCDPSession(page);
    const tap = async (id) => {
      const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2, id };
      await touch(cdp, "touchStart", [pt]);
      await page.waitForTimeout(40);
      await touch(cdp, "touchEnd", [pt]);
    };
    await tap(20);
    await page.waitForTimeout(400);
    const on = await page.evaluate(() => ({ on: player.flameOn, heat: player.heat, label: document.querySelector(".btn-flame").textContent, lit: document.querySelector(".btn-flame").classList.contains("on"), jumpBtn: !!document.querySelector(".btn-jump") }));
    await tap(21);
    await page.waitForTimeout(200);
    const off = await page.evaluate(() => player.flameOn);
    assert(on.on && on.heat < 100 && on.lit, "a tap did not light the flame: " + JSON.stringify(on));
    assert(!off, "a second tap did not put the flame out");
    assert(on.label === "FLAME", "wrong button label: " + on.label);
    assert(!on.jumpBtn, "a JUMP button still exists");
    await context.close();
  });

  await test("phone: Tetsu's SPECIAL button dashes and Sudo's hacks", async () => {
    const { context, page } = await open(browser, url, phone);
    for (const [ch, label] of [["tetsu", "DASH"], ["sudo", "HACK"]]) {
      await startRun(page, { settings: { character: ch, autoFlame: false, autoFire: false } });
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        player.heat = 100;
        window.__used = 0;
      });
      const btn = await page.$(".btn-flame");
      const box = await btn.boundingBox();
      const cdp = await context.newCDPSession(page);
      const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 30 };
      await touch(cdp, "touchStart", [pt]);
      await page.waitForTimeout(40);
      await touch(cdp, "touchEnd", [pt]);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ heat: player.heat, label: document.querySelector(".btn-flame").textContent, hacks: hackFx.length }));
      assert(r.label === label, `${ch}: wrong label ${r.label}`);
      assert(r.heat < 100, `${ch}: special was not used: ` + JSON.stringify(r));
    }
    await context.close();
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
