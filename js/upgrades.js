"use strict";
// =============================================================================
// XP and the Vampire Survivors style level-up: pick 1 of 3 random upgrades.
// =============================================================================

const progress = { level: 1, xp: 0, pending: 0 };
const levelUpEl = document.getElementById("levelup");
const cardsEl = document.getElementById("cards");
let currentChoices = [];
let levelUpShownAt = 0;

function resetProgress() {
  progress.level = 1;
  progress.xp = 0;
  progress.pending = 0;
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

function rollChoices() {
  const available = UPGRADES.filter((u) => lv(u.id) < u.max);
  // Shuffle and take 3 (Fisher-Yates)
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  const picks = available.slice(0, 3);
  // Everything maxed out: offer a heal instead
  if (!picks.length) picks.push({ id: "_heal", name: "Repair Kit", icon: 6, max: 99, desc: ["Heal 40 HP."] });
  return picks;
}

function describe(u) {
  const next = lv(u.id) + 1;
  return u.desc[Math.min(next - 1, u.desc.length - 1)];
}

function openLevelUp() {
  progress.pending--;
  progress.level++;
  currentChoices = rollChoices();
  cardsEl.textContent = "";
  currentChoices.forEach((u, i) => {
    const owned = lv(u.id);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    card.innerHTML = `
      <span class="card-key">${i + 1}</span>
      <span class="card-icon" style="--i:${u.icon}"></span>
      <span class="card-name"></span>
      <span class="card-level">${owned ? `LV ${owned} → ${owned + 1}` : u.id === "_heal" ? "" : "NEW!"}</span>
      <span class="card-desc"></span>`;
    card.querySelector(".card-name").textContent = u.name;
    card.querySelector(".card-desc").textContent = describe(u);
    if (!owned && u.id !== "_heal") card.classList.add("is-new");
    card.addEventListener("click", () => chooseUpgrade(i));
    cardsEl.appendChild(card);
  });
  document.getElementById("levelup-title").textContent = `LEVEL ${progress.level}!`;
  levelUpEl.hidden = false;
  levelUpShownAt = performance.now();
  sfx.levelUp.play({ rate: 1.3 });
  sfx.flame.stopLoop();
  clearInput();
  setState("levelup");
  if (!touchMode) cardsEl.firstElementChild.focus({ preventScroll: true });
}

function chooseUpgrade(i) {
  // Ignore presses that were meant for the game a split-second earlier
  if (game.state !== "levelup" || performance.now() - levelUpShownAt < 350) return;
  const u = currentChoices[i];
  if (!u) return;
  if (u.id === "_heal") {
    player.hp = Math.min(stats.maxHp, player.hp + 40);
  } else {
    upg[u.id] = lv(u.id) + 1;
    computeStats();
    if (u.id === "heart") player.hp = Math.min(stats.maxHp, player.hp + 20);
  }
  player.hp = Math.min(stats.maxHp, player.hp + LEVEL_UP_HEAL);
  const pc = centerOf(player);
  burst(pc.x, pc.y, 24, "#ffe14d", 420);
  popup(u.name.toUpperCase(), pc.x, player.y - 40, "#ffe14d", 26, 1.3);
  levelUpEl.hidden = true;
  setState("playing");
}

// Keyboard: 1 / 2 / 3 or arrow keys + Enter
function handleLevelUpKey(e) {
  const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
  if (n !== undefined) {
    e.preventDefault();
    chooseUpgrade(n);
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
    if (!e.repeat) chooseUpgrade(Math.max(0, idx));
  }
}
