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
    title: "Cyber Widow",
    color: "#ff2457",
    portrait: 0,
    sprite: { img: "widow", fallback: "player", attackRows: [4, 5] },
    hp: 110,
    armor: 0,
    speed: 470,
    jump: 1080,
    resource: { name: "HEAT", color: "#ff9b21", gain: 1.2 },
    primary: {
      id: "zap",
      name: "Cyber Bow",
      icon: { sheet: "fx2", cell: 0 },
      max: 8,
      desc: [
        "Draw and release heavy arrows: knockback, a chance to pierce, flyers shot out of the sky.",
        "+5 arrow damage.",
        "Fire 2 arrows at once.",
        "Draw 20% faster.",
        "+6 damage; bosses bleed harder.",
        "Fire 3 arrows at once.",
        "40% more knockback.",
        "+8 damage and +15% pierce chance.",
      ],
      guide: { role: "OFFENSE", what: "Heavy arrows: draw, then release", edge: "Big hits, knockback, downs flyers", mechanic: "Falls off ledges deal damage", note: "Slow fire; bosses bleed instead" },
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
      guide: { role: "DEFENSE", what: "A heat wave from her suit", edge: "Clears space, melts bullets", mechanic: "Shoves enemies off ledges", note: "Costs heat (earned in combat)" },
    },
    passive: "Precision: arrows knock enemies back, shoot flyers out of the sky (they take fall damage) and make bosses bleed. Pierce chance: 15%, +2% per level.",
    quotes: {
      start: ["Eyes up. Bow ready.", "Cyber City, I'm home.", "One arrow. One problem solved.", "Deploying to prod. On a Friday."],
      levelUp: ["Upgraded.", "Sharper arrows.", "Hot reload!", "Patch applied."],
      special: ["Flame on!", "Too hot for you?", "Back off."],
      lowHp: ["Not now...", "Still standing."],
      boss: ["The city's AI? Fine.", "Big eye. Bigger target."],
      boss2: ["Big goat. Bigger arrow.", "Here we go. Final boss."],
      respawn: ["Back from backup.", "Round two."],
      kills: ["That's {n}.", "{n} down.", "{n} bugs squashed."],
      win: "Lamb chops for dinna!",
      lose: "The goat got my soul...",
    },
    lore: "Ex-corporate spy turned freelancer. Paine wears a heat-proof leather suit wired to an illegal pyro-implant, and carries a collapsible cyber bow that has never missed a deadline. She shoots first and files the bug report later.",
  },
  tetsu: {
    name: "TETSU",
    title: "Chrome Ronin",
    color: "#ff2457",
    portrait: 1,
    sprite: { img: "tetsu", fallback: "player", attackRows: [4, 5], tint: "rgba(255,40,80,0.35)" },
    hp: 150,
    armor: 0.25,
    speed: 430,
    jump: 1040,
    resource: { name: "FOCUS", color: "#5aff7a", gain: 0.75 },
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
      guide: { role: "OFFENSE", what: "A three-hit monoblade combo", edge: "Arc hits, parries bullets", mechanic: "3rd swing: 360° shield-breaker", note: "Melee range: pair with armor/HP" },
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
        "Dash leaves a cutting shockwave behind.",
      ],
      guide: { role: "MOBILITY", what: "A slicing dash through foes", edge: "Invulnerable while dashing", mechanic: "Guard halves damage after", note: "Costs focus; weaker on bosses" },
    },
    passive: "Mirror Steel: reflects 15% of all incoming damage back at the attacker (+1% per level, max 40%). Level 8: reflections stagger. Level 16: they splash to 2 nearby enemies. Heavy chrome: 150 HP, blocks 25% of damage.",
    quotes: {
      start: ["Steel remembers.", "Walk with me.", "I am the blade.", "One cut. Zero regressions."],
      levelUp: ["Sharper.", "Stronger steel.", "The path continues.", "Refactored."],
      special: ["Iaido.", "Through you.", "Too slow."],
      lowHp: ["Pain is only data.", "Not yet."],
      boss: ["A machine god. Bleeds the same.", "Duel accepted."],
      boss2: ["A demon. Good.", "I will cut the horns."],
      respawn: ["A ronin does not stay down.", "Again."],
      kills: ["{n}.", "{n} fallen."],
      win: "The blade rests.",
      lose: "Rust... takes us all...",
    },
    lore: "Ex-corporate security, rebuilt in chrome after a job went wrong. Tetsu speaks rarely, hits hard, and has never once needed a second swing he didn't plan for.",
  },

  sudo: {
    name: "SUDO",
    title: "Hackerman",
    color: "#5aff7a",
    portrait: 2,
    sprite: { img: "hackerman", fallback: "sudo", fallbackSameLayout: true, attackRows: [4, 5] },
    hp: 80,
    armor: 0,
    speed: 480,
    jump: 1100,
    resource: { name: "RAM", color: "#b06cff", gain: 0.8 },
    primary: {
      id: "zap",
      name: "EM Projector",
      icon: { sheet: "fx2", cell: 2 },
      max: 8,
      desc: [
        "A hacked EM wave projector, wired to his laptop and backpack battery. Waves pass through everything and slow it.",
        "+3 wave damage.",
        "Fire 2 waves in a spread.",
        "Fire 20% faster.",
        "Taller waves with 25% more range.",
        "Fire 3 waves in a spread.",
        "+4 wave damage.",
        "Waves slow enemies much harder.",
      ],
      guide: { role: "UTILITY", what: "Piercing EM waves that grow", edge: "Hits whole lines, slows them", mechanic: "Hits can trigger System Glitch", note: "Low damage per hit" },
    },
    special: {
      id: "flame",
      label: "SLOW-MO",
      hold: false,
      name: "Time Dilation",
      icon: { sheet: "fx2", cell: 4 },
      max: 6,
      desc: [
        "Bullet time: the world slows to a crawl while you move at full speed and hit 40% harder. Uses RAM.",
        "Lasts longer, hits harder.",
        "Lasts longer; costs less RAM.",
        "The world slows even more.",
        "Lasts longer, hits harder.",
        "Bullets right next to you freeze in mid-air.",
      ],
      guide: { role: "UTILITY", what: "Bullet time: all but you slows", edge: "Dodge anything, hit 40%+ harder", mechanic: "Slows enemies, bullets, bosses", note: "Costs lots of RAM: save it" },
    },
    passive: "System Glitch: every EM hit has a 15% chance (+1.2% per level) to glitch the area around it: enemies stutter like a lagging stream. Radius 150px, growing with level.",
    quotes: {
      start: ["sudo make me a sandwich.", "Booting up. Ready.", "Hello, world. Goodbye, world."],
      levelUp: ["Patch notes: I'm better.", "+1 to everything.", "New exploit unlocked!", "Updated deps. Nothing broke. Suspicious."],
      special: ["There is no spoon.", "Bullet time.", "Lag spike? That's me.", "Ctrl+Alt+Slow."],
      lowHp: ["This is fine. This is fine.", "Need... more RAM..."],
      boss: ["Oh no. It's sentient.", "I've read about you on forums."],
      boss2: ["A goat? With a firewall?", "GOAT.exe has started."],
      respawn: ["Restored from backup. It was 3 months old.", "Ctrl+Z!"],
      kills: ["{n} processes killed.", "Counter: {n}."],
      win: "It's not a bug, it's a feature.",
      lose: "Segmentation fault (core dumped)",
    },
    lore: "Never touched grass, never lost a CTF. Sudo built an electromagnetic wave projector out of a microwave, a car battery and his laptop, then jacked into the city's security net on a dare. His backpack is 90% battery.",
  },
};

const CHARACTER_ORDER = ["paine", "tetsu", "sudo"];

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
    lore: "Maintenance bots infected with a self-replicating glitch. They don't remember what they were built to fix.",
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
    lore: "Debt-collection androids. Nobody remembers who programmed the scythes. Nobody asks.",
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
    lore: "Standard-issue city surveillance. The red lens means it has already decided you're guilty.",
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
    sheet: { img: "ninja", fw: 40, fh: 48, frames: 3, dashFrame: 3, scale: 2.1, flip: true, fps: 12 },
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
    shot: { kind: "fireball", damage: 7, speed: 380, radius: 18, cooldown: [3.6, 5.2] },
    maxAlive: 2,
    from: 60,
    weight: 2,
    desc: "Armored flyer that lobs fireballs from far away.",
    lore: "A luxury pet line, recalled after the first owner was found as a pile of ash. Some escaped.",
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
    desc: "Heavy riot mech. Its shield blocks shots from the front: hit it from behind, from above, or with fire and explosions.",
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
};

// --------------------------------------------------------------- Bosses -----
const BOSSES = {
  overseer: {
    name: "Overseer",
    title: "First boss",
    sheet: { img: "overseerAvatar", fw: 64, fh: 96 },
    fallback: { img: "overseer", fw: 96, fh: 96 },
    hp: 2300,
    intro: "SECURITY AI // NOW IN A COMBAT CHASSIS",
    desc: "The city's security AI, walking around in a combat chassis. It runs, double-jumps onto rooftops, dashes, fires arm-cannon bursts, slams the ground and sweeps the street with its eye laser. After every laser it overheats and kneels with its core exposed: that's your window.",
    lore: "Every camera in Cyber City reports to one eye. It got tired of watching, printed itself a body, and asked HR for a parking spot.",
    taunts: ["Your access level: GUEST.", "I have read all your commit messages. All of them.", "Compliance is mandatory.", "Threat level... 404 not found.", "Rebooting you in safe mode.", "Please hold. Your call is important to me."],
    hurtLines: ["Core temperature critical.", "That's going in your performance review."],
    tells: "The cannon glows before a burst, it flashes before a dash, and a thin red line comes before the laser.",
  },
  nullptr: {
    name: "NULL",
    title: "Second boss",
    sheet: { img: "nullBoss", fw: 64, fh: 96 },
    fallback: { img: "nullFallback", fw: 64, fh: 96 }, // painted by null.js until the art lands
    hp: 3200,
    intro: "THE ASSASSIN WHO ISN'T THERE",
    desc: "A glitch-ninja assassin. It splits into holographic copies (only one is real), blinks out and reappears behind or above you to slash, throws fans of shuriken, snipes from the rooftops with a rail shot and vanishes in smoke. Below 60% it makes more copies and blinks faster; below 25% it hits a STACK OVERFLOW and chains its blinks.",
    lore: "Officially, there is no assassin. Its employee ID dereferences to nothing, its payroll entry is empty and its badge photo is a dead pixel. Every corp in Cyber City has paid it at least once. None of them remember hiring it.",
    tells: "Only the real one casts a shadow, and it barely flickers. The copies flicker and have an RGB split; popping one reveals the real one. A violet glyph marks where it will reappear. The aim line turns white just before the rail shot.",
    taunts: ["You can't dereference me.", "Segfault incoming.", "I'm not here. I'm a dangling pointer.", "Undefined behavior.", "404: assassin not found.", "I was never initialized.", "Null check failed. Yours.", "git blame says: nobody."],
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
    lore: "Nobody knows where it came from. The rumours say a corp tried to upload a demon into a combat chassis. The rumours say it worked. The rumours were written by the goat.",
    taunts: ["BAAAH. Your pull request is REJECTED.", "I am the G.O.A.T. Greatest Of All Threats.", "Kneel before the legacy codebase!", "I was deprecated once. I came back.", "Your stack trace ends with me.", "WORKS ON MY MACHINE."],
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
  chain: { role: "OFFENSE", what: "Lightning arcs foe to foe", edge: "Hits packs, needs no aim", mechanic: "Jumps to up to 6 enemies", note: "Weak vs a lone boss" },
  heart: { role: "DEFENSE", what: "+20 max HP, heals 20", edge: "Survive boss combos", mechanic: "Heals on every install", note: "Pairs with Nano Armor" },
  legs: { role: "MOBILITY", what: "Run faster, jump higher", edge: "Outrun swarms and lasers", mechanic: "+8% speed per level", note: "More air for Shock Stomp" },
  magnet: { role: "UTILITY", what: "Pulls XP in from afar", edge: "Faster level-ups", mechanic: "+40% pickup range a level", note: "No damage: invest early" },
  armor: { role: "DEFENSE", what: "Take 8% less damage", edge: "Every hit hurts less", mechanic: "Stacks with base armor", note: "Best with Cyber Heart" },
  sink: { role: "UTILITY", what: "Earn 25% more {resource}", edge: "Special up far more often", mechanic: "Special costs less, too", note: "Useless without specials" },
  clock: { role: "UTILITY", what: "Weapons recharge faster", edge: "Speeds up every weapon", mechanic: "-7% cooldowns per level", note: "Better with more weapons" },
};

// ---------------------------------------------------------------- Humor ------
// THE LEGEND is a hologram who shows up on the loadout and level-up screens.
const HUMOR = {
  legend: [
    "Every bug is a feature you haven't met yet.",
    "There is no spoon. There is only technical debt.",
    "Choose wisely. Or don't. It ships on Friday either way.",
    "I've seen things you wouldn't believe. Merge conflicts on fire off the shoulder of main.",
    "The code you write today is the legacy code someone curses tomorrow.",
    "Upgrades are like dependencies. Pin the ones you trust.",
    "Breathe. Read the stack trace. The answer was on line one all along.",
    "You're breathtaking. Your variable names are not.",
    "It works on my machine. So I shipped my machine.",
    "There are two hard problems: cache invalidation, naming things, and off-by-one errors.",
    "Fear is the mind-killer. So is a three-thousand-line pull request.",
    "Rubber duck debugging works. I am the duck now.",
    "Nothing is impossible. Some things are just O(n!).",
    "The best code is no code. The second best is this upgrade.",
    "In the end we are all just pointers to something greater. Or null.",
    "Be like water. Water has no merge conflicts.",
    "The past is a closed ticket. Let it go.",
    "A senior engineer is a junior who has deleted production. Twice.",
  ],
  reroll: ["Even the universe uses Math.random().", "New seed, new destiny.", "Rerolling... like a true gacha engineer.", "Have you tried turning the choices off and on again?"],
  rare: ["Overclocked silicon. Handle with mittens.", "A rare drop. Like a bug-free release.", "This one's out of warranty. Enjoy."],
  loadout: ["Pick two. Like 'fast, cheap, good', except you keep both.", "Your loadout is your stack. Choose your dependencies carefully.", "Two skills. The rest you'll find in the field. Like documentation."],
  respec: ["A respec is just a refactor for your soul.", "Delete everything. Rebuild from scratch. Classic."],
  respawn: ["ROLLING BACK TO LAST STABLE BUILD", "RESTORING FROM BACKUP", "SEGFAULT CAUGHT // SPAWNING NEW PROCESS", "HAVE YOU TRIED TURNING IT OFF AND ON AGAIN?", "git revert HEAD // LIFE RESTORED"],
  gameOver: ["Segmentation fault (core dumped).", "Process exited with code 137: OOM-killed by a goat.", "Uncaught GoatException at you.js:1.", "Build failed: 0 lives remaining, 0 retries left.", "Blue screen of death. It was neon pink, actually."],
  tips: [
    "The Overseer kneels after its laser. That's your merge window.",
    "NULL's copies cast no shadow. The real one does. Trust the shadow.",
    "Your loadout skills show up more often in level-ups. It's a weighted random, not favoritism.",
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
