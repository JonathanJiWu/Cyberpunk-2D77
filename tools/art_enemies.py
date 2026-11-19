#!/usr/bin/env python3
"""
Pixel art for the v3.2 enemies (Cyberpunk 2D77), in the style of
make_sprites.py and built with its palette and shape helpers (imported, not
edited). No randomness: re-running writes byte-identical PNGs.

Usage:
    python3 tools/art_enemies.py                  # writes the PNGs into img/
    python3 tools/art_enemies.py --preview x.png  # also a 3x contact sheet

Sheets (facing right; frames left to right):
    forkbomb.png     168x28   6 frames of 28x28   roll x4 (stripes turning), unfurl, leap
    lobber.png       192x40   4 frames of 48x40   idle, walk x2, fire
    monolith.png     448x128  7 frames of 64x64   armored (DATABASE), walk x2, idle,
                              slam wind-up, slam, charge; row 2: front / back / crown
                              plates, drawn over the body by the game
    hotfix.png       216x28   6 frames of 36x28   hover x4, tether x2
    ratelimiter.png  144x72   4 frames of 36x72   idle, walk x2, pulse (symmetric: not flipped)
"""
import argparse
import math
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_sprites import (  # noqa: E402
    IMG_DIR,
    RGBA,
    Grid,
    edge_pts,
    ellipse_pts,
    line_pts,
    poly_pts,
    shade_rim,
    stack,
    thick_pts,
)

LIGHT = (-0.55, -0.7, 0.45)

# Extra colours for these sheets (added to make_sprites' palette at run time,
# dark -> light): an old-computer beige for the Monolith's case, olive drab
# for the Lobber's artillery hull
EXTRA = {
    "α": "#5e5244", "β": "#8f806a", "γ": "#b9a98b", "δ": "#ddd0b2",  # beige
    "ε": "#2c3524", "ζ": "#48553a", "η": "#6a7b51", "θ": "#93a56f",  # olive
}
for _k, _v in EXTRA.items():
    RGBA[_k] = (int(_v[1:3], 16), int(_v[3:5], 16), int(_v[5:7], 16), 255)
BEIGE = ["α", "β", "γ", "δ"]
OLIVE = ["ε", "ζ", "η", "θ"]


def lit(nx, ny, n=4, lo=-0.35):
    """Quantised lambert term of a sphere normal (nx, ny) -> 0..n-1."""
    ln = math.sqrt(sum(c * c for c in LIGHT))
    lx, ly, lz = (c / ln for c in LIGHT)
    nz = math.sqrt(max(0.0, 1.0 - nx * nx - ny * ny))
    t = ((nx * lx + ny * ly + nz * lz) - lo) / (1.0 - lo)
    return max(0, min(n - 1, int(t * n)))


def box(g, x0, y0, x1, y1, base, light=None, dark=None, top=None):
    """A shaded block: lit top-left rim, dark bottom-right rim."""
    pts = {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)}
    shade_rim(g, pts, base, light=light, dark=dark)
    if top:
        g.hline(x0, x1, y0, top)
    return pts


def limb(g, a, b, r, base, light=None, dark=None):
    pts = thick_pts(line_pts(a[0], a[1], b[0], b[1]), r)
    shade_rim(g, pts, base, light=light, dark=dark)
    return pts


def sheet(frames, w, h, rows=1):
    im = Image.new("RGBA", (w * len(frames[0]), h * rows), (0, 0, 0, 0))
    for r, row in enumerate(frames):
        for i, g in enumerate(row):
            im.alpha_composite(g.image(), (i * w, r * h))
    return im


# ============================================================== FORK BOMB ===
# A hazard-striped ball. The stripes turn 45 degrees a frame (the pattern is
# symmetric under a half turn, so 4 frames loop); two red LED ports ride
# the middle stripe.
YEL = ["o", "O", "Y", "y"]
DRK = ["P", "1", "2", "3"]


def fork_shell(g, cx, cy, r, theta, keep=None):
    c, s = math.cos(theta), math.sin(theta)
    pts = ellipse_pts(cx, cy, r, r)
    for (x, y) in pts:
        if keep and not keep(x, y):
            continue
        nx, ny = (x + 0.5 - cx) / r, (y + 0.5 - cy) / r
        u = ((x + 0.5 - cx) * c + (y + 0.5 - cy) * s) / 4.2 + 0.5
        ramp = YEL if math.floor(u) % 2 == 0 else DRK
        g.set(x, y, ramp[lit(nx, ny)])
    return pts


def fork_roll(f):
    g = Grid(28, 28)
    cx, cy, r = 14.0, 15.5, 11.0
    theta = math.pi / 4 * (f + 1)
    fork_shell(g, cx, cy, r, theta)
    # the LED ports on the middle stripe, a half turn apart
    for sgn in (1, -1):
        px = cx + sgn * math.cos(theta + math.pi / 2) * r * 0.6
        py = cy + sgn * math.sin(theta + math.pi / 2) * r * 0.6
        x, y = int(px), int(py)
        g.rect(x - 1, y - 1, x + 1, y + 1, "K")
        g.set(x, y, "R")
        g.set(x - 1, y - 1, "p")
    # a glint that stays put (the light doesn't roll)
    g.set(9, 9, "W")
    g.set(10, 9, "y")
    g.set(9, 10, "y")
    return stack(28, 28, g)


def fork_open(leap):
    """Unfurled: the shell splits, the core glows, legs come out."""
    cx, cy, r = 14.0, 13.5 if not leap else 11.5, 10.0
    gap = 3 if not leap else 5
    legs = Grid(28, 28)
    feet = [(4, 26), (9, 27), (19, 27), (24, 26)] if not leap else [(3, 22), (7, 25), (22, 23), (26, 18)]
    for i, (fx, fy) in enumerate(feet):
        hip = (cx - 5 + i * 3.3, cy + 4)
        knee = (hip[0] + (fx - hip[0]) * 0.4 + (-2 if i < 2 else 2), hip[1] + (fy - hip[1]) * 0.35 - 2)
        limb(legs, hip, knee, 1.0, "2", light="3", dark="1")
        limb(legs, knee, (fx, fy), 0.8, "3", light="4", dark="2")
        legs.set(fx, fy, "4")
    core = Grid(28, 28)
    pts = ellipse_pts(cx, cy + 0.5, 7.5, 3.0)
    core.fill(pts, "m")
    core.fill(ellipse_pts(cx, cy + 0.5, 5.5, 2.0), "M")
    core.fill(ellipse_pts(cx + 1, cy + 0.5, 2.5, 1.2), "N")
    core.set(int(cx + 5), int(cy), "R")  # the eye
    core.set(int(cx + 6), int(cy), "W")
    low = Grid(28, 28)
    fork_shell(low, cx, cy + 1, r, math.pi / 2, keep=lambda x, y: y + 0.5 >= cy + 1)
    top = Grid(28, 28)
    fork_shell(top, cx, cy + 1 - gap, r, math.pi / 2, keep=lambda x, y: y + 0.5 < cy + 1 - gap)
    top.set(9, int(cy - gap - 5), "W")
    if leap:
        # teeth on the open rim
        for x in range(8, 21, 3):
            top.set(x, int(cy - gap + 1), "5")
            low.set(x + 1, int(cy + 1), "5")
    return stack(28, 28, legs, core, low, top)


def make_forkbomb():
    return sheet([[fork_roll(f) for f in range(4)] + [fork_open(False), fork_open(True)]], 28, 28)


# ========================================================== PACKET LOBBER ===
LOB_LEGS = [  # (back foot, front foot) per frame: idle, walk A, walk B, fire
    ((12, 38), (35, 38)),
    ((9, 38), (37, 36)),
    ((15, 36), (32, 38)),
    ((12, 38), (35, 38)),
]


def lobber_frame(f):
    dy = 1 if f == 3 else 0
    recoil = 2 if f == 3 else 0
    legs = Grid(48, 40)
    for i, foot in enumerate(LOB_LEGS[f]):
        hip = (15 + i * 17, 28 + dy)
        knee = (hip[0] + 4, hip[1] + 4)
        dark = i == 0
        limb(legs, hip, knee, 1.8, "1" if dark else "2", light="2" if dark else "3", dark="P" if dark else "1")
        limb(legs, knee, foot, 1.5, "1" if dark else "2", light="2" if dark else "3", dark="P" if dark else "1")
        legs.rect(foot[0] - 3, foot[1] - 1, foot[0] + 3, foot[1], "P" if dark else "1")
        legs.hline(foot[0] - 2, foot[0] + 3, foot[1] - 1, "2" if dark else "3")
        legs.set(knee[0], knee[1], "3" if dark else "4")
    back = Grid(48, 40)
    # the ammo drum on its back, packets peeking out
    box(back, 3, 13 + dy, 11, 25 + dy, OLIVE[0], light=OLIVE[1], dark="P")
    for x in (4, 8):
        back.rect(x, 10 + dy, x + 2, 12 + dy, "O")
        back.set(x, 10 + dy, "a")
    back.hline(3, 11, 18 + dy, "o")
    # the mortar tube, angled up and forward, recoiling when it fires
    a = math.atan2(-14, 11)
    bx, by = 17 - math.cos(a) * recoil, 18 + dy - math.sin(a) * recoil
    tx, ty = 28 - math.cos(a) * recoil, 4 + dy - math.sin(a) * recoil
    tube = Grid(48, 40)
    limb(tube, (bx, by), (tx, ty), 2.6, "2", light="4", dark="1")
    for t in (0.35, 0.7):  # bands
        tube.fill(thick_pts([(int(bx + (tx - bx) * t), int(by + (ty - by) * t))], 1.6), "3")
    muzzle = ellipse_pts(tx + 0.3, ty - 0.2, 3.4, 3.4)
    shade_rim(tube, muzzle, "3", light="5", dark="2")
    tube.fill(ellipse_pts(tx + 0.3, ty - 0.2, 1.6, 1.6), "O" if f == 3 else "P")
    hull = Grid(48, 40)
    hp = poly_pts([(8, 17 + dy), (37, 17 + dy), (42, 22 + dy), (41, 29 + dy), (7, 29 + dy), (5, 23 + dy)])
    shade_rim(hull, hp, OLIVE[1], light=OLIVE[2], dark=OLIVE[0])
    for (x, y) in edge_pts(hp, ((0, -1),)):
        hull.set(x, y, OLIVE[3])
    hull.hline(8, 38, 24 + dy, "O")  # the warning stripe
    for x in range(10, 37, 4):
        hull.set(x, 25 + dy, "o")
        hull.set(x + 1, 25 + dy, "o")
    hull.rect(36, 20 + dy, 40, 22 + dy, "C")  # the sensor visor
    hull.hline(37, 39, 20 + dy, "B")
    hull.fill(ellipse_pts(17, 17 + dy, 4.5, 2.5), OLIVE[2])  # the turret ring
    hull.hline(14, 20, 16 + dy, OLIVE[3])
    ant = Grid(48, 40)
    ant.vline(33, 10 + dy, 16 + dy, "3")
    ant.set(33, 9 + dy, "R")
    layers = [legs, back, tube, hull, ant]
    if f == 3:
        flash = Grid(48, 40)
        for (x, y) in ellipse_pts(tx + 2, ty - 3, 3.6, 3.6):
            flash.set(x, y, "Y")
        for (x, y) in ellipse_pts(tx + 2, ty - 3, 2, 2):
            flash.set(x, y, "W")
        for dx_, dy_ in ((5, -5), (-1, -6), (6, 0), (3, -7)):
            flash.set(int(tx + 2 + dx_), int(ty - 3 + dy_), "y")
        smoke = Grid(48, 40)
        for cx_, cy_, r_ in ((tx - 5, ty - 4, 2.2), (tx - 8, ty - 1, 1.6)):
            smoke.fill(ellipse_pts(cx_, cy_, r_, r_), "t")
        layers += [smoke, flash]
    return stack(48, 40, *layers)


def make_lobber():
    return sheet([[lobber_frame(f) for f in range(4)]], 48, 40)


# ======================================================= LEGACY MONOLITH ===
# A walking mainframe: tape-reel eyes, blinkenlights, a reactor core behind
# two chest plates (front / back half) and a crown slab. The game draws the
# plates (row 2) over the body (row 1), shifted by MONO_DY like the torso.
MONO_DY = [0, 0, 1, 0, -2, 2, 1]
# feet (back, front) and fists (back, front) per frame
MONO_POSE = {
    1: dict(feet=((17, 61), (40, 59)), fists=((9, 42), (55, 44))),  # walk A
    2: dict(feet=((22, 59), (36, 61)), fists=((9, 44), (55, 42))),  # walk B
    3: dict(feet=((20, 61), (40, 61)), fists=((9, 43), (55, 43))),  # idle
    4: dict(feet=((19, 61), (41, 61)), fists=((7, 3), (57, 3))),  # slam wind-up: arms up
    5: dict(feet=((17, 61), (43, 61)), fists=((7, 55), (57, 55))),  # slam: fists in the floor
    6: dict(feet=((15, 61), (44, 60)), fists=((7, 36), (59, 30))),  # charge: shoulder in
}


def mono_body(f):
    dy = MONO_DY[f]
    pose = MONO_POSE[f]
    legs = Grid(64, 64)
    for i, (fx, fy) in enumerate(pose["feet"]):
        hip = (24 + i * 16, 44 + dy)
        dark = i == 0
        limb(legs, hip, (fx, fy - 3), 3.4, "1" if dark else "2", light="2" if dark else "3", dark="P" if dark else "1")
        box(legs, fx - 6, fy - 2, fx + 6, fy, "1" if dark else "2", light="2" if dark else "3", dark="P")
    arms = []
    for i, (fx, fy) in enumerate(pose["fists"]):
        a = Grid(64, 64)
        sh = (10 + i * 44, 14 + dy)
        dark = i == 0
        limb(a, sh, (fx, fy), 3.2, "1" if dark else "2", light="2" if dark else "3", dark="P" if dark else "1")
        box(a, fx - 5, fy - 4, fx + 5, fy + 4, "1" if dark else "3", light="2" if dark else "4", dark="P" if dark else "1")
        a.hline(fx - 4, fx + 4, fy + 1, "P" if dark else "2")  # knuckles
        if f == 4:
            a.set(fx, fy - 2, "Y")  # charged fists
        arms.append(a)
    torso = Grid(64, 64)
    box(torso, 14, 8 + dy, 50, 45 + dy, BEIGE[1], light=BEIGE[2], dark=BEIGE[0])
    torso.hline(15, 49, 8 + dy, BEIGE[3])
    for x in range(17, 48, 6):  # case seams
        torso.vline(x, 44 + dy, 45 + dy, BEIGE[0])
    # tape-reel eyes and the blinkenlights between them
    for rx in (24, 40):
        reel = ellipse_pts(rx, 16.5 + dy, 4.2, 4.2)
        shade_rim(torso, reel, "5", light="W", dark="4")
        torso.fill(ellipse_pts(rx, 16.5 + dy, 2.2, 2.2), "1")
        ang = f * 0.9 + rx  # the reels turn
        for k in range(3):
            torso.set(int(rx + math.cos(ang + k * 2.1) * 3), int(16.5 + dy + math.sin(ang + k * 2.1) * 3), "3")
        torso.set(rx, 16 + dy, "W")
    for i, x in enumerate(range(29, 36, 2)):
        torso.set(x, 16 + dy, "GRYC"[(i + f) % 4])
    # the chest behind the plates: cables, vents and the reactor core
    torso.rect(17, 22 + dy, 47, 42 + dy, "P")
    for y in range(24, 42, 3):
        torso.hline(18, 25, y + dy, "1")
        torso.hline(39, 46, y + dy, "1")
    core = ellipse_pts(32, 32 + dy, 6.5, 6.5)
    torso.fill(core, "o")
    torso.fill(ellipse_pts(32, 32 + dy, 4.8, 4.8), "O")
    torso.fill(ellipse_pts(32, 32 + dy, 3, 3), "a")
    torso.fill(ellipse_pts(31.5, 31.5 + dy, 1.5, 1.5), "y")
    torso.set(31, 31 + dy, "W")
    return stack(64, 64, arms[0], legs, torso, arms[1])


def mono_plate(i, dy=0):
    g = Grid(64, 64)
    if i == 0:  # front: the right half of the chest
        box(g, 33, 21 + dy, 50, 43 + dy, "3", light="4", dark="2")
        g.vline(33, 21 + dy, 43 + dy, "2")
        for (x, y) in ((35, 23), (48, 23), (35, 41), (48, 41)):
            g.set(x, y + dy, "1")
        for y in (27, 30, 33):  # vent slits
            g.hline(38, 45, y + dy, "2")
        g.rect(38, 37 + dy, 41, 38 + dy, "O")  # a warning label
    elif i == 1:  # back: the left half, in shadow
        box(g, 14, 21 + dy, 31, 43 + dy, "2", light="3", dark="1")
        for (x, y) in ((16, 23), (29, 23), (16, 41), (29, 41)):
            g.set(x, y + dy, "P")
        for x in range(18, 28, 2):  # a barcode
            g.vline(x, 34 + dy, 39 + dy, "1")
    else:  # crown: a heavy slab over the head with hazard stripes
        box(g, 11, 2 + dy, 53, 10 + dy, "3", light="5", dark="2")
        for x in range(13, 52):
            for y in range(5, 8):
                if ((x + y) // 3) % 2 == 0:
                    g.set(x, y + dy, "Y")
                else:
                    g.set(x, y + dy, "P")
        g.hline(12, 52, 4 + dy, "4")
        g.hline(12, 52, 8 + dy, "2")
    return stack(64, 64, g)


def make_monolith():
    bodies = [mono_body(f) for f in range(1, 7)]
    armored = Grid(64, 64)
    armored.blit(bodies[2])  # the idle pose...
    for i in range(3):
        armored.blit(mono_plate(i))  # ...with every plate on (the DATABASE picture)
    return sheet([[armored] + bodies, [mono_plate(i) for i in range(3)] + [Grid(64, 64)] * 4], 64, 64, rows=2)


# ================================================================= HOTFIX ===
# A flying band-aid with a halo: a white capsule, a green "+" pad, two
# thrusters and a tether emitter underneath.
HOT_BOB = [0, -1, -1, 0, 0, -1]


def hotfix_frame(f):
    oy = HOT_BOB[f]
    cast = f >= 4
    halo = Grid(36, 28)
    ring = ellipse_pts(17.5, 5 + oy, 7.5, 2.4)
    inner = ellipse_pts(17.5, 5 + oy, 5.5, 1.2)
    for p in ring - inner:
        halo.set(p[0], p[1], "G" if not cast else "f")
    if cast:
        for p in ring - inner:
            halo.set(p[0], p[1], "G")
    glint = [(11, 5), (16, 3), (23, 4), (20, 7), (14, 7), (24, 6)][f]
    halo.set(glint[0], glint[1] + oy, "W")
    jets = Grid(36, 28)
    for x in (8, 26):
        jets.rect(x, 19 + oy, x + 2, 20 + oy, "2")
        jets.hline(x, x + 2, 19 + oy, "3")
        n = 2 + (f + x // 8) % 2
        for k in range(n):
            jets.set(x + 1, 21 + oy + k, "B" if k == 0 else "C")
    emit = Grid(36, 28)
    emit.rect(16, 19 + oy, 19, 21 + oy, "2")
    emit.hline(16, 19, 19 + oy, "3")
    emit.rect(17, 22 + oy, 18, 23 + oy, "G" if cast else "i")
    if cast:
        emit.set(17, 24 + oy, "W")
        emit.set(18, 24 + oy, "G")
    body = Grid(36, 28)
    cap = ellipse_pts(17.5, 14.5 + oy, 13.2, 4.6, p=3.2)
    for (x, y) in cap:
        v = (y + 0.5 - (14.5 + oy)) / 4.6
        body.set(x, y, "W" if v < -0.55 else "s" if v < 0.35 else "t")
    pad = {(x, y) for (x, y) in cap if 13 <= x <= 22}
    for (x, y) in pad:
        v = (y + 0.5 - (14.5 + oy)) / 4.6
        body.set(x, y, "G" if v < 0.3 else "i")
    body.vline(17, 12 + oy, 17 + oy, "W")  # the cross
    body.vline(18, 12 + oy, 17 + oy, "W")
    body.hline(15, 20, 14 + oy, "W")
    body.hline(15, 20, 15 + oy, "W")
    for x in (8, 10, 25, 27):  # band-aid holes
        body.set(x, 13 + oy, "t")
        body.set(x, 16 + oy, "t")
    body.rect(29, 13 + oy, 30, 14 + oy, "C")  # the sensor (its front)
    return stack(36, 28, halo, jets, emit, body)


def make_hotfix():
    return sheet([[hotfix_frame(f) for f in range(6)]], 36, 28)


# =========================================================== RATE LIMITER ===
# A walking signal tower on a tripod: lattice mast, a 429 display, and an
# emitter dish on top. Symmetric, so the "429" never shows mirrored.
DIGITS = {
    "4": ["1.1", "1.1", "111", "..1", "..1"],
    "2": ["111", "..1", "111", "1..", "111"],
    "9": ["111", "1.1", "111", "..1", "111"],
}
RL_FEET = [  # (left, right) feet per frame: idle, walk A, walk B, pulse
    ((5, 70), (30, 70)),
    ((3, 67), (31, 70)),
    ((4, 70), (32, 67)),
    ((4, 70), (31, 70)),
]


def limiter_frame(f):
    pulse = f == 3
    bob = 1 if f in (1, 2) else 0
    legs = Grid(36, 72)
    hub_y = 56 + bob
    limb(legs, (17.5, hub_y + 2), (17.5, 70), 1.0, "1", dark="P")  # the back leg
    for i, (fx, fy) in enumerate(RL_FEET[f]):
        hip = (12 + i * 11, hub_y + 2)
        knee = (hip[0] + (-5 if i == 0 else 5), hip[1] + 5)
        limb(legs, hip, knee, 1.3, "2", light="3", dark="1")
        limb(legs, knee, (fx, fy - 1), 1.1, "2", light="3", dark="1")
        legs.rect(fx - 2, fy, fx + 2, fy, "1")
    mast = Grid(36, 72)
    top = 13 + bob
    mast.vline(14, top, hub_y, "3")
    mast.vline(21, top, hub_y, "2")
    for y in range(top + 1, hub_y - 6, 7):
        mast.line(15, y, 20, y + 6, "2")
        mast.line(20, y, 15, y + 6, "1")
    hub = Grid(36, 72)
    box(hub, 10, hub_y - 2, 25, hub_y + 3, "2", light="3", dark="1")
    for x in range(11, 25, 3):
        hub.set(x, hub_y, "O")
        hub.set(x + 1, hub_y, "O")
    # the display: 429 in amber
    disp = Grid(36, 72)
    dy0 = 29 + bob
    box(disp, 9, dy0, 26, dy0 + 8, "P", light="2", dark="1")
    for k, ch in enumerate("429"):
        for r, row in enumerate(DIGITS[ch]):
            for c, v in enumerate(row):
                if v == "1":
                    disp.set(12 + k * 4 + c, dy0 + 2 + r, "W" if pulse else "O")
    # the emitter dish, its rod and the glowing emitter
    dish = Grid(36, 72)
    bowl = [(x, int(round(11 + bob - 0.06 * (x - 17.5) ** 2))) for x in range(6, 30)]
    for (x, y) in bowl:
        dish.vline(x, y, y + 1, "4" if x < 17 else "3")
        dish.set(x, y + 2, "2")
    dish.vline(17, 4 + bob, 10 + bob, "3")
    dish.vline(18, 4 + bob, 10 + bob, "2")
    for sx in (5, 30):  # side prongs
        dish.vline(sx, 6 + bob, 9 + bob, "3")
        dish.set(sx, 5 + bob, "R")
    emit = Grid(36, 72)
    r = 3.2 if pulse else 2.4
    emit.fill(ellipse_pts(17.5, 3 + bob, r, r), "Y" if pulse else "O")
    emit.fill(ellipse_pts(17.5, 3 + bob, r * 0.55, r * 0.55), "W" if pulse else "a")
    return stack(36, 72, legs, mast, hub, disp, dish, emit)


def make_ratelimiter():
    return sheet([[limiter_frame(f) for f in range(4)]], 36, 72)


# ------------------------------------------------------------------ main ---
SHEETS = [
    ("forkbomb.png", make_forkbomb, (168, 28)),
    ("lobber.png", make_lobber, (192, 40)),
    ("monolith.png", make_monolith, (448, 128)),
    ("hotfix.png", make_hotfix, (216, 28)),
    ("ratelimiter.png", make_ratelimiter, (144, 72)),
]


def preview(images, path, k=3):
    w = max(im.width for im in images) * k
    h = sum(im.height * k + 6 for im in images)
    out = Image.new("RGBA", (w, h), (34, 12, 58, 255))
    y = 0
    for im in images:
        out.alpha_composite(im.resize((im.width * k, im.height * k), Image.NEAREST), (0, y))
        y += im.height * k + 6
    out.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=IMG_DIR)
    ap.add_argument("--preview")
    args = ap.parse_args()
    images = []
    for name, make, size in SHEETS:
        im = make()
        assert im.size == size, (name, im.size)
        im.save(os.path.join(args.out, name), optimize=True)
        images.append(im)
        print(f"wrote {name:16s} {im.width}x{im.height}")
    if args.preview:
        preview(images, args.preview)


if __name__ == "__main__":
    main()
