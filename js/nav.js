"use strict";
// =============================================================================
// Enemy navigation: how walking enemies and the bosses get around the
// vertical city (flyers have their own steering in enemies.js).
//
// Why enemies could not reach the top platform (the root cause):
//  - Walkers knew nothing about how the level fits together. They ran
//    straight at the player's x and, only when the player was above them and
//    within 340 px, hopped straight up with a random 980-1180 px/s (178-258 px
//    of rise). The city is a zig-zag of one-way platforms 150-190 px apart,
//    plus stacks 300-340 px apart that only a double jump clears, and the way
//    up to the rooftop at (3850, -280) runs sideways, partly AWAY from the
//    player's x (10 > 26 > 27 > 28 > 29 > 30). So they piled up under you and
//    hopped in place forever.
//  - Nothing ever went down on purpose (no drop-through), the random jump
//    heights had nothing to do with the gaps, the heavy enforcer could clear
//    almost no step at all, walkers spawned on the street while you were
//    1200 px up, the anti-stacking shove pushed them off ledges, and the
//    bosses only hopped at a player who was within 520 px.
//
// The fix, in three parts:
//  1. A platform graph per kind of mover (node 0 is the street, node i + 1 is
//     platforms[i]). Its edges (jump, drop-through, grapple) come from that
//     mover's real physics: take-off speed, gravity, air control, double
//     jump. Moving platforms are sampled over their swing; at run time the
//     move is timed against where the platform will be.
//  2. A shortest-route field per goal floor (a reverse Dijkstra over edges,
//     cached), shared by every enemy chasing a target on that floor: picking
//     the next move is a lookup, cheap enough for 40 enemies on a phone.
//  3. A small controller: run to the take-off range, take turns with anyone
//     else using the spot, jump with the speed the gap needs (a little
//     variation per enemy), steer in the air onto the landing spot, drop
//     through floors to go down; plus a progress watchdog that bans a move
//     that keeps failing and takes another route.
// Bosses use the same graph through bossNavigate() (bosses.js).
// Debug: ?navdebug (or navDebug.on = true) draws the graph and every route.
// =============================================================================

const NAV = {
  clear: 30, // a jump's arc clears the floor it lands on by this much
  hop: 45, // the smallest hop (across a gap or down), px of rise
  reach: 0.85, // plan jumps with this share of the air speed (the rest is slack)
  phases: 16, // samples of a moving platform's swing
  stagger: [0.12, 0.28], // s between two enemies taking off from the same spot
  stuck: 4, // s without getting closer before giving up on the current move
  ban: 6, // s a move that failed stays off the menu for that enemy
  rescue: 15, // s stuck for good: it leaves (only off screen; the director sends another)
};
const NAV_WALKER_G = 2700; // walker gravity and terminal speed (moveBody)
const NAV_WALKER_FALL = 1500;
const NAV_JUMP = 0;
const NAV_DROP = 1;
const NAV_GRAPPLE = 2;
const NAV_JUMP_LEFT = 3; // (graph building: a jump down and across to the left of its own floor)
// what a navigating enemy is doing
const NAV_RUN = 0; // on a floor: running to the take-off point (or the target)
const NAV_AIR = 1; // on its way to the next floor (a jump or a drop)
const NAV_AIM = 2; // grapple: firing the line
const NAV_REEL = 3; // grapple: being hauled up

// How each kind of mover gets around. jump / double: take-off speeds (px/s);
// air: the fastest it steers sideways in the air; run: its usual speed;
// grapple: hauls itself onto a ledge up to `up` px above / `side` px away.
// A new walker type can bring its own `nav: {...}` in ENEMY_TYPES.
const NAV_MOVERS = {
  crawler: { jump: 1250, air: 430, think: 0.15 }, // small and springy
  ninja: { jump: 1150, double: 1000, air: 480, think: 0.25 }, // air-kick (a shadow-step double jump)
  enforcer: { jump: 950, air: 260, think: 0.45, grapple: { up: 430, side: 320, reel: 560, aim: 0.42 } }, // heavy: short hops, a grapple for the rest
  walker: { jump: 1150, air: 380, think: 0.3 },
  // (bosses stand a moment after each landing: room for their attacks mid-climb)
  overseer: { boss: true, jump: 1350, double: 1150, air: 560, run: 400, think: 0.2, settle: 0.22 },
  nullptr: { boss: true, jump: 1350, double: 1150, air: 620, run: 480, think: 0.2, settle: 0.22 },
  goat: { boss: true, jump: 1350, double: 1150, air: 460, run: 260, think: 0.25, settle: 0.28 },
};
const navMovers = {};
const navDebug = { on: /[?&]navdebug\b/.test(location.search) };
const navStats = { plans: 0, fields: 0, launches: 0, fails: 0, bans: 0, rescues: 0, fieldMs: 0 };

// ------------------------------------------------------------- Floors -------
const navPlat = (n) => (n > 0 ? platforms[n - 1] : null);
const navMoving = (p) => !!p && !!(p.ax || p.ay);
const navGap = (a0, a1, b0, b1) => Math.max(0, b0 - a1, a0 - b1);
const navNodeOf = (s) => (!s || s.ground ? 0 : s.navId || platforms.indexOf(s) + 1);

function navInit() {
  if (navInit.done) return;
  navInit.done = true;
  platforms.forEach((p, i) => (p.navId = i + 1));
}

// The floor a body is on, or (in the air) the one it will come down on
function navNodeOfBody(b) {
  if (b.onGround && b.standingOn) return navNodeOf(b.standingOn);
  const cx = b.x + b.w / 2;
  const feet = b.y + b.h;
  let best = 0;
  let by = GROUND_Y;
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    if (cx >= p.x && cx <= p.x + p.w && p.y >= feet - 4 && p.y < by) {
      by = p.y;
      best = i + 1;
    }
  }
  return best;
}

// Where a floor is: at swing sample i of k (graph building), or `ahead`
// seconds from now (k = 0). Writes {x0, x1, y, ground} into out.
function navPose(p, i, k, ahead, out) {
  out.ground = !p;
  if (!p) {
    out.x0 = 0;
    out.x1 = WORLD_W;
    out.y = GROUND_Y;
    return out;
  }
  let x = p.x;
  let y = p.y;
  if (navMoving(p)) {
    const s = k ? Math.sin((Math.PI * 2 * i) / k) : Math.sin(((game.time + ahead) / p.period) * Math.PI * 2);
    x = p.baseX + (p.ax || 0) * s;
    y = p.baseY + (p.ay || 0) * s;
  }
  out.x0 = x;
  out.x1 = x + p.w;
  out.y = y;
  return out;
}

// Centre x range where a body of width w stands on a floor / should land on it
function navStand(A, w, out) {
  out[0] = A.ground ? w / 2 : A.x0 + 8;
  out[1] = A.ground ? WORLD_W - w / 2 : A.x1 - 8;
}
function navLanding(B, w, out) {
  const mg = B.ground ? w / 2 : Math.min(w / 2, (B.x1 - B.x0) * 0.35);
  out[0] = B.ground ? w / 2 : B.x0 + mg;
  out[1] = B.ground ? WORLD_W - w / 2 : B.x1 - mg;
}

// Cut [r0, r1] down to its largest piece outside every static floor between
// heights yTop and yBottom that would catch a body (width w) falling there
function navClearOf(r, yTop, yBottom, w, skipA, skipB) {
  for (let i = 0; i < platforms.length && r[1] - r[0] > 0; i++) {
    const c = platforms[i];
    if (c === skipA || c === skipB || navMoving(c) || c.y <= yTop + 8 || c.y >= yBottom - 8) continue;
    const c0 = c.x + 6 - w / 2;
    const c1 = c.x + c.w - 6 + w / 2;
    if (c1 <= r[0] || c0 >= r[1]) continue;
    if (c0 - r[0] >= r[1] - c1) r[1] = Math.min(r[1], c0);
    else r[0] = Math.max(r[0], c1);
  }
  return r[1] - r[0];
}

// ------------------------------------------------------------- Physics ------
// How long a jump stays up until the feet come back down to h px above the
// take-off floor: with the gentlest jump that clears it, or the biggest one
// (double jump included: the most air time, so the longest reach)
function navFlight(m, h, biggest) {
  const g = m.g;
  if (!biggest) {
    const v = Math.sqrt(2 * g * Math.max(h + NAV.clear, NAV.hop));
    if (v <= m.jump) return (v + Math.sqrt(Math.max(0, v * v - 2 * g * h))) / g;
  }
  const v = m.jump;
  if (m.double) {
    const disc = m.double * m.double - 2 * g * (h - (v * v) / (2 * g));
    return disc < 0 ? 0 : v / g + (m.double + Math.sqrt(disc)) / g;
  }
  const disc = v * v - 2 * g * h;
  return disc < 0 ? 0 : (v + Math.sqrt(disc)) / g;
}

// How far sideways a jump up (or down) h can carry it. The double jump only
// counts when the height needs it: long, high double-jump arcs tend to come
// down on some other floor on the way.
function navReach(m, h, k) {
  const single = h + NAV.clear <= (m.jump * m.jump) / (2 * m.g);
  const T = single ? navFlight({ g: m.g, jump: m.jump, double: 0 }, h, true) : navFlight(m, h, true);
  return m.air * k * T;
}

// The take-off speed for a single jump from x to lx (h up): the gentlest one
// that makes it, a little variation, and (going down and across) enough air
// time to get clear of its own floor first. -1: too far; -2: can't clear it.
function navHopSpeed(m, e, from, h, cx, lx) {
  let v = navJumpSpeed(m, h, Math.abs(lx - cx));
  if (v < 0) return -1;
  v = Math.min(m.jump, v * rand(1, 1.05)); // (they don't all fly in lockstep)
  if (h < 0 && from && !from.ground) {
    // at a steady speed across it has to be past its own floor's edge before
    // it comes back down past that floor's top: a high enough arc does it
    const exit = (lx > cx ? from.x + from.w - 6 + e.w / 2 - cx : cx - (from.x + 6 - e.w / 2)) + 6;
    if (exit > 0) {
      const g = m.g;
      const need = Math.min(0.999, exit / Math.max(Math.abs(lx - cx), 1));
      const share = (u) => (2 * u) / (u + Math.sqrt(u * u - 2 * g * h)); // (of the way across, back at its floor's height)
      if (share(m.jump) < need) return -2;
      if (share(v) < need) {
        let a = v;
        let b = m.jump;
        for (let i = 0; i < 10; i++) {
          const mid = (a + b) / 2;
          if (share(mid) >= need) b = mid;
          else a = mid;
        }
        v = b;
      }
    }
  }
  return v;
}

// Would a jump (feet at y0, speeds v up and vx across) come down on some
// other floor before it gets down to height by? Returns that floor. live:
// moving floors count too, where they will be by then (at take-off time).
const navPC = { x0: 0, x1: 0, y: 0, ground: false };
function navArcHit(m, w, x0, y0, v, vx, by, pa, pb, live) {
  const g = m.g;
  const apex = y0 - (v * v) / (2 * g);
  const tEnd = (v + Math.sqrt(Math.max(0, v * v - 2 * g * (y0 - by)))) / g;
  for (let i = 0; i < platforms.length; i++) {
    const c = platforms[i];
    if (c === pa || c === pb || (navMoving(c) && !live)) continue;
    let cy = c.y;
    if (cy <= apex + 2 || cy >= by + 60) continue;
    let tc = (v + Math.sqrt(Math.max(0, v * v - 2 * g * (y0 - cy)))) / g; // passing its top, going down
    let cx0 = c.x;
    if (navMoving(c)) {
      navPose(c, 0, 0, tc, navPC);
      cy = navPC.y;
      cx0 = navPC.x0;
      if (cy <= apex + 2) continue;
      tc = (v + Math.sqrt(Math.max(0, v * v - 2 * g * (y0 - cy)))) / g;
    }
    if (cy >= by || tc > tEnd) continue;
    const xc = x0 + vx * tc;
    if (xc > cx0 + 6 - w / 2 && xc < cx0 + c.w - 6 + w / 2) return c;
  }
  return null;
}

// The gentlest single jump that clears h and covers d sideways (-1: none does)
function navJumpSpeed(m, h, d) {
  const g = m.g;
  const air = m.air * 0.92;
  const lo = Math.sqrt(2 * g * Math.max(h + NAV.clear, NAV.hop));
  const T = (v) => (v + Math.sqrt(Math.max(0, v * v - 2 * g * h))) / g;
  if (lo > m.jump || T(m.jump) * air < d - 1) return -1;
  if (T(lo) * air >= d) return lo;
  let a = lo;
  let b = m.jump;
  for (let i = 0; i < 12; i++) {
    const mid = (a + b) / 2;
    if (T(mid) * air >= d) b = mid;
    else a = mid;
  }
  return b;
}

// Can mover m make a `kind` move from floor A to floor B (fixed poses)?
// Fills R with the take-off centre range, the landing range and the time.
const navR = { t0: 0, t1: 0, l0: 0, l1: 0, time: 0 };
const navSA = [0, 0];
const navSB = [0, 0];
function navTry(m, A, B, kind, pa, pb, R) {
  const w = m.w;
  navStand(A, w, navSA);
  navLanding(B, w, navSB);
  const h = A.y - B.y; // how far up B is
  if (kind === NAV_DROP) {
    if (A.ground || h > -60) return false;
    navSB[0] = Math.max(navSB[0], navSA[0]);
    navSB[1] = Math.min(navSB[1], navSA[1]);
    if (navClearOf(navSB, A.y, B.y, w, pa, pb) < 6) return false;
    R.t0 = R.l0 = navSB[0];
    R.t1 = R.l1 = navSB[1];
    R.time = Math.sqrt((-2 * h) / m.g) + 0.1;
    return true;
  }
  if (kind === NAV_GRAPPLE) {
    const gr = m.grapple;
    if (!gr || h < 40 || h > gr.up) return false;
    R.t0 = Math.max(navSA[0], navSB[0] - gr.side);
    R.t1 = Math.min(navSA[1], navSB[1] + gr.side);
    if (R.t1 - R.t0 < 4) return false;
    R.l0 = Math.max(navSB[0], R.t0 - gr.side);
    R.l1 = Math.min(navSB[1], R.t1 + gr.side);
    R.time = gr.aim + Math.hypot(h, gr.side * 0.5) / gr.reel + 0.5;
    return true;
  }
  if (h + NAV.clear > m.rise) return false;
  if (h < 0) {
    if (A.ground) return false;
    // going down: it has to come down beside its own floor, not back onto it
    // (one move for each side: NAV_JUMP lands right of it, NAV_JUMP_LEFT left)
    const c0 = A.x0 + 6 - w / 2;
    const c1 = A.x1 - 6 + w / 2;
    if (kind === NAV_JUMP_LEFT) {
      if (navSB[0] >= c0) return false;
      navSB[1] = Math.min(navSB[1], c0);
    } else {
      if (navSB[1] <= c1) return false;
      navSB[0] = Math.max(navSB[0], c1);
    }
  } else if (kind === NAV_JUMP_LEFT) return false;
  if (navSB[1] - navSB[0] < 4) return false;
  const reach = navReach(m, h, NAV.reach);
  R.t0 = Math.max(navSA[0], navSB[0] - reach);
  R.t1 = Math.min(navSA[1], navSB[1] + reach);
  if (h < 0) {
    // ...and it has to get clear of its own floor before it comes back down
    // past it: take off near the edge on the landing's side
    const clearX = m.air * NAV.reach * ((2 * m.jump) / m.g);
    if (navSB[0] >= A.x1 - 6 + w / 2 - 1) R.t0 = Math.max(R.t0, A.x1 - 6 + w / 2 - clearX);
    else R.t1 = Math.min(R.t1, A.x0 + 6 - w / 2 + clearX);
  }
  if (R.t1 - R.t0 < 4) return false;
  if (h < -40) {
    // nothing in between may catch it on the way down
    const tx = clamp((navSB[0] + navSB[1]) / 2, R.t0, R.t1);
    const lx = clamp(tx, navSB[0], navSB[1]);
    navSA[0] = Math.min(tx, lx);
    navSA[1] = Math.max(tx, lx) + 0.01;
    const span = navSA[1] - navSA[0];
    if (navClearOf(navSA, A.y, B.y, w, pa, pb) < span - 0.001) return false;
  }
  {
    // the arc from the nearest take-off spot must not come down on another floor
    const tx = clamp((navSB[0] + navSB[1]) / 2, R.t0, R.t1);
    const lx = clamp(tx, navSB[0], navSB[1]);
    const v = navJumpSpeed(m, h, Math.abs(lx - tx));
    const T = v > 0 ? (v + Math.sqrt(Math.max(0, v * v - 2 * m.g * h))) / m.g : 0;
    if (v > 0 && navArcHit(m, w, tx, A.y, v, (lx - tx) / T, B.y, pa, pb)) return false;
  }
  // (only where it can actually come down: not "anywhere on the street")
  R.l0 = Math.max(navSB[0], R.t0 - reach);
  R.l1 = Math.min(navSB[1], R.t1 + reach);
  R.time = navFlight(m, h, false) + 0.25; // (every jump costs a little: flat routes win ties)
  return true;
}

// --------------------------------------------------------------- Graph ------
const navPA = { x0: 0, x1: 0, y: 0, ground: false };
const navPB = { x0: 0, x1: 0, y: 0, ground: false };

function navMoverFor(e) {
  const key = e.type;
  if (navMovers[key]) return navMovers[key];
  const spec = (e.def && e.def.nav) || NAV_MOVERS[key] || NAV_MOVERS.walker;
  const boss = !!e.boss;
  const g = boss ? BOSS_GRAVITY : NAV_WALKER_G;
  const m = Object.assign({ double: 0, think: 0.3, settle: 0 }, spec, {
    key,
    boss,
    g,
    w: boss ? e.w : e.def.w * 1.15, // (sized for the elite: the safer landing)
    run: spec.run || (e.def ? e.def.speed : 300),
    graph: null,
  });
  m.rise = (m.jump * m.jump + m.double * m.double) / (2 * g);
  return (navMovers[key] = m);
}

function navGraph(m) {
  if (m.graph) return m.graph;
  navInit();
  const N = platforms.length + 1;
  const list = [];
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      if (a === b) continue;
      const pa = navPlat(a);
      const pb = navPlat(b);
      const ka = navMoving(pa) ? NAV.phases : 1;
      const kb = navMoving(pb) ? NAV.phases : 1;
      for (let kind = 0; kind < 4; kind++) {
        let ok = 0;
        let t0 = Infinity;
        let t1 = -Infinity;
        let l0 = Infinity;
        let l1 = -Infinity;
        let time = Infinity;
        for (let i = 0; i < ka; i++) {
          navPose(pa, i, ka, 0, navPA);
          for (let j = 0; j < kb; j++) {
            navPose(pb, j, kb, 0, navPB);
            if (!navTry(m, navPA, navPB, kind, pa, pb, navR)) continue;
            ok++;
            t0 = Math.min(t0, navR.t0);
            t1 = Math.max(t1, navR.t1);
            l0 = Math.min(l0, navR.l0);
            l1 = Math.max(l1, navR.l1);
            time = Math.min(time, navR.time);
          }
        }
        if (!ok) continue;
        const dyn = ka > 1 || kb > 1;
        // a moving floor is only in reach part of the time: count the wait
        const period = Math.max(pa && dyn ? pa.period || 0 : 0, pb && dyn ? pb.period || 0 : 0);
        const wait = dyn ? (1 - ok / (ka * kb)) * period * 0.5 : 0;
        list.push({ a, b, kind: kind === NAV_JUMP_LEFT ? NAV_JUMP : kind, code: kind, t0, t1, l0, l1, time, cost: time + wait, dyn });
      }
    }
  }
  const E = list.length;
  const G = {
    N,
    E,
    run: m.run,
    from: new Int16Array(E),
    to: new Int16Array(E),
    kind: new Uint8Array(E),
    code: new Uint8Array(E), // (the kind as navTry knows it: which side for a jump down)
    dyn: new Uint8Array(E),
    t0: new Float32Array(E),
    t1: new Float32Array(E),
    l0: new Float32Array(E),
    l1: new Float32Array(E),
    time: new Float32Array(E),
    cost: new Float32Array(E),
    busy: new Float64Array(E), // when the next enemy may take off on it
    outStart: new Int32Array(N + 1),
    outList: new Int32Array(E),
    inStart: new Int32Array(N + 1),
    inList: new Int32Array(E),
    fields: [],
    done: new Uint8Array(E),
  };
  list.forEach((d, k) => {
    G.from[k] = d.a;
    G.to[k] = d.b;
    G.kind[k] = d.kind;
    G.code[k] = d.code;
    G.dyn[k] = d.dyn ? 1 : 0;
    G.t0[k] = d.t0;
    G.t1[k] = d.t1;
    G.l0[k] = d.l0;
    G.l1[k] = d.l1;
    G.time[k] = d.time;
    G.cost[k] = d.cost;
  });
  // compressed out / in lists per floor
  const fill = (start, listArr, key) => {
    for (let k = 0; k < E; k++) start[G[key][k] + 1]++;
    for (let n = 0; n < N; n++) start[n + 1] += start[n];
    const at = start.slice(0, N);
    for (let k = 0; k < E; k++) listArr[at[G[key][k]]++] = k;
  };
  fill(G.outStart, G.outList, "from");
  fill(G.inStart, G.inList, "to");
  return (m.graph = G);
}

// The cost to reach `goal` after starting each move (a reverse Dijkstra over
// moves: between two moves it runs along the floor from one's landing range
// to the next one's take-off range). Cached per goal floor.
function navField(G, goal) {
  const cached = G.fields[goal];
  if (cached) return cached;
  const t = performance.now();
  const f = (G.fields[goal] = new Float32Array(G.E).fill(Infinity));
  const done = G.done;
  done.fill(0);
  for (let k = 0; k < G.E; k++) if (G.to[k] === goal) f[k] = G.cost[k];
  for (;;) {
    let k = -1;
    let best = Infinity;
    for (let i = 0; i < G.E; i++) {
      if (!done[i] && f[i] < best) {
        best = f[i];
        k = i;
      }
    }
    if (k < 0) break;
    done[k] = 1;
    const a = G.from[k];
    for (let i = G.inStart[a]; i < G.inStart[a + 1]; i++) {
      const k2 = G.inList[i];
      if (done[k2]) continue;
      const c = G.cost[k2] + navGap(G.l0[k2], G.l1[k2], G.t0[k], G.t1[k]) / G.run + best;
      if (c < f[k2]) f[k2] = c;
    }
  }
  navStats.fields++;
  navStats.fieldMs += performance.now() - t;
  return f;
}

// Is there a route from floor `from` to floor `goal` for this mover?
function navReachable(m, from, goal) {
  if (from === goal) return true;
  const G = navGraph(m);
  const f = navField(G, goal);
  for (let i = G.outStart[from]; i < G.outStart[from + 1]; i++) if (f[G.outList[i]] < Infinity) return true;
  return false;
}

// ---------------------------------------------------------- Controller ------
function navState() {
  return { m: null, node: -1, goal: -1, edge: -1, phase: NAV_RUN, lx: 0, lrel: 0, dbl: false, think: 0, wait: 0, stuck: 0, best: Infinity, ban: -1, banUntil: 0, failEdge: -1, fails: 0, jumps: 0, grapples: 0, lastX: NaN, t: 0, est: 0, lost: 0, settle: 0 };
}

// Is this enemy in the middle of a planned move (jump, drop or grapple)?
const navBusy = (e) => !!e.nav && e.nav.phase !== NAV_RUN;
const navAirborne = (e) => !!e.nav && e.nav.phase === NAV_AIR && !e.onGround;

// Pick the next move from floor `node` at x toward floor `goal`
function navChoose(n, G, node, goal, cx) {
  const f = navField(G, goal);
  let best = -1;
  let bc = Infinity;
  for (let i = G.outStart[node]; i < G.outStart[node + 1]; i++) {
    const k = G.outList[i];
    let c = f[k];
    if (c === Infinity) continue;
    c += navGap(cx, cx, G.t0[k], G.t1[k]) / G.run;
    if (k === n.ban && game.time < n.banUntil) c += 60;
    if (c < bc) {
      bc = c;
      best = k;
    }
  }
  navStats.plans++;
  return best;
}

// The cost still ahead on the current route (for the progress watchdog)
function navEstimate(n, G, goal, cx) {
  if (n.edge < 0) return Infinity;
  return navGap(cx, cx, G.t0[n.edge], G.t1[n.edge]) / G.run + navField(G, goal)[n.edge];
}

// Where to land on the next floor: lined up with the move after it (or the
// target, on the target's floor), a little inside the edge
function navLandX(G, k, goal, t, l0, l1) {
  const b = G.to[k];
  let hint = (l0 + l1) / 2;
  if (b === goal) hint = t.x + t.w / 2;
  else {
    const f = navField(G, goal);
    let best = Infinity;
    for (let i = G.outStart[b]; i < G.outStart[b + 1]; i++) {
      const k2 = G.outList[i];
      const c = f[k2] + navGap(l0, l1, G.t0[k2], G.t1[k2]) / G.run;
      if (c < best) {
        best = c;
        hint = clamp((l0 + l1) / 2, G.t0[k2], G.t1[k2]);
      }
    }
  }
  return clamp(hint + rand(-14, 14), l0, l1);
}

// The take-off range of move k right now (moving floors: from where they are)
const navTk = [0, 0];
function navTakeoff(m, G, k, out) {
  if (!G.dyn[k]) {
    out[0] = G.t0[k];
    out[1] = G.t1[k];
    return true;
  }
  const pa = navPlat(G.from[k]);
  const pb = navPlat(G.to[k]);
  navPose(pa, 0, 0, 0, navPA);
  navPose(pb, 0, 0, G.time[k], navPB);
  if (navTry(m, navPA, navPB, G.code[k], pa, pb, navR)) {
    out[0] = navR.t0;
    out[1] = navR.t1;
    return true;
  }
  // not in reach right now: wait at the end of this floor nearest to it
  navStand(navPA, m.w, navSA);
  const bx = (navPB.x0 + navPB.x1) / 2;
  out[0] = out[1] = clamp(bx, navSA[0], navSA[1]);
  return false;
}

// Take off on move k (returns false if it can't from here right now)
const navLB = [0, 0];
function navLaunch(e, n, m, G, k, goal, t, cx) {
  const kind = G.kind[k];
  const pb = navPlat(G.to[k]);
  const ahead = G.dyn[k] ? G.time[k] : 0;
  navPose(pb, 0, 0, ahead, navPB);
  navLanding(navPB, m.w, navLB);
  const feet = e.y + e.h;
  const h = feet - navPB.y;
  const from = e.standingOn;
  if (kind === NAV_JUMP && h < 0 && from && !from.ground) {
    // (down and across: land beside this floor, on the side this move is for)
    navLB[0] = Math.max(navLB[0], G.l0[k]);
    navLB[1] = Math.min(navLB[1], G.l1[k]);
    if (G.code[k] === NAV_JUMP_LEFT) navLB[1] = Math.min(navLB[1], from.x + 6 - e.w / 2 - 8);
    else navLB[0] = Math.max(navLB[0], from.x + from.w - 6 + e.w / 2 + 8);
  }
  if (navLB[1] - navLB[0] < 2) return false;
  let lx = navLandX(G, k, goal, t, navLB[0], navLB[1]);
  if (kind === NAV_DROP) {
    if (!from || from.ground || cx < navLB[0] - 2 || cx > navLB[1] + 2) return false;
    lx = clamp(cx, navLB[0], navLB[1]);
    e.dropTimer = 0.22;
    e.vy = 60;
  } else if (kind === NAV_GRAPPLE) {
    const gr = m.grapple;
    if (Math.abs(lx - cx) > gr.side) lx = clamp(cx + Math.sign(lx - cx) * gr.side, navLB[0], navLB[1]);
    if (h > gr.up + 20 || h < 20 || Math.abs(lx - cx) > gr.side + 10) return false;
    e.vx = 0;
    e.vy = 0;
    n.t = gr.aim;
    n.grapples++;
  } else {
    // the gentlest jump that makes it (both its height and its width)
    const maxReach = navReach(m, h, 0.9);
    if (Math.abs(lx - cx) > maxReach) lx = clamp(cx + Math.sign(lx - cx) * maxReach, navLB[0], navLB[1]);
    const d = Math.abs(lx - cx);
    let v = navHopSpeed(m, e, from, h, cx, lx);
    let T;
    if (v === -2) return false; // (can't get clear of its own floor from here)
    if (v < 0) {
      if (!m.double || h + NAV.clear > m.rise || d > maxReach + 1) return false;
      v = m.jump; // a double jump: the second one comes at the top of the first
      T = navFlight(m, h, true);
    } else {
      T = (v + Math.sqrt(Math.max(0, v * v - 2 * m.g * h))) / m.g;
      const own = from && !from.ground ? from : null;
      if (navArcHit(m, e.w, cx, feet, v, (lx - cx) / T, navPB.y, own, pb, true)) {
        // something would catch it on the way down: a lower arc to the nearest part of the floor
        lx = clamp(cx, navLB[0], navLB[1]);
        v = navHopSpeed(m, e, from, h, cx, lx);
        if (v < 0) return false;
        T = (v + Math.sqrt(Math.max(0, v * v - 2 * m.g * h))) / m.g;
        if (navArcHit(m, e.w, cx, feet, v, (lx - cx) / T, navPB.y, own, pb, true)) return false;
      }
    }
    e.vy = -v;
    e.vx = clamp((lx - cx) / Math.max(T, 0.1), -m.air, m.air);
    n.jumps++;
    if (m.boss) {
      e.airJumps = 1;
      dust(cx, feet, 10, 1.5);
    }
  }
  e.onGround = false;
  e.standingOn = null;
  n.phase = kind === NAV_GRAPPLE ? NAV_AIM : NAV_AIR;
  n.edge = k;
  n.lx = lx;
  n.lrel = lx - navPB.x0; // (on a moving floor the spot moves with it)
  n.dbl = false;
  n.wait = 0;
  navStats.launches++;
  return true;
}

// In the air on a planned move: steer so the feet come down on the landing
// spot; a double jump when this arc can't make it
function navSteerAir(e, n, m, G) {
  const k = n.edge;
  const pb = navPlat(G.to[k]);
  const g = m.g;
  const cx = e.x + e.w / 2;
  const feet = e.y + e.h;
  const by = pb ? pb.y : GROUND_Y;
  let disc = e.vy * e.vy + 2 * g * (by - feet);
  let tr = disc >= 0 ? (-e.vy + Math.sqrt(disc)) / g : Math.max(0.05, -e.vy / g);
  // the landing spot (and the range it may land in), where the floor will be by then
  navPose(pb, 0, 0, tr, navPB);
  navLanding(navPB, m.w, navLB);
  let lx = navMoving(pb) ? navPB.x0 + n.lrel : n.lx;
  // going down and across: get clear of its own floor before passing its top
  const pa = navPlat(G.from[k]);
  if (pa && G.kind[k] === NAV_JUMP && by > pa.y + 20 && feet <= pa.y + 2) {
    const c0 = pa.x + 6 - e.w / 2;
    const c1 = pa.x + pa.w - 6 + e.w / 2;
    if (cx > c0 - 6 && cx < c1 + 6) {
      // still over it: fast enough to be past the edge before coming back down to it
      const dir = lx > cx ? 1 : -1;
      const left = dir > 0 ? c1 + 6 - cx : cx - (c0 - 6);
      const tBack = (-e.vy + Math.sqrt(e.vy * e.vy + 2 * g * Math.max(0, pa.y - feet))) / g;
      return dir * Math.min(m.air, Math.max(Math.abs(lx - cx) / Math.max(tr, 0.06), left / Math.max(tBack, 0.05)));
    }
  }
  // a double jump only when this arc can't make it: too low, or the floor out
  // of reach sideways (never a last-moment one on the way down)
  const canDouble = m.double && !n.dbl && (!m.boss || e.airJumps > 0);
  if (canDouble && e.vy > -220 && e.vy < 250 && (disc < 0 || navGap(cx, cx, navLB[0], navLB[1]) > m.air * tr)) {
    // as strong as it needs to be: high enough, and long enough to get across
    const gap = navGap(cx, cx, navLB[0], navLB[1]);
    const T2 = (v) => (v + Math.sqrt(Math.max(0, v * v + 2 * g * (by - feet)))) / g;
    let v2 = clamp(Math.sqrt(2 * g * Math.max(feet - (by - NAV.clear), 60)), 380, m.double);
    if (T2(m.double) * m.air <= gap + 10) v2 = m.double;
    else if (T2(v2) * m.air < gap + 10) {
      let a = v2;
      let b = m.double;
      for (let i = 0; i < 10; i++) {
        const mid = (a + b) / 2;
        if (T2(mid) * m.air >= gap + 10) b = mid;
        else a = mid;
      }
      v2 = b;
    }
    e.vy = -v2;
    n.dbl = true;
    if (m.boss) {
      e.airJumps--;
      dust(cx, feet, 6, 1.2);
    } else burst(cx, feet, 8, e.type === "ninja" ? "#ff2fd6" : "#19f5ff", 200); // the ninja's air-kick
    disc = e.vy * e.vy + 2 * g * (by - feet);
    tr = disc >= 0 ? (-e.vy + Math.sqrt(disc)) / g : Math.max(0.05, -e.vy / g);
  }
  // can't make the spot itself? the nearest part of the floor will do
  const reach = m.air * Math.max(tr, 0.06);
  if (Math.abs(lx - cx) > reach) lx = clamp(cx + Math.sign(lx - cx) * reach, navLB[0], navLB[1]);
  return clamp((lx - cx) / Math.max(tr, 0.06), -m.air, m.air);
}

// Back on a floor: was that the floor it was going for?
function navLand(e, n, G) {
  const node = navNodeOf(e.standingOn);
  const k = n.edge;
  n.phase = NAV_RUN;
  n.edge = -1;
  n.think = 0;
  n.node = node;
  if (k < 0) return;
  if (node === G.to[k]) {
    n.fails = 0;
    n.stuck = 0;
    n.lost = 0;
    n.settle = n.m.settle;
    n.best = Infinity;
    return;
  }
  // it fell short (knocked, blocked, a floor moved): twice on the same move and it tries another way
  navStats.fails++;
  n.fails = n.failEdge === k ? n.fails + 1 : 1;
  n.failEdge = k;
  if (n.fails >= 2) navBan(n, k);
}

function navBan(n, k) {
  if (k < 0) return;
  n.ban = k;
  n.banUntil = game.time + NAV.ban;
  n.fails = 0;
  navStats.bans++;
}

// Teleports (NULL's blinks, co-op warps, test setups) start a fresh plan
function navTeleport(e, n, cx) {
  if (Math.abs(cx - n.lastX) > 400 && n.phase !== NAV_REEL) {
    n.phase = NAV_RUN;
    n.edge = -1;
    n.best = Infinity;
  }
  n.lastX = cx;
}

// Run along floor `node` toward x (never off its edge)
function navRunTo(node, x, cx, speed, dead) {
  const p = navPlat(node);
  if (p) x = clamp(x, p.x + 8, p.x + p.w - 8);
  const d = x - cx;
  return Math.abs(d) < dead ? 0 : Math.sign(d) * speed;
}

// The route-following core shared by walkers and bosses (on a floor, the
// target on another one). Returns the run speed it wants.
function navFollow(e, n, m, G, node, goal, t, cx, speed, dt) {
  n.think -= dt;
  n.lost += dt; // (time since it last finished a move: the rescue watchdog)
  if (n.edge < 0 || n.think <= 0 || G.from[n.edge] !== node) {
    n.edge = navChoose(n, G, node, goal, cx);
    n.think = m.think * rand(0.8, 1.25);
  }
  let k = n.edge;
  // the watchdog: no closer for a while? This move is off the menu, try another
  const est = navEstimate(n, G, goal, cx);
  n.est = est;
  if (est < n.best - 0.05) {
    n.best = est;
    n.stuck = 0;
  } else n.stuck += dt;
  if (n.stuck > NAV.stuck) {
    navBan(n, k);
    n.stuck = NAV.stuck * 0.5;
    n.best = Infinity;
    k = n.edge = navChoose(n, G, node, goal, cx);
  }
  if (k < 0) return navRunTo(node, t.x + t.w / 2, cx, speed, 14); // no way there: as close as this floor gets
  const reachable = navTakeoff(m, G, k, navTk);
  // take off a little inside the range, on the side of the landing (slack for the jump)
  let a = navTk[0];
  let b = navTk[1];
  if (b - a > 70) {
    if (a < G.l0[k]) a += 30;
    if (b > G.l1[k]) b -= 30;
  }
  const gx = clamp(cx, a + 2, Math.max(a + 2, b - 2));
  if (Math.abs(gx - cx) > 4) return Math.sign(gx - cx) * Math.min(speed, Math.abs(gx - cx) * 8 + 40);
  // at the take-off point: take turns with anyone else using it, then go
  if (n.settle > 0) {
    n.settle -= dt;
    return 0;
  }
  if (game.time < G.busy[k]) n.stuck = Math.max(0, n.stuck - dt); // (waiting its turn is not being stuck)
  if (reachable && game.time >= G.busy[k] && navLaunch(e, n, m, G, k, goal, t, cx)) {
    G.busy[k] = game.time + rand(NAV.stagger[0], NAV.stagger[1]);
    return e.vx;
  }
  n.wait += dt;
  // (a moving floor comes back within its period; anything longer is a dead end)
  const pa = navPlat(G.from[k]);
  const pb = navPlat(G.to[k]);
  const patience = 1.5 + Math.max(pa ? pa.period || 0 : 0, pb ? pb.period || 0 : 0);
  if (n.wait > patience) {
    navBan(n, k);
    n.edge = -1;
    n.wait = 0;
  }
  return 0;
}

// A walker: returns the run speed it wants (jumps, drops and grapples happen
// in here). wander: camo blinded it, it mills around on its own floor.
function navWalker(e, dt, t, wander) {
  const n = e.nav || (e.nav = navState());
  const m = n.m || (n.m = navMoverFor(e));
  const G = navGraph(m);
  const cx = e.x + e.w / 2;
  navTeleport(e, n, cx);
  if (n.phase === NAV_AIM || n.phase === NAV_REEL) return 0;
  if (n.phase === NAV_AIR) {
    if (!e.onGround) return navSteerAir(e, n, m, G);
    navLand(e, n, G);
  }
  const speed = e.def.speed;
  const tx = wander ? wander.x : t.x + t.w / 2;
  if (!e.onGround) return Math.abs(tx - cx) < 12 ? 0 : Math.sign(tx - cx) * speed; // knocked off: drift its way
  const node = navNodeOf(e.standingOn);
  n.node = node;
  if (wander) {
    n.edge = -1;
    n.stuck = n.lost = 0;
    return navRunTo(node, tx, cx, speed, 12);
  }
  const goal = navNodeOfBody(t);
  if (goal !== n.goal) {
    n.goal = goal;
    n.think = 0;
    n.best = Infinity;
  }
  if (node === goal) {
    n.edge = -1;
    n.stuck = n.lost = 0;
    n.best = Infinity;
    return navRunTo(node, tx, cx, speed, 12);
  }
  return navFollow(e, n, m, G, node, goal, t, cx, speed, dt);
}

// The walker's physics step: the grapple hauls it up, otherwise the usual
// platform physics. Returns true on landing.
function navMoveWalker(e, dt) {
  const n = e.nav;
  if (n && n.phase === NAV_AIM) {
    n.t -= dt;
    e.vx = 0;
    const pb = navPlat(n.m.graph.to[n.edge]);
    if (e.stun > 0 || !pb) n.phase = NAV_RUN;
    else if (n.t <= 0) {
      n.phase = NAV_REEL;
      synth.play("bowRelease", { rate: 0.55 });
    }
    return moveBody(e, dt, NAV_WALKER_G, NAV_WALKER_FALL);
  }
  if (n && n.phase === NAV_REEL) return navReel(e, n, dt);
  e.dropTimer = Math.max(0, (e.dropTimer || 0) - dt);
  return moveBody(e, dt, NAV_WALKER_G, NAV_WALKER_FALL);
}

// Grapple: straight up the line to the anchor, then onto the floor
function navReel(e, n, dt) {
  const G = n.m.graph;
  const pb = navPlat(G.to[n.edge]);
  if (!pb || e.stun > 0 || Math.abs(e.kbX) > 260) {
    n.phase = NAV_AIR; // knocked off the line: it falls (and may try again)
    return moveBody(e, dt, NAV_WALKER_G, NAV_WALKER_FALL);
  }
  const ax = pb.x + n.lrel;
  const dx = ax - (e.x + e.w / 2);
  const dy = pb.y - (e.y + e.h);
  const d = Math.hypot(dx, dy);
  const step = n.m.grapple.reel * dt;
  e.vx = e.vy = 0;
  e.onGround = false;
  e.standingOn = null;
  if (d <= step + 1) {
    e.x = ax - e.w / 2;
    e.y = pb.y - e.h;
    e.onGround = true;
    e.standingOn = pb;
    n.phase = NAV_AIR;
    navLand(e, n, G);
    dust(ax, pb.y, 8, 1.3);
    return true;
  }
  e.x += (dx / d) * step;
  e.y += (dy / d) * step;
  return false;
}

// The grapple line (enforcer)
function drawNavLine(e) {
  const n = e.nav;
  if (!n || (n.phase !== NAV_AIM && n.phase !== NAV_REEL) || n.edge < 0) return;
  const pb = navPlat(n.m.graph.to[n.edge]);
  if (!pb) return;
  const hx = e.x + e.w / 2 + e.facing * e.w * 0.3;
  const hy = e.y + e.h * 0.3;
  const ax = pb.x + n.lrel;
  const k = n.phase === NAV_AIM ? clamp(1 - n.t / n.m.grapple.aim, 0, 1) : 1;
  ctx.strokeStyle = "rgba(25,245,255,0.85)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + (ax - hx) * k, hy + (pb.y - hy) * k);
  ctx.stroke();
  glow(hx + (ax - hx) * k, hy + (pb.y - hy) * k, 26, "rgba(25,245,255,0.8)");
}

// A boss: the same routes with its own jumps (bossNavigate in bosses.js).
// targetX is where it wants to stand once it is on your floor.
function navBoss(e, dt, targetX, speed) {
  const n = e.nav || (e.nav = navState());
  const m = n.m || (n.m = navMoverFor(e));
  const G = navGraph(m);
  const cx = e.x + e.w / 2;
  navTeleport(e, n, cx);
  if (n.phase === NAV_AIR) {
    if (!e.onGround) return navSteerAir(e, n, m, G);
    navLand(e, n, G);
  }
  if (!e.onGround) return Math.abs(targetX - cx) < 20 ? 0 : Math.sign(targetX - cx) * speed;
  const node = navNodeOf(e.standingOn);
  n.node = node;
  const t = enemyTarget(e);
  const goal = t.camo > 0 ? node : navNodeOfBody(t);
  if (goal !== n.goal) {
    n.goal = goal;
    n.think = 0;
    n.best = Infinity;
  }
  if (node === goal) {
    n.edge = -1;
    n.stuck = n.lost = 0;
    n.best = Infinity;
    return navRunTo(node, targetX, cx, speed, 20);
  }
  return navFollow(e, n, m, G, node, goal, t, cx, speed, dt);
}

// ------------------------------------------------------------ Spawning ------
// A walker comes in at the screen edge on a floor near the target's height
// that has a route to it (not on the street while you are 1200 px up)
const navSpot = { x: 0, y: 0 };
function navSpawnSpot(type, side, offset) {
  const def = ENEMY_TYPES[type];
  const m = navMoverFor({ type, def });
  const goal = navNodeOfBody(player);
  const feet = player.y + player.h;
  const lo = side < 0 ? camera.x - 60 - offset - 480 : camera.x + W + 60 + offset;
  const hi = lo + 480;
  let best = Infinity;
  for (let node = 0; node <= platforms.length; node++) {
    const p = navPlat(node);
    if (navMoving(p)) continue;
    const r0 = Math.max(lo, p ? p.x + 8 : def.w / 2);
    const r1 = Math.min(hi, p ? p.x + p.w - 8 : WORLD_W - def.w / 2);
    if (r1 < r0) continue;
    const y = p ? p.y : GROUND_Y;
    const score = Math.abs(y - feet) * (y < feet - 60 ? 1.5 : 1) + rand(0, 90);
    if (score >= best || !navReachable(m, node, goal)) continue;
    best = score;
    navSpot.x = (side < 0 ? r1 : r0) - def.w / 2;
    navSpot.y = y - def.h;
  }
  return best < Infinity;
}

// --------------------------------------------------------------- Debug ------
// ?navdebug: the crawler's graph, every floor's number and each enemy's route
function drawNavDebug() {
  if (!navDebug.on) return;
  const m = navMovers.crawler || navMoverFor({ type: "crawler", def: ENEMY_TYPES.crawler });
  const G = navGraph(m);
  const colors = ["rgba(25,245,255,0.22)", "rgba(255,225,77,0.3)", "rgba(255,47,214,0.3)"];
  ctx.save();
  ctx.lineWidth = 2;
  const nodeY = (n) => (n ? navPlat(n).y : GROUND_Y);
  for (let k = 0; k < G.E; k++) {
    const a = (G.t0[k] + G.t1[k]) / 2;
    const b = (G.l0[k] + G.l1[k]) / 2;
    if (Math.abs(a - b) > 1400) continue; // (the street's long hops just clutter)
    const ya = nodeY(G.from[k]);
    const yb = nodeY(G.to[k]);
    ctx.strokeStyle = colors[G.kind[k]];
    ctx.beginPath();
    ctx.moveTo(a, ya);
    ctx.quadraticCurveTo((a + b) / 2, Math.min(ya, yb) - 60, b, yb);
    ctx.stroke();
  }
  platforms.forEach((p, i) => hudText(String(i + 1), p.x + p.w / 2, p.y + 18, 16, "#5aff7a", "center", "middle"));
  // routes
  enemies.forEach((e) => {
    const n = e.nav;
    if (e.dead || !n || n.goal < 0) return;
    const GE = n.m.graph;
    const f = GE.fields[n.goal];
    let x = e.x + e.w / 2;
    let y = e.y + e.h;
    let node = n.node;
    let k = n.edge;
    ctx.strokeStyle = e.boss ? "rgba(255,36,87,0.9)" : "rgba(90,255,122,0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let hop = 0; hop < 12 && k >= 0 && f; hop++) {
      const tx = clamp(x, GE.t0[k], GE.t1[k]);
      ctx.lineTo(tx, nodeY(node));
      x = clamp(tx, GE.l0[k], GE.l1[k]);
      node = GE.to[k];
      ctx.lineTo(x, nodeY(node));
      if (node === n.goal) break;
      let next = -1;
      let bc = Infinity;
      for (let i = GE.outStart[node]; i < GE.outStart[node + 1]; i++) {
        const k2 = GE.outList[i];
        const c = f[k2] + navGap(x, x, GE.t0[k2], GE.t1[k2]) / GE.run;
        if (c < bc) {
          bc = c;
          next = k2;
        }
      }
      k = next;
    }
    ctx.stroke();
    const label = `${n.node}>${n.goal} ${["run", "air", "aim", "reel"][n.phase]}${n.stuck > 1 ? " stuck " + n.stuck.toFixed(1) : ""}`;
    hudText(label, e.x + e.w / 2, e.y - 24, 14, "#ffffff", "center", "middle");
  });
  ctx.restore();
}

// ------------------------------------------------------------- Helpers ------
// Shove a walker sideways (anti-stacking), but never off the floor it is on
function navShove(e, dx) {
  const p = e.standingOn;
  let x = e.x + dx;
  if (p && !p.ground) {
    const lo = p.x + 4 - e.w / 2;
    const hi = p.x + p.w - 4 - e.w / 2;
    x = dx < 0 ? Math.max(x, Math.min(e.x, lo)) : Math.min(x, Math.max(e.x, hi));
  }
  e.x = clamp(x, 0, WORLD_W - e.w);
}

// Would moving dx carry a walker past the edge of the platform it stands on?
function navAtEdge(e, dx) {
  const p = e.standingOn;
  if (!p || p.ground) return false;
  const nx = e.x + e.w / 2 + dx;
  return nx < p.x + 8 || nx > p.x + p.w - 8;
}

// Running or sliding along a platform: never past its edge (8 px in)
function navLedgeClamp(e, vx, dt) {
  const p = e.standingOn;
  if (!p || p.ground || !(dt > 0)) return vx;
  const cx = e.x + e.w / 2;
  if (vx > 0 && cx + vx * dt > p.x + p.w - 8) return Math.max(0, (p.x + p.w - 8 - cx) / dt);
  if (vx < 0 && cx + vx * dt < p.x + 8) return Math.min(0, (p.x + 8 - cx) / dt);
  return vx;
}

// Flyers spread out: a push away from every other flyer too close (into
// navFlock, no allocation). Walkers and bosses don't count.
const navFlock = { x: 0, y: 0 };
function navSpread(e) {
  let fx = 0;
  let fy = 0;
  const ax = e.x + e.w / 2;
  const ay = e.y + e.h / 2;
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i];
    if (o === e || o.dead || o.boss || o.def.walker || o.downed) continue;
    const dx = ax - (o.x + o.w / 2);
    const dy = ay - (o.y + o.h / 2);
    const r = (e.w + o.w) * 0.5 + 50;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    const d = Math.sqrt(d2);
    const k = 1 - d / r;
    if (d > 0.5) {
      fx += (dx / d) * k;
      fy += (dy / d) * k;
    } else fx += e.bob > o.bob ? k : -k; // exactly on top of each other: split sideways
  }
  navFlock.x = fx;
  navFlock.y = fy;
}

// ------------------------------------------------- For later: the EMP ------
// Hackerman's EMP will "compromise" enemies so the others turn on them. The
// hook is enemyTarget(e) (enemies.js): set e.forcedTarget = victim (any
// enemy body) on each enemy that should go after it, null to let go; it
// falls back to the player once the victim dies. Already routed through it:
// walker routes (navWalker / navNodeOfBody work on any body), flyer steering,
// aiming (fireEnemyShot with an owner, the sniper's sight), camo blindness
// (target.camo: enemies have none) and the despawn distance. Still to add
// for compromise itself:
//  - contact damage: updateEnemy only hurts players (eachTarget); when
//    target !== player, overlapping it should damageEnemy(target, ...) with a
//    source added to NOT_PLAYER_DAMAGE (no Time Dilation bonus, no heat)
//  - enemy shots: updateEnemyShots only tests players; a shot fired at an
//    enemy target needs a flag so it can hit enemies (never its owner)
//  - the compromised enemy itself gets forcedTarget = its nearest ally
//  - bosses keep using `player` directly (they ignore forcedTarget)
//  - the despawn check measures from the target: with a forced target,
//    measure from the player instead, or a far-off brawl never despawns
