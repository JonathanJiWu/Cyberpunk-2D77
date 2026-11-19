"use strict";
// =============================================================================
// The Individual Contributor select: the centrepiece of the start menu, the
// game-over screen and the pause menu's hot-swap (all in #char-select), plus
// the art and text the co-op join screen draws for player 2 (coop.js).
//   Tiles:  three .char-card buttons (role=radio). Click, tap, Enter or A
//           picks (mid-run: switches). Hovering or focusing one (arrows, the
//           D-pad, Tab) shows its dossier on the stage beside them.
//   Stage:  a big bust, name and title, personality, background, weapon and
//           abilities, playstyle, mechanics, base stats and a quote, themed
//           in the IC's colour (ch.color) and resource colour.
//   Busts:  img/bust-<id>.png (192x240) when the IC has one (ch.bust), else
//           the HUD portrait cut out of its frame. Pixel art is always shown
//           at a whole number of device pixels per art pixel, so it stays crisp.
// =============================================================================

const charSelectEl = document.getElementById("char-select");
const charSel = { cards: [], stage: null, art: null, preview: null, shown: null };
const DIFFICULTY = ["", "EASY", "MEDIUM", "HARD"];
const IC_BUST = { w: 192, h: 240 }; // the bust contract (IC ART)

// "#ff2457" -> "255, 36, 87", for rgba() in the CSS
function hexRgb(hex) {
  const n = parseInt(String(hex).replace("#", "").slice(0, 6), 16) || 0;
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// --c / --c-rgb: the IC's colour, --r: its resource colour
function icTheme(node, ch) {
  node.style.setProperty("--c", ch.color);
  node.style.setProperty("--c-rgb", hexRgb(ch.color));
  node.style.setProperty("--r", ch.resource.color);
}

const icProfile = (ch) => ch.profile || {};
const passiveName = (ch) => String(ch.passive || "").split(":")[0];
const swapMode = () => typeof game !== "undefined" && game.state === "paused";

// --------------------------------------------------------------- The art ---
// The 48x48 HUD portrait without its frame and striped backdrop (flood-filled
// away from the edges; the outline stops the fill): the fallback bust
const cutouts = {};
function portraitCutout(ch) {
  const sheet = isReady(IMG.portraits2) ? "portraits2" : isReady(IMG.portraits) ? "portraits" : null;
  if (!sheet) return null;
  const key = sheet + ch.portrait;
  if (cutouts[key]) return cutouts[key];
  const n = 42;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  g.drawImage(IMG[sheet], ch.portrait * 48 + 3, 3, n, n, 0, 0, n, n);
  try {
    const data = g.getImageData(0, 0, n, n);
    const px = data.data;
    const backdrop = (i) => (px[i] === 52 && px[i + 1] === 19 && px[i + 2] === 95) || (px[i] === 26 && px[i + 1] === 11 && px[i + 2] === 46);
    const seen = new Uint8Array(n * n);
    const todo = [];
    for (let i = 0; i < n; i++) todo.push(i, (n - 1) * n + i, i * n, i * n + n - 1);
    while (todo.length) {
      const p = todo.pop();
      if (seen[p] || !backdrop(p * 4)) continue;
      seen[p] = 1;
      px[p * 4 + 3] = 0;
      const x = p % n;
      if (x > 0) todo.push(p - 1);
      if (x < n - 1) todo.push(p + 1);
      if (p >= n) todo.push(p - n);
      if (p < n * (n - 1)) todo.push(p + n);
    }
    g.putImageData(data, 0, 0);
  } catch (err) {
    /* a canvas the page may not read (file://): keep the backdrop */
  }
  return (cutouts[key] = c);
}

// For the canvas (the co-op join screen): the loaded bust, or the cut-out
function icBustArt(id) {
  const img = IMG["bust_" + id];
  if (isReady(img)) return { img, w: img.naturalWidth, h: img.naturalHeight, bust: true };
  const cut = portraitCutout(CHARACTERS[id] || CHARACTERS.paine);
  return cut ? { img: cut, w: cut.width, h: cut.height, bust: false } : null;
}

// For the stage: an <img> of the bust (kept, so it loads once), or a copy of
// the cut-out. A bust that fails to load falls back for good.
const bustImgs = {};
function stageArt(id) {
  const ch = CHARACTERS[id];
  if (ch.bust) {
    let img = bustImgs[id];
    if (!img) {
      img = bustImgs[id] = new Image();
      img.className = "cs-bust";
      img.alt = "";
      img.addEventListener("load", () => charSel.shown === id && fitStageArt());
      img.addEventListener("error", () => {
        img.failed = true;
        if (charSel.shown === id) renderStage(true);
      });
      img.src = ch.bust;
    }
    if (!img.failed) return img;
  }
  const cut = portraitCutout(ch);
  if (!cut) return null;
  const c = document.createElement("canvas");
  c.className = "cs-bust cs-cutout";
  c.width = cut.width;
  c.height = cut.height;
  c.getContext("2d").drawImage(cut, 0, 0);
  return c;
}

// The biggest whole number of device pixels per art pixel that fits the box
// (a bust may overhang it a hair: its bottom edge is cropped, never the head)
function pixelFit(art, boxW, boxH, w, h, room) {
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.floor(Math.min(boxW / w, boxH / h) * dpr * room)) / dpr;
  art.style.width = w * k + "px";
  art.style.height = h * k + "px";
  return { w: w * k, h: h * k };
}

function fitStageArt() {
  const frame = charSel.art;
  const art = frame && frame.querySelector(".cs-bust");
  if (!art || !frame.clientWidth) return; // hidden: the ResizeObserver calls again
  const fw = frame.clientWidth;
  const fh = frame.clientHeight;
  const cut = art.classList.contains("cs-cutout");
  const w = cut ? art.width : art.naturalWidth || IC_BUST.w;
  const h = cut ? art.height : art.naturalHeight || IC_BUST.h;
  const s = pixelFit(art, fw, fh, w, h, cut ? 0.84 : 1.04);
  art.style.left = Math.round((fw - s.w) / 2) + "px";
  art.style.top = Math.round(Math.max(0, fh - s.h)) + "px";
}

// The tiles' little HUD portraits, at whole device-pixel scales too
function fitTileArt() {
  charSel.cards.forEach((card) => {
    const box = card.querySelector(".cs-tile-art");
    const c = box && box.querySelector("canvas");
    if (c && box.clientWidth) pixelFit(c, box.clientWidth, box.clientHeight, 48, 48, 1);
  });
}

const fitAll = () => {
  fitStageArt();
  fitTileArt();
};
const artObserver = typeof ResizeObserver === "function" ? new ResizeObserver(fitAll) : null;
addEventListener("resize", fitAll);

// ------------------------------------------------------------- The tiles ---
function buildCharSelect() {
  charSelectEl.textContent = "";
  charSel.cards = CHARACTER_ORDER.map((id) => {
    const ch = CHARACTERS[id];
    const card = el("button", "char-card");
    card.type = "button";
    card.dataset.ic = id;
    card.setAttribute("role", "radio");
    card.setAttribute("aria-label", `${ch.name}, ${ch.title}${icProfile(ch).role ? ", " + icProfile(ch).role.toLowerCase() : ""}`);
    icTheme(card, ch);
    const art = el("span", "cs-tile-art");
    art.append(portraitCanvas(ch, 48));
    const info = el("span", "char-info");
    info.append(el("span", "char-name", ch.name), el("span", "char-title", ch.title), el("span", "cs-tile-role", icProfile(ch).role || ""));
    card.append(art, info, el("span", "cs-tile-state"), el("span", "cs-badges"));
    card.addEventListener("click", () => pickIC(id));
    card.addEventListener("focus", () => previewIC(id));
    card.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && previewIC(id));
    charSelectEl.append(card);
    if (artObserver) artObserver.observe(art);
    return card;
  });
  // The stage comes after the tiles (they stay .char-card:nth-child(1..3))
  const stage = el("div", "cs-stage");
  const art = el("div", "cs-art");
  art.setAttribute("aria-hidden", "true");
  art.append(el("span", "cs-art-word"), el("span", "cs-art-glow"), el("span", "cs-art-floor"), el("span", "cs-art-scan"));
  stage.append(art, el("div", "cs-head"), el("div", "cs-body"));
  charSelectEl.append(stage);
  charSel.stage = stage;
  charSel.art = art;
  charSel.shown = null;
  if (artObserver) artObserver.observe(art);
}

// The pick: player 2's pad picks for player 2 (coop.js), the pause menu
// hot-swaps (lives.js), the menus set the IC for the next run
function pickIC(id) {
  if (coopPickChar(id)) {
    // player 2's IC (switched straight away if they're in a run)
  } else if (game.state === "paused") switchCharacter(id);
  else {
    settings.character = id;
    applySettings();
  }
  padSound("uiSelect");
  renderCharSelect();
  const card = charSel.cards[CHARACTER_ORDER.indexOf(id)];
  if (card && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    card.classList.remove("cs-locked");
    void card.offsetWidth; // restart the lock-in flash
    card.classList.add("cs-locked");
  }
}

// What the stage shows: the hovered / focused tile, else the picked IC
function shownIC() {
  const id = charSel.preview || settings.character;
  return CHARACTERS[id] ? id : CHARACTER_ORDER[0];
}

function previewIC(id) {
  if (charSel.preview === id) return;
  charSel.preview = id;
  renderTiles();
  renderStage();
}

// The mouse left the select: back to the focused tile, or the picked IC
charSelectEl.addEventListener("pointerleave", (e) => {
  if (e.pointerType !== "mouse") return;
  const f = document.activeElement;
  previewIC(f && f.dataset && f.dataset.ic && charSelectEl.contains(f) ? f.dataset.ic : null);
});
charSelectEl.addEventListener("focusout", (e) => {
  if (charSelectEl.contains(e.relatedTarget) || charSelectEl.matches(":hover")) return;
  previewIC(null);
});

// Arrow keys on a tile move between the three, wrapping (handleMenuKey in
// main.js; the D-pad's left / right comes through here too, gamepad.js)
function charSelectKey(e) {
  const card = document.activeElement;
  const i = charSel.cards.indexOf(card);
  const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.code];
  if (i < 0 || !step) return false;
  e.preventDefault();
  const next = charSel.cards[(i + step + charSel.cards.length) % charSel.cards.length];
  next.focus({ preventScroll: true });
  try {
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch (err) {
    /* old browsers */
  }
  padSound("uiMove");
  return true;
}

// Badges, state chips and the roving tab stop (Tab enters the group on the
// focused or picked tile; arrows move inside it)
function renderTiles() {
  const swap = swapMode();
  const seat = typeof coop !== "undefined" && coop.seat;
  const focused = charSel.cards.includes(document.activeElement) ? document.activeElement : null;
  const shown = shownIC();
  charSelectEl.classList.toggle("cs-swapping", swap);
  charSel.cards.forEach((card) => {
    const id = card.dataset.ic;
    const mine = settings.character === id;
    card.setAttribute("aria-checked", String(mine));
    card.tabIndex = (focused ? card === focused : mine) ? 0 : -1;
    card.classList.toggle("cs-on", id === shown);
    card.querySelector(".cs-tile-state").textContent = mine ? (swap ? "ACTIVE" : "SELECTED") : swap ? "SWITCH" : "";
    const badges = card.querySelector(".cs-badges");
    badges.textContent = "";
    if (seat && mine) badges.append(el("span", "char-p1", "P1"));
    if (seat && seat.char === id) badges.append(el("span", "char-p2", "P2")); // co-op: player 2's pick
  });
}

// ------------------------------------------------------------- The stage ---
// The prompt for a pick on the device in use: "A", "TAP", "CLICK / ENTER"
function pickPrompt() {
  const pad = padPrompt("A");
  if (pad) {
    const k = el("b", "pad-key");
    padLabel(k, pad);
    return k;
  }
  return el("b", "cs-key", touchMode ? "TAP" : "CLICK / ENTER");
}

function abilityRow(kind, name, text, icon) {
  const li = el("li", "cs-ability");
  const ic = el("span", "cs-icon");
  ic.setAttribute("style", iconStyle(icon));
  const words = el("span", "cs-ab-text");
  words.append(el("span", "cs-ab-kind", kind), el("b", "cs-ab-name", name), el("span", "", text));
  li.append(ic, words);
  return li;
}

function statRow(label, frac, value, color) {
  const row = el("div", "cs-stat");
  const bar = el("span", "cs-stat-bar");
  const fill = el("span", "cs-stat-fill");
  fill.style.width = `${Math.round(frac * 100)}%`;
  fill.style.setProperty("--s", color);
  bar.append(fill);
  row.append(el("span", "cs-stat-label", label), bar, el("span", "cs-stat-value", value));
  return row;
}

// The line under the name: picked / active, or how to pick / switch
function stageStatus(id) {
  const swap = swapMode();
  const line = el("div", "cs-status");
  if (id === settings.character) {
    line.classList.add("cs-status-on");
    line.append(el("span", "cs-mark"), el("span", "", swap ? "DEPLOYED" : "SELECTED"));
  } else {
    line.append(pickPrompt(), el("span", "", swap ? ` TO HOT-SWAP TO ${CHARACTERS[id].name}` : " TO SELECT"));
  }
  const seat = typeof coop !== "undefined" && coop.seat;
  if (seat && id === settings.character) line.append(el("span", "char-p1", "P1"));
  if (seat && seat.char === id) line.append(el("span", "char-p2", "P2"));
  return line;
}

function renderStage(force) {
  const stage = charSel.stage;
  if (!stage) return;
  const id = shownIC();
  stage.classList.toggle("cs-swap", swapMode());
  stage.classList.toggle("cs-current", id === settings.character);
  const head = stage.querySelector(".cs-head");
  if (!force && id === charSel.shown) {
    const line = head.querySelector(".cs-status");
    if (line) line.replaceWith(stageStatus(id)); // the same IC: just the pick line
    return;
  }
  const ch = CHARACTERS[id];
  const pf = icProfile(ch);
  charSel.shown = id;
  stage.dataset.ic = id;
  icTheme(stage, ch);
  // the art: the bust (or the cut-out portrait) and the IC's name behind it
  const art = charSel.art;
  art.querySelector(".cs-art-word").textContent = ch.name;
  const old = art.querySelector(".cs-bust");
  const node = stageArt(id);
  if (old && old !== node) old.remove();
  if (node && node.parentNode !== art) art.insertBefore(node, art.querySelector(".cs-art-scan"));
  fitStageArt();
  // name, title, role, difficulty, personality and the pick line
  head.textContent = "";
  const tags = el("div", "cs-tags");
  if (pf.role) tags.append(el("span", "cs-chip", pf.role));
  if (pf.difficulty) {
    const d = el("span", "cs-chip cs-diff", `DIFFICULTY ${DIFFICULTY[pf.difficulty] || ""}`);
    d.setAttribute("aria-label", `Difficulty: ${(DIFFICULTY[pf.difficulty] || "").toLowerCase()}`);
    for (let i = 1; i <= 3; i++) d.append(el("i", i <= pf.difficulty ? "on" : ""));
    tags.append(d);
  }
  head.append(tags, el("div", "cs-name", ch.name), el("div", "cs-title", ch.title.toUpperCase()));
  if (pf.personality) head.append(el("div", "cs-personality", pf.personality));
  head.append(stageStatus(id));
  // the dossier
  const body = stage.querySelector(".cs-body");
  body.textContent = "";
  if (pf.background) body.append(el("div", "cs-bg", pf.background));
  const kit = el("ul", "cs-abilities");
  kit.append(abilityRow("WEAPON", ch.primary.name, pf.weapon || ch.primary.desc[0], ch.primary.icon));
  const sg = ch.special.guide || {};
  kit.append(abilityRow(`SPECIAL · USES ${ch.resource.name}`, ch.special.name, sg.what ? `${sg.what}. ${sg.edge}.` : ch.special.desc[0], ch.special.icon));
  if (pf.passive) kit.append(abilityRow("PASSIVE", passiveName(ch), pf.passive.text, pf.passive.icon));
  body.append(kit);
  if (pf.playstyle) {
    const play = el("div", "cs-play");
    play.append(el("span", "cs-k", "PLAYSTYLE "), pf.playstyle);
    body.append(play);
  }
  if (pf.mechanics && pf.mechanics.length) {
    const mech = el("ul", "cs-mech");
    pf.mechanics.forEach((m) => mech.append(el("li", "", m)));
    body.append(mech);
  }
  const res = el("div", "cs-res");
  res.append(el("span", "cs-res-name", ch.resource.name), pf.resource || "Builds as you deal and take damage.");
  body.append(res);
  const stats = el("div", "cs-stats");
  stats.append(
    statRow("HP", icStatFrac(ch, "hp"), String(ch.hp), "#ff2f6d"),
    statRow("ARMOR", icStatFrac(ch, "armor"), `${Math.round(ch.armor * 100)}%`, "#19f5ff"),
    statRow("SPEED", icStatFrac(ch, "speed"), String(ch.speed), "#ffe14d"),
    statRow("JUMP", icStatFrac(ch, "jump"), String(ch.jump), "#b06cff")
  );
  body.append(stats);
  if (ch.quotes && ch.quotes.start) body.append(el("div", "cs-quote", `"${ch.quotes.start[0]}"`));
  // the pause menu: what a hot-swap keeps
  body.append(el("div", "cs-swapnote", "A HOT-SWAP KEEPS YOUR LEVELS, UPGRADES, LIVES AND RESOURCE METER. HP KEEPS ITS %."));
  stage.classList.remove("cs-enter");
  void stage.offsetWidth; // replay the entrance
  stage.classList.add("cs-enter");
}

// Called by the menus (main.js showOverlay, coop.js): the tiles' state and
// the stage, rebuilt in place so the focus stays where it is
function renderCharSelect() {
  if (!charSel.stage || !charSelectEl.contains(charSel.stage)) buildCharSelect();
  const f = document.activeElement;
  if (!(charSel.cards.includes(f) || charSelectEl.matches(":hover"))) charSel.preview = null;
  renderTiles();
  renderStage();
}

renderCharSelect();
// Portraits (and their cut-outs) load after the menu is built: rebuild with
// the newest sheet, keeping the focus on the same tile
["portraits", "portraits2"].forEach((name) =>
  IMG[name] && IMG[name].addEventListener("load", () => {
    const i = charSel.cards.indexOf(document.activeElement);
    buildCharSelect();
    renderCharSelect();
    if (i >= 0) charSel.cards[i].focus({ preventScroll: true });
  })
);
// The pick prompt follows the device (keyboard, touch or a pad)
addEventListener("padchange", () => charSel.stage && renderStage());
