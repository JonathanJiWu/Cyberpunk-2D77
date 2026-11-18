// Performance benchmark for Cyberpunk 2D77.
// Drives the real game in headless Chromium through heavy scenes and reports,
// per frame: update ms, render ms (recording the canvas calls), raster ms (a
// forced flush, so the pixels really get drawn), the expensive canvas calls,
// canvases created and the JS allocation rate (sampled through DevTools).
//
//   npm run bench                         both modes, every scene
//   npm run bench -- --mode=perf          only Performance mode
//   npm run bench -- --scene=swarm,goat   some scenes
//   npm run bench -- --frames=300 --viewport=1280x720 --repeat=3
//   npm run bench -- --baseline=../old-checkout   also run an older copy of
//                                         the game, interleaved, and compare
//   npm run bench -- --json=out.json      save the numbers
//   npm run bench -- --sites              list the top allocation sites
//   npm run bench -- --ablate=drawRain    stub out global functions (to find costs)
//   npm run bench -- --profile            CPU self time per function
//
// Math.random is seeded per scene, so every run plays the same scene. Timings
// still depend on the machine and its load: compare runs made side by side
// (--baseline interleaves them) and use --repeat to take medians.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ttf": "font/ttf" };
const SCENES = ["swarm", "overseer", "null", "goat", "dilation", "flameon", "rain"];
const SCENE_NAMES = {
  swarm: "late-game swarm (40 enemies, ~300 XP chips, particles)",
  overseer: "the Overseer's eye laser",
  null: "NULL with decoys",
  goat: "the GOAT's final form: meteors + fire breath",
  dilation: "Hackerman's Time Dilation (code rain, glitch fields)",
  flameon: "the Cyber Widow's Flame On + triple arrows",
  rain: "acid rain + the billboard hologram",
};

// ------------------------------------------------------------------ Args ---
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  })
);
const modes = args.mode === "normal" ? ["normal"] : args.mode === "perf" ? ["perf"] : ["normal", "perf"];
const scenes = args.scene ? String(args.scene).split(",") : SCENES;
const frames = Number(args.frames) || 240;
const countFrames = Number(args["count-frames"]) || 60;
const allocFrames = Number(args["alloc-frames"]) || 120;
const repeat = Math.max(1, Number(args.repeat) || 1);
const [vw, vh] = String(args.viewport || "1920x1080").split("x").map(Number);
const ablate = args.ablate ? String(args.ablate).split(",") : [];

function serve(root) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root)) return res.writeHead(403), res.end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404), res.end();
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ------------------------------------------------------ Runs in the page ---
async function pageBench({ scene, perf }) {
  // Seeded Math.random: the same scene every run
  let seed = 0x2d77;
  Math.random = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // The bench drives every frame itself: stop the game's own loop
  window.frame = () => {};
  const raf = () => new Promise((done) => requestAnimationFrame(done));
  await raf();
  await raf();
  // Silence
  Object.values(sfx).forEach((s) => {
    s.play = () => {};
    s.startLoop = () => {};
    s.stopLoop = () => {};
  });
  music.play = () => {};
  synth.play = () => false;
  synth.loop = () => {};
  synth.stop = () => {};
  window.vibrate = () => {};
  window.gainXp = () => {}; // no level-up screens mid-measurement

  // Performance mode (from this branch on; ignored by older code)
  settings.perfMode = !!perf;
  if (typeof setPerfMode === "function") setPerfMode(!!perf);
  else applySettings();

  const char = { dilation: "sudo" }[scene] || "paine";
  Object.assign(settings, { character: char, autoFire: true, autoFlame: false, loadout: ["orbit", "chain"] });
  applySettings();
  overlayShownAt = -1e9;
  startGame();
  skipIntro();
  director.firstSpawn = 1e9;
  weather.timer = 1e9; // no surprise rain...
  weather.raining = false;
  weather.amount = 0;
  game.time = 30; // past the controls hint

  const fill = (n, types, near) => {
    const pc = centerOf(player);
    while (enemies.filter((e) => !e.dead && !e.boss).length < n) {
      const type = types[Math.floor(Math.random() * types.length)];
      const def = ENEMY_TYPES[type];
      const x = clamp(pc.x + (Math.random() < 0.5 ? -1 : 1) * rand(near ? 160 : 260, 900), 40, WORLD_W - 200);
      const y = def.walker ? GROUND_Y - def.h : camera.y + rand(140, 620);
      const e = spawnEnemy(type, x, y);
      e.hp = e.maxHp = e.maxHp * 6;
    }
  };
  const levels = (u) => {
    Object.assign(upg, u);
    computeStats();
  };
  const fastForward = (seconds, until) => {
    for (let t = 0; t < seconds && !(until && until()); t += 1 / 60) {
      player.hp = stats.maxHp;
      if (game.state === "levelup") chooseUpgrade(0, true);
      update(1 / 60);
    }
  };
  const allTypes = Object.keys(ENEMY_TYPES);
  let tick = () => {};

  if (scene === "swarm") {
    game.time = 210;
    progress.level = 24;
    levels({ zap: 8, flame: 3, orbit: 4, chain: 4, missile: 3, stomp: 2 });
    player.x = 2400;
    camera.x = player.x - W / 2;
    fill(40, allTypes);
    for (let i = 0; i < 300; i++) spawnGem(camera.x + 80 + (i % 50) * 36, GROUND_Y - 40 - Math.floor(i / 50) * 60, [1, 1, 2, 5, 12][i % 5]);
    tick = (i) => {
      fill(40, allTypes);
      if (gems.length < 280) for (let k = 0; k < 20; k++) spawnGem(camera.x + rand(80, W - 80), GROUND_Y - rand(30, 300), [1, 2, 5][k % 3]);
      if (i % 3 === 0) burst(camera.x + rand(200, W - 200), camera.y + rand(200, 800), 30, ["#ff2fd6", "#19f5ff", "#ffe14d"][i % 3], 400);
    };
  } else if (scene === "overseer" || scene === "null" || scene === "goat") {
    player.x = 2400;
    camera.x = player.x - W / 2;
    levels({ zap: 6, orbit: 2 });
    if (scene === "overseer") spawnOverseer();
    else if (scene === "null") spawnNull();
    else spawnGoat();
    const boss = game.boss;
    fastForward(8, () => !bossLocked() && !boss.parked && boss.state !== "intro");
    if (scene === "goat") boss.hp = boss.maxHp * 0.2; // FINAL FORM
    let cycle = 0;
    tick = () => {
      // keep the Overseer and the GOAT on the street, close enough to stay on screen
      if (scene !== "null" && boss.onGround && boss.y + boss.h < GROUND_Y - 4) {
        boss.y = GROUND_Y - boss.h;
        boss.standingOn = GROUND;
      }
      const bx = centerOf(boss).x;
      if (!boss.parked && Math.abs(bx - centerOf(player).x) > 750) player.x = clamp(bx + (player.x < bx ? -600 : 600), 40, WORLD_W - 100);
      boss.hp = scene === "goat" ? Math.min(boss.hp, boss.maxHp * 0.2) : boss.maxHp;
      if (scene === "goat") boss.hp = Math.max(boss.hp, boss.maxHp * 0.15);
      if (scene === "overseer" && boss.state !== "laser") bossState(boss, "laser");
      if (scene === "null" && boss.state !== "intro" && !boss.parked && nullDecoys(boss).length < 2 && boss.state !== "scatter") nullSplit(boss, 4);
      if (scene === "goat" && boss.state !== "breath" && boss.state !== "rain" && boss.state !== "roar") bossState(boss, cycle++ % 2 ? "rain" : "breath");
    };
  } else if (scene === "dilation") {
    progress.level = 16;
    levels({ zap: 7, flame: 6 });
    player.x = 2400;
    camera.x = player.x - W / 2;
    fill(24, ["drone", "crawler", "reaper", "ninja", "enforcer"], true);
    tick = (i) => {
      fill(24, ["drone", "crawler", "reaper", "ninja", "enforcer"], true);
      player.heat = 100;
      if (!(player.dilation > 0)) {
        player.specialCd = 0;
        input.specialQueued = true;
      }
      if (i % 12 === 0) {
        glitchCd = 0;
        const e = enemies[Math.floor(Math.random() * enemies.length)];
        if (e) systemGlitch(centerOf(e).x, centerOf(e).y);
      }
    };
  } else if (scene === "flameon") {
    progress.level = 16;
    levels({ zap: 8, flame: 6 });
    player.x = 2400;
    camera.x = player.x - W / 2;
    fill(30, ["crawler", "reaper", "ninja", "drone", "dragon"], true);
    tick = (i) => {
      fill(30, ["crawler", "reaper", "ninja", "drone", "dragon"], true);
      if (i % 30 === 0) flameOn(stats.heatwave.damage);
    };
  } else if (scene === "rain") {
    weather.raining = true;
    weather.amount = 1;
    player.x = holo.x - 260;
    camera.x = clamp(player.x - W / 2, 0, WORLD_W - W);
    fill(10, ["crawler", "drone", "reaper"]);
    tick = () => {
      weather.amount = 1;
      fill(10, ["crawler", "drone", "reaper"]);
    };
  }

  const step = (i) => {
    if (game.state === "levelup") chooseUpgrade(0, true);
    player.hp = stats.maxHp;
    tick(i);
  };
  const frameOnce = async (i) => {
    await raf();
    step(i);
    update(1 / 60);
    render(performance.now() / 1000);
  };
  window.__bench = { step, raf, frameOnce, n: 0 };
  // Warm up (caches, JIT)
  for (let i = 0; i < 40; i++) await frameOnce(i);
  window.__bench.n = 40;
}

// Timing pass: nothing wrapped. The 1x1 getImageData forces this frame's
// drawing to be rasterized now, so "raster" is the real pixel cost.
async function pageTime(frames) {
  const B = window.__bench;
  const T = { update: [], render: [], raster: [], total: [] };
  for (let i = 0; i < frames; i++) {
    await B.raf();
    B.step(B.n++);
    const t0 = performance.now();
    update(1 / 60);
    const t1 = performance.now();
    render(t1 / 1000);
    const t2 = performance.now();
    ctx.getImageData(0, 0, 1, 1);
    const t3 = performance.now();
    T.update.push(t1 - t0);
    T.render.push(t2 - t1);
    T.raster.push(t3 - t2);
    T.total.push(t3 - t0);
  }
  const stat = (a) => {
    const s = a.slice().sort((x, y) => x - y);
    return { mean: a.reduce((x, y) => x + y, 0) / a.length, p95: s[Math.floor(s.length * 0.95)], worst: s[s.length - 1] };
  };
  return { update: stat(T.update), render: stat(T.render), raster: stat(T.raster), total: stat(T.total) };
}

// Plain frames (the allocation sampler runs from outside meanwhile)
async function pageRun(frames) {
  const B = window.__bench;
  for (let i = 0; i < frames; i++) await B.frameOnce(B.n++);
}

// Counting pass: wrap the expensive canvas calls
async function pageCount(frames) {
  const B = window.__bench;
  const counts = {};
  const P = CanvasRenderingContext2D.prototype;
  const undo = [];
  ["createRadialGradient", "createLinearGradient", "createPattern", "fillText", "strokeText", "measureText", "drawImage", "save", "restore", "setLineDash"].forEach((name) => {
    const orig = P[name];
    counts[name] = 0;
    P[name] = function () {
      counts[name]++;
      return orig.apply(this, arguments);
    };
    undo.push(() => (P[name] = orig));
  });
  const blur = Object.getOwnPropertyDescriptor(P, "shadowBlur");
  counts.shadowBlur = 0;
  Object.defineProperty(P, "shadowBlur", {
    configurable: true,
    get() {
      return blur.get.call(this);
    },
    set(v) {
      if (v > 0) counts.shadowBlur++;
      blur.set.call(this, v);
    },
  });
  undo.push(() => Object.defineProperty(P, "shadowBlur", blur));
  const createEl = document.createElement;
  counts.newCanvas = 0;
  document.createElement = function (tag) {
    if (String(tag).toLowerCase() === "canvas") counts.newCanvas++;
    return createEl.apply(this, arguments);
  };
  undo.push(() => (document.createElement = createEl));
  for (let i = 0; i < frames; i++) await B.frameOnce(B.n++);
  undo.forEach((u) => u());
  Object.keys(counts).forEach((k) => (counts[k] /= frames));
  return {
    perFrame: counts,
    canvas: `${canvas.width}x${canvas.height}`,
    entities: {
      enemies: enemies.filter((e) => !e.dead).length,
      enemyShots: enemyShots.length,
      playerShots: playerShots.length,
      particles: particles.length,
      popups: popups.length,
      gems: gems.length,
    },
  };
}

// --------------------------------------------------- Allocation sampling ---
async function heapUsed(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  return (await cdp.send("Runtime.getHeapUsage")).usedSize;
}

// Every allocation (including ones the GC has already collected) is sampled
// about once per 2 KB; returns bytes per frame and the top allocation sites.
// CPU profile of plain frames: self time per function (--profile)
async function profileCpu(page, cdp, frames) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await page.evaluate(pageRun, frames);
  const { profile } = await cdp.send("Profiler.stop");
  const dt = [];
  for (let i = 0; i < profile.timeDeltas.length; i++) dt.push(profile.timeDeltas[i]);
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const cf = n.callFrame;
    const file = (cf.url || "").split("/").pop();
    const key = file ? `${cf.functionName || "(anonymous)"} ${file}:${cf.lineNumber + 1}` : cf.functionName || "(native)";
    self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
  });
  return [...self.entries()]
    .filter(([k]) => k !== "(idle)" && k !== "(program)")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([fn, ms]) => ({ fn, msPerFrame: ms / frames }));
}

async function sampleAllocations(page, cdp, frames) {
  await cdp.send("HeapProfiler.startSampling", { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await page.evaluate(pageRun, frames);
  const { profile } = await cdp.send("HeapProfiler.stopSampling");
  const sites = new Map();
  let total = 0;
  const walk = (node) => {
    if (node.selfSize) {
      const cf = node.callFrame;
      const file = (cf.url || "").split("/").pop();
      if (file && file.endsWith(".js") && file !== "bench.cjs") {
        const key = `${cf.functionName || "(anonymous)"} ${file}:${cf.lineNumber + 1}`;
        sites.set(key, (sites.get(key) || 0) + node.selfSize);
      }
      total += node.selfSize;
    }
    node.children.forEach(walk);
  };
  walk(profile.head);
  const top = [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([site, bytes]) => ({ site, kbPerFrame: bytes / frames / 1024 }));
  return { kbPerFrame: total / frames / 1024, top };
}

// ---------------------------------------------------------------- Report ---
const f1 = (n) => (n === undefined || n === null || Number.isNaN(n) ? "-" : n >= 100 ? n.toFixed(0) : n.toFixed(n >= 10 ? 1 : 2));
const timing = (s) => `${f1(s.mean)} / ${f1(s.p95)} / ${f1(s.worst)}`;

function table(results) {
  const out = [];
  out.push("| Scene | update ms (mean / p95 / worst) | render ms | raster ms | frame ms | alloc KB/frame | retained KB |");
  out.push("|---|---|---|---|---|---|---|");
  results.forEach((r) => out.push(`| ${r.scene} | ${timing(r.update)} | ${timing(r.render)} | ${timing(r.raster)} | ${timing(r.total)} | ${f1(r.alloc.kbPerFrame)} | ${f1(r.retainedKb)} |`));
  out.push("");
  out.push("| Scene (calls per frame) | radialGradient | linearGradient | shadowBlur | fillText | drawImage | save / restore | new canvas | particles | popups |");
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  results.forEach((r) => {
    const c = r.perFrame;
    out.push(`| ${r.scene} | ${f1(c.createRadialGradient)} | ${f1(c.createLinearGradient)} | ${f1(c.shadowBlur)} | ${f1(c.fillText)} | ${f1(c.drawImage)} | ${f1(c.save)} / ${f1(c.restore)} | ${f1(c.newCanvas)} | ${r.entities.particles} | ${r.entities.popups} |`);
  });
  if (args.sites) {
    out.push("");
    out.push("Top allocation sites (KB/frame):");
    results.forEach((r) => out.push(`- ${r.scene}: ` + r.alloc.top.map((t) => `${t.site} ${f1(t.kbPerFrame)}`).join("; ")));
  }
  if (args.profile) {
    out.push("");
    out.push("CPU self time (ms/frame):");
    results.forEach((r) => out.push(`- ${r.scene}: ` + r.cpu.map((t) => `${t.fn} ${f1(t.msPerFrame)}`).join("; ")));
  }
  return out.join("\n");
}

function compare(before, after) {
  const out = [];
  const arrow = (x, y) => `${f1(x)} → ${f1(y)}`;
  out.push("| Scene | mode | frame ms (mean) | render ms | raster ms | update ms | radialGradient / frame | fillText / frame | new canvas / frame | alloc KB / frame |");
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  Object.keys(after).forEach((mode) =>
    after[mode].forEach((a) => {
      const b = before.find((x) => x.scene === a.scene);
      if (!b) return;
      out.push(`| ${a.scene} | ${mode} | ${arrow(b.total.mean, a.total.mean)} | ${arrow(b.render.mean, a.render.mean)} | ${arrow(b.raster.mean, a.raster.mean)} | ${arrow(b.update.mean, a.update.mean)} | ${arrow(b.perFrame.createRadialGradient, a.perFrame.createRadialGradient)} | ${arrow(b.perFrame.fillText, a.perFrame.fillText)} | ${arrow(b.perFrame.newCanvas, a.perFrame.newCanvas)} | ${arrow(b.alloc.kbPerFrame, a.alloc.kbPerFrame)} |`);
    })
  );
  return out.join("\n");
}

// The median of each timing figure over the repeats
function merge(runs) {
  const med = (xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.floor((s.length - 1) / 2)];
  };
  const r = { ...runs[0] };
  ["update", "render", "raster", "total"].forEach((k) => {
    r[k] = { mean: med(runs.map((x) => x[k].mean)), p95: med(runs.map((x) => x[k].p95)), worst: med(runs.map((x) => x[k].worst)) };
  });
  r.alloc = { ...runs[0].alloc, kbPerFrame: med(runs.map((x) => x.alloc.kbPerFrame)) };
  r.retainedKb = med(runs.map((x) => x.retainedKb));
  return r;
}

async function runScene(browser, url, scene, perf) {
  const context = await browser.newContext({ viewport: { width: vw, height: vh } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(600);
  const cdp = await context.newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await page.evaluate(pageBench, { scene, perf });
  if (ablate.length) await page.evaluate((names) => names.forEach((n) => (window[n] = () => 0)), ablate);
  const heap0 = await heapUsed(cdp);
  const times = await page.evaluate(pageTime, frames);
  const alloc = await sampleAllocations(page, cdp, allocFrames);
  const cpu = args.profile ? await profileCpu(page, cdp, Number(args.profile) > 1 ? Number(args.profile) : 120) : null;
  const counted = await page.evaluate(pageCount, countFrames);
  const heap1 = await heapUsed(cdp);
  await context.close();
  const r = { scene, ...times, ...counted, alloc, cpu, retainedKb: (heap1 - heap0) / 1024 };
  if (errors.length) r.errors = errors;
  return r;
}

(async () => {
  const variants = modes.map((mode) => ({ label: mode, root: ROOT, perf: mode === "perf" }));
  if (args.baseline) variants.unshift({ label: "before", root: path.resolve(String(args.baseline)), perf: false });
  for (const v of variants) {
    v.server = await serve(v.root);
    v.url = `http://127.0.0.1:${v.server.address().port}/`;
    v.runs = {};
  }
  const browser = await chromium.launch();
  console.log(`Cyberpunk 2D77 benchmark: viewport ${vw}x${vh}; per scene ${frames} timed frames, ${allocFrames} allocation-sampled, ${countFrames} counted; ${repeat} run(s), medians${ablate.length ? "; ablated: " + ablate.join(", ") : ""}`);
  // Interleave the variants scene by scene, so machine load hits them alike
  for (const scene of scenes) {
    for (let rep = 0; rep < repeat; rep++) {
      for (const v of variants) {
        const r = await runScene(browser, v.url, scene, v.perf);
        (v.runs[scene] = v.runs[scene] || []).push(r);
        process.stderr.write(`  ${v.label} ${scene}: frame ${f1(r.total.mean)} ms (render ${f1(r.render.mean)}, raster ${f1(r.raster.mean)}, update ${f1(r.update.mean)}), alloc ${f1(r.alloc.kbPerFrame)} KB/frame${r.errors ? "  ERRORS: " + r.errors.join("; ") : ""}\n`);
      }
    }
  }
  const all = {};
  variants.forEach((v) => {
    all[v.label] = scenes.map((s) => merge(v.runs[s]));
    const title = { before: "Before (baseline copy)", normal: "Normal mode", perf: "Performance mode" }[v.label];
    console.log(`\n### ${title} (canvas ${all[v.label][0].canvas})\n`);
    console.log(table(all[v.label]));
  });
  console.log("\nScenes: " + scenes.map((s) => `${s} = ${SCENE_NAMES[s]}`).join("; ") + ".");
  console.log("render = recording the draw calls (JS); raster = drawing the pixels (a forced flush); frame = update + render + raster.");
  if (all.before) {
    console.log("\n### Before → after (medians of the means)\n");
    const after = {};
    modes.forEach((m) => (after[m] = all[m]));
    console.log(compare(all.before, after));
  }
  if (args.json) fs.writeFileSync(String(args.json), JSON.stringify(all, null, 2));
  await browser.close();
  variants.forEach((v) => v.server.close());
})();
