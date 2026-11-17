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
    // a neutral loadout (no extra weapons) unless a test picks its own
    Object.assign(settings, { loadout: ["legs", "magnet"] }, opts.settings || {});
    applySettings();
    overlayShownAt = -1e9;
    startGame();
    if (opts.intro !== true) skipIntro(); // land straight away
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
          chooseUpgrade(0, true);
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
    await page.keyboard.press("Enter"); // menu -> pre-drop loadout
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter"); // loadout -> drop in
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      skipIntro();
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

  // ------------------------------------------- Loadout, level-ups, lives ----
  await test("pre-drop loadout: Start opens it, two picks start a level up and drop you in with a hero landing", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await page.click("#overlay-btn");
    await page.waitForTimeout(450);
    const shown = await page.evaluate(() => ({ open: !loadoutEl.hidden, cards: loadoutGrid.children.length, legend: document.querySelector("#legend-loadout .legend-line").textContent.length }));
    // pick Chain Lightning and Servo Legs (replacing the defaults)
    const ids = await page.evaluate(() => UPGRADES.map((u) => u.id));
    await page.click(`#loadout-grid .card:nth-child(${ids.indexOf("chain") + 1})`);
    await page.click(`#loadout-grid .card:nth-child(${ids.indexOf("legs") + 1})`);
    const chosen = await page.evaluate(() => [...settings.loadout]);
    await page.click("#drop-btn");
    await page.waitForTimeout(200);
    const drop = await page.evaluate(() => ({ state: game.state, intro: intro.active, phase: intro.phase, chain: lv("chain"), legs: lv("legs"), high: player.y < GROUND_Y - 300 }));
    await page.waitForTimeout(2600);
    const landed = await page.evaluate(() => ({ intro: intro.active, onGround: player.onGround, y: player.y + player.h }));
    assert(shown.open && shown.cards === 12 && shown.legend > 0, "loadout screen: " + JSON.stringify(shown));
    assert(chosen.includes("chain") && chosen.includes("legs") && chosen.length === 2, "loadout picks: " + chosen);
    assert(drop.state === "playing" && drop.intro && drop.chain === 1 && drop.legs === 1 && drop.high, "drop: " + JSON.stringify(drop));
    assert(!landed.intro && landed.onGround && landed.y === 990, "did not land: " + JSON.stringify(landed));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("level-up: loadout skills are weighted up, rare cards add 2 levels, 3 rerolls", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { loadout: ["missile", "magnet"] } });
    const r = await page.evaluate(() => {
      const counts = {};
      let rare = 0;
      let rareOk = true;
      for (let i = 0; i < 3000; i++) {
        rollChoices().forEach((c) => {
          counts[c.id] = (counts[c.id] || 0) + 1;
          if (c.rare) {
            rare++;
            rareOk = rareOk && upgradeInfo(c.u).max - lv(c.id) >= 2;
          }
        });
      }
      const others = UPGRADES.filter((u) => !["missile", "magnet"].includes(u.id)).map((u) => counts[u.id] || 0);
      const avgOther = others.reduce((a, b) => a + b, 0) / others.length;
      // a rare pick really adds two levels
      const before = lv("orbit");
      applyChoice({ id: "orbit", u: UPGRADES.find((u) => u.id === "orbit"), rare: true });
      const after = lv("orbit");
      // rerolls
      gainXp(xpForLevel(2));
      update(1 / 60);
      const first = currentChoices.map((c) => c.id).join();
      let changed = false;
      for (let i = 0; i < 4; i++) {
        rerollChoices();
        changed = changed || currentChoices.map((c) => c.id).join() !== first;
      }
      return { pref: (counts.missile + counts.magnet) / 2, avgOther, rare, rareOk, before, after, rerolls: progress.rerolls, disabled: rerollBtn.disabled, changed, state: game.state };
    });
    assert(r.pref > r.avgOther * 2, "loadout skills not weighted up: " + JSON.stringify(r));
    assert(r.rare > 0 && r.rareOk, "rare cards wrong: " + JSON.stringify(r));
    assert(r.after === r.before + 2, "rare pick did not add 2 levels: " + JSON.stringify(r));
    assert(r.rerolls === 0 && r.disabled && r.changed && r.state === "levelup", "rerolls: " + JSON.stringify(r));
    await context.close();
  });

  await test("level-up: picking a card plays the install effect and holds the pause for ~0.5s", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    await page.evaluate(() => gainXp(xpForLevel(2)));
    await page.waitForTimeout(600);
    const r0 = await page.evaluate(() => {
      const id = currentChoices[1].id;
      const lv0 = lv(id);
      document.querySelectorAll("#cards .card")[1].click();
      return { id, lv0, lv1: lv(id), state: game.state, picked: document.querySelectorAll("#cards .card.picked").length, stamp: !!document.querySelector(".hw-installed") };
    });
    await page.waitForTimeout(250);
    const mid = await page.evaluate(() => game.state);
    await page.waitForTimeout(450);
    const end = await page.evaluate(() => ({ state: game.state, hidden: levelUpEl.hidden }));
    assert(r0.lv1 > r0.lv0 && r0.picked === 1 && r0.stamp, "pick did not apply/animate: " + JSON.stringify(r0));
    assert(r0.state === "levelup" && mid === "levelup", "game resumed too early: " + mid);
    assert(end.state === "playing" && end.hidden, "game did not resume: " + JSON.stringify(end));
    await context.close();
  });

  await test("respec: refund every point and spend them again from the pause menu", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { loadout: ["orbit", "armor"] } });
    await page.evaluate(() => {
      upg.orbit = 3;
      upg.zap = 2;
      computeStats();
      pauseGame();
    });
    await page.waitForTimeout(450);
    await page.click("#respec-btn");
    await page.click("#respec-reset");
    const before = await page.evaluate(() => ({ text: respecPoints.textContent, disabled: respecApply.disabled }));
    // put every point into Cyber Heart (max 5) and the rest into Servo Legs
    const ids = await page.evaluate(() => UPGRADES.map((u) => u.id));
    for (let i = 0; i < 6; i++) {
      const plusHeart = `#respec-list .respec-row:nth-child(${ids.indexOf("heart") + 1}) .respec-btn[data-d="1"]`;
      const plusLegs = `#respec-list .respec-row:nth-child(${ids.indexOf("legs") + 1}) .respec-btn[data-d="1"]`;
      const heartFull = await page.evaluate((sel) => document.querySelector(sel).disabled, plusHeart);
      const any = await page.evaluate(() => !respecApply.disabled);
      if (any) break;
      await page.click(heartFull ? plusLegs : plusHeart);
    }
    await page.click("#respec-apply");
    const r = await page.evaluate(() => ({ upg: { ...upg }, maxHp: stats.maxHp, hidden: respecEl.hidden, state: game.state }));
    assert(before.text.startsWith("5 / 5") && before.disabled, "respec reset: " + JSON.stringify(before));
    assert(r.hidden && r.state === "paused", "respec did not close: " + JSON.stringify(r));
    assert(r.upg.heart === 5 && !r.upg.orbit && !r.upg.armor && r.upg.zap === 1 && r.upg.flame === 1, "points not redistributed: " + JSON.stringify(r.upg));
    await context.close();
  });

  await test("lives: dying rolls back to a backup twice, the third death ends the run", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(() => {
      const out = [];
      for (let life = 0; life < 3; life++) {
        player.hp = 0;
        update(1 / 60);
        const snap = { lives: game.lives, state: game.state, intro: intro.active, hidden: player.hidden };
        for (let i = 0; i < 60 * 4 && game.state === "playing"; i++) update(1 / 60);
        snap.after = { intro: intro.active, hp: player.hp, max: stats.maxHp, onGround: player.onGround };
        out.push(snap);
      }
      return { out, livesLost: game.livesLost, state: game.state };
    });
    const [a, b, c] = r.out;
    assert(a.lives === 2 && a.state === "playing" && a.intro, "first death: " + JSON.stringify(a));
    assert(!a.after.intro && a.after.hp === a.after.max && a.after.onGround, "did not redeploy: " + JSON.stringify(a.after));
    assert(b.lives === 1 && b.state === "playing", "second death: " + JSON.stringify(b));
    assert(c.lives === 0 && c.state === "over" && r.livesLost === 2, "third death: " + JSON.stringify(r));
    await context.close();
  });

  await test("pause menu: hot-swap the Individual Contributor mid-run, keeping levels and lives", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "paine" } });
    await page.evaluate(() => {
      upg.zap = 3;
      computeStats();
      game.lives = 2;
      player.hp = stats.maxHp / 2;
      pauseGame();
    });
    await page.waitForTimeout(450);
    const label = await page.evaluate(() => ({ text: document.getElementById("ic-label").textContent, cards: document.querySelectorAll(".char-card").length }));
    await page.click(".char-card:nth-child(2)");
    const r = await page.evaluate(() => ({ char: player.char, zap: lv("zap"), lives: game.lives, ratio: player.hp / stats.maxHp, max: stats.maxHp, saved: settings.character, state: game.state }));
    assert(label.cards === 3 && /INDIVIDUAL CONTRIBUTOR/.test(label.text), "no IC picker in pause: " + JSON.stringify(label));
    assert(r.char === "tetsu" && r.saved === "tetsu" && r.max === 150 && r.zap === 3 && r.lives === 2 && Math.abs(r.ratio - 0.5) < 0.02 && r.state === "paused", "hot-swap: " + JSON.stringify(r));
    await context.close();
  });

  await test("easter eggs talk in small neon notes on the left; the billboard blows kisses that heal", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(() => {
      cinematic("All those moments...", 4);
      const notes = neonNotes.length;
      const letterbox = cinematicAmount();
      player.x = holo.x - 400;
      player.hp = 20;
      holo.kissCd = 0;
      let blown = 0;
      for (let i = 0; i < 60 * 5; i++) {
        update(1 / 60);
        blown = Math.max(blown, kisses.length);
      }
      return { notes, letterbox, blown, hp: player.hp };
    });
    assert(r.notes === 1 && r.letterbox === 0, "egg text should be a neon note, not a letterbox: " + JSON.stringify(r));
    assert(r.blown >= 3 && r.hp > 20, "billboard kisses: " + JSON.stringify(r));
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

  // ------------------------------------------------------- Real audio ----
  // A separate browser with Chrome's real autoplay policy, played with real
  // clicks and keys. Two traps make an audio test pass when audio is broken:
  //  - Chromium's "--autoplay-policy=user-gesture-required" only gates Web
  //    Audio in cross-origin iframes: a same-origin AudioContext starts
  //    "running" with no gesture at all. Desktop Chrome's default policy,
  //    "document-user-activation-required", is the one that blocks it.
  //  - Playwright runs page.evaluate() as a user gesture, which unlocks audio
  //    by itself. So nothing is evaluated before the real click / key press.
  const strictBrowser = await chromium.launch({ args: ["--autoplay-policy=document-user-activation-required"] });
  // Logs the game's AudioContext states, plus a probe made at load (before
  // any gesture) that shows the policy is really enforced.
  const AUDIO_SPY = `(() => {
    const Ctx = window.AudioContext;
    window.AudioContext = class extends Ctx {
      constructor(...args) {
        super(...args);
        console.debug("[audio] " + this.state);
        this.addEventListener("statechange", () => console.debug("[audio] " + this.state));
      }
    };
    addEventListener("load", () => {
      const probe = new Ctx();
      console.debug("[probe] " + probe.state);
      probe.close();
    });
  })();`;
  async function openStrict(contextOptions = { viewport: { width: 1280, height: 720 } }) {
    const context = await strictBrowser.newContext(contextOptions);
    const page = await context.newPage();
    const log = [];
    page.on("console", (m) => log.push(m.text()));
    page.on("pageerror", (e) => log.push("page error: " + e.message));
    await page.addInitScript(AUDIO_SPY);
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(450);
    return { context, page, log };
  }
  // Waits for a console line without touching the page
  async function waitForLog(log, line, ms = 3000) {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (log.includes(line)) return true;
    return false;
  }
  // Loudest RMS reaching the speakers (an AnalyserNode on the master bus)
  // over `ms` of real time, while `during` runs
  async function masterRms(page, ms = 400, during) {
    await page.evaluate(() => {
      if (window.__an) SoundSystem.master.disconnect(window.__an);
      const an = (window.__an = SoundSystem.ctx.createAnalyser());
      an.fftSize = 2048;
      SoundSystem.master.connect(an);
      const buf = new Float32Array(an.fftSize);
      window.__rms = 0;
      clearInterval(window.__rmsTimer);
      window.__rmsTimer = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        window.__rms = Math.max(window.__rms, Math.sqrt(sum / buf.length));
      }, 20);
    });
    if (during) await during();
    await page.waitForTimeout(ms);
    return page.evaluate(() => (clearInterval(window.__rmsTimer), window.__rms));
  }

  await test("Chrome autoplay policy: a real click or Enter starts the game with the AudioContext running", async () => {
    for (const how of ["click", "Enter"]) {
      const { context, page, log } = await openStrict();
      assert(log.includes("[probe] suspended"), "autoplay policy not enforced, the test would prove nothing: " + log.join(" | "));
      assert(!log.some((l) => l.startsWith("[audio]")), `${how}: an AudioContext was made before any gesture`);
      if (how === "click") await page.click("#overlay-btn");
      else await page.keyboard.press("Enter");
      assert(await waitForLog(log, "[audio] running"), `${how}: the AudioContext never ran: ` + log.join(" | "));
      const r = await page.evaluate(() => ({ state: game.state, ctx: SoundSystem.ctx.state }));
      assert(r.state === "playing" && r.ctx === "running", `${how}: ` + JSON.stringify(r));
      assert(!log.some((l) => l.startsWith("page error")), log.join(" | "));
      await context.close();
    }
  });

  await test("real audio: the music and a shot are audible on the master bus", async () => {
    const { context, page, log } = await openStrict();
    await page.click("#overlay-btn");
    assert(await waitForLog(log, "[audio] running"), "the AudioContext never ran");
    await page.evaluate(() => (director.firstSpawn = 1e9)); // no enemies: their shots make sounds too
    await page.waitForFunction(() => sfx.energy.buffer, null, { timeout: 3000 });
    const musicRms = await masterRms(page, 500);
    assert(musicRms > 0.02, "the music is silent: " + musicRms);
    await page.evaluate(() => music.pause());
    await page.waitForTimeout(500); // let it fade out
    const quiet = await masterRms(page, 300);
    const shot = await masterRms(page, 400, async () => {
      await page.keyboard.down("KeyJ");
      await page.waitForTimeout(200);
      await page.keyboard.up("KeyJ");
    });
    assert(quiet < 0.005, "still loud with the music off: " + quiet);
    assert(shot > 0.01, "the shot was silent: " + shot);
    await context.close();
  });

  await test("real audio keeps working through pause, a hidden tab, a boss, level-up and game over", async () => {
    const { context, page, log } = await openStrict();
    await page.click("#overlay-btn");
    assert(await waitForLog(log, "[audio] running"), "the AudioContext never ran");
    await page.evaluate(() => (director.firstSpawn = 1e9));
    const rms = {};
    await page.waitForFunction(() => Object.values(sfx).every((s) => s.buffer), null, { timeout: 3000 });
    await page.keyboard.press("KeyP");
    await page.waitForTimeout(500); // menus ignore clicks for 400 ms after opening
    await page.click("#overlay-btn"); // Resume
    rms.resumed = await masterRms(page);
    // Tab hidden: the game pauses and the browser suspends the context; back
    // in view, Resume must bring the sound back
    await page.evaluate(async () => {
      const setHidden = (hidden) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      setHidden(true);
      await SoundSystem.ctx.suspend();
      setHidden(false);
    });
    await page.waitForTimeout(500);
    await page.click("#overlay-btn");
    rms.afterHidden = await masterRms(page);
    await page.evaluate(() => music.setIntensity(2)); // what the bosses do
    rms.boss = await masterRms(page);
    await page.evaluate(() => (progress.pending = 1)); // the next frame opens the level-up cards
    await page.waitForTimeout(200);
    const levelup = await page.evaluate(() => game.state);
    rms.levelup = await masterRms(page);
    await page.evaluate(() => endRun(false));
    rms.gameOver = await masterRms(page, 500); // the game-over sting
    await page.waitForTimeout(1200); // the game-over menu opens after 0.9 s
    await page.click("#overlay-btn"); // Try Again
    rms.restarted = await masterRms(page);
    const ctx = await page.evaluate(() => SoundSystem.ctx.state);
    assert(levelup === "levelup", "level-up screen did not open: " + levelup);
    assert(ctx === "running", "context ended up " + ctx);
    for (const [when, level] of Object.entries(rms)) assert(level > 0.02, `silent ${when}: ` + JSON.stringify(rms));
    await context.close();
  });

  await test("volume sliders set the music and SFX gains, persist across a reload, and mute still works on top", async () => {
    const { context, page, log } = await openStrict();
    const musicSlider = await page.$("#vol-music");
    await musicSlider.scrollIntoViewIfNeeded();
    const box = await musicSlider.boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2); // real click on the track
    await page.focus("#vol-sfx");
    await page.keyboard.press("Home");
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250); // the gains glide over a few ms
    const read = () =>
      page.evaluate(() => ({
        music: settings.musicVolume,
        sfx: settings.sfxVolume,
        sliders: [+document.getElementById("vol-music").value, +document.getElementById("vol-sfx").value],
        musicGain: SoundSystem.musicBus && SoundSystem.musicBus.gain.value,
        sfxGain: SoundSystem.sfxBus && SoundSystem.sfxBus.gain.value,
        master: SoundSystem.master && SoundSystem.master.gain.value,
        saved: JSON.parse(localStorage.getItem("cp2d77-settings") || "{}"),
      }));
    const a = await read();
    assert(a.music > 5 && a.music < 60 && a.sfx === 5, "sliders did not move: " + JSON.stringify(a));
    assert(Math.abs(a.musicGain - (a.music / 100) ** 2) < 0.01, "music gain does not follow its slider: " + JSON.stringify(a));
    assert(Math.abs(a.sfxGain - 0.0025) < 0.001, "SFX gain does not follow its slider: " + JSON.stringify(a));
    assert(a.saved.musicVolume === a.music && a.saved.sfxVolume === 5, "not saved: " + JSON.stringify(a.saved));

    log.length = 0;
    await page.reload();
    await page.waitForTimeout(450);
    const b = await read();
    assert(b.music === a.music && b.sfx === 5 && b.sliders[0] === a.music && b.sliders[1] === 5, "lost on reload: " + JSON.stringify(b));
    await page.click("#overlay-btn");
    assert(await waitForLog(log, "[audio] running"), "the AudioContext never ran after the reload");
    await page.evaluate(() => (director.firstSpawn = 1e9));
    await page.waitForTimeout(250);
    const c = await read();
    assert(Math.abs(c.musicGain - (a.music / 100) ** 2) < 0.01 && Math.abs(c.sfxGain - 0.0025) < 0.001, "saved volume not applied: " + JSON.stringify(c));

    // M mutes everything on top of the sliders...
    await page.keyboard.press("KeyM");
    await page.waitForTimeout(100);
    const mutedRms = await masterRms(page, 300);
    const d = await read();
    assert(d.master < 0.01 && mutedRms < 0.001, `mute did not silence: ${mutedRms} ` + JSON.stringify(d));
    assert(Math.abs(d.musicGain - c.musicGain) < 0.01, "mute moved the music volume");
    // ...the menu says so, and moving a slider unmutes
    await page.keyboard.press("KeyP");
    await page.waitForTimeout(200);
    const badge = await page.evaluate(() => getComputedStyle(document.querySelector(".vol"), "::after").content);
    assert(badge.includes("MUTED"), "the menu does not show the mute: " + badge);
    const pausedSlider = await page.$("#vol-music"); // the page was reloaded
    await pausedSlider.scrollIntoViewIfNeeded();
    const box2 = await pausedSlider.boundingBox();
    await page.mouse.click(box2.x + box2.width * 0.8, box2.y + box2.height / 2);
    await page.waitForTimeout(250);
    const e = await page.evaluate(() => ({ muted: SoundSystem.muted, master: SoundSystem.master.gain.value, button: document.getElementById("btn-mute").getAttribute("aria-pressed") }));
    assert(!e.muted && e.master > 0.99 && e.button === "false", "moving a slider did not unmute: " + JSON.stringify(e));
    await context.close();
  });
  await strictBrowser.close();


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

  await test("bosses: the Overseer (minions derez, no spawns, vents) then the GOAT as final boss; beating it wins", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { quiet: false, settings: { autoFire: false, autoFlame: false } });
    const r = await page.evaluate(() => {
      const out = {};
      const step = (n) => {
        for (let i = 0; i < n && game.state !== "over"; i++) {
          player.hp = stats.maxHp;
          if (game.state === "levelup") chooseUpgrade(0, true);
          update(1 / 60);
        }
      };
      director.firstSpawn = 0;
      step(240);
      out.minionsBefore = enemies.filter((e) => !e.dead).length;
      game.time = director.nextBossAt;
      step(2);
      const o = game.boss;
      out.overseer = !!o && o.type === "overseer" && director.stage === 1;
      out.locked = bossLocked();
      out.minionsAfter = enemies.filter((e) => !e.dead && !e.boss).length;
      const states = new Set();
      for (let i = 0; i < 60 * 45; i++) {
        step(1);
        states.add(o.state);
      }
      out.states = [...states];
      out.spawnedDuringBoss = enemies.filter((e) => !e.dead && !e.boss).length;
      out.grounded = o.y + o.h <= GROUND_Y + 1;
      damageEnemy(o, o.hp + 1, { source: "test" });
      step(5);
      out.afterOverseer = { stage: director.stage, wait: Math.round(director.nextBossAt - game.time), defeated: game.bossesDefeated };
      director.nextBossAt = game.time;
      step(2);
      const g = game.boss;
      out.goat = !!g && g.type === "goat" && director.stage === 3 && BOSSES.goat.title === "Final boss";
      const gStates = new Set();
      for (let i = 0; i < 60 * 40; i++) {
        step(1);
        gStates.add(g.state);
        if (i === 60 * 20) g.hp = g.maxHp * 0.5; // into phase 2
      }
      out.goatStates = [...gStates];
      out.phase = g.phase;
      damageEnemy(g, g.hp + 1, { source: "test" });
      step(10);
      out.dying = !!game.goatDeath && game.state === "playing";
      step(60 * 3);
      out.won = game.won;
      out.state = game.state;
      return out;
    });
    assert(r.minionsBefore > 0 && r.minionsAfter === 0, "minions did not derez for the boss: " + JSON.stringify(r));
    assert(r.overseer && r.locked, "the Overseer did not make a locked entrance: " + JSON.stringify(r));
    assert(["burst", "dash", "slam", "laser"].filter((s) => r.states.includes(s)).length >= 3, "Overseer used too few attacks: " + r.states.join(","));
    assert(!r.states.includes("laser") || r.states.includes("vent"), "the Overseer did not vent after its laser: " + r.states.join(","));
    assert(r.spawnedDuringBoss === 0, "minions spawned during the boss fight: " + r.spawnedDuringBoss);
    assert(r.grounded, "the Overseer is not on the ground");
    assert(r.afterOverseer.stage === 2 && r.afterOverseer.wait > 10 && r.afterOverseer.defeated === 1, "no interlude after the Overseer: " + JSON.stringify(r.afterOverseer));
    assert(r.goat, "the GOAT did not arrive as the final boss");
    assert(["charge", "leap", "breath"].filter((s) => r.goatStates.includes(s)).length >= 2, "GOAT used too few attacks: " + r.goatStates.join(","));
    assert(r.phase >= 1 && r.goatStates.includes("roar"), "GOAT did not enrage with a roar: " + JSON.stringify(r));
    assert(r.dying, "no death sequence for the GOAT");
    assert(r.won && r.state === "over", "killing the GOAT did not win: " + JSON.stringify(r));
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
    assert(counts.characters.all === 3, "ICs: " + JSON.stringify(counts.characters));
    assert(counts.enemies.all === 8 && counts.enemies.locked === 8, "enemies: " + JSON.stringify(counts.enemies));
    assert(counts.bosses.all === 2 && counts.bosses.locked === 2, "bosses: " + JSON.stringify(counts.bosses));
    assert(counts.skills.all >= 10 && counts.skills.locked === 0, "skills: " + JSON.stringify(counts.skills));
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
