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
        glitchCd = 0;
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

  await test("Hackerman: EM waves pierce and slow, System Glitch stutters an area, Time Dilation slows the world", async () => {
    const { context, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    await startRun(page, { settings: { character: "sudo", autoFire: true, autoFlame: false } });
    const r = await page.evaluate(() => {
      const pack = [0, 1, 2].map((i) => {
        const e = spawnEnemy("enforcer", player.x + 300 + i * 90, GROUND_Y - 116);
        e.hp = e.maxHp = 9999;
        e.facing = 1;
        return e;
      });
      const hold = () => pack.forEach((e, i) => ((e.x = player.x + 300 + i * 90), (e.vx = 0)));
      for (let i = 0; i < 40; i++) {
        hold();
        update(1 / 60);
      }
      const out = { hurt: pack.filter((e) => e.hp < 9999).length, slowed: pack.filter((e) => e.slowT > 0).length };
      // System Glitch: force a proc and check the area stutters
      glitchCd = 0;
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
    assert(counts.enemies.all === 8 && counts.enemies.locked === 8, "enemies: " + JSON.stringify(counts.enemies));
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
      for (let i = 0; i < 60 * 4; i++) {
        hold();
        step(1);
      }
      out.camo = { target: blind.coopTarget === c1, moves: blind.nav ? blind.nav.jumps : 0, floor: navNodeOf(blind.standingOn), shots: enemyShots.filter((s) => s.owner === drone).length };
      a.camo = 0;
      return out;
    });
    assert(r.t2 && r.goal2 === 0 && r.t1, "walkers did not pick the nearer player: " + JSON.stringify(r));
    assert(r.up >= 0, "the walker never climbed to player 1's rooftop: " + JSON.stringify(r));
    assert(r.camo.target && r.camo.moves === 0 && r.camo.floor === 0 && r.camo.shots === 0, "camo did not blind them: " + JSON.stringify(r.camo));
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

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
