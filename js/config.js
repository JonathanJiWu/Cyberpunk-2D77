"use strict";
// =============================================================================
// Game data: sizes, balance numbers, enemies, upgrades, power-ups and the map.
// Tweak the numbers here to change how the game plays.
// =============================================================================

// The camera always shows a 1920x1080 "logical" view; the canvas scales it to
// fit the device. The world itself is wider and scrolls horizontally.
const W = 1920;
const H = 1080;
const WORLD_W = 6400;
const GROUND_Y = 990; // top surface of the street
const WORLD_TOP = -600; // the city goes this high above the screen; the camera follows

const TUNING = {
  player: {
    maxHp: 100,
    accel: 5200, // how quickly you reach full speed
    gravity: 2700,
    maxFall: 1500,
    maxJumps: 2,
    coyoteTime: 0.1, // you can still jump this long after walking off a ledge
    jumpBuffer: 0.12, // a jump pressed this long before landing still counts
    hurtInvuln: 1.0,
    knockback: 520,
  },
  // Each IC's resource (HEAT, FOCUS or RAM) powers their special. It does NOT
  // refill on its own: you earn it by dealing damage and by taking damage.
  heat: { max: 100, start: 30, perDamageDealt: 0.1, perDamageTaken: 1.2, perKill: 0.6 },
  zap: { speed: 1300, radius: 22, life: 1.1, spread: 0.17, aimAssist: 0.4 },
  pickupRadius: 150,
  spawn: {
    startRate: 0.75, // enemies per second at the start
    ratePerSecond: 0.012, // how much faster spawning gets every second
    maxRate: 3.5,
    maxAlive: 40,
    hpGrowth: 1 / 100, // enemy HP multiplier grows by this much per second
  },
  boss: {
    at: 150, // seconds into the run when the Overseer shows up (boss HP is in database.js)
    overseerDelay: 35, // NULL arrives this long after the Overseer falls...
    nullDelay: 35, // ...and the final boss (the GOAT) this long after NULL
  },
};

// Enemies, bosses and the playable characters live in js/database.js.

// -------------------------------------------------------------- Upgrades -----
// Vampire Survivors style: every level-up you pick 1 of 3 random upgrades.
// desc[n] describes what level n+1 gives. "zap" and "flame" are each
// character's primary and special: their name, icon and text come from
// CHARACTERS in js/database.js.
const UPGRADES = [
  // The IC's own primary and special: their name, icon, max level and text
  // always come from CHARACTERS (upgradeInfo in upgrades.js); these two
  // entries only give them a place in the upgrade list.
  { id: "zap", name: "Primary", icon: 0, max: 8, weapon: true, desc: [] },
  { id: "flame", name: "Special", icon: 1, max: 6, weapon: true, desc: [] },
  {
    id: "orbit",
    name: "Orbit Shards",
    icon: 2,
    max: 6,
    weapon: true,
    desc: [
      "A neon shard circles you, slicing enemies.",
      "+1 shard.",
      "+50% shard damage.",
      "+1 shard.",
      "+33% damage and a wider orbit.",
      "+1 shard and a faster spin.",
    ],
  },
  {
    id: "missile",
    name: "Seeker Missiles",
    icon: 3,
    max: 6,
    weapon: true,
    desc: [
      "Auto-fires a homing missile at the nearest enemy.",
      "Faster reload, +2 damage.",
      "+1 missile per volley.",
      "Faster reload, +4 damage.",
      "+1 missile per volley, faster reload.",
      "Much faster reload, +6 damage.",
    ],
  },
  {
    id: "stomp",
    name: "Shock Stomp",
    icon: 4,
    max: 5,
    weapon: true,
    desc: [
      "Landing from a jump sends out a shockwave.",
      "Bigger, stronger shockwave.",
      "Bigger, stronger shockwave.",
      "Bigger, stronger shockwave.",
      "Huge shockwave.",
    ],
  },
  {
    id: "chain",
    name: "Chain Lightning",
    icon: 5,
    max: 6,
    weapon: true,
    desc: [
      "Lightning arcs between nearby enemies.",
      "+1 jump, recharges faster.",
      "+3 damage, recharges faster.",
      "+1 jump, recharges faster.",
      "+1 jump, +3 damage.",
      "+1 jump, +3 damage, recharges faster.",
    ],
  },
  { id: "heart", name: "Cyber Heart", icon: 6, max: 5, desc: ["Max HP +20 and heal 20."] },
  { id: "legs", name: "Servo Legs", icon: 7, max: 5, desc: ["Move 8% faster and jump a bit higher."] },
  { id: "magnet", name: "Magnet Coil", icon: 8, max: 5, desc: ["Pick up XP from 40% further away."] },
  { id: "armor", name: "Nano Armor", icon: 9, max: 5, desc: ["Take 8% less damage."] },
  { id: "sink", name: "Heat Sink", icon: 10, max: 5, desc: ["Earn 25% more {resource}; your special costs less."] },
  { id: "clock", name: "Overclock", icon: 11, max: 5, desc: ["All weapons recharge 7% faster."] },
];

// XP needed to go from level n to n+1
const xpForLevel = (n) => 4 + (n - 1) * 3;

// ------------------------------------------------------------- Power-ups -----
// icon = cell in img/pickups.png
const POWERUPS = {
  heal: { name: "+30 HP", icon: 2, weight: 26, color: "#ff2f6d" },
  heat: { name: "+50 HEAT", icon: 3, weight: 24, color: "#ff9b21" },
  overdrive: { name: "OVERDRIVE", icon: 4, weight: 16, duration: 8, color: "#ffe14d" },
  shield: { name: "SHIELD", icon: 5, weight: 12, duration: 6, color: "#19f5ff" },
  magnet: { name: "MAGNET", icon: 6, weight: 12, color: "#ff5a5a" },
  emp: { name: "EMP BLAST", icon: 7, weight: 10, color: "#b06cff" },
};
const POWERUP_DROP_CHANCE = 0.05;
const LEVEL_UP_HEAL = 8; // small heal every level-up

// ------------------------------------------------------------------- Map -----
// One-way platforms: you can jump up through them and drop down with
// Down + Jump. Moving platforms swing by (ax, ay) pixels with the given period.
// Widths are multiples of 64 (the platform tile is 32px drawn at 2x).
const LEVEL = {
  platforms: [
    // Zone 1: the street
    { x: 380, y: 800, w: 256 },
    { x: 760, y: 640, w: 320 },
    { x: 1220, y: 800, w: 256 },
    // Zone 2: stairs up
    { x: 1700, y: 820, w: 256 },
    { x: 2000, y: 660, w: 256 },
    { x: 2300, y: 500, w: 320 },
    { x: 2700, y: 660, w: 192, ax: 220, period: 5 },
    { x: 3080, y: 800, w: 256 },
    // Zone 3: the towers
    { x: 3330, y: 690, w: 320 },
    { x: 3720, y: 840, w: 256 },
    { x: 3720, y: 540, w: 256 },
    { x: 4120, y: 690, w: 320 },
    { x: 4500, y: 560, w: 192, ay: 150, period: 4 },
    // Zone 4: the arena
    { x: 4900, y: 800, w: 384 },
    { x: 5320, y: 470, w: 256, ax: 260, period: 6 },
    { x: 5450, y: 640, w: 384 },
    { x: 5980, y: 800, w: 320 },
    // Up into the skyline (new entries go at the end so the indices above stay
    // put). "roof" platforms are rooftops: a building is drawn underneath.
    { x: 520, y: 470, w: 256 },
    { x: 900, y: 320, w: 320, roof: true },
    { x: 560, y: 150, w: 192 },
    { x: 850, y: -20, w: 256 },
    { x: 1250, y: -180, w: 320, roof: true },
    { x: 2050, y: 330, w: 256 },
    { x: 2400, y: 170, w: 320, roof: true },
    { x: 2850, y: 20, w: 256 },
    { x: 2500, y: -160, w: 256, ax: 200, period: 6 },
    { x: 3950, y: 380, w: 256 },
    { x: 4250, y: 220, w: 320, roof: true },
    { x: 3900, y: 60, w: 256 },
    { x: 4300, y: -110, w: 256 },
    { x: 3850, y: -280, w: 320, roof: true },
    { x: 5750, y: 320, w: 256 },
    { x: 6050, y: 160, w: 256, roof: true },
    { x: 5650, y: 0, w: 256 },
    { x: 5200, y: -170, w: 320, roof: true },
  ],
  // Breakable crates drop power-ups or XP; they come back after a while.
  crates: [
    { x: 640, onGround: true },
    { x: 1300, platform: 2 },
    { x: 2420, platform: 5 },
    { x: 3400, platform: 8 },
    { x: 3780, platform: 9 },
    { x: 4600, onGround: true },
    { x: 5560, platform: 15 },
    { x: 6150, onGround: true },
    { x: 1360, platform: 21 },
    { x: 2500, platform: 23 },
    { x: 3960, platform: 30 },
    { x: 5320, platform: 34 },
  ],
  crateRespawn: 45,
  // Neon signs along the street (pure decoration)
  signs: [
    { x: 520, text: "2D77", color: "#ff2fd6" },
    { x: 1000, text: "RIPPERDOC", color: "#5aff7a" },
    { x: 1640, text: "NOODLES", color: "#19f5ff" },
    { x: 2700, text: "GOLDHORN", color: "#ffe14d" },
    { x: 4250, text: "VERITY NEWS", color: "#ff9b21" },
    { x: 5150, text: "WAKE UP, SAMURAI", color: "#ff2457" },
    { x: 6250, text: "TO THE MOON", color: "#19f5ff" },
  ],
};

// --------------------------------------------------------- Easter eggs -----
// Little homages to cyberpunk classics. Found secrets are remembered between
// runs and listed in the menu (with a hint for the ones you haven't found).
const SECRETS = [
  {
    id: "tears",
    name: "Tears in Rain",
    icon: 5,
    desc: "You stood still in the acid rain and let the moment pass. +25 HP.",
    hint: "When the acid rain falls, stop and take it all in.",
  },
  {
    id: "interlinked",
    name: "Interlinked",
    icon: 6,
    desc: "You looked up at the giant hologram. She noticed. +XP.",
    hint: "A giant hologram towers over the street. Stand still under her and look up.",
  },
  {
    id: "mantis",
    name: "Mantis Blades",
    icon: 0,
    desc: "Installed at the ripperdoc: arm blades slash anything that gets close.",
    hint: "Every Individual Contributor needs a good ripperdoc.",
  },
  {
    id: "katana",
    name: "Katana",
    icon: 1,
    desc: "Deflects enemy shots straight back at them.",
    hint: "Something sharp rides the moving platform above the arena.",
  },
  {
    id: "sandevistan",
    name: "Sandevistan",
    icon: 2,
    desc: "When you're badly hurt, time slows down around you.",
    hint: "Rack up a very familiar number of kills in one run.",
  },
  {
    id: "ghost",
    name: "Ghost in the Shell",
    icon: 3,
    desc: "You dove off a rooftop and vanished with thermoptic camo.",
    hint: "Dive from the highest rooftops all the way down to the street.",
  },
  {
    id: "jackin",
    name: "Jack In",
    icon: 4,
    desc: "You breached a data terminal.",
    hint: "Data terminals stand along the street. Jack in.",
  },
  {
    id: "moon",
    name: "To the Moon",
    icon: 7,
    desc: "You made it to the end of the street.",
    hint: "Follow the street as far east as it goes.",
  },
];

const EASTER = {
  ripperdoc: { x: 1000 },
  hologram: { x: 3460 },
  terminals: [2150, 4380, 5820],
  katana: { platform: 14, offset: 96 }, // the high moving platform in the arena
  rain: { firstAt: 25, duration: 26, gap: [45, 75] },
  sandevistanKills: 77,
  diveHeight: 440, // fall this far onto the street for thermoptic camo
};
