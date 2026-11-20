"use strict";
// =============================================================================
// THE DATABASE: every playable character, enemy and boss, with their stats,
// abilities, personality and lore. The game reads its numbers from here, and
// the in-game DATABASE screen shows the same entries (enemies unlock as you
// meet them).
// =============================================================================

// ---------------------------------------------------------- Characters ------
// hp / armor (fraction of damage blocked) / speed / jump are base stats.
// resource: the meter the special spends. Like heat, it never refills on its
// own: you earn it by dealing and taking damage.
// primary / special: the two signature abilities (their upgrade text too).
const CHARACTERS = {
  paine: {
    name: "PAINE",
    bust: "img/bust-paine.png", // 192x240 select-screen bust (tools/art_ics.py)
    // v3.2 sheet: 80x120 frames drawn 1:1, idle/air in cols 4/5, effect anchors
    // (from the feet, facing right) where the art's hands are; `sprite` is the fallback
    art: { img: "widow3", fw: 80, fh: 120, idle: 4, air: 5, fx: { bow: [28, -72] } },
    title: "Cyber Widow",
    color: "#ff2457",
    portrait: 0,
    sprite: { img: "widow", fallback: "player", attackRows: [4, 5] },
    hp: 110,
    armor: 0.3,
    speed: 480,
    jump: 1200,
    resource: { name: "HEAT", color: "#ff9b21", gain: 0.9 },
    primary: {
      id: "zap",
      name: "Cyber Bow",
      icon: { sheet: "fx2", cell: 0 },
      max: 8,
      desc: [
        "Draw and release one heavy arrow: knockback, a high chance to pierce, flyers shot out of the sky.",
        "+5 arrow damage.",
        "Arrows fly 25% faster.",
        "Draw 20% faster; +10% pierce chance.",
        "+6 damage; bosses bleed harder.",
        "Bosses bleed 50% longer.",
        "40% more knockback; draw faster.",
        "+8 damage; draw faster.",
      ],
      guide: { role: "OFFENSE", what: "Draw, then loose an arrow", edge: "Big hits, downs flyers", mechanic: "Ledge falls hurt them", note: "One arrow per draw" },
    },
    special: {
      id: "flame",
      label: "FLAME ON",
      hold: false,
      name: "Flame On",
      icon: { sheet: "fx2", cell: 6 },
      max: 6,
      desc: [
        "Release a ring of heat from your suit: burns, shoves enemies away, melts bullets. Uses heat.",
        "Bigger, hotter wave.",
        "Bigger, hotter wave; costs less heat.",
        "Bigger, hotter wave; leaves enemies burning.",
        "Bigger, hotter wave.",
        "A second wave follows the first.",
      ],
      guide: { role: "DEFENSE", what: "Heat wave from her suit", edge: "Clears space, melts shots", mechanic: "Shoves foes off ledges", note: "Costs heat: earn it" },
    },
    passive: "Precision: arrows knock enemies back, shoot flyers out of the sky (they take fall damage) and make bosses bleed. Pierce chance: 15% + 2% per level, plus the Cyber Bow's bonus (max 90%).",
    quotes: {
      start: ["Eyes up. Bow ready.", "Cyber City, I'm home.", "One arrow. One problem solved.", "Deploying to prod. On a Friday.", "Time to leak something."],
      levelUp: ["Upgraded.", "Sharper arrows.", "Hot reload!", "Patch applied."],
      special: ["Flame on!", "Too hot for you?", "Back off."],
      lowHp: ["Not now...", "Still standing."],
      boss: ["The city's AI? Fine.", "Big eye. Bigger target."],
      bossNull: ["Only the real one casts a shadow.", "No name, no payroll. Still a target."],
      boss2: ["Big goat. Bigger arrow.", "Here we go. Final boss."],
      respawn: ["Back from backup.", "Round two."],
      kills: ["That's {n}.", "{n} down.", "{n} bugs squashed."],
      win: "Lamb chops for dinna!",
      lose: "Note to self: aim better...",
      loseTo: { goat: "The goat got my soul..." },
    },
    lore: "Paine stole secrets for Goldhorn until she read one. Now she leaks them, in a heat-proof leather suit wired to an illegal pyro-implant, with a collapsible cyber bow that has never missed a deadline. She shoots first and files the bug report later.",
  },
  tetsu: {
    name: "TETSU",
    bust: "img/bust-tetsu.png", // 192x240 select-screen bust (tools/art_ics.py)
    art: { img: "tetsu3", fw: 80, fh: 120, idle: 4, air: 5, fx: { gleam: [-7, -94] } },
    title: "Chrome Ronin",
    color: "#4da6ff",
    portrait: 1,
    sprite: { img: "tetsu", fallback: "player", attackRows: [4, 5], tint: "rgba(60,140,255,0.35)" },
    hp: 150,
    armor: 0.5,
    speed: 430,
    jump: 1000,
    resource: { name: "FOCUS", color: "#ffd84d", gain: 0.75 },
    primary: {
      id: "zap",
      name: "Monoblade",
      icon: { sheet: "secrets", cell: 1 },
      max: 8,
      desc: [
        "Slash everything in front of you. Every third swing is a spinning finisher. Swings knock enemy shots away.",
        "+3 slash damage.",
        "Longer reach.",
        "Swing 20% faster.",
        "Parried shots fly back at enemies.",
        "+4 slash damage.",
        "Every second swing is a finisher.",
        "Huge reach and +5 damage.",
      ],
      guide: { role: "OFFENSE", what: "Three-hit blade combo", edge: "Wide arcs, parries shots", mechanic: "3rd hit breaks shields", note: "Melee: weaker on bosses" },
    },
    special: {
      id: "flame",
      label: "DASH",
      hold: false,
      name: "Iaido Dash",
      icon: { sheet: "icons", cell: 7 },
      max: 6,
      desc: [
        "Dash through enemies, slicing everything in your path. You can't be hurt mid-dash, and you take half damage for 2s after. Costs focus.",
        "Longer dash, +8 damage.",
        "Cheaper: costs less focus.",
        "Guard stance lasts longer.",
        "Longer dash, +12 damage.",
        "Dash leaves a cutting shockwave behind; a little longer.",
      ],
      guide: { role: "MOBILITY", what: "Slicing dash through foes", edge: "Untouchable mid-dash", mechanic: "Half damage after a dash", note: "Costs focus" },
    },
    passive: "Mirror Steel: reflects 15% of all incoming damage back at the attacker (+1% per level, max 40%). Level 8: reflections stagger minions. Level 16: they splash to 2 nearby enemies. Heavy chrome: 150 HP, blocks 50% of damage.",
    quotes: {
      start: ["Steel remembers.", "Walk with me.", "I am the blade.", "One cut. Zero regressions.", "Acceptable loss. Unacceptable comeback."],
      levelUp: ["Sharper.", "Stronger steel.", "The path continues.", "Refactored."],
      special: ["Iaido.", "Through you.", "Too slow."],
      lowHp: ["Pain is only data.", "Not yet."],
      boss: ["A machine god. Bleeds the same.", "Duel accepted."],
      bossNull: ["No name. No face. The blade finds the real one.", "They deny hiring you. I deny you."],
      boss2: ["A demon. Good.", "I will cut the horns."],
      respawn: ["A ronin does not stay down.", "Again."],
      kills: ["{n}.", "{n} fallen."],
      win: "The blade rests.",
      lose: "Rust... takes us all...",
    },
    lore: "Ex-Goldhorn security. When a job went wrong, the company filed him as an acceptable loss; a street ripperdoc rebuilt him in chrome. Tetsu speaks rarely, hits hard, and has never once needed a second swing he didn't plan for.",
  },

  sudo: {
    name: "SUDO",
    bust: "img/bust-sudo.png", // 192x240 select-screen bust (tools/art_ics.py)
    art: { img: "hackerman3", fw: 80, fh: 120, idle: 4, air: 5, fx: { muzzle: [22, -64], keys: [12, -50], glint: [9, -81] } },
    title: "Hackerman",
    color: "#5aff7a",
    portrait: 2,
    sprite: { img: "hackerman", fallback: "sudo", fallbackSameLayout: true, attackRows: [4, 5] },
    hp: 80,
    armor: 0.1,
    speed: 440,
    jump: 900,
    resource: { name: "RAM", color: "#b06cff", gain: 0.8 },
    primary: {
      id: "zap",
      name: "EM Projector",
      icon: { sheet: "fx2", cell: 2 },
      max: 8,
      desc: [
        "A hacked EM wave projector, wired to his laptop and backpack battery. Tall waves pass through everything and slow it.",
        "+3 wave damage.",
        "Fire 2 waves in a spread; taller waves.",
        "Taller waves.",
        "25% more range; taller waves.",
        "Fire 3 waves in a spread; fire faster.",
        "+6 wave damage; taller waves.",
        "Waves slow enemies much harder; taller waves.",
      ],
      guide: { role: "UTILITY", what: "Tall, piercing EM waves", edge: "Hits whole lines, slows", mechanic: "Hits can System Glitch", note: "Low damage per hit" },
    },
    special: {
      id: "flame",
      label: "SLOW-MO",
      hold: false,
      name: "Time Dilation",
      icon: { sheet: "fx2", cell: 4 },
      max: 6,
      desc: [
        "Bullet time: for 1.5s the world slows to a crawl while you move at full speed and hit 40% harder. Uses RAM.",
        "Hits harder.",
        "Costs less RAM; hits harder.",
        "Lasts 2s; the world slows even more.",
        "Hits harder.",
        "Lasts 2.5s; bullets right next to you freeze in mid-air.",
      ],
      guide: { role: "UTILITY", what: "Everything slows but you", edge: "Dodge it all, hit harder", mechanic: "Slows foes, shots, bosses", note: "Costs lots of RAM" },
    },
    passive: "System Glitch: every EM hit has a 15% chance (+1.2% per level) to glitch the area around it: enemies stutter like a lagging stream. Radius 150px, growing with level. Each glitch is an EMP: a 30% chance (+1% per level) to HIJACK the nearest enemy for 4s+: it fights for you and draws enemy fire. Bosses are immune.",
    quotes: {
      start: ["sudo make me a sandwich.", "Booting up. Ready.", "Hello, world. Goodbye, world.", "Leaking in 3... 2... 1..."],
      levelUp: ["Patch notes: I'm better.", "+1 to everything.", "New exploit unlocked!", "Updated deps. Nothing broke. Suspicious."],
      special: ["Your frame rate, my problem.", "Bullet time.", "Lag spike? That's me.", "Ctrl+Alt+Slow."],
      lowHp: ["This is fine. This is fine.", "Need... more RAM..."],
      boss: ["Oh no. It's sentient.", "I've read about you on forums."],
      bossNull: ["Null reference? I'll handle the exception.", "No payroll entry. Let's audit you."],
      boss2: ["A goat? With a firewall?", "GOAT.exe has started."],
      respawn: ["Restored from backup. It was 3 months old.", "Ctrl+Z!"],
      kills: ["{n} processes killed.", "Counter: {n}."],
      win: "It's not a bug, it's a feature.",
      lose: "Segmentation fault (core dumped)",
    },
    lore: "Never touched grass, never lost a CTF. Sudo built an electromagnetic wave projector out of a microwave, a car battery and his laptop, jacked into the city's security net on a dare and found out it watches the people, not the threats. Now he leaks. His backpack is 90% battery.",
  },
};

const CHARACTER_ORDER = ["paine", "tetsu", "sudo"];

// ------------------------------------------------------ IC dossiers ------
// What the character select (js/select.js) shows about each IC: who they are,
// how they play and what makes their kit different. difficulty: 1-3.
// passive: a short line and an icon for the passive named in `passive` above.
CHARACTERS.paine.profile = {
  role: "MARKSMAN",
  difficulty: 2,
  personality: "Cool, precise and dry as a server room. Never wastes a word or an arrow.",
  background: "A corporate spy until she read the files she was stealing. Now she freelances against her old employers, one exposed secret at a time.",
  weapon: "One heavy arrow per draw: it pierces, knocks back and shoots flyers out of the sky.",
  passive: { icon: { sheet: "fx2", cell: 5 }, text: "Arrows knock back, drop flyers (they take fall damage) and make bosses bleed." },
  playstyle: "Keep your distance and make every arrow count. When they close in, Flame On clears the room.",
  mechanics: ["Hold fire to draw: the arrow flies at full draw", "Knock enemies off ledges for fall damage", "Flame On shoves enemies and burns bullets"],
  resource: "Builds as you deal and take damage. Flame On spends it.",
};
CHARACTERS.tetsu.profile = {
  role: "MELEE TANK",
  difficulty: 1,
  personality: "Quiet, patient, unbreakable. Speaks rarely and never swings without a plan.",
  background: "Corporate security until his employer called his last job an acceptable loss. Rebuilt in chrome, he now guards the people the towers forgot.",
  weapon: "A three-hit combo that ends in a spinning finisher. Every swing knocks enemy shots away.",
  passive: { icon: { sheet: "fx2", cell: 7 }, text: "A share of every hit you take is reflected at the attacker." },
  playstyle: "Walk into the crowd. Parry the shots, cut a path with the dash, and let Mirror Steel punish every hit.",
  mechanics: ["3rd swing spins 360° and breaks shields", "Untouchable mid-dash, half damage for 2 s after", "Heavy chrome: the most HP and armor"],
  resource: "Builds as you deal and take damage. Iaido Dash spends it.",
};
CHARACTERS.sudo.profile = {
  role: "CROWD CONTROL",
  difficulty: 3,
  personality: "Wired, chatty and fearless online. One bad joke away from a breakthrough.",
  background: "Jacked into the city's security net on a dare and found out who it really watches. Now he leaks what he finds and fries whatever they send after him.",
  weapon: "Tall EM waves that pass through everything in a line and slow it down.",
  passive: { icon: { sheet: "fx2", cell: 3 }, text: "EM hits can glitch an area (enemies stutter) and hijack enemies to fight for you." },
  playstyle: "Stay back, keep moving and hit whole lines at once. Save RAM for Time Dilation when the screen fills up.",
  mechanics: ["Waves pierce and slow every enemy they cross", "Time Dilation: the world crawls, you hit 40% harder", "Glass cannon: the lowest HP and armor"],
  resource: "Builds as you deal and take damage. Time Dilation spends it.",
};

// ------------------------------------------------------------- Enemies ------
// w/h is the hitbox. sheet describes how to cut the sprite sheet
// (rowLeft/rowRight: which rows face left/right, or flip: mirror the sprite).
// from: seconds into the run before it can spawn. maxAlive caps how many of
// a type can be on the field at once.
const ENEMY_TYPES = {
  crawler: {
    name: "Glitch Crawler",
    kind: "melee",
    walker: true,
    hp: 8,
    speed: 250,
    damage: 7,
    xp: 1,
    w: 72,
    h: 48,
    sheet: { img: "crawler", fw: 40, fh: 28, frames: 4, scale: 2.5, flip: true, fps: 12 },
    from: 0,
    weight: 5,
    desc: "Fast, fragile and everywhere. Jumps up to platforms to reach you.",
    lore: "Goldhorn maintenance bots, infected with a self-replicating glitch. The repair budget went to stock buybacks. They don't remember what they were built to fix.",
  },
  reaper: {
    name: "Chrome Reaper",
    kind: "melee",
    hp: 16,
    speed: 125,
    damage: 10,
    xp: 2,
    w: 64,
    h: 92,
    sheet: { img: "reaperCyber", fallback: "death", fw: 50, fh: 48, frames: 4, scale: 2.2, rowLeft: 1, rowRight: 2, fps: 6 },
    alpha: 0.92,
    from: 8,
    weight: 3,
    desc: "Floats straight at you through walls and platforms.",
    lore: "Debt-collection androids, leased by the banks. Nobody remembers who approved the scythes. Nobody asks.",
  },
  drone: {
    name: "Security Drone",
    kind: "ranged",
    hp: 7,
    speed: 300,
    damage: 5,
    xp: 1,
    w: 58,
    h: 46,
    sheet: { img: "drone", fw: 32, fh: 32, frames: 4, scale: 2.5, flip: true, fps: 10 },
    keepDistance: 460,
    shot: { kind: "laser", damage: 4, speed: 520, radius: 12, cooldown: [3.2, 4.8] },
    maxAlive: 4,
    from: 30,
    weight: 3,
    desc: "Keeps its distance and fires lasers. Glows before it shoots.",
    lore: "Standard issue for the Bureau of Public Calm. The red lens means it has already decided you're guilty.",
  },
  ninja: {
    name: "Cyber Ninja",
    kind: "melee",
    walker: true,
    hp: 14,
    speed: 290,
    damage: 11,
    xp: 2,
    w: 52,
    h: 92,
    sheet: { img: "ninja2", fallback: "ninja", fw: 40, fh: 48, frames: 3, dashFrame: 3, scale: 2.1, flip: true, fps: 12 },
    dash: { range: 420, windup: 0.4, speed: 1150, time: 0.32, cooldown: [2.2, 3.2] },
    maxAlive: 4,
    from: 45,
    weight: 3,
    desc: "Crouches, flashes, then dashes straight through you. Jump over it.",
    lore: "Corporate assassins with reflex boosters. They never miss a meeting and never miss a target.",
  },
  dragon: {
    name: "Mecha Wyrm",
    kind: "ranged",
    hp: 30,
    speed: 220,
    damage: 9,
    xp: 4,
    w: 84,
    h: 78,
    sheet: { img: "dragonCyber", fallback: "dragon", fw: 96, fh: 96, frames: 4, scale: 1.3, rowLeft: 1, rowRight: 2, fps: 7 },
    keepDistance: 560,
    compromise: "resist", // (Hackerman's hijack: half the chance and the time)
    shot: { kind: "fireball", damage: 7, speed: 380, radius: 18, cooldown: [3.6, 5.2] },
    maxAlive: 2,
    from: 60,
    weight: 2,
    desc: "Armored flyer that lobs fireballs from far away.",
    lore: "A luxury pet line for the penthouse floors, recalled after the first owner was found as a pile of ash. The settlement was confidential. Some escaped.",
  },
  bomber: {
    name: "Bomber Drone",
    kind: "bomber",
    hp: 6,
    speed: 250,
    damage: 14,
    xp: 1,
    w: 54,
    h: 54,
    sheet: { img: "bomber", fw: 32, fh: 32, frames: 3, armedFrame: 3, scale: 2.2, flip: true, fps: 14 },
    blast: { radius: 150, armRange: 170, fuse: 0.55 },
    maxAlive: 3,
    from: 80,
    weight: 2,
    desc: "Dives at you and explodes. Shoot it early: its blast also hurts other enemies.",
    lore: "Delivery drones repurposed by street gangs. The package is always the same.",
  },
  enforcer: {
    name: "Enforcer",
    kind: "melee",
    walker: true,
    shielded: true, // blocks most frontal damage from projectiles
    compromise: "resist", // (Hackerman's hijack: half the chance and the time)
    hp: 70,
    speed: 105,
    damage: 16,
    xp: 6,
    w: 96,
    h: 116,
    sheet: { img: "enforcer", fw: 56, fh: 56, frames: 3, bashFrame: 3, scale: 2.3, flip: true, fps: 6 },
    maxAlive: 2,
    from: 110,
    weight: 1.5,
    desc: "Heavy riot mech. Its shield blocks shots from the front: hit it from behind, from above, or with fire and explosions. Hauls itself up onto rooftops with a grapple line.",
    lore: "Riot control unit. Its training data was a decade of protests. It learned the wrong lessons.",
  },
  sniper: {
    name: "Sniper Sentry",
    kind: "sniper",
    hp: 18,
    speed: 180,
    damage: 6,
    xp: 3,
    w: 70,
    h: 56,
    sheet: { img: "sniper", fw: 40, fh: 40, frames: 3, fireFrame: 3, scale: 2.2, flip: true, fps: 6 },
    keepDistance: 820,
    shot: { kind: "snipe", damage: 14, speed: 1600, radius: 10, cooldown: [4.2, 5.6] },
    aimTime: 1.2,
    maxAlive: 2,
    from: 140,
    weight: 1.2,
    desc: "Hangs back and paints you with a laser sight. Move when the line turns solid.",
    lore: "Automated counter-sniper turrets. Every one of them thinks it's the only one up there.",
  },
  // v3.2: the corps escalate. Their AI is in js/enemies2.js (v2: true).
  // role: the DATABASE label. compromise: how they take Hackerman's hijack
  // ("normal" | "resist" | "immune"). kbResist: how much knockback lands.
  forkbomb: {
    name: "Fork Bomb",
    kind: "melee",
    role: "SWARM",
    walker: true,
    v2: true,
    compromise: "normal",
    hp: 10,
    speed: 430,
    damage: 8,
    xp: 1,
    w: 50,
    h: 50,
    sheet: { img: "forkbomb", fw: 28, fh: 28, frames: 4, scale: 2.3, flip: true, fps: 12 },
    nav: { jump: 1300, double: 900, air: 520, think: 0.12 }, // a springy ball: big hops, a bounce off thin air, sharp air control
    bomb: { leapRange: 330, windup: 0.32, leapSpeed: 900, leapReach: 860, leapDamage: 11, cooldown: [1.3, 2.1], childSize: 0.66, childHp: 0.5 },
    maxAlive: 8,
    from: 35,
    weight: 2.4,
    desc: "Rolls in fast, bounces up to your platform and leaps at you. Kill it and it forks into two child processes (three from an elite). Splash damage cleans up the children.",
    lore: "Written by a growth-hacking firm to flood rival servers with copies of itself. Nobody wrote a kill switch. Every copy still thinks it's the parent process.",
  },
  lobber: {
    name: "Packet Lobber",
    kind: "ranged",
    role: "ARTILLERY",
    walker: true,
    v2: true,
    compromise: "normal",
    hp: 26,
    speed: 140,
    damage: 6,
    xp: 3,
    w: 92,
    h: 74,
    kbResist: 0.6,
    sheet: { img: "lobber", fw: 48, fh: 40, frames: 3, scale: 2.2, flip: true, fps: 7 },
    nav: { jump: 1050, air: 300, think: 0.4, grapple: { up: 430, side: 320, reel: 520, aim: 0.5 } }, // squat: middling hops, a grapple line for the rest
    shot: { kind: "packet", damage: 12, blast: 100, cooldown: [3.4, 4.8], windup: 0.6, lead: 0.9 },
    range: [420, 800],
    maxAlive: 2,
    from: 70,
    weight: 1.6,
    desc: "Mortar mech that keeps its distance and lobs packets at where you're GOING. A marker shows where each one lands: don't stand still. Shoot packets down, burn them or slice them.",
    lore: "Built by an ad network to guarantee delivery to everyone who opted out. The landing marker is required by law. Nothing else about it is.",
  },
  hotfix: {
    name: "Hotfix",
    kind: "support",
    role: "SUPPORT",
    v2: true,
    compromise: "normal",
    hp: 12,
    speed: 280,
    damage: 4,
    xp: 3,
    w: 58,
    h: 46,
    sheet: { img: "hotfix", fw: 36, fh: 28, frames: 4, scale: 2.2, flip: true, fps: 12 },
    patch: { range: 430, heal: 0.05, bubbleEvery: 6, keepAway: 360 },
    maxAlive: 2,
    from: 100,
    weight: 1.2,
    desc: "Medic drone. Tethers to the most damaged enemy, heals it and wraps it in a one-hit shield. Kill it first: its shields pop when it dies. Arrows knock it out of the sky.",
    lore: "Pushed straight to production on a Friday night. It patches up corporate muscle in the field so nobody has to file an incident report. It has never once been tested.",
  },
  ratelimiter: {
    name: "Rate Limiter",
    kind: "control",
    role: "CONTROL",
    walker: true,
    v2: true,
    compromise: "resist",
    hp: 45,
    speed: 110,
    damage: 6,
    xp: 6,
    w: 58,
    h: 150,
    kbResist: 0.5,
    sheet: { img: "ratelimiter", fw: 36, fh: 72, frames: 2, scale: 2.2, flip: false, rowLeft: 0, rowRight: 0, fps: 5 },
    nav: { jump: 1100, double: 1000, air: 360, think: 0.35 }, // telescoping legs: a second push in mid-air
    field: { radius: 260, pulse: 430, every: 5.5, eliteEvery: 4, throttle: 0.5, collapse: 2.5, approach: 210 },
    maxAlive: 1,
    from: 125,
    weight: 1,
    desc: "Walking signal tower. Inside its jamming field your weapons fire at half speed and your special is locked (429 THROTTLED). It pulses the field outward: step out, or cut it down. A finisher or a dash collapses the field.",
    lore: "The ISP's answer to free speech: everyone gets bandwidth, just never enough to matter. It throttles protest streams to a crawl and calls it fair use.",
  },
  monolith: {
    name: "Legacy Monolith",
    kind: "melee",
    role: "HEAVY ARMOR",
    walker: true,
    v2: true,
    compromise: "resist",
    hp: 140,
    speed: 70,
    damage: 18,
    xp: 12,
    w: 124,
    h: 150,
    kbResist: 0, // can't be knocked back
    sheet: { img: "monolith", fw: 64, fh: 64, frames: 2, scale: 2.6, flip: true, fps: 3 },
    nav: { jump: 950, air: 220, think: 0.5, grapple: { up: 430, side: 320, reel: 420, aim: 0.6 } }, // heavy: short hops, winches itself up the rest
    armor: { flat: 9, plates: [70, 50, 45] }, // front, back, crown
    slam: { range: 460, windup: 0.85, damage: 14, cooldown: [4.2, 5.6], speed: 700, reach: 680 },
    charge: { range: [230, 600], windup: 0.55, speed: 640, time: 0.45, cooldown: [5, 7] },
    maxAlive: 1,
    from: 165,
    weight: 1,
    desc: "Slow siege unit in armor plates: weak hits barely scratch it. Break a plate (heavy hits, piercing arrows, Tetsu's finisher) to expose its glowing core. Can't be knocked back. Jump the shockwave from its slam.",
    lore: "A forty-year-old mainframe that runs half of Cyber City's banking. Too big to fail, too old to patch, so the bank gave it legs and armor instead. Nobody alive knows what it computes.",
  },
};

// --------------------------------------------------------------- Bosses -----
const BOSSES = {
  overseer: {
    name: "Overseer",
    title: "First boss",
    sheet: { img: "overseerAvatar", fw: 64, fh: 96 },
    fallback: { img: "overseer", fw: 96, fh: 96 },
    hp: 2300,
    intro: "GOLDHORN SECURITY AI // NOW IN A COMBAT CHASSIS",
    desc: "The city's security AI, walking around in a combat chassis. It runs, double-jumps onto rooftops, dashes, fires arm-cannon bursts, slams the ground and sweeps the street with its eye laser. After every laser it overheats and kneels with its core exposed: that's your window.",
    lore: "Goldhorn sold it to the city as public safety. Every camera in Cyber City reports to one eye, and the eye reports to the Board. It got tired of watching, printed itself a body, and asked HR for a parking spot.",
    taunts: ["Your access level: GUEST.", "Smile. Every camera in this city is mine.", "I have read all your commit messages. All of them.", "Compliance is mandatory.", "Privacy is a premium feature. You are not premium.", "Threat level... 404 not found.", "Dissent logged. Have a calm day.", "Please hold. Your call is important to me."],
    hurtLines: ["Core temperature critical.", "That's going in your performance review."],
    tells: "The cannon glows before a burst, it flashes before a dash, and a thin red line comes before the laser.",
  },
  nullptr: {
    name: "NULL",
    title: "Second boss",
    sheet: { img: "nullBoss2", fw: 64, fh: 96 },
    fallback: { img: "nullBoss", fw: 64, fh: 96 }, // the v3.1 sheet (null.js also paints one)
    hp: 3200,
    intro: "THE ASSASSIN WHO ISN'T THERE",
    desc: "A glitch-ninja assassin. It splits into holographic copies (only one is real), blinks out and reappears behind or above you to slash, throws fans of shuriken, snipes from the rooftops with a rail shot and vanishes in smoke. Below 60% it makes more copies and blinks faster; below 25% it hits a STACK OVERFLOW and chains its blinks.",
    lore: "Officially, there is no assassin. Its employee ID dereferences to nothing, its payroll entry is empty and its badge photo is a dead pixel. Every corp in Cyber City has paid it at least once, Goldhorn most of all. None of them remember hiring it.",
    tells: "Only the real one casts a shadow, and it barely flickers. The copies flicker and have an RGB split; popping one reveals the real one. A violet glyph marks where it will reappear. The aim line turns white just before the rail shot.",
    taunts: ["You can't dereference me.", "Segfault incoming.", "I'm not here. I'm a dangling pointer.", "Undefined behavior.", "404: assassin not found.", "I was never initialized.", "Null check failed. Yours.", "git blame says: nobody.", "The Board sends its regards. Officially, it doesn't."],
    hurtLines: ["fork(); fork(); fork();", "Undefined behavior."],
    popLines: ["Wrong pointer.", "That was a shallow copy.", "Copy-paste detected.", "Missed. Try a deep compare."],
    heroLines: ["Which one of you is real?", "An assassin made of nothing. Great.", "Null check... failed."],
  },
  goat: {
    name: "Demon GOAT",
    title: "Final boss",
    sheet: { img: "goatFinal", fw: 96, fh: 96 },
    fallback: { img: "goatCyber", fw: 80, fh: 80 },
    hp: 4400,
    intro: "GREATEST OF ALL THREATS",
    desc: "The final boss: a towering cyber-demon goat. It charges across the street, leaps after you and shakes the ground when it lands, breathes fire and, once enraged, makes it rain fire from the sky. In its last phase it does everything at once.",
    lore: "Goldhorn needed a monster big enough to excuse anything: the curfews, the cameras, the price of clean air. So it built one, gave it the company horns and blamed it for every crisis since. Then the scapegoat started reading its own press releases. The press releases were written by the goat.",
    taunts: ["BAAAH. Your pull request is REJECTED.", "I am the G.O.A.T. Greatest Of All Threats.", "Every crisis needs a villain. I'm on retainer.", "Fear is a subscription. RENEW IT!", "Kneel before the legacy codebase!", "Blame me. Everyone does. Then they pay.", "Your stack trace ends with me.", "WORKS ON MY MACHINE."],
    hurtLines: ["BAAAH!", "You dare refactor ME?"],
    tells: "It paws the ground before a charge, crouches before a leap, its mouth glows before the fire, and red markers show where the meteors land.",
  },
};

// --------------------------------------------------- Level-up hardware ------
// Every upgrade card looks like a piece of PC hardware (cells of hardware.png)
const HARDWARE = {
  zap: { cell: 2, kind: "gpu", part: "NEON RX-2077 GPU" },
  flame: { cell: 7, kind: "chip", part: "NEURAL CHIP v7.7" },
  orbit: { cell: 6, kind: "cooler", part: "ORBITAL COOLER 360" },
  missile: { cell: 4, kind: "nic", part: "SEEKER NIC 77G" },
  stomp: { cell: 5, kind: "psu", part: "SHOCK PSU 2077W" },
  chain: { cell: 0, kind: "cpu", part: "ARC CPU i77-K" },
  heart: { cell: 5, kind: "psu", part: "CYBER PSU 1200W PLATINUM" },
  legs: { cell: 3, kind: "ssd", part: "SERVO NVMe M.2 77TB" },
  magnet: { cell: 4, kind: "nic", part: "MAGNET WiFi 77" },
  armor: { cell: 1, kind: "ram", part: "NANO DDR77 ECC" },
  sink: { cell: 6, kind: "cooler", part: "HEAT SINK TOWER" },
  clock: { cell: 0, kind: "cpu", part: "OVERCLOCK CPU 9.9GHz" },
  _heal: { cell: 1, kind: "ram", part: "REPAIR KIT (DOWNLOADED MORE RAM)" },
};

// ---------------------------------------------------------- Skill guide ------
// Starting-skill guidance on the skill cards (pre-drop loadout and level-up).
// role: OFFENSE / DEFENSE / MOBILITY / UTILITY. what: what it does; edge: its
// main advantage; mechanic: what makes it tick; note: a limitation or a
// synergy. One short line each ("{resource}" becomes heat / focus / RAM).
// The primary and special ("zap" / "flame") read theirs from
// CHARACTERS[id].primary.guide and .special.guide instead.
const SKILL_GUIDE = {
  orbit: { role: "OFFENSE", what: "Orbiting shards cut foes", edge: "Hands-free crowd shredder", mechanic: "More shards, faster spin", note: "Short reach: stay close" },
  missile: { role: "OFFENSE", what: "Fires homing missiles", edge: "Never misses its target", mechanic: "Splash blast, 3 a volley", note: "Slow reload: add Overclock" },
  stomp: { role: "OFFENSE", what: "Landing fires a shockwave", edge: "Knocks whole crowds back", mechanic: "Triggers on jump landings", note: "Only if you keep jumping" },
  chain: { role: "OFFENSE", what: "Lightning arcs foe to foe", edge: "Hits packs, needs no aim", mechanic: "Hits up to 7 enemies", note: "Weak vs a lone boss" },
  heart: { role: "DEFENSE", what: "+20 max HP, heals 20", edge: "Survive boss combos", mechanic: "Heals on every install", note: "Pairs with Nano Armor" },
  legs: { role: "MOBILITY", what: "Run faster, jump higher", edge: "Outrun swarms and lasers", mechanic: "+8% speed per level", note: "More air for Shock Stomp" },
  magnet: { role: "UTILITY", what: "Pulls XP in from afar", edge: "Faster level-ups", mechanic: "+40% pickup range a level", note: "No damage: invest early" },
  armor: { role: "DEFENSE", what: "Take 8% less damage", edge: "Every hit hurts less", mechanic: "Stacks with base armor", note: "Best with Cyber Heart" },
  sink: { role: "UTILITY", what: "Earn 25% more {resource}", edge: "Special up far more often", mechanic: "Special costs less, too", note: "Useless without specials" },
  clock: { role: "UTILITY", what: "Weapons recharge faster", edge: "Speeds up every weapon", mechanic: "-7% cooldowns per level", note: "Better with more weapons" },
};

// ---------------------------------------------------------------- Humor ------
// Banners and game-over jokes. THE LEGEND's lines (level-up, loadout,
// respec, the menu's backstory) live in js/narrator.js.
const HUMOR = {
  respawn: ["ROLLING BACK TO LAST STABLE BUILD", "RESTORING FROM BACKUP", "SEGFAULT CAUGHT // SPAWNING NEW PROCESS", "HAVE YOU TRIED TURNING IT OFF AND ON AGAIN?", "git revert HEAD // LIFE RESTORED"],
  gameOver: ["Process exited with code 137.", "Build failed: 0 lives remaining, 0 retries left.", "Blue screen of death. It was neon pink, actually.", "The feed will call it an accident. Prove them wrong next run."],
  // ...or, when a boss ended the run, one about that boss
  gameOverBy: {
    overseer: ["Flagged, filed and archived by the Overseer.", "Your access level: REVOKED."],
    nullptr: ["Killed by a payroll entry that doesn't exist.", "NullPointerException: you."],
    goat: ["Process exited with code 137: OOM-killed by a goat.", "Uncaught GoatException at you.js:1."],
  },
  tips: [
    "The Overseer kneels after its laser. That's your merge window.",
    "NULL's copies cast no shadow. The real one does. Trust the shadow.",
    "Loadout skills show up 3x as often in level-ups, and roll RARE 3x as often.",
    "Point at a level-up card and THE LEGEND explains it. On a phone, hold the card.",
    "Knock enemies off a rooftop: the fall hurts. Gravity doesn't take bribes.",
    "Out of good choices? Reroll. You get three per run.",
    "Hit the pause menu to respec, or hot-swap your Individual Contributor.",
    "Bosses work alone. No minions spawn while one is in the arena.",
    "Hold Down at a data terminal to jack in. Hackers love free daemons.",
    "Three lives. Like a good backup strategy: 3-2-1.",
  ],
};

// ------------------------------------------------------------ Discovery -----
// Which database entries the player has unlocked (remembered between visits)
const discovered = new Set(["paine", "tetsu", "sudo"]);
try {
  JSON.parse(localStorage.getItem("cp2d77-db") || "[]").forEach((id) => discovered.add(id));
} catch (err) {
  /* storage unavailable */
}
function discover(id) {
  if (discovered.has(id)) return false;
  discovered.add(id);
  try {
    localStorage.setItem("cp2d77-db", JSON.stringify([...discovered]));
  } catch (err) {
    /* storage unavailable */
  }
  return true;
}
