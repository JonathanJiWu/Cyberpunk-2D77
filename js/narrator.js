"use strict";
// =============================================================================
// THE LEGEND, narrator. An original hologram mentor (shoulder-length dark hair
// with a silver streak, short beard, black suit, a cyan temple implant): a
// burned-out legend who has watched the system win too many times and still
// can't stop fighting it. Legacy code, deprecated years ago, still running.
//   - He opens the menu with the world's backstory, says a line when a run
//     starts and talks on the level-up, loadout and respec screens.
//   - Level-up: he reacts to the offer (rare card, a heal, what's missing),
//     explains the card you point at (mouse hover, keyboard / pad focus, or
//     a long press on touch: a tap still installs) and reacts to the pick.
//     Debounced so he never spams or flickers; he never blocks input, and
//     clicking his bubble finishes the line.
//   - Every line has a stable id (legend.skill.paine.zap.3) for voice acting.
//     narrator.say(id, text, opts) is the only way a line is shown: it types
//     the line into a THE LEGEND bubble (or another target), sets his mood
//     (the face he rests on), dispatches a "narrator:line" event on document
//     ({ id, text, mood, context }) and hands the id to the voice hook.
// =============================================================================

// Voice acting: record sound/voice/legend/<id>.ogg, list the id in `manifest`
// and turn `enabled` on. Only listed ids are ever requested (no 404s); they
// play at the SFX volume and respect mute. `player` can replace the built-in
// <audio> player: (id, url, volume) => void.
const NARRATOR_VOICE = {
  enabled: false,
  manifest: new Set(),
  src: (id) => "sound/voice/legend/" + id + ".ogg",
  volume: 0.9,
  player: null,
};

// ------------------------------------------------------------- The lines ---
// id -> { text, mood }. Moods pick his resting face (style.css, at the end):
// neutral, smirk or skeptic. "{resource}" becomes heat / focus / RAM.
const LEGEND_LINES = {};
const LEGEND_MOODS = ["neutral", "smirk", "skeptic"];

// legendLines("legend.open", "smirk", [...]) adds legend.open.1, .2, ...
// For skills the number is the level the line explains.
function legendLines(prefix, mood, texts) {
  texts.forEach((t, i) => {
    const [text, own] = Array.isArray(t) ? t : [t, mood];
    LEGEND_LINES[`${prefix}.${i + 1}`] = { text, mood: own };
  });
}

// The world, before and at the start of a run
legendLines("legend.intro.menu", "neutral", ["It's 2D77. The corps own the city, the cameras and the truth, and they rent all three back to you. Stop paying. Don't kiss the Demon Goat."]);
legendLines("legend.run", "neutral", [
  "They own every camera on this street. Give them something worth recording.",
  "The truth is buried under all that neon. Go dig it up.",
  "They wrote the rules so they'd never lose. Break a few for me.",
  "The feed says the streets are safe tonight. Go prove it wrong.",
  "Goldhorn calls you a security incident. Live up to it.",
]);

// Level-up: the offer
legendLines("legend.open", "smirk", [
  "Three upgrades. The Board calls this 'choice'. Take one anyway.",
  "Fresh hardware. Install it before somebody patents it.",
  "Pick one. I picked wrong in '52 and look at me: a screensaver.",
  "Nobody hands you power in this city. You install it yourself.",
  "Every level you take is one their budget said you'd never get.",
  "Shopping again? At least this store doesn't sell your data.",
  "I've made this choice a hundred times. Make it like it matters. It does.",
  "Upgrade. Rebels on stock firmware end up as case studies.",
  "Level up. Somewhere a shareholder just felt a chill.",
  "Choose. The cameras are watching, so make it look good.",
]);
legendLines("legend.open.rare", "smirk", [
  "A rare card. Overclocked, warranty void. My kind of hardware.",
  "Two levels for the price of one. Somebody in accounting gets fired.",
  "Rare silicon. The kind they keep in the vault, not the stores.",
  "That glow means +2 levels. Don't let it go to your head. Okay, a little.",
]);
legendLines("legend.open.heal", "neutral", ["You maxed the whole catalog. All that's left is a bandage. Take it.", "Nothing left to upgrade. Patch yourself up and go embarrass them."]);
legendLines("legend.open.hurt", "skeptic", ["You're bleeding and they're selling you guns. Classic Cyber City.", "No armor on the shelf. Survive by being scarier, then."]);
legendLines("legend.open.max", "smirk", ["One of these maxes out. Finish something. The Board never does.", "A capstone's on the table. Complete sets terrify the market."]);
legendLines("legend.open.new", "smirk", ["Three things you've never tried. Experiment. That's how they lose."]);
legendLines("legend.open.offense", "smirk", ["All offense. Finally, a menu that understands me."]);
legendLines("legend.open.nooffense", "skeptic", ["Nothing that hits harder. Some days surviving is the rebellion."]);
legendLines("legend.open.signature", "smirk", ["Your own gear's on the table. Sharpen what they couldn't take.", "Your signature move is up for an upgrade. Nobody else gets to own that."]);

// Level-up: rerolls and the pick
legendLines("legend.reroll", "smirk", [
  "Reroll. Refusing what you're offered is the first freedom.",
  "New hand. The house still deals, but now it's nervous.",
  "Shake the dice. Corporate hates variance.",
  "Rerolled. Never take their first offer.",
  "Again? Fine. Indecision still beats obedience.",
]);
legendLines("legend.reroll.last", "skeptic", ["Last reroll. After this you play the hand you're dealt. Like the rest of us."]);
legendLines("legend.reroll.none", "skeptic", ["Out of rerolls. Welcome to the economy.", "No rerolls left. Pick one, or I start telling war stories."]);
legendLines("legend.pick", "smirk", [
  "Installed. Stay angry, stay upgraded.",
  "Good. Now go make it someone's quarterly problem.",
  "Installed. Somewhere a warranty just screamed.",
  "Locked in. Back to the street.",
  "Done. Every upgrade is a memo they never approved.",
  "Nice. Go put it on the record. Their record.",
  "Installed. They'll call it a malfunction. Let them.",
  "Good pick. I'd have taken it too, then blamed you.",
]);
legendLines("legend.pick.rare", "smirk", ["Overclocked. Two levels richer and twice as wanted.", "That's the good silicon. Don't tell the Board where you got it.", "Rare install. Somewhere a vault alarm just went off."]);
legendLines("legend.pick.new", "smirk", ["New toy. Read the card, then ignore the manual like I did.", "Fresh install. First runs are always the buggiest. Enjoy.", "Something new. Good. Predictable is how they catch you."]);
legendLines("legend.pick.max", "smirk", ["Maxed out. Nothing left to buy, which terrifies the market.", "That's the ceiling. Now find out how hard it hits."]);
legendLines("legend.pick.heal", "neutral", ["Patched. Not fixed, patched. Story of this city.", "Repair kit. Duct tape for the soul. And the ribs."]);
legendLines("legend.pick.signature", "smirk", ["Your signature, sharper. They can't license that.", "Good. Never let them sell you a better version of yourself."]);
legendLines("legend.hint.hold", "neutral", ["Hold a card and I'll explain it. Tap a card to install it."]);

// Pre-drop loadout and respec
legendLines("legend.loadout.open", "smirk", [
  "Pick two. Nobody drops into this city empty-handed and walks back out.",
  "Two skills before the drop. Choose like the Board is watching. It is.",
  "Loadout first. Hope is not a strategy. Hardware is.",
  "Pick your two. I'll judge you either way. Professionally.",
]);
legendLines("legend.loadout.add", "smirk", ["Slotted. Good instinct.", "Noted. I'd have picked it too. Probably.", "In the slot. Now give it a partner."]);
legendLines("legend.loadout.ready", "smirk", ["Two picked. Drop in before you start overthinking it.", "Loadout set. The street's waiting. So are the cameras."]);
legendLines("legend.loadout.swap", "skeptic", ["Your first pick just got laid off. Loyalty is for corporations.", "Two slots, three ideas. The oldest one walks."]);
legendLines("legend.loadout.remove", "skeptic", ["Unslotted. Second thoughts are allowed. Thirds get judged."]);
legendLines("legend.respec.open", "skeptic", ["Respec. Tear it down, build it better. My whole career in one menu.", "Every point refunded. The only refund this city ever honors."]);
legendLines("legend.respec.reset", "neutral", ["Clean slate. Most of history is people starting over."]);
legendLines("legend.respec.apply", "smirk", ["Rebuilt. Same you, better architecture.", "Respec applied. Refactoring the soul, one point at a time."]);

// Skills: what each level really does (js/kits.js, js/player.js), a tip, a
// jab. Line n explains level n; line 1 is the overview (loadout, new cards).
legendLines("legend.skill.paine.zap", "neutral", [
  "Cyber Bow: hold to draw, release one heavy arrow. Knocks back, pierces, drops flyers.",
  "+5 damage: twenty an arrow. Persuasion, but pointier.",
  "Arrows fly 25% faster. Less time for them to read the room.",
  "Draws in 0.4s instead of 0.5, and pierces more. Faster than their legal team.",
  "+6 damage, and bosses bleed harder. Make the big ones pay by the second.",
  "Bosses bleed for 6 seconds, not 4. The only payment plan I endorse.",
  "40% more knockback and a quicker draw. Send them back to the lobby.",
  "+8 damage and the fastest draw. The arrow they'll write banned songs about.",
]);
legendLines("legend.skill.paine.flame", "neutral", [
  "Flame On: a ring of heat that burns, shoves foes away and melts bullets. Costs heat.",
  "Bigger, hotter wave: 12% wider, 25% more damage. Personal space, enforced.",
  "Bigger, hotter and cheaper: 36 heat instead of 44. Rebellion on a budget.",
  "Bigger, hotter, and it leaves them burning. Finally, heating this city can afford.",
  "Bigger and hotter again. Melts bullets in a wider circle than their excuses.",
  "A second wave follows the first. Always have a follow-up. They do.",
]);
legendLines("legend.skill.tetsu.zap", "neutral", [
  "Monoblade: three-hit combo, every swing swats bullets, the third spins and breaks shields.",
  "+3 slash damage. Small number, big conversations.",
  "20% more reach. Keep them at arm's length, plus a blade.",
  "Swings 20% faster. Bureaucracy can't keep up.",
  "Parried shots fly back at enemies, 2.5x harder. Return to sender, with interest.",
  "+4 slash damage. Steel doesn't negotiate. It renegotiates.",
  "Every second swing is a finisher now. Twice the spin, half the patience.",
  "+5 damage, 25% more reach. Peak chrome. Their lawyers are drafting a ban.",
]);
legendLines("legend.skill.tetsu.flame", "neutral", [
  "Iaido Dash: cut through a line of foes. Untouchable mid-dash, half damage for 2s after.",
  "Longer dash, +8 damage. Fifteen percent further from your problems.",
  "Cheaper: 26 focus instead of 35. More dashes, fewer meetings.",
  "The guard lasts 3.2s instead of 2. Half damage, full attitude.",
  "Longer dash, +12 damage. Commute through them.",
  "Leaves a cutting shockwave where you stop. Exit interviews, Ronin style.",
]);
legendLines("legend.skill.sudo.zap", "neutral", [
  "EM Projector: tall waves pass through everything and slow it. Built from a microwave.",
  "+3 wave damage. Ten a hit, to every enemy in the line. Bulk pricing.",
  "Two waves in a spread, a little taller. Broadcast, not narrowcast.",
  "Taller waves. Catches the flyers sneaking over your head.",
  "25% more range, taller waves. Reach the cheap seats.",
  "Three waves, fired faster. Now it's a protest.",
  "+6 wave damage, taller waves. Sixteen a hit, through the whole line.",
  "Waves slow enemies much harder. Put the whole street on dial-up.",
]);
legendLines("legend.skill.sudo.flame", "neutral", [
  "Time Dilation: 1.5s of bullet time. The world crawls, you don't, and you hit 40% harder.",
  "Hits harder in slow-mo. Their clocks, your schedule.",
  "34 RAM instead of 45, and it hits harder. Same miracle, discount price.",
  "Lasts 2s and the world crawls even slower. Everyone at support-ticket speed.",
  "Hits harder: +72% damage in slow-mo. Time is money. Steal theirs.",
  "Lasts 2.5s, and bullets right next to you freeze mid-air. Physics, overruled.",
]);
legendLines("legend.skill.orbit", "neutral", [
  "Orbit Shards: a neon shard circles you and cuts anything that gets close.",
  "A second shard. Two bodyguards, zero health insurance.",
  "+50% shard damage. Personal space, now with teeth.",
  "A third shard. Your aura is now a shredder.",
  "+33% damage and a wider orbit. Further out, and it stings.",
  "Four shards, spinning faster. Walk into a crowd and call it a meeting.",
]);
legendLines("legend.skill.missile", "neutral", [
  "Seeker Missiles: auto-fired rockets that home in on the nearest enemy, with a splash.",
  "Faster reload, +2 damage. Their drones never see it coming.",
  "Two missiles a volley. Double the deliverables.",
  "Faster reload, +4 damage. Same-day delivery, no signature required.",
  "Three missiles a volley, faster reload. A whole quarterly forecast of explosions.",
  "Much faster reload, +6 damage. 24 a hit, every 1.3 seconds.",
]);
legendLines("legend.skill.stomp", "neutral", [
  "Shock Stomp: land from a jump and the street shakes. Shoves crowds back and hurts.",
  "Bigger, stronger shockwave. Gravity is the one law they can't buy.",
  "Bigger and stronger again. Every landing is a press statement.",
  "Bigger, stronger. The crowd parts like you own the building.",
  "Huge shockwave, 34 damage a landing. Make an entrance. Every time.",
]);
legendLines("legend.skill.chain", "neutral", [
  "Chain Lightning: a bolt jumps from foe to foe, three at a time. No aiming.",
  "One more jump, faster recharge. Four enemies a bolt. Spread the word.",
  "+3 damage, faster recharge. Shared pain, the only thing they share.",
  "One more jump, faster recharge. Five a bolt. Networking!",
  "One more jump, +3 damage. Six at a time. Bad week to be a crowd.",
  "Seven enemies a bolt, 18 damage, every second. The grid works for us now.",
]);
legendLines("legend.skill.heart", "neutral", [
  "Cyber Heart: +20 max HP and it heals 20 now. A bigger heart. Rare in this city.",
  "Another +20 HP. Hearts are cheap. Keeping one is the expensive part.",
  "+20 HP and a heal. Live long enough to become their problem.",
  "+20 more. That's one thing they can't foreclose on.",
  "Last +20: a hundred extra HP in all. Spite, in hardware form.",
]);
legendLines("legend.skill.legs", "neutral", [
  "Servo Legs: 8% faster, jump a bit higher. Outrun lasers, landlords, consequences.",
  "Another 8% speed. Running away is a strategy. Ask any CEO.",
  "Faster again. Movement is a right. Act like it.",
  "8% more. Sniper sentries hate a moving target.",
  "Top speed: 40% over stock. Catch me if you can afford to.",
]);
legendLines("legend.skill.magnet", "neutral", [
  "Magnet Coil: XP flies in from 40% further. Faster levels, less crawling for crumbs.",
  "More pull. Let the loot come to you, like a shareholder.",
  "+40% range again. Wealth redistribution, one chip at a time.",
  "More pull. Every chip they drop is evidence. Collect it.",
  "Max pull: triple the base range. The economy should work this well.",
]);
legendLines("legend.skill.armor", "neutral", [
  "Nano Armor: take 8% less damage. Thicker skin, legally speaking.",
  "Another 8% off every hit. The only discount they'll ever give you.",
  "8% more. Let them hit you, then send the invoice.",
  "More plating. Bruises fade. Defiance is chronic.",
  "Fully plated: 40% less damage. Untouchable is a lifestyle.",
]);
legendLines("legend.skill.sink", "neutral", [
  "Heat Sink: earn 25% more {resource}, and your special costs less. Spend it loud.",
  "More {resource}, cheaper specials. Fuel for the fire they keep warning about.",
  "+25% {resource} again. Specials on repeat, like a protest chant.",
  "Cheaper specials again. Spend like you've got a bailout.",
  "Maxed: 125% more {resource}, specials 30% cheaper. Throw it around.",
]);
legendLines("legend.skill.clock", "neutral", [
  "Overclock: every weapon recharges 7% faster. Void the warranty. Feel alive.",
  "7% faster again. Their benchmarks just became fiction.",
  "Faster again: missiles, lightning, your own weapon. Heat is a feature.",
  "More clock. The fans are screaming. So are the drones.",
  "Maxed: 35% faster recharge. Ship it hot.",
]);
legendLines("legend.skill.heal", "neutral", [`Repair Kit: ${40 + LEVEL_UP_HEAL} HP back. You maxed the catalog, so this is dessert.`]);

// ---------------------------------------------------------------- Engine ---
const narrator = {
  quiet: 0, // > 0: focus changes are the game's own (opening a screen), not the player's
  recent: {}, // group -> the ids it used last (no quick repeats)
  hintShown: false,
  focusTimer: 0,
  press: null, // a long press on a touch card
  audio: null,

  text(id) {
    const line = LEGEND_LINES[id];
    return line ? this.fill(line.text) : "";
  },
  fill(text) {
    return String(text).replace(/\{resource\}/g, () => CH().resource.name.toLowerCase());
  },

  // The ids of a variant group: legend.open -> legend.open.1, legend.open.2...
  group(prefix) {
    const cache = (this.groups = this.groups || {});
    if (!cache[prefix]) cache[prefix] = Object.keys(LEGEND_LINES).filter((id) => id.startsWith(prefix + ".") && /^\d+$/.test(id.slice(prefix.length + 1)));
    return cache[prefix];
  },
  // A random variant, avoiding the last couple used
  variant(prefix) {
    const ids = this.group(prefix);
    const recent = (this.recent[prefix] = this.recent[prefix] || []);
    const fresh = ids.filter((id) => !recent.includes(id));
    const id = (fresh.length ? fresh : ids)[Math.floor(Math.random() * (fresh.length || ids.length))];
    recent.push(id);
    if (recent.length > Math.min(2, ids.length - 1)) recent.shift();
    return id;
  },

  // THE ONE WAY A LINE IS SHOWN.
  // opts: el (a .legend bubble, or any element for plain text), note (also a
  // neon note in the game), mood, context, priority (a lower one waits for a
  // higher one to finish, plus its hold ms), instant (no typing), force (say
  // it even if it is already showing), when (a queued line still relevant?)
  say(id, text, opts = {}) {
    if (text == null) text = this.text(id);
    else text = this.fill(text);
    if (!text) return false;
    const line = LEGEND_LINES[id];
    const mood = LEGEND_MOODS.includes(opts.mood) ? opts.mood : line ? line.mood : "smirk";
    const el = opts.el || null;
    if (el && el.classList.contains("legend")) {
      const st = this.state(el);
      const now = performance.now();
      const priority = opts.priority || 1;
      if (!opts.force && st.id === id) return false; // already on screen
      if (priority < st.priority && now < st.holdUntil) {
        this.queue(el, { id, text: null, opts }); // after the current line
        return false;
      }
      st.pending = null;
      st.id = id;
      st.priority = priority;
      const typing = this.type(el, text, mood, !!opts.instant);
      st.holdUntil = now + typing + (opts.hold || 0);
    } else if (el) {
      el.textContent = text;
    }
    if (opts.note && typeof neonNote === "function") {
      neonNote("THE LEGEND: " + text, "#19f5ff", 4);
      neonNotes[neonNotes.length - 1].legend = true;
    }
    const context = Object.assign({ char: player.char }, opts.context || {});
    document.dispatchEvent(new CustomEvent("narrator:line", { detail: { id, text, mood, context } }));
    this.voice(id);
    return true;
  },

  state(el) {
    return (el._narrator = el._narrator || { id: null, priority: 0, holdUntil: 0, pending: null, timer: 0 });
  },
  queue(el, item) {
    const st = this.state(el);
    st.pending = item;
    clearTimeout(st.timer);
    const run = () => {
      const p = st.pending;
      if (!p) return;
      const wait = st.holdUntil - performance.now();
      if (wait > 0) {
        st.timer = setTimeout(run, wait + 20);
        return;
      }
      st.pending = null;
      if (!p.opts.when || p.opts.when()) this.say(p.id, p.text, p.opts);
    };
    st.timer = setTimeout(run, Math.max(0, st.holdUntil - performance.now()) + 20);
  },

  // Types a line into a bubble. The whole line is laid out from the start
  // (the untyped rest is invisible), so the bubble never changes size while
  // it types. Returns how long the typing takes, in ms.
  type(el, text, mood, instant) {
    const line = el.querySelector(".legend-line");
    clearInterval(el._typing);
    LEGEND_MOODS.forEach((m) => el.classList.toggle("mood-" + m, m === mood));
    line.textContent = "";
    const sr = document.createElement("span");
    sr.className = "legend-sr";
    sr.textContent = text;
    const typed = document.createElement("span");
    const rest = document.createElement("span");
    rest.className = "legend-rest";
    typed.setAttribute("aria-hidden", "true");
    rest.setAttribute("aria-hidden", "true");
    line.append(sr, typed, rest);
    const finish = () => {
      clearInterval(el._typing);
      el._finish = null;
      typed.textContent = text;
      rest.textContent = "";
      el.classList.remove("talking");
      el.classList.add("done");
    };
    if (instant) {
      finish();
      return 0;
    }
    el.classList.add("talking");
    el.classList.remove("done");
    rest.textContent = text;
    let n = 0;
    el._finish = finish;
    el._typing = setInterval(() => {
      n += 3;
      if (n >= text.length) return finish();
      typed.textContent = text.slice(0, n);
      rest.textContent = text.slice(n);
    }, 24);
    return Math.ceil(text.length / 3) * 24;
  },

  voice(id) {
    const v = NARRATOR_VOICE;
    if (!v.enabled || !v.manifest.has(id)) return false;
    const url = v.src(id);
    const volume = Math.min(1, SoundSystem.muted ? 0 : v.volume * SoundSystem.level("sfx"));
    if (typeof v.player === "function") {
      v.player(id, url, volume);
      return true;
    }
    if (!this.audio) this.audio = SoundSystem.trackElement(new Audio());
    this.audio.pause();
    this.audio.src = url;
    this.audio.volume = volume;
    const p = this.audio.play();
    if (p && p.catch) p.catch(() => {});
    return true;
  },

  // ------------------------------------------------------------ Level-up --
  // The id of a card's explanation: the level it takes the skill to (a new
  // skill gets the overview, level 1)
  skillId(id, level) {
    if (id === "_heal") return "legend.skill.heal.1";
    const own = id === "zap" || id === "flame";
    return own ? `legend.skill.${player.char}.${id}.${level}` : `legend.skill.${id}.${level}`;
  },
  cardLevel(c) {
    if (c.id === "_heal") return 1;
    const owned = lv(c.id);
    return owned ? Math.min(upgradeInfo(c.u).max, owned + (c.rare ? 2 : 1)) : 1;
  },

  // He reacts to the offer: a rare card, a heal, what's missing...
  offerLine(choices) {
    const roles = choices.map((c) => skillRole(c.u));
    const hurt = somePlayer(() => player.hp < stats.maxHp * 0.5);
    if (choices.length === 1 && choices[0].id === "_heal") return this.variant("legend.open.heal");
    if (choices.some((c) => c.rare)) return this.variant("legend.open.rare");
    if (hurt && !roles.includes("DEFENSE")) return this.variant("legend.open.hurt");
    if (choices.some((c) => lv(c.id) + 1 >= upgradeInfo(c.u).max) && Math.random() < 0.6) return this.variant("legend.open.max");
    if (choices.length === 3 && choices.every((c) => !lv(c.id))) return this.variant("legend.open.new");
    if (choices.length === 3 && roles.every((r) => r === "OFFENSE")) return this.variant("legend.open.offense");
    if (!roles.includes("OFFENSE") && Math.random() < 0.5) return this.variant("legend.open.nooffense");
    if (choices.some((c) => c.id === "zap" || c.id === "flame") && Math.random() < 0.4) return this.variant("legend.open.signature");
    return this.variant("legend.open");
  },

  levelUpOpen(choices) {
    clearTimeout(this.focusTimer);
    this.say(this.offerLine(choices), null, { el: levelUpLegend, priority: 2, hold: 900, force: true, context: { screen: "levelup", event: "open", cards: choices.map((c) => c.id), rare: choices.some((c) => c.rare), level: progress.level } });
    // Touch: once a session (unless they found the long press already), how
    // to hear about a card, after the reaction
    if (touchMode && !this.hintShown) {
      const when = () => game.state === "levelup" && !pickLock && !this.hintShown && (this.hintShown = true);
      this.queue(levelUpLegend, { id: "legend.hint.hold.1", text: null, opts: { el: levelUpLegend, context: { screen: "levelup", event: "hint" }, when } });
    }
  },

  // A card got the mouse, the keyboard / pad focus or a long press:
  // explain it once the pointer settles
  levelUpFocus(i, how) {
    if (this.quiet > 0) return;
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => this.explainCard(i, how), how === "hover" ? 220 : how === "hold" ? 0 : 140);
  },
  explainCard(i, how) {
    const c = currentChoices[i];
    if (game.state !== "levelup" || pickLock || !c) return;
    const level = this.cardLevel(c);
    if (how === "hold") this.hintShown = true; // they found it
    this.say(this.skillId(c.id, level), null, {
      el: levelUpLegend,
      priority: how === "hold" ? 2 : 1, // a long press is a question: it doesn't wait
      force: how === "hold",
      context: { screen: "levelup", event: "focus", card: c.id, level, rare: c.rare, how },
      when: () => game.state === "levelup" && !pickLock && currentChoices[i] === c,
    });
  },

  // After the pick (the skill's new level is already applied)
  levelUpPick(c) {
    clearTimeout(this.focusTimer);
    const max = c.id !== "_heal" && lv(c.id) >= upgradeInfo(c.u).max;
    const fresh = c.id !== "_heal" && lv(c.id) === (c.rare ? 2 : 1);
    let group = "legend.pick";
    if (c.id === "_heal") group = "legend.pick.heal";
    else if (c.rare) group = "legend.pick.rare";
    else if (max) group = "legend.pick.max";
    else if (fresh) group = "legend.pick.new";
    else if ((c.id === "zap" || c.id === "flame") && Math.random() < 0.5) group = "legend.pick.signature";
    this.say(this.variant(group), null, { el: levelUpLegend, priority: 3, hold: 600, instant: true, force: true, note: c.rare || max, context: { screen: "levelup", event: "pick", card: c.id, rare: c.rare, level: lv(c.id) } });
  },

  reroll(denied) {
    clearTimeout(this.focusTimer);
    let id;
    if (denied) id = this.variant("legend.reroll.none");
    else if (currentChoices.some((c) => c.rare)) id = this.variant("legend.open.rare");
    else id = progress.rerolls === 0 ? "legend.reroll.last.1" : this.variant("legend.reroll");
    this.say(id, null, { el: levelUpLegend, priority: 2, hold: 700, force: true, context: { screen: "levelup", event: denied ? "reroll-denied" : "reroll", left: progress.rerolls } });
  },

  // Move focus without it counting as the player pointing at something
  quietly(fn) {
    this.quiet++;
    try {
      fn();
    } finally {
      this.quiet--;
    }
  },

  // ------------------------------------------------------------- Loadout --
  loadoutOpen() {
    clearTimeout(this.focusTimer);
    this.say(this.variant("legend.loadout.open"), null, { el: loadoutLegend, priority: 2, hold: 800, force: true, context: { screen: "loadout", event: "open" } });
  },
  loadoutFocus(id, how) {
    if (this.quiet > 0) return;
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      if (loadoutEl.hidden) return;
      this.say(this.skillId(id, 1), null, { el: loadoutLegend, priority: 1, context: { screen: "loadout", event: "focus", card: id, how }, when: () => !loadoutEl.hidden && loadoutSpecId === id });
    }, how === "hover" ? 220 : 140);
  },
  // kind: add / swap (the third pick pushed the oldest out) / remove
  loadoutToggle(id, kind, count) {
    clearTimeout(this.focusTimer);
    const group = kind === "remove" ? "legend.loadout.remove" : kind === "swap" ? "legend.loadout.swap" : count >= 2 ? "legend.loadout.ready" : "legend.loadout.add";
    this.say(this.variant(group), null, { el: loadoutLegend, priority: 2, hold: 700, force: true, context: { screen: "loadout", event: kind, card: id, slots: count } });
  },

  // -------------------------------------------------------------- Respec --
  respecOpen() {
    this.say(this.variant("legend.respec.open"), null, { el: respecLegend, priority: 2, force: true, context: { screen: "respec", event: "open" } });
  },
  respecReset() {
    this.say("legend.respec.reset.1", null, { el: respecLegend, priority: 2, force: true, context: { screen: "respec", event: "reset" } });
  },
  // (the respec closes: the line lands in the pause menu's text)
  respecApply(el) {
    this.say(this.variant("legend.respec.apply"), null, { el, context: { screen: "paused", event: "respec" } });
  },

  // ----------------------------------------------------------- The world --
  menuIntro(el) {
    this.say("legend.intro.menu.1", null, { el, context: { screen: "menu", event: "intro" } });
  },
  // Once player 1's hero has landed (lives.js)
  runStart() {
    this.say(this.variant("legend.run"), null, { note: true, context: { screen: "game", event: "run-start" } });
  },
};

// ---------------------------------------------------------------- Wiring ---
const respecLegend = document.getElementById("legend-respec");

// Clicking a bubble finishes the line at once
document.querySelectorAll(".legend").forEach((el) =>
  el.addEventListener("click", () => {
    if (el._finish) el._finish();
  })
);

// Touch: a long press on a level-up card explains it; the tap that ends a
// long press doesn't install the card (a normal tap still does)
cardsEl.addEventListener("pointerdown", (e) => {
  const card = e.target.closest(".card");
  if (e.pointerType === "mouse" || !card || game.state !== "levelup") return;
  clearTimeout(narrator.press && narrator.press.timer);
  const press = { card, x: e.clientX, y: e.clientY, held: false };
  press.timer = setTimeout(() => {
    press.held = true;
    vibrate(12);
    narrator.levelUpFocus([...cardsEl.children].indexOf(card), "hold");
  }, 380);
  narrator.press = press;
});
cardsEl.addEventListener("pointermove", (e) => {
  const p = narrator.press;
  if (p && !p.held && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) clearTimeout(p.timer);
});
["pointerup", "pointercancel"].forEach((type) => cardsEl.addEventListener(type, () => narrator.press && clearTimeout(narrator.press.timer)));
cardsEl.addEventListener(
  "click",
  (e) => {
    const p = narrator.press;
    narrator.press = null;
    if (p && p.held && e.target.closest(".card") === p.card) {
      e.stopPropagation(); // capture phase: the card's own click (install) never runs
      e.preventDefault();
    }
  },
  true
);
cardsEl.addEventListener("contextmenu", (e) => e.target.closest(".card") && e.preventDefault());
