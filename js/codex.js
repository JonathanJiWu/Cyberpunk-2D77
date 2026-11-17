"use strict";
// =============================================================================
// Menus built from the database: the Individual Contributor cards and the
// DATABASE screen (ICs, enemies, bosses and skills). Enemies and bosses
// stay locked until you've met them.
// =============================================================================

// Draw one sprite cell onto a small canvas (waits for the image if needed)
function spriteCanvas(name, sx, sy, sw, sh, size, locked) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.className = "codex-sprite";
  const paint = () => {
    const img = IMG[name];
    if (!isReady(img)) return;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    const k = Math.min(size / sw, size / sh);
    const w = sw * k;
    const h = sh * k;
    g.clearRect(0, 0, size, size);
    g.drawImage(img, sx, sy, sw, sh, (size - w) / 2, (size - h) / 2, w, h);
    if (locked) {
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = "#120826";
      g.fillRect(0, 0, size, size);
    }
  };
  if (isReady(IMG[name])) paint();
  else if (IMG[name]) IMG[name].addEventListener("load", paint);
  return c;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function statBar(label, value, color) {
  const row = el("div", "stat");
  row.append(el("span", "stat-label", label));
  const bar = el("span", "stat-bar");
  const fill = el("span", "stat-fill");
  fill.style.width = `${Math.round(clamp(value, 0.04, 1) * 100)}%`;
  fill.style.background = color;
  bar.append(fill);
  row.append(bar);
  return row;
}

function portraitCanvas(ch, size) {
  const own = isReady(IMG.portraits);
  return own ? spriteCanvas("portraits", ch.portrait * 48, 0, 48, 48, size) : spriteCanvas(CHARACTERS.paine.sprite.img, 0, 0, 32, 48, size);
}

// ------------------------------------------------------- Character select ---
const charSelectEl = document.getElementById("char-select");
function renderCharSelect() {
  charSelectEl.textContent = "";
  CHARACTER_ORDER.forEach((id) => {
    const ch = CHARACTERS[id];
    const card = el("button", "char-card");
    card.type = "button";
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", String(settings.character === id));
    card.style.setProperty("--c", ch.color);
    card.append(portraitCanvas(ch, 72));
    const info = el("span", "char-info");
    info.append(el("span", "char-name", ch.name), el("span", "char-title", ch.title));
    info.append(statBar("HP", ch.hp / 160, "#ff2f6d"), statBar("ARMOR", ch.armor / 0.25, "#19f5ff"));
    info.append(el("span", "char-kit", `${ch.primary.name} + ${ch.special.name}`));
    card.append(info);
    card.addEventListener("click", () => {
      if (game.state === "paused") switchCharacter(id); // hot-swap mid-run
      else {
        settings.character = id;
        applySettings();
      }
      renderCharSelect();
    });
    charSelectEl.append(card);
  });
}
renderCharSelect();
// Portraits load after the menu is built: refresh once they arrive
if (IMG.portraits) IMG.portraits.addEventListener("load", renderCharSelect);

// ---------------------------------------------------------------- Codex -----
const codexEl = document.getElementById("codex");
const codexBody = document.getElementById("codex-body");
let codexTab = "characters";

function openCodex() {
  codexEl.hidden = false;
  renderCodex();
}
function closeCodex() {
  codexEl.hidden = true;
}
document.getElementById("codex-btn").addEventListener("click", openCodex);
document.getElementById("codex-close").addEventListener("click", closeCodex);
document.querySelectorAll("[data-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    codexTab = b.dataset.tab;
    renderCodex();
  })
);

function entry(locked) {
  const card = el("article", "codex-entry" + (locked ? " locked" : ""));
  return card;
}

function renderCodex() {
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === codexTab)));
  codexBody.textContent = "";
  codexBody.scrollTop = 0;
  if (codexTab === "characters") {
    CHARACTER_ORDER.forEach((id) => {
      const ch = CHARACTERS[id];
      const card = entry(false);
      card.style.setProperty("--c", ch.color);
      card.append(portraitCanvas(ch, 96));
      const info = el("div", "codex-info");
      info.append(el("h3", "", `${ch.name} // ${ch.title}`));
      info.append(statBar("HP", ch.hp / 160, "#ff2f6d"), statBar("ARMOR", ch.armor / 0.25, "#19f5ff"), statBar("SPEED", ch.speed / 480, "#ffe14d"));
      info.append(el("p", "codex-kit", `PRIMARY: ${ch.primary.name}. ${ch.primary.desc[0]}`));
      info.append(el("p", "codex-kit", `SPECIAL (${ch.resource.name}): ${ch.special.name}. ${ch.special.desc[0]}`));
      info.append(el("p", "codex-kit", `PASSIVE: ${ch.passive}`));
      info.append(el("p", "codex-quote", `"${ch.quotes.start[0]}"`));
      info.append(el("p", "codex-lore", ch.lore));
      card.append(info);
      codexBody.append(card);
    });
  } else if (codexTab === "enemies") {
    const ids = Object.keys(ENEMY_TYPES).sort((a, b) => ENEMY_TYPES[a].from - ENEMY_TYPES[b].from);
    const known = ids.filter((id) => discovered.has(id)).length;
    codexBody.append(el("p", "codex-count", `${known}/${ids.length} ENTRIES DECRYPTED`));
    ids.forEach((id) => {
      const d = ENEMY_TYPES[id];
      const locked = !discovered.has(id);
      const card = entry(locked);
      const s = d.sheet;
      const img = isReady(IMG[s.img]) || !s.fallback ? s.img : s.fallback;
      const row = s.flip ? 0 : s.rowRight;
      card.append(spriteCanvas(img, 0, row * s.fh, s.fw, s.fh, 96, locked));
      const info = el("div", "codex-info");
      if (locked) {
        info.append(el("h3", "", "??? // ENCRYPTED"), el("p", "codex-lore", `Appears around ${formatTime(d.from)} into a run.`));
      } else {
        const kind = { melee: "MELEE", ranged: "RANGED", bomber: "KAMIKAZE", sniper: "SNIPER" }[d.kind];
        info.append(el("h3", "", `${d.name} // ${kind}${d.walker ? ", WALKER" : ", FLYER"}`));
        info.append(statBar("HP", d.hp / 70, "#ff2f6d"), statBar("DAMAGE", (d.shot ? d.shot.damage : d.damage) / 16, "#ff9b21"), statBar("SPEED", d.speed / 300, "#ffe14d"));
        info.append(el("p", "codex-kit", d.desc), el("p", "codex-lore", d.lore));
      }
      card.append(info);
      codexBody.append(card);
    });
  } else if (codexTab === "bosses") {
    Object.entries(BOSSES).forEach(([id, b]) => {
      const locked = !discovered.has(id);
      const card = entry(locked);
      const sh = isReady(IMG[b.sheet.img]) ? b.sheet : b.fallback;
      card.append(spriteCanvas(sh.img, 0, 0, sh.fw, sh.fh, 120, locked));
      const info = el("div", "codex-info");
      if (locked) info.append(el("h3", "", `??? // ${b.title.toUpperCase()}`), el("p", "codex-lore", "Survive long enough to meet it."));
      else {
        info.append(el("h3", "", `${b.name} // ${b.title.toUpperCase()}`), statBar("HP", b.hp / 5000, "#ff2457"));
        info.append(el("p", "codex-kit", b.desc), el("p", "codex-lore", b.lore));
      }
      card.append(info);
      codexBody.append(card);
    });
  } else {
    // Skills: each IC's own two, then the shared ones
    CHARACTER_ORDER.forEach((id) => {
      const ch = CHARACTERS[id];
      [ch.primary, ch.special].forEach((u) => codexBody.append(skillEntry(u.name, u.icon, u.desc, `${ch.name} ONLY`, ch.color)));
    });
    UPGRADES.filter((u) => u.id !== "zap" && u.id !== "flame").forEach((u) => {
      const desc = u.desc.length > 1 ? u.desc : [u.desc[0].replace("{resource}", "heat/focus/RAM")];
      codexBody.append(skillEntry(u.name, { sheet: "icons", cell: u.icon }, desc, u.weapon ? "WEAPON" : `PASSIVE, UP TO LV ${u.max}`, "#ffe14d"));
    });
  }
}

function skillEntry(name, icon, desc, tag, color) {
  const card = entry(false);
  card.classList.add("skill");
  card.style.setProperty("--c", color);
  const size = icon.sheet === "fx" ? 32 : 24;
  card.append(spriteCanvas(icon.sheet, icon.cell * size, 0, size, size, 56));
  const info = el("div", "codex-info");
  info.append(el("h3", "", `${name} // ${tag}`));
  const list = el("ol", "codex-levels");
  desc.forEach((d) => list.append(el("li", "", d)));
  info.append(list);
  card.append(info);
  return card;
}
