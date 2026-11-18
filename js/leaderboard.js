"use strict";
// =============================================================================
// Leaderboard: every run gets a score, the player can sign it with a name on
// the game-over screen, and the best runs are kept on this device
// (localStorage: the game is static on GitHub Pages, there is no backend).
// Every storage access is wrapped in try/catch: with storage blocked the board
// still works for the session, in memory. Player names only ever reach the
// page through textContent.
// =============================================================================

const LB_KEY = "cp2d77-leaderboard";
const LB_NAME_KEY = "cp2d77-name";
const LB_MAX = 50; // runs kept
const LB_TOP = 10; // runs shown
const LB_NAME_MAX = 16;

// --------------------------------------------------------------- Scoring ---
// score = kills x 10
//       + whole seconds survived x 2
//       + levels gained x 50       (everyone starts at level 1)
//       + bosses defeated x 1000
//       + 5000 for winning the run
//       - 250 per life lost
// and never below 0. Killing and surviving drive it; a win is worth about
// half of a typical winning score, so a win beats any loss of similar length.
const LB_SCORE = { kill: 10, second: 2, level: 50, boss: 1000, win: 5000, lifeLost: 250 };

const lbNum = (v) => (Number.isFinite(+v) ? Math.max(0, +v) : 0);

function scoreRun(run) {
  const s = LB_SCORE;
  const score =
    lbNum(run.kills) * s.kill +
    Math.floor(lbNum(run.time)) * s.second +
    Math.max(0, lbNum(run.level) - 1) * s.level +
    lbNum(run.bossesDefeated) * s.boss +
    (run.won ? s.win : 0) -
    lbNum(run.livesLost) * s.lifeLost;
  return Math.max(0, Math.round(score));
}

// ----------------------------------------------------------------- Names ---
// Trimmed, max 16 characters, no control or text-direction characters
function lbCleanName(raw) {
  const s = String(raw == null ? "" : raw)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(s).slice(0, LB_NAME_MAX).join("").trim();
}

const lbChar = (id) => (Object.prototype.hasOwnProperty.call(CHARACTERS, id) ? CHARACTERS[id] : null);
const lbCharName = (id) => (lbChar(id) ? lbChar(id).name : "IC");
const lbFallbackName = (id) => lbCleanName(`ANON-${lbCharName(id)}`);

let lbNameMemory = "";
function lbLoadName() {
  try {
    return lbCleanName(localStorage.getItem(LB_NAME_KEY) || "");
  } catch (err) {
    return lbNameMemory; // storage unavailable
  }
}
function lbRememberName(name) {
  lbNameMemory = name;
  try {
    localStorage.setItem(LB_NAME_KEY, name);
  } catch (err) {
    /* storage unavailable */
  }
}

// --------------------------------------------------------------- Storage ---
let lbMemory = null; // the board, when storage is blocked or full

function lbClean(e) {
  if (!e || typeof e !== "object") return null;
  return {
    name: lbCleanName(e.name) || "ANON",
    score: Math.round(lbNum(e.score)),
    char: String(e.char || ""),
    time: lbNum(e.time),
    kills: Math.round(lbNum(e.kills)),
    level: Math.max(1, Math.round(lbNum(e.level))),
    won: !!e.won,
    bossesDefeated: Math.round(lbNum(e.bossesDefeated)),
    livesLost: Math.round(lbNum(e.livesLost)),
    date: String(e.date || ""),
    id: String(e.id || ""),
    ...(e.coop ? { coop: true } : {}),
  };
}

// Best first; on a tie the run that got there first keeps the higher rank
const lbSort = (list) => list.sort((a, b) => b.score - a.score || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

function lbReadBoard() {
  if (lbMemory) return lbMemory.slice();
  try {
    const list = JSON.parse(localStorage.getItem(LB_KEY) || "[]");
    return Array.isArray(list) ? lbSort(list.map(lbClean).filter(Boolean)).slice(0, LB_MAX) : [];
  } catch (err) {
    return []; // storage unavailable or corrupted
  }
}

function lbWriteBoard(list) {
  try {
    localStorage.setItem(LB_KEY, JSON.stringify(list));
    lbMemory = null;
  } catch (err) {
    lbMemory = list.slice(); // keep it for this session at least
  }
}

// ------------------------------------------------------ Game-over entry ----
const lbEntryEl = document.getElementById("lb-entry");
const lbScoreEl = document.getElementById("lb-score");
const lbForm = document.getElementById("lb-form");
const lbNameInput = document.getElementById("lb-name");
const lbSaveBtn = document.getElementById("lb-save");
const lbSavedEl = document.getElementById("lb-saved");
let lbRun = null; // the run that just ended: { entry, saved, rank, total }

// Called by endRun() (main.js). Scores the run and readies the name entry,
// which CSS only shows on the game-over screen. Nothing is saved yet.
function captureRun() {
  const entry = {
    name: "",
    score: 0,
    char: player.char,
    time: Math.round(game.time * 10) / 10,
    kills: game.kills,
    level: progress.level,
    won: !!game.won,
    bossesDefeated: game.bossesDefeated || 0,
    livesLost: game.livesLost || 0,
    date: "",
  };
  if (game.coopRun) entry.coop = true; // a local co-op run (marked 2P on the board)
  entry.score = scoreRun(entry);
  lbRun = { entry, saved: false, rank: 0, total: 0 };
  lbScoreEl.textContent = entry.score.toLocaleString("en-US");
  lbNameInput.value = lbLoadName();
  lbNameInput.placeholder = lbFallbackName(entry.char);
  lbSaveBtn.disabled = false;
  lbForm.hidden = false;
  lbSavedEl.hidden = true;
  lbEntryEl.hidden = false;
}

// Saves the run once; returns its rank (or 0 if there was nothing to save)
function lbSaveScore() {
  const run = lbRun;
  if (!run || run.saved || game.state !== "over") return 0;
  run.saved = true;
  lbSaveBtn.disabled = true;
  const typed = lbCleanName(lbNameInput.value);
  lbRememberName(typed);
  const entry = run.entry;
  entry.name = typed || lbFallbackName(entry.char);
  entry.date = new Date().toISOString();
  entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const list = lbReadBoard();
  list.push(entry);
  lbSort(list);
  run.rank = list.indexOf(entry) + 1;
  run.total = list.length;
  lbWriteBoard(list.slice(0, LB_MAX));
  lbForm.hidden = true;
  lbSavedEl.textContent = `SAVED AS ${entry.name} // RANK #${run.rank} OF ${run.total}`;
  lbSavedEl.hidden = false;
  openLeaderboard(run, overlayBtn);
  return run.rank;
}
lbSaveBtn.addEventListener("click", lbSaveScore);

// While the name field has focus, the game never sees the keys: no restart on
// Enter, no pause on P/Esc, no mute on M. Capturing on window runs before any
// other key handler; the browser still types the characters as usual.
["keydown", "keypress", "keyup"].forEach((type) =>
  addEventListener(
    type,
    (e) => {
      if (e.target !== lbNameInput) return;
      e.stopImmediatePropagation();
      if (type !== "keydown" || e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat) lbSaveScore();
      } else if (e.key === "Escape") {
        e.preventDefault();
        lbNameInput.blur();
      }
    },
    true
  )
);

// ------------------------------------------------------------ The board ----
const lbEl = document.getElementById("leaderboard");
const lbBody = document.getElementById("lb-body");
const lbSub = document.getElementById("lb-sub");
const lbBtn = document.getElementById("lb-btn");
const lbCloseBtn = document.getElementById("lb-close");
let lbOpenedAt = 0;
let lbReturnFocus = null;

function lbNode(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// run: a just-saved run to highlight (optional)
function openLeaderboard(run, returnFocus) {
  lbReturnFocus = returnFocus || document.activeElement;
  lbEl.hidden = false;
  lbOpenedAt = performance.now();
  renderLeaderboard(run && run.saved ? run : null);
  if (!touchMode) lbCloseBtn.focus({ preventScroll: true });
}

function closeLeaderboard() {
  lbEl.hidden = true;
  const back = lbReturnFocus;
  lbReturnFocus = null;
  if (!touchMode && back && back.isConnected && !overlay.hidden) back.focus({ preventScroll: true });
}

lbBtn.addEventListener("click", () => openLeaderboard(game.state === "over" ? lbRun : null, lbBtn));
lbCloseBtn.addEventListener("click", closeLeaderboard);

const LB_COLUMNS = [
  ["#", "lb-num"],
  ["NAME", ""],
  ["IC", ""],
  ["SCORE", "lb-num"],
  ["TIME", "lb-num lb-opt"],
  ["KILLS", "lb-num lb-opt"],
  ["LV", "lb-num lb-opt"],
  ["RESULT", ""],
];

function lbRow(e, rank, isNew) {
  const tr = lbNode("tr", `lb-row${isNew ? " lb-new" : ""}${rank <= 3 ? " lb-top" + rank : ""}`);
  const ch = lbChar(e.char);
  if (ch) tr.style.setProperty("--c", ch.color);
  const when = new Date(e.date);
  if (!isNaN(when)) tr.title = when.toLocaleString();
  const name = lbNode("td", "lb-name-cell");
  name.append(lbNode("span", "lb-handle", e.name));
  if (e.coop) name.append(lbNode("span", "lb-tag lb-2p", "2P"));
  if (isNew) name.append(lbNode("span", "lb-tag", "NEW"));
  const result = lbNode("td");
  result.append(lbNode("span", e.won ? "lb-win" : "lb-kia", e.won ? "WIN" : "KIA"));
  tr.append(
    lbNode("td", "lb-num lb-rank", String(rank)),
    name,
    lbNode("td", "lb-ic", lbCharName(e.char)),
    lbNode("td", "lb-num lb-points", e.score.toLocaleString("en-US")),
    lbNode("td", "lb-num lb-opt", formatTime(e.time)),
    lbNode("td", "lb-num lb-opt", String(e.kills)),
    lbNode("td", "lb-num lb-opt", String(e.level)),
    result
  );
  return tr;
}

function renderLeaderboard(run) {
  const list = lbReadBoard();
  const mine = run ? run.entry : null;
  lbBody.textContent = "";
  lbBody.scrollTop = 0;
  if (mine) {
    lbSub.textContent = `NEW ENTRY // RANK #${run.rank} OF ${run.total}` + (run.rank > LB_MAX ? ` // OUTSIDE THE TOP ${LB_MAX}` : "");
  } else {
    lbSub.textContent = list.length ? `TOP ${Math.min(LB_TOP, list.length)} OF ${list.length} // STORED ON THIS DEVICE` : "0 RUNS // STORED ON THIS DEVICE";
  }

  if (!list.length && !mine) {
    const empty = lbNode("div", "lb-empty");
    empty.append(
      lbNode("p", "lb-empty-big", "No commits yet."),
      lbNode("p", "lb-empty-line", "Be the first to push to prod."),
      lbNode("p", "lb-empty-term", "$ git log --leaderboard"),
      lbNode("p", "lb-empty-term lb-empty-err", "fatal: your current branch has no commits yet")
    );
    lbBody.append(empty);
    return;
  }

  const table = lbNode("table", "lb-table");
  const head = lbNode("tr");
  LB_COLUMNS.forEach(([label, cls]) => {
    const th = lbNode("th", cls, label);
    th.scope = "col";
    head.append(th);
  });
  const thead = lbNode("thead");
  thead.append(head);
  const tbody = lbNode("tbody");
  let shown = false;
  list.slice(0, LB_TOP).forEach((e, i) => {
    const isNew = !!mine && e.id === mine.id;
    shown = shown || isNew;
    tbody.append(lbRow(e, i + 1, isNew));
  });
  if (mine && !shown) {
    // Not in the top 10: show it under the cut, with its real rank
    const gap = lbNode("tr", "lb-gap");
    const td = lbNode("td", "", "...");
    td.colSpan = LB_COLUMNS.length;
    gap.append(td);
    tbody.append(gap, lbRow(mine, run.rank, true));
  }
  table.append(thead, tbody);
  lbBody.append(table);
  const s = LB_SCORE;
  lbBody.append(lbNode("p", "lb-rules", `SCORE = KILLS x${s.kill} + SECONDS x${s.second} + LEVELS x${s.level} + BOSSES x${s.boss} + WIN ${s.win} - LIVES LOST x${s.lifeLost}`));

  const row = lbBody.querySelector(".lb-new");
  if (row && row.offsetTop + row.offsetHeight > lbBody.clientHeight) lbBody.scrollTop = row.offsetTop - lbBody.clientHeight / 2;
}

// Called by handleMenuKey() (main.js); returns true if the key was handled
function handleLeaderboardKey(e) {
  if (!lbEl.hidden) {
    if (e.code === "Escape") {
      e.preventDefault();
      closeLeaderboard();
    } else if ((e.code === "Enter" || e.code === "Space") && (e.repeat || performance.now() - lbOpenedAt < 300)) {
      e.preventDefault(); // a held Enter from the name field must not close it straight away
    }
    return true;
  }
  if ((e.code === "Enter" || e.code === "Space") && !overlay.hidden) {
    const a = document.activeElement;
    if (a && (a === lbBtn || lbEntryEl.contains(a))) return true; // let it click
  }
  return false;
}
