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
    legend2.png      576x96   THE LEGEND, 6 frames of 96x96 (a close-up talking
                              head): 0 idle, 1 blink, 2 talk (mouth open),
                              3 talk (half), 4 smirk, 5 one eyebrow raised
    legend-bust.png  192x240  THE LEGEND, head-and-shoulders bust (same model)
    null2.png        896x96   NULL, 14 frames of 64x96, the layout of null.png:
                              0-1 idle, 2-5 run, 6 air, 7 blink out, 8 blink in,
                              9 slash, 10 throw, 11 rail aim, 12 hurt,
                              13 defeated; facing right, feet on row 94
"""

import argparse
import math
import os
import random
import sys

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
                    halo = None
                    for dx, dy in N4:
                        n = self.get(x + dx, y + dy)
                        if n and n[0].glow:
                            halo = n  # glowing things get a soft halo, not a dark line
                        elif n:
                            # lit side (the neighbour is below / right of us): a softer line
                            lit = dx > 0 or dy > 0
                            k = n[0].line * (1.5 if lit else 1.0)
                            if best is None or k < best[0]:
                                best = (k, n)
                    if best and not (cut_bottom and y >= h - 1):
                        k, n = best
                        base = n[0].col(n[1])
                        marks.append((x, y, mix((14, 8, 30), base, k) + (255,)))
                    elif halo:
                        marks.append((x, y, halo[0].ramp[min(1, len(halo[0].ramp) - 1)] + (120,)))
            for x, y, col in marks:
                px[x, y] = col
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
LIP = Mat(ramp("#1f0f19", "#4a2330", "#74393e", "#975650", "#b5736a"), rim=0.3, line=0.3)
TEETH = Mat(ramp("#5e5a6c", "#a9a7b6", "#dcdce6"), rim=0, line=0.3)
IMPL = Mat(ramp("#141226", "#272543", "#3e3c66", "#0e9fc6", "#19f5ff", "#b5fcff"), rim=0, line=0.45)
GLOWC = Mat(ramp("#0e9fc6", "#19f5ff", "#b5fcff", "#ffffff"), rim=0, line=0.6, glow=True)
CYAN = hx("#19f5ff")


class Xf:
    """Design coordinates -> pixels. THE LEGEND is designed on a 96px grid;
    the talking head draws it closer, the bust bigger, from the same model."""

    def __init__(self, k, ox, oy):
        self.k, self.ox, self.oy = k, ox, oy

    def p(self, x, y):
        return (self.ox + self.k * x, self.oy + self.k * y)

    def pts(self, L):
        return [self.p(x, y) for x, y in L]

    def d(self, x, y):
        """pixel (its centre) -> design coordinates"""
        return ((x + 0.5 - self.ox) / self.k, (y + 0.5 - self.oy) / self.k)

    def r(self, v):
        return v * self.k

    def poly(self, P, L, smooth=False):
        return poly(P.w, P.h, self.pts(L), smooth)

    def ell(self, P, cx, cy, rx, ry):
        return ellipse(*self.p(cx, cy), self.r(rx), self.r(ry), P.w, P.h)

    def dome(self, cx, cy, rx, ry, **kw):
        return dome(*self.p(cx, cy), self.r(rx), self.r(ry), **kw)

    def stroke(self, P, L, w, mat, tone, z, clip=None, taper=(0.35, 0.2)):
        return stroke(P, self.pts(L), self.r(w), mat, tone, z, clip, taper)

    def band(self, L, w=0.0):
        """A line through the points, w design units thick (at least 1px)."""
        pts = curve_line(self.pts(L)) if len(L) > 2 else line(*self.p(*L[0]), *self.p(*L[1]))
        return set(pts) if self.r(w) < 1.2 else thick(pts, self.r(w) / 2)

    def box(self, x0, y0, x1, y1):
        """The pixels covering a design-space box."""
        a, b = self.p(x0, y0), self.p(x1, y1)
        return [(x, y) for y in range(int(math.floor(a[1])), int(math.ceil(b[1])) + 1)
                for x in range(int(math.floor(a[0])), int(math.ceil(b[0])) + 1)]


def legend_base(P, X):
    """THE LEGEND without his expression."""
    W, H = P.w, P.h
    rng = random.Random(SEED)
    D = X.d

    def face_tone(x, y):
        # cel-shaded planes: lit near side, the front, the far side in shadow
        fx, fy = D(x, y)
        ridge = 54.6 + (fy - 30) * 0.38  # where the face turns past the nose
        if fx > ridge + 5.2:
            return 1.5
        if fx > ridge + 1.3 and fy > 28.5:
            return 2.1
        if fx > ridge + 0.4 and fy > 28.5:
            return 2.8  # a softer turn beside the nose
        if fy < 28.5:  # forehead
            return 4.8 if fx < 47 else 4.3 if fx < 55 else 3.0 if fx < 59 else 2.0
        if fx < 42.5:  # turning toward the ear
            return 3.0
        if fy > 38.5:  # below the cheekbone
            return 3.4
        return 4.1

    # --- hair behind the head, falling to both shoulders (z 1): clumps
    back = X.poly(P, [(40, 9), (48, 7), (56, 7.5), (61.5, 10.5), (64.6, 16), (65.6, 24), (66, 34), (66.4, 46),
                      (65.4, 56), (63, 62.5), (59, 63.5), (50, 62), (40, 64), (35.5, 68.5), (32.5, 66),
                      (30, 67.5), (27.6, 60), (26.4, 50), (26.4, 37), (27.8, 24), (32, 14)], smooth=True)
    P.fill(back, HAIR, 0.5, z=1)
    hb = X.dome(40, 24, 22, 40)

    def hair_tone(base, gain, edge_k, far=99.0):
        return lambda x, y, s, t: base + gain * hb(x, y) + edge_k * s - 0.9 * t * t - (1.0 if D(x, y)[0] > far else 0)
    clumps = [[(36, 12), (30, 20), (28, 34), (28.6, 48), (30.4, 60), (31, 67)],
              [(40, 14), (34, 24), (32.4, 38), (33, 52), (34.8, 63), (35.2, 68)],
              [(42, 20), (37.6, 30), (36.4, 44), (37.6, 56), (38.6, 63)],
              [(62, 14), (64.6, 26), (65, 40), (64.6, 52), (62.4, 62)],
              [(60, 20), (62.6, 32), (63, 46), (61.4, 58)]]
    for c in clumps:
        X.stroke(P, c, 2.7, HAIR, hair_tone(0.7, 2.6, 0.9, far=60), z=1, clip=back)
    if X.k > 1.8:  # finer strands where there is room for them
        for c in ([(33, 16), (29, 28), (29.8, 44), (32.4, 58)], [(38.4, 18), (35, 30), (34.4, 46), (36.4, 60)],
                  [(63.4, 22), (64.2, 36), (63.6, 50)]):
            X.stroke(P, c, 0.6, HAIR, hair_tone(1.2, 2.6, 0.4, far=60), z=1, clip=back)

    # --- suit and shirt (z 2..4)
    jacket = X.poly(P, [(2, 114), (3, 97), (5, 85), (10, 76), (18, 70), (29, 66), (38, 63), (47, 65), (57, 63),
                        (67, 65), (77, 69), (85, 75), (90, 84), (93, 97), (94, 114)], smooth=True)
    torso = X.dome(46, 104, 50, 44)
    P.fill(jacket, SUIT, lambda x, y: 0.4 + 3.0 * torso(x, y), z=2)
    top_edge = {(x, y) for (x, y) in jacket if (x, y - 1) not in jacket or (x, y - int(X.k + 1)) not in jacket}
    P.shift({p for p in top_edge if D(*p)[0] < 44}, 1.2)
    for seam in ([(15, 74), (13, 84), (12, 100), (11, 114)], [(83, 75), (85.5, 85), (86.5, 100), (87, 114)]):
        P.shift(X.band(seam, 0.5), -1.0)
    shirt = X.poly(P, [(39, 62), (57, 62), (55.5, 70), (51.5, 82), (48.5, 90), (45, 82), (40.5, 70)])
    shl = X.dome(45, 70, 12, 20)
    P.fill(shirt, SHIRT, lambda x, y: 0.6 + 3.0 * shl(x, y), z=3)
    for side, tone in ((-1, 3.2), (1, 1.8)):  # open collar points
        col = X.poly(P, [(48 + side * 1.5, 63.5), (48 + side * 9.5, 61), (48 + side * 11, 65.5), (48 + side * 5.5, 74)])
        P.fill(col, SHIRT, tone, z=3.5)
    lap_l = X.poly(P, [(36.5, 63), (29, 70.5), (34, 74.5), (30, 77.5), (41, 92), (46, 97), (47.5, 89), (41.5, 74)])
    lap_r = X.poly(P, [(60, 62.5), (66.5, 68.5), (62.5, 72.5), (66.5, 75.5), (55, 92), (51, 97), (50.5, 88), (56.5, 73)])
    P.fill(lap_l, SUIT, lambda x, y: 2.0 + 1.6 * max(0.0, 1 - (D(x, y)[1] - 63) / 30), z=4)
    P.fill(lap_r, SUIT, lambda x, y: 1.3 + 0.8 * max(0.0, 1 - (D(x, y)[1] - 63) / 30), z=4)
    P.shift({(x, y) for (x, y) in edge(lap_l) if (x - 1, y) not in lap_l and D(x, y)[1] < 92}, 1.3)  # satin edge
    # a small cyan pin on the lapel: a broken chain link
    for a, b in (((35, 80), (36.6, 80.6)), ((38, 82), (39.6, 82.8))):
        P.fill(X.band([a, b], 0.9), GLOWC, 1.0, z=5)
    if X.k > 1.8:  # a pocket square in the far breast pocket and the jacket's buttons
        P.fill(X.poly(P, [(66, 86), (71, 84.5), (72, 87), (66.5, 88)]), GLOWC, 0.0, z=5)
        P.fill(X.ell(P, 50, 104, 1.0, 1.0), SUIT, 3.5, z=5)

    # --- neck (z 5)
    neck = X.poly(P, [(41.5, 46), (55.5, 49), (57, 57), (56.6, 64.5), (48, 66.5), (39.6, 63.5), (40.4, 55)], smooth=True)
    nl = X.dome(45, 56, 12, 14)
    P.fill(neck, SKIN, lambda x, y: 0.2 + 2.4 * nl(x, y) - (1.0 if D(x, y)[1] < 59 else 0), z=5)

    # --- ear (z 6)
    ear = X.ell(P, 37.8, 36.5, 2.5, 4.6)
    ed = X.dome(37, 35.5, 3, 5)
    P.fill(ear, SKIN, lambda x, y: 1.4 + 2.6 * ed(x, y), z=6)
    P.shift(X.ell(P, 38.4, 37, 0.9, 2.3), -1.4)

    # --- face (z 7)
    face = X.poly(P, [(41, 24.5), (45, 21.5), (52, 20.8), (58, 21.6), (62, 24), (63, 28.5), (62, 31.6), (63.4, 35.6),
                      (63.6, 39.5), (63, 43.5), (62.6, 47.5), (61, 51.5), (57.6, 55.2), (52.5, 57), (47, 56),
                      (42.6, 52.4), (40, 46.5), (39.4, 39), (39.6, 31)], smooth=True)
    P.fill(face, SKIN, face_tone, z=7)
    P.shift(X.ell(P, 47, 32.6, 5.8, 2.5), -1.1, only={SKIN})  # eye sockets
    P.shift(X.ell(P, 59.2, 32.6, 2.8, 2.3), -0.6, only={SKIN})
    P.shift(X.ell(P, 45.6, 37.2, 3.4, 1.2), 0.7, only={SKIN})  # near cheekbone
    P.shift(X.ell(P, 62.2, 35.6, 0.7, 1.3), 0.9, only={SKIN})  # far cheekbone catches a little light
    # nose: lit near plane, shadowed far plane, underside and nostril
    nose = X.poly(P, [(54, 29.5), (55.6, 30), (58, 35), (60.4, 38.6), (61.6, 40.8), (60, 42.2), (56.2, 42.4), (55, 41)])
    for (x, y) in nose:
        fx, fy = D(x, y)
        P.put(x, y, SKIN, 2.0 if fx > 54.6 + (fy - 30) * 0.38 else 3.9, 7.5)
    P.fill(X.band([(54.2, 30.4), (55.2, 37)], 0.6), SKIN, 5.0, 7.5)  # bridge highlight
    P.fill(X.ell(P, 59.6, 38.9, 0.9, 0.7), SKIN, 4.3, 7.5)  # tip
    P.fill(X.band([(55.2, 42.2), (58.2, 42.3), (61, 41.3)], 0.6), SKIN, 1.0, 7.5)  # underside
    P.fill(X.ell(P, 57.4, 41.5, 0.7, 0.5), SKIN, 0.3, 7.5)  # nostril
    P.shift(X.poly(P, [(60, 38.5), (63.2, 39), (63, 42.6), (60.6, 43)]), -1.0, only={SKIN})  # nose shadow
    P.shift(X.band([(53.6, 41), (51.8, 43), (50.8, 45)], 0.5), -1.0, only={SKIN})  # nasolabial fold

    # --- the beard (z 8): sideburn, jaw, chin and moustache
    beard = X.poly(P, [(40.2, 30.5), (42, 31), (42.3, 36.5), (44, 40.5), (47.5, 43.4), (50.5, 43.6), (54, 43.2),
                       (57, 43.6), (60.2, 42.8), (62.6, 42.4), (63.6, 45.5), (62.8, 50.4), (59.8, 55), (54, 58.4),
                       (47.6, 58), (43, 54.4), (40.2, 48.4), (39.4, 40)], smooth=True)
    bl = X.dome(49, 45, 14, 13)
    P.fill(beard, BEARD, lambda x, y: 0.3 + 3.0 * bl(x, y) - (1.0 if D(x, y)[0] > 57 else 0), z=8)
    burn = {(x, y) for (x, y) in beard if D(x, y)[0] < 43 and D(x, y)[1] < 41}
    P.fill(burn, HAIR, lambda x, y: 1.0 + (0.8 if D(x, y)[0] > 41.2 else 0), z=8)
    for (x, y) in sorted(beard):  # salt and pepper, mostly on the chin
        if (x, y) in burn:
            continue
        r = rng.random()
        if r < (0.12 if D(x, y)[1] > 49 else 0.05):
            P.shift({(x, y)}, 1.5)
        elif r < 0.12:
            P.shift({(x, y)}, -0.8)
    for (x, y) in sorted(edge(beard)):  # a soft, trimmed line on the cheek
        fx, fy = D(x, y)
        if 36 < fy < 44 and fx < 55 and (x, y - 1) not in beard and rng.random() < 0.5:
            P.put(x, y, SKIN, face_tone(x, y) - 0.6, 7)
    P.shift({(x, y + 1) for (x, y) in edge(beard) if D(x, y)[1] > 51}, -1.2, only={SKIN})  # beard shadow on the neck

    # --- hair on top, swept back from the hairline (z 9): clumps
    top = X.poly(P, [(33, 25), (33.6, 16.5), (38.6, 10), (46, 6.8), (54, 6.6), (60, 9), (64.4, 14), (65.6, 20),
                     (64, 25), (62, 24.2), (60.4, 22.4), (57, 21), (52, 20.4), (47, 21), (43.4, 23), (41.2, 26),
                     (40.6, 30.6), (38.6, 31.6), (36, 29)], smooth=True)
    P.fill(top, HAIR, 0.8, z=9)
    for c in ([(54, 7.6), (46, 7.8), (38.6, 11), (33.6, 17), (33, 24)],
              [(62, 12), (56, 9), (48, 8.6), (40.6, 11.4), (35, 18), (33.6, 27)],
              [(64, 19), (59, 14.6), (51, 13.2), (43, 15.4), (37.4, 22), (35.6, 30)],
              [(62.5, 23.5), (59, 20), (53, 18.6), (46, 19.4), (41, 23), (38.8, 31)]):
        X.stroke(P, c, 2.9, HAIR, hair_tone(0.6, 3.0, 1.0, far=61), z=9, clip=top)
    if X.k > 1.8:
        for c in ([(60, 10.6), (52, 10.6), (44, 12.6), (37.6, 18.4)], [(63, 16.4), (56, 16.2), (47.4, 16.8), (40, 21.6)]):
            X.stroke(P, c, 0.6, HAIR, hair_tone(1.4, 3.0, 0.4, far=61), z=9, clip=top)
    # the silver streak: from the hairline over the near brow, swept back
    silver = lambda x, y, s, t: 0.6 + 3.2 * hb(x, y) + 0.6 * s - 2.6 * t * t
    path = [(52.6, 21.2), (48.4, 17.6), (43, 15.4), (37.6, 16.6), (34.4, 20.6)]
    streak = set()
    for (ox, oy, w) in ((-0.2, -0.9, 0.55), (0.3, 0.9, 0.42)):
        streak |= X.stroke(P, [(x + ox, y + oy) for x, y in path], w, SILVER, silver, z=9.2, clip=top,
                           taper=(0.15, 0.5))
    for c in ([(47.6, 19.6), (44, 16.4), (40, 15.6)], [(43.4, 18.2), (39.6, 16.8), (36.4, 18.6)]):
        P.fill({p for p in X.band(c, 0.3) if p in streak}, HAIR, 1.6, z=9.3)
    P.shift({(x, y + 1) for (x, y) in streak if (x, y + 1) not in streak}, -0.8, only={HAIR})
    P.shift({(x, y + 1) for (x, y) in edge(top) if P.has(x, y + 1, {SKIN})}, -1.3, only={SKIN})  # hairline shadow

    # --- the temple implant: a small cyan port above the ear, wired into the hair (z 10)
    P.fill(X.poly(P, [(39.6, 26.6), (42.8, 26.4), (43, 29.6), (39.8, 29.8)]), IMPL, 1.0, z=10)
    P.fill(X.ell(P, 41.4, 28.1, 0.75, 0.75), GLOWC, 2.5, z=10.5)
    P.fill(X.band([(39.6, 28.2), (37.4, 28.4)], 0.5), IMPL, 3.0, z=10.5)
    P.fill(X.band([(39.8, 26.8), (38.6, 25)], 0.5), IMPL, 3.0, z=10.5)
    return face_tone


# ---------------------------------------------------------- expressions ---
# Each frame of the talking head: how heavy the lids are, where the brows
# sit (outer, middle, inner; negative = up) and the mouth.
LEGEND_FACES = [
    dict(lid=0.72, brow_n=(0, 0, 0), brow_f=(0, 0, 0), mouth="rest"),                  # 0 idle
    dict(lid=0.72, brow_n=(0, 0, 0), brow_f=(0, 0, 0), mouth="rest", closed=True),     # 1 blink
    dict(lid=0.4, brow_n=(-0.5, -0.6, -0.4), brow_f=(-0.4, -0.5, -0.4), mouth="open"),  # 2 talk: open
    dict(lid=0.58, brow_n=(-0.3, -0.3, -0.2), brow_f=(-0.2, -0.3, -0.2), mouth="half"),  # 3 talk: half open
    dict(lid=0.95, squint=0.35, brow_n=(0.1, 0.2, 0.3), brow_f=(-0.6, -0.7, -0.3), mouth="smirk"),  # 4 smirk
    dict(lid=0.15, brow_n=(-1.2, -1.9, -0.9), brow_f=(0.2, 0.4, 0.5), mouth="flat"),    # 5 eyebrow raised
]


def draw_eye(P, X, A, B, up_h, low_h, lid, squint, iris_c, iris_r, closed):
    """An almond eye between corners A and B (design units). The upper lid
    arcs up_h above the corner line minus how far the lid has come down."""
    ax, ay = A
    bx, by = B
    L = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / L, (by - ay) / L
    lash = 0.62 + 0.1 / X.k

    def lids(u):
        base = ay + (by - ay) * u
        s = math.sin(math.pi * min(1.0, max(0.0, u)))
        bot = base + (low_h - squint) * s ** 1.1
        top = base - (up_h - lid) * s ** 0.75
        return (bot - 0.02, bot) if closed else (top, bot)
    x0 = min(ax, bx) - 1.5
    x1 = max(ax, bx) + 1.5
    y0 = min(ay, by) - up_h - 2.6
    y1 = max(ay, by) + low_h + 1.2
    for (x, y) in X.box(x0, y0, x1, y1):
        fx, fy = X.d(x, y)
        u = ((fx - ax) * ux + (fy - ay) * uy) / L
        if u < -0.1 or u > 1.06:
            continue
        top, bot = lids(u)
        if 0.0 <= u <= 1.0 and top < fy < bot:
            d = math.hypot(fx - iris_c[0], fy - iris_c[1])
            shade = fy - top < 0.6  # the lid's shadow on the eye
            if d < iris_r:
                t = 0.0 if d < iris_r * 0.5 else (1.0 if fy < iris_c[1] + 0.3 else 2.0)
                P.put(x, y, IRIS, t - (1 if shade else 0), 11)
            else:
                t = 1.35 - (1.0 if shade else 0) - (0.8 if u < 0.22 or u > 0.85 else 0)
                P.put(x, y, EYEW, t, 11)
        elif top - lash <= fy <= top and -0.06 <= u <= 1.0:
            P.put(x, y, HAIR, 0.0, 11)  # the lash line, a touch past the outer corner
        elif top - lash - 1.1 <= fy <= top - lash - 0.45 and 0.1 <= u <= 0.9:
            P.shift({(x, y)}, -1.0, only={SKIN})  # the lid crease
        elif not closed and bot <= fy <= bot + 0.45 and 0.15 <= u <= 0.95:
            P.shift({(x, y)}, -0.8, only={SKIN})  # the lower lid
    if not closed:  # the pupil, and a glint beside it
        px_, py_ = X.p(*iris_c)
        c = P.get(int(px_), int(py_))
        if c and c[0] is IRIS:
            P.put(int(px_), int(py_), IRIS, 0.0, 11)
            g = P.get(int(px_) - 1, int(py_) - 1) and (int(px_) - 1, int(py_) - 1)
            g = g if g and P.get(*g)[0] is IRIS else (int(px_) - 1, int(py_))
            if P.get(*g) and P.get(*g)[0] is IRIS:
                P.put(g[0], g[1], EYEW, 3.0, 11)


def draw_brow(P, X, pts, off, w):
    pts = [(x, y + o) for (x, y), o in zip(pts, off)]
    X.stroke(P, pts, w, HAIR, lambda x, y, s, t: 1.2 + (1.4 if s > 0.3 else 0) + 0.6 * t, z=11, taper=(0.6, 0.15))


def draw_mouth(P, X, kind):
    N, M, F = [50.4, 46.7], [55.2, 46.9], [59.6, 46.4]
    open_h = {"open": 2.3, "half": 1.2}.get(kind, 0.0)
    if kind == "rest":
        N[1] -= 0.5
    elif kind == "smirk":
        N[0] -= 0.6
        N[1] -= 2.1
        M[1] -= 0.45
    elif kind == "flat":
        N[0] += 0.6
        N[1] += 0.1
        F[0] -= 0.4
    elif open_h:
        N[1] -= 0.2
        F[1] -= 0.2

    def mouth_y(fx):  # the upper edge of the mouth: two straight-ish spans
        if fx <= M[0]:
            t = (fx - N[0]) / (M[0] - N[0])
            return N[1] + (M[1] - N[1]) * (1 - (1 - t) ** 2)
        t = (fx - M[0]) / (F[0] - M[0])
        return M[1] + (F[1] - M[1]) * t * t
    # the moustache over the upper lip, its lower edge following the mouth
    for (x, y) in X.box(N[0] - 1.6, 43.0, F[0] + 1.6, 47.6):
        fx, fy = X.d(x, y)
        lo = mouth_y(min(F[0], max(N[0], fx))) - 0.15
        hi = 43.4 + 0.12 * abs(fx - 55)
        if N[0] - 1.4 <= fx <= F[0] + 1.4 and hi <= fy <= lo:
            t = 3.4 if fy < hi + 0.8 else 0.8 if fy > lo - 0.75 else 2.2
            P.put(x, y, BEARD, t - (1.2 if fx > 58.4 else 0), 11)
    # the mouth line / the open mouth
    for (x, y) in X.box(N[0] - 0.2, 44.0, F[0] + 0.2, 50.0):
        fx, fy = X.d(x, y)
        if not N[0] <= fx <= F[0]:
            continue
        top = mouth_y(fx)
        u = (fx - N[0]) / (F[0] - N[0])
        depth = open_h * math.sin(math.pi * u) ** 0.6
        if top - 0.1 <= fy <= top + 0.55 + depth:
            if open_h and fy < top + 0.75 and 0.15 < u < 0.85:
                P.put(x, y, TEETH, 2.0 if 0.3 < u < 0.7 else 1.0, 11)
            else:
                P.put(x, y, LIP, 0.0, 11)
    # the lower lip catches the light, with a shadow under it
    ly = (mouth_y(55.2) + 1.25 + open_h * 0.95)
    lip = X.stroke(P, [(N[0] + 1.8, ly - 0.1 + (N[1] - 46.7) * 0.4), (55.2, ly + 0.15), (F[0] - 1.7, ly)], 0.5, LIP,
                   lambda x, y, s, t: 2.6 + 1.2 * (s > 0) - (1.2 if X.d(x, y)[0] > 58 else 0), z=11, taper=(0.25, 0.25))
    P.shift({(x, y + 1) for (x, y) in lip if (x, y + 1) not in lip}, -1.2, only={BEARD})
    if kind == "smirk":  # the cheek bunches up beside the raised corner
        P.fill(X.band([(N[0] - 0.4, N[1] + 0.4), (N[0] - 1.5, N[1] - 1.0)], 0.4), BEARD, 0.0, z=11)
        P.shift(X.ell(P, 47.4, 41.6, 1.8, 1.0), 0.7, only={SKIN})


def legend_face(P, X, f):
    e = LEGEND_FACES[f]
    closed = e.get("closed", False)
    sq = e.get("squint", 0.0)
    draw_brow(P, X, [(43.0, 30.0), (46.6, 28.3), (51.0, 29.0)], e["brow_n"], 0.85)
    draw_brow(P, X, [(61.8, 29.5), (58.9, 28.3), (56.6, 29.0)], e["brow_f"], 0.75)
    draw_eye(P, X, (44.2, 32.7), (50.6, 32.5), 1.55, 1.05, e["lid"], sq, (48.9, 32.9), 1.3, closed)
    draw_eye(P, X, (57.3, 32.5), (61.4, 32.7), 1.35, 0.9, e["lid"], sq, (60.0, 32.9), 1.0, closed)
    P.fill(X.band([(42.6, 31.8), (41.6, 31.4)], 0.4), SKIN, 2.0, z=11)  # crow's feet
    P.fill(X.band([(42.8, 33.6), (41.8, 34.0)], 0.4), SKIN, 2.3, z=11)
    draw_mouth(P, X, e["mouth"])


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


# The talking head is a close-up: the design grid drawn 1.3x, head filling the frame
LEGEND_HEAD = (1.3, -11.8, -4.5)


def legend_frame(f):
    P = Paint(96, 96)
    X = Xf(*LEGEND_HEAD)
    legend_base(P, X)
    legend_face(P, X, f)
    im = P.finish(CYAN, cut_bottom=True)
    return holo_grade(im)


def make_legend_bust():
    """192x240 head-and-shoulders bust, the same model drawn 2.2x (idle face)."""
    P = Paint(192, 240)
    X = Xf(2.2, -7.4, 1.0)
    legend_base(P, X)
    legend_face(P, X, 0)
    im = P.finish(CYAN, cut_bottom=True, rim_w=2)
    return holo_grade(im, strength=0.16, fade_rows=18)


def make_legend2():
    sheet = Image.new("RGBA", (96 * 6, 96), (0, 0, 0, 0))
    for f in range(6):
        sheet.paste(legend_frame(f), (f * 96, 0))
    return sheet


# ==================================================================== NULL ===
# The glitch-ninja assassin (second boss): 14 frames of 64x96 facing right,
# feet on row 94, in the poses of null.png (js/null.js depends on the frame
# order and on the hands: the throw at about (52, 38) in frame 10, the rail
# pistol's muzzle near (60, 57) in frame 11). The joints come from
# make_sprites.NULL_POSES so the anchors stay put; the figure on them is new:
# a lean armoured body, a hooded cloak that comes apart into pixels at the
# hem, a glossy black faceplate with a glowing empty-set sign, twin violet
# energy blades and a violet rim light.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_sprites as MS  # noqa: E402  (NULL_POSES, the old sheet's joints)

NSUIT = Mat(ramp("#08060d", "#151022", "#221a36", "#33284e", "#4a3b6e", "#6b5896"), rim=0.9, line=0.55)
NARMOR = Mat(ramp("#0e0d19", "#1d1c2e", "#2f2e48", "#47466a", "#6a6896", "#a4a1cf"), rim=0.9, line=0.5)
NCLOAK = Mat(ramp("#050308", "#0c0814", "#150f24", "#211835", "#30244c"), rim=0.75, line=0.6)
NLINING = Mat(ramp("#22103f", "#381868", "#542294"), rim=0.3, line=0.5)
NMASK = Mat(ramp("#020206", "#0b0b14", "#17172b", "#2b2b4a", "#4c4c7c", "#8a8ab8"), rim=0.5, line=0.6)
NGLOW = Mat(ramp("#5c25ad", "#9c4dff", "#b06cff", "#d9b5ff", "#ffffff"), rim=0, line=0.5, glow=True)
NCYAN = Mat(ramp("#0e9fc6", "#19f5ff", "#b5fcff", "#ffffff"), rim=0, line=0.5, glow=True)
NSTEEL = Mat(ramp("#2e2e44", "#5c5c7c", "#9a9ab8", "#dcdcf0"), rim=0.4, line=0.45)
VIOLET = hx("#b06cff")


def unit(v):
    m = math.hypot(v[0], v[1]) or 1.0
    return (v[0] / m, v[1] / m)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def capsule(P, a, b, ra, rb, mat, tone_fn, z):
    """A limb: a tapered capsule from a to b, cylinder-shaded. tone_fn gets
    s (-1..1 across, +1 facing the key light) and t (0..1 along)."""
    (ax, ay), (bx, by) = a, b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy or 1e-6
    L = math.sqrt(L2)
    nx, ny = -dy / L, dx / L
    if nx * -0.6 + ny * -0.8 < 0:
        nx, ny = -nx, -ny
    r = max(ra, rb)
    out = set()
    for y in range(int(min(ay, by) - r - 1), int(max(ay, by) + r + 2)):
        for x in range(int(min(ax, bx) - r - 1), int(max(ax, bx) + r + 2)):
            qx_, qy_ = x + 0.5, y + 0.5
            t = min(1.0, max(0.0, ((qx_ - ax) * dx + (qy_ - ay) * dy) / L2))
            cx_, cy_ = ax + dx * t, ay + dy * t
            rr = ra + (rb - ra) * t
            if math.hypot(qx_ - cx_, qy_ - cy_) <= rr:
                s = ((qx_ - cx_) * nx + (qy_ - cy_) * ny) / max(rr, 0.5)
                P.put(x, y, mat, tone_fn(x, y, s, t), z)
                out.add((x, y))
    return out


def lit(base, gain=1.4):
    return lambda x, y, s, t: base + gain * s


def null_frame2(f):
    J = MS.NULL_POSES[f]
    W, H = 64, 96
    P = Paint(W, H)
    rng = random.Random(SEED + 900 + f)
    hd, ch, pv = J["head"], J["chest"], J["pelvis"]
    mode = J["mode"]
    d = unit((ch[0] - pv[0], ch[1] - pv[1]))  # spine, pelvis -> chest
    n = (-d[1], d[0])
    if n[0] < 0:
        n = (-n[0], -n[1])  # n points forward (right)

    # --- the hooded cloak, flowing behind (z 0)
    fl = J["flow"]
    A = (J["sn"][0] + 1, J["sn"][1] - 3)
    B = (J["sf"][0] - 3, J["sf"][1] - 2)
    C = (pv[0] - 12 + fl[0], pv[1] + 19 + fl[1])
    D = (pv[0] - 1 + fl[0] * 0.4, pv[1] + 13 + fl[1] * 0.5)
    hem = []
    for i in range(10):  # tattered hem: points alternate long / short
        p = lerp(C, D, i / 9)
        hem.append((p[0], p[1] + (3.2 if i % 2 else 0) + (1.5 if i % 3 == 0 else 0)))
    cloak = poly(W, H, [A, (hd[0] - 6, hd[1] + 1), B] + hem + [D])
    cl = dome(pv[0] - 6, pv[1] - 8, 16, 24)
    P.fill(cloak, NCLOAK, lambda x, y: 0.5 + 3.2 * cl(x, y), z=0)
    for (x, y) in sorted(cloak):  # violet lining along the inner edge
        if (x + 1, y) not in cloak and (x + 2, y) not in cloak and y > ch[1]:
            P.put(x, y, NLINING, 1.0, 0)
    for k in range(3):  # folds running down the cloak
        a_ = lerp(B, A, 0.25 + 0.25 * k)
        b_ = hem[2 + 3 * k]
        P.shift(set(line(a_[0], a_[1] + 3, b_[0], b_[1] - 2)), -1.0, only={NCLOAK})

    # --- far arm and far blade (z 1, 1.5), far leg (z 2)
    sf, ef, hf = J["sf"], J["ef"], J["hf"]
    capsule(P, sf, ef, 2.1, 1.8, NSUIT, lit(1.6), 1)
    capsule(P, ef, hf, 1.9, 1.5, NARMOR, lit(1.9), 1)  # bracer
    capsule(P, hf, hf, 1.7, 1.7, NSUIT, lit(1.6), 1)
    hip_f = (pv[0] - 2.5, pv[1] + 2)
    capsule(P, hip_f, J["kf"], 3.0, 2.4, NSUIT, lit(1.5), 2)
    capsule(P, J["kf"], J["ff"], 2.3, 1.6, NSUIT, lit(1.5), 2)
    capsule(P, lerp(J["kf"], J["ff"], 0.12), lerp(J["kf"], J["ff"], 0.7), 2.1, 1.7, NARMOR, lit(1.8), 2.1)
    null_foot(P, J["ff"], 1.0, 2.2)

    # --- torso (z 3): suit, chest plate, belt, bandolier, glowing seam
    up = 3.0
    waist = lerp(pv, ch, 0.38)
    tp = [(ch[0] + n[0] * 7 + d[0] * up, ch[1] + n[1] * 7 + d[1] * up),
          (ch[0] - n[0] * 6.5 + d[0] * up, ch[1] - n[1] * 6.5 + d[1] * up),
          (waist[0] - n[0] * 4.2, waist[1] - n[1] * 4.2),
          (pv[0] - n[0] * 5 - d[0] * 2.5, pv[1] - n[1] * 5 - d[1] * 2.5),
          (pv[0] + n[0] * 5 - d[0] * 2.5, pv[1] + n[1] * 5 - d[1] * 2.5),
          (waist[0] + n[0] * 4.4, waist[1] + n[1] * 4.4)]
    torso = poly(W, H, tp)

    def across(x, y):
        return ((x + 0.5 - ch[0]) * n[0] + (y + 0.5 - ch[1]) * n[1]) / 6.5
    P.fill(torso, NSUIT, lambda x, y: 2.5 - 1.3 * across(x, y), z=3)
    plate = poly(W, H, [(ch[0] + n[0] * 6 + d[0] * 1.5, ch[1] + n[1] * 6 + d[1] * 1.5),
                        (ch[0] - n[0] * 5 + d[0] * 1.5, ch[1] - n[1] * 5 + d[1] * 1.5),
                        (ch[0] - n[0] * 4 - d[0] * 7, ch[1] - n[1] * 4 - d[1] * 7),
                        (ch[0] + n[0] * 4.5 - d[0] * 8, ch[1] + n[1] * 4.5 - d[1] * 8)])
    P.fill(plate, NARMOR, lambda x, y: 3.2 - 1.4 * across(x, y), z=3.2)
    P.shift({(x, y) for (x, y) in plate if (x, y - 1) not in plate}, 1.2, only={NARMOR})  # lit top edge
    for k in (3.5, 6):  # plate segments
        a_ = (ch[0] - d[0] * k, ch[1] - d[1] * k)
        P.shift(set(line(a_[0] - n[0] * 4, a_[1] - n[1] * 4, a_[0] + n[0] * 4, a_[1] + n[1] * 4)), -1.0,
                only={NARMOR})
    belt_c = lerp(pv, ch, 0.12)
    belt = set(thick(line(belt_c[0] - n[0] * 5, belt_c[1] - n[1] * 5, belt_c[0] + n[0] * 5, belt_c[1] + n[1] * 5), 0.8))
    P.fill({p for p in belt if p in torso}, NARMOR, 1.6, z=3.3)
    P.fill({(int(belt_c[0] + n[0] * 1.5), int(belt_c[1] + n[1] * 1.5))}, NGLOW, 3.0, z=3.4)
    # the glowing seam down the front, broken where the plate sits
    s0 = (ch[0] + n[0] * 2.5 - d[0] * 8.5, ch[1] + n[1] * 2.5 - d[1] * 8.5)
    s1 = (pv[0] + n[0] * 3 + d[0] * 1.5, pv[1] + n[1] * 3 + d[1] * 1.5)
    P.fill({p for p in line(*s0, *s1) if p in torso and p not in belt}, NGLOW, 1.5, z=3.4)
    # a shuriken bandolier across the chest
    b0 = (J["sn"][0] - 0.5, J["sn"][1] + 0.5)
    b1 = (pv[0] - n[0] * 4 + d[0] * 5, pv[1] - n[1] * 4 + d[1] * 5)
    strap = {p for p in line(*b0, *b1) if p in torso}
    P.fill(strap, NARMOR, 1.2, z=3.5)
    for t in (0.3, 0.62):
        q = lerp(b0, b1, t)
        x, y = int(round(q[0])), int(round(q[1]))
        P.fill({(x, y)}, NSTEEL, 2.4, z=3.6)
        P.fill({(x + 1, y + 1), (x - 1, y - 1)}, NSTEEL, 1.0, z=3.6)

    # --- near leg (z 4): thigh, knee pad, shin guard, boot
    hip_n = (pv[0] + 2.5, pv[1] + 2)
    capsule(P, hip_n, J["kn"], 3.1, 2.5, NSUIT, lit(2.4), 4)
    capsule(P, J["kn"], J["fn"], 2.4, 1.7, NSUIT, lit(2.4), 4)
    capsule(P, lerp(J["kn"], J["fn"], 0.1), lerp(J["kn"], J["fn"], 0.72), 2.2, 1.8, NARMOR, lit(3.0), 4.1)
    capsule(P, J["kn"], J["kn"], 2.3, 2.3, NARMOR, lit(3.4), 4.2)
    null_foot(P, J["fn"], 2.2, 4.2)

    # --- head (z 5): hood, faceplate, the empty-set sign
    hood = ellipse(hd[0] - 0.8, hd[1] - 0.2, 5.6, 6.4, W, H)
    hood |= poly(W, H, [(hd[0] - 4, hd[1] - 3.5), (hd[0] - 8.5, hd[1] + 3.5), (hd[0] - 3, hd[1] + 5.5)])  # the hood's tail
    hood |= poly(W, H, [(hd[0] - 3, hd[1] + 3), (hd[0] + 4, hd[1] + 4), (ch[0] + 4, ch[1] - 1), (ch[0] - 5, ch[1] - 1)])
    hdl = dome(hd[0] - 1.5, hd[1] - 1.5, 7, 8)
    P.fill(hood, NCLOAK, lambda x, y: 0.4 + 3.8 * hdl(x, y), z=5)
    face = ellipse(hd[0] + 1.9, hd[1] + 0.9, 3.1, 4.1, W, H)
    P.fill(face, NMASK, lambda x, y: 1.0 + 1.6 * max(0.0, 1 - math.hypot(x + 0.5 - hd[0] - 0.8, y + 0.5 - hd[1] + 1.4) / 3),
           z=5.5)
    P.fill({(int(hd[0]) + 1, int(hd[1]) - 2), (int(hd[0]) + 2, int(hd[1]) - 3)}, NMASK, 5.0, z=5.6)  # gloss
    sym = 1 if mode not in ("hurt", "defeated") else 0
    cx_, cy_ = int(round(hd[0] + 2.2)), int(round(hd[1] + 1.0))
    ring = [(-1, -2), (0, -2), (1, -2), (-2, -1), (2, -1), (-2, 0), (2, 0), (-2, 1), (2, 1), (-1, 2), (0, 2), (1, 2)]
    P.fill({(cx_ + a, cy_ + b) for a, b in ring}, NGLOW, 1.5 + sym, z=5.7)
    P.fill({(cx_ + k, cy_ - k) for k in range(-3, 4)}, NGLOW, 2.5 + 1.5 * sym, z=5.8)

    # --- near arm (z 6): pauldron, bracer, fist
    sn, en, hn = J["sn"], J["en"], J["hn"]
    capsule(P, sn, en, 2.2, 1.9, NSUIT, lit(2.6), 6)
    capsule(P, en, hn, 2.0, 1.6, NARMOR, lit(3.2), 6.1)
    capsule(P, hn, hn, 1.8, 1.8, NSUIT, lit(2.8), 6.2)
    pa = (sn[0] - 0.5, sn[1] - 0.5)
    pauldron = ellipse(pa[0], pa[1], 3.3, 2.7, W, H)
    P.fill(pauldron, NARMOR, lambda x, y: 2.4 + 2.2 * dome(pa[0] - 1, pa[1] - 1, 3.6, 3.2)(x, y), z=6.3)
    P.shift({(x, y) for (x, y) in pauldron if y == int(pa[1]) + 1}, -1.2, only={NARMOR})

    # --- energy blades: the far one behind the body, the near one in front
    for hand, ang, z in ((hf, J["bf"], 1.5), (hn, J["bn"], 7)):
        if ang is None:
            continue
        dv = (math.cos(math.radians(ang)), math.sin(math.radians(ang)))
        P.fill(set(line(hand[0], hand[1], hand[0] + dv[0] * 2.5, hand[1] + dv[1] * 2.5)), NARMOR, 0.5, z=z)
        a_ = (hand[0] + dv[0] * 2.5, hand[1] + dv[1] * 2.5)
        b_ = (hand[0] + dv[0] * 14, hand[1] + dv[1] * 14)
        capsule(P, a_, b_, 1.3, 0.5, NGLOW, lambda x, y, s, t: 2.6 + 1.4 * (abs(s) < 0.45) - 0.8 * t, z)

    # --- effects baked into a few frames
    kind = J["fx"]
    if kind == "slash":
        for y in range(H):
            for x in range(W):
                dd = math.hypot(x + 0.5 - 38, y + 0.5 - 46)
                a = math.degrees(math.atan2(y + 0.5 - 46, x + 0.5 - 38))
                if -80 <= a <= 50 and 16.6 <= dd <= 21 and not P.get(x, y):
                    P.put(x, y, NGLOW, 4.0 if dd < 17.8 else 3.0 if dd < 19.2 else 1.6 - (a + 80) / 130, 8)
    elif kind == "throw":
        hx_, hy_ = hn
        for a, dist in ((-24, 9), (-4, 12), (16, 9)):
            sx = int(round(hx_ + dist * math.cos(math.radians(a))))
            sy = int(round(hy_ + dist * math.sin(math.radians(a))))
            P.fill({(sx, sy)}, NSTEEL, 3.0, z=8)
            P.fill({(sx + 1, sy), (sx - 1, sy), (sx, sy + 1), (sx, sy - 1)}, NSTEEL, 2.0, z=8)
            P.fill({(sx + 2, sy - 1), (sx - 2, sy + 1), (sx + 1, sy + 2), (sx - 1, sy - 2)}, NSTEEL, 1.0, z=8)
            for k in range(3, 6):
                P.fill({(sx - k, sy - int(round(k * math.sin(math.radians(a)))))}, NGLOW, 0.0, z=8)
    elif kind == "rail":
        hx_, hy_ = int(hn[0]), int(hn[1])
        P.fill({(x, y) for x in range(hx_ - 1, hx_ + 9) for y in (hy_ - 1, hy_)}, NARMOR, 3.0, z=8)
        P.fill({(x, hy_ - 1) for x in range(hx_, hx_ + 8)}, NARMOR, 4.2, z=8)
        P.fill({(hx_ + 1, hy_ + 1), (hx_ + 1, hy_ + 2)}, NARMOR, 1.0, z=8)
        P.fill({(hx_ + 3, hy_), (hx_ + 5, hy_)}, NGLOW, 3.0, z=8.1)
        mx, my = hx_ + 10, hy_
        P.fill(ellipse(mx + 0.5, my, 2.2, 2.2, W, H), NCYAN, 1.0, z=8)
        P.fill({(mx, my), (mx, my - 1), (mx + 1, my), (mx - 1, my), (mx, my + 1)}, NCYAN, 3.0, z=8.1)

    im = P.finish(VIOLET, rim_from=0.45)
    # feet on row 94: move the solid figure so its lowest pixel sits there
    low = max(y for y in range(H) for x in range(W) if im.getpixel((x, y))[3] > 200)
    if low != 94:
        moved = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        moved.paste(im, (0, 94 - low))
        im = moved
    return null_glitch(im, mode, rng)


def null_foot(P, F, tone, z):
    """A split-toe boot, toe forward (right)."""
    fx_, fy_ = F
    boot = poly(64, 96, [(fx_ - 2.6, fy_ - 1.4), (fx_ + 2.2, fy_ - 1.2), (fx_ + 6.2, fy_ + 2.2), (fx_ + 6, fy_ + 3.2),
                         (fx_ - 2.6, fy_ + 3.2)])
    P.fill(boot, NSUIT, lambda x, y: tone + (0.8 if y < fy_ + 1 else 0), z=z)
    P.fill({(int(fx_ + 3), int(fy_ + 2)), (int(fx_ + 3), int(fy_ + 3))}, NSUIT, 0.0, z=z)


GLITCH_COLS = [(156, 77, 255), (217, 181, 255), (25, 245, 255), (92, 37, 173)]


def null_glitch(im, mode, rng):
    """Clean glitch styling: an RGB-split scan row or two, pixels shed from the
    cloak's hem, and the dissolve / reassembly frames."""
    W, H = im.size
    src = im.load()
    solid = [[src[x, y][3] > 0 for x in range(W)] for y in range(H)]
    rows = [y for y in range(H) if any(solid[y])]
    top = rows[0] if rows else 0
    out = im.copy()
    px = out.load()

    def put(x, y, col, a=255):
        if 0 <= x < W and 0 <= y < H and px[x, y][3] < a:
            px[x, y] = col + (a,)
    if mode in ("blink_out", "blink_in", "defeated"):
        out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        px = out.load()
        for y in rows:
            t = (y - top) / max(1, 94 - top)
            frac = {"blink_out": 0.08 + 0.75 * t, "blink_in": 0.6 - 0.5 * t, "defeated": 0.1}[mode]
            if mode == "blink_in":
                frac = 0.05 + 0.5 * (1 - t) ** 1.5
            shift = rng.choice((-3, -2, 2, 3)) if rng.random() < 0.22 else 0
            for x in range(W):
                if not solid[y][x]:
                    continue
                keep = rng.random() > frac or (y >= 92 and rng.random() < 0.5)
                if keep:
                    if 0 <= x + shift < W:
                        px[x + shift, y] = src[x, y]
                elif rng.random() < 0.3:
                    ox = x + rng.randint(-6, 6) + (3 if mode == "blink_out" else 0)
                    oy = y - rng.randint(2, 11) if mode != "blink_in" else y + rng.randint(-4, 4)
                    col = rng.choice(GLITCH_COLS)
                    put(ox, oy, col)
                    if rng.random() < 0.5:
                        put(ox + 1, oy, col)
        if mode == "blink_in":  # streams of pixels converging on the body
            for k in range(10):
                a = rng.uniform(0, 2 * math.pi)
                r0 = rng.uniform(18, 26)
                for i in range(0, 8, 2):
                    put(int(round(34 + (r0 - i) * math.cos(a))), int(round(60 + (r0 - i) * math.sin(a) * 1.4)),
                        GLITCH_COLS[2] if i > 4 else GLITCH_COLS[0])
        return out
    # a split scan row: the row slides a pixel, cyan leading, magenta trailing
    for y in rng.sample(rows[8:-8], 2 if mode == "hurt" else 1):
        xs = [x for x in range(W) if solid[y][x]]
        if not xs:
            continue
        x0, x1 = xs[0], xs[-1]
        sh = 2 if mode == "hurt" else 1
        for x in range(x1, x0 - 1, -1):
            if 0 <= x + sh < W:
                px[x + sh, y] = src[x, y]
        for k in range(sh):
            put(x1 + sh - k, y, (25, 245, 255), 230)
            px[x0 + k, y] = (255, 47, 140, 200)
    # pixels shed from the lowest edge of the cloak and the trailing side
    for _ in range(14 if mode == "hurt" else 7):
        y = rng.randint(top + 20, 90)
        xs = [x for x in range(W) if solid[y][x]]
        if not xs:
            continue
        x = xs[0] - rng.randint(1, 5)
        put(x, y - rng.randint(0, 3), rng.choice(GLITCH_COLS), 220)
    return out


def make_null2():
    sheet = Image.new("RGBA", (64 * 14, 96), (0, 0, 0, 0))
    for f in range(14):
        sheet.paste(null_frame2(f), (f * 64, 0))
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
        "legend-bust.png": make_legend_bust(),
        "null2.png": make_null2(),
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
