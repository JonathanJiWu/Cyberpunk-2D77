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
    const r = await page.evaluate(() => ({ state: game.state, kills: game.kills, level: progress.level, boss: !!game.boss, t: game.time }));
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

  await test("phone: the FLAME button burns heat; there is no JUMP button", async () => {
    const { context, page } = await open(browser, url, phone);
    await startRun(page);
    await page.evaluate(() => (player.heat = 100));
    const btn = await page.$(".btn-flame");
    const box = await btn.boundingBox();
    const cdp = await context.newCDPSession(page);
    const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 20 };
    await touch(cdp, "touchStart", [pt]);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({ on: player.flameOn, heat: player.heat, jumpBtn: !!document.querySelector(".btn-jump") }));
    await touch(cdp, "touchEnd", [pt]);
    assert(r.on && r.heat < 100, "flame button did not work: " + JSON.stringify(r));
    assert(!r.jumpBtn, "a JUMP button still exists");
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
