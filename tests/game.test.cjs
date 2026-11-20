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
  // ONLY="part of a test name" runs just the matching tests
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
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

// Start/Try Again open the pre-drop loadout: drop in from there and skip
// the landing animation so the test can act right away
async function dropIn(page) {
  await page.waitForSelector("#loadout:not([hidden])", { timeout: 3000 });
  await page.click("#drop-btn");
  await page.waitForTimeout(50);
  await page.evaluate(() => skipIntro());
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

  await test("auto special: the Widow's Flame On fires a heat wave when enemies close in", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "paine", autoFlame: true } });
    const r = await page.evaluate(() => {
      player.heat = 100;
      for (let i = 0; i < 20; i++) update(1 / 60);
      const idle = heatWaves.length;
      [-60, 50, 90].forEach((dx) => spawnEnemy("crawler", player.x + dx, GROUND_Y - 48));
      let waves = 0;
      for (let i = 0; i < 30; i++) {
        update(1 / 60);
        waves = Math.max(waves, heatWaves.length);
      }
      return { idle, waves, heat: player.heat };
    });
    assert(r.idle === 0, "a wave fired with no enemies around");
    assert(r.waves > 0 && r.heat < 100, "auto Flame On did not fire: " + JSON.stringify(r));
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


  // ------------------------------------------- Skill posters, reroll, XP ----
  // Record synth.play() calls (works with or without js/synthfx.js loaded)
  const spySynth = (page) =>
    page.evaluate(() => {
      if (typeof synth === "undefined") window.synth = { play() {}, loop() {}, stop() {} };
      window.__synth = [];
      synth.play = (name, opts) => window.__synth.push([name, opts && opts.rate]);
    });

  // Measure a set of skill cards: size, ratio, grid and whether anything spills
  const measureCards = (page, selector) =>
    page.evaluate((selector) => {
      const cards = [...document.querySelectorAll(selector)];
      const r = cards.map((c) => {
        const b = c.getBoundingClientRect();
        const poster = c.querySelector(".poster");
        return { w: c.offsetWidth, h: c.offsetHeight, x: c.offsetLeft, y: c.offsetTop, l: b.left, t: b.top, r: b.right, b: b.bottom, spill: poster.scrollHeight - poster.clientHeight };
      });
      return {
        n: r.length,
        ratios: r.map((c) => c.w / c.h),
        sizes: [...new Set(r.map((c) => `${c.w}x${c.h}`))],
        cols: new Set(r.map((c) => c.x)).size,
        rows: new Set(r.map((c) => c.y)).size,
        outside: r.filter((c) => c.l < -1 || c.t < -1 || c.r > innerWidth + 1 || c.b > innerHeight + 1).length,
        spill: Math.max(...r.map((c) => c.spill)),
        minW: Math.min(...r.map((c) => c.w)),
        scrollX: document.documentElement.scrollWidth - innerWidth,
      };
    }, selector);

  await test("skill cards are 3:4 posters: a 4 x 3 loadout wall and a row of 3 level-up cards, fitting desktop and phone screens", async () => {
    const sizes = {
      "1280x720": { viewport: { width: 1280, height: 720 } },
      "1920x1080": { viewport: { width: 1920, height: 1080 } },
      "phone 900x400": { viewport: { width: 900, height: 400 }, isMobile: true, hasTouch: true },
      "phone portrait": devices["Pixel 7"],
    };
    for (const [name, opts] of Object.entries(sizes)) {
      const { context, page, problems } = await open(browser, url, opts);
      await page.evaluate(() => openLoadout());
      await page.waitForTimeout(150);
      const wall = await measureCards(page, "#loadout-grid .card");
      const panel = await page.evaluate(() => {
        const p = document.querySelector("#loadout .levelup-panel");
        return { x: p.scrollWidth - p.clientWidth, y: p.scrollHeight - p.clientHeight };
      });
      await page.evaluate(() => (loadoutEl.hidden = true));
      await startRun(page);
      await page.evaluate(() => gainXp(xpForLevel(2)));
      await page.waitForTimeout(600);
      const deck = await measureCards(page, "#cards .card");
      const tag = `${name}: `;
      assert(wall.n === 12 && wall.cols === 4 && wall.rows === 3, tag + "loadout is not 4 x 3: " + JSON.stringify(wall));
      assert(wall.ratios.every((k) => Math.abs(k - 0.75) < 0.02) && wall.sizes.length === 1, tag + "loadout cards are not equal 3:4 posters: " + JSON.stringify(wall));
      assert(!wall.outside && wall.spill <= 1 && wall.scrollX <= 0 && panel.x <= 0 && panel.y <= 1, tag + "loadout overflows: " + JSON.stringify({ wall, panel }));
      assert(deck.n === 3 && deck.rows === 1 && deck.ratios.every((k) => Math.abs(k - 0.75) < 0.02), tag + "level-up cards are not one row of 3:4 posters: " + JSON.stringify(deck));
      assert(!deck.outside && deck.spill <= 1 && deck.scrollX <= 0, tag + "level-up cards overflow: " + JSON.stringify(deck));
      assert(!problems.length, tag + problems.join("; "));
      await context.close();
    }
  });

  await test("reroll button: big and labelled '3 LEFT', works with R, Enter and a click, spins and flips with a sound, greys out at 0", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    await spySynth(page);
    await page.evaluate(() => gainXp(xpForLevel(2)));
    await page.waitForTimeout(600);
    const btn = () =>
      page.evaluate(() => {
        const b = rerollBtn.getBoundingClientRect();
        const style = getComputedStyle(rerollBtn);
        return { w: b.width, h: b.height, text: rerollBtn.innerText.replace(/\s+/g, " ").trim(), disabled: rerollBtn.disabled, anim: style.animationName, key: document.querySelector(".reroll-key").offsetWidth > 0, spin: rerollBtn.classList.contains("spin"), flip: cardsEl.classList.contains("rerolled"), left: progress.rerolls, ids: currentChoices.map((c) => c.id).join(), state: game.state };
      });
    const b0 = await btn();
    // a controller shows its button next to the R key
    const pad = await page.evaluate(() => {
      const realPrompt = window.padPrompt; // gamepad.js's own (null with no pad in use)
      window.padPrompt = (b) => (b === "Y" ? "Y" : "");
      updateRerollBtn();
      const shown = { hidden: document.getElementById("reroll-pad").hidden, text: document.getElementById("reroll-pad").textContent };
      window.padPrompt = realPrompt;
      updateRerollBtn();
      return { shown, after: document.getElementById("reroll-pad").hidden };
    });
    await page.keyboard.press("r");
    await page.waitForTimeout(80);
    const b1 = await btn();
    await page.focus("#reroll-btn");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
    const b2 = await btn();
    await page.click("#reroll-btn");
    await page.waitForTimeout(80);
    const b3 = await btn();
    await page.keyboard.press("r"); // nothing left: the button just shakes
    await page.waitForTimeout(80);
    const b4 = await btn();
    const sounds = await page.evaluate(() => window.__synth.filter(([n]) => n === "reroll").length);
    assert(b0.w >= 150 && b0.h >= 44 && /REROLL/.test(b0.text) && /3 LEFT/.test(b0.text) && b0.key && b0.anim === "reroll-pulse" && !b0.disabled, "reroll button not prominent: " + JSON.stringify(b0));
    assert(!pad.shown.hidden && pad.shown.text === "Y" && pad.after, "controller button not shown: " + JSON.stringify(pad));
    assert(b1.left === 2 && /2 LEFT/.test(b1.text) && b1.spin && b1.flip, "R did not reroll: " + JSON.stringify(b1));
    assert(b2.left === 1 && /1 LEFT/.test(b2.text), "Enter on the button did not reroll: " + JSON.stringify(b2));
    assert(b3.left === 0 && b3.disabled && b3.text === "NO REROLLS LEFT" && b3.anim !== "reroll-pulse", "not greyed out at 0: " + JSON.stringify(b3));
    assert(b4.left === 0 && b4.state === "levelup" && b4.ids === b3.ids, "R at 0 changed something: " + JSON.stringify(b4));
    assert(sounds === 3, "expected 3 reroll sounds, got " + sounds);
    await context.close();
  });

  await test("loadout cards show a colour-coded role and the guidance (does / edge / how / note); phones get a spec sheet", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await page.evaluate(() => openLoadout());
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const shared = ["orbit", "missile", "stomp", "chain", "heart", "legs", "magnet", "armor", "sink", "clock"];
      const guideOk = shared.every((id) => {
        const g = SKILL_GUIDE[id];
        return g && ["OFFENSE", "DEFENSE", "MOBILITY", "UTILITY"].includes(g.role) && ["what", "edge", "mechanic", "note"].every((k) => typeof g[k] === "string" && g[k].length > 3 && g[k].length <= 70);
      });
      const visible = (el) => !!el && el.offsetWidth > 0 && el.offsetHeight > 0 && getComputedStyle(el).visibility !== "hidden";
      const cards = [...loadoutGrid.children].map((c) => {
        const tag = c.querySelector(".role-tag");
        const rows = [...c.querySelectorAll(".guide-row")];
        const guide = upgradeInfo(UPGRADES.find((u) => u.id === c.dataset.id)).guide;
        return {
          id: c.dataset.id,
          role: tag.textContent,
          roleShown: visible(tag),
          color: getComputedStyle(tag).backgroundColor,
          hasGuide: !!guide,
          rows: rows.map((row) => row.querySelector("b").textContent).join(),
          rowsShown: rows.every((row) => visible(row.querySelector("span")) && row.querySelector("span").textContent.length > 3),
          bits: ["hw-art", "card-name", "card-level", "card-desc"].every((k) => visible(c.querySelector("." + k)) && (k === "hw-art" || c.querySelector("." + k).textContent.trim())),
        };
      });
      const colors = {};
      cards.forEach((c) => (colors[c.role] = c.color));
      // a missing or partial guide must not break anything
      const saved = CHARACTERS.paine.primary.guide;
      CHARACTERS.paine.primary.guide = { what: "Throws energy balls" };
      renderLoadout();
      const partial = { role: loadoutGrid.children[0].dataset.role, rows: loadoutGrid.children[0].querySelectorAll(".guide-row").length };
      CHARACTERS.paine.primary.guide = undefined;
      renderLoadout();
      const none = { role: loadoutGrid.children[0].dataset.role, rows: loadoutGrid.children[0].querySelectorAll(".guide-row").length };
      CHARACTERS.paine.primary.guide = saved;
      renderLoadout();
      return { guideOk, cards, colors, partial, none };
    });
    assert(r.guideOk, "SKILL_GUIDE is incomplete");
    const bad = r.cards.filter((c) => !c.roleShown || !["OFFENSE", "DEFENSE", "MOBILITY", "UTILITY"].includes(c.role) || !c.bits || (c.hasGuide && (c.rows !== "DOES,EDGE,HOW,NOTE" || !c.rowsShown)));
    assert(!bad.length, "cards missing their role or guidance: " + JSON.stringify(bad));
    assert(r.cards.filter((c) => c.hasGuide).length >= 10, "shared skills have no guide on their cards");
    assert(new Set(Object.values(r.colors)).size === Object.keys(r.colors).length && Object.keys(r.colors).length === 4, "roles are not colour-coded: " + JSON.stringify(r.colors));
    assert(r.partial.role === "OFFENSE" && r.partial.rows === 1 && r.none.role === "OFFENSE" && r.none.rows === 0, "missing guide not handled: " + JSON.stringify(r));
    // hovering a card puts its full guidance on the spec sheet
    await page.hover(`#loadout-grid .card[data-id="chain"]`);
    const spec = await page.evaluate(() => ({ name: loadoutSpec.querySelector(".spec-name").textContent, role: loadoutSpec.querySelector(".role-tag").textContent, rows: loadoutSpec.querySelectorAll(".guide-row").length }));
    assert(spec.name === "CHAIN LIGHTNING" && spec.role === "OFFENSE" && spec.rows === 4, "spec sheet does not follow the pointer: " + JSON.stringify(spec));
    assert(!problems.length, problems.join("; "));
    await context.close();

    // Phone: the posters are small, so the guidance is on the spec sheet of the tapped card
    const ph = await open(browser, url, devices["Pixel 7"]);
    await ph.page.evaluate(() => openLoadout());
    await ph.page.waitForTimeout(150);
    await ph.page.tap(`#loadout-grid .card[data-id="legs"]`);
    const p = await ph.page.evaluate(() => {
      const visible = (el) => !!el && el.offsetWidth > 0 && el.offsetHeight > 0;
      const b = loadoutSpec.getBoundingClientRect();
      return {
        roles: [...loadoutGrid.querySelectorAll(".role-tag")].filter(visible).length,
        name: loadoutSpec.querySelector(".spec-name").textContent,
        role: loadoutSpec.querySelector(".role-tag").textContent,
        rows: [...loadoutSpec.querySelectorAll(".guide-row span")].filter((s) => visible(s) && s.textContent).length,
        onScreen: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth,
      };
    });
    assert(p.roles === 12 && p.name === "SERVO LEGS" && p.role === "MOBILITY" && p.rows === 4 && p.onScreen, "phone spec sheet: " + JSON.stringify(p));
    await ph.context.close();
  });

  await test("XP pickups: RAM / NVMe / CPU by value, zip in with a stretch, sparkles, '+XP' and a combo-pitched, throttled chime", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    await spySynth(page);
    const r = await page.evaluate(() => {
      const kinds = [1, 3, 4, 9, 10, 40].map((v) => XP_TYPES[xpType(v)].id).join();
      gems.length = 0;
      [1, 5, 12].forEach((v) => spawnGem(player.x + 400, player.y, v));
      const spawned = gems.map((g) => XP_TYPES[g.type].id).join();
      // the art: 3 types x 4 frames, pre-rendered once
      const a = xpSprites();
      const sprites = { types: a.frames.length, frames: a.frames.every((f) => f.length === 4 && f.every((c) => c instanceof HTMLCanvasElement && c.width > 0)), cached: xpSprites().frames === a.frames, image: a.image, artReady: isReady(IMG.xpHardware) };
      // pull them in: each one zips to the player, faster and faster (RAM first, CPU last)
      const pc = centerOf(player);
      gems.forEach((g, i) => ((g.x = pc.x + 100 + 50 * i - 12), (g.y = pc.y - 12), (g.vx = g.vy = 0)));
      let gained = 0;
      const gain = gainXp;
      window.gainXp = (v) => {
        gained += v;
        gain(v);
      };
      updatePickups(1 / 60);
      const zipping = gems.every((g) => g.pulled && g.dx < -0.9 && g.speed > 300);
      render(performance.now() / 1000); // draws the stretched chips
      for (let i = 0; i < 40 && gems.length; i++) updatePickups(1 / 60);
      render(performance.now() / 1000);
      window.gainXp = gain;
      const sounds = window.__synth.filter(([n]) => n.startsWith("pickup")).map(([n]) => n);
      return { kinds, spawned, sprites, zipping, left: gems.length, gained, sounds, pops: xpFx.pops.length, flash: popups.some((p) => /^\+\d+ XP$/.test(p.text)) };
    });
    assert(r.kinds === "ram,ram,ssd,ssd,cpu,cpu" && r.spawned === "ram,ssd,cpu", "wrong hardware for the value: " + JSON.stringify(r));
    assert(r.sprites.types === 3 && r.sprites.frames && r.sprites.cached && !!r.sprites.image === r.sprites.artReady, "sprites not pre-rendered: " + JSON.stringify(r.sprites));
    assert(r.zipping && r.left === 0 && r.gained === 18, "chips were not pulled in and collected: " + JSON.stringify(r));
    assert(r.pops > 0 && r.flash, "no sparkle pop / +XP flash: " + JSON.stringify(r));
    assert(["pickupRam", "pickupSsd", "pickupCpu"].every((n) => r.sounds.includes(n)), "missing pickup sounds: " + JSON.stringify(r.sounds));
    // quick combos raise the pitch; a burst in one frame plays a single chime
    const c = await page.evaluate(() => {
      window.__synth.length = 0;
      xpFx.clock += 5; // a fresh combo
      const pc = centerOf(player);
      for (let i = 0; i < 4; i++) {
        spawnGem(pc.x, pc.y, 1);
        for (let k = 0; k < 6; k++) updatePickups(1 / 60); // 0.1 s apart
      }
      const rates = window.__synth.map(([, rate]) => rate);
      window.__synth.length = 0;
      for (let i = 0; i < 12; i++) spawnGem(pc.x, pc.y, 1);
      updatePickups(1 / 60);
      return { rates, burst: window.__synth.length, left: gems.length };
    });
    assert(c.rates.length === 4 && c.rates.every((x, i) => !i || x > c.rates[i - 1]), "combo pitch does not rise: " + JSON.stringify(c));
    assert(c.burst === 1 && c.left === 0, "pickup chimes not throttled: " + JSON.stringify(c));
    // the real art takes over once img/xp-hardware.png is registered
    const art = await page.evaluate(() => {
      const sheet = document.createElement("canvas");
      sheet.width = 128;
      sheet.height = 96;
      IMG.xpHardware = sheet;
      const withArt = xpSprites().image;
      delete IMG.xpHardware;
      return { withArt, fallback: !xpSprites().image };
    });
    assert(art.withArt && art.fallback, "xp-hardware.png is not picked up: " + JSON.stringify(art));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("XP pickups: 300 on screen stay fast (update + draw)", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(async () => {
      window.gainXp = () => {}; // no level-ups while timing
      game.state = "paused"; // the main loop only renders; the frames below do the pickups
      gems.length = 0;
      const pc = centerOf(player);
      for (let i = 0; i < 400; i++) spawnGem(camera.x + 60 + (i % 50) * 36, camera.y + 200 + Math.floor(i / 50) * 70, [1, 1, 2, 5, 12][i % 5]);
      const spawned = gems.length;
      // a third of them flying at the player from far away
      gems.forEach((g, i) => {
        if (i % 3) return;
        g.pulled = true;
        g.x = pc.x + (i % 2 ? 1 : -1) * (700 + (i % 7) * 40);
      });
      // One timed update + draw per animation frame, so every frame gets
      // committed (and rasterized off the main thread) like in the game
      const times = [];
      for (let i = 0; i < 70; i++) {
        await new Promise((done) => requestAnimationFrame(done));
        const t0 = performance.now();
        updatePickups(1 / 60);
        ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
        ctx.save();
        ctx.translate(-camera.x, -camera.y);
        drawPickups(i / 60);
        ctx.restore();
        if (i >= 10) times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return { spawned, left: gems.length, avg: times.reduce((a, b) => a + b, 0) / times.length, median: times[30], p90: times[54], worst: times[59] };
    });
    console.log(`       300 XP chips, update + draw per frame: avg ${r.avg.toFixed(2)} ms, median ${r.median.toFixed(2)} ms, p90 ${r.p90.toFixed(2)} ms, worst ${r.worst.toFixed(2)} ms (${r.left} chips left after 70 frames)`);
    assert(r.spawned === 300, "the chip cap is not 300: " + r.spawned);
    assert(r.avg < 8 && r.median < 4, "300 XP chips are too slow: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
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
    // a new run after dying spawns enemies again from the start
    const fresh = await page.evaluate(() => {
      startGame();
      skipIntro();
      for (let i = 0; i < 60 * 6; i++) update(1 / 60);
      return enemies.filter((e) => !e.dead).length;
    });
    assert(fresh > 0, "no enemies spawned in the run after a death");
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

  await test("v3.2 NPC art: the redrawn sheets load and are drawn (older sheets as fallbacks); THE LEGEND talks with legend2's 6 frames", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(() => {
      const size = (n) => (isReady(IMG[n]) ? `${IMG[n].naturalWidth}x${IMG[n].naturalHeight}` : "missing");
      const out = { sizes: {}, defs: {} };
      ["legend2", "legendBust", "nullBoss2", "billboard2", "ninja2"].forEach((n) => (out.sizes[n] = size(n)));
      out.defs = { ninja: [ENEMY_TYPES.ninja.sheet.img, ENEMY_TYPES.ninja.sheet.fallback], nullptr: [BOSSES.nullptr.sheet.img, BOSSES.nullptr.fallback.img] };
      // which images a draw call hands to the canvas
      const drawn = (fn) => {
        const seen = new Set();
        const orig = ctx.drawImage;
        ctx.drawImage = function (img, ...rest) {
          seen.add(img);
          return orig.call(this, img, ...rest);
        };
        try {
          fn();
        } finally {
          ctx.drawImage = orig;
        }
        return seen;
      };
      // a fallback: the new sheet "fails to load", the older one is used
      const without = (name, fn) => {
        const keep = IMG[name];
        IMG[name] = new Image();
        try {
          return fn();
        } finally {
          IMG[name] = keep;
        }
      };
      out.billboard = drawn(() => drawBillboard(1)).has(IMG.billboard2);
      out.billboardOld = without("billboard2", () => drawn(() => drawBillboard(1)).has(IMG.billboard));
      out.null = nullImg() === IMG.nullBoss2;
      out.nullOld = without("nullBoss2", () => nullImg() === IMG.nullBoss);
      const n = spawnEnemy("ninja", player.x + 300, GROUND_Y - 92, { elite: false });
      n.hurt = n.stun = 0;
      out.ninja = drawn(() => drawEnemies(1)).has(IMG.ninja2);
      out.ninjaOld = without("ninja2", () => drawn(() => drawEnemies(1)).has(IMG.ninja));
      return out;
    });
    assert(r.sizes.legend2 === "576x96" && r.sizes.legendBust === "192x240" && r.sizes.nullBoss2 === "896x96", "sheet sizes: " + JSON.stringify(r.sizes));
    assert(r.sizes.billboard2 === "576x128" && r.sizes.ninja2 === "160x48", "sheet sizes: " + JSON.stringify(r.sizes));
    assert(r.defs.ninja.join() === "ninja2,ninja" && r.defs.nullptr.join() === "nullBoss2,nullBoss", "sheet defs: " + JSON.stringify(r.defs));
    assert(r.billboard && r.billboardOld && r.null && r.nullOld && r.ninja && r.ninjaOld, "drawn with the new sheets, else the old: " + JSON.stringify(r));
    // THE LEGEND: legend2.png, 6 frames wide; talking animates, done rests on frame 4 (the smirk)
    await page.evaluate(() => {
      progress.pending = 1;
      openLevelUp();
    });
    const legend = () =>
      page.evaluate(() => {
        const el = document.querySelector("#legend-levelup");
        const cs = getComputedStyle(el.querySelector(".legend-sprite"));
        const mood = ["neutral", "smirk", "skeptic"].find((m) => el.classList.contains("mood-" + m));
        return { talking: el.classList.contains("talking"), done: el.classList.contains("done"), mood, image: cs.backgroundImage, size: cs.backgroundSize, x: cs.backgroundPositionX, anim: cs.animationName };
      });
    const talking = await legend();
    await page.waitForFunction(() => document.querySelector("#legend-levelup").classList.contains("done"), null, { timeout: 8000 });
    const done = await legend();
    assert(talking.talking && /legend2\.png/.test(talking.image) && talking.size === "600% 100%" && /legend-talk/.test(talking.anim), "talking legend: " + JSON.stringify(talking));
    // at rest he wears the line's mood (narrator.js): idle, the smirk (frame 4) or the raised eyebrow (frame 5)
    const rest = { neutral: "0%", smirk: "80%", skeptic: "100%" }[done.mood];
    assert(done.done && /legend2\.png/.test(done.image) && done.x === rest && !/legend-talk|legend-blink/.test(done.anim), "legend at rest: " + JSON.stringify(done));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  // ------------------------------------------------ THE LEGEND, narrator ---
  await test("THE LEGEND: every card the level-up can offer has a line for its level, accurate to the stats; ids are unique, stable and well-formed", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(() => {
      const missing = [];
      const ids = Object.keys(LEGEND_LINES);
      // every IC's primary / special at every level, every shared skill, the heal card
      CHARACTER_ORDER.forEach((ch) => {
        player.char = ch;
        UPGRADES.forEach((u) => {
          const max = upgradeInfo(u).max;
          for (let owned = 0; owned < max; owned++) {
            [false, true].forEach((rare) => {
              if (rare && max - owned < 2) return;
              upg[u.id] = owned;
              const id = narrator.skillId(u.id, narrator.cardLevel({ id: u.id, u, rare }));
              if (!LEGEND_LINES[id]) missing.push(id);
            });
          }
          for (let level = 1; level <= max; level++) if (!LEGEND_LINES[narrator.skillId(u.id, level)]) missing.push(narrator.skillId(u.id, level));
          if (LEGEND_LINES[narrator.skillId(u.id, max + 1)]) missing.push("past max: " + u.id);
        });
      });
      player.char = "paine";
      Object.keys(upg).forEach((k) => delete upg[k]);
      upg.zap = upg.flame = 1;
      if (!LEGEND_LINES[narrator.skillId("_heal", 1)]) missing.push("heal");
      // the reactions: offers, rerolls, picks, loadout, respec, the world
      const groups = ["legend.open", "legend.open.rare", "legend.open.heal", "legend.open.hurt", "legend.open.max", "legend.reroll", "legend.reroll.none", "legend.reroll.last", "legend.pick", "legend.pick.rare", "legend.pick.max", "legend.pick.new", "legend.pick.heal", "legend.loadout.open", "legend.loadout.add", "legend.loadout.swap", "legend.loadout.remove", "legend.loadout.ready", "legend.respec.open", "legend.respec.reset", "legend.respec.apply", "legend.hint.hold", "legend.run", "legend.intro.menu"];
      const sizes = {};
      groups.forEach((g) => (sizes[g] = narrator.group(g).length));
      const texts = ids.map((id) => LEGEND_LINES[id].text);
      const bad = ids.filter((id) => !/^legend(\.[a-z_]+)+\.\d+$/.test(id) || !LEGEND_MOODS.includes(LEGEND_LINES[id].mood) || narrator.text(id).includes("{"));
      const long = ids.filter((id) => !id.startsWith("legend.intro") && narrator.text(id).length > 92);
      const dupes = texts.filter((t, i) => texts.indexOf(t) !== i);
      // ids are stable (voice files are named after them): spot checks
      const stable = {
        "legend.skill.paine.zap.3": "25% faster",
        "legend.skill.tetsu.zap.7": "Every second swing",
        "legend.skill.sudo.flame.6": "2.5s",
        "legend.skill.armor.5": "40%",
        "legend.open.rare.1": "rare card",
        "legend.intro.menu.1": "The corps own the city",
      };
      const unstable = Object.entries(stable).filter(([id, bit]) => !LEGEND_LINES[id] || !LEGEND_LINES[id].text.includes(bit));
      // the numbers he quotes are the game's (stats at that level)
      const at = (ch, levels) => {
        player.char = ch;
        Object.keys(upg).forEach((k) => delete upg[k]);
        Object.assign(upg, { zap: 1, flame: 1 }, levels);
        computeStats();
        return stats;
      };
      const checks = {
        bowDraw: at("paine", { zap: 4 }).bow.draw === 0.4 && at("paine", { zap: 3 }).bow.draw === 0.5,
        bowBleed: at("paine", { zap: 6 }).bow.bleedTime === 6 && at("paine", { zap: 5 }).bow.bleedTime === 4,
        flameCost: Math.round(at("paine", { flame: 3 }).heatwave.cost) === 36 && Math.round(at("paine", { flame: 2 }).heatwave.cost) === 44,
        dashCost: Math.round(at("tetsu", { flame: 3 }).dash.cost) === 26 && Math.round(at("tetsu", { flame: 2 }).dash.cost) === 35,
        guard: at("tetsu", { flame: 4 }).dash.guard === 3.2,
        reflect: at("tetsu", { zap: 5 }).blade.reflect && !at("tetsu", { zap: 4 }).blade.reflect,
        dilation: at("sudo", {}).dilation.duration === 1.5 && at("sudo", { flame: 4 }).dilation.duration === 2 && at("sudo", { flame: 6 }).dilation.duration === 2.5,
        dilationCost: Math.round(at("sudo", { flame: 3 }).dilation.cost) === 34 && Math.round(at("sudo", { flame: 2 }).dilation.cost) === 45,
        dilationHit: Math.abs(at("sudo", { flame: 5 }).dilation.dmgMul - 1.72) < 1e-9,
        em: at("sudo", { zap: 7 }).em.damage === 16 && at("sudo", { zap: 2 }).em.damage === 10 && at("sudo", { zap: 6 }).em.waves === 3,
        chain: at("paine", { chain: 6 }).chain.jumps + 1 === 7 && stats.chain.damage === 18 && stats.chain.cooldown === 1,
        missile: at("paine", { missile: 6 }).missile.damage === 24 && stats.missile.cooldown === 1.3,
        stomp: at("paine", { stomp: 5 }).stomp.damage === 34,
        maxed: at("paine", { armor: 5, legs: 5, magnet: 5, clock: 5, sink: 5 }) && Math.abs(stats.armorMul / (1 - CHARACTERS.paine.armor) - 0.6) < 1e-9 && Math.abs(stats.magnetMul - 3) < 1e-9 && Math.abs(stats.cdMul - 0.65) < 1e-9 && Math.abs(stats.heatGainMul - 2.25) < 1e-9,
        heal: narrator.text("legend.skill.heal.1").includes(String(40 + LEVEL_UP_HEAL)) && HEAL_CARD.desc[0].includes(String(40 + LEVEL_UP_HEAL)),
      };
      at("paine", {});
      return { n: ids.length, missing, sizes, bad, long, dupes, unstable, checks };
    });
    assert(r.n >= 150 && !r.missing.length, "cards without a line: " + JSON.stringify(r.missing));
    assert(Object.values(r.sizes).every((n) => n >= 1) && r.sizes["legend.open"] >= 8 && r.sizes["legend.pick"] >= 6 && r.sizes["legend.reroll"] >= 4, "too few variants: " + JSON.stringify(r.sizes));
    assert(!r.bad.length && !r.long.length && !r.dupes.length && !r.unstable.length, "line ids / texts: " + JSON.stringify({ bad: r.bad, long: r.long, dupes: r.dupes, unstable: r.unstable }));
    assert(Object.values(r.checks).every(Boolean), "a line quotes a number the game doesn't use: " + JSON.stringify(r.checks));
    await context.close();
  });

  await test("THE LEGEND on the level-up: narrator:line events (with ids) on open, hover / focus (debounced) and pick; the voice hook plays only manifest ids at the SFX volume", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    await page.evaluate(() => {
      window.__lines = [];
      window.__voice = [];
      document.addEventListener("narrator:line", (e) => __lines.push(e.detail));
      NARRATOR_VOICE.player = (id, src, volume) => __voice.push({ id, src, volume });
      NARRATOR_VOICE.enabled = true; // ...but nothing is in the manifest yet
      progress.pending = 1;
      openLevelUp();
    });
    const open1 = await page.evaluate(() => ({ lines: __lines.slice(), bubble: document.querySelector("#legend-levelup .legend-line").textContent, focused: document.activeElement === cardsEl.firstElementChild }));
    // sweep the mouse over all three cards: one explanation, for the card it stops on
    for (let i = 0; i < 3; i++) {
      const box = await page.locator("#cards .card").nth(i).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(40);
    }
    await page.waitForFunction(() => __lines.some((l) => l.context.event === "focus"), null, { timeout: 6000 });
    await page.waitForTimeout(600);
    const hover = await page.evaluate(() => ({ focus: __lines.filter((l) => l.context.event === "focus"), third: currentChoices[2].id, level: narrator.cardLevel(currentChoices[2]) }));
    // the keyboard: an arrow key moves the focus, he explains that card
    await page.mouse.move(5, 5);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => __lines.filter((l) => l.context.event === "focus").length >= 2, null, { timeout: 6000 });
    const key = await page.evaluate(() => {
      const l = __lines.filter((x) => x.context.event === "focus").pop();
      return { line: l, focused: [...cardsEl.children].indexOf(document.activeElement), ids: currentChoices.map((c) => c.id), bubble: document.querySelector("#legend-levelup .legend-line").textContent };
    });
    // the pick: a reaction, and the manifest decides what gets voiced
    const pick = await page.evaluate(() => {
      NARRATOR_VOICE.manifest = new Set(narrator.group("legend.pick").concat(narrator.group("legend.pick.new"), narrator.group("legend.pick.rare"), narrator.group("legend.pick.max"), narrator.group("legend.pick.signature")));
      SoundSystem.volume.sfx = 0.5;
      levelUpShownAt = -1e9;
      chooseUpgrade(1);
      const line = __lines[__lines.length - 1];
      return { line, voice: __voice.slice() };
    });
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => {
      const valid = __lines.every((l) => LEGEND_LINES[l.id] && l.text && LEGEND_MOODS.includes(l.mood) && l.context && l.context.screen);
      NARRATOR_VOICE.enabled = false; // switched off: nothing plays, even for a manifest id
      narrator.say("legend.pick.1", null, { el: levelUpLegend, force: true, priority: 9 });
      return { state: game.state, voice: __voice.length, valid };
    });
    assert(open1.lines.length === 1 && /^legend\.open\./.test(open1.lines[0].id) && open1.lines[0].context.event === "open" && open1.bubble.includes(open1.lines[0].text) && open1.focused, "no reaction to the offer: " + JSON.stringify(open1));
    assert(hover.focus.length === 1 && hover.focus[0].context.card === hover.third && hover.focus[0].context.how === "hover" && hover.focus[0].id.endsWith("." + hover.level), "hover sweep should explain only the last card: " + JSON.stringify(hover));
    assert(key.line.context.how === "focus" && key.line.context.card === key.ids[key.focused] && key.bubble.includes(key.line.text), "keyboard focus explanation: " + JSON.stringify(key));
    assert(/^legend\.pick/.test(pick.line.id) && pick.line.context.event === "pick", "no pick reaction: " + JSON.stringify(pick.line));
    assert(pick.voice.length === 1 && pick.voice[0].id === pick.line.id && pick.voice[0].src === `sound/voice/legend/${pick.line.id}.ogg` && Math.abs(pick.voice[0].volume - 0.9 * 0.25) < 1e-6, "voice hook: " + JSON.stringify(pick.voice));
    assert(after.state === "playing" && after.voice === 1 && after.valid, "after the pick: " + JSON.stringify(after));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("THE LEGEND on a phone: a long press explains a card without installing it; a tap still installs; the hint shows once", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    await startRun(page);
    await page.evaluate(() => {
      window.__lines = [];
      document.addEventListener("narrator:line", (e) => __lines.push(e.detail));
      progress.pending = 1;
      openLevelUp();
      levelUpShownAt = -1e9;
    });
    await page.waitForTimeout(3000); // the reaction, then the hint
    const hint = await page.evaluate(() => __lines.map((l) => l.id));
    await page.evaluate(() => {
      const card = cardsEl.children[1];
      const b = card.getBoundingClientRect();
      const at = { pointerType: "touch", bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
      card.dispatchEvent(new PointerEvent("pointerdown", at));
      setTimeout(() => {
        card.dispatchEvent(new PointerEvent("pointerup", at));
        card.click(); // the click that ends a long press
      }, 500);
    });
    await page.waitForTimeout(800);
    const held = await page.evaluate(() => ({ state: game.state, focus: __lines.filter((l) => l.context.event === "focus"), card: currentChoices[1].id }));
    const box = await page.locator("#cards .card").nth(0).boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(800);
    const tapped = await page.evaluate(() => ({ state: game.state, pick: __lines.some((l) => l.context.event === "pick") }));
    // a second level-up: no second hint
    await page.evaluate(() => {
      progress.pending = 1;
      openLevelUp();
    });
    await page.waitForTimeout(3500);
    const hints = await page.evaluate(() => __lines.filter((l) => l.id.startsWith("legend.hint")).length);
    assert(hint.length === 2 && /^legend\.open/.test(hint[0]) && hint[1] === "legend.hint.hold.1", "the reaction, then the touch hint: " + JSON.stringify(hint));
    assert(held.state === "levelup" && held.focus.length === 1 && held.focus[0].context.card === held.card && held.focus[0].context.how === "hold", "long press: " + JSON.stringify(held));
    assert(tapped.state === "playing" && tapped.pick, "a tap should still install: " + JSON.stringify(tapped));
    assert(hints === 1, "the touch hint should show once: " + hints);
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("THE LEGEND's bubble: every line fits at desktop and phone sizes, and the bubble keeps one size (the cards never shift)", async () => {
    const views = [
      ["desktop", { viewport: { width: 1280, height: 720 } }],
      ["phone landscape", { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }],
      ["phone portrait", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ];
    for (const [name, opts] of views) {
      const { context, page, problems } = await open(browser, url, opts);
      await startRun(page);
      const fit = (screen) =>
        page.evaluate((screen) => {
          const el = { levelup: levelUpLegend, loadout: loadoutLegend, respec: respecLegend }[screen];
          const family = { levelup: /^legend\.(open|reroll|pick|hint|skill)\./, loadout: /^legend\.(loadout\.|skill\.[a-z_.]+\.1$)/, respec: /^legend\.respec\./ }[screen];
          const panel = el.closest(".levelup-panel");
          const sizes = new Set();
          const over = [];
          Object.keys(LEGEND_LINES)
            .filter((id) => family.test(id))
            .forEach((id) => {
              narrator.type(el, narrator.text(id), "smirk", true);
              const bubble = el.querySelector(".legend-bubble");
              const r = el.getBoundingClientRect();
              sizes.add(Math.round(r.height));
              if (bubble.scrollWidth > bubble.clientWidth + 1 || bubble.scrollHeight > bubble.clientHeight + 1 || panel.scrollHeight > panel.clientHeight + 1 || r.right > innerWidth + 1) over.push(id);
            });
          return { sizes: [...sizes], over };
        }, screen);
      await page.evaluate(() => {
        progress.pending = 1;
        openLevelUp();
      });
      const levelup = await fit("levelup");
      await page.evaluate(() => {
        levelUpEl.hidden = true;
        setState("menu");
        openLoadout();
      });
      const loadout = await fit("loadout");
      await page.evaluate(() => {
        loadoutEl.hidden = true;
        startGame();
        skipIntro();
        pauseGame();
        openRespec();
      });
      const respec = await fit("respec");
      const all = { levelup, loadout, respec };
      Object.entries(all).forEach(([screen, f]) => assert(!f.over.length && f.sizes.length === 1, `${name} ${screen}: lines overflow or resize the bubble: ` + JSON.stringify(f)));
      assert(!problems.length, problems.join("; "));
      await context.close();
    }
  });

  await test("THE LEGEND sets the scene: the v3.2 backstory on the menu, a line when the hero lands, the loadout and respec talk; lose lines fit what ended the run", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    const menu = await page.evaluate(() => {
      window.__lines = [];
      document.addEventListener("narrator:line", (e) => __lines.push(e.detail));
      const before = document.getElementById("overlay-text").textContent;
      setState("menu");
      return { before, text: document.getElementById("overlay-text").textContent, line: __lines[0], intro: narrator.text("legend.intro.menu.1") };
    });
    // the loadout: an opening line, then reactions to picks
    const loadout = await page.evaluate(() => {
      openLoadout();
      const opened = __lines[__lines.length - 1].id;
      const card = [...loadoutGrid.children].find((c) => c.getAttribute("aria-pressed") === "false");
      card.click();
      const toggled = __lines[__lines.length - 1].id;
      const zap = [...loadoutGrid.children].find((c) => c.dataset.id === "zap");
      return { opened, toggled, zapDesc: zap.querySelector(".card-desc").textContent, zapFull: descAt(UPGRADES[0], 1) };
    });
    // the drop: his line lands as a neon note with the hero
    await page.click("#drop-btn");
    await page.evaluate(() => {
      director.firstSpawn = 1e9;
      for (let i = 0; i < 60 * 5 && intro.active; i++) update(1 / 60);
    });
    const drop = await page.evaluate(() => ({ intro: intro.active, note: neonNotes.some((n) => n.legend && n.text.startsWith("THE LEGEND: ")), line: __lines.filter((l) => /^legend\.run\./.test(l.id)).length }));
    // respec: he talks on the panel; the apply line lands in the pause menu
    const respec = await page.evaluate(() => {
      upg.orbit = 2;
      pauseGame();
      openRespec();
      const opened = __lines[__lines.length - 1].id;
      document.getElementById("respec-apply").click();
      const applied = __lines[__lines.length - 1].id;
      return { opened, applied, shown: document.getElementById("overlay-text").textContent === narrator.text(applied) };
    });
    // the end: no goat jokes unless the goat did it (C9)
    const lose = await page.evaluate(() => {
      const out = {};
      const run = (boss) => {
        game.boss = boss ? { type: boss, dead: false, hp: 1, maxHp: 2 } : null;
        director.stage = boss === "goat" ? STAGE.goat : boss === "nullptr" ? STAGE.nullptr : STAGE.overseer;
        weather.amount = 0;
        showGameOver();
        return document.getElementById("overlay-text").textContent;
      };
      out.overseer = run("overseer");
      out.none = run(null);
      out.goat = run("goat");
      return out;
    });
    assert(menu.before === menu.intro && menu.text === menu.intro && /corps own the city/.test(menu.text) && /Demon Goat/.test(menu.text) && menu.line.id === "legend.intro.menu.1", "menu backstory: " + JSON.stringify(menu));
    assert(/^legend\.loadout\.open\.\d$/.test(loadout.opened) && /^legend\.loadout\.(add|ready|swap)\.\d$/.test(loadout.toggled), "loadout lines: " + JSON.stringify(loadout));
    assert(loadout.zapDesc === loadout.zapFull, "the primary's loadout card should say what it does: " + JSON.stringify(loadout));
    assert(!drop.intro && drop.note && drop.line === 1, "run start line: " + JSON.stringify(drop));
    assert(/^legend\.respec\.open\.\d$/.test(respec.opened) && /^legend\.respec\.apply\.\d$/.test(respec.applied) && respec.shown, "respec lines: " + JSON.stringify(respec));
    assert(!/goat/i.test(lose.overseer) && !/goat/i.test(lose.none) && /goat/i.test(lose.goat), "lose lines: " + JSON.stringify(lose));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("level-up text: rare one-line passives add up both levels; co-op's primary card describes both ICs", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(() => {
      const u = (id) => UPGRADES.find((x) => x.id === id);
      const out = { armor: describe(u("armor"), 2), heart: describe(u("heart"), 2), sink: describe(u("sink"), 2), orbit: describe(u("orbit"), 2) };
      coop.seat = { char: "tetsu" };
      coopAddPlayer(false);
      currentChoices = [{ id: "zap", u: u("zap"), rare: false }];
      renderCards();
      out.name = cardsEl.children[0].querySelector(".card-name").textContent;
      out.desc = cardsEl.children[0].querySelector(".card-desc").textContent;
      return out;
    });
    assert(r.armor === "Take 16% less damage." && r.heart === "Max HP +40 and heal 40." && r.sink === "Earn 50% more heat; your special costs less.", "rare passives: " + JSON.stringify(r));
    assert(r.orbit === "A neon shard circles you, slicing enemies. + +1 shard.", "multi-line skills keep both lines: " + JSON.stringify(r));
    assert(r.name === "Cyber Bow + Monoblade" && /^PAINE: \+5 arrow damage\. TETSU: \+3 slash damage\.$/.test(r.desc), "co-op primary card: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
    // the loadout wall: every IC's guide lines fit on one line, on a laptop and a 1080p screen
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      const v = await open(browser, url, { viewport });
      const cut = await v.page.evaluate(() => {
        const out = [];
        CHARACTER_ORDER.forEach((ch) => {
          player.char = ch;
          openLoadout();
          loadoutGrid.querySelectorAll(".guide-row span").forEach((s) => {
            if (s.scrollHeight > s.clientHeight + 1 || s.scrollWidth > s.clientWidth + 1) out.push(`${ch} ${s.closest(".card").dataset.id}: ${s.textContent}`);
          });
          closeLoadout();
        });
        player.char = "paine";
        return out;
      });
      assert(!cut.length, `guide lines cut off at ${viewport.width}px: ` + JSON.stringify(cut));
      await v.context.close();
    }
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

  // ------------------------------------------------------ Performance mode ----
  // A heavy scene for the Performance mode tests: Hackerman's Time Dilation
  // with code rain and glitch fields, a glitched crowd, rain, the
  // billboard in view, a hurt flash and plenty of particles
  function setupHeavyScene() {
    window.gainXp = () => {};
    player.x = holo.x - 300;
    camera.x = clamp(player.x - W / 2, 0, WORLD_W - W);
    upg.zap = 7;
    upg.flame = 6;
    computeStats();
    weather.raining = true;
    weather.timer = 1e9;
    for (let i = 0; i < 24; i++) {
      const type = ["crawler", "drone", "reaper", "enforcer"][i % 4];
      const def = ENEMY_TYPES[type];
      const e = spawnEnemy(type, player.x + (i % 2 ? 1 : -1) * (200 + i * 30), def.walker ? GROUND_Y - def.h : camera.y + 200 + (i % 5) * 80);
      e.hp = e.maxHp = 1e6;
    }
    window.__heavyTick = (i) => {
      weather.amount = 1;
      player.hp = stats.maxHp;
      player.heat = 100;
      if (!(player.dilation > 0)) {
        player.specialCd = 0;
        input.specialQueued = true;
      }
      game.hurtFlash = 0.4;
      enemies.forEach((e) => (e.glitchT = 0.5));
      if (i % 3 === 0) burst(player.x, player.y, 40, "#19f5ff", 400);
      if (i % 10 === 0) {
        player.glitchCd = 0;
        systemGlitch(player.x + 300, player.y);
      }
    };
  }

  await test("Performance mode: the setting persists, applies live (render size, effects) and leaves a picked resolution alone", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    const read = () =>
      page.evaluate(() => ({
        on: perfMode(),
        canvas: canvas.width,
        body: document.body.classList.contains("perf-mode"),
        pressed: document.querySelector('[data-setting="perfMode"][aria-pressed="true"]').dataset.value,
        saved: JSON.parse(localStorage.getItem("cp2d77-settings") || "{}").perfMode,
        hint: document.getElementById("display-hint").textContent,
        particles: particles.length,
      }));
    let r = await read();
    assert(!r.on && r.canvas === 1280 && !r.body && r.pressed === "false", "off by default: " + JSON.stringify(r));
    // Mid-run, from the pause menu
    await startRun(page, { settings: { character: "sudo" } });
    await page.evaluate(() => {
      for (let i = 0; i < 12; i++) burst(player.x, player.y, 30, "#19f5ff", 400);
      pauseGame();
    });
    const before = (await read()).particles;
    await page.click('[data-setting="perfMode"][data-value="true"]');
    r = await read();
    assert(r.on && r.body && r.pressed === "true" && r.saved === true, "did not switch on: " + JSON.stringify(r));
    assert(r.canvas === 858, "Auto in Performance mode should render at 2/3 (858 px wide): " + r.canvas);
    assert(/Performance mode/.test(r.hint) && /720p/.test(r.hint), "the display hint does not explain it: " + r.hint);
    assert(before > 200 && r.particles <= 90, `particles not trimmed: ${before} -> ${r.particles}`);
    // fewer particles per burst from now on, under a lower cap
    const caps = await page.evaluate(() => {
      particles.length = 0;
      burst(0, 0, 20, "#fff", 100);
      const one = particles.length;
      for (let i = 0; i < 20; i++) burst(0, 0, 30, "#fff", 100);
      return { one, max: particles.length };
    });
    assert(caps.one === 10 && caps.max === 90, "Performance mode particle budget: " + JSON.stringify(caps));
    // It survives a reload
    await page.reload();
    await page.waitForTimeout(300);
    r = await read();
    assert(r.on && r.canvas === 858 && r.body && r.pressed === "true", "not restored after a reload: " + JSON.stringify(r));
    // A resolution you pick wins (Performance mode only lowers Auto)
    await page.selectOption("#resolution", "1600x900");
    r = await read();
    assert(r.on && r.canvas === 1600, "Performance mode fought the picked resolution: " + JSON.stringify(r));
    await page.selectOption("#resolution", "auto");
    await page.click('[data-setting="perfMode"][data-value="false"]');
    r = await read();
    assert(!r.on && r.canvas === 1280 && !r.body && r.saved === false && /1080p/.test(r.hint), "did not switch off: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("Performance mode: slow frames suggest it once; fast frames never do", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(() => {
      // feed the monitor synthetic frame times (as its rAF loop does); each
      // feed starts after a pause, which starts the 5 s window over
      let clock = performance.now() + 1e6;
      const feed = (ms, seconds) => {
        let shown = perfHintSample((clock += 1000));
        for (let i = 0; i < (seconds * 1000) / ms; i++) shown = perfHintSample((clock += ms)) || shown;
        return shown;
      };
      settings.perfHintShown = false;
      game.toast = null;
      const fast = feed(16.7, 8);
      const slowFor3s = feed(30, 3);
      const slow = feed(30, 5.5);
      const toast = game.toast && game.toast.text;
      const saved = JSON.parse(localStorage.getItem("cp2d77-settings")).perfHintShown;
      game.toast = null;
      const again = feed(40, 12);
      settings.perfHintShown = false;
      settings.perfMode = true; // already on: no tip
      const whenOn = feed(40, 12);
      settings.perfMode = false;
      return { fast, slowFor3s, slow, toast, saved, again, whenOn };
    });
    assert(!r.fast && !r.slowFor3s, "tip shown too early: " + JSON.stringify(r));
    assert(r.slow && /PERFORMANCE MODE/.test(r.toast) && r.saved === true, "no tip after 5 s of slow frames: " + JSON.stringify(r));
    assert(!r.again && !r.whenOn, "the tip should show once, and never with Performance mode on: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("Performance mode: a heavy scene makes far fewer expensive canvas calls (no radial gradients, fewer particles)", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "sudo", autoFire: true } });
    await page.evaluate(`(${setupHeavyScene})()`);
    const run = (perf) =>
      page.evaluate((perf) => {
        setPerfMode(perf);
        const frame = (i) => {
          __heavyTick(i);
          update(1 / 60);
          render(game.time);
        };
        for (let i = 0; i < 40; i++) frame(i); // warm the sprite caches
        const counts = { radial: 0, linear: 0, drawImage: 0, fillText: 0, canvases: 0, particles: 0 };
        const P = CanvasRenderingContext2D.prototype;
        const wrap = (name, key) => {
          const orig = P[name];
          P[name] = function () {
            counts[key]++;
            return orig.apply(this, arguments);
          };
          return () => (P[name] = orig);
        };
        const undo = [wrap("createRadialGradient", "radial"), wrap("createLinearGradient", "linear"), wrap("drawImage", "drawImage"), wrap("fillText", "fillText")];
        const createEl = document.createElement;
        document.createElement = function (tag) {
          if (String(tag).toLowerCase() === "canvas") counts.canvases++;
          return createEl.apply(this, arguments);
        };
        const frames = 30;
        for (let i = 40; i < 40 + frames; i++) {
          frame(i);
          counts.particles = Math.max(counts.particles, particles.length);
        }
        undo.forEach((u) => u());
        document.createElement = createEl;
        ["linear", "drawImage", "fillText"].forEach((k) => (counts[k] = Math.round((counts[k] / frames) * 10) / 10)); // per frame (radial, canvases: totals)
        counts.dilation = player.dilation > 0;
        counts.glitched = enemies.filter((e) => e.glitchT > 0).length;
        return counts;
      }, perf);
    const normal = await run(false);
    const perf = await run(true);
    console.log(`       30 frames, normal: ${JSON.stringify(normal)}\n       30 frames, Performance mode: ${JSON.stringify(perf)}`);
    assert(normal.dilation && perf.dilation && normal.glitched > 10, "the scene is not heavy: " + JSON.stringify({ normal, perf }));
    assert(normal.radial >= 30, "the normal scene should draw its gradient overlays every frame: " + JSON.stringify(normal));
    // (a cache fill for a glow colour or a tinted frame seen for the first time is fine)
    assert(perf.radial <= 1 && perf.linear === 0 && perf.canvases <= 6, "Performance mode still makes gradients or canvases every frame: " + JSON.stringify(perf));
    assert(perf.particles <= 90 && normal.particles > 150, "particle caps: " + JSON.stringify({ normal: normal.particles, perf: perf.particles }));
    assert(perf.drawImage < normal.drawImage * 0.75, "Performance mode should draw far fewer images: " + JSON.stringify({ normal: normal.drawImage, perf: perf.drawImage }));
    assert(perf.fillText < normal.fillText, "Performance mode should draw less text (shorter code rain): " + JSON.stringify({ normal: normal.fillText, perf: perf.fillText }));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("Performance mode: frame-time sanity for the heavy scene in both modes", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "sudo", autoFire: true } });
    await page.evaluate(`(${setupHeavyScene})()`);
    const run = (perf) =>
      page.evaluate(async (perf) => {
        window.frame = () => {}; // the test drives every frame itself
        setPerfMode(perf);
        const times = [];
        for (let i = 0; i < 70; i++) {
          await new Promise((done) => requestAnimationFrame(done));
          __heavyTick(i);
          const t0 = performance.now();
          update(1 / 60);
          render(t0 / 1000);
          ctx.getImageData(0, 0, 1, 1); // make it rasterize now, so the pixels count too
          if (i >= 10) times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        return { avg: times.reduce((a, b) => a + b, 0) / times.length, median: times[30], p90: times[54], canvas: canvas.width };
      }, perf);
    const normal = await run(false);
    const perf = await run(true);
    const f = (r) => `avg ${r.avg.toFixed(1)} ms, median ${r.median.toFixed(1)} ms, p90 ${r.p90.toFixed(1)} ms at ${r.canvas}px`;
    console.log(`       heavy scene, update + render + raster: normal ${f(normal)}; Performance mode ${f(perf)}`);
    assert(normal.avg < 150 && normal.median < 120, "the heavy scene is far too slow: " + JSON.stringify(normal));
    assert(perf.avg < 100 && perf.median < 80, "the heavy scene is far too slow in Performance mode: " + JSON.stringify(perf));
    assert(perf.median < normal.median * 1.25 + 5, "Performance mode should not be slower: " + JSON.stringify({ normal, perf }));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  // ------------------------------------------- Font and display settings ----
  await test("the bundled font: no internet request, and canvas text waits for it (document.fonts)", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const remote = [];
    page.on("request", (r) => r.url().startsWith(url) || remote.push(r.url()));
    // Note what every document.fonts.ready (the neon sign caches wait on it) saw
    await page.addInitScript(() => {
      const ready = Object.getOwnPropertyDescriptor(FontFaceSet.prototype, "ready");
      Object.defineProperty(FontFaceSet.prototype, "ready", {
        get() {
          return ready.get.call(this).then((v) => ((window.__fontsAtReady = window.__fontsAtReady || []).push([...this].map((f) => f.status).join()), v));
        },
      });
    });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const g = document.createElement("canvas").getContext("2d");
      g.font = '16px "Press Start 2P"';
      const cached = signSprite("RAMEN", "#19f5ff").width;
      signCache.clear();
      return { atReady: window.__fontsAtReady, faces: [...document.fonts].map((f) => f.status), glyphs: g.measureText("CYBER").width, cached, fresh: signSprite("RAMEN", "#19f5ff").width };
    });
    assert(!remote.length, "requests left the site: " + remote.join(", "));
    assert(r.faces.join() === "loaded" && Math.round(r.glyphs) === 80, "Press Start 2P did not load: " + JSON.stringify(r));
    assert(r.atReady && r.atReady.length && r.atReady.every((s) => s === "loaded"), "document.fonts.ready resolved before the font loaded: " + JSON.stringify(r.atReady));
    assert(r.cached === r.fresh, "a neon sign was drawn with the fallback font: " + JSON.stringify(r));
    await context.close();
  });

  await test("display settings: Fullscreen uses the Fullscreen API and stays in sync with the HUD button; no desktop-only options", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    const read = () =>
      page.evaluate(() => ({
        fs: !!document.fullscreenElement,
        mode: settings.displayMode,
        seg: document.querySelector('[data-display][aria-pressed="true"]').dataset.display,
        hud: document.getElementById("btn-fullscreen").getAttribute("aria-pressed"),
        saved: JSON.parse(localStorage.getItem("cp2d77-settings") || "{}").displayMode,
        state: game.state,
      }));
    const ui = await page.evaluate(() => ({
      quit: document.getElementById("quit-btn").hidden,
      api: typeof window.desktop,
      display: !document.querySelector(".display-mode").hidden,
      hint: document.getElementById("display-hint").textContent,
    }));
    assert(ui.quit && ui.api === "undefined", "desktop-only controls in the browser: " + JSON.stringify(ui));
    assert(ui.display && !/window/i.test(ui.hint), "display settings: " + JSON.stringify(ui));
    // Enter on these controls is theirs, not "Start Game"
    await page.focus('[data-display="windowed"]');
    await page.keyboard.press("Enter");
    await page.focus("#resolution");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape"); // close the drop-down if it opened
    assert((await read()).state === "menu", "Enter on a display control started the game");

    await page.click('[data-display="fullscreen"]');
    await page.waitForFunction(() => !!document.fullscreenElement && settings.displayMode === "fullscreen");
    let r = await read();
    assert(r.mode === "fullscreen" && r.seg === "fullscreen" && r.hud === "true" && r.saved === "fullscreen", "settings -> fullscreen: " + JSON.stringify(r));
    // The HUD button (mid-run) leaves and re-enters; the settings follow
    await startRun(page);
    await page.click("#btn-fullscreen");
    await page.waitForFunction(() => !document.fullscreenElement && settings.displayMode === "windowed");
    r = await read();
    assert(r.mode === "windowed" && r.seg === "windowed" && r.hud === "false" && r.saved === "windowed", "HUD -> windowed: " + JSON.stringify(r));
    await page.click("#btn-fullscreen");
    await page.waitForFunction(() => !!document.fullscreenElement && settings.displayMode === "fullscreen");
    await page.keyboard.press("KeyP");
    await page.waitForTimeout(450);
    r = await read();
    assert(r.state === "paused" && r.seg === "fullscreen" && r.hud === "true", "HUD -> fullscreen: " + JSON.stringify(r));
    await page.click('[data-display="windowed"]');
    await page.waitForFunction(() => !document.fullscreenElement && settings.displayMode === "windowed");
    assert((await read()).seg === "windowed", "settings -> windowed");

    // A browser that refuses fullscreen: nothing breaks, the setting stays honest
    await page.evaluate(() => (document.documentElement.requestFullscreen = () => Promise.reject(new TypeError("Permissions check failed"))));
    await page.click('[data-display="fullscreen"]');
    await page.waitForTimeout(200);
    r = await read();
    assert(!r.fs && r.mode === "windowed" && r.seg === "windowed" && r.hud === "false", "a refused request changed the setting: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("display settings: Resolution sets the render size live (the canvas still fills the screen) and persists", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    const read = () =>
      page.evaluate(() => {
        const box = canvas.getBoundingClientRect();
        const mid = clientToWorld(box.left + box.width / 2, box.top + box.height / 2);
        return {
          canvas: [canvas.width, canvas.height],
          box: [Math.round(box.width), Math.round(box.height)],
          scale: renderScale,
          smooth: canvas.style.imageRendering,
          select: document.getElementById("resolution").value,
          saved: JSON.parse(localStorage.getItem("cp2d77-settings") || "{}").resolution,
          hint: document.getElementById("display-hint").textContent,
          mid: [Math.round(mid.x - camera.x), Math.round(mid.y - camera.y)],
        };
      });
    const auto = await read();
    assert(auto.select === "auto" && auto.canvas.join() === "1280,720" && /Auto/.test(auto.hint), "Auto: " + JSON.stringify(auto));
    await page.selectOption("#resolution", "1600x900");
    let r = await read();
    assert(r.canvas.join() === "1600,900" && r.box.join() === "1280,720" && Math.abs(r.scale - 1600 / 1920) < 1e-9, "1600x900: " + JSON.stringify(r));
    assert(r.saved === "1600x900" && /Stretched/.test(r.hint) && /1600x900/.test(r.hint), "1600x900 not saved / explained: " + JSON.stringify(r));
    assert(r.mid.join() === "960,540", "aiming no longer maps to the world: " + JSON.stringify(r.mid));
    await page.selectOption("#resolution", "3840x2160");
    r = await read();
    assert(r.canvas.join() === "3840,2160" && r.box.join() === "1280,720" && r.smooth === "auto", "4K supersampling: " + JSON.stringify(r));
    await page.selectOption("#resolution", "1366x768");
    // It renders a run at that size, and survives a reload
    await startRun(page);
    await fastForward(page, 1);
    await page.reload();
    await page.waitForTimeout(300);
    r = await read();
    assert(r.select === "1366x768" && r.canvas.join() === "1366,768" && r.box.join() === "1280,720", "not restored after a reload: " + JSON.stringify(r));
    await page.selectOption("#resolution", "auto");
    r = await read();
    assert(r.canvas.join() === "1280,720" && r.saved === "auto" && r.smooth === "", "back to Auto: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("display settings on a phone: they fit the screen and the resolution picker works", async () => {
    const { context, page, problems } = await open(browser, url, devices["Pixel 7"]);
    const r = await page.evaluate(() => {
      const panel = document.querySelector("#overlay .panel");
      const rects = [...document.querySelectorAll(".display-mode, #resolution, #display-hint")].map((el) => el.getBoundingClientRect());
      const select = document.getElementById("resolution").getBoundingClientRect();
      return {
        fits: rects.every((b) => b.left >= 0 && b.right <= innerWidth + 0.5),
        sideScroll: panel.scrollWidth > panel.clientWidth + 1,
        selectH: select.height,
        quit: document.getElementById("quit-btn").hidden,
        touch: document.body.classList.contains("touch"),
      };
    });
    assert(r.touch && r.fits && !r.sideScroll && r.selectH >= 36 && r.quit, "phone layout: " + JSON.stringify(r));
    await page.selectOption("#resolution", "1280x720");
    const c = await page.evaluate(() => [canvas.width, canvas.height].join());
    assert(c === "1280,720", "the resolution did not apply on a phone: " + c);
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("a fast-forwarded run survives 3 minutes of simulation and the boss arrives", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { quiet: false, settings: { autoFire: true, autoFlame: true } });
    // keep the run alive, and walk over to XP chips like a player would
    const bot = "player.hp = Math.max(player.hp, 60); input.keys.clear(); const g = gems.reduce((a, b) => (!a || Math.abs(b.x - player.x) < Math.abs(a.x - player.x) ? b : a), null); if (g && Math.abs(g.x - player.x) > 40) input.keys.add(g.x > player.x ? 'KeyD' : 'KeyA');";
    await fastForward(page, 175, bot);
    const r = await page.evaluate(() => ({ state: game.state, kills: game.kills, level: progress.level, boss: director.stage >= 1, t: game.time }));
    // (an idle bot sometimes stops at level 4, so the bar is "clearly levelled up")
    assert(r.kills > 40, "too few kills: " + JSON.stringify(r));
    assert(r.level >= 4, "no level-ups: " + JSON.stringify(r));
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

  // Jack in: read the breach terminal the way a player reads the screen
  const breachView = (page) =>
    page.evaluate(() => {
      const p = breach.pick;
      const k = breach.crack;
      return {
        state: game.state,
        stage: breach.stage,
        mode: breach.mode,
        done: breach.done,
        // pick: past the anti-mash grace; crack: the char glows green for a while yet
        ready: p ? p.grace <= 0 : k ? k.grace <= 0 && k.lockout <= 0 && k.match && k.phaseT > 0.15 : true,
        cursor: p ? p.cursor : -1,
        flagged: p && breach.stage === "exploit" ? breach.services.findIndex((s) => s.ok) : -1,
      };
    });
  // Plays the whole hack; `act` performs one input for the current view
  async function playBreach(page, act) {
    const stages = new Set();
    for (let i = 0; i < 900; i++) {
      const v = await breachView(page);
      if (v.state !== "breach") return stages;
      stages.add(v.stage);
      if (v.done || (!v.ready && (v.mode === "pick" || v.mode === "crack"))) await page.waitForTimeout(v.mode === "crack" ? 20 : 60);
      else await act(v, i);
    }
    throw new Error("the hack never finished");
  }

  await test("jack in (keyboard only): nmap, exploit the CVE, crack, sudo, upload OVERCLOCK", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "paine" } });
    await page.evaluate(() => openBreach(terminals[0]));
    const started = Date.now();
    const stages = await playBreach(page, async (v, i) => {
      if (v.mode === "pick") {
        const want = v.stage === "payload" ? 2 : v.flagged; // OVERCLOCK, or the service with the CVE
        await page.keyboard.press(v.cursor < want ? "ArrowDown" : v.cursor > want ? "ArrowUp" : "Enter");
      } else if (v.mode === "crack") await page.keyboard.press("Space");
      else await page.keyboard.press(["KeyH", "KeyA", "KeyC", "KeyK"][i % 4]); // hacker typer: any key types
    });
    const r = await page.evaluate(() => ({
      state: game.state,
      jackin: runSecrets.has("jackin"),
      cooldown: terminals[0].cooldown,
      overdrive: player.overdrive,
      trace: breach.trace,
      log: document.getElementById("breach-term").textContent,
      pw: breach.pass.pw,
    }));
    for (const s of ["recon", "exploit", "crack", "root", "payload"]) assert(stages.has(s), `never reached ${s}: ` + [...stages].join(","));
    assert(r.state === "playing", "did not return to the game: " + r.state);
    assert(r.jackin, "the Jack In secret was not unlocked");
    assert(r.cooldown > 55, "no 60 s terminal cooldown: " + r.cooldown);
    assert(r.overdrive > 8, "OVERCLOCK daemon not granted: " + r.overdrive);
    assert(r.trace < 100, "trace maxed out: " + r.trace);
    assert(r.log.includes("nmap -sV") && r.log.includes(`${r.pw}`) && r.log.includes("rm -rf /ice --no-preserve-sanity"), "the terminal did not show the hack");
    assert(Date.now() - started < 60000, "took too long");
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("jack in (phone taps): fits the screen, taps type and lock, DATAMINE levels up", async () => {
    const { context, page, problems } = await open(browser, url, devices["Pixel 7 landscape"]);
    await startRun(page);
    await page.evaluate(() => openBreach(terminals[1]));
    await page.waitForTimeout(600); // the CRT power-on animation
    const fit = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const term = document.getElementById("breach-term");
      const vis = (b) => b.width > 0 && b.left >= 0 && b.top >= 0 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1;
      return { screen: r("breach-screen"), w: innerWidth, h: innerHeight, ice: vis(r("breach-ice")), exit: vis(r("breach-exit")), exitH: r("breach-exit").height, hint: vis(r("breach-hint")), overflow: term.scrollWidth > term.clientWidth + 1 };
    });
    assert(fit.screen.width >= fit.w - 1 && fit.screen.height >= fit.h - 1, "terminal is not full-screen: " + JSON.stringify(fit));
    assert(fit.ice && fit.exit && fit.hint && fit.exitH >= 30, "panels off screen or too small: " + JSON.stringify(fit));
    assert(!fit.overflow, "terminal scrolls sideways");
    const box = await page.locator("#breach-term").boundingBox();
    const rowHeights = [];
    const stages = await playBreach(page, async (v) => {
      if (v.mode === "pick") {
        const want = v.stage === "payload" ? 1 : v.flagged; // DATAMINE, or the service with the CVE
        rowHeights.push(...(await page.$$eval("#breach-term .choice:enabled", (els) => els.map((e) => e.getBoundingClientRect().height))));
        await page.tap(`#breach-term .choice:enabled[data-i="${want}"]`);
      } else await page.touchscreen.tap(box.x + box.width / 2, box.y + 16); // tap the terminal: types / locks
    });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => ({ state: game.state, pending: progress.pending, jackin: runSecrets.has("jackin"), cooldown: terminals[1].cooldown }));
    for (const s of ["recon", "exploit", "crack", "root", "payload"]) assert(stages.has(s), `never reached ${s}`);
    assert(rowHeights.length >= 6 && Math.min(...rowHeights) >= 30, "choices too small to tap: " + rowHeights.map(Math.round).join(","));
    assert(r.jackin && r.cooldown > 55, "hack did not complete: " + JSON.stringify(r));
    assert(r.state === "levelup" || r.pending > 0, "DATAMINE did not grant a level: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("jack in: idling lets the ICE trace hit 100%: trace damage, 30 s cooldown, no secret", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(() => {
      const t = terminals[2];
      openBreach(t);
      const hp0 = player.hp;
      let idle = 0;
      while (!breach.done && idle < 300) {
        updateBreach(0.05);
        idle += 0.05;
      }
      const flash = document.getElementById("breach-flash").textContent;
      const during = game.state;
      for (let i = 0; i < 200 && game.state === "breach"; i++) updateBreach(0.05);
      const out = { idle, flash, during, success: breach.success, state: game.state, hidden: breachEl.hidden, hp0, hp: player.hp, cooldown: t.cooldown, jackin: runSecrets.has("jackin") };
      // Forcing it works too, and mistakes that push it over the top fail the run
      player.invuln = 0;
      openBreach(terminals[0]);
      breach.trace = 99;
      breachMistake(5);
      updateBreach(1 / 60);
      out.forced = breach.done && !breach.success;
      closeBreach();
      return out;
    });
    assert(r.idle > 45, `the trace filled too fast (${r.idle.toFixed(1)} s), it should be generous`);
    assert(r.idle < 120, `the trace never filled (${r.idle.toFixed(1)} s)`);
    assert(r.during === "breach" && /TRACE COMPLETE/.test(r.flash) && !r.success, "no failure screen: " + JSON.stringify(r));
    assert(r.state === "playing" && r.hidden, "did not return to the game: " + r.state);
    assert(r.hp < r.hp0, `no trace damage (${r.hp0} -> ${r.hp})`);
    assert(r.cooldown === 30, "wrong failure cooldown: " + r.cooldown);
    assert(!r.jackin, "failing should not unlock the secret");
    assert(r.forced, "a forced 100% trace did not fail the breach");
    assert(!problems.length, problems.join("; "));
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
      if (how === "click") {
        await page.click("#overlay-btn");
        await page.waitForTimeout(450);
        await page.click("#drop-btn");
      } else {
        await page.keyboard.press("Enter"); // menu -> loadout
        await page.waitForTimeout(450);
        await page.keyboard.press("Enter"); // loadout -> drop in
      }
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
    await dropIn(page);
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
      await page.waitForTimeout(600); // draw + release
      await page.keyboard.up("KeyJ");
    });
    assert(quiet < 0.005, "still loud with the music off: " + quiet);
    assert(shot > 0.01, "the shot was silent: " + shot);
    await context.close();
  });

  await test("real audio keeps working through pause, a hidden tab, a boss, level-up and game over", async () => {
    const { context, page, log } = await openStrict();
    await page.click("#overlay-btn");
    await dropIn(page);
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
    await dropIn(page);
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
    await dropIn(page);
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

  // ------------------------------------------- Synth sound effects ----
  const SYNTH_SOUNDS = [
    ...["bowDraw", "bowRelease", "arrowHit", "arrowPierce", "enemyFall", "fallThud", "bleed", "flameOn", "heatWave"],
    ...["bladeSwing", "bladeHeavy", "dash", "reflect", "parry"],
    ...["emDischarge", "glitch", "laptop", "dilationIn", "dilationOut", "dilationLoop"],
    ...["pickupRam", "pickupSsd", "pickupCpu"],
    ...["nullBlink", "nullDecoy", "nullSlash", "nullShuriken", "nullCharge", "nullShot", "nullDeath"],
    ...["forkLeap", "forkSplit", "lobberFire", "packetLand", "monolithSlam", "plateBreak", "armorClang", "hotfixHeal", "hotfixShield", "bubblePop", "ratePulse", "throttled"],
    ...["bossIntro", "bossDefeated", "reroll", "install", "uiMove", "uiSelect", "uiBack", "padConnect", "lifeLost", "levelUp"],
  ];

  await test("synth: play/loop/stop never throw before audio unlocks or while the context is suspended", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    const locked = await page.evaluate((names) => {
      let played = 0;
      for (const name of names.concat(["noSuchSound", undefined, 42])) {
        for (const o of [undefined, null, {}, { volume: NaN, rate: 0, pan: 9 }, { rate: -2, volume: -1 }]) played += synth.play(name, o) ? 1 : 0;
        played += synth.loop(name) ? 1 : 0;
        synth.stop(name);
      }
      return { played, ctx: !!SoundSystem.ctx };
    }, SYNTH_SOUNDS);
    assert(!locked.ctx, "the synth made an AudioContext before any gesture");
    assert(locked.played === 0, "sounds claimed to play with no audio: " + locked.played);
    await page.click("#overlay-title"); // a real click unlocks audio
    const r = await page.evaluate(async (names) => {
      await SoundSystem.ctx.suspend(); // what a hidden tab does
      let played = 0;
      for (const name of names) {
        played += synth.play(name, { volume: 1, rate: 1.2, pan: -0.5 }) ? 1 : 0;
        played += synth.loop(name) ? 1 : 0;
      }
      const queued = names.reduce((n, name) => n + synth.voices(name), 0);
      names.forEach((name) => synth.stop(name));
      await SoundSystem.ctx.resume();
      return { played, queued, resumed: synth.play("uiMove"), voices: synth.voices("uiMove"), state: SoundSystem.ctx.state };
    }, SYNTH_SOUNDS);
    assert(r.played === 0 && r.queued === 0, "sounds were queued on a suspended context: " + JSON.stringify(r));
    assert(r.resumed && r.voices === 1 && r.state === "running", "no sound once the context resumed: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("synth: every listed sound exists, and ?sounds shows a hidden panel that plays each one", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    const r = await page.evaluate(
      (names) => ({ missing: names.filter((n) => !synth.has(n)), loops: synth.names.filter((n) => synth.isLoop(n)), panel: !!document.getElementById("sound-lab") }),
      SYNTH_SOUNDS
    );
    assert(!r.missing.length, "missing sounds: " + r.missing.join(", "));
    assert(r.loops.join() === "dilationLoop", "unexpected loops: " + r.loops.join());
    assert(!r.panel, "the sound panel shows without ?sounds");
    await page.goto(url + "?sounds", { waitUntil: "load" });
    const buttons = await page.$$eval("#sound-lab [data-sound]", (bs) => bs.map((b) => b.dataset.sound));
    assert(buttons.length === SYNTH_SOUNDS.length && SYNTH_SOUNDS.every((n) => buttons.includes(n)), "panel buttons: " + buttons.join());
    await page.click('#sound-lab [data-sound="uiMove"]'); // the first click unlocks audio
    await page.waitForFunction(() => SoundSystem.ctx && SoundSystem.ctx.state === "running", null, { timeout: 3000 });
    await page.waitForTimeout(100);
    await page.click('#sound-lab [data-sound="reflect"]');
    await page.click('#sound-lab [data-sound="dilationLoop"]');
    await page.waitForTimeout(100);
    const on = await page.evaluate(() => ({ reflect: synth.voices("reflect"), loop: synth.voices("dilationLoop"), state: game.state }));
    await page.click('#sound-lab [data-sound="dilationLoop"]');
    const off = await page.evaluate(() => synth.voices("dilationLoop"));
    assert(on.reflect === 1 && on.loop === 1 && off === 0, "panel buttons did not play/toggle: " + JSON.stringify({ on, off }));
    assert(on.state === "menu", "clicking the panel reached the game: " + on.state);
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("synth: every sound renders offline audible, without clipping, and ends in silence", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    const rows = await page.evaluate(async (names) => {
      const out = [];
      for (const name of names) {
        // pickups also at combo rates (the game raises `rate` with the combo)
        for (const rate of name.startsWith("pickup") ? [1, 1.6, 2.5] : [1]) {
          const buf = await synth.render(name, { rate, seconds: 4 });
          const win = Math.floor(buf.sampleRate * 0.05);
          const tailFrom = buf.length - Math.floor(buf.sampleRate * 0.1);
          let peak = 0;
          let loudest = 0; // RMS of the loudest 50 ms
          let tail = 0; // the last 100 ms
          for (let c = 0; c < buf.numberOfChannels; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < d.length; i++) {
              const a = Math.abs(d[i]);
              if (a > peak) peak = a;
              if (i >= tailFrom && a > tail) tail = a;
            }
            for (let i = 0; i + win <= d.length; i += win >> 1) {
              let sum = 0;
              for (let j = i; j < i + win; j++) sum += d[j] * d[j];
              loudest = Math.max(loudest, Math.sqrt(sum / win));
            }
          }
          out.push({ name, rate, peak: +peak.toFixed(3), loudest: +loudest.toFixed(3), tail: +tail.toFixed(4) });
        }
      }
      return out;
    }, SYNTH_SOUNDS);
    const bad = rows.filter((r) => !(r.peak > 0.05 && r.loudest > 0.01 && r.peak < 0.98 && r.tail < 0.002));
    assert(rows.length === SYNTH_SOUNDS.length + 6, "not every sound rendered: " + rows.length);
    assert(!bad.length, "silent, clipping or never-ending: " + JSON.stringify(bad));
    await context.close();
  });

  await test("synth: throttling: a minimum gap per sound, a cap on simultaneous voices, loops never stack", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await page.click("#overlay-title"); // a real click unlocks audio
    const r = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      if (SoundSystem.ctx.state !== "running") await SoundSystem.ctx.resume();
      const name = "bladeHeavy"; // rings for ~0.9 s
      const { gap, max } = synth.limits(name);
      const instant = [synth.play(name), synth.play(name)]; // the same instant: the gap drops the second
      let most = 0;
      for (let i = 0; i < max * 4; i++) {
        await sleep(gap * 1000 + 15);
        synth.play(name);
        most = Math.max(most, synth.voices(name));
      }
      // a big sting is never cut short or doubled
      const sting = [synth.play("bossIntro")];
      await sleep(synth.limits("bossIntro").gap * 1000 + 20);
      sting.push(synth.play("bossIntro"), synth.voices("bossIntro"));
      ["dilationLoop", "dilationLoop", "dilationLoop"].forEach((n) => synth.loop(n));
      const loops = synth.voices("dilationLoop");
      synth.stop("dilationLoop");
      return { gap, max, instant, most, sting, loops, stopped: synth.voices("dilationLoop") };
    });
    assert(r.instant[0] && !r.instant[1], "an instant repeat was not dropped: " + JSON.stringify(r));
    assert(r.max >= 2 && r.most === r.max, `expected at most ${r.max} voices (and to reach it), saw ${r.most}`);
    assert(r.sting[0] && !r.sting[1] && r.sting[2] === 1, "a ringing boss sting was cut or doubled: " + JSON.stringify(r));
    assert(r.loops === 1 && r.stopped === 0, "loops stacked or did not stop: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("synth: real audio: synth sounds reach the master bus, and mute and the SFX slider apply", async () => {
    const { context, page, log } = await openStrict();
    await page.click("#overlay-btn");
    await dropIn(page);
    assert(await waitForLog(log, "[audio] running"), "the AudioContext never ran");
    await page.evaluate(() => {
      director.firstSpawn = 1e9; // no enemies: they make sounds too
      music.pause();
    });
    await page.waitForTimeout(600); // let the music fade out
    const play = () => page.evaluate(() => synth.play("heatWave"));
    const rms = { quiet: await masterRms(page, 300) };
    rms.full = await masterRms(page, 900, play);
    // M mutes: one-shots and a running loop go silent...
    await page.keyboard.press("KeyM");
    rms.muted = await masterRms(page, 900, () => page.evaluate(() => (synth.play("heatWave"), synth.loop("dilationLoop"))));
    // ...unmuting brings the loop back, and stop() fades it out
    await page.keyboard.press("KeyM");
    rms.loop = await masterRms(page, 1300);
    await page.evaluate(() => synth.stop("dilationLoop"));
    await page.waitForTimeout(1000); // the fade and the reverb tail
    rms.stopped = await masterRms(page, 300);
    // The SFX slider (pause menu) at 40%: a gain of 0.16
    await page.keyboard.press("KeyP");
    await page.waitForTimeout(500);
    await page.focus("#vol-sfx");
    await page.keyboard.press("Home");
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(600); // the slider plays a sample of its own
    const sfxGain = await page.evaluate(() => SoundSystem.sfxBus.gain.value);
    rms.low = await masterRms(page, 900, play);
    const ratio = rms.low / rms.full;
    const info = JSON.stringify({ rms, sfxGain, ratio });
    assert(rms.quiet < 0.005, "not quiet before playing: " + info);
    assert(rms.full > 0.02, "the synth is silent on the master bus: " + info);
    assert(rms.muted < 0.001, "mute did not silence the synth: " + info);
    assert(rms.loop > 0.01 && rms.stopped < 0.003, "the loop did not come back after unmuting, or did not stop: " + info);
    assert(Math.abs(sfxGain - 0.16) < 0.01 && ratio > 0.08 && ratio < 0.3, "the SFX slider does not scale the synth: " + info);
    assert(!log.some((l) => l.startsWith("page error")), log.join(" | "));
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
      for (let i = 0; i < 40; i++) { // one full bow draw (0.5s at level 1)
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

  await test("Cyber Widow: drawn arrows knock back, pierce, shoot down flyers (fall damage), bosses bleed; Flame On shoves and burns bullets", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "paine", autoFire: false, autoFlame: false } });
    const r = await page.evaluate(() => {
      const out = {};
      // draw + release: a drawing pose first, then the arrow
      const e = spawnEnemy("crawler", player.x + 420, GROUND_Y - 48);
      e.hp = e.maxHp = 9999;
      input.keys.add("KeyJ");
      update(1 / 60);
      out.drawing = !!player.draw && heroFrame().fx <= 1;
      let t = 0;
      while (!playerShots.some((s) => s.kind === "arrow") && t < 2) {
        update(1 / 60);
        t += 1 / 60;
      }
      out.drawTime = Math.round(t * 100) / 100;
      input.keys.clear();
      let kb = 0;
      for (let i = 0; i < 40 && e.hp >= 9999; i++) {
        update(1 / 60);
        kb = e.kbX;
      }
      out.knockedBack = e.hp < 9999 && kb > 150;
      // pierce chance grows with level
      progress.level = 1;
      const p1 = pierceChance();
      progress.level = 11;
      out.pierce = [p1, pierceChance()];
      // a flyer hit by an arrow drops out of the sky and takes fall damage
      const d = spawnEnemy("drone", player.x + 300, GROUND_Y - 520);
      d.hp = d.maxHp = 500;
      arrowHit({ vx: 1, x: d.x, y: d.y, damage: 10, piercing: false }, d);
      out.downed = !!d.downed;
      const hp = d.hp;
      for (let i = 0; i < 120; i++) update(1 / 60);
      out.fell = { landed: !!(d.downed && d.downed.landed), fallDamage: Math.round(hp - d.hp) };
      // bosses don't budge but bleed
      spawnOverseer();
      game.cinematic = null;
      const o = game.boss;
      const ox = o.x;
      arrowHit({ vx: 1, x: o.x, y: o.y, damage: 10, piercing: false }, o);
      const bh = o.hp;
      for (let i = 0; i < 60; i++) update(1 / 60);
      out.boss = { bleeding: o.bleedT > 0, bled: bh - o.hp > 0, moved: Math.abs((o.kbX || 0)) };
      // Flame On: a heat wave that burns bullets out of the air
      enemyShots.length = 0;
      const pc = centerOf(player);
      enemyShots.push({ x: pc.x + 120, y: pc.y, vx: -50, vy: 0, r: 10, damage: 10, kind: "laser", angle: 0, life: 4 });
      player.heat = 100;
      input.specialQueued = true;
      for (let i = 0; i < 20; i++) update(1 / 60);
      out.wave = { fired: player.heat < 100, shotGone: !enemyShots.some((s) => s.kind === "laser" && s.damage === 10) };
      return out;
    });
    assert(r.drawing && r.drawTime > 0.3, "no bow draw before the shot: " + JSON.stringify(r));
    assert(r.knockedBack, "the arrow did not hit and knock back: " + JSON.stringify(r));
    assert(Math.abs(r.pierce[0] - 0.75) < 1e-9 && r.pierce[1] > r.pierce[0] && r.pierce[1] <= 0.9, "pierce chance does not grow (15% + 60% bow bonus at level 1, max 90%): " + r.pierce);
    assert(r.downed && r.fell.landed && r.fell.fallDamage > 20, "flyer was not shot down with fall damage: " + JSON.stringify(r));
    assert(r.boss.bleeding && r.boss.bled && r.boss.moved === 0, "boss bleed / knockback immunity: " + JSON.stringify(r.boss));
    assert(r.wave.fired && r.wave.shotGone, "Flame On did not fire or burn the bullet: " + JSON.stringify(r.wave));
    await context.close();
  });

  await test("parried enemy shots keep their look: shuriken, meteors and rings aren't drawn as the old energy ball", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "tetsu", autoFire: false, autoFlame: false } });
    const r = await page.evaluate(() => {
      const blue = smallOr("blueFlame");
      const out = {};
      const realShuriken = drawShuriken;
      let shurikenCalls = 0;
      drawShuriken = (s) => (shurikenCalls++, realShuriken(s));
      const draw = ctx.drawImage.bind(ctx);
      let blueDraws = 0;
      ctx.drawImage = function (img, ...rest) {
        if (blue && img === blue) blueDraws++;
        return draw(img, ...rest);
      };
      const pc = centerOf(player);
      ["shuriken", "meteor", "ring"].forEach((kind) => {
        playerShots.length = 0;
        playerShots.push({ x: pc.x + 200, y: pc.y, vx: 1100, vy: 0, r: 16, angle: 0, life: 1, damage: 5, pierce: 0, hit: new Set(), kind });
        blueDraws = 0;
        drawPlayerProjectiles();
        out[kind] = blueDraws;
      });
      out.shurikenCalls = shurikenCalls;
      // the player's own default shot still uses the energy ball
      playerShots.length = 0;
      playerShots.push({ x: pc.x + 200, y: pc.y, vx: 1100, vy: 0, r: 22, angle: 0, life: 1, damage: 5, pierce: 0, hit: new Set() });
      blueDraws = 0;
      drawPlayerProjectiles();
      out.ball = blueDraws;
      ctx.drawImage = draw;
      drawShuriken = realShuriken;
      playerShots.length = 0;
      return out;
    });
    assert(r.shuriken === 0 && r.meteor === 0 && r.ring === 0 && r.shurikenCalls === 1, "parried shots drawn as the energy ball: " + JSON.stringify(r));
    assert(r.ball === 1, "the default shot lost its look: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("Ronin: Mirror Steel reflects 15% of incoming damage, scaling with level, without loops", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "tetsu" } });
    const r = await page.evaluate(() => {
      const e = spawnEnemy("enforcer", player.x + 300, GROUND_Y - 116);
      e.hp = e.maxHp = 9999;
      const hit = () => {
        player.invuln = 0;
        const h = e.hp;
        hurtPlayer(40, e.x, e.y, e);
        return Math.round((h - e.hp) * 10) / 10;
      };
      progress.level = 1;
      const l1 = hit();
      progress.level = 11;
      const l11 = hit();
      progress.level = 30;
      const l30 = hit();
      // reflected damage never comes back: enemies don't reflect
      const hp = player.hp;
      player.invuln = 0;
      damageEnemy(e, 50, { source: "reflect" });
      return { l1, l11, l30, line: passiveLine(), playerUnhurt: player.hp === hp };
    });
    assert(r.l1 === 6 && r.l11 === 10 && r.l30 === 16, "reflection does not scale 15% -> 25% -> 40% cap: " + JSON.stringify(r));
    assert(/REFLECT 40%/.test(r.line) && r.playerUnhurt, "HUD line / loop: " + JSON.stringify(r));
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

  await test("kit states end cleanly: a hot-swap or a death ends Time Dilation, expired DoTs don't keep their strength, boss intros run on real time and hold auto-specials", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "sudo", autoFire: false, autoFlame: false } });
    const r = await page.evaluate(() => {
      const out = {};
      const dilate = () => {
        player.heat = 100;
        player.specialCd = 0;
        input.specialQueued = true;
        for (let i = 0; i < 3; i++) update(1 / 60);
      };
      // hot-swap mid-dilation
      dilate();
      out.on = { dilation: player.dilation > 0, scale: enemyTimeScale() };
      switchCharacter("tetsu");
      update(1 / 60);
      out.swapped = { char: player.char, dilation: player.dilation, scale: enemyTimeScale() };
      // dying mid-dilation (with a life to spare)
      switchCharacter("sudo");
      player.specialCd = 0;
      dilate();
      out.before = player.dilation > 0;
      player.invuln = 0;
      player.hp = 0;
      update(1 / 60);
      out.died = { intro: intro.active, dilation: player.dilation, scale: enemyTimeScale() };
      skipIntro();
      // DoTs: a strong bleed that has run out doesn't stick around
      const e = spawnEnemy("enforcer", player.x + 400, GROUND_Y - 116);
      e.hp = e.maxHp = 1e6;
      applyDot(e, "bleed", 10, 0.5);
      for (let i = 0; i < 60; i++) update(1 / 60);
      applyDot(e, "bleed", 4, 2);
      out.dot = { expiredThenWeak: e.bleedDps };
      applyDot(e, "bleed", 2, 2);
      out.dot.activeKeepsStrong = e.bleedDps;
      // a boss entrance lasts its real length under slow-mo, and auto-specials wait for it
      settings.autoFlame = true;
      player.hp = 10;
      player.heat = 100;
      player.specialCd = 0;
      game.slowmo = { time: 99, scale: 0.25 };
      spawnOverseer();
      const len = game.cinematic.max;
      let t = 0;
      let dilatedDuringIntro = false;
      while (game.cinematic && t < 20) {
        update(1 / 60);
        t += 1 / 60;
        if (game.cinematic && player.dilation > 0) dilatedDuringIntro = true;
      }
      out.intro = { len, took: Math.round(t * 10) / 10, dilatedDuringIntro };
      game.slowmo = null;
      for (let i = 0; i < 30; i++) update(1 / 60);
      out.intro.dilatedAfter = player.dilation > 0;
      return out;
    });
    assert(r.on.dilation && r.on.scale < 1, "Time Dilation did not start: " + JSON.stringify(r.on));
    assert(r.swapped.char === "tetsu" && r.swapped.dilation === 0 && r.swapped.scale === 1, "a hot-swap left the world in slow motion: " + JSON.stringify(r.swapped));
    assert(r.before && r.died.intro && r.died.dilation === 0 && r.died.scale === 1, "a death left the world in slow motion: " + JSON.stringify(r.died));
    assert(r.dot.expiredThenWeak === 4 && r.dot.activeKeepsStrong === 4, "bleed strength: " + JSON.stringify(r.dot));
    assert(Math.abs(r.intro.took - r.intro.len) < 0.3 && !r.intro.dilatedDuringIntro, "boss intro under slow-mo: " + JSON.stringify(r.intro));
    assert(r.intro.dilatedAfter, "auto Time Dilation never fired after the intro: " + JSON.stringify(r.intro));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("Hackerman: EM waves pierce and slow, System Glitch stutters an area, Time Dilation slows the world", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "sudo", autoFire: true, autoFlame: false } });
    const r = await page.evaluate(() => {
      const pack = [0, 1, 2].map((i) => {
        const e = spawnEnemy("enforcer", player.x + 300 + i * 90, GROUND_Y - 116);
        e.hp = e.maxHp = 9999;
        e.facing = 1;
        e.patchT = 1e9; // (no hijacks here: a hijacked enemy is friendly, so the damage probes would pass through it)
        return e;
      });
      const hold = () => pack.forEach((e, i) => ((e.x = player.x + 300 + i * 90), (e.vx = 0)));
      for (let i = 0; i < 40; i++) {
        hold();
        update(1 / 60);
      }
      const out = { hurt: pack.filter((e) => e.hp < 9999).length, slowed: pack.filter((e) => e.slowT > 0).length };
      // System Glitch: force a proc and check the area stutters (the cooldown is per Hackerman)
      player.glitchCd = 0;
      systemGlitch(centerOf(pack[1]).x, centerOf(pack[1]).y);
      out.glitched = pack.filter((e) => e.glitchT > 0).length;
      const steps = [];
      const probe = { glitchT: 1 };
      for (let i = 0; i < 6; i++) {
        game.time += 1 / 60;
        steps.push(enemyStatus(probe, 1 / 60) > 0);
      }
      out.stutters = steps.includes(true) && steps.includes(false);
      // Time Dilation
      settings.autoFire = false;
      player.heat = 100;
      input.specialQueued = true;
      update(1 / 60);
      out.dilation = { on: player.dilation > 0, scale: enemyTimeScale(), ram: player.heat };
      const before = player.x;
      input.keys.add("KeyD");
      for (let i = 0; i < 30; i++) update(1 / 60);
      input.keys.clear();
      out.dilation.playerMoved = player.x - before;
      const h = pack[0].hp;
      damageEnemy(pack[0], 10, { source: "em" });
      out.dilation.bonus = Math.round((h - pack[0].hp) * 10) / 10;
      for (let i = 0; i < 60 * 5; i++) update(1 / 60);
      out.ended = player.dilation <= 0 && enemyTimeScale() === 1;
      return out;
    });
    assert(r.hurt >= 2 && r.slowed >= 2, "EM waves did not pierce and slow: " + JSON.stringify(r));
    assert(r.glitched === 3 && r.stutters, "System Glitch: " + JSON.stringify(r));
    assert(r.dilation.on && r.dilation.scale <= 0.25 && r.dilation.ram < 100, "Time Dilation did not start: " + JSON.stringify(r.dilation));
    assert(r.dilation.playerMoved > 150, "Hackerman should keep full speed: " + JSON.stringify(r.dilation));
    assert(r.dilation.bonus >= 14, "no damage bonus during dilation: " + JSON.stringify(r.dilation));
    assert(r.ended, "Time Dilation never ended");
    await context.close();
  });

  // ------------------------------------------------------- Hijack ----
  // (js/hijack.js) Hackerman's System Glitch bursts can hijack enemies.
  // __rng(...values) makes the next Math.random() calls return those values.
  const HIJACK_HELPERS = `
    director.nextBossAt = 1e9;
    window.__rng = (...vals) => {
      const real = Math.random;
      Math.random = () => (vals.length ? vals.shift() : (Math.random = real)());
    };
    window.__burst = (x, y, r, ...vals) => {
      __rng(...vals);
      const n = tryHijack(x, y, r);
      return n;
    };
    window.__mob = (type, x, y) => Object.assign(spawnEnemy(type, x, y !== undefined ? y : GROUND_Y - ENEMY_TYPES[type].h, { elite: false }), { hp: 400, maxHp: 400 });
    window.__steps = (n) => {
      for (let i = 0; i < n; i++) {
        player.hp = stats.maxHp;
        update(1 / 60);
      }
    };
  `;

  await test("Hackerman hijack: a burst takes over the nearest enemies; the pawn fights for you (contact, shots, blasts) and draws fire; your attacks pass through it; no heat; it reboots patched", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "sudo", autoFire: false, autoFlame: false } });
    await page.evaluate(HIJACK_HELPERS);
    const r = await page.evaluate(() => {
      const out = {};
      progress.level = 12; // 2 per burst, 3 at once, 5.1s
      Object.assign(player, { x: 600, y: GROUND_Y - player.h, vx: 0, onGround: true, standingOn: GROUND });
      const [a, b, c] = [1400, 1450, 1700].map((x) => __mob("crawler", x));
      out.numbers = { chance: hijackChance(), per: hijackPerBurst(), cap: hijackCap(), time: hijackTime(), taunt: tauntRadius() };
      out.n = __burst(1380, 960, 300, 0); // (the roll hits)
      out.who = [a, b, c].map(isHijacked);
      out.time = Math.round(a.hijackT * 100) / 100;
      __steps(1);
      out.targets = { a: a.forcedTarget === c, b: b.forcedTarget === c, c: c.forcedTarget === a || c.forcedTarget === b };
      // friendly: your attacks pass through it
      const hp = a.hp;
      damageEnemy(a, 50, { source: "zap" });
      damageEnemy(a, 50, { source: "em" });
      out.friendly = a.hp === hp && !nearestEnemy(a.x, a.y, 50);
      // they fight: the pawns hurt c, c hurts a pawn; none of it earns heat
      const heat = player.heat;
      const c0 = c.hp;
      const p0 = a.hp + b.hp;
      __steps(150);
      out.fight = { cHurt: Math.round(c0 - c.hp), pawnsHurt: Math.round(p0 - a.hp - b.hp), heat: player.heat - heat };
      // a hijacked drone's shot flies through you and hits an enemy behind you
      enemies.length = 0;
      player.invuln = 0;
      const pc = centerOf(player);
      const d = __mob("drone", pc.x - 300, pc.y - 20);
      const foe = Object.assign(__mob("crawler", pc.x + 250), { stun: 99 }); // (stays put)
      hijack(d, 5);
      const hp0 = player.hp;
      const fh = foe.hp;
      fireEnemyShot(centerOf(d).x, centerOf(d).y, ENEMY_TYPES.drone.shot, Math.atan2(centerOf(foe).y - centerOf(d).y, centerOf(foe).x - centerOf(d).x), 1, d);
      const shot = enemyShots[enemyShots.length - 1];
      for (let i = 0; i < 90 && enemyShots.includes(shot); i++) update(1 / 60);
      out.shot = { pawn: shot.pawn, player: hp0 - player.hp, foe: Math.round(fh - foe.hp) };
      // ...a normal drone's shot hits the hijacked one
      Object.assign(d, { stun: 99, vx: 0, vy: 0 }); // (holds still to be shot at)
      const n = Object.assign(__mob("drone", centerOf(d).x - 400, centerOf(d).y), { shotCd: 99 });
      const dh = d.hp;
      fireEnemyShot(centerOf(n).x, centerOf(n).y, ENEMY_TYPES.drone.shot, Math.atan2(centerOf(d).y - centerOf(n).y, centerOf(d).x - centerOf(n).x), 1, n);
      for (let i = 0; i < 90 && d.hp === dh; i++) update(1 / 60);
      out.hitPawn = Math.round(dh - d.hp);
      // a hijacked bomber blows up next to you: only the enemy gets it
      enemies.length = 0;
      player.invuln = 0;
      const bm = __mob("bomber", pc.x - 20, pc.y - 20);
      const near = __mob("crawler", pc.x + 40);
      hijack(bm, 5);
      const h1 = player.hp;
      const nh = near.hp;
      explodeBomber(bm);
      out.blast = { player: h1 - player.hp, enemy: Math.round(nh - near.hp) };
      // it runs out: a reboot stun, patched (can't be taken again yet), back to its side
      enemies.length = 0;
      const p = __mob("crawler", 1500);
      const q = __mob("crawler", 1600);
      hijack(p, 1);
      __steps(2);
      out.taunted = q.forcedTarget === p;
      __steps(70);
      out.after = { hijacked: isHijacked(p), patched: p.patchT > 0, stunned: p.stun > 0, target: p.forcedTarget, qTarget: q.forcedTarget };
      out.again = __burst(1550, 960, 300, 0) && isHijacked(p);
      // a pawn killed by an enemy still drops XP
      enemies.length = 0;
      gems.length = 0;
      const xp = __mob("crawler", 1500);
      hijack(xp, 5);
      damageEnemy(xp, 9999, { source: "enemy" });
      out.xp = { dead: xp.dead, gems: gems.length };
      // the HUD: Hackerman's passive is two short lines that fit before the boss bar
      ctx.font = fontPx(15);
      out.hud = passiveLines().map((l) => [l, Math.round(ctx.measureText(l).width)]);
      return out;
    });
    const j = JSON.stringify;
    assert(r.numbers.per === 2 && r.numbers.cap === 3 && Math.abs(r.numbers.chance - 0.41) < 1e-9, "hijack numbers at level 12: " + j(r.numbers));
    assert(r.n === 2 && r.who[0] && r.who[1] && !r.who[2] && Math.abs(r.time - r.numbers.time) < 0.01, "the burst did not take the 2 nearest: " + j(r));
    assert(r.targets.a && r.targets.b && r.targets.c, "pawns and taunt targets: " + j(r.targets));
    assert(r.friendly, "player attacks hit a hijacked enemy (or auto-aim picks it)");
    assert(r.fight.cHurt > 0 && r.fight.pawnsHurt > 0 && r.fight.heat === 0, "pawns vs enemies: " + j(r.fight));
    assert(r.shot.pawn && r.shot.player === 0 && r.shot.foe > 0 && r.hitPawn > 0, "team-aware shots: " + j(r));
    assert(r.blast.player === 0 && r.blast.enemy > 0, "a hijacked bomber's blast: " + j(r.blast));
    assert(r.taunted && !r.after.hijacked && r.after.patched && r.after.stunned && r.after.target === null && r.after.qTarget === null && !r.again, "the hijack wearing off: " + j(r));
    assert(r.xp.dead && r.xp.gems > 0, "a hijacked enemy killed by enemies dropped no XP: " + j(r.xp));
    assert(r.hud.length === 2 && /^GLITCH \d+%$/.test(r.hud[0][0]) && /^HIJACK \d+%$/.test(r.hud[1][0]) && r.hud.every(([, w]) => w < 175), "HUD passive: " + j(r.hud));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("Hackerman hijack: bosses and NULL's copies are immune, resist halves it, the cap holds, a boss intro clears pawns, slow-mo doesn't slow pawns, bosses glitch less", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "sudo", autoFire: false, autoFlame: false } });
    await page.evaluate(HIJACK_HELPERS);
    const r = await page.evaluate(() => {
      const out = {};
      progress.level = 1; // 1 per burst, 2 at once, 4s
      // resist: the enforcer needs a second coin flip and gets half the time
      const f = __mob("enforcer", 1500);
      out.resistMiss = __burst(1550, 930, 300, 0, 0.7) === 0 && !isHijacked(f);
      out.resistHit = __burst(1550, 930, 300, 0, 0.2) === 1 && Math.abs(f.hijackT - hijackTime() * HIJACK.resist) < 0.01;
      const el = Object.assign(__mob("crawler", 1700), { elite: true });
      out.elite = __burst(1700, 960, 100, 0, 0.2) === 1 && Math.abs(el.hijackT - hijackTime() * HIJACK.resist) < 0.01;
      // the cap: never more than 2 at level 1, however many bursts
      enemies.length = 0;
      for (let i = 0; i < 8; i++) __mob("crawler", 1200 + i * 60);
      for (let i = 0; i < 6; i++) __burst(1400, 960, 600, 0, 0, 0, 0);
      out.capped = enemies.filter(isHijacked).length;
      // a boss intro derezzes the pawns too (their XP stays behind)
      gems.length = 0;
      spawnOverseer();
      out.derez = { pawns: enemies.filter((e) => !e.dead && isHijacked(e)).length, gems: gems.length };
      // bosses: ACCESS DENIED (once), never hijacked; System Glitch stutters them every 2.5s at most
      game.cinematic = null;
      const o = game.boss;
      const oc = centerOf(o);
      const denied = hijackStats.denied;
      out.boss = __burst(oc.x, oc.y, 400, 0, 0) === 0 && !isHijacked(o) && hijackStats.denied === denied + 1;
      player.glitchCd = 0;
      systemGlitch(oc.x, oc.y);
      const g1 = o.glitchT;
      o.glitchT = 0;
      player.glitchCd = 0;
      systemGlitch(oc.x, oc.y);
      out.bossGlitch = { first: g1 > 0, second: o.glitchT, lock: o.glitchLock > 0 };
      // NULL's copies are immune too
      out.decoy = hijackImmune({ boss: true, decoy: true }) && hijackImmune({ def: { compromise: "immune" } }) && !hijackImmune({ def: {} });
      // slow-mo (and Time Dilation) don't slow a pawn: its timer and its legs run on real time
      startGame();
      skipIntro();
      director.firstSpawn = director.nextBossAt = 1e9;
      Object.assign(player, { x: 300, y: GROUND_Y - player.h, vx: 0, onGround: true, standingOn: GROUND });
      const pawn = __mob("crawler", 1600);
      const foe = __mob("crawler", 2600);
      const slow = __mob("crawler", 3600);
      hijack(pawn, 6);
      game.slowmo = { time: 99, scale: 0.2 };
      const x0 = [pawn.x, slow.x];
      __steps(60);
      out.slowmo = { left: Math.round(pawn.hijackT * 10) / 10, pawn: Math.round(Math.abs(pawn.x - x0[0])), other: Math.round(Math.abs(slow.x - x0[1])) };
      game.slowmo = null;
      return out;
    });
    const j = JSON.stringify;
    assert(r.resistMiss && r.resistHit && r.elite, "resist / elite: " + j(r));
    assert(r.capped === 2, "the cap did not hold: " + j(r));
    assert(r.derez.pawns === 0 && r.derez.gems > 0, "a boss intro did not clear the pawns: " + j(r.derez));
    assert(r.boss && r.decoy, "bosses / copies were not immune: " + j(r));
    assert(r.bossGlitch.first && r.bossGlitch.second === 0 && r.bossGlitch.lock, "boss glitch cooldown: " + j(r.bossGlitch));
    assert(Math.abs(r.slowmo.left - 5) < 0.15 && r.slowmo.pawn > r.slowmo.other * 2.5, "slow-mo slowed the pawn: " + j(r.slowmo));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("Hackerman hijack soak: a long busy run at level 25 with auto-fire: hijacks happen, never over the cap, no errors", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { quiet: false, settings: { character: "sudo", autoFire: true, autoFlame: true } });
    await page.evaluate(HIJACK_HELPERS);
    const r = await page.evaluate(() => {
      progress.level = 25;
      computeStats();
      game.time = 90; // everything is in the mix
      director.firstSpawn = 0;
      const s0 = { ...hijackStats };
      let over = 0;
      let peak = 0;
      for (let t = 0; t < 110 && game.state !== "over"; t += 1 / 60) {
        player.hp = stats.maxHp;
        player.heat = Math.max(player.heat, 40);
        if (game.state === "levelup") chooseUpgrade(0, true);
        update(1 / 60);
        const n = enemies.filter((e) => !e.dead && isHijacked(e)).length;
        peak = Math.max(peak, n);
        if (n > hijackCap()) over++;
        if (Math.floor(t * 60) % 300 === 0) render(performance.now() / 1000);
      }
      return { hijacks: hijackStats.hijacks - s0.hijacks, ended: hijackStats.ended - s0.ended, peak, over, cap: hijackCap(), kills: game.kills, state: game.state };
    });
    console.log("       hijack soak: " + JSON.stringify(r));
    assert(r.state === "playing" && r.hijacks >= 5 && r.ended >= 3, "too few hijacks: " + JSON.stringify(r));
    assert(r.over === 0 && r.peak <= r.cap, "more pawns than the cap: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
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

  // ------------------------------------------------------ Navigation ----
  // (js/nav.js) Walkers and bosses route through a platform graph built from
  // their own jump physics; flyers spread out. Helpers run in the page.
  const NAV_HELPERS = `
    director.nextBossAt = 1e9; // (no boss walking in on a long test)
    window.__navPut = (i) => {
      const p = platforms[i];
      Object.assign(player, { x: p.x + p.w / 2 - player.w / 2, y: p.y - player.h, vx: 0, vy: 0, onGround: true, standingOn: p, invuln: 99 });
      return p;
    };
    // on the player's floor and close, or touching
    window.__navReached = (e) => overlaps(e, player) || (e.onGround && e.standingOn === player.standingOn && Math.abs(e.x + e.w / 2 - player.x - player.w / 2) < 120);
    // simulate until cond() (an invulnerable, still player); the seconds it took, or -1
    window.__navUntil = (cond, max) => {
      for (let t = 0; t < max; t += 1 / 60) {
        player.invuln = 99;
        player.hp = stats.maxHp;
        update(1 / 60);
        if (cond()) return t;
      }
      return -1;
    };
    window.__navWalker = (type, x) => Object.assign(spawnEnemy(type, x, GROUND_Y - ENEMY_TYPES[type].h, { elite: false }), { hp: 1e9, maxHp: 1e9 });
  `;

  await test("navigation: every floor can be reached from every other by each walker type and each boss (the platform graph)", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page);
    const r = await page.evaluate(() => {
      const movers = Object.keys(ENEMY_TYPES)
        .filter((k) => ENEMY_TYPES[k].walker)
        .map((type) => navMoverFor({ type, def: ENEMY_TYPES[type] }));
      [["overseer", OVERSEER.w], ["nullptr", NULLB.w], ["goat", GOAT.w]].forEach(([type, w]) => movers.push(navMoverFor({ type, boss: true, w })));
      const out = {};
      for (const m of movers) {
        const G = navGraph(m);
        const bad = [];
        for (let a = 0; a < G.N; a++) for (let b = 0; b < G.N; b++) if (!navReachable(m, a, b)) bad.push(a + ">" + b);
        out[m.key] = { edges: G.E, kinds: [0, 1, 2].map((k) => G.kind.filter((x) => x === k).length), unreachable: bad.length, some: bad.slice(0, 6) };
      }
      // walkers called in while you're on the highest rooftop come in up there, not on the street
      const top = platforms[30];
      Object.assign(player, { x: top.x + 140, y: top.y - player.h, vx: 0, vy: 0, onGround: true, standingOn: top });
      camera.x = clamp(player.x - W / 2, 0, WORLD_W - W);
      camera.y = WORLD_TOP;
      enemies.length = 0;
      for (let i = 0; i < 12; i++) spawnAtEdge(["crawler", "ninja", "enforcer"][i % 3]);
      out.spawnDrops = enemies.map((e) => Math.round(e.y + e.h - top.y));
      enemies.length = 0;
      return out;
    });
    assert(r.spawnDrops.length === 12 && r.spawnDrops.every((d) => d < 500), "walkers spawned far below a rooftop player: " + JSON.stringify(r.spawnDrops));
    delete r.spawnDrops;
    for (const [k, v] of Object.entries(r)) assert(v.edges > 50 && v.unreachable === 0, `${k} can't get everywhere: ${JSON.stringify(v)}`);
    assert(r.enforcer.kinds[2] > 0 && r.crawler.kinds[1] > 0, "no grapple (enforcer) or drop-through moves: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("navigation: crawler, ninja and enforcer each climb from the street to a still player on every platform (rooftops and moving ones too)", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { autoFire: false, autoFlame: false } });
    await page.evaluate(NAV_HELPERS);
    const r = await page.evaluate(() => {
      const fails = [];
      const times = {};
      const launches = navStats.launches;
      const misses = navStats.fails;
      for (const type of ["crawler", "ninja", "enforcer"]) {
        let worst = 0;
        let total = 0;
        platforms.forEach((_, i) => {
          enemies.length = 0;
          const p = __navPut(i);
          const sx = clamp(p.x + p.w / 2 + (i % 2 ? 900 : -900), 60, WORLD_W - 160); // from the street, off to one side
          const e = __navWalker(type, sx);
          const t = __navUntil(() => e.dead || __navReached(e), 45);
          if (t < 0 || e.dead) fails.push(`${type} > #${i}${e.dead ? " (gone)" : ""}`);
          else {
            worst = Math.max(worst, t);
            total += t;
          }
        });
        times[type] = { worst: Math.round(worst), mean: Math.round((total / platforms.length) * 10) / 10 };
      }
      return { fails, times, launches: navStats.launches - launches, misses: navStats.fails - misses };
    });
    assert(!r.fails.length, "walkers could not reach: " + r.fails.join(", "));
    assert(r.times.crawler.worst < 30 && r.times.ninja.worst < 30 && r.times.enforcer.worst < 40, "too slow: " + JSON.stringify(r.times));
    assert(r.misses < r.launches * 0.08, "too many jumps fell short: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("navigation: 15 walkers on one route take turns at the take-off points (no pile-up, no hopping in place)", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { autoFire: false, autoFlame: false } });
    await page.evaluate(NAV_HELPERS);
    const r = await page.evaluate(() => {
      const top = __navPut(30); // the highest rooftop (3850, -280)
      const types = ["crawler", "ninja", "enforcer"];
      const list = [];
      for (let i = 0; i < 15; i++) list.push(__navWalker(types[i % 3], 3300 + (i % 3) * 4));
      const reached = list.map(() => -1);
      const misses = navStats.fails;
      let t = 0;
      __navUntil(() => {
        t += 1 / 60;
        list.forEach((e, i) => reached[i] < 0 && e.onGround && e.standingOn === top && (reached[i] = Math.round(t * 10) / 10));
        return reached.every((x) => x >= 0);
      }, 45);
      const moves = list.map((e) => e.nav.jumps + e.nav.grapples);
      return { reached, moves, misses: navStats.fails - misses, gone: list.filter((e) => e.dead).length };
    });
    assert(r.reached.every((x) => x >= 0) && !r.gone, "not everyone made it to the top: " + JSON.stringify(r));
    // the route is 5-8 moves: a few spare, never dozens of hops on the spot
    assert(Math.max(...r.moves) <= 12 && r.misses <= 2, "hopping in place / missed jumps: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("navigation: flyers reach and attack a player on the highest rooftop, and spread out instead of stacking", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { autoFire: false, autoFlame: false } });
    await page.evaluate(NAV_HELPERS);
    const r = await page.evaluate(() => {
      const out = {};
      const top = __navPut(30);
      const px = top.x + top.w / 2;
      __navUntil(() => false, 2); // the camera climbs up with the player
      const flyer = (type, x, y) => Object.assign(spawnEnemy(type, x, y, { elite: false }), { hp: 1e9, maxHp: 1e9 });
      for (const [type, dx] of [["drone", 900], ["dragon", -900], ["sniper", 1000]]) {
        enemies.length = 0;
        enemyShots.length = 0;
        const e = flyer(type, px + dx, GROUND_Y - 300); // far below and off to the side
        const t = __navUntil(() => enemyShots.some((s) => s.owner === e), 20);
        out[type] = { t: Math.round(t * 10) / 10, gap: Math.round(Math.hypot(e.x - px, e.y - top.y)) };
      }
      enemies.length = 0;
      const reaper = flyer("reaper", px - 700, GROUND_Y - 200);
      out.reaper = Math.round(__navUntil(() => overlaps(reaper, player), 25) * 10) / 10;
      enemies.length = 0;
      const bomber = flyer("bomber", px + 800, 400);
      bomber.hp = 6;
      out.bomber = Math.round(__navUntil(() => bomber.fuse > 0 || bomber.exploded, 15) * 10) / 10;
      // four drones from one point: they spread out
      enemies.length = 0;
      const pack = [0, 1, 2, 3].map(() => Object.assign(flyer("drone", px + 500, top.y - 200), { shotCd: 99 }));
      __navUntil(() => false, 6);
      let closest = Infinity;
      pack.forEach((a, i) => pack.forEach((b, j) => j > i && (closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y)))));
      out.closest = Math.round(closest);
      return out;
    });
    for (const k of ["drone", "dragon", "sniper"]) assert(r[k].t >= 0 && r[k].gap < 1400, `${k} never attacked the rooftop player: ` + JSON.stringify(r));
    assert(r.reaper >= 0 && r.bomber >= 0, "the reaper / bomber never got to the rooftop player: " + JSON.stringify(r));
    assert(r.closest > 60, "drones stacked on top of each other: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("navigation: the Overseer, NULL and the GOAT chase a player up to the highest rooftop", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { autoFire: false, autoFlame: false } });
    await page.evaluate(NAV_HELPERS);
    const r = await page.evaluate(() => {
      const out = {};
      for (const [kind, spawn] of [["overseer", spawnOverseer], ["nullptr", spawnNull], ["goat", spawnGoat]]) {
        startGame();
        skipIntro();
        director.firstSpawn = 1e9;
        const top = __navPut(30);
        camera.x = clamp(top.x - W / 2, 0, WORLD_W - W);
        __navUntil(() => false, 1);
        // it arrives on the street below you
        game.time = 10;
        spawn();
        const b = game.boss;
        b.x = clamp(top.x + 700, 0, WORLD_W - b.w);
        const t = __navUntil(() => !b.parked && ((b.onGround && b.standingOn === top) || overlaps(b, player)), 40);
        // up there it still fights
        const states = new Set();
        __navUntil(() => states.add(b.state) && false, 8);
        out[kind] = { t: Math.round(t * 10) / 10, states: [...states] };
      }
      return out;
    });
    for (const k of ["overseer", "nullptr", "goat"]) assert(r[k].t >= 0, `${k} never got up to the rooftop: ` + JSON.stringify(r));
    assert(["burst", "dash", "slam", "laser"].some((s) => r.overseer.states.includes(s)), "the Overseer stopped attacking up there: " + JSON.stringify(r.overseer));
    assert(["charge", "leap", "breath"].some((s) => r.goat.states.includes(s)), "the GOAT stopped attacking up there: " + JSON.stringify(r.goat));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("navigation soak: a busy run with the player hopping between random platforms: no walker stuck, few missed jumps, cheap per frame", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { quiet: false, settings: { autoFire: false, autoFlame: false } });
    await page.evaluate(NAV_HELPERS);
    const r = await page.evaluate(() => {
      let ms = 0;
      let frames = 0;
      let peak = 0;
      const upd = updateEnemies;
      updateEnemies = (dt) => {
        const t0 = performance.now();
        upd(dt);
        ms += performance.now() - t0;
        frames++;
      };
      const s0 = { ...navStats };
      game.time = 60; // every enemy type is in the mix
      director.firstSpawn = 0;
      let worst = 0;
      let worstWho = "";
      let next = 0;
      for (let t = 0; t < 85; t += 1 / 60) {
        if (t >= next) {
          next = t + 12;
          __navPut(Math.floor(Math.random() * platforms.length));
        }
        player.invuln = 99;
        player.hp = stats.maxHp;
        if (game.state === "levelup") chooseUpgrade(0, true);
        update(1 / 60);
        peak = Math.max(peak, enemies.length);
        // stuck: no closer (by its own route estimate) while not on your floor
        enemies.forEach((e) => {
          const n = e.nav;
          if (e.dead || !n) return;
          if (n.goal !== e.__goal || n.node === n.goal || n.est < e.__best - 0.05 || n.phase !== NAV_RUN) {
            e.__goal = n.goal;
            e.__best = n.node === n.goal ? Infinity : n.est;
            e.__since = t;
          }
          if (t - e.__since > worst) {
            worst = t - e.__since;
            worstWho = `${e.type} on ${n.node} > ${n.goal}`;
          }
        });
      }
      updateEnemies = upd;
      const d = (k) => navStats[k] - s0[k];
      return { worst: Math.round(worst * 10) / 10, worstWho, peak, launches: d("launches"), misses: d("fails"), rescues: d("rescues"), ms: Math.round((ms / frames) * 1000) / 1000, state: game.state };
    });
    console.log("       soak: " + JSON.stringify(r));
    assert(r.state === "playing" && r.peak >= 20, "the soak did not get busy: " + JSON.stringify(r));
    // (waiting out one full swing of a moving platform counts as no progress: up to ~7.5 s)
    assert(r.worst < 12 && r.rescues === 0, "a walker got stuck: " + JSON.stringify(r));
    assert(r.launches > 100 && r.misses < r.launches * 0.1, "too many missed jumps: " + JSON.stringify(r));
    assert(r.ms < 4, "enemy updates are too slow: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("navigation: ?navdebug draws the graph and every route without errors", async () => {
    const { context, page, problems } = await open(browser, url + "?navdebug", { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { autoFire: false, autoFlame: false } });
    await page.evaluate(NAV_HELPERS);
    const r = await page.evaluate(() => {
      __navPut(26);
      ["crawler", "ninja", "enforcer"].forEach((t, i) => __navWalker(t, 3000 + i * 300));
      spawnEnemy("drone", 3600, 200);
      __navUntil(() => false, 3);
      render(performance.now() / 1000);
      return { on: navDebug.on, walkers: enemies.filter((e) => e.nav).length };
    });
    assert(r.on && r.walkers === 3, "navdebug: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  // ------------------------------------------------------ v3.2 enemies ----
  // fresh(x): an empty street with the player standing at x. steps(n, keep):
  // n frames (level-ups picked; keep: hold the player's HP up)
  const V2_HELPERS = () => {
    window.fresh = (x = 1500) => {
      enemies.length = 0;
      enemyShots.length = 0;
      shockwaves.length = 0;
      playerShots.length = 0;
      Object.assign(player, { x, y: GROUND_Y - player.h, vx: 0, vy: 0, invuln: 0, onGround: true, standingOn: GROUND });
      player.hp = stats.maxHp;
    };
    window.steps = (n, keep = true) => {
      for (let i = 0; i < n && game.state !== "over"; i++) {
        if (keep) player.hp = stats.maxHp;
        if (game.state === "levelup") chooseUpgrade(0, true);
        update(1 / 60);
      }
    };
  };
  const V2_VIEW = { viewport: { width: 1280, height: 720 } };
  const v2Run = async (character) => {
    const { context, page, problems } = await open(browser, url, V2_VIEW);
    await startRun(page, { settings: { character, autoFire: false, autoFlame: false } });
    await page.evaluate(V2_HELPERS);
    return { context, page, problems };
  };

  await test("v3.2 Fork Bomb: rolls in, unfurls (a flash) and leaps; forks into 2 children (3 from an elite) that don't fork again; climbs to a player on a platform", async () => {
    const { context, page, problems } = await v2Run("paine");
    const r = await page.evaluate(() => {
      const out = {};
      fresh(1500);
      const f = spawnEnemy("forkbomb", 2200, GROUND_Y - 50, { elite: false });
      const x0 = f.x;
      let unfurl = 0;
      let leap = null;
      for (let i = 0; i < 60 * 5 && !leap; i++) {
        steps(1);
        if (f.state === "unfurl") unfurl++;
        if (f.state === "leap") leap = { vx: Math.round(f.vx), vy: Math.round(f.vy), frame: frame2(f) };
      }
      out.roll = { closed: Math.round(x0 - f.x), unfurl, leap, rolled: f.spin > 4 };
      damageEnemy(f, 1e6, { source: "test" });
      const kids = enemies.filter((e) => !e.dead && e.type === "forkbomb");
      out.kids = { n: kids.length, small: kids.every((k) => k.child && k.w < f.w && k.maxHp < f.maxHp) };
      kids.forEach((k) => damageEnemy(k, 1e6, { source: "test" }));
      out.grandkids = enemies.filter((e) => !e.dead && e.type === "forkbomb").length;
      const el = spawnEnemy("forkbomb", 2200, GROUND_Y - 58, { elite: true });
      damageEnemy(el, 1e6, { source: "test" });
      out.eliteKids = enemies.filter((e) => !e.dead && e.type === "forkbomb").length;
      // the player up on a platform: it finds the way up (nav.js)
      fresh(1500);
      const plat = platforms[1];
      Object.assign(player, { x: plat.x + plat.w / 2 - player.w / 2, y: plat.y - player.h, standingOn: plat });
      const c = spawnEnemy("forkbomb", 250, GROUND_Y - 50, { elite: false });
      let up = false;
      for (let i = 0; i < 60 * 10 && !up; i++) {
        player.invuln = 1;
        steps(1);
        up = c.y + c.h < plat.y + 4 && Math.abs(c.x + c.w / 2 - (plat.x + plat.w / 2)) < plat.w;
      }
      out.climbed = up;
      out.discovered = discovered.has("forkbomb");
      return out;
    });
    assert(r.roll.closed > 200 && r.roll.rolled, "the fork bomb did not roll in: " + JSON.stringify(r.roll));
    assert(r.roll.unfurl >= 10 && r.roll.leap && r.roll.leap.vy < -600 && r.roll.leap.frame === 5, "no unfurl telegraph before the leap: " + JSON.stringify(r.roll));
    assert(r.kids.n === 2 && r.kids.small && r.grandkids === 0 && r.eliteKids === 3, "fork counts: " + JSON.stringify(r));
    assert(r.climbed, "the fork bomb never reached the platform");
    assert(r.discovered, "the fork bomb is not in the DATABASE");
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("v3.2 Packet Lobber: keeps its distance, marks the floor where you'll be and the packet lands there; shot down, burned by Flame On, parried by the blade", async () => {
    const { context, page, problems } = await v2Run("paine");
    const r = await page.evaluate(() => {
      const out = {};
      // standing still: the marker is under you (while the packet is still in the tube), and it comes down on it
      fresh(1500);
      const l = spawnEnemy("lobber", 2150, GROUND_Y - 74, { elite: false });
      l.shotCd = 0.3;
      let mark = null;
      let gone = false;
      const hp0 = player.hp;
      for (let i = 0; i < 60 * 4 && !gone; i++) {
        steps(1, false);
        const s = enemyShots.find((q) => q.kind === "packet");
        if (s && !mark) mark = { dx: Math.round(s.tx - (player.x + player.w / 2)), floor: s.ty === GROUND_Y, planted: l.state === "plant", inTube: s.phase === 0 };
        if (mark && !s) gone = true;
      }
      out.still = { mark, gone, hurt: Math.round(hp0 - player.hp), range: Math.round(Math.abs(l.x + l.w / 2 - player.x - player.w / 2)) };
      // running: the marker leads you
      fresh(1500);
      player.invuln = 99;
      const l2 = spawnEnemy("lobber", 2050, GROUND_Y - 74, { elite: false });
      l2.shotCd = 99;
      input.keys.add("KeyA");
      steps(20); // up to speed (it only fires while on screen)
      l2.shotCd = 0;
      let lead = null;
      for (let i = 0; i < 60 && lead === null; i++) {
        steps(1);
        const s = enemyShots.find((q) => q.kind === "packet");
        if (s) lead = Math.round(s.tx - (player.x + player.w / 2));
      }
      input.keys.clear();
      out.lead = lead;
      const flying = () => {
        fresh(1500);
        const lb = spawnEnemy("lobber", 2200, GROUND_Y - 74, { elite: false });
        lb.shotCd = 99;
        lobberPlant(lb, player);
        lobberLaunch(lb);
        return enemyShots.find((q) => q.kind === "packet");
      };
      // shot down by an arrow: no blast
      let s = flying();
      steps(20);
      playerShots.push({ x: s.x, y: s.y, vx: 0, vy: 0, r: 12, angle: 0, life: 1, damage: 1, pierce: 0, piercing: false, hit: new Set(), kind: "arrow" });
      const hp = player.hp;
      steps(1, false);
      out.shotDown = { gone: !enemyShots.includes(s), arrowUsed: !playerShots.some((q) => q.kind === "arrow"), unhurt: player.hp === hp };
      // burned by Flame On
      s = flying();
      steps(1);
      Object.assign(s, { x: player.x + 120, y: player.y + 40, vx: 0, vy: 0 });
      flameOn(30);
      steps(6);
      out.burned = !enemyShots.includes(s);
      // parried by Tetsu's blade (the Widow borrows the swing for the test)
      s = flying();
      steps(1);
      Object.assign(s, { x: player.x + player.w / 2 + 80, y: player.y + player.h / 2 - 6, vx: 0, vy: 0 });
      bladeSwing(0);
      out.parried = !enemyShots.includes(s);
      out.discovered = discovered.has("lobber");
      return out;
    });
    assert(r.still.mark && r.still.mark.planted && r.still.mark.inTube && Math.abs(r.still.mark.dx) < 40 && r.still.mark.floor, "no marker under a player standing still: " + JSON.stringify(r.still));
    assert(r.still.gone && r.still.hurt > 0, "the packet did not land on the player: " + JSON.stringify(r.still));
    assert(r.still.range >= 380 && r.still.range <= 820, "the Lobber did not keep its distance: " + JSON.stringify(r.still));
    assert(r.lead !== null && r.lead < -120, "the marker did not lead a running player: " + r.lead);
    assert(r.shotDown.gone && r.shotDown.arrowUsed && r.shotDown.unhurt, "shooting a packet down: " + JSON.stringify(r.shotDown));
    assert(r.burned && r.parried && r.discovered, "Flame On / the blade did not stop packets: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("v3.2 Legacy Monolith: plates soak chip damage, piercing arrows / dashes / DoTs get through, a broken plate exposes that side; no knockback; the slam's shockwaves stop at its floor's edges", async () => {
    const { context, page, problems } = await v2Run("paine");
    const r = await page.evaluate(() => {
      const out = {};
      fresh(1500);
      const m = spawnEnemy("monolith", 1900, GROUND_Y - 150, { elite: false });
      m.hp = m.maxHp = 1e5;
      m.facing = -1;
      m.slamCd = m.chargeCd = 99;
      const px = player.x;
      const hit = (amount, opts) => {
        const h = m.hp;
        damageEnemy(m, amount, opts);
        return Math.round((h - m.hp) * 100) / 100;
      };
      out.chip = hit(7, { source: "em", fromX: px }); // an EM wave on the front plate
      out.orbit = hit(9, { source: "orbit" }); // no direction: the crown
      out.heavy = hit(30, { source: "arrow", fromX: px });
      out.pierce = hit(20, { source: "arrow", fromX: px, pierce: true });
      out.burn = hit(5, { source: "bleed" });
      const crown = m.plates[2].hp;
      out.cleave = hit(10, { source: "dash", breaksGuard: true });
      out.crownLoss = Math.round(crown - m.plates[2].hp);
      damageEnemy(m, 1, { source: "arrow", fromX: px, kbX: 900, kbY: -400, knock: true });
      out.kb = [m.kbX, m.kbY];
      let n = 0;
      while (m.plates[0].hp > 0 && n++ < 20) hit(10, { source: "blade-heavy", fromX: px, breaksGuard: true });
      out.broken = { front: m.plates[0].hp <= 0, back: m.plates[1].hp > 0, debris: debris2.length };
      out.exposed = hit(7, { source: "em", fromX: px });
      out.backStill = hit(7, { source: "em", fromX: m.x + m.w + 300 });
      // the slam: a wind-up, then shockwaves both ways that hit you on its floor
      fresh(1500);
      const s = spawnEnemy("monolith", 1850, GROUND_Y - 150, { elite: false });
      s.hp = s.maxHp = 1e5;
      s.slamCd = 0;
      s.chargeCd = 99;
      let wind = 0;
      let waves = 0;
      let hurt = false;
      for (let i = 0; i < 60 * 3 && !hurt; i++) {
        const hp = player.hp;
        steps(1, false);
        if (s.state === "slamWind") wind++;
        waves = Math.max(waves, shockwaves.filter((w) => w.owner === s).length);
        if (player.hp < hp) hurt = true;
      }
      out.slam = { wind, waves, hurt };
      // on a platform the waves stop at its edges
      fresh(4800);
      const p = platforms[13];
      const t = spawnEnemy("monolith", p.x + 70, p.y - 150, { elite: false });
      t.slamCd = t.chargeCd = 99;
      t.stun = 5; // (stays put: it would drop down after the player)
      steps(3);
      shockwaves.length = 0;
      monolithSlam(t);
      out.onPlat = t.standingOn === p;
      out.edge =
        shockwaves.length === 2 &&
        shockwaves.every((w) => {
          const end = w.x + w.dir * w.speed * w.life;
          return end >= p.x - 30 && end <= p.x + p.w + 30;
        });
      out.discovered = discovered.has("monolith");
      return out;
    });
    assert(r.chip === 0.7 && r.orbit === 0.9, "chip damage got through the plates: " + JSON.stringify(r));
    assert(r.heavy === 21 && r.pierce === 20 && r.burn === 5, "heavy / piercing / DoT damage: " + JSON.stringify(r));
    assert(r.cleave === 10 && r.crownLoss === 30, "the dash did not cleave (x3 on the plate): " + JSON.stringify(r));
    assert(r.kb[0] === 0 && r.kb[1] === 0, "the Monolith was knocked back: " + r.kb);
    assert(r.broken.front && r.broken.back && r.broken.debris >= 1, "plates: " + JSON.stringify(r.broken));
    assert(r.exposed === 7 && r.backStill === 0.7, "a broken plate's side should take full damage: " + JSON.stringify(r));
    assert(r.slam.wind >= 30 && r.slam.waves === 2 && r.slam.hurt, "slam: " + JSON.stringify(r.slam));
    assert(r.onPlat && r.edge && r.discovered, "the waves ran past the platform's edges: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("v3.2 Hotfix: tethers to the most hurt ally and heals it, shields it for one hit, keeps away; its shields pop when it dies; shot down, it stops healing", async () => {
    const { context, page, problems } = await v2Run("paine");
    const r = await page.evaluate(() => {
      const out = {};
      fresh(1500);
      player.invuln = 99;
      const hurt = spawnEnemy("enforcer", 2200, GROUND_Y - 116, { elite: false });
      hurt.hp = hurt.maxHp * 0.4;
      const fine = spawnEnemy("enforcer", 1950, GROUND_Y - 116, { elite: false });
      const h = spawnEnemy("hotfix", 2400, GROUND_Y - 420, { elite: false });
      const hold = () => {
        hurt.x = 2200;
        fine.x = 1950;
      };
      const hp0 = hurt.hp;
      let tether = 0;
      for (let i = 0; i < 60 * 3; i++) {
        hold();
        steps(1);
        if (h.tether1 === hurt) tether++;
      }
      out.heal = { picked: h.ally === hurt, tether, healed: Math.round(hurt.hp - hp0), shield: hurt.bubble === h, away: Math.round(Math.abs(h.x + h.w / 2 - player.x - player.w / 2)) };
      const before = hurt.hp;
      damageEnemy(hurt, 25, { source: "arrow", fromX: hurt.x + hurt.w + 50 });
      out.block = { blocked: hurt.hp === before, popped: !hurt.bubble };
      h.bubbleCd = 0;
      hold();
      steps(2);
      out.reshield = hurt.bubble === h;
      damageEnemy(h, 1e6, { source: "test" });
      out.afterDeath = !hurt.bubble;
      // an arrow shoots a Hotfix out of the sky: no healing while it's down
      const h2 = spawnEnemy("hotfix", 2350, GROUND_Y - 420, { elite: false });
      h2.hp = h2.maxHp = 1e4;
      for (let i = 0; i < 30; i++) {
        hold();
        steps(1);
      }
      hurt.hp = hurt.maxHp * 0.3;
      arrowHit({ vx: 1, x: h2.x, y: h2.y, damage: 10, piercing: false }, h2);
      const hp1 = hurt.hp;
      for (let i = 0; i < 20; i++) {
        hold();
        steps(1);
      }
      out.downed = { downed: !!h2.downed, noHeal: hurt.hp === hp1 };
      out.discovered = discovered.has("hotfix");
      return out;
    });
    assert(r.heal.picked && r.heal.tether > 60 && r.heal.healed > 0, "the Hotfix did not tether and heal the hurt ally: " + JSON.stringify(r.heal));
    assert(r.heal.shield && r.heal.away > 360, "no shield, or it came close: " + JSON.stringify(r.heal));
    assert(r.block.blocked && r.block.popped && r.reshield, "the one-hit shield: " + JSON.stringify(r));
    assert(r.afterDeath, "the shield outlived its Hotfix");
    assert(r.downed.downed && r.downed.noHeal && r.discovered, "a downed Hotfix: " + JSON.stringify(r.downed));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("v3.2 Rate Limiter: inside its 429 field weapons recharge at half speed and the special is locked (the HUD says so); outside it's normal; a dash collapses the field", async () => {
    const { context, page, problems } = await v2Run("tetsu");
    const r = await page.evaluate(() => {
      const out = {};
      fresh(1500);
      const rl = spawnEnemy("ratelimiter", 1700, GROUND_Y - 150, { elite: false });
      rl.pulseCd = 99;
      const run = (n) => {
        for (let i = 0; i < n; i++) {
          rl.x = 1700;
          rl.vx = 0;
          steps(1);
        }
      };
      run(60);
      out.field = Math.round(rl.fieldR);
      player.zapCd = 1;
      run(30);
      out.inside = { throttled: player.throttleT > 0, zap: +player.zapCd.toFixed(2) };
      const texts = [];
      const h = hudText;
      hudText = function (t) {
        texts.push(String(t));
        return h.apply(this, arguments);
      };
      try {
        render(performance.now() / 1000);
      } finally {
        hudText = h;
      }
      out.hud = texts.some((t) => /429 THROTTLED/.test(t));
      player.heat = 100;
      input.specialQueued = true;
      run(1);
      out.locked = { dash: !!player.dash, heat: player.heat };
      // step out: back to normal
      player.x = 2700;
      run(30);
      player.zapCd = 1;
      run(30);
      out.outside = { throttled: player.throttleT > 0, zap: +player.zapCd.toFixed(2) };
      input.specialQueued = true;
      run(1);
      out.free = !!player.dash && player.heat < 100;
      // a dash (or a finisher) cuts the field
      run(30);
      player.x = 1500;
      run(10);
      out.backIn = player.throttleT > 0;
      damageEnemy(rl, 5, { source: "dash", breaksGuard: true });
      run(30);
      out.cut = { collapse: rl.collapseT > 0, r: Math.round(rl.fieldR), throttled: player.throttleT > 0 };
      run(60 * 3);
      out.regrown = Math.round(rl.fieldR);
      out.discovered = discovered.has("ratelimiter");
      return out;
    });
    assert(r.field >= 240, "the field did not grow: " + r.field);
    assert(r.inside.throttled && Math.abs(r.inside.zap - 0.75) < 0.03, "inside, weapons should recharge at half speed: " + JSON.stringify(r.inside));
    assert(r.hud, "no 429 THROTTLED on the HUD");
    assert(!r.locked.dash && r.locked.heat === 100, "the special was not locked: " + JSON.stringify(r.locked));
    assert(!r.outside.throttled && Math.abs(r.outside.zap - 0.5) < 0.03, "outside: " + JSON.stringify(r.outside));
    assert(r.free, "the special stayed locked outside the field");
    assert(r.backIn && r.cut.collapse && r.cut.r === 0 && !r.cut.throttled, "the dash did not collapse the field: " + JSON.stringify(r));
    assert(r.regrown >= 240 && r.discovered, "the field never came back: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("v3.2 enemies vs the hijack: a hijacked Fork Bomb's children join your side, a hijacked Hotfix heals your pawns (not enemies), a hijacked Rate Limiter jams enemies (not you)", async () => {
    const { context, page, problems } = await v2Run("sudo");
    const r = await page.evaluate(() => {
      const out = {};
      fresh(1500);
      const f = spawnEnemy("forkbomb", 1900, GROUND_Y - 50, { elite: false });
      hijack(f, 6);
      damageEnemy(f, 1e6, { source: "test" });
      const kids = enemies.filter((e) => !e.dead && e.type === "forkbomb");
      out.kids = { n: kids.length, hijacked: kids.every((k) => isHijacked(k)) };
      // a hijacked Hotfix patches up a hurt pawn and ignores a hurt enemy
      fresh(1500);
      const pawn = spawnEnemy("enforcer", 2000, GROUND_Y - 116, { elite: false });
      const foe = spawnEnemy("enforcer", 2350, GROUND_Y - 116, { elite: false });
      hijack(pawn, 30);
      pawn.hp = pawn.maxHp * 0.4;
      foe.hp = foe.maxHp * 0.3;
      const h = spawnEnemy("hotfix", 2150, GROUND_Y - 420, { elite: false });
      hijack(h, 30);
      const p0 = pawn.hp;
      const f0 = foe.hp;
      for (let i = 0; i < 90; i++) {
        pawn.x = 2000;
        foe.x = 2350;
        steps(1);
      }
      out.hotfix = { ally: h.ally === pawn, healedPawn: pawn.hp > p0, foeUnhealed: foe.hp <= f0 };
      // a hijacked Rate Limiter: its field slows enemies, not the player
      fresh(1500);
      const rl = spawnEnemy("ratelimiter", 1650, GROUND_Y - 150, { elite: false });
      hijack(rl, 30);
      const c = spawnEnemy("crawler", 1700, GROUND_Y - 48, { elite: false });
      c.hp = c.maxHp = 1e4;
      for (let i = 0; i < 40; i++) {
        rl.x = 1650;
        c.x = 1700;
        steps(1);
      }
      out.limiter = { field: Math.round(rl.fieldR), playerFree: !(player.throttleT > 0), enemySlowed: c.slowT > 0 && c.slowMul < 1 };
      return out;
    });
    assert(r.kids.n === 2 && r.kids.hijacked, "the children did not inherit the hijack: " + JSON.stringify(r.kids));
    assert(r.hotfix.ally && r.hotfix.healedPawn && r.hotfix.foeUnhealed, "the hijacked Hotfix: " + JSON.stringify(r.hotfix));
    assert(r.limiter.field > 100 && r.limiter.playerFree && r.limiter.enemySlowed, "the hijacked Rate Limiter: " + JSON.stringify(r.limiter));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("v3.2 enemies: they join the director's mix on schedule, walkers spawn on floors, three new squads, DATABASE entries; a bot run with them has no errors", async () => {
    const { context, page, problems } = await open(browser, url, V2_VIEW);
    await startRun(page, { settings: { character: "sudo", autoFire: true, autoFlame: true } });
    await page.evaluate(V2_HELPERS);
    const r = await page.evaluate(() => {
      const out = {};
      const ids = ["forkbomb", "lobber", "hotfix", "ratelimiter", "monolith"];
      out.data = ids.every((id) => {
        const d = ENEMY_TYPES[id];
        return d.v2 && d.from > 0 && d.weight > 0 && d.maxAlive > 0 && d.desc && d.lore && ["normal", "resist", "immune"].includes(d.compromise);
      });
      out.resist = ["monolith", "ratelimiter"].every((id) => ENEMY_TYPES[id].compromise === "resist");
      // the director: what it picks at a given time (spawning stubbed out)
      const real = spawnAtEdge;
      const picks = (t) => {
        const seen = new Set();
        spawnAtEdge = (type) => seen.add(type);
        enemies.length = 0;
        Object.assign(director, { stage: STAGE.start, nextBossAt: 1e9, squadAt: 1e9, firstSpawn: 0, acc: 0 });
        game.time = t;
        for (let i = 0; i < 60 * 200; i++) updateDirector(1 / 60);
        spawnAtEdge = real;
        return ids.filter((id) => seen.has(id));
      };
      out.at50 = picks(50);
      out.at200 = picks(200);
      // edge spawns: walkers on a floor, the Hotfix in the sky
      fresh(3000);
      game.time = 30;
      ids.forEach((id) => spawnAtEdge(id));
      out.spawned = ids.every((id) => enemies.some((e) => e.type === id));
      steps(30);
      out.grounded = enemies.filter((e) => e.def.walker && e.def.v2).every((e) => e.onGround || !!e.nav);
      out.flyer = enemies.filter((e) => e.type === "hotfix").every((e) => e.y < GROUND_Y - 150);
      // the squads
      out.squads = ["forkstorm", "artillery", "siege"].map((id) => {
        fresh(3000);
        const q = SQUADS.find((s) => s.id === id);
        q.make();
        return [id, q.from, enemies.map((e) => e.type).sort().join(",")];
      });
      // seen: in the DATABASE
      fresh(3000);
      ids.forEach((id, i) => spawnEnemy(id, 2700 + i * 120, ENEMY_TYPES[id].walker ? GROUND_Y - ENEMY_TYPES[id].h : GROUND_Y - 400, { elite: false }));
      steps(2);
      out.db = ids.every((id) => discovered.has(id));
      return out;
    });
    assert(r.data && r.resist, "the data entries: " + JSON.stringify(r));
    assert(r.at50.join() === "forkbomb" && r.at200.length === 5, "the director's mix: " + JSON.stringify([r.at50, r.at200]));
    assert(r.spawned && r.grounded && r.flyer, "edge spawns: " + JSON.stringify(r));
    const squads = Object.fromEntries(r.squads.map(([id, from, types]) => [id, { from, types }]));
    assert(squads.forkstorm.types === "forkbomb,forkbomb,forkbomb,forkbomb,forkbomb,forkbomb", "FORK STORM: " + JSON.stringify(squads.forkstorm));
    assert(squads.artillery.types === "enforcer,lobber,lobber" && squads.siege.types === "hotfix,hotfix,monolith", "squads: " + JSON.stringify(squads));
    assert(r.db, "the new enemies were not added to the DATABASE");
    // a minute with all of them in the mix: no errors, the run goes on
    await page.evaluate(() => {
      enemies.length = 0;
      Object.assign(director, { stage: STAGE.start, nextBossAt: 1e9, squadAt: game.time + 5, firstSpawn: 0, acc: 0 });
      game.time = 200;
      director.squadAt = 205;
    });
    const state = await fastForward(page, 60, "player.hp = Math.max(player.hp, 60); player.heat = Math.max(player.heat, 50); if (Math.random() < 0.02) input.jumpQueued = true;");
    assert(state === "playing", "the run ended: " + state);
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("bosses: the Overseer (minions derez, no spawns, vents), then NULL, then the GOAT as final boss; beating it wins", async () => {
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
      out.overseer = !!o && o.type === "overseer" && director.stage === STAGE.overseer && STAGE.overseer === 1;
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
      // NULL is next (its own test below covers the fight): wait out its
      // entrance, then delete it
      director.nextBossAt = game.time;
      step(2);
      const n = game.boss;
      out.nullNext = !!n && n.type === "nullptr" && director.stage === STAGE.nullptr && BOSSES.nullptr.title === "Second boss";
      for (let i = 0; i < 600 && (n.parked || bossLocked()); i++) step(1);
      damageEnemy(n, n.hp + 1, { source: "test" });
      step(5);
      out.afterNull = { stage: director.stage, wait: Math.round(director.nextBossAt - game.time), defeated: game.bossesDefeated, copies: enemies.filter((e) => !e.dead && e.type === "nullptr").length };
      director.nextBossAt = game.time;
      step(2);
      const g = game.boss;
      out.goat = !!g && g.type === "goat" && director.stage === STAGE.goat && BOSSES.goat.title === "Final boss";
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
    assert(r.nullNext, "NULL did not arrive second: " + JSON.stringify(r));
    assert(r.afterNull.stage === 4 && r.afterNull.wait > 10 && r.afterNull.defeated === 2 && r.afterNull.copies === 0, "no interlude after NULL: " + JSON.stringify(r.afterNull));
    assert(r.goat, "the GOAT did not arrive as the final boss");
    assert(["charge", "leap", "breath"].filter((s) => r.goatStates.includes(s)).length >= 2, "GOAT used too few attacks: " + r.goatStates.join(","));
    assert(r.phase >= 1 && r.goatStates.includes("roar"), "GOAT did not enrage with a roar: " + JSON.stringify(r));
    assert(r.dying, "no death sequence for the GOAT");
    assert(r.won && r.state === "over", "killing the GOAT did not win: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("NULL: glitch entrance, one real among its copies (hits pop copies), blink glyph, shuriken fan, rail snipe, phases, rewards; Overseer > NULL > GOAT to a win", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { quiet: false, settings: { autoFire: false, autoFlame: false } });
    const r = await page.evaluate(() => {
      const out = { order: [] };
      const step = (k) => {
        for (let i = 0; i < k && game.state !== "over"; i++) {
          player.hp = stats.maxHp;
          if (game.state === "levelup") chooseUpgrade(0, true);
          update(1 / 60);
        }
      };
      const until = (cond, max = 600) => {
        let i = 0;
        while (!cond() && i++ < max) step(1);
        return i;
      };
      const figures = () => enemies.filter((e) => !e.dead && e.type === "nullptr");
      const minions = () => enemies.filter((e) => !e.dead && !e.boss).length;
      const draw = () => render(performance.now() / 1000); // the drawing code must not throw either
      director.firstSpawn = 0;
      step(240);
      // The Overseer first
      game.time = director.nextBossAt;
      step(2);
      const o = game.boss;
      out.order.push(o.type);
      step(60 * 4);
      damageEnemy(o, o.hp + 1, { source: "test" });
      step(5);
      out.interlude1 = { stage: director.stage, wait: Math.round(director.nextBossAt - game.time) };
      step(60 * 3);
      out.minionsBefore = minions();

      // ---- The entrance: fragments converge into one figure, its own card, then copies
      director.nextBossAt = game.time;
      step(2);
      const n = game.boss;
      out.order.push(n.type);
      out.entrance = { stage: director.stage, locked: bossLocked(), card: game.cinematic.style, title: game.cinematic.title, minions: minions(), parked: n.parked, cloaked: n.cloaked };
      step(30);
      out.entrance.frags = nullFx.frags.length;
      draw();
      until(() => n.formed);
      out.entrance.formed = !n.parked;
      until(() => !bossLocked());
      const figs = figures();
      out.split = { figures: figs.length, real: figs.filter((e) => !e.decoy).length, label: nullTargetLabel(n), cloaked: n.cloaked };
      draw();

      // ---- Copies attack too, but weakly
      const d = figs.find((e) => e.decoy);
      enemyShots.length = 0;
      player.invuln = 2; // (so none of them is used up on you before it's counted)
      nullState(d, "toss");
      until(() => d.step === 1, 40); // (counted on the frame they leave its hand)
      const holo = enemyShots.filter((s) => s.kind === "shuriken" && s.holo);
      out.copyAttack = { shots: holo.length, damage: holo.length ? holo[0].damage : 0, owner: holo.every((s) => s.owner === n) };

      // ---- Hitting a copy pops it (no damage to NULL) and reveals the real one
      const hp0 = n.hp;
      damageEnemy(d, 5, { source: "test" });
      step(1);
      out.pop = { dead: d.dead, untouched: n.hp === hp0, reveal: n.revealT > 0, label: nullTargetLabel(n), cloaked: n.cloaked, real: figures().filter((e) => !e.decoy).length };
      until(() => !n.parked);
      const hp2 = n.hp;
      damageEnemy(n, 10, { source: "test" });
      out.realHit = n.hp < hp2;
      draw();

      // ---- Blink: it dissolves, a glyph marks where it will be, then it's there and slashes
      figures().filter((e) => e.decoy).forEach((e) => popDecoy(e, true));
      until(() => !n.parked && n.onGround);
      n.chainLeft = n.chainIdx = 0;
      nullState(n, "blink");
      until(() => n.parked, 60);
      const g = n.glyph;
      out.blink = { glyph: !!g && nullFx.glyphs.includes(g), parked: n.parked, cloaked: n.cloaked };
      draw();
      const hp1 = n.hp;
      damageEnemy(n, 50, { source: "test" });
      out.blink.untouchable = n.hp === hp1;
      out.blink.wait = until(() => !n.parked, 120) / 60;
      out.blink.tell = g ? g.tell : 0;
      out.blink.atGlyph = g ? Math.abs(n.x + n.w / 2 - g.x) < 40 : false;
      out.blink.glyphGone = !nullFx.glyphs.includes(g);
      until(() => nullFx.slashes.length > 0, 60);
      out.blink.slashed = nullFx.slashes.length > 0;
      draw();

      // ---- Shuriken fan: a glint first, then spinning stars at different speeds
      until(() => n.state === "move" && n.onGround, 240);
      enemyShots.length = 0;
      player.invuln = 3;
      nullState(n, "fan");
      step(5);
      out.fan = { beforeThrow: enemyShots.length };
      until(() => n.step >= 1, 60); // counted on the frame they leave its hand
      const stars = enemyShots.filter((s) => s.kind === "shuriken");
      const angles = stars.map((s) => Math.atan2(s.vy, s.vx));
      Object.assign(out.fan, { n: stars.length, speeds: new Set(stars.map((s) => Math.round(Math.hypot(s.vx, s.vy)))).size, owner: stars.every((s) => s.owner === n), spread: Math.max(...angles) - Math.min(...angles) });
      draw();

      // ---- Rail snipe: an aim line that tracks, then locks, then one fast shot
      until(() => n.state === "move" && n.onGround, 240);
      enemyShots.length = 0;
      nullState(n, "snipe");
      until(() => !!n.aim, 300);
      out.snipe = { aiming: !!n.aim, lockedAtFirst: !!(n.aim && n.aim.locked), railsWhileAiming: nullFx.rails.length };
      draw();
      until(() => n.aim && n.aim.locked, 120);
      out.snipe.locked = !!(n.aim && n.aim.locked);
      const locked = n.aim && n.aim.angle;
      step(4);
      out.snipe.held = !n.aim || n.aim.angle === locked;
      out.snipe.railsAtLock = nullFx.rails.length;
      until(() => nullFx.rails.length > 0, 60);
      const rail = nullFx.rails[0];
      out.snipe.fired = !!rail && rail.owner === n && Math.abs(Math.atan2(rail.uy, rail.ux) - locked) < 1e-6;
      draw();
      out.minionsDuring = minions();

      // ---- Phases: more copies below 60%, STACK OVERFLOW below 25%
      until(() => !n.parked && n.state === "move", 300);
      n.hp = n.maxHp * 0.5;
      let peak = 0; // copies can expire or blink out, so take the peak over the second
      for (let i = 0; i < 60; i++) {
        step(1);
        peak = Math.max(peak, figures().filter((e) => e.decoy).length);
      }
      out.phase1 = { phase: n.phase, copies: peak };
      until(() => !n.parked, 300);
      n.hp = n.maxHp * 0.2;
      step(1);
      out.phase2 = { phase: n.phase, banner: game.banner && game.banner.text, state: n.state, chain: n.chainLeft };
      out.phase2.coredump = until(() => n.state === "coredump", 600) < 600;
      step(2);
      out.phase2.exposed = n.vulnT > 0;
      draw();

      // ---- Rewards: +1 life (a heal when full) and the RARE CACHE
      director.firstSpawn = 1e9; // no XP from here on: the next level-up is ours
      gems.length = 0;
      game.lives = 2;
      until(() => !n.parked && !bossLocked());
      damageEnemy(n, n.hp + 1, { source: "test" });
      step(2);
      out.killed = { dead: n.dead, stage: director.stage, copies: figures().length, defeated: game.bossesDefeated };
      step(60 * 3);
      draw();
      out.reward = { lives: game.lives, cache: progress.rareCache, banner: game.banner ? game.banner.text : "", wait: Math.round(director.nextBossAt - game.time) };
      progress.pending = 1;
      update(1 / 60);
      out.cache = { state: game.state, allRare: currentChoices.length > 0 && currentChoices.every((c) => c.rare) };
      chooseUpgrade(0, true);
      out.cache.spent = !progress.rareCache;

      // ---- Then the GOAT, to a win
      director.nextBossAt = game.time;
      step(2);
      const goat = game.boss;
      out.order.push(goat.type);
      out.goatStage = director.stage === STAGE.goat;
      step(60 * 5);
      damageEnemy(goat, goat.hp + 1, { source: "test" });
      step(60 * 4);
      out.won = game.won && game.state === "over";
      out.bossesDefeated = game.bossesDefeated;
      return out;
    });
    const j = JSON.stringify;
    assert(r.order.join(">") === "overseer>nullptr>goat", "boss order: " + r.order.join(">"));
    assert(r.interlude1.stage === 2 && r.interlude1.wait >= 30, "no interlude before NULL: " + j(r.interlude1));
    assert(r.minionsBefore > 0, "no minions in the interlude to derez");
    const e = r.entrance;
    assert(e.stage === 3 && e.locked && e.card === "nullptr" && e.title === "NULL" && e.minions === 0, "NULL's entrance: " + j(e));
    assert(e.parked && e.frags > 20 && e.formed, "no fragments converging into NULL: " + j(e));
    assert(r.split.figures === 3 && r.split.real === 1 && r.split.label === "REAL TARGET: ?" && r.split.cloaked, "NULL did not split into copies: " + j(r.split));
    assert(r.copyAttack.shots === 2 && r.copyAttack.damage < 10 && r.copyAttack.owner, "the copies don't attack (weakly): " + j(r.copyAttack));
    assert(r.pop.dead && r.pop.untouched && r.pop.reveal && r.pop.label === "REAL TARGET: LOCKED" && !r.pop.cloaked && r.pop.real === 1, "hitting a copy did not pop it and reveal NULL: " + j(r.pop));
    assert(r.realHit, "hitting the real NULL did no damage");
    const b = r.blink;
    assert(b.glyph && b.parked && b.cloaked && b.untouchable, "no glyph while NULL is gone (or it could be hit): " + j(b));
    assert(b.wait >= b.tell - 0.05 && b.atGlyph && b.glyphGone && b.slashed, "NULL did not reappear at its glyph after the tell and slash: " + j(b));
    assert(r.fan.beforeThrow === 0 && r.fan.n === 5 && r.fan.speeds >= 4 && r.fan.owner && r.fan.spread > 0.6, "shuriken fan: " + j(r.fan));
    const s = r.snipe;
    assert(s.aiming && !s.lockedAtFirst && s.railsWhileAiming === 0 && s.locked && s.held && s.railsAtLock === 0 && s.fired, "rail snipe telegraph: " + j(s));
    assert(r.minionsDuring === 0, "minions spawned during NULL: " + r.minionsDuring);
    assert(r.phase1.phase === 1 && r.phase1.copies === 3, "below 60% NULL should make more copies: " + j(r.phase1));
    const p2 = r.phase2;
    assert(p2.phase === 2 && p2.banner === "STACK OVERFLOW" && p2.state === "blink" && p2.chain === 2 && p2.coredump && p2.exposed, "STACK OVERFLOW: " + j(p2));
    assert(r.killed.dead && r.killed.stage === 4 && r.killed.copies === 0 && r.killed.defeated === 2, "NULL's defeat: " + j(r.killed));
    assert(r.reward.lives === 3 && r.reward.cache && /RARE CACHE/.test(r.reward.banner) && r.reward.wait >= 25, "NULL's rewards: " + j(r.reward));
    assert(r.cache.state === "levelup" && r.cache.allRare && r.cache.spent, "the RARE CACHE level-up: " + j(r.cache));
    assert(r.goatStage && r.won && r.bossesDefeated === 3, "no win after all three bosses: " + j(r));
    // With all 3 lives, the reward is a big heal instead
    const heal = await page.evaluate(() => {
      startGame();
      skipIntro();
      player.hp = 20;
      nullReward();
      return { lives: game.lives, hp: player.hp, max: stats.maxHp, cache: progress.rareCache };
    });
    assert(heal.lives === 3 && heal.hp >= 20 + heal.max * 0.5 && heal.cache, "full lives: no big heal: " + j(heal));
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
    assert(counts.enemies.all === 13 && counts.enemies.locked === 13, "enemies: " + JSON.stringify(counts.enemies));
    assert(counts.bosses.all === 3 && counts.bosses.locked === 3, "bosses: " + JSON.stringify(counts.bosses));
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
    await dropIn(page);
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
    await page.waitForTimeout(1300); // two full bow draws
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
    await page.waitForTimeout(1700); // the bow draws for ~0.4 s per arrow
    const r = await page.evaluate(() => ({ zaps: window.__zaps, air: !player.onGround, flame: heatWaves.length > 0 }));
    assert(r.zaps >= 3, "taps did not fire: " + r.zaps);
    assert(!r.air && !r.flame, "tap caused a jump or flame: " + JSON.stringify(r));
    await context.close();
  });

  await test("phone: the FLAME ON button fires the Widow's heat wave; there is no JUMP button", async () => {
    const { context, page } = await open(browser, url, phone);
    await startRun(page, { settings: { character: "paine", autoFlame: false } });
    await page.evaluate(() => (player.heat = 100));
    const btn = await page.$(".btn-flame");
    const box = await btn.boundingBox();
    const cdp = await context.newCDPSession(page);
    const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 20 };
    await touch(cdp, "touchStart", [pt]);
    await page.waitForTimeout(40);
    await touch(cdp, "touchEnd", [pt]);
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => ({ heat: player.heat, waves: heatWaves.length, label: document.querySelector(".btn-flame").textContent, jumpBtn: !!document.querySelector(".btn-jump") }));
    assert(r.heat < 100 && r.waves > 0, "the button did not fire Flame On: " + JSON.stringify(r));
    assert(r.label === "FLAME ON", "wrong button label: " + r.label);
    assert(!r.jumpBtn, "a JUMP button still exists");
    await context.close();
  });

  await test("phone: Tetsu's SPECIAL button dashes and Hackerman's slows time", async () => {
    const { context, page } = await open(browser, url, phone);
    for (const [ch, label] of [["tetsu", "DASH"], ["sudo", "SLOW-MO"]]) {
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

  // -------------------------------------------------------- Gamepads ----
  // navigator.getGamepads() is mocked: a test plugs pads in, holds buttons and
  // moves sticks, and js/gamepad.js polls them every animation frame (or when
  // a test calls gamepads.poll() itself, to step the game deterministically).
  const PAD_MOCK = () => {
    const slots = [null, null, null, null];
    const NAMES = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
    window.__rumbles = [];
    window.__padPlug = (i, spec) => {
      slots[i] = {
        id: spec.id,
        index: i,
        mapping: spec.mapping === undefined ? "standard" : spec.mapping,
        connected: true,
        timestamp: 0,
        axes: (spec.axes || [0, 0, 0, 0]).slice(),
        buttons: Array.from({ length: spec.buttons || 17 }, () => ({ pressed: false, touched: false, value: 0 })),
        vibrationActuator: {
          type: "dual-rumble",
          playEffect: (type, o) => {
            window.__rumbles.push({ pad: i, type, ...o });
            return Promise.resolve("complete");
          },
        },
      };
      dispatchEvent(Object.assign(new Event("gamepadconnected"), { gamepad: slots[i] }));
    };
    window.__padUnplug = (i) => {
      const gp = slots[i];
      slots[i] = null;
      if (gp) gp.connected = false;
      dispatchEvent(Object.assign(new Event("gamepaddisconnected"), { gamepad: gp }));
    };
    window.__padButton = (i, b, v) => {
      const btn = slots[i].buttons[typeof b === "number" ? b : NAMES[b]];
      btn.value = v;
      btn.pressed = btn.touched = v > 0.5;
    };
    window.__padAxes = (i, axes) => (slots[i].axes = axes.slice());
    // Like Chrome: a fresh snapshot on every call
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => slots.map((p) => p && { ...p, axes: p.axes.slice(), buttons: p.buttons.map((b) => ({ ...b })) }),
    });
  };
  const PAD_IDS = {
    xbox: { id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)" },
    dualsense: { id: "054c-0ce6-DualSense Wireless Controller" },
    generic: { id: "USB Gamepad (Vendor: 0079 Product: 0006)", mapping: "", axes: [0, 0, 0, 0, 0], buttons: 12 },
  };
  async function openPad(contextOptions = desktop) {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push("page error: " + e.message));
    await page.addInitScript(PAD_MOCK);
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(500);
    return { context, page, problems };
  }
  // Press and release a button in real time (the pad is read once a frame)
  async function padPress(page, button, pad = 0) {
    await page.evaluate(([i, b]) => __padButton(i, b, 1), [pad, button]);
    await page.waitForTimeout(50);
    await page.evaluate(([i, b]) => __padButton(i, b, 0), [pad, button]);
    await page.waitForTimeout(50);
  }
  const padFocus = (page) =>
    page.evaluate(() => {
      const el = document.activeElement;
      return { id: el.id, cls: String(el.className), pressed: el.getAttribute("aria-pressed"), ring: getComputedStyle(el).outlineStyle };
    });
  const silence = (page) =>
    page.evaluate(() => {
      Object.values(sfx).forEach((s) => {
        s.play = () => {};
        s.startLoop = () => {};
        s.stopLoop = () => {};
      });
      music.play = () => {};
    });

  await test("gamepad: plugging in toasts and plays padConnect, the first pad used is player 1, others ask to join, unplugging frees the slot and pauses", async () => {
    const { context, page, problems } = await openPad();
    await page.evaluate(() => {
      window.__sounds = [];
      window.__joins = [];
      if (typeof synth === "undefined") window.synth = { play() {} }; // js/synthfx.js may not be there yet
      const play = synth.play;
      synth.play = function (name) {
        __sounds.push(name);
        return play.apply(this, arguments);
      };
      gamepads.onJoinRequest = (i) => __joins.push(i);
    });
    const toast = () => page.evaluate(() => ({ text: document.querySelector(".pad-toast").textContent, shown: !document.querySelector(".pad-toast").hidden }));
    const none = await page.evaluate(() => ({ none: document.body.classList.contains("pad-none"), prompt: padPrompt("A"), slots: gamepads.slots.slice() }));
    await page.evaluate((spec) => __padPlug(0, spec), PAD_IDS.xbox);
    await page.waitForTimeout(80);
    const t1 = await toast();
    await page.evaluate((spec) => __padPlug(1, spec), PAD_IDS.dualsense);
    await page.waitForTimeout(80);
    const t2 = await toast();
    // The DualSense is used first: it drives player 1. The Xbox pad asks to join.
    await padPress(page, "X", 1);
    await padPress(page, "START", 0);
    const slots = await page.evaluate(() => ({ slots: gamepads.slots.slice(), joins: __joins.slice(), cls: document.body.classList.contains("pad-ps"), prompt: padPrompt("A"), state: game.state, read: gamepads.read(0) && gamepads.read(0).name }));
    // Unplug player 1 mid-run: the game pauses and the prompts go back to the keyboard
    await startRun(page);
    await page.evaluate(() => __padUnplug(1));
    await page.waitForTimeout(80);
    const t3 = await toast();
    const after = await page.evaluate(() => ({ slots: gamepads.slots.slice(), state: game.state, none: document.body.classList.contains("pad-none"), prompt: padPrompt("A"), sounds: __sounds.slice(), pads: gamepads.pads.size }));
    assert(none.none && none.prompt === null && none.slots[0] === null, "pad state before any pad: " + JSON.stringify(none));
    assert(t1.shown && t1.text === "CONTROLLER CONNECTED: Xbox", "no Xbox toast: " + JSON.stringify(t1));
    assert(t2.shown && t2.text === "CONTROLLER CONNECTED: DualSense", "no DualSense toast: " + JSON.stringify(t2));
    assert(slots.slots[0] === 1 && slots.read === "DualSense", "the first pad used is not player 1: " + JSON.stringify(slots));
    assert(slots.joins.join() === "0" && slots.state === "menu", "the second pad's Start did not ask to join (or acted): " + JSON.stringify(slots));
    assert(slots.cls && slots.prompt === "✕", "PlayStation prompts not shown: " + JSON.stringify(slots));
    assert(t3.shown && t3.text === "CONTROLLER DISCONNECTED: DualSense", "no disconnect toast: " + JSON.stringify(t3));
    assert(after.slots[0] === null && after.pads === 1, "player 1's slot not freed: " + JSON.stringify(after));
    assert(after.state === "paused", "losing the controller mid-run did not pause: " + after.state);
    assert(after.none && after.prompt === null, "prompts still show a pad: " + JSON.stringify(after));
    assert(after.sounds.filter((s) => s === "padConnect").length === 2 && after.sounds.includes("padDisconnect"), "sounds: " + after.sounds.join());
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("gamepad: left stick runs, A jumps, Down + A drops through, RT draws and fires the bow, LT fires Paine's Flame On and Tetsu's dash, hits rumble, Start pauses", async () => {
    const { context, page, problems } = await openPad();
    await startRun(page, { settings: { character: "paine", autoFire: false, autoFlame: false } });
    await page.evaluate((spec) => __padPlug(0, spec), PAD_IDS.xbox);
    const r = await page.evaluate(() => {
      const step = (n) => {
        for (let i = 0; i < n; i++) {
          gamepads.poll();
          update(1 / 60);
        }
      };
      const out = {};
      window.__shots = 0;
      const f = fireZap;
      fireZap = function () {
        __shots++;
        return f.apply(this, arguments);
      };
      player.x = 2600;
      __padAxes(0, [1, 0, 0, 0]); // run right
      let x0 = player.x;
      step(30);
      out.ran = player.x - x0;
      out.vx = player.vx;
      __padAxes(0, [0, 0, 0, 0]);
      step(30);
      out.stopped = Math.abs(player.vx) < 1 && player.onGround;
      // jump: A
      __padButton(0, "A", 1);
      step(3);
      out.jumped = !player.onGround && player.vy < 0;
      __padButton(0, "A", 0);
      step(90);
      out.landed = player.onGround;
      // drop through: holding Down alone stays put, Down + A drops
      const plat = platforms[0];
      Object.assign(player, { x: plat.x + 40, y: plat.y - player.h - 1, vx: 0, vy: 0 });
      step(20);
      out.onPlat = player.standingOn === plat;
      __padAxes(0, [0, 1, 0, 0]);
      step(30);
      out.stillOn = player.standingOn === plat;
      __padButton(0, "A", 1);
      step(2);
      __padButton(0, "A", 0);
      step(30);
      out.dropped = player.y > plat.y;
      __padAxes(0, [0, 0, 0, 0]);
      step(90);
      // fire: RT (the bow draws ~0.4 s per arrow)
      __padButton(0, "RT", 1);
      step(75);
      __padButton(0, "RT", 0);
      out.shots = __shots;
      step(30);
      out.idleShots = __shots - out.shots;
      // Paine's special is a press: LT fires one Flame On heat wave
      player.heat = 100;
      player.specialCd = 0;
      __padButton(0, "LT", 1);
      step(10);
      out.lit = heatWaves.length > 0 && player.heat < 100;
      __padButton(0, "LT", 0);
      step(3);
      out.out = true;
      // taking a hit rumbles the pad
      __rumbles.length = 0;
      player.invuln = 0;
      player.shield = 0;
      hurtPlayer(10, player.x + 200, player.y);
      step(1);
      out.rumble = __rumbles.slice();
      // Start pauses
      __padButton(0, "START", 1);
      gamepads.poll();
      out.paused = game.state;
      __padButton(0, "START", 0);
      gamepads.poll();
      return out;
    });
    // Tetsu's dash is a press special: one tap of LT
    await startRun(page, { settings: { character: "tetsu", autoFire: false, autoFlame: false } });
    const t = await page.evaluate(() => {
      player.heat = 100;
      __padButton(0, "LT", 1);
      gamepads.poll();
      update(1 / 60);
      const dashing = !!player.dash;
      __padButton(0, "LT", 0);
      for (let i = 0; i < 40; i++) {
        gamepads.poll();
        update(1 / 60);
      }
      return { dashing, heat: player.heat, again: !!player.dash };
    });
    assert(r.ran > 120 && r.vx > 200, "the left stick did not run: " + JSON.stringify(r));
    assert(r.stopped, "the player kept running with the stick centred");
    assert(r.jumped && r.landed, "A did not jump: " + JSON.stringify(r));
    assert(r.onPlat && r.stillOn, "holding Down alone should not drop: " + JSON.stringify(r));
    assert(r.dropped, "Down + A did not drop through the platform");
    assert(r.shots >= 2 && r.idleShots === 0, "RT did not fire (or kept firing): " + JSON.stringify(r));
    assert(r.lit && r.out, "LT did not hold the flame: " + JSON.stringify(r));
    assert(r.rumble.length === 1 && r.rumble[0].type === "dual-rumble" && r.rumble[0].strongMagnitude > 0, "no rumble on a hit: " + JSON.stringify(r.rumble));
    assert(r.paused === "paused", "Start did not pause: " + r.paused);
    assert(t.dashing && t.heat < 100 && !t.again, "LT did not dash once: " + JSON.stringify(t));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("gamepad: with auto-fire on, the left stick runs one way while the right stick aims the other; centred, auto-fire takes the target", async () => {
    const { context, page, problems } = await openPad();
    await startRun(page, { settings: { character: "paine", autoFire: true, autoFlame: false } });
    await page.evaluate((spec) => __padPlug(0, spec), PAD_IDS.xbox);
    const r = await page.evaluate(() => {
      const step = (n) => {
        for (let i = 0; i < n; i++) {
          gamepads.poll();
          update(1 / 60);
        }
      };
      player.x = 3000;
      camera.x = player.x - W / 2;
      const e = spawnEnemy("drone", player.x - 500, player.y - 320, { elite: false });
      Object.assign(e, { shotCd: 99, stun: 999, hp: 1e6, maxHp: 1e6 });
      window.__angles = [];
      const f = fireZap;
      fireZap = function (ax, ay) {
        __angles.push((Math.atan2(ay, ax) * 180) / Math.PI);
        return f.apply(this, arguments);
      };
      const x0 = player.x;
      __padAxes(0, [-1, 0, 1, 0]); // run left, aim right
      step(70);
      const right = { angles: __angles.splice(0), dx: player.x - x0, vx: player.vx, facing: player.facing };
      __padAxes(0, [-1, 0, 0, -1]); // still running left, aim straight up
      step(40);
      const up = { angles: __angles.splice(0), vx: player.vx };
      // centre the right stick: auto-fire aims at the enemy again (it's up-left)
      Object.assign(e, { x: player.x - 500, y: player.y - 320 });
      const x1 = player.x;
      __padAxes(0, [-1, 0, 0, 0]);
      step(70);
      const auto = { angles: __angles.splice(0), dx: player.x - x1 };
      __padAxes(0, [0, 0, 0, 0]);
      return { right, up, auto };
    });
    const { right, up, auto } = r;
    assert(right.angles.length >= 2 && right.angles.every((a) => Math.abs(a) < 15), "the right stick did not aim right: " + right.angles.map(Math.round).join(","));
    assert(right.dx < -100 && right.vx < -200, "auto-fire stopped the run: " + JSON.stringify(right));
    assert(right.facing === 1, "not facing the aim while running away: " + right.facing);
    assert(up.angles.length >= 1 && up.angles.every((a) => a < -75 && a > -105) && up.vx < -200, "the aim did not follow the stick up: " + JSON.stringify(up));
    assert(auto.angles.length >= 1 && auto.angles.every((a) => a < -110), "centred stick: auto-fire did not aim at the enemy: " + auto.angles.map(Math.round).join(","));
    assert(auto.dx < -100, "movement stopped under auto-fire: " + auto.dx);
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("phone: with auto-fire on, the twin-stick still aims while the left stick runs the other way", async () => {
    const { context, page, problems } = await open(browser, url, phone);
    await startRun(page, { settings: { character: "paine", autoFire: true, autoFlame: false, touchAim: "twin" } });
    await page.evaluate(() => {
      player.x = 3000;
      const e = spawnEnemy("drone", player.x - 500, player.y - 320, { elite: false });
      Object.assign(e, { shotCd: 99, stun: 999, hp: 1e6, maxHp: 1e6 });
      window.__angles = [];
      const f = fireZap;
      fireZap = function (ax, ay) {
        __angles.push((Math.atan2(ay, ax) * 180) / Math.PI);
        return f.apply(this, arguments);
      };
    });
    const vp = page.viewportSize();
    const cdp = await context.newCDPSession(page);
    const L = { x: vp.width * 0.2, y: vp.height * 0.6, id: 41 };
    const R = { x: vp.width * 0.75, y: vp.height * 0.6, id: 42 };
    const x0 = await page.evaluate(() => player.x);
    await touch(cdp, "touchStart", [L, R]);
    for (let i = 1; i <= 5; i++) await touch(cdp, "touchMove", [{ ...L, x: L.x - i * 14 }, { ...R, x: R.x + i * 14 }]); // run left, aim right
    await page.waitForTimeout(250);
    await page.evaluate(() => (__angles.length = 0));
    await page.waitForTimeout(1400); // two bow draws (0.5s each at level 1)
    const r = await page.evaluate(() => ({ angles: __angles.slice(), x: player.x, vx: player.vx, facing: player.facing }));
    await touch(cdp, "touchEnd", [L, R]);
    assert(r.angles.length >= 2 && r.angles.every((a) => Math.abs(a) < 15), "the twin-stick did not aim right under auto-fire: " + r.angles.map(Math.round).join(","));
    assert(r.x < x0 - 100 && r.vx < -200, "the left stick did not keep running left: " + JSON.stringify({ x0, ...r }));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("gamepad: menus by controller: start menu, loadout pick, Drop In, Y reroll and a level-up pick, pause and resume", async () => {
    const { context, page, problems } = await openPad();
    await silence(page);
    await page.evaluate(() => {
      settings.loadout = ["legs", "magnet"];
      applySettings();
    });
    await page.evaluate((spec) => __padPlug(0, spec), PAD_IDS.xbox);
    // Start menu: the focus starts on Start Game and moves with the D-pad
    const start = await padFocus(page);
    await padPress(page, "RIGHT");
    const right = await padFocus(page);
    await padPress(page, "LEFT");
    const back = await padFocus(page);
    const legend = await page.evaluate(() => document.querySelector(".pad-legend").textContent);
    await padPress(page, "A");
    await page.waitForSelector("#loadout:not([hidden])", { timeout: 2000 });
    // Loadout: up into the grid, find a card that isn't picked yet, pick it
    const onDrop = await padFocus(page);
    await padPress(page, "UP");
    let f = await padFocus(page);
    for (let i = 0; i < 8 && f.pressed === "true"; i++) {
      await padPress(page, "LEFT");
      f = await padFocus(page);
    }
    const card = await page.evaluate(() => [...loadoutGrid.children].indexOf(document.activeElement));
    await padPress(page, "A");
    const loadout = await page.evaluate(() => validLoadout());
    const want = await page.evaluate((i) => UPGRADES[i].id, card);
    // ...then down to Drop In
    // (steer toward wherever the Drop In button is laid out)
    for (let i = 0; i < 14; i++) {
      const dir = await page.evaluate(() => {
        const a = document.activeElement;
        const d = document.getElementById("drop-btn");
        if (a === d) return null;
        const ra = a.getBoundingClientRect();
        const rd = d.getBoundingClientRect();
        const dx = rd.x + rd.width / 2 - (ra.x + ra.width / 2);
        const dy = rd.y + rd.height / 2 - (ra.y + ra.height / 2);
        return Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? "DOWN" : "UP") : dx > 0 ? "RIGHT" : "LEFT";
      });
      if (!dir) break;
      await padPress(page, dir);
    }
    const toDrop = await padFocus(page);
    await padPress(page, "A");
    await page.waitForTimeout(100);
    const dropped = await page.evaluate(() => ({ state: game.state, loadout: document.getElementById("loadout").hidden }));
    await page.evaluate(() => {
      skipIntro();
      director.firstSpawn = 1e9;
      gainXp(xpForLevel(progress.level));
    });
    // Level-up: Y rerolls (like R), RIGHT + A installs the second card
    await page.waitForSelector("#levelup:not([hidden])", { timeout: 2000 });
    await page.waitForTimeout(400); // the anti-mash guard
    const rerolls = await page.evaluate(() => progress.rerolls);
    await padPress(page, "Y");
    const rerolled = await page.evaluate(() => progress.rerolls);
    const first = await page.evaluate(() => [...cardsEl.children].indexOf(document.activeElement));
    await padPress(page, "RIGHT");
    const choice = await page.evaluate(() => {
      const i = [...cardsEl.children].indexOf(document.activeElement);
      const c = currentChoices[i];
      return { i, id: c && c.id, lv: c ? lv(c.id) : -1 };
    });
    await padPress(page, "A");
    await page.waitForTimeout(700); // the install animation
    const installed = await page.evaluate((id) => ({ state: game.state, lv: lv(id) }), choice.id);
    // Start pauses and resumes; B resumes too
    await padPress(page, "START");
    const paused = await page.evaluate(() => ({ state: game.state, focus: document.activeElement.id, legend: document.querySelector(".pad-legend").textContent }));
    await padPress(page, "START");
    const resumed = await page.evaluate(() => game.state);
    await padPress(page, "START");
    await padPress(page, "B");
    const resumedB = await page.evaluate(() => game.state);
    assert(start.id === "overlay-btn", "focus did not start on Start Game: " + JSON.stringify(start));
    assert(right.id === "codex-btn" && right.ring === "solid", "RIGHT did not move a visible focus ring: " + JSON.stringify(right));
    assert(back.id === "overlay-btn", "LEFT did not come back: " + JSON.stringify(back));
    assert(legend.includes("SELECT") && legend.includes("DATABASE"), "no button legend: " + legend);
    assert(onDrop.id === "drop-btn", "loadout focus not on Drop In: " + JSON.stringify(onDrop));
    assert(card >= 0 && f.pressed === "false", "UP did not reach an unpicked loadout card: " + JSON.stringify(f));
    assert(loadout.length === 2 && loadout.includes(want), `A did not pick ${want}: ` + loadout.join());
    assert(toDrop.id === "drop-btn" && dropped.state === "playing" && dropped.loadout, "Drop In did not start the run: " + JSON.stringify(dropped));
    assert(rerolled === rerolls - 1, `Y did not reroll: ${rerolls} -> ${rerolled}`);
    assert(first === 0 && choice.i === 1, "RIGHT did not move to the second card: " + JSON.stringify({ first, choice }));
    assert(installed.state === "playing" && installed.lv > choice.lv, "A did not install the card: " + JSON.stringify({ choice, installed }));
    assert(paused.state === "paused" && paused.focus === "overlay-btn" && paused.legend.includes("RESUME"), "Start did not pause: " + JSON.stringify(paused));
    assert(resumed === "playing" && resumedB === "playing", `Start / B did not resume: ${resumed}, ${resumedB}`);
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("gamepad: button prompts and body classes for Xbox, DualSense and a generic pad (and its non-standard mapping); the keyboard takes them back", async () => {
    const { context, page, problems } = await openPad();
    const read = () =>
      page.evaluate(() => ({
        cls: ["pad-xbox", "pad-ps", "pad-generic", "pad-none"].filter((c) => document.body.classList.contains(c)).join(),
        labels: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "START", "BACK"].map((b) => padPrompt(b)),
        help: document.querySelector('#controls-help dt.pad-only[data-pad="A"]').textContent,
        helpShown: getComputedStyle(document.querySelector("#controls-help dt.pad-only")).display !== "none",
        kbShown: getComputedStyle(document.querySelector("#controls-help dt.kb-only")).display !== "none",
        hint: padHintRows() && padHintRows()[1][0],
      }));
    const before = await read();
    const kinds = [
      [{ id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)" }, "pad-xbox", "A B X Y LB RB LT RT MENU VIEW"],
      [{ id: "045e-02ea-Microsoft X-Box One S pad" }, "pad-xbox", "A B X Y LB RB LT RT MENU VIEW"],
      [PAD_IDS.dualsense, "pad-ps", "✕ ○ □ △ L1 R1 L2 R2 OPTIONS SHARE"],
      [{ id: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)" }, "pad-ps", "✕ ○ □ △ L1 R1 L2 R2 OPTIONS SHARE"],
      [PAD_IDS.generic, "pad-generic", "1 2 3 4 L1 R1 L2 R2 START SELECT"],
    ];
    const seen = [];
    for (const [spec, cls, labels] of kinds) {
      await page.evaluate((spec) => {
        __padUnplug(0);
        __padPlug(0, spec);
      }, spec);
      await padPress(page, "X");
      const r = await read();
      seen.push(r);
      assert(r.cls === cls && r.labels.join(" ") === labels, `${spec.id}: ` + JSON.stringify(r));
      assert(r.helpShown && !r.kbShown && r.help === labels.split(" ")[0] && r.hint === labels.split(" ")[0], `${spec.id}: help text not switched: ` + JSON.stringify(r));
    }
    // A non-standard pad: axes 0/1 run, 3/4 aim on a 6+ axis pad whose triggers
    // rest at -1 (axes 2 and 5), axes 6/7 are the D-pad
    const odd = await page.evaluate(() => {
      __padUnplug(0);
      __padPlug(0, { id: "Generic USB Joystick (Vendor: 0810 Product: 0001)", mapping: "", axes: [0, 0, -1, 0, 0, -1, 0, 0], buttons: 13 });
      gamepads.poll();
      __padButton(0, "X", 1);
      gamepads.poll();
      const rest = gamepads.read(0);
      __padAxes(0, [0.9, 0, -1, 0, -0.9, 1, 0, 0]);
      gamepads.poll();
      const moved = gamepads.read(0);
      __padAxes(0, [0, 0, -1, 0, 0, -1, -1, 0]);
      gamepads.poll();
      const dpad = gamepads.read(0);
      __padButton(0, "X", 0);
      __padAxes(0, [0, 0, -1, 0, 0, -1, 0, 0]);
      gamepads.poll();
      return { rest, moved, dpad };
    });
    // The keyboard takes the prompts back
    await page.keyboard.press("Shift");
    const kb = await read();
    assert(before.cls === "pad-none" && before.labels.every((l) => l === null) && before.hint === null, "prompts before any pad: " + JSON.stringify(before));
    assert(!odd.rest.held.LT && !odd.rest.held.RT && !odd.rest.aim.x && !odd.rest.aim.y, "resting triggers read as input: " + JSON.stringify(odd.rest));
    assert(odd.moved.move.x > 0.8 && odd.moved.aim.y < -0.8 && odd.moved.held.RT && !odd.moved.held.LT, "non-standard mapping: " + JSON.stringify(odd.moved));
    assert(odd.dpad.held.LEFT && odd.dpad.move.x === -1, "non-standard D-pad axes: " + JSON.stringify(odd.dpad));
    assert(kb.cls === "pad-none" && kb.kbShown && !kb.helpShown && kb.hint === null, "the keyboard did not take the prompts back: " + JSON.stringify(kb));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("gamepad: DATABASE tabs, respec, the hacking terminal and saving a leaderboard name all work with a controller", async () => {
    const { context, page, problems } = await openPad();
    await silence(page);
    await page.evaluate((spec) => __padPlug(0, spec), PAD_IDS.dualsense);
    // DATABASE: Back (SHARE) opens it, R1 / L1 switch tabs, ○ closes it
    await padPress(page, "BACK");
    await padPress(page, "RB");
    await padPress(page, "RB");
    await padPress(page, "LB");
    const codex = await page.evaluate(() => ({ open: !document.getElementById("codex").hidden, tab: codexTab, focus: document.activeElement.dataset.tab }));
    await padPress(page, "B");
    const codexClosed = await page.evaluate(() => ({ hidden: document.getElementById("codex").hidden, focus: document.activeElement.id }));
    // Respec from the pause menu, then cancel it
    await startRun(page, { settings: { character: "paine" } });
    await padPress(page, "START");
    for (let i = 0; i < 6 && (await padFocus(page)).id !== "respec-btn"; i++) await padPress(page, "RIGHT");
    await padPress(page, "A");
    const respec = await page.evaluate(() => ({ open: !document.getElementById("respec").hidden, focus: document.activeElement.id }));
    await padPress(page, "B");
    const respecClosed = await page.evaluate(() => ({ hidden: document.getElementById("respec").hidden, state: game.state }));
    await padPress(page, "START");
    // The hacking terminal: ✕ types and locks, the D-pad picks
    await page.evaluate(() => openBreach(terminals[0]));
    const stages = await playBreach(page, async (v) => {
      if (v.mode === "pick") {
        const want = v.stage === "payload" ? 2 : v.flagged; // OVERCLOCK, or the service with the CVE
        await padPress(page, v.cursor < want ? "DOWN" : v.cursor > want ? "UP" : "A");
      } else await padPress(page, "A");
    });
    const hacked = await page.evaluate(() => ({ state: game.state, jackin: runSecrets.has("jackin"), overdrive: player.overdrive }));
    // Game over: up to "Save score", ✕ saves the prefilled name, ○ closes the board
    await finishRun(page, { time: 75, kills: 9, level: 3 });
    await page.waitForTimeout(450);
    for (let i = 0; i < 8 && (await padFocus(page)).id !== "lb-save"; i++) await padPress(page, "UP");
    const onSave = await padFocus(page);
    await padPress(page, "A");
    const saved = await page.evaluate(() => ({ saved: lbRun && lbRun.saved, name: lbRun && lbRun.entry.name, board: !document.getElementById("leaderboard").hidden }));
    await padPress(page, "B");
    const boardClosed = await page.evaluate(() => ({ hidden: document.getElementById("leaderboard").hidden, state: game.state }));
    assert(codex.open && codex.tab === "enemies" && codex.focus === "enemies", "DATABASE tabs by pad: " + JSON.stringify(codex));
    assert(codexClosed.hidden && codexClosed.focus === "overlay-btn", "○ did not close the DATABASE (focus back where it was): " + JSON.stringify(codexClosed));
    assert(respec.open && respecClosed.hidden && respecClosed.state === "paused", "respec by pad: " + JSON.stringify({ respec, respecClosed }));
    for (const s of ["recon", "exploit", "crack", "root", "payload"]) assert(stages.has(s), `the hack never reached ${s}: ` + [...stages].join(","));
    assert(hacked.state === "playing" && hacked.jackin && hacked.overdrive > 5, "the hack did not finish by pad: " + JSON.stringify(hacked));
    assert(onSave.id === "lb-save", "could not reach Save score: " + JSON.stringify(onSave));
    assert(saved.saved && saved.name === "ANON-PAINE" && saved.board, "✕ did not save the prefilled name: " + JSON.stringify(saved));
    assert(boardClosed.hidden && boardClosed.state === "over", "○ did not close the leaderboard: " + JSON.stringify(boardClosed));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  // ---------------------------------------------------- Local co-op ----
  // Two mocked pads: pad 0 is player 1's (who also has the keyboard), pad 1
  // presses Start mid-run to join as player 2. step(n) polls the pads and runs
  // n frames in one go, so nothing depends on real time.
  const COOP_HELPERS = () => {
    window.__t = 20000;
    window.step = (n = 1) => {
      for (let i = 0; i < n && game.state !== "over"; i++) {
        gamepads.poll((__t += 1000 / 60));
        if (game.state === "playing") update(1 / 60);
      }
    };
    window.press = (pad, b) => {
      __padButton(pad, b, 1);
      step(1);
      __padButton(pad, b, 0);
      step(1);
    };
    window.P = (i) => coop.players[i] && coop.players[i].player;
    // the HUD's text, for one frame
    window.hudTexts = () => {
      const texts = [];
      const h = hudText;
      hudText = function (t) {
        texts.push(String(t));
        return h.apply(this, arguments);
      };
      try {
        render(performance.now() / 1000);
      } finally {
        hudText = h;
      }
      return texts;
    };
  };
  async function coopRun(opts = {}) {
    const { context, page, problems } = await openPad();
    await startRun(page, { settings: { character: opts.p1 || "paine", autoFire: false, autoFlame: false } });
    await page.evaluate(COOP_HELPERS);
    const joined = await page.evaluate(
      ([xbox, ds, p2]) => {
        __padPlug(0, xbox);
        __padPlug(1, ds);
        press(0, "X"); // pad 0 becomes player 1's
        press(1, "START"); // pad 1 asks to join: player 2's join panel
        const ctx = coop.players[1];
        const panel = { n: coop.players.length, joining: !!(ctx && ctx.joining), char: ctx && ctx.joining && ctx.joining.char, hidden: !!(ctx && ctx.player.hidden), texts: hudTexts().filter((t) => /PLAYER 2|DROP IN/.test(t)) };
        for (let i = 0; i < 3 && p2 && ctx.joining.char !== p2; i++) press(1, "RIGHT"); // pick an IC
        press(1, "A"); // drop in
        step(150); // the drop and the hero landing
        return panel;
      },
      [PAD_IDS.xbox, PAD_IDS.dualsense, opts.p2 || null]
    );
    return { context, page, problems, joined };
  }

  await test("co-op: a second pad joins mid-run (join panel, its own IC, the drop next to player 1), or on the menu to drop in with player 1; Pad to P2 hands a lone pad over", async () => {
    const { context, page, problems, joined } = await coopRun({ p2: "sudo" });
    const r = await page.evaluate(() => {
      const [a, b] = [P(0), P(1)];
      const texts = hudTexts();
      return {
        n: coop.players.length,
        slots: gamepads.slots.slice(),
        read: gamepads.read(1) && gamepads.read(1).name,
        p1: a.char,
        p2: b.char,
        seat: coop.seat && coop.seat.char,
        landed: !b.hidden && b.onGround && !coop.players[1].intro.active,
        dx: Math.abs(b.x - a.x),
        full: b.hp === coop.players[1].stats.maxHp,
        bound: player === a && input === mainInput && stats === coop.players[0].stats,
        coopRun: game.coopRun,
        hud: texts.filter((t) => /^P[12]\b/.test(t)),
        p1name: CHARACTERS.paine.name,
        p2name: CHARACTERS.sudo.name,
      };
    });
    assert(joined.n === 2 && joined.joining && joined.hidden && joined.char && joined.char !== "paine", "no join panel (with an IC other than player 1's): " + JSON.stringify(joined));
    assert(joined.texts.length >= 2, "the join panel is not drawn: " + JSON.stringify(joined.texts));
    assert(r.n === 2 && r.slots[0] === 0 && r.slots[1] === 1 && r.read === "DualSense", "player 2 is not on pad 1: " + JSON.stringify(r));
    assert(r.p1 === "paine" && r.p2 === "sudo" && r.seat === "sudo", "player 2's IC pick: " + JSON.stringify(r));
    assert(r.landed && r.full && r.dx < 400, "player 2 did not drop in next to player 1: " + JSON.stringify(r));
    assert(r.bound && r.coopRun, "the globals are not player 1's outside the per-player systems: " + JSON.stringify(r));
    assert(r.hud.includes("P1") && r.hud.includes("P2") && r.hud.includes(`P2 ${r.p2name}`) && r.hud.some((t) => t.startsWith(`P1 ${r.p1name}`)), "HUD tags / P2 panel missing: " + JSON.stringify(r.hud));
    assert(!problems.length, problems.join("; "));
    await context.close();

    // On the menu: player 2 is ready, then drops in with player 1
    const m = await openPad();
    await m.page.evaluate(COOP_HELPERS);
    const menu = await m.page.evaluate(
      ([xbox, ds]) => {
        __padPlug(0, xbox);
        __padPlug(1, ds);
        press(0, "X");
        press(1, "START");
        return { state: game.state, n: coop.players.length, seat: coop.seat && coop.seat.char, toast: document.querySelector(".pad-toast").textContent, badge: document.querySelectorAll(".char-card .char-p2").length, leave: !document.getElementById("coop-leave-btn").hidden };
      },
      [PAD_IDS.xbox, PAD_IDS.dualsense]
    );
    await startRun(m.page);
    const start = await m.page.evaluate(() => {
      const c = coop.players[1];
      const out = { n: coop.players.length, kind: c && c.intro.kind, active: c && c.intro.active, p1: P(0).char, p2: c && c.player.char };
      step(200);
      out.landed = c.player.onGround && !c.intro.active && !c.player.hidden;
      out.dx = Math.abs(c.player.x - P(0).x);
      out.leash = COOP.leashX;
      return out;
    });
    assert(menu.state === "menu" && menu.n === 1 && menu.seat === "tetsu" && /PLAYER 2 READY/.test(menu.toast), "joining on the menu: " + JSON.stringify(menu));
    assert(menu.badge === 1 && menu.leave, "no P2 badge / Leave button on the menu: " + JSON.stringify(menu));
    assert(start.n === 2 && start.kind === "drop" && start.active && start.p1 === "paine" && start.p2 === "tetsu", "player 2 did not drop in with player 1: " + JSON.stringify(start));
    assert(start.landed && start.dx < start.leash, "player 2's drop: " + JSON.stringify(start));
    assert(!m.problems.length, m.problems.join("; "));
    await m.context.close();

    // Keyboard player 1 with one pad: Pad to P2 (pause menu) gives it to player 2
    const k = await openPad();
    await startRun(k.page);
    await k.page.evaluate(COOP_HELPERS);
    const hand = await k.page.evaluate((xbox) => {
      __padPlug(0, xbox);
      press(0, "X"); // the lone pad: player 1's at first
      pauseGame();
      step(1);
      const btn = document.getElementById("coop-join-btn");
      const out = { shown: !btn.hidden };
      btn.click();
      resumeGame();
      step(2);
      out.slots = gamepads.slots.slice();
      out.joining = !!(coop.players[1] && coop.players[1].joining);
      out.device = gamepads.device;
      press(0, "A");
      step(150);
      out.landed = !!coop.players[1] && !coop.players[1].player.hidden && coop.players[1].player.onGround;
      return out;
    }, PAD_IDS.xbox);
    assert(hand.shown && hand.slots[0] === null && hand.slots[1] === 0 && hand.joining && hand.device === "none" && hand.landed, "Pad to P2: " + JSON.stringify(hand));
    assert(!k.problems.length, k.problems.join("; "));
    await k.context.close();
  });

  await test("co-op: both players move, aim and fight independently (keyboard vs pad 2), each with their own IC, projectiles and resource; the camera keeps both on screen", async () => {
    const { context, page, problems } = await coopRun({ p2: "tetsu" });
    const r = await page.evaluate(() => {
      const [c1, c2] = coop.players;
      const [a, b] = [c1.player, c2.player];
      const swings = [];
      const arrows = [];
      const bs = bladeSwing;
      bladeSwing = function () {
        swings.push(coop.active.id);
        return bs.apply(this, arguments);
      };
      const fz = fireZap;
      fireZap = function () {
        const n = [c1.shots.length, c2.shots.length];
        const ret = fz.apply(this, arguments);
        arrows.push({ by: coop.active.id, into1: c1.shots.length - n[0], into2: c2.shots.length - n[1] }); // whose projectile list got them
        return ret;
      };
      Object.assign(a, { x: 2000, y: GROUND_Y - a.h, vx: 0 });
      Object.assign(b, { x: 2600, y: GROUND_Y - b.h, vx: 0 });
      step(2);
      const x1 = a.x;
      const x2 = b.x;
      input.keys.add("KeyA"); // player 1 runs left on the keyboard
      __padAxes(1, [1, 0, 0, 0]); // player 2 runs right on pad 2
      step(40);
      const out = { ran1: a.x - x1, ran2: b.x - x2, f1: a.facing, f2: b.facing, pad1: input.pad.x };
      // keep running apart: the leash holds them a screen apart and the camera frames both
      step(240);
      out.leash = { gap: Math.abs(centerOf(b).x - centerOf(a).x), max: COOP.leashX, seen: onScreen(a) && onScreen(b) };
      input.keys.delete("KeyA");
      __padAxes(1, [0, 0, 0, 0]);
      step(30);
      // player 2's blade (RT) cuts an enemy next to them; player 1's bow (J) fires
      const e = spawnEnemy("crawler", b.x + 70, GROUND_Y - ENEMY_TYPES.crawler.h, { elite: false });
      Object.assign(e, { hp: 1e6, maxHp: 1e6, stun: 999 });
      input.keys.add("KeyJ");
      __padButton(1, "RT", 1);
      step(45);
      input.keys.delete("KeyJ");
      __padButton(1, "RT", 0);
      out.cut = 1e6 - e.hp;
      out.swings = swings.slice();
      out.arrows = arrows.slice();
      // player 2's dash (LT) spends player 2's focus only
      a.heat = b.heat = 100;
      press(1, "LT");
      out.heat = { p1: a.heat, p2: b.heat, dash: !!b.dash || b.guard > 0 };
      return out;
    });
    assert(r.ran1 < -100 && r.ran2 > 100 && r.f1 === -1 && r.f2 === 1, "the players did not run their own ways: " + JSON.stringify(r));
    assert(r.pad1 === 0, "pad 2 moved player 1: " + JSON.stringify(r));
    assert(r.leash.gap <= r.leash.max + 1 && r.leash.gap > r.leash.max - 100 && r.leash.seen, "the leash / camera did not keep both on screen: " + JSON.stringify(r.leash));
    assert(r.swings.length > 0 && r.swings.every((id) => id === 1) && r.cut > 0, "player 2's blade: " + JSON.stringify(r));
    assert(r.arrows.length > 0 && r.arrows.every((s) => s.by === 0 && s.into1 > 0 && s.into2 === 0), "player 1's arrows (into player 1's projectiles only): " + JSON.stringify(r));
    assert(r.heat.p1 === 100 && r.heat.p2 < 100 && r.heat.dash, "player 2's dash / resource: " + JSON.stringify(r.heat));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("co-op: enemies go after the nearest player (minions, their shots, and a downed player is ignored)", async () => {
    const { context, page, problems } = await coopRun({ p2: "tetsu" });
    const r = await page.evaluate(() => {
      const [c1, c2] = coop.players;
      const [a, b] = [c1.player, c2.player];
      Object.assign(a, { x: 1000, y: GROUND_Y - a.h, vx: 0 });
      Object.assign(b, { x: 2500, y: GROUND_Y - b.h, vx: 0 });
      a.invuln = b.invuln = 99;
      step(1);
      const walker = (x) => Object.assign(spawnEnemy("crawler", x, GROUND_Y - ENEMY_TYPES.crawler.h, { elite: false }), { hp: 1e6, maxHp: 1e6 });
      const near2 = walker(2200);
      const near1 = walker(1300);
      const drone = Object.assign(spawnEnemy("drone", 2350, GROUND_Y - 600, { elite: false }), { hp: 1e6, maxHp: 1e6, shotCd: 99 });
      const x2 = near2.x;
      const x1 = near1.x;
      step(30);
      const out = { t2: near2.coopTarget === c2, t1: near1.coopTarget === c1, td: drone.coopTarget === c2, m2: near2.x - x2, m1: near1.x - x1 };
      // the drone fires at its own target
      enemyShots.length = 0;
      drone.shotCd = 0;
      for (let i = 0; i < 90 && !enemyShots.length; i++) step(1);
      const s = enemyShots[0];
      const aimAt = (p) => Math.abs(angleDiff(Math.atan2(centerOf(p).y - s.y, centerOf(p).x - s.x), s.angle));
      out.shot = s ? { atP2: aimAt(b), atP1: aimAt(a) } : null;
      // player 2 goes down: everything turns on player 1 while they respawn
      b.invuln = 0;
      b.hp = 0;
      step(5);
      out.down = { hidden: b.hidden, near2: near2.coopTarget === c1, drone: drone.coopTarget === c1 };
      return out;
    });
    assert(r.t2 && r.t1 && r.td, "targets are not the nearest players: " + JSON.stringify(r));
    assert(r.m2 > 20 && r.m1 < -20, "walkers did not head for their targets: " + JSON.stringify(r));
    assert(r.shot && r.shot.atP2 < 0.25 && r.shot.atP1 > 0.5, "the drone's shot did not aim at player 2: " + JSON.stringify(r.shot));
    assert(r.down.hidden && r.down.near2 && r.down.drone, "enemies kept chasing a downed player: " + JSON.stringify(r.down));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("co-op: the v3.2 enemies: a 429 field throttles only the player standing in it (P2's banner), a packet lands on the player it was aimed at", async () => {
    const { context, page, problems } = await coopRun({ p2: "tetsu" });
    const r = await page.evaluate(() => {
      const [c1, c2] = coop.players;
      const [a, b] = [c1.player, c2.player];
      Object.assign(a, { x: 1000, y: GROUND_Y - a.h, vx: 0 });
      Object.assign(b, { x: 2400, y: GROUND_Y - b.h, vx: 0 });
      a.invuln = b.invuln = 99;
      step(1);
      const rl = spawnEnemy("ratelimiter", 2600, GROUND_Y - 150, { elite: false });
      rl.pulseCd = 99;
      for (let i = 0; i < 60; i++) {
        rl.x = 2600;
        rl.vx = 0;
        step(1);
      }
      const out = { p1: a.throttleT > 0, p2: b.throttleT > 0, banner: hudTexts().some((t) => /P2 429 THROTTLED/.test(t)) };
      rl.dead = true;
      step(20);
      // a packet aimed at player 2 comes down on player 2 only
      const l = spawnEnemy("lobber", 2950, GROUND_Y - 74, { elite: false });
      l.shotCd = 99;
      lobberPlant(l, b);
      a.invuln = b.invuln = 0;
      const ha = a.hp;
      const hb = b.hp;
      for (let i = 0; i < 60 * 3 && enemyShots.some((s) => s.kind === "packet"); i++) {
        l.x = 2950;
        step(1);
      }
      out.packet = { p2: b.hp < hb, p1: a.hp === ha, released: !(b.throttleT > 0) };
      return out;
    });
    assert(!r.p1 && r.p2 && r.banner, "the field should throttle player 2 only: " + JSON.stringify(r));
    assert(r.packet.p2 && r.packet.p1 && r.packet.released, "the packet: " + JSON.stringify(r.packet));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("co-op: a walker climbs toward the nearer player's floor; camo blinds walkers (no climbing) and flyers (no shots)", async () => {
    const { context, page, problems } = await coopRun({ p2: "tetsu" });
    const r = await page.evaluate(() => {
      const [c1, c2] = coop.players;
      const [a, b] = [c1.player, c2.player];
      const roof = platforms[18]; // (900, 320): close enough that the co-op leash leaves them be
      const hold = () => {
        Object.assign(a, { x: roof.x + roof.w / 2 - a.w / 2, y: roof.y - a.h, vx: 0, vy: 0, onGround: true, standingOn: roof, invuln: 99 });
        Object.assign(b, { x: 2400, y: GROUND_Y - b.h, vx: 0, vy: 0, onGround: true, standingOn: GROUND, invuln: 99 });
      };
      hold();
      step(1);
      const walker = (x) => Object.assign(spawnEnemy("crawler", x, GROUND_Y - ENEMY_TYPES.crawler.h, { elite: false }), { hp: 1e6, maxHp: 1e6 });
      const near2 = walker(2200); // right next to player 2 on the street
      const under1 = walker(roof.x + 100); // under player 1's rooftop
      let up = -1;
      for (let i = 0; i < 60 * 25 && up < 0; i++) {
        hold();
        step(1);
        if (under1.onGround && under1.standingOn === roof) up = i / 60;
      }
      const out = { t2: near2.coopTarget === c2, goal2: near2.nav.goal, t1: under1.coopTarget === c1, up: Math.round(up * 10) / 10 };
      // camo on player 1: the walker on the street below loses them and stops climbing
      under1.dead = true;
      const blind = walker(roof.x + 60);
      const drone = Object.assign(spawnEnemy("drone", roof.x + 300, roof.y - 300, { elite: false }), { hp: 1e6, maxHp: 1e6, shotCd: 0 });
      enemyShots.length = 0;
      a.camo = 30;
      hold();
      step(1);
      // (checked now: a blinded walker wanders, and a long random wander can
      // legitimately bring it nearer to player 2, who it then targets)
      const target = blind.coopTarget === c1;
      for (let i = 0; i < 60 * 4; i++) {
        hold();
        step(1);
      }
      out.camo = { target, moves: blind.nav ? blind.nav.jumps : 0, floor: navNodeOf(blind.standingOn), shots: enemyShots.filter((s) => s.owner === drone).length };
      a.camo = 0;
      return out;
    });
    assert(r.t2 && r.goal2 === 0 && r.t1, "walkers did not pick the nearer player: " + JSON.stringify(r));
    assert(r.up >= 0, "the walker never climbed to player 1's rooftop: " + JSON.stringify(r));
    assert(r.camo.target && r.camo.moves === 0 && r.camo.floor === 0 && r.camo.shots === 0, "camo did not blind them: " + JSON.stringify(r.camo));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("co-op: player 2's Hackerman hijacks too, the cap is shared, and pawns never hurt either player", async () => {
    const { context, page, problems } = await coopRun({ p1: "paine", p2: "sudo" });
    await page.evaluate(HIJACK_HELPERS);
    const r = await page.evaluate(() => {
      const [c1, c2] = coop.players;
      const [a, b] = [c1.player, c2.player];
      Object.assign(a, { x: 1000, y: GROUND_Y - a.h, vx: 0 });
      Object.assign(b, { x: 1300, y: GROUND_Y - b.h, vx: 0 });
      step(1);
      [1100, 1250, 1400, 1550, 1700].forEach((x) => __mob("crawler", x));
      const first = withPlayer(c2, () => __burst(1300, 960, 700, 0));
      for (let i = 0; i < 5; i++) withPlayer(i % 2 ? c1 : c2, () => __burst(1300, 960, 700, 0));
      const pawns = enemies.filter(isHijacked);
      // the rest leave; the pawns (with nobody to fight) stick to you: no damage either way
      enemies.forEach((e) => !isHijacked(e) && (e.dead = true));
      a.invuln = b.invuln = 0;
      const h = [a.hp, b.hp];
      pawns.forEach((e, i) => Object.assign(e, { x: (i % 2 ? b : a).x, hitCd: 0 }));
      step(40);
      return { first, pawns: pawns.length, cap: hijackCap(), hurt: [h[0] - a.hp, h[1] - b.hp] };
    });
    assert(r.first === 1 && r.pawns === r.cap && r.cap === 2, "co-op hijacks / shared cap: " + JSON.stringify(r));
    assert(r.hurt[0] === 0 && r.hurt[1] === 0, "a hijacked enemy hurt a player: " + JSON.stringify(r));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("co-op: shots, contact and bomber blasts hit the right player; Ronin reflects, Hackerman's Time Dilation and Widow's Flame On work per player", async () => {
    const { context, page, problems } = await coopRun({ p1: "paine", p2: "tetsu" });
    const r = await page.evaluate(() => {
      const [c1, c2] = coop.players;
      const [a, b] = [c1.player, c2.player];
      Object.assign(a, { x: 1000, y: GROUND_Y - a.h, vx: 0 });
      Object.assign(b, { x: 2000, y: GROUND_Y - b.h, vx: 0 });
      step(1);
      const shooter = () => Object.assign(spawnEnemy("drone", 3200, GROUND_Y - 700, { elite: false }), { hp: 1000, maxHp: 1000, stun: 999, shotCd: 99 });
      const shootAt = (p, src) => {
        const c = centerOf(p);
        enemyShots.push({ x: c.x, y: c.y, vx: 0, vy: 0, r: 14, damage: 20, kind: "laser", angle: 0, life: 4, owner: src });
      };
      const out = {};
      // a shot at player 2 (Ronin): player 2 takes it and reflects part of it
      let src = shooter();
      a.invuln = b.invuln = 0;
      let h1 = a.hp;
      let h2 = b.hp;
      shootAt(b, src);
      step(1);
      out.atP2 = { d1: h1 - a.hp, d2: h2 - b.hp, left: enemyShots.length, reflected: 1000 - src.hp, fx2: c2.kitFx.some((f) => f.type === "reflect"), fx1: c1.kitFx.length };
      // a shot at player 1 (Widow): no reflection
      src = shooter();
      a.invuln = b.invuln = 0;
      h1 = a.hp;
      h2 = b.hp;
      shootAt(a, src);
      step(1);
      out.atP1 = { d1: h1 - a.hp, d2: h2 - b.hp, reflected: 1000 - src.hp };
      // a crawler touching only player 2
      a.invuln = b.invuln = 0;
      h1 = a.hp;
      h2 = b.hp;
      const brute = Object.assign(spawnEnemy("crawler", b.x, GROUND_Y - ENEMY_TYPES.crawler.h, { elite: false }), { hp: 1e6, maxHp: 1e6 });
      step(2);
      out.contact = { d1: h1 - a.hp, d2: h2 - b.hp };
      brute.dead = true;
      // a bomber going off next to player 1 only
      a.invuln = b.invuln = 0;
      h1 = a.hp;
      h2 = b.hp;
      const bomb = spawnEnemy("bomber", a.x, a.y + 20, { elite: false });
      explodeBomber(bomb);
      out.blast = { d1: h1 - a.hp, d2: h2 - b.hp };
      // Widow's Flame On (player 1's K) rolls out from player 1
      a.heat = 100;
      input.keys.add("KeyK");
      step(2);
      input.keys.delete("KeyK");
      out.flame = { p1: c1.heatWaves.length, p2: c2.heatWaves.length };
      return out;
    });
    assert(r.atP2.d1 === 0 && r.atP2.d2 > 0 && r.atP2.left === 0, "the shot at player 2 hit the wrong player: " + JSON.stringify(r.atP2));
    assert(r.atP2.reflected > 0 && r.atP2.fx2 && r.atP2.fx1 === 0, "Ronin (player 2) did not reflect: " + JSON.stringify(r.atP2));
    assert(r.atP1.d1 > 0 && r.atP1.d2 === 0 && r.atP1.reflected === 0, "the shot at player 1: " + JSON.stringify(r.atP1));
    assert(r.contact.d1 === 0 && r.contact.d2 > 0, "contact damage: " + JSON.stringify(r.contact));
    assert(r.blast.d1 > 0 && r.blast.d2 === 0, "bomber blast: " + JSON.stringify(r.blast));
    assert(r.flame.p1 > 0 && r.flame.p2 === 0, "Flame On is not player 1's: " + JSON.stringify(r.flame));
    assert(!problems.length, problems.join("; "));
    await context.close();

    // Hackerman as player 2: Time Dilation slows the enemies for both, but only his hits get the bonus
    const h = await coopRun({ p1: "paine", p2: "sudo" });
    const d = await h.page.evaluate(() => {
      const [c1, c2] = coop.players;
      const [a, b] = [c1.player, c2.player];
      const before = enemyTimeScale();
      b.heat = 100;
      press(1, "LT");
      const out = { before, after: enemyTimeScale(), p2: b.dilation > 0, p1: !(a.dilation > 0) };
      const dummy = () => Object.assign(spawnEnemy("crawler", 3000, GROUND_Y - ENEMY_TYPES.crawler.h, { elite: false }), { hp: 1000, maxHp: 1000, stun: 999 });
      const t1 = dummy();
      const t2 = dummy();
      withPlayer(c1, () => damageEnemy(t1, 10, { source: "zap" }));
      withPlayer(c2, () => damageEnemy(t2, 10, { source: "zap" }));
      out.hits = { p1: 1000 - t1.hp, p2: 1000 - t2.hp, mul: c2.stats.dilation.dmgMul };
      return out;
    });
    assert(d.before === 1 && d.after < 0.5 && d.p2 && d.p1, "Time Dilation by player 2: " + JSON.stringify(d));
    assert(d.hits.p1 === 10 && Math.abs(d.hits.p2 - 10 * d.hits.mul) < 1e-6, "the dilation damage bonus is not player 2's alone: " + JSON.stringify(d.hits));
    assert(!h.problems.length, h.problems.join("; "));
    await h.context.close();
  });

  await test("co-op: player 2 can't leave while out of lives and re-join at full HP for free; the re-join waits for a life and spends it", async () => {
    const { context, page, problems } = await coopRun({ p2: "tetsu" });
    const r = await page.evaluate(() => {
      const out = {};
      game.lives = 1; // no spare life
      const b = P(1);
      b.invuln = 0;
      b.hp = 0;
      step(2);
      out.knocked = { out: coop.players[1].out, lives: game.lives };
      coopLeave();
      out.left = coop.players.length;
      press(1, "START"); // the same pad asks to join again
      press(1, "A"); // drop in
      step(150);
      const c2 = coop.players[1];
      out.rejoined = { n: coop.players.length, out: !!(c2 && c2.out), hidden: !!(c2 && c2.player.hidden), lives: game.lives, banner: game.banner && game.banner.text };
      game.lives++; // a life comes back: player 2 drops in on it
      step(2);
      out.revived = { out: c2.out, lives: game.lives, intro: c2.intro.active };
      return out;
    });
    assert(r.knocked.out && r.knocked.lives === 1, "player 2 was not knocked out: " + JSON.stringify(r.knocked));
    assert(r.left === 1, "player 2 did not leave: " + r.left);
    assert(r.rejoined.n === 2 && r.rejoined.out && r.rejoined.hidden && r.rejoined.lives === 1 && /STILL OUT/.test(r.rejoined.banner), "a re-join while out came back for free: " + JSON.stringify(r.rejoined));
    assert(!r.revived.out && r.revived.lives === 1 && r.revived.intro, "player 2 did not come back on the next life: " + JSON.stringify(r.revived));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("co-op: damage, deaths and respawns spend the shared lives; a player with no life left is out until one comes back; game over only when both are down", async () => {
    const { context, page, problems } = await coopRun({ p2: "tetsu" });
    const r = await page.evaluate(() => {
      const [c1, c2] = coop.players;
      const [a, b] = [c1.player, c2.player];
      const wait = () => step(Math.round(COOP.respawnDelay * 60) + 150);
      const out = { lives0: game.lives };
      b.invuln = 0;
      b.hp = 0;
      step(2);
      out.p2down = { lives: game.lives, lost: game.livesLost, intro: c2.intro.active, hidden: b.hidden, p1ok: !a.hidden && a.hp > 0, state: game.state, status: coopStatus(c2), banner: game.banner && game.banner.text };
      wait();
      out.p2back = { hidden: b.hidden, intro: c2.intro.active, full: b.hp === c2.stats.maxHp, ground: b.onGround, dx: Math.abs(b.x - a.x) };
      a.invuln = 0;
      a.hp = 0;
      step(1);
      out.p1down = { lives: game.lives, intro: c1.intro.active, p2ok: !b.hidden };
      wait();
      // no spare life left: player 2 is out, player 1 fights on
      b.invuln = 0;
      b.hp = 0;
      step(2);
      out.out = { out: c2.out, hidden: b.hidden, state: game.state, lives: game.lives, status: coopStatus(c2) };
      const e = Object.assign(spawnEnemy("crawler", b.x + 10, GROUND_Y - ENEMY_TYPES.crawler.h, { elite: false }), { hp: 1e6, maxHp: 1e6 });
      step(5);
      out.ignored = e.coopTarget === c1;
      e.dead = true;
      // a life comes back (NULL's reward): player 2 drops back in on it
      game.lives++;
      step(2);
      out.revived = { out: c2.out, intro: c2.intro.active, lives: game.lives };
      wait();
      // both down with no spare life: game over
      a.invuln = b.invuln = 0;
      b.hp = 0;
      step(1);
      out.lastOut = { out: c2.out, state: game.state };
      a.hp = 0;
      step(1);
      out.over = { state: game.state, lives: game.lives, coop: !!(lbRun && lbRun.entry.coop) };
      return out;
    });
    assert(r.lives0 === 3, "lives: " + JSON.stringify(r));
    assert(r.p2down.lives === 2 && r.p2down.lost === 1 && r.p2down.intro && r.p2down.hidden && r.p2down.p1ok && r.p2down.state === "playing", "player 2 down: " + JSON.stringify(r.p2down));
    assert(/^RESPAWN/.test(r.p2down.status) && /P2 DOWN/.test(r.p2down.banner), "respawn status / banner: " + JSON.stringify(r.p2down));
    assert(!r.p2back.hidden && !r.p2back.intro && r.p2back.full && r.p2back.ground && r.p2back.dx < 400, "player 2 did not drop back in: " + JSON.stringify(r.p2back));
    assert(r.p1down.lives === 1 && r.p1down.intro && r.p1down.p2ok, "player 1 down: " + JSON.stringify(r.p1down));
    assert(r.out.out && r.out.hidden && r.out.state === "playing" && r.out.lives === 1 && /OUT/.test(r.out.status), "player 2 is not out (or the run ended): " + JSON.stringify(r.out));
    assert(r.ignored, "an enemy went after the out player");
    assert(!r.revived.out && r.revived.intro && r.revived.lives === 1, "player 2 did not come back on the new life: " + JSON.stringify(r.revived));
    assert(r.lastOut.out && r.lastOut.state === "playing", "player 2's last life: " + JSON.stringify(r.lastOut));
    assert(r.over.state === "over" && r.over.lives === 0 && r.over.coop, "game over (marked 2P) when both are down: " + JSON.stringify(r.over));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("co-op: one shared level-up; player 2's pad rerolls and picks, and the upgrade (and its heal) applies to both", async () => {
    const { context, page, problems } = await coopRun({ p2: "tetsu" });
    const before = await page.evaluate(() => {
      forEachPlayer(() => (player.hp = 40));
      gainXp(xpForLevel(progress.level));
      step(1);
      const out = { state: game.state, level: progress.level, max: coop.players.map((c) => c.stats.maxHp), rerolls: progress.rerolls };
      press(1, "Y"); // reroll with player 2's pad
      out.rerolled = progress.rerolls;
      currentChoices = ["heart", "orbit", "chain"].map((id) => ({ id, u: UPGRADES.find((u) => u.id === id), rare: false }));
      renderCards();
      levelUpShownAt = -1e9;
      cardsEl.firstElementChild.focus();
      press(1, "A"); // install the first card (Cyber Heart) with player 2's pad
      return out;
    });
    await page.waitForFunction(() => game.state === "playing", null, { timeout: 3000 });
    const after = await page.evaluate(() => ({ heart: upg.heart || 0, max: coop.players.map((c) => c.stats.maxHp), hp: coop.players.map((c) => c.player.hp), heal: LEVEL_UP_HEAL, level: progress.level }));
    assert(before.state === "levelup" && before.level === 2, "no level-up: " + JSON.stringify(before));
    assert(before.rerolled === before.rerolls - 1, "player 2's pad did not reroll: " + JSON.stringify(before));
    assert(after.heart === 1 && after.max[0] === before.max[0] + 20 && after.max[1] === before.max[1] + 20, "the upgrade did not apply to both: " + JSON.stringify({ before, after }));
    assert(after.hp.every((hp) => hp === 40 + 20 + after.heal), "both players were not healed: " + JSON.stringify(after));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("co-op: boss fights with two players: tougher bosses, both can hurt them, either can be hit, and the run goes Overseer > NULL > GOAT to a win", async () => {
    const { context, page, problems } = await coopRun({ p2: "tetsu" });
    const r = await page.evaluate(() => {
      const [c1, c2] = coop.players;
      const [a, b] = [c1.player, c2.player];
      settings.autoFire = true;
      settings.autoFlame = true;
      const keepAlive = () => forEachPlayer(() => (player.hp = Math.max(player.hp, 90)));
      const fight = (seconds) => {
        for (let i = 0; i < seconds * 60 && game.state !== "over"; i++) {
          keepAlive();
          if (game.state === "levelup") chooseUpgrade(0, true);
          step(1);
        }
      };
      Object.assign(a, { x: 1400, y: GROUND_Y - a.h });
      Object.assign(b, { x: 2200, y: GROUND_Y - b.h });
      step(1);
      spawnOverseer();
      const boss = game.boss;
      const out = { mul: COOP.bossHp, overseer: { max: boss.maxHp, base: BOSSES.overseer.hp } };
      game.cinematic = null; // skip the entrance
      const dealt = { 0: 0, 1: 0 };
      const de = damageEnemy;
      damageEnemy = function (e, amount) {
        if (e === boss && !e.dead && amount > 0) dealt[coop.active.id] += amount;
        return de.apply(this, arguments);
      };
      fight(10);
      damageEnemy = de;
      out.overseer.dealt = dealt;
      out.overseer.targets = [boss.coopTarget === c1, boss.coopTarget === c2];
      // a shockwave rolling under player 2 hits player 2 only
      boss.stun = 999;
      Object.assign(boss, { x: 4200, vx: 0 });
      Object.assign(a, { x: 1400, y: GROUND_Y - a.h, vx: 0, vy: 0 });
      Object.assign(b, { x: 2200, y: GROUND_Y - b.h, vx: 0, vy: 0 });
      step(1);
      shockwaves.length = 0;
      enemyShots.length = 0;
      a.invuln = b.invuln = 0;
      let h1 = a.hp;
      let h2 = b.hp;
      spawnShockwave(b.x + b.w / 2 + 20, GROUND_Y, -1, { damage: 14 });
      step(3);
      out.wave = { d1: h1 - a.hp, d2: h2 - b.hp };
      // touching it hurts player 1 when it's player 1 touching it
      Object.assign(boss, { x: a.x - 20, y: a.y + a.h - boss.h });
      a.invuln = b.invuln = 0;
      h1 = a.hp;
      h2 = b.hp;
      boss.contactCd = 0;
      bossContact(boss, 26);
      out.contact = { d1: h1 - a.hp, d2: h2 - b.hp };
      // down it: both get the +30 HP
      a.hp = b.hp = 50;
      boss.stun = 0;
      damageEnemy(boss, boss.hp + 1, { source: "test" });
      out.heal = [a.hp, b.hp];
      // NULL, then the GOAT, with two players
      director.nextBossAt = game.time;
      step(2);
      const n = game.boss;
      out.null = { type: n && n.type, max: n && n.maxHp, base: BOSSES.nullptr.hp };
      game.cinematic = null;
      fight(8);
      killEnemy(n);
      fight(2.5);
      director.nextBossAt = game.time;
      step(2);
      const g = game.boss;
      out.goat = { type: g && g.type, max: g && g.maxHp, base: BOSSES.goat.hp };
      game.cinematic = null;
      const g0 = g.hp;
      fight(8);
      out.goat.dealt = g0 - g.hp;
      g.hp = 1;
      damageEnemy(g, 10, { source: "test" });
      fight(3);
      out.end = { state: game.state, won: game.won, bosses: game.bossesDefeated };
      return out;
    });
    assert(r.mul > 1 && Math.abs(r.overseer.max - r.overseer.base * r.mul) < 1e-6, "the Overseer's HP is not scaled for two: " + JSON.stringify(r));
    assert(r.overseer.dealt[0] > 0 && r.overseer.dealt[1] > 0, "both players did not damage the Overseer: " + JSON.stringify(r.overseer));
    assert(r.overseer.targets.some(Boolean), "the boss has no player target: " + JSON.stringify(r.overseer));
    assert(r.wave.d1 === 0 && r.wave.d2 > 0, "the shockwave: " + JSON.stringify(r.wave));
    assert(r.contact.d1 > 0 && r.contact.d2 === 0, "boss contact: " + JSON.stringify(r.contact));
    assert(r.heal[0] === 80 && r.heal[1] === 80, "the Overseer's +30 HP did not go to both: " + JSON.stringify(r.heal));
    assert(r.null.type === "nullptr" && Math.abs(r.null.max - r.null.base * r.mul) < 1e-6, "NULL in co-op: " + JSON.stringify(r.null));
    assert(r.goat.type === "goat" && Math.abs(r.goat.max - r.goat.base * r.mul) < 1e-6 && r.goat.dealt > 0, "the GOAT in co-op: " + JSON.stringify(r.goat));
    assert(r.end.state === "over" && r.end.won && r.end.bosses === 3, "the co-op run did not end in a win: " + JSON.stringify(r.end));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("co-op: player 2 pauses, hot-swaps their own IC and leaves from the pause menu (the boss scales back); their pad can join again", async () => {
    const { context, page, problems } = await coopRun({ p2: "sudo" });
    const r = await page.evaluate(() => {
      spawnOverseer();
      game.cinematic = null;
      step(2);
      const boss = game.boss;
      const out = { max: boss.maxHp, base: BOSSES.overseer.hp, mul: COOP.bossHp };
      press(1, "START"); // player 2 pauses
      const leave = document.getElementById("coop-leave-btn");
      out.paused = { state: game.state, leave: !leave.hidden, join: document.getElementById("coop-join-btn").hidden };
      // player 2's pad clicks Ronin: player 2's IC, not player 1's
      const card = [...document.querySelectorAll(".char-card")][CHARACTER_ORDER.indexOf("tetsu")];
      card.focus();
      press(1, "A");
      out.swap = { p2: P(1).char, p1: P(0).char, setting: settings.character, seat: coop.seat.char, badge: document.querySelectorAll(".char-card .char-p2").length };
      leave.click();
      out.left = { n: coop.players.length, slot: gamepads.slots[1] === undefined ? null : gamepads.slots[1], seat: coop.seat, leave: leave.hidden, max: boss.maxHp, base: BOSSES.overseer.hp, bound: player === coop.players[0].player && input === mainInput, toast: document.querySelector(".pad-toast").textContent };
      resumeGame();
      settings.autoFire = true;
      for (let i = 0; i < 120; i++) {
        player.hp = Math.max(player.hp, 60);
        step(1);
      }
      out.after = { state: game.state, n: coop.players.length, active: coopActive() };
      // the same pad can join again
      press(1, "START");
      out.again = { n: coop.players.length, joining: !!(coop.players[1] && coop.players[1].joining) };
      return out;
    });
    assert(r.mul > 1 && Math.abs(r.max - r.base * r.mul) < 1e-6, "boss HP: " + JSON.stringify(r));
    assert(r.paused.state === "paused" && r.paused.leave && r.paused.join, "player 2's pause menu: " + JSON.stringify(r.paused));
    assert(r.swap.p2 === "tetsu" && r.swap.p1 === "paine" && r.swap.setting === "paine" && r.swap.seat === "tetsu" && r.swap.badge === 1, "player 2's hot-swap: " + JSON.stringify(r.swap));
    assert(r.left.n === 1 && r.left.slot === null && r.left.seat === null && r.left.leave && r.left.bound && /PLAYER 2 LEFT/.test(r.left.toast), "player 2 did not leave: " + JSON.stringify(r.left));
    assert(Math.abs(r.left.max - r.left.base) < 1e-6, "the boss did not scale back to one player: " + JSON.stringify(r.left));
    assert(r.after.state === "playing" && r.after.n === 1 && !r.after.active, "the run after player 2 left: " + JSON.stringify(r.after));
    assert(r.again.n === 2 && r.again.joining, "the pad could not join again: " + JSON.stringify(r.again));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("co-op: single player is unchanged without a second pad (one player, no scaling, no P2 HUD; a lone pad's Start pauses)", async () => {
    const { context, page, problems } = await openPad();
    await startRun(page, { settings: { character: "paine" } });
    await page.evaluate(COOP_HELPERS);
    const r = await page.evaluate((xbox) => {
      const out = { n: coop.players.length, active: coopActive(), bound: player === coop.players[0].player && input === mainInput && stats === coop.players[0].stats && playerShots === coop.players[0].shots };
      const e = spawnEnemy("crawler", 3000, GROUND_Y - ENEMY_TYPES.crawler.h, { elite: false });
      out.enemyHp = e.maxHp / (ENEMY_TYPES.crawler.hp * (1 + game.time * TUNING.spawn.hpGrowth));
      e.dead = true;
      __padPlug(0, xbox);
      press(0, "X"); // the one pad is player 1's...
      press(0, "START"); // ...and its Start pauses: nobody joins
      out.pad = { slots: gamepads.slots.slice(), state: game.state, seat: coop.seat, n: coop.players.length, leave: document.getElementById("coop-leave-btn").hidden, join: !document.getElementById("coop-join-btn").hidden };
      resumeGame();
      director.firstSpawn = 0;
      settings.autoFire = true;
      for (let i = 0; i < 60 * 20; i++) {
        player.hp = Math.max(player.hp, 50);
        if (game.state === "levelup") chooseUpgrade(0, true);
        step(1);
      }
      out.run = { n: coop.players.length, kills: game.kills, state: game.state, maxAlive: enemies.length <= TUNING.spawn.maxAlive + 1 };
      spawnOverseer();
      out.boss = game.boss.maxHp === BOSSES.overseer.hp;
      out.tags = hudTexts().filter((t) => /^P[12]\b|PLAYER 2/.test(t));
      lose();
      out.entry = lbRun && Object.prototype.hasOwnProperty.call(lbRun.entry, "coop");
      return out;
    }, PAD_IDS.xbox);
    assert(r.n === 1 && !r.active && r.bound, "single player has a second player: " + JSON.stringify(r));
    assert(Math.abs(r.enemyHp - 1) < 1e-9 && r.boss, "single-player enemies / bosses were scaled: " + JSON.stringify(r));
    assert(r.pad.slots[0] === 0 && r.pad.state === "paused" && r.pad.seat === null && r.pad.n === 1 && r.pad.leave && r.pad.join, "a lone pad: " + JSON.stringify(r.pad));
    assert(r.run.state === "playing" && r.run.n === 1 && r.run.kills > 0 && r.run.maxAlive, "the single-player run: " + JSON.stringify(r.run));
    assert(!r.tags.length, "co-op HUD in single player: " + JSON.stringify(r.tags));
    assert(r.entry === false, "the leaderboard marked a single-player run as co-op");
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  // ------------------------------------------------------- v3.2 IC art ----
  // Which frame each IC draws in each state (player = whoever is bound)
  const IC_FRAMES = () => {
    const p = player;
    const name = (f) => (f.sheet && f.sheet.src ? f.sheet.src.split("/").pop() : "?");
    const pick = (setup) => {
      Object.assign(p, { onGround: true, moving: false, frameX: 0, frameY: 2, facing: 1, fireAnim: 0, fireAnimMax: 0.24, lookUp: false, draw: null, releaseT: 0 }, setup);
      const f = heroFrame();
      return { sheet: name(f), row: f.row, fx: f.fx, fw: f.fw, fh: f.fh };
    };
    return {
      idle: pick({}),
      run: pick({ moving: true, frameX: 2 }),
      air: pick({ onGround: false, frameX: 1 }),
      left: pick({ facing: -1, frameY: 1 }),
      look: pick({ lookUp: true }),
      attack: p.char === "paine" ? pick({ draw: { t: 0.4, aim: { x: 1, y: 0 } } }) : pick({ fireAnim: 0.1 }),
      drawn: drawHeroSprite(p.x + p.w / 2, p.y + p.h, 0),
    };
  };

  await test("IC art: the 80x120 sheets, landings, 64px portraits and select busts load; every IC (and co-op player 2) draws from them, the old sheets are the fallback", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await page.waitForFunction(() => ["widow3", "tetsu3", "hackerman3", "heroLanding3", "portraits3"].every((n) => isReady(IMG[n])), null, { timeout: 8000 });
    const files = await page.evaluate(() =>
      Promise.all(
        CHARACTER_ORDER.map(
          (id) =>
            new Promise((done) => {
              const img = new Image();
              img.onload = () => done([id, img.naturalWidth, img.naturalHeight]);
              img.onerror = () => done([id, 0, 0]);
              img.src = CHARACTERS[id].bust;
            })
        )
      ).then((busts) => ({ busts, sizes: ["widow3", "tetsu3", "hackerman3", "heroLanding3", "portraits3"].map((n) => [n, IMG[n].naturalWidth, IMG[n].naturalHeight]), portraits: portraitSheet() }))
    );
    assert(files.busts.every((b) => b[1] === 192 && b[2] === 240), "busts: " + JSON.stringify(files.busts));
    assert(JSON.stringify(files.sizes) === JSON.stringify([["widow3", 480, 720], ["tetsu3", 480, 720], ["hackerman3", 480, 720], ["heroLanding3", 320, 360], ["portraits3", 192, 64]]), "sheets: " + JSON.stringify(files.sizes));
    assert(files.portraits[0] === "portraits3" && files.portraits[1] === 64, "portrait sheet: " + files.portraits);
    await startRun(page, { settings: { character: "paine", autoFire: false, autoFlame: false } });
    const r = await page.evaluate((fn) => {
      const frames = new Function("return (" + fn + ")()");
      const out = {};
      for (const id of CHARACTER_ORDER) {
        player.char = id;
        out[id] = frames();
      }
      // the superhero landing uses the 80x120 landing sheet
      player.char = "tetsu";
      Object.assign(intro, { active: true, phase: "land", t: 0.3 });
      const land = heroFrame();
      out.landing = { sheet: land.sheet.src.split("/").pop(), row: land.row, fx: land.fx, fw: land.fw, fh: land.fh };
      intro.active = false;
      // a sheet that hasn't loaded: the old 32x48 sheet (and frame size) is used
      const keep = IMG.tetsu3;
      IMG.tetsu3 = new Image();
      out.fallback = frames();
      IMG.tetsu3 = keep;
      const keepP = IMG.portraits3;
      IMG.portraits3 = new Image();
      out.portraitFallback = portraitSheet();
      IMG.portraits3 = keepP;
      // the HUD (and its portrait) draws without errors
      render(performance.now() / 1000);
      return out;
    }, IC_FRAMES.toString());
    const sheets = { paine: "widow3.png", tetsu: "tetsu3.png", sudo: "hackerman3.png" };
    for (const id of ["paine", "tetsu", "sudo"]) {
      const f = r[id];
      const all = [f.idle, f.run, f.air, f.left, f.look, f.attack];
      assert(all.every((x) => x.sheet === sheets[id] && x.fw === 80 && x.fh === 120), `${id} sheet/frame size: ` + JSON.stringify(f));
      assert(f.idle.fx === 4 && f.idle.row === 2 && f.run.fx === 2 && f.air.fx === 5 && f.left.row === 1 && f.look.row === 3 && f.look.fx === 0, `${id} frames: ` + JSON.stringify(f));
      assert(f.attack.row === 5 && f.attack.fx >= 0 && f.attack.fx <= 3 && f.drawn === true, `${id} attack: ` + JSON.stringify(f.attack));
    }
    assert(r.landing.sheet === "hero-landing3.png" && r.landing.row === 1 && r.landing.fx === 2 && r.landing.fw === 80 && r.landing.fh === 120, "landing: " + JSON.stringify(r.landing));
    assert(r.fallback.idle.sheet === "tetsu.png" && r.fallback.idle.fw === 32 && r.fallback.idle.fh === 48 && r.fallback.drawn === true, "fallback: " + JSON.stringify(r.fallback.idle));
    assert(r.portraitFallback[0] === "portraits2" && r.portraitFallback[1] === 48, "portrait fallback: " + r.portraitFallback);
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("IC art: co-op player 2 draws their own IC's 80x120 sheet next to player 1's", async () => {
    const { context, page, problems } = await coopRun({ p1: "paine", p2: "tetsu" });
    const r = await page.evaluate((fn) => {
      const frames = new Function("return (" + fn + ")()");
      const out = [];
      coop.players.forEach((c) =>
        withPlayer(c, () => {
          intro.active = false; // (player 2 may still be landing)
          out.push({ char: player.char, f: frames() });
        })
      );
      render(performance.now() / 1000); // both heroes, their outlines and the P2 panel
      return out;
    }, IC_FRAMES.toString());
    assert(r.length === 2 && r[0].char === "paine" && r[1].char === "tetsu", "players: " + JSON.stringify(r.map((x) => x.char)));
    assert(r[0].f.idle.sheet === "widow3.png" && r[1].f.idle.sheet === "tetsu3.png", "sheets: " + JSON.stringify(r.map((x) => x.f.idle)));
    assert(r.every((x) => x.f.idle.fw === 80 && x.f.idle.fh === 120 && x.f.drawn === true), "frame sizes: " + JSON.stringify(r.map((x) => x.f.idle)));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  // ------------------------------------------------------ IC select ----
  await test("IC select: tiles and a stage with each IC's bust, name, personality, background, weapon, abilities, playstyle, mechanics and stats; hover and arrows preview, a click or Enter picks", async () => {
    const { context, page, problems } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    const dossier = await page.evaluate(() =>
      CHARACTER_ORDER.map((id, i) => {
        const card = document.querySelectorAll(".char-card")[i];
        card.focus();
        const st = document.querySelector("#char-select .cs-stage");
        const text = (sel) => [...st.querySelectorAll(sel)].map((n) => n.textContent).join(" | ");
        const ch = CHARACTERS[id];
        const dpr = devicePixelRatio || 1;
        // pixel art at a whole number of device pixels per art pixel
        const whole = (node, w) => {
          const k = node ? (parseFloat(node.style.width) * dpr) / w : 0;
          return k >= 1 && Math.abs(k - Math.round(k)) < 1e-6;
        };
        const art = st.querySelector(".cs-art .cs-bust");
        const armor = [...st.querySelectorAll(".cs-stat")].find((r) => r.textContent.startsWith("ARMOR"));
        return {
          id,
          shown: st.dataset.ic,
          checked: card.getAttribute("aria-checked"),
          tileArt: whole(card.querySelector(".cs-tile-art canvas"), 48),
          art: !!art && whole(art, art.classList.contains("cs-cutout") ? art.width : 192),
          name: text(".cs-name"),
          personality: text(".cs-personality"),
          background: text(".cs-bg"),
          abilities: text(".cs-ability"),
          play: text(".cs-play"),
          mech: st.querySelectorAll(".cs-mech li").length,
          res: text(".cs-res"),
          stats: st.querySelectorAll(".cs-stat").length,
          quote: text(".cs-quote"),
          armor: parseFloat(armor.querySelector(".cs-stat-fill").style.width),
          want: { name: ch.name, p: ch.profile, primary: ch.primary.name, special: ch.special.name, passive: ch.passive.split(":")[0], res: ch.resource.name, quote: ch.quotes.start[0] },
        };
      })
    );
    dossier.forEach((d) => {
      const w = d.want;
      assert(d.shown === d.id && d.name === w.name && d.tileArt && d.art, `${d.id}: the stage does not show its art / name: ` + JSON.stringify(d));
      assert(d.personality === w.p.personality && d.background === w.p.background && d.play.includes(w.p.playstyle), `${d.id}: personality / background / playstyle: ` + JSON.stringify(d));
      assert([w.primary, w.special, w.passive, w.p.weapon].every((s) => d.abilities.includes(s)), `${d.id}: weapon and abilities: ` + d.abilities);
      assert(d.mech === w.p.mechanics.length && d.res.includes(w.res) && d.stats === 4 && d.quote.includes(w.quote), `${d.id}: mechanics / resource / stats / quote: ` + JSON.stringify(d));
    });
    const [paine, tetsu, sudo] = dossier.map((d) => d.armor);
    assert(tetsu > paine && paine > sudo && tetsu < 100, `armor bars are not normalized: ${paine} ${tetsu} ${sudo}`);
    assert(dossier.filter((d) => d.checked === "true").length === 1, "one tile is checked");
    // The mouse: hovering previews, leaving shows the pick again
    await page.evaluate(() => document.activeElement.blur());
    await page.hover(".char-card:nth-child(3)");
    const hover = await page.evaluate(() => document.querySelector(".cs-stage").dataset.ic);
    await page.mouse.move(4, 4);
    const left = await page.evaluate(() => document.querySelector(".cs-stage").dataset.ic);
    // The keyboard: arrows move between the tiles (wrapping), Enter picks
    await page.focus(".char-card:nth-child(1)");
    await page.keyboard.press("ArrowRight");
    const state = () => page.evaluate(() => ({ focus: document.activeElement.dataset.ic, shown: document.querySelector(".cs-stage").dataset.ic, picked: settings.character, tabs: [...document.querySelectorAll(".char-card")].map((c) => c.tabIndex).join() }));
    const k1 = await state();
    await page.keyboard.press("Enter");
    const k2 = await state();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    const k3 = await state();
    assert(hover === "sudo" && left === "paine", `hover preview: ${hover}, after leaving: ${left}`);
    assert(k1.focus === "tetsu" && k1.shown === "tetsu" && k1.picked === "paine" && k1.tabs === "-1,0,-1", "ArrowRight: " + JSON.stringify(k1));
    assert(k2.picked === "tetsu" && k2.focus === "tetsu", "Enter did not pick: " + JSON.stringify(k2));
    assert(k3.focus === "sudo" && k3.shown === "sudo" && k3.picked === "tetsu", "ArrowLeft did not wrap: " + JSON.stringify(k3));
    // The bust contract: ch.bust shows the 192x240 bust (pixelated, whole scale); a broken one keeps the portrait
    const bust = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 192;
      c.height = 240;
      c.getContext("2d").fillRect(40, 20, 112, 220);
      CHARACTERS.tetsu.bust = c.toDataURL();
      CHARACTERS.sudo.bust = "data:image/png;base64,AAAA";
      // (the real busts were loaded and cached by the stage above: forget them)
      delete bustImgs.tetsu;
      delete bustImgs.sudo;
      const out = {};
      for (const id of ["tetsu", "sudo"]) {
        document.querySelector(`.char-card[data-ic="${id}"]`).focus();
        renderStage(true);
        await new Promise((r) => setTimeout(r, 200));
        const art = document.querySelector(".cs-art .cs-bust");
        const k = (parseFloat(art.style.width) * (devicePixelRatio || 1)) / (art.naturalWidth || art.width);
        out[id] = { tag: art.tagName, cut: art.classList.contains("cs-cutout"), pixelated: getComputedStyle(art).imageRendering === "pixelated", k, natural: art.naturalWidth };
      }
      return out;
    });
    assert(bust.tetsu.tag === "IMG" && !bust.tetsu.cut && bust.tetsu.pixelated && bust.tetsu.natural === 192 && bust.tetsu.k >= 1 && Number.isInteger(Math.round(bust.tetsu.k * 1e6) / 1e6), "the bust is not shown at a whole scale: " + JSON.stringify(bust));
    assert(bust.sudo.cut && bust.sudo.tag === "CANVAS", "a broken bust did not fall back to the portrait: " + JSON.stringify(bust));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("IC select by gamepad and in the pause menu: up reaches the tiles, left / right cycle them, A picks; mid-run A hot-swaps, with the stage saying what a swap keeps", async () => {
    const { context, page, problems } = await openPad();
    await silence(page);
    await page.evaluate((spec) => __padPlug(0, spec), PAD_IDS.xbox);
    const focus = () => page.evaluate(() => ({ ic: document.activeElement.dataset.ic || null, shown: document.querySelector(".cs-stage").dataset.ic, picked: settings.character, char: player.char, state: game.state }));
    await padPress(page, "UP");
    const up = await focus();
    let f = up;
    for (let i = 0; i < 3 && f.ic !== "tetsu"; i++) {
      await padPress(page, "RIGHT");
      f = await focus();
    }
    await padPress(page, "A");
    const picked = await focus();
    await padPress(page, "LEFT");
    const back = await focus();
    assert(up.ic && up.shown === up.ic, "UP did not reach a tile: " + JSON.stringify(up));
    assert(f.ic === "tetsu" && f.shown === "tetsu" && f.picked === "paine", "RIGHT did not cycle the tiles: " + JSON.stringify(f));
    assert(picked.picked === "tetsu", "A did not pick: " + JSON.stringify(picked));
    assert(back.ic === "paine" && back.shown === "paine", "LEFT did not cycle back: " + JSON.stringify(back));
    // Mid-run: the pause menu's tiles hot-swap
    await startRun(page, { settings: { character: "paine" } });
    await page.evaluate(() => {
      player.hp = stats.maxHp / 2;
      pauseGame();
    });
    await page.waitForTimeout(450);
    await page.focus(".char-card:nth-child(3)");
    const swap = await page.evaluate(() => {
      const st = document.querySelector(".cs-stage");
      return { label: document.getElementById("ic-label").textContent, status: st.querySelector(".cs-status").textContent, note: getComputedStyle(st.querySelector(".cs-swapnote")).display, active: document.querySelector('.char-card[aria-checked="true"] .cs-tile-state').textContent };
    });
    await padPress(page, "A");
    const after = await page.evaluate(() => ({ char: player.char, state: game.state, ratio: player.hp / stats.maxHp, status: document.querySelector(".cs-stage .cs-status").textContent, note: getComputedStyle(document.querySelector(".cs-swapnote")).display }));
    assert(/HOT-SWAP/.test(swap.label) && /HOT-SWAP TO SUDO/.test(swap.status) && swap.note !== "none" && swap.active === "ACTIVE", "the pause stage: " + JSON.stringify(swap));
    assert(after.char === "sudo" && after.state === "paused" && Math.abs(after.ratio - 0.5) < 0.02 && /DEPLOYED/.test(after.status) && after.note === "none", "A did not hot-swap: " + JSON.stringify(after));
    assert(!problems.length, problems.join("; "));
    await context.close();
  });

  await test("IC select on phones and small windows: no sideways scroll, the tiles and stage fit, a tap picks and Start works", async () => {
    const sizes = { "phone portrait": devices["iPhone 13"], "phone landscape": devices["iPhone 13 landscape"], "small window": { viewport: { width: 1024, height: 640 } } };
    for (const [name, opts] of Object.entries(sizes)) {
      const { context, page, problems } = await open(browser, url, opts);
      const r = await page.evaluate(() => {
        const panel = document.querySelector("#overlay .panel");
        const fits = (b) => b.left >= -0.5 && b.right <= innerWidth + 0.5;
        const tiles = [...document.querySelectorAll(".char-card")].map((c) => c.getBoundingClientRect());
        return {
          side: panel.scrollWidth > panel.clientWidth + 1 || document.scrollingElement.scrollWidth > innerWidth + 1,
          stage: fits(document.querySelector(".cs-stage").getBoundingClientRect()),
          tiles: tiles.every((b) => fits(b) && b.width >= 60 && b.height >= 44),
          name: getComputedStyle(document.querySelector(".cs-name")).fontSize,
          text: parseFloat(getComputedStyle(document.querySelector(".cs-bg")).fontSize),
        };
      });
      await page.click(".char-card:nth-child(3)");
      await page.click("#overlay-btn");
      await page.waitForSelector("#loadout:not([hidden])", { timeout: 3000 });
      const picked = await page.evaluate(() => settings.character);
      assert(!r.side && r.stage && r.tiles && r.text >= 8, `${name}: the select does not fit: ` + JSON.stringify(r));
      assert(picked === "sudo", `${name}: the tap did not pick: ${picked}`);
      assert(!problems.length, `${name}: ` + problems.join("; "));
      await context.close();
    }
  });

  await test("co-op: the join screen holds the world while player 2 picks (busts, names, the pick's kit, prompts, clock); the clock drops them in", async () => {
    const { context, page, problems } = await openPad();
    await startRun(page, { settings: { character: "paine", autoFire: false, autoFlame: false } });
    await page.evaluate(COOP_HELPERS);
    const r = await page.evaluate(
      ([xbox, ds]) => {
        const e = spawnEnemy("crawler", player.x + 500, GROUND_Y - ENEMY_TYPES.crawler.h);
        __padPlug(0, xbox);
        __padPlug(1, ds);
        press(0, "X");
        press(1, "START");
        const ctx = coop.players[1];
        const t0 = game.time;
        const ex = e.x;
        step(90);
        const held = { time: game.time - t0, moved: Math.abs(e.x - ex), joining: !!ctx.joining, clock: ctx.joining && ctx.joining.t };
        const texts = hudTexts();
        const shown = CHARACTERS[ctx.joining.char];
        const panel = {
          header: texts.some((t) => /PLAYER 2 \/\/ CHOOSE/.test(t)),
          names: CHARACTER_ORDER.every((id) => texts.includes(CHARACTERS[id].name)),
          kit: [shown.primary.name, shown.special.name].every((n) => texts.includes(n.toUpperCase())),
          prompts: texts.includes("DROP IN") && texts.includes("LEAVE") && texts.some((t) => /^DROP IN \d+$/.test(t)),
          art: CHARACTER_ORDER.every((id) => !!icBustArt(id)),
        };
        press(1, "RIGHT");
        const next = ctx.joining.char;
        panel.follows = next !== shown.name.toLowerCase() && hudTexts().includes(CHARACTERS[next].primary.name.toUpperCase());
        step(Math.ceil((COOP.joinTimeout + 0.5) * 60)); // nobody presses A: the clock runs out
        return { held, panel, next, after: { joining: !!ctx.joining, char: ctx.player.char, time: game.time - t0, n: coop.players.length } };
      },
      [PAD_IDS.xbox, PAD_IDS.dualsense]
    );
    assert(r.held.time === 0 && r.held.moved === 0 && r.held.joining && r.held.clock > 1.4, "the world did not hold while player 2 picks: " + JSON.stringify(r.held));
    assert(Object.values(r.panel).every(Boolean), "the join screen is missing something: " + JSON.stringify(r.panel));
    assert(r.after.n === 2 && !r.after.joining && r.after.char === r.next && r.after.time > 0, "the clock did not drop player 2 in: " + JSON.stringify(r.after));
    assert(!problems.length, problems.join("; "));
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
