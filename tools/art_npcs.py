#!/usr/bin/env python3
"""
NPC art for Cyberpunk 2D77 v3.2: THE LEGEND, NULL, the billboard hologram and
the human-like enemies, redrawn to sit next to the new IC art (same lighting
language: a key light from the top left, a coloured rim light on the far
edge, a 1px selective dark outline, hue-shifted shading ramps).

Like tools/make_sprites.py, everything is drawn from code (no image is read)
and all randomness comes from fixed seeds, so re-running this script writes
byte-identical PNGs. It only writes NEW files; the older sheets stay as they
are and the game falls back to them.

Usage:
    python3 tools/art_npcs.py                  # writes the PNGs into img/
    python3 tools/art_npcs.py --preview DIR    # also writes 6x previews there

Sheets:
    legend2.png      576x96   THE LEGEND, 6 frames of 96x96: 0 idle, 1 blink,
                              2 talk (mouth open), 3 talk (half), 4 smirk,
                              5 one eyebrow raised
    legend-bust.png  192x240  THE LEGEND, head-and-shoulders bust
"""

import argparse
import math
import os
import random

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "img")
SEED = 3277


# ------------------------------------------------------------------ colour ---
def hx(s):
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def ramp(*cols):
    return [hx(c) for c in cols]


def norm(v):
    m = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / m for c in v)


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


LIGHT = norm((-0.55, -0.7, 0.55))  # key light: top left, toward the viewer


# ------------------------------------------------------------------ shapes ---
def catmull(pts, n=6, closed=True):
    """A smooth closed (or open) curve through the control points."""
    out = []
    m = len(pts)
    rng = range(m) if closed else range(m - 1)
    for i in rng:
        p0 = pts[(i - 1) % m] if closed or i > 0 else pts[0]
        p1 = pts[i]
        p2 = pts[(i + 1) % m]
        p3 = pts[(i + 2) % m] if closed or i + 2 < m else pts[-1]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    if not closed:
        out.append(pts[-1])
    return out


def poly(w, h, pts, smooth=False):
    """Pixels inside a polygon (optionally smoothed into a curve)."""
    if smooth:
        pts = catmull(pts)
    im = Image.new("L", (w, h), 0)
    ImageDraw.Draw(im).polygon([(float(x), float(y)) for x, y in pts], fill=255)
    px = im.load()
    return {(x, y) for y in range(h) for x in range(w) if px[x, y]}


def ellipse(cx, cy, rx, ry, w=10 ** 4, h=10 ** 4):
    out = set()
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if 0 <= x < w and 0 <= y < h and ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                out.add((x, y))
    return out


def line(x0, y0, x1, y1):
    pts = []
    x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1:
            return pts
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def polyline(pts):
    out = []
    for a, b in zip(pts, pts[1:]):
        for p in line(a[0], a[1], b[0], b[1]):
            if not out or out[-1] != p:
                out.append(p)
    return out


def curve_line(pts, n=8):
    """A smooth 1px line through the points."""
    return polyline([(round(x), round(y)) for x, y in catmull(pts, n, closed=False)])


def thick(pts, r):
    out = set()
    ir = int(math.ceil(r))
    for (x, y) in pts:
        for dy in range(-ir, ir + 1):
            for dx in range(-ir, ir + 1):
                if dx * dx + dy * dy <= r * r + 0.01:
                    out.add((x + dx, y + dy))
    return out


N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))


def edge(pts):
    """The pixels of a shape that touch the outside."""
    return {(x, y) for (x, y) in pts if any((x + dx, y + dy) not in pts for dx, dy in N4)}


def stroke(P, pts, width, mat, tone_fn, z, clip=None, taper=(0.35, 0.2), step=0.25):
    """A tapered brush stroke along a smooth curve: hair clumps, cloth folds.
    tone_fn(x, y, s, t): s is -1..1 across the stroke (+1 on the edge that
    faces the key light), t is 0..1 along it."""
    path = catmull(pts, 24, closed=False)
    lens = [0.0]
    for a, b in zip(path, path[1:]):
        lens.append(lens[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total = lens[-1] or 1.0
    done = {}
    for i, p in enumerate(path):
        a = path[max(0, i - 1)]
        b = path[min(len(path) - 1, i + 1)]
        tx, ty = norm((b[0] - a[0], b[1] - a[1]))
        nx, ny = -ty, tx
        if nx * -0.6 + ny * -0.8 < 0:  # the normal points at the light
            nx, ny = -nx, -ny
        t = lens[i] / total
        k = 1.0
        if t < taper[0]:
            k = math.sqrt(t / taper[0])
        elif t > 1 - taper[1]:
            k = math.sqrt(max(0.0, (1 - t) / taper[1]))
        w = max(0.5, width * k)
        s = -1.0
        while s <= 1.0001:
            x = int(math.floor(p[0] + nx * s * w))
            y = int(math.floor(p[1] + ny * s * w))
            if (clip is None or (x, y) in clip) and P.inb(x, y):
                key = (x, y)
                # where samples overlap keep the one nearest the centre line
                if key not in done or abs(s) < abs(done[key]):
                    done[key] = s
                    P.put(x, y, mat, tone_fn(x, y, s, t), z)
            s += step / w
    return set(done)


def dome(cx, cy, rx, ry, tilt=(0.0, 0.0), flat=1.0):
    """Lighting of an ellipsoid (0..1). tilt turns its normals; flat < 1
    flattens the front."""
    def f(x, y):
        nx = (x + 0.5 - cx) / rx
        ny = (y + 0.5 - cy) / ry
        r2 = min(1.0, nx * nx + ny * ny)
        nz = math.sqrt(1.0 - r2) * flat + 0.05
        return max(0.0, dot(norm((nx + tilt[0], ny + tilt[1], nz)), LIGHT))
    return f


# ------------------------------------------------------------ the painter ---
class Mat:
    """A material: a shading ramp (dark to light) and how its edges behave."""

    def __init__(self, cols, rim=0.75, line=0.32, glow=False):
        self.ramp = cols
        self.rim = rim  # how strongly the coloured rim light shows on it
        self.line = line  # outline darkness (fraction of the colour kept)
        self.glow = glow  # emissive: no rim, light outline

    def col(self, t):
        t = max(0.0, min(len(self.ramp) - 1.0, t))
        return self.ramp[int(round(t))]


class Paint:
    """Pixels hold (material, tone, depth). Parts are painted back to front;
    depth lets the finishing pass draw contact lines and rim light where a
    nearer part overlaps a farther one."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.cell = [[None] * w for _ in range(h)]

    def inb(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def get(self, x, y):
        return self.cell[y][x] if self.inb(x, y) else None

    def put(self, x, y, mat, tone, z=0):
        if self.inb(x, y):
            self.cell[y][x] = [mat, tone, z]

    def fill(self, pts, mat, tone, z=0, clip=None):
        f = tone if callable(tone) else (lambda x, y: tone)
        for (x, y) in pts:
            if clip is not None and (x, y) not in clip:
                continue
            self.put(x, y, mat, f(x, y), z)

    def shift(self, pts, d, only=None):
        for (x, y) in pts:
            c = self.get(x, y)
            if c and (only is None or c[0] in only):
                c[1] = max(0.0, min(len(c[0].ramp) - 1.0, c[1] + d))

    def has(self, x, y, mats=None):
        c = self.get(x, y)
        return bool(c) and (mats is None or c[0] in mats)

    def mats_at(self, pts):
        return {(x, y) for (x, y) in pts if self.get(x, y)}

    def erase(self, pts):
        for (x, y) in pts:
            if self.inb(x, y):
                self.cell[y][x] = None

    def finish(self, rim_col, rim_from=0.62, inner=1.0, outline=True, cut_bottom=False, rim_dirs=((1, 0), (1, -1)),
               rim_w=1):
        """Contact lines, rim light and the selective outline -> RGBA image."""
        w, h = self.w, self.h
        tone = [[c[1] if c else 0 for c in row] for row in self.cell]
        # contact lines: a farther part next to a nearer one gets darker (more
        # so below / right of it, away from the key light)
        for y in range(h):
            for x in range(w):
                c = self.cell[y][x]
                if not c or c[0].glow:
                    continue
                best = 0
                for dx, dy in N4:
                    n = self.get(x + dx, y + dy)
                    if n and n[2] > c[2] + 0.5 and not n[0].glow:
                        best = max(best, 1.6 if (dx < 0 or dy < 0) else 0.9)
                if best:
                    tone[y][x] = max(0, tone[y][x] - best * inner)
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        px = im.load()
        for y in range(h):
            for x in range(w):
                c = self.cell[y][x]
                if c:
                    px[x, y] = c[0].col(tone[y][x]) + (255,)
        # rim light: edges facing right / up-right toward the city glow
        for y in range(h):
            for x in range(w):
                c = self.cell[y][x]
                if not c or c[0].glow or c[0].rim <= 0:
                    continue
                k = 0.0
                for (dx, dy), s in zip(rim_dirs, (1.0, 0.55)):
                    if dy < 0 and x < w * rim_from:
                        continue  # top edges on the near side belong to the key light
                    for d in range(1, rim_w + 1):
                        if self.get(x + dx * d, y + dy * d) is None:
                            k = max(k, s * (1.0 - 0.45 * (d - 1)))
                            break
                if k:
                    col = px[x, y][:3]
                    px[x, y] = mix(col, rim_col, c[0].rim * k) + (255,)
        if outline:
            marks = []
            for y in range(h):
                for x in range(w):
                    if self.cell[y][x]:
                        continue
                    best = None
                    for dx, dy in N4:
                        n = self.get(x + dx, y + dy)
                        if n:
                            # lit side (the neighbour is below / right of us): a softer line
                            lit = dx > 0 or dy > 0
                            k = n[0].line * (1.5 if lit else 1.0)
                            if n[0].glow:
                                k = 0.55
                            cand = (k, n)
                            if best is None or cand[0] < best[0]:
                                best = cand
                    if best and not (cut_bottom and y >= h - 1):
                        k, n = best
                        base = n[0].col(n[1])
                        dark = mix((14, 8, 30), base, k)
                        marks.append((x, y, dark))
            for x, y, col in marks:
                px[x, y] = col + (255,)
        return im


# ============================================================= THE LEGEND ===
# An original mentor hologram: shoulder-length dark hair swept back from a
# side part with one silver streak, a short salt-and-pepper beard, a black
# suit over an open-collared shirt, a cyan implant at the temple. Facing 3/4
# to the right (toward the speech bubble), lit from the top left, cyan rim on
# the far side. Tired, amused eyes; the mouth always about to smirk.
SKIN = Mat(ramp("#2c1a2a", "#56323f", "#845058", "#ad7770", "#cf9d8b", "#ebc8b4"), rim=0.75, line=0.3)
HAIR = Mat(ramp("#06060c", "#0e1019", "#171b2a", "#232b42", "#34425f", "#4f6688"), rim=0.9, line=0.5)
SILVER = Mat(ramp("#3c4460", "#626d8c", "#929cb8", "#c3cbdf", "#eaf0fa"), rim=0.5, line=0.35)
BEARD = Mat(ramp("#0c0b14", "#1a1926", "#2b2a3a", "#434156", "#666479", "#9897ac"), rim=0.85, line=0.45)
SUIT = Mat(ramp("#040409", "#0a0a13", "#13141f", "#1e2132", "#2d3249", "#454e70"), rim=0.95, line=0.55)
SHIRT = Mat(ramp("#081018", "#0f1c29", "#182b3c", "#233f52", "#33586c"), rim=0.6, line=0.45)
EYEW = Mat(ramp("#5d5a6e", "#9796aa", "#c9cad8", "#eef0f7"), rim=0, line=0.3)
IRIS = Mat(ramp("#0d111c", "#26344a", "#45627c", "#7ba0b8"), rim=0, line=0.3)
LIP = Mat(ramp("#1f0f19", "#4a2330", "#74393e", "#975650"), rim=0.3, line=0.3)
TEETH = Mat(ramp("#5e5a6c", "#a9a7b6", "#dcdce6"), rim=0, line=0.3)
IMPL = Mat(ramp("#141226", "#272543", "#3e3c66", "#0e9fc6", "#19f5ff", "#b5fcff"), rim=0, line=0.45)
GLOWC = Mat(ramp("#0e9fc6", "#19f5ff", "#b5fcff", "#ffffff"), rim=0, line=0.6, glow=True)
CYAN = hx("#19f5ff")


def legend_base(P):
    """Everything but the expression, on the 96x96 grid."""
    W, H = P.w, P.h
    rng = random.Random(SEED)
    def face_tone(x, y):
        # cel-shaded planes: lit near side, the front, the far side in shadow
        fx, fy = x + 0.5, y + 0.5
        ridge = 54.6 + (fy - 30) * 0.38  # where the face turns past the nose
        if fx > ridge + 5.2:
            return 1.5
        if fx > ridge + 0.4 and fy > 28.5:
            return 2.1
        if fy < 28.5:  # forehead
            return 4.8 if fx < 47 else 4.3 if fx < 55 else 3.0 if fx < 59 else 2.0
        if fx < 42.5:  # turning toward the ear
            return 3.0
        if fy > 38.5:  # below the cheekbone
            return 3.4
        return 4.1

    # --- hair behind the head, falling to both shoulders (z 1): clumps
    back = poly(W, H, [(40, 9), (48, 7), (56, 7.5), (61.5, 10.5), (64.6, 16), (65.6, 24), (66, 34), (66.4, 46),
                       (65.4, 56), (63, 62.5), (59, 63.5), (50, 62), (40, 64), (35.5, 68.5), (32.5, 66),
                       (30, 67.5), (27.6, 60), (26.4, 50), (26.4, 37), (27.8, 24), (32, 14)], smooth=True)
    P.fill(back, HAIR, 0.5, z=1)
    hb = dome(40, 24, 22, 40)

    def hair_tone(base, gain, edge, far=99):
        return lambda x, y, s, t: base + gain * hb(x, y) + edge * s - 0.9 * t * t - (1.0 if x > far else 0)
    for c in ([(36, 12), (30, 20), (28, 34), (28.6, 48), (30.4, 60), (31, 67)],
              [(40, 14), (34, 24), (32.4, 38), (33, 52), (34.8, 63), (35.2, 68)],
              [(42, 20), (37.6, 30), (36.4, 44), (37.6, 56), (38.6, 63)],
              [(62, 14), (64.6, 26), (65, 40), (64.6, 52), (62.4, 62)],
              [(60, 20), (62.6, 32), (63, 46), (61.4, 58)]):
        stroke(P, c, 2.7, HAIR, hair_tone(0.7, 2.6, 0.9, far=60), z=1, clip=back)

    # --- suit and shirt (z 2..4)
    jacket = poly(W, H, [(3, 97), (5, 85), (10, 76), (18, 70), (29, 66), (38, 63), (47, 65), (57, 63), (67, 65),
                         (77, 69), (85, 75), (90, 84), (93, 97)], smooth=True)
    torso = dome(46, 104, 50, 44)
    P.fill(jacket, SUIT, lambda x, y: 0.4 + 3.0 * torso(x, y), z=2)
    top_edge = {(x, y) for (x, y) in jacket if (x, y - 1) not in jacket or (x, y - 2) not in jacket}
    P.shift({p for p in top_edge if p[0] < 44}, 1.2)
    for seam in ([(15, 74), (13, 84), (12, 96)], [(83, 75), (85.5, 85), (86.5, 96)]):
        P.shift(set(curve_line(seam)), -1.0)
    shirt = poly(W, H, [(39, 62), (57, 62), (55.5, 70), (51.5, 82), (48.5, 90), (45, 82), (40.5, 70)])
    sl = dome(45, 70, 12, 20)
    P.fill(shirt, SHIRT, lambda x, y: 0.6 + 3.0 * sl(x, y), z=3)
    for side, tone in ((-1, 3.2), (1, 1.8)):  # open collar points
        col = poly(W, H, [(48 + side * 1.5, 63.5), (48 + side * 9.5, 61), (48 + side * 11, 65.5), (48 + side * 5.5, 74)])
        P.fill(col, SHIRT, tone, z=3.5)
    lap_l = poly(W, H, [(36.5, 63), (29, 70.5), (34, 74.5), (30, 77.5), (41, 92), (46, 97), (47.5, 89), (41.5, 74)])
    lap_r = poly(W, H, [(60, 62.5), (66.5, 68.5), (62.5, 72.5), (66.5, 75.5), (55, 92), (51, 97), (50.5, 88), (56.5, 73)])
    P.fill(lap_l, SUIT, lambda x, y: 2.0 + 1.6 * max(0.0, 1 - (y - 63) / 30), z=4)
    P.fill(lap_r, SUIT, lambda x, y: 1.3 + 0.8 * max(0.0, 1 - (y - 63) / 30), z=4)
    P.shift({(x, y) for (x, y) in edge(lap_l) if (x - 1, y) not in lap_l and y < 92}, 1.3)  # satin edge
    # a small cyan pin on the lapel: a broken chain link
    P.fill({(35, 80), (36, 80), (36, 81), (38, 82), (39, 82), (39, 83)}, GLOWC, 1.0, z=5)

    # --- neck (z 5)
    neck = poly(W, H, [(41.5, 46), (55.5, 49), (57, 57), (56.6, 64.5), (48, 66.5), (39.6, 63.5), (40.4, 55)], smooth=True)
    nl = dome(45, 56, 12, 14)
    P.fill(neck, SKIN, lambda x, y: 0.2 + 2.4 * nl(x, y) - (1.0 if y < 59 else 0), z=5)

    # --- ear (z 6)
    ear = ellipse(37.8, 36.5, 2.5, 4.6, W, H)
    P.fill(ear, SKIN, lambda x, y: 1.4 + 2.6 * dome(37, 35.5, 3, 5)(x, y), z=6)
    P.shift(ellipse(38.4, 37, 0.9, 2.3, W, H), -1.4)

    # --- face (z 7)
    face = poly(W, H, [(41, 24.5), (45, 21.5), (52, 20.8), (58, 21.6), (62, 24), (63, 28.5), (62, 31.6), (63.4, 35.6),
                       (63.6, 39.5), (63, 43.5), (62.6, 47.5), (61, 51.5), (57.6, 55.2), (52.5, 57), (47, 56),
                       (42.6, 52.4), (40, 46.5), (39.4, 39), (39.6, 31)], smooth=True)
    P.fill(face, SKIN, face_tone, z=7)
    P.shift(ellipse(47, 32.6, 5.8, 2.5, W, H), -1.1, only={SKIN})  # eye sockets
    P.shift(ellipse(59.2, 32.6, 2.8, 2.3, W, H), -0.6, only={SKIN})
    P.shift(ellipse(45.6, 37.2, 3.4, 1.2, W, H), 0.7, only={SKIN})  # near cheekbone
    P.shift({(62, 35), (62, 36)}, 0.9, only={SKIN})  # far cheekbone catches a little light
    # nose: lit near plane, shadowed far plane, underside and nostril
    nose = poly(W, H, [(54, 29.5), (55.6, 30), (58, 35), (60.4, 38.6), (61.6, 40.8), (60, 42.2), (56.2, 42.4), (55, 41)])
    for (x, y) in nose:
        far_plane = x + 0.5 > 54.6 + (y + 0.5 - 30) * 0.38
        P.put(x, y, SKIN, 2.0 if far_plane else 3.9, 7.5)
    P.fill(set(line(54, 30, 55, 37)), SKIN, 5.0, 7.5)  # bridge highlight
    P.fill({(59, 38), (60, 39)}, SKIN, 4.2, 7.5)  # tip
    P.fill(set(polyline([(55, 42), (58, 42), (61, 41)])), SKIN, 1.0, 7.5)  # underside
    P.fill({(57, 41)}, SKIN, 0.3, 7.5)  # nostril
    P.shift(poly(W, H, [(60, 38.5), (63.2, 39), (63, 42.6), (60.6, 43)]), -1.0, only={SKIN})  # nose shadow
    P.shift(set(curve_line([(53.6, 41), (51.8, 43), (50.8, 45)])), -1.0, only={SKIN})  # nasolabial fold

    # --- the beard (z 8): sideburn, jaw, chin and moustache
    beard = poly(W, H, [(40.2, 30.5), (42, 31), (42.3, 36.5), (44, 40.5), (47.5, 43.4), (50.5, 43.6), (54, 43.2),
                        (57, 43.6), (60.2, 42.8), (62.6, 42.4), (63.6, 45.5), (62.8, 50.4), (59.8, 55), (54, 58.4),
                        (47.6, 58), (43, 54.4), (40.2, 48.4), (39.4, 40)], smooth=True)
    bl = dome(49, 45, 14, 13)
    P.fill(beard, BEARD, lambda x, y: 0.3 + 3.0 * bl(x, y) - (1.0 if x > 57 else 0), z=8)
    burn = {(x, y) for (x, y) in beard if x < 43 and y < 41}
    P.fill(burn, HAIR, lambda x, y: 1.0 + (0.8 if x == 41 else 0), z=8)
    stache = poly(W, H, [(48.4, 44.8), (51, 43.4), (55, 43.1), (58.6, 43.3), (61.2, 44.1), (60.6, 45.4), (55, 45.2),
                         (49.4, 46)], smooth=True)
    P.fill(stache, BEARD, lambda x, y: (3.6 if y < 44 else 2.6) - (1.2 if x > 58 else 0), z=8)
    for (x, y) in sorted(beard):  # salt and pepper, mostly on the chin
        r = rng.random()
        if (x, y) in burn or (x, y) in stache:
            continue
        if r < (0.12 if y > 49 else 0.05):
            P.shift({(x, y)}, 1.5)
        elif r < 0.12:
            P.shift({(x, y)}, -0.8)
    for (x, y) in sorted(edge(beard)):  # a soft, trimmed line on the cheek
        if 36 < y < 44 and x < 55 and (x, y - 1) not in beard and rng.random() < 0.5:
            P.put(x, y, SKIN, face_tone(x, y) - 0.6, 7)
    P.shift({(x, y + 1) for (x, y) in edge(beard) if y > 51}, -1.2, only={SKIN})  # beard shadow on the neck

    # --- hair on top, swept back from the hairline (z 9): clumps
    top = poly(W, H, [(33, 25), (33.6, 16.5), (38.6, 10), (46, 6.8), (54, 6.6), (60, 9), (64.4, 14), (65.6, 20),
                      (64, 25), (62, 24.2), (60.4, 22.4), (57, 21), (52, 20.4), (47, 21), (43.4, 23), (41.2, 26),
                      (40.6, 30.6), (38.6, 31.6), (36, 29)], smooth=True)
    P.fill(top, HAIR, 0.8, z=9)
    for c in ([(54, 7.6), (46, 7.8), (38.6, 11), (33.6, 17), (33, 24)],
              [(62, 12), (56, 9), (48, 8.6), (40.6, 11.4), (35, 18), (33.6, 27)],
              [(64, 19), (59, 14.6), (51, 13.2), (43, 15.4), (37.4, 22), (35.6, 30)],
              [(62.5, 23.5), (59, 20), (53, 18.6), (46, 19.4), (41, 23), (38.8, 31)]):
        stroke(P, c, 2.9, HAIR, hair_tone(0.6, 3.0, 1.0, far=61), z=9, clip=top)
    # the silver streak: from the hairline over the near brow, swept back
    silver = lambda x, y, s, t: 0.9 + 2.6 * hb(x, y) + 0.7 * s - 1.4 * t * t
    streak = stroke(P, [(52.4, 21), (47.4, 17.8), (41.4, 17.2), (37, 21), (35, 27)], 1.2, SILVER, silver, z=9.2, clip=top)
    streak |= stroke(P, [(50.4, 20.6), (45.6, 15.8), (39.6, 15), (35.2, 19.6), (33.8, 24)], 0.9, SILVER, silver, z=9.2,
                     clip=top)
    P.shift({(x, y + 1) for (x, y) in streak if (x, y + 1) not in streak}, -0.8, only={HAIR})
    P.shift({(x, y + 1) for (x, y) in edge(top) if P.has(x, y + 1, {SKIN})}, -1.3, only={SKIN})  # hairline shadow

    # --- the temple implant: a small cyan port above the ear, wired into the hair (z 10)
    P.fill({(40, 27), (41, 27), (42, 27), (40, 28), (41, 28), (42, 28), (40, 29), (41, 29)}, IMPL, 1.0, z=10)
    P.fill({(41, 28)}, GLOWC, 2.5, z=10.5)
    P.fill({(42, 28), (41, 27)}, GLOWC, 0.0, z=10.5)
    P.fill({(39, 28), (38, 28)}, IMPL, 3.0, z=10.5)
    return face_tone


def stamp(P, x0, y0, rows, key):
    """Paint a small pixel map onto the face ('.' leaves it alone)."""
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == ".":
                continue
            mat, tone = key[ch]
            if mat is None:
                P.shift({(x0 + i, y0 + j)}, tone)
            else:
                P.put(x0 + i, y0 + j, mat, tone, 11)


# Keys for the expression maps. 0-5 skin tones, -/_ darken, + lighten.
FACE_KEY = {
    "0": (SKIN, 0.0), "1": (SKIN, 1.0), "2": (SKIN, 2.0), "3": (SKIN, 3.0), "4": (SKIN, 4.0), "5": (SKIN, 5.0),
    "-": (None, -1.0), "_": (None, -2.0), "+": (None, 1.0),
    "K": (HAIR, 0.0), "x": (HAIR, 1.0), "y": (HAIR, 2.0), "z": (HAIR, 3.0),
    "s": (EYEW, 0.0), "w": (EYEW, 1.0), "W": (EYEW, 2.0), "h": (EYEW, 3.0),
    "o": (IRIS, 0.0), "I": (IRIS, 1.0), "i": (IRIS, 2.0),
    "b": (BEARD, 1.0), "c": (BEARD, 2.0), "d": (BEARD, 3.0), "e": (BEARD, 4.0), "k": (BEARD, 0.0),
    "m": (LIP, 0.0), "n": (LIP, 1.0), "l": (LIP, 2.0), "L": (LIP, 3.0),
    "t": (TEETH, 1.0), "T": (TEETH, 2.0),
}

# Near eye: 7x5 at (44, 30), outer corner on the left. Far eye: 5x5 at
# (57, 30), outer corner on the right. Heavy upper lids (tired), the irises
# glancing right toward whoever he is talking to (amused, unhurried).
EYES = {
    "lidded": ([".-----.", "1KKKKKK", "KswhoIs", ".swIiw1", "..----."],
               ["-----", "1KKKK", "1wIoK", ".sIo1", ".---."]),
    "open": ([".1KKKK.", "1KKKKKK", "KwWhoIs", ".swIiw1", "..----."],
             [".KKK.", "1KKKK", "1WhoK", ".sIo1", ".---."]),
    "closed": ([".-----.", "1333332", "2333332", "1KKKKK1", "..----."],
               ["-----", "13332", "23332", "1KKKK", ".---."]),
    "narrow": ([".-----.", "1222222", "1KKKKKK", ".KwhoIK", "..-__-."],
               ["-----", "12222", "1KKKK", ".KhoK", ".---."]),
}
# Brows: near 9x4 at (43, 26), far 6x4 at (56, 26)
BROWS = {
    "rest": ([".........", "...xyyx..", ".xyzzyyxK", "x.......K"], ["......", "xyyx..", "Kxyzyx", "K....x"]),
    "up": (["...xyyx..", ".xyzzyyxK", "x.......K", "........."], ["xyyx..", "Kxyzyx", "K....x", "......"]),
    "lift": (["...xyyx..", ".xyzzyyx.", "x......xK", "........."], ["......", "xyyx..", "Kxyzyx", "K....x"]),
    "skeptic": (["..xyyzx..", ".xy...yxK", "x.......K", "........."], ["......", "......", "Kxyyzx", "KKxx.."]),
}
# Mouth: 12x4 at (49, 45): the moustache's lower edge, the lips, the chin
MOUTHS = {
    "rest": ["cddeedddc...", ".kmmmmmmk...", "..nlLLLn....", "..kbbbk....."],
    "smirk": ["kmddedddc...", "..kmmmmmk...", "...nlLLn....", "...kbbk....."],
    "open": ["cdTTTTTTd...", ".kmmmmmmmk..", "..mmmmmmk...", "..nlLLLn...."],
    "half": ["cddTTTTdc...", ".kmmmmmmk...", "..nlLLLn....", "..kbbbk....."],
    "flat": ["cddeedddc...", "..kmmmmk....", "...nlLn.....", "...kbbk....."],
}

LEGEND_FACES = [
    ("lidded", "rest", "rest"),     # 0 idle
    ("closed", "rest", "rest"),     # 1 blink
    ("open", "up", "open"),         # 2 talk: mouth open
    ("lidded", "up", "half"),       # 3 talk: mouth half open
    ("narrow", "lift", "smirk"),    # 4 smirk
    ("open", "skeptic", "flat"),    # 5 one eyebrow raised
]


def legend_face(P, f):
    eyes, brows, mouth = LEGEND_FACES[f]
    ne, fe = EYES[eyes]
    stamp(P, 44, 30, ne, FACE_KEY)
    stamp(P, 57, 30, fe, FACE_KEY)
    nb, fb = BROWS[brows]
    stamp(P, 43, 26, nb, FACE_KEY)
    stamp(P, 56, 26, fb, FACE_KEY)
    stamp(P, 49, 45, MOUTHS[mouth], FACE_KEY)
    stamp(P, 42, 31, ["-", ".", "-"], FACE_KEY)  # crow's feet
    if mouth == "smirk":
        stamp(P, 46, 43, ["-.", ".-"], FACE_KEY)  # the cheek bunches up into the beard


def holo_grade(im, strength=0.22, fade_rows=10):
    """A light hologram pass: a cyan cast in the shadows, and the bottom of the
    projection thinning out into scan lines."""
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if not a:
                continue
            lum = 0.3 * r + 0.59 * g + 0.11 * b
            k = strength * (1.0 - lum / 255.0)
            col = mix((r, g, b), (int(lum * 0.55), int(lum * 1.05) + 18, int(lum * 1.1) + 26), k)
            if y >= h - fade_rows:
                t = (y - (h - fade_rows) + 1) / fade_rows
                a = int(a * (1.0 - 0.75 * t))
                if (y - (h - fade_rows)) % 3 == 2:
                    a = int(a * 0.35)
            px[x, y] = tuple(max(0, min(255, c)) for c in col) + (a,)
    return im


def legend_frame(f):
    P = Paint(96, 96)
    legend_base(P)
    legend_face(P, f)
    im = P.finish(CYAN, cut_bottom=True)
    return holo_grade(im)


def make_legend2():
    sheet = Image.new("RGBA", (96 * 6, 96), (0, 0, 0, 0))
    for f in range(6):
        sheet.paste(legend_frame(f), (f * 96, 0))
    return sheet


# ================================================================== main ===
def preview(im, path, scale=6, bg=(24, 20, 40)):
    big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    out = Image.new("RGBA", big.size, bg + (255,))
    out.alpha_composite(big)
    out.convert("RGB").save(path)


def build_all():
    return {
        "legend2.png": make_legend2(),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preview", help="directory for 6x previews")
    ap.add_argument("--only", help="comma-separated file names to build")
    args = ap.parse_args()
    sheets = build_all()
    for name, im in sheets.items():
        if args.only and name not in args.only.split(","):
            continue
        im.save(os.path.join(IMG_DIR, name), optimize=True)
        print("wrote img/%s %dx%d" % (name, im.width, im.height))
        if args.preview:
            os.makedirs(args.preview, exist_ok=True)
            preview(im, os.path.join(args.preview, name), 6 if im.width <= 600 else 3)


if __name__ == "__main__":
    main()
