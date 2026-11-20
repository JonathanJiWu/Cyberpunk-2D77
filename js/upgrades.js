"use strict";
// =============================================================================
// XP and the Vampire Survivors style level-up: pick 1 of 3 random upgrades.
//   - Cards look like PC hardware (HARDWARE in database.js).
//   - Your two LOADOUT skills (picked before the drop) start one level up and
//     show up 3x as often, and are 3x as likely to be RARE (+2 levels).
//   - 3 rerolls per run. Picking a card "installs" it: a short, juicy
//     animation while the game stays paused for half a second.
//   - RESPEC (pause menu): refund every skill point and spend them again.
//   - THE LEGEND, a hologram, comments on all of it (his lines: narrator.js).
// =============================================================================

const progress = { level: 1, xp: 0, pending: 0, rerolls: 3 };
const levelUpEl = document.getElementById("levelup");
const cardsEl = document.getElementById("cards");
const rerollBtn = document.getElementById("reroll-btn");
let currentChoices = []; // [{ id, u, rare }]
let levelUpShownAt = 0;
let pickLock = false;

const MAX_REROLLS = 3;
const PREFERRED_WEIGHT = 3;
const RARE_CHANCE = 0.1;
const RARE_CHANCE_PREFERRED = 0.3;
const HEAL_CARD = { id: "_heal", name: "Repair Kit", icon: 6, max: 99, desc: [`Heal ${40 + LEVEL_UP_HEAL} HP.`] }; // (40 + the level-up heal)

if (!Array.isArray(settings.loadout)) settings.loadout = ["orbit", "armor"];

function resetProgress() {
  progress.rareCache = false;
  progress.level = 1;
  progress.xp = 0;
  progress.pending = 0;
  progress.rerolls = MAX_REROLLS;
  pickLock = false;
}

function gainXp(amount) {
  progress.xp += amount;
  let need = xpForLevel(progress.level + progress.pending);
  while (progress.xp >= need) {
    progress.xp -= need;
    progress.pending++;
    need = xpForLevel(progress.level + progress.pending);
  }
}

// ------------------------------------------------------------- Loadout ------
const validLoadout = () => settings.loadout.filter((id, i, a) => UPGRADES.some((u) => u.id === id) && a.indexOf(id) === i).slice(0, 2);
const isPreferred = (id) => validLoadout().includes(id);

// Called at the start of a run (after resetPlayer): loadout skills go up a level
function applyLoadout() {
  validLoadout().forEach((id) => {
    const u = UPGRADES.find((x) => x.id === id);
    upg[id] = Math.min(upgradeInfo(u).max, lv(id) + 1);
  });
  forEachPlayer(() => {
    computeStats();
    player.hp = player.ghostHp = stats.maxHp;
  });
}

// ------------------------------------------------------------- Choices ------
// Weighted draw without replacement: loadout skills are 3x as likely.
// NULL's RARE CACHE (progress.rareCache) makes every card rare.
function rollChoices() {
  const cache = progress.rareCache && UPGRADES.some((u) => upgradeInfo(u).max - lv(u.id) >= 2);
  const pool = UPGRADES.filter((u) => upgradeInfo(u).max - lv(u.id) >= (cache ? 2 : 1)).map((u) => ({ u, w: isPreferred(u.id) ? PREFERRED_WEIGHT : 1 }));
  const picks = [];
  while (picks.length < 3 && pool.length) {
    let r = Math.random() * pool.reduce((a, p) => a + p.w, 0);
    let k = 0;
    while (k < pool.length - 1 && r >= pool[k].w) r -= pool[k++].w;
    const { u } = pool.splice(k, 1)[0];
    const room = upgradeInfo(u).max - lv(u.id);
    const rare = room >= 2 && (cache || Math.random() < (isPreferred(u.id) ? RARE_CHANCE_PREFERRED : RARE_CHANCE));
    picks.push({ id: u.id, u, rare });
  }
  // Everything maxed out: offer a heal instead
  if (!picks.length) picks.push({ id: "_heal", u: HEAL_CARD, rare: false });
  return picks;
}

// The primary/special upgrades take their name, icon, text and guide from the
// character being played; everything else is shared.
function upgradeInfo(u) {
  const ch = CH();
  const own = u.id === "zap" ? ch.primary : u.id === "flame" ? ch.special : null;
  const info = own ? { name: own.name, desc: own.desc, max: own.max, icon: own.icon } : { name: u.name, desc: u.desc, max: u.max, icon: { sheet: "icons", cell: u.icon } };
  info.guide = own ? own.guide : SKILL_GUIDE[u.id];
  return info;
}

const resourceText = (s) => String(s).replace("{resource}", CH().resource.name.toLowerCase());
const descAt = (u, level) => {
  const desc = upgradeInfo(u).desc;
  return resourceText(desc[clamp(level - 1, 0, desc.length - 1)]);
};

function describe(u, steps = 1) {
  const lines = [];
  for (let k = 1; k <= steps; k++) lines.push(descAt(u, lv(u.id) + k));
  const unique = [...new Set(lines)];
  // A one-line passive reads the same every level: a rare card says what
  // its two levels add up to ("Take 16% less damage.")
  if (unique.length === 1 && steps > 1) {
    const total = unique[0].replace(/\d+/g, (n) => String(Number(n) * steps));
    return total !== unique[0] ? total : `${unique[0]} (x${steps})`;
  }
  return unique.join(" + ");
}

// Co-op: the primary / special card upgrades every player's own IC. When
// their ICs differ it names and describes each one; null otherwise.
function teamCard(u, steps) {
  if (!coopActive() || (u.id !== "zap" && u.id !== "flame")) return null;
  const seen = new Set();
  const names = [];
  const descs = [];
  forEachPlayer(() => {
    if (seen.has(player.char)) return;
    seen.add(player.char);
    names.push(upgradeInfo(u).name);
    descs.push(`${CH().name}: ${describe(u, steps)}`);
  });
  return names.length > 1 ? { name: names.join(" + "), desc: descs.join(" ") } : null;
}

// ------------------------------------------------------ Skill guidance ------
// role + four short lines (SKILL_GUIDE, or the IC's own primary/special
// guide). A missing or partial guide just shows fewer lines.
const ROLES = ["OFFENSE", "DEFENSE", "MOBILITY", "UTILITY"];
const GUIDE_ROWS = [
  ["what", "DOES"],
  ["edge", "EDGE"],
  ["mechanic", "HOW"],
  ["note", "NOTE"],
];

function skillRole(u) {
  const g = upgradeInfo(u).guide;
  const role = g && typeof g.role === "string" ? g.role.trim().toUpperCase() : "";
  if (ROLES.includes(role)) return role;
  return u.id === "_heal" ? "DEFENSE" : u.weapon ? "OFFENSE" : "UTILITY";
}

// [[label, text, key], ...] for the guide lines this skill has
function skillGuideRows(u) {
  const g = upgradeInfo(u).guide;
  if (!g || typeof g !== "object") return [];
  return GUIDE_ROWS.filter(([k]) => typeof g[k] === "string" && g[k].trim()).map(([k, label]) => [label, resourceText(g[k].trim()), k]);
}

function fillGuide(el, rows) {
  el.textContent = "";
  rows.forEach(([label, text, key]) => {
    const row = document.createElement("span");
    row.className = `guide-row g-${key}`;
    row.title = text;
    const b = document.createElement("b");
    b.textContent = label;
    const t = document.createElement("span");
    t.textContent = text;
    row.append(b, t);
    el.append(row);
  });
}

// CSS for showing one cell of a horizontal icon strip
const SHEET_CELLS = { icons: 12, secrets: 8, fx: 8, fx2: 8, pickups: 8, hardware: 8 };
function iconStyle(icon) {
  const n = SHEET_CELLS[icon.sheet] || 12;
  return `background-image:url(img/${icon.sheet}.png);background-size:${n * 100}% 100%;background-position:${(icon.cell * 100) / (n - 1)}% 0`;
}

// One upgrade drawn as a 3:4 movie poster printed on a piece of hardware
// (used by level-up and loadout): role tag, part number, the hardware art as
// the poster image, the headline, the level line, the description and the
// guidance lines ("billing block").
function hardwareCard(u, { rare, key, tag } = {}) {
  const hw = HARDWARE[u.id] || HARDWARE._heal;
  const info = upgradeInfo(u);
  const role = skillRole(u);
  const card = document.createElement("button");
  card.type = "button";
  card.className = `card hw hw-${hw.kind} role-${role.toLowerCase()}`;
  card.dataset.id = u.id;
  card.dataset.role = role;
  card.innerHTML = `
    <span class="poster">
      <span class="poster-top">${key ? `<kbd class="card-key">${key}</kbd>` : ""}<span class="role-tag"></span></span>
      <span class="hw-part"></span>
      <span class="poster-art">
        <span class="hw-art" style="${iconStyle({ sheet: "hardware", cell: hw.cell })}"></span>
        <span class="card-icon" style="${iconStyle(info.icon)}"></span>
      </span>
      <span class="card-name"></span>
      <span class="card-level"></span>
      <span class="card-desc"></span>
      <span class="card-guide"></span>
      <span class="hw-tag"></span>
    </span>
    <span class="hw-led"></span>
    <span class="hw-pins"></span>`;
  card.querySelector(".role-tag").textContent = role;
  card.querySelector(".hw-part").textContent = hw.part;
  card.querySelector(".card-name").textContent = info.name;
  const rows = skillGuideRows(u);
  if (rows.length) fillGuide(card.querySelector(".card-guide"), rows);
  else card.querySelector(".card-guide").remove();
  if (rare) card.classList.add("rare");
  const tagEl = card.querySelector(".hw-tag");
  tagEl.textContent = tag || "\u00a0"; // an empty tag still keeps its space
  tagEl.classList.toggle("is-empty", !tag);
  return card;
}

// ------------------------------------------------------------ Level up ------
function openLevelUp() {
  progress.pending--;
  progress.level++;
  currentChoices = rollChoices();
  cardsEl.classList.remove("rerolled");
  rerollBtn.classList.remove("spin", "denied");
  renderCards();
  document.getElementById("levelup-title").textContent = `LEVEL ${progress.level}!`;
  levelUpEl.hidden = false;
  levelUpEl.classList.remove("installing");
  pickLock = false;
  levelUpShownAt = performance.now();
  sfx.levelUp.play({ rate: 1.3 });
  clearInput();
  setState("levelup");
  narrator.levelUpOpen(currentChoices); // THE LEGEND reacts to the offer (narrator.js)
  if (!touchMode) narrator.quietly(() => cardsEl.firstElementChild.focus({ preventScroll: true }));
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function renderCards() {
  cardsEl.textContent = "";
  currentChoices.forEach((c, i) => {
    const owned = lv(c.id);
    const steps = c.rare ? 2 : 1;
    // (co-op: the primary / special card upgrades both players' own ICs)
    const tag = c.rare ? "RARE // +2 LEVELS" : isPreferred(c.id) ? "LOADOUT PICK" : coopActive() && (c.id === "zap" || c.id === "flame") ? "BOTH ICs" : null;
    const card = hardwareCard(c.u, { rare: c.rare, key: i + 1, tag });
    card.querySelector(".card-level").textContent = owned ? `LV ${owned} > ${owned + steps}` : c.id === "_heal" ? "" : c.rare ? `NEW! LV ${steps}` : "NEW!";
    const team = teamCard(c.u, steps); // co-op: each IC's own primary / special
    if (team) card.querySelector(".card-name").textContent = team.name;
    card.querySelector(".card-desc").textContent = c.id === "_heal" ? HEAL_CARD.desc[0] : team ? team.desc : describe(c.u, steps);
    if (!owned && c.id !== "_heal") card.classList.add("is-new");
    card.style.setProperty("--d", `${i * 70}ms`);
    card.addEventListener("click", () => chooseUpgrade(i));
    // THE LEGEND explains the card you point at (a long press on touch: narrator.js)
    card.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && narrator.levelUpFocus(i, "hover"));
    card.addEventListener("focus", () => narrator.levelUpFocus(i, "focus"));
    cardsEl.appendChild(card);
  });
  updateRerollBtn();
}

// The reroll button: "3 LEFT" (greyed "NO REROLLS LEFT" at 0), the R key
// and, with a controller, its button.
const rerollCount = document.getElementById("reroll-count");
const rerollPad = document.getElementById("reroll-pad");
function updateRerollBtn() {
  const left = progress.rerolls;
  rerollBtn.disabled = left <= 0;
  rerollCount.textContent = left > 0 ? `${left} LEFT` : "NO REROLLS LEFT";
  rerollBtn.setAttribute("aria-label", left > 0 ? `Reroll the cards: ${left} left` : "No rerolls left");
  const pad = typeof padPrompt === "function" && padPrompt("Y");
  rerollPad.hidden = !pad;
  rerollPad.textContent = pad ? String(pad) : "";
}

// Restart a one-shot CSS animation
function replayClass(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function rerollChoices() {
  if (game.state !== "levelup" || pickLock) return;
  if (progress.rerolls <= 0) {
    replayClass(rerollBtn, "denied");
    narrator.reroll(true);
    return;
  }
  progress.rerolls--;
  currentChoices = rollChoices();
  renderCards();
  replayClass(cardsEl, "rerolled"); // the new cards flip in
  replayClass(rerollBtn, "spin"); // and the die spins
  if (typeof synth !== "undefined") synth.play("reroll");
  else sfx.zapHit.play({ rate: 1.6 });
  vibrate(15);
  narrator.reroll(false);
  // Keep focus on the button if that's what was used (Enter again rerolls again)
  if (!touchMode && (document.activeElement !== rerollBtn || rerollBtn.disabled)) narrator.quietly(() => cardsEl.firstElementChild.focus({ preventScroll: true }));
}
rerollBtn.addEventListener("click", rerollChoices);

// The upgrades are the team's: in co-op every player gets the new stats and the heal
function applyChoice(c) {
  progress.rareCache = false; // spent
  const steps = c.rare ? 2 : 1;
  if (c.id !== "_heal") upg[c.id] = Math.min(upgradeInfo(c.u).max, lv(c.id) + steps);
  forEachPlayer(() => {
    computeStats();
    if (coop.active.out) return; // (waiting for a life: nothing to heal)
    if (c.id === "_heal") player.hp = Math.min(stats.maxHp, player.hp + 40);
    else if (c.id === "heart") player.hp = Math.min(stats.maxHp, player.hp + 20 * steps);
    player.hp = Math.min(stats.maxHp, player.hp + LEVEL_UP_HEAL);
  });
}

// Pick a card. The upgrade applies at once; the "install" animation then
// holds the game paused for half a second. `instant` skips the animation
// (bots and tests).
function chooseUpgrade(i, instant) {
  if (game.state !== "levelup" || pickLock) return;
  // Ignore presses that were meant for the game a split-second earlier
  if (!instant && performance.now() - levelUpShownAt < 350) return;
  const c = currentChoices[i];
  if (!c) return;
  applyChoice(c);
  narrator.levelUpPick(c);
  if (instant) {
    finishLevelUp(c);
    return;
  }
  pickLock = true;
  const cards = [...cardsEl.children];
  cards.forEach((el, k) => el.classList.add(k === i ? "picked" : "dismissed"));
  const chosen = cards[i];
  for (let k = 0; k < 14; k++) {
    const spark = document.createElement("span");
    spark.className = "spark";
    spark.style.setProperty("--a", `${(k / 14) * 360 + Math.random() * 20}deg`);
    spark.style.setProperty("--r", `${120 + Math.random() * 110}px`);
    chosen.appendChild(spark);
  }
  const stamp = document.createElement("span");
  stamp.className = "hw-installed";
  stamp.textContent = c.rare ? "OVERCLOCKED!" : "INSTALLED";
  chosen.appendChild(stamp);
  levelUpEl.classList.add("installing");
  sfx.levelUp.play({ rate: c.rare ? 2.2 : 1.8 });
  sfx.chain.play({ rate: 1.5 });
  vibrate(c.rare ? [20, 30, 40] : 25);
  setTimeout(() => {
    pickLock = false;
    levelUpEl.classList.remove("installing");
    finishLevelUp(c);
  }, 520);
}

function finishLevelUp(c) {
  if (game.state !== "levelup") return;
  const pc = centerOf(player);
  burst(pc.x, pc.y, c.rare ? 40 : 24, c.rare ? "#ff2fd6" : "#ffe14d", 460);
  ring(pc.x, pc.y, c.rare ? 220 : 150, c.rare ? "#ff2fd6" : "#ffe14d");
  popup(upgradeInfo(c.u).name.toUpperCase() + (c.rare ? " +2" : ""), pc.x, player.y - 40, c.rare ? "#ff2fd6" : "#ffe14d", 26, 1.3);
  camera.shake = Math.max(camera.shake, c.rare ? 10 : 5);
  if (Math.random() < 0.5) say("levelUp");
  levelUpEl.hidden = true;
  setState("playing");
}

// Keyboard: 1 / 2 / 3, arrow keys + Enter, R to reroll
function handleLevelUpKey(e) {
  if (pickLock) return;
  const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
  if (n !== undefined) {
    e.preventDefault();
    chooseUpgrade(n);
    return;
  }
  if (e.code === "KeyR") {
    e.preventDefault();
    if (!e.repeat) rerollChoices();
    return;
  }
  const cards = [...cardsEl.children];
  const idx = cards.indexOf(document.activeElement);
  if (["ArrowRight", "ArrowDown", "KeyD", "KeyS"].includes(e.code)) {
    e.preventDefault();
    cards[(idx + 1) % cards.length].focus();
  } else if (["ArrowLeft", "ArrowUp", "KeyA", "KeyW"].includes(e.code)) {
    e.preventDefault();
    cards[(idx - 1 + cards.length) % cards.length].focus();
  } else if (e.code === "Enter" || e.code === "Space") {
    e.preventDefault();
    if (document.activeElement === rerollBtn) rerollChoices();
    else if (!e.repeat) chooseUpgrade(Math.max(0, idx));
  }
}

// ---------------------------------------------------------- THE LEGEND ------
// A hologram that types out his lines, talking while he types: his lines,
// moods and voice hooks live in narrator.js (narrator.say)
const levelUpLegend = document.getElementById("legend-levelup");
const loadoutLegend = document.getElementById("legend-loadout");

// ------------------------------------------------------- Pre-drop loadout ---
const loadoutEl = document.getElementById("loadout");
const loadoutGrid = document.getElementById("loadout-grid");
const loadoutCount = document.getElementById("loadout-count");
const dropBtn = document.getElementById("drop-btn");

function openLoadout() {
  settings.loadout = validLoadout();
  renderLoadout();
  loadoutEl.hidden = false;
  overlay.hidden = true;
  narrator.loadoutOpen();
  if (!touchMode) dropBtn.focus({ preventScroll: true });
}

function closeLoadout() {
  loadoutEl.hidden = true;
  overlay.hidden = false;
}

// A loadout pick starts one level above the base (2 for the primary/special)
const startLevel = (u) => Math.min(upgradeInfo(u).max, baseLevel(u.id) + 1);

function renderLoadout() {
  const chosen = validLoadout();
  loadoutGrid.textContent = "";
  UPGRADES.forEach((u) => {
    const card = hardwareCard(u, { tag: chosen.includes(u.id) ? `SLOT ${chosen.indexOf(u.id) + 1}` : "+ ADD" });
    card.setAttribute("aria-pressed", String(chosen.includes(u.id)));
    const level = card.querySelector(".card-level");
    level.innerHTML = `<span class="lv-kind">${u.weapon ? "WEAPON" : "PASSIVE"} · </span>`;
    level.append(`LV ${startLevel(u)}`);
    card.querySelector(".card-desc").textContent = descAt(u, 1); // what it does (the spec sheet adds the loadout level)
    card.addEventListener("click", () => toggleLoadout(u.id));
    card.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      showLoadoutSpec(u.id);
      narrator.loadoutFocus(u.id, "hover");
    });
    card.addEventListener("focus", () => {
      showLoadoutSpec(u.id);
      narrator.loadoutFocus(u.id, "focus");
    });
    loadoutGrid.append(card);
  });
  loadoutCount.textContent = `${chosen.length}/2`;
  dropBtn.disabled = chosen.length < 2;
  showLoadoutSpec(loadoutSpecId || chosen[0] || UPGRADES[0].id);
}

// The spec sheet: the full guidance for the card you point at, tap or focus
// (on phones the cards are too small to carry it themselves)
const loadoutSpec = document.getElementById("loadout-spec");
let loadoutSpecId = null;
function showLoadoutSpec(id) {
  const u = UPGRADES.find((x) => x.id === id) || UPGRADES[0];
  loadoutSpecId = u.id;
  const info = upgradeInfo(u);
  const role = skillRole(u);
  const hw = HARDWARE[u.id] || HARDWARE._heal;
  const slot = validLoadout().indexOf(u.id);
  loadoutSpec.className = `loadout-spec hw-${hw.kind} role-${role.toLowerCase()}`;
  loadoutSpec.dataset.id = u.id;
  loadoutSpec.innerHTML = `<span class="spec-head"><span class="role-tag"></span><b class="spec-name"></b></span><span class="spec-sub"></span><span class="spec-desc"></span><span class="spec-rows"></span><span class="spec-slot"></span>`;
  loadoutSpec.querySelector(".role-tag").textContent = role;
  loadoutSpec.querySelector(".spec-name").textContent = info.name.toUpperCase();
  loadoutSpec.querySelector(".spec-sub").textContent = `${hw.part} · ${u.weapon ? "WEAPON" : "PASSIVE"} · STARTS AT LV ${startLevel(u)} OF ${info.max}`;
  const start = startLevel(u);
  loadoutSpec.querySelector(".spec-desc").textContent = descAt(u, 1) + (start > 1 ? ` LV ${start}: ${descAt(u, start)}` : "");
  fillGuide(loadoutSpec.querySelector(".spec-rows"), skillGuideRows(u));
  loadoutSpec.querySelector(".spec-slot").textContent = slot >= 0 ? `IN SLOT ${slot + 1}` : touchMode ? "TAP TO ADD" : "CLICK TO ADD";
}

function toggleLoadout(id) {
  let l = validLoadout();
  let kind = "add";
  if (l.includes(id)) {
    l = l.filter((x) => x !== id);
    kind = "remove";
  } else {
    l.push(id);
    if (l.length > 2) {
      l.shift(); // replace the oldest pick
      kind = "swap";
    }
  }
  loadoutSpecId = id;
  settings.loadout = l;
  applySettings();
  const focusedIdx = [...loadoutGrid.children].indexOf(document.activeElement);
  renderLoadout();
  if (focusedIdx >= 0) narrator.quietly(() => loadoutGrid.children[focusedIdx].focus({ preventScroll: true }));
  sfx.zapHit.play({ rate: 1.4 });
  narrator.loadoutToggle(id, kind, l.length);
}

function dropIn() {
  if (validLoadout().length < 2) return;
  loadoutEl.hidden = true;
  startGame();
}
dropBtn.addEventListener("click", dropIn);
document.getElementById("loadout-back").addEventListener("click", closeLoadout);

function handleLoadoutKey(e) {
  if (e.code === "Escape") {
    e.preventDefault();
    closeLoadout();
    return;
  }
  const cards = [...loadoutGrid.children];
  const idx = cards.indexOf(document.activeElement);
  if (idx >= 0 && ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.code)) {
    e.preventDefault();
    const cols = Math.max(1, cards.filter((c) => c.offsetTop === cards[0].offsetTop).length);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.code];
    cards[clamp(idx + step, 0, cards.length - 1)].focus();
  } else if (e.code === "Enter" || e.code === "Space") {
    if (idx >= 0 || e.repeat) return; // the focused card/button clicks itself
    if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
    e.preventDefault();
    dropIn();
  }
}

// ------------------------------------------------------------- Respec -------
// Refund every skill point (levels above the base) and spend them again.
const respecEl = document.getElementById("respec");
const respecList = document.getElementById("respec-list");
const respecPoints = document.getElementById("respec-points");
const respecApply = document.getElementById("respec-apply");
const respec = { draft: {}, total: 0 };
const baseLevel = (id) => (id === "zap" || id === "flame" ? 1 : 0);
const spent = (levels) => UPGRADES.reduce((a, u) => a + Math.max(0, (levels[u.id] || 0) - baseLevel(u.id)), 0);

function openRespec() {
  respec.draft = {};
  UPGRADES.forEach((u) => (respec.draft[u.id] = lv(u.id)));
  respec.total = spent(respec.draft);
  respecEl.hidden = false;
  overlay.hidden = true;
  renderRespec();
  narrator.respecOpen();
}

function closeRespec() {
  respecEl.hidden = true;
  overlay.hidden = false;
}

function renderRespec() {
  const left = respec.total - spent(respec.draft);
  respecPoints.textContent = `${left} / ${respec.total} POINTS FREE`;
  respecApply.disabled = left !== 0;
  respecApply.textContent = left ? `Spend ${left} more` : "Apply";
  respecList.textContent = "";
  UPGRADES.forEach((u) => {
    const info = upgradeInfo(u);
    const level = respec.draft[u.id];
    const row = document.createElement("div");
    row.className = "respec-row";
    row.innerHTML = `<span class="card-icon" style="${iconStyle(info.icon)}"></span><span class="respec-name"></span><span class="respec-pips"></span><button type="button" class="respec-btn" data-d="-1" aria-label="Remove a point">-</button><button type="button" class="respec-btn" data-d="1" aria-label="Add a point">+</button>`;
    row.querySelector(".respec-name").textContent = info.name;
    row.querySelector(".respec-pips").textContent = "■".repeat(level) + "□".repeat(info.max - level);
    const [minus, plus] = row.querySelectorAll("button");
    minus.disabled = level <= baseLevel(u.id);
    plus.disabled = level >= info.max || left <= 0;
    [minus, plus].forEach((b) =>
      b.addEventListener("click", () => {
        respec.draft[u.id] = clamp(level + Number(b.dataset.d), baseLevel(u.id), info.max);
        renderRespec();
        const again = respecList.children[UPGRADES.indexOf(u)].querySelectorAll("button")[b.dataset.d === "1" ? 1 : 0];
        if (!again.disabled) again.focus({ preventScroll: true });
      })
    );
    respecList.append(row);
  });
}

function applyRespec() {
  if (respec.total - spent(respec.draft) !== 0) return;
  Object.keys(upg).forEach((k) => delete upg[k]);
  Object.entries(respec.draft).forEach(([id, n]) => n && (upg[id] = n));
  forEachPlayer(() => {
    computeStats();
    player.hp = Math.min(player.hp, stats.maxHp);
  });
  closeRespec();
  narrator.respecApply(overlayText);
  sfx.levelUp.play({ rate: 1.1 });
}
respecApply.addEventListener("click", applyRespec);
document.getElementById("respec-reset").addEventListener("click", () => {
  UPGRADES.forEach((u) => (respec.draft[u.id] = baseLevel(u.id)));
  renderRespec();
  narrator.respecReset();
});
document.getElementById("respec-cancel").addEventListener("click", closeRespec);
