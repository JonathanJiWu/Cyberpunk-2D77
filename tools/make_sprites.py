#!/usr/bin/env python3
"""
Pixel-art sprite generator for Cyberpunk 2D77.

Every sprite sheet in img/ that this script writes is drawn from code: small
ASCII pixel maps plus a few shape helpers (ellipses, polygons, lines) that
paint palette characters onto a grid. Nothing is loaded from disk and all
randomness comes from fixed seeds, so re-running the script always produces
byte-identical PNGs.

Usage:
    python3 tools/make_sprites.py                 # writes the PNGs into img/
    python3 tools/make_sprites.py --preview x.png # also writes a 4x contact sheet

Sheets (frames are laid out left to right):
    drone.png        128x32   4 frames of 32x32   hovering security drone
    crawler.png      160x28   4 frames of 40x28   robotic glitch crawler
    pickups.png      128x16   8 cells of 16x16
    icons.png        288x24   12 upgrade icons of 24x24
    projectiles.png   64x16   4 cells of 16x16
    platform.png      96x16   left cap, tiling middle, right cap (32x16 each)
    crate.png         64x32   intact / damaged (32x32 each)
    skyline.png      480x200  seamless distant skyline
    ground.png        64x48   seamless street tile

Easter eggs:
    hologram.png      96x96   2 frames of 48x96   giant holographic ad figure
    dove.png          64x16   4 frames of 16x16   white dove, wing-flap cycle
    secrets.png      192x24   8 secret icons of 24x24 (same badge as icons.png)
    terminal.png      48x40   2 frames of 24x40   data terminal: active / breached
    moon.png          64x64   big pale moon
    katana.png        40x12   katana, blade pointing right
    ripperdoc.png     64x72   street-clinic booth front
"""

import argparse
import math
import os
import random

from PIL import Image, ImageDraw, ImageFont

SEED = 2077
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "img")

# --------------------------------------------------------------- palette ---
# One character per colour so sprites can be written as ASCII maps.
PAL = {
    ".": None,  # transparent
    "K": "#0b0416",  # outline
    "P": "#1a0b2e",  # deep purple
    "1": "#2a2440",  # dark metal
    "2": "#3d3560",  # metal
    "3": "#5a4f86",  # light metal
    "4": "#8a80c0",  # metal highlight
    "5": "#cdc8ef",  # silver
    "W": "#ffffff",  # highlight white
    "C": "#19f5ff",  # cyan
    "c": "#0e9fc6",  # cyan shade
    "e": "#0b5578",  # cyan deep
    "B": "#b5fcff",  # cyan pale
    "M": "#ff2fd6",  # magenta
    "m": "#a8189c",  # magenta shade
    "n": "#5a0e5e",  # magenta deep
    "N": "#ffa6f0",  # pink pale
    "O": "#ff9b21",  # orange
    "o": "#c2510f",  # orange shade
    "a": "#ffc56e",  # orange light
    "Y": "#ffe14d",  # yellow
    "y": "#fff6b8",  # yellow pale
    "R": "#ff2457",  # red
    "r": "#a6113e",  # red shade
    "q": "#5c0a2b",  # red deep
    "p": "#ff86ac",  # pink
    "V": "#9c4dff",  # violet
    "v": "#5c25ad",  # violet shade
    "w": "#34135f",  # violet deep
    "u": "#d0a6ff",  # violet pale
    "U": "#3f7cff",  # blue
    "b": "#2140a6",  # blue shade
    # easter-egg extras
    "G": "#39ff8a",  # neon green
    "i": "#169a5c",  # green shade
    "z": "#0b3b2c",  # green deep (screen)
    "x": "#8a86a8",  # soft grey outline (dove)
    "s": "#dcd8ef",  # pale grey
    "t": "#b3aed0",  # grey shade
    "L": "#f3efff",  # moon light
    "l": "#d6cdf2",  # moon base
    "d": "#b5abdc",  # moon shade
    # translucent glows: never outlined, never count as solid
    "g": ("#19f5ff", 110),
    "h": ("#ff2fd6", 70),
    "f": ("#39ff8a", 80),
}
GLOW = {"g", "h", "f"}
OUTLINE = "K"


def rgba(spec):
    if spec is None:
        return (0, 0, 0, 0)
    alpha = 255
    if isinstance(spec, tuple):
        spec, alpha = spec
    s = spec.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), alpha)


RGBA = {k: rgba(v) for k, v in PAL.items()}

N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))


# ------------------------------------------------------------------ grid ---
class Grid:
    """A w x h canvas of palette characters ('.' = transparent)."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [["."] * w for _ in range(h)]
        self.outlined = False

    @classmethod
    def ascii(cls, rows):
        rows = list(rows)
        w = len(rows[0])
        bad = [r for r in rows if len(r) != w]
        assert not bad, "ragged ascii map:\n" + "\n".join(rows)
        g = cls(w, len(rows))
        for y, r in enumerate(rows):
            for x, ch in enumerate(r):
                assert ch in PAL, "unknown palette char %r" % ch
            g.px[y] = list(r)
        return g

    def copy(self):
        g = Grid(self.w, self.h)
        g.px = [row[:] for row in self.px]
        return g

    def inb(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def get(self, x, y):
        return self.px[y][x] if self.inb(x, y) else "."

    def set(self, x, y, ch):
        if ch is not None and self.inb(x, y):
            self.px[y][x] = ch

    def solid(self, x, y):
        ch = self.get(x, y)
        return ch != "." and ch not in GLOW

    def rect(self, x0, y0, x1, y1, ch):
        for y in range(min(y0, y1), max(y0, y1) + 1):
            for x in range(min(x0, x1), max(x0, x1) + 1):
                self.set(x, y, ch)

    def hline(self, x0, x1, y, ch):
        self.rect(x0, y, x1, y, ch)

    def vline(self, x, y0, y1, ch):
        self.rect(x, y0, x, y1, ch)

    def fill(self, pts, ch):
        for x, y in pts:
            self.set(x, y, ch)

    def line(self, x0, y0, x1, y1, ch):
        self.fill(line_pts(x0, y0, x1, y1), ch)

    def blit(self, other, ox=0, oy=0):
        for y in range(other.h):
            for x in range(other.w):
                ch = other.px[y][x]
                if ch != ".":
                    self.set(x + ox, y + oy, ch)
        return self

    def outline(self, ch=OUTLINE, diag=False):
        nbs = N8 if diag else N4
        marks = []
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x] == "." and any(self.solid(x + dx, y + dy) for dx, dy in nbs):
                    marks.append((x, y))
        for x, y in marks:
            self.px[y][x] = ch
        return self

    def padded(self, n=1):
        g = Grid(self.w + 2 * n, self.h + 2 * n)
        return g.blit(self, n, n)

    def flipped(self):
        g = Grid(self.w, self.h)
        g.px = [row[::-1] for row in self.px]
        return g

    def recolor(self, mapping):
        for row in self.px:
            for i, ch in enumerate(row):
                if ch in mapping:
                    row[i] = mapping[ch]
        return self

    def solid_pts(self):
        return {(x, y) for y in range(self.h) for x in range(self.w) if self.solid(x, y)}

    def image(self):
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        im.putdata([RGBA[ch] for row in self.px for ch in row])
        return im


def sprite(rows_or_grid, diag=False):
    """Pad by one pixel and add the 1px dark outline (unless already done)."""
    g = rows_or_grid if isinstance(rows_or_grid, Grid) else Grid.ascii(rows_or_grid)
    if g.outlined:
        return g
    out = g.padded(1).outline(diag=diag)
    out.outlined = True
    return out


def stack(w, h, *layers, pad=0):
    """Compose already-positioned layers; each one is outlined on its own so
    overlapping parts keep a dark separating line. pad grows the canvas so the
    outer outline has room."""
    out = Grid(w + 2 * pad, h + 2 * pad)
    for layer in layers:
        out.blit(layer.padded(pad).outline() if pad else layer.copy().outline())
    out.outlined = True
    return out


def place_center(dst, g, x0, y0, cw, ch, dx=0, dy=0):
    dst.alpha_composite(g.image(), (x0 + (cw - g.w) // 2 + dx, y0 + (ch - g.h) // 2 + dy))


# ---------------------------------------------------------------- shapes ---
def line_pts(x0, y0, x1, y1):
    x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    pts = []
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


def thick_pts(pts, r):
    out = set()
    ri = int(math.ceil(r))
    for x, y in pts:
        for dy in range(-ri, ri + 1):
            for dx in range(-ri, ri + 1):
                if dx * dx + dy * dy <= r * r:
                    out.add((x + dx, y + dy))
    return out


def ellipse_pts(cx, cy, rx, ry, p=2.0):
    pts = set()
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            u = abs((x + 0.5 - cx) / rx)
            v = abs((y + 0.5 - cy) / ry)
            if u ** p + v ** p <= 1.0:
                pts.add((x, y))
    return pts


def point_in_poly(px_, py_, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py_) != (yj > py_):
            if px_ < (xj - xi) * (py_ - yi) / (yj - yi) + xi:
                inside = not inside
        j = i
    return inside


def poly_pts(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    pts = set()
    for y in range(int(math.floor(min(ys))) - 1, int(math.ceil(max(ys))) + 1):
        for x in range(int(math.floor(min(xs))) - 1, int(math.ceil(max(xs))) + 1):
            if point_in_poly(x + 0.5, y + 0.5, poly):
                pts.add((x, y))
    return pts


def edge_pts(pts, dirs):
    return {(x, y) for (x, y) in pts if any((x + dx, y + dy) not in pts for dx, dy in dirs)}


def shade_rim(g, pts, base, light=None, dark=None,
              ldirs=((-1, 0), (0, -1)), ddirs=((1, 0), (0, 1)), light_wins=True):
    lit = edge_pts(pts, ldirs) if light else set()
    drk = edge_pts(pts, ddirs) if dark else set()
    for p in pts:
        ch = base
        if light_wins:
            if p in drk:
                ch = dark
            if p in lit:
                ch = light
        else:
            if p in lit:
                ch = light
            if p in drk:
                ch = dark
        g.set(p[0], p[1], ch)


def shade_sphere(g, cx, cy, r, ramp, light=(-0.55, -0.7, 0.45), ry=None, lo=-0.35, pts=None):
    """Quantised lambert shading of a sphere / ellipsoid onto a palette ramp."""
    ry = ry or r
    ln = math.sqrt(sum(c * c for c in light))
    lx, ly, lz = (c / ln for c in light)
    pts = pts if pts is not None else ellipse_pts(cx, cy, r, ry)
    for (x, y) in pts:
        nx = (x + 0.5 - cx) / r
        ny = (y + 0.5 - cy) / ry
        nz = math.sqrt(max(0.0, 1.0 - nx * nx - ny * ny))
        l = nx * lx + ny * ly + nz * lz
        t = (l - lo) / (1.0 - lo)
        i = max(0, min(len(ramp) - 1, int(t * len(ramp))))
        g.set(x, y, ramp[i])
    return pts


def flame_pts(cx, base, radius, height, sway=0.0, k=1.4):
    """Tear-drop flame: round bottom of `radius`, tip `height` above `base`."""
    pts = set()
    y0 = base - radius
    for y in range(int(base - height) - 1, int(base) + 1):
        yc = y + 0.5
        if yc > y0:
            d = radius * radius - (yc - y0) ** 2
            if d <= 0:
                continue
            hw, mx = math.sqrt(d), cx
        else:
            s = (y0 - yc) / max(0.01, height - radius)
            if s >= 1:
                continue
            hw = radius * (1 - s) ** k
            mx = cx + sway * s * s
        for x in range(int(mx - hw) - 1, int(mx + hw) + 2):
            if abs(x + 0.5 - mx) <= hw:
                pts.add((x, y))
    return pts


def heart_pts(cx, cy, s, sy=None):
    sy = sy or s
    pts = set()
    for y in range(int(cy - 1.4 * sy) - 1, int(cy + 1.4 * sy) + 2):
        for x in range(int(cx - 1.3 * s) - 1, int(cx + 1.3 * s) + 2):
            X = (x + 0.5 - cx) / s
            Y = -(y + 0.5 - cy) / sy
            if (X * X + Y * Y - 1) ** 3 - X * X * Y ** 3 <= 0:
                pts.add((x, y))
    return pts


# =================================================================== DRONE ===
def drone_frame(f):
    oy = (0, 1, 1, 0)[f]
    cx, cy, rx, ry = 16.0, 13.5 + oy, 12.0, 9.0

    # back layer: antenna + tail fin
    back = Grid(32, 32)
    fin = poly_pts([(3, 6 + oy), (10, 8 + oy), (10, 13 + oy), (6, 13 + oy)])
    shade_rim(back, fin, "2", light="3", dark="1")
    back.vline(10, 2 + oy, 6 + oy, "3")
    back.set(10, 1 + oy, "R" if f in (0, 1) else "r")

    # main hull
    body = Grid(32, 32)
    hull = ellipse_pts(cx, cy, rx, ry, p=2.6)
    for (x, y) in hull:
        u = (x + 0.5 - cx) / rx
        v = (y + 0.5 - cy) / ry
        t = -0.85 * v - 0.3 * u
        ch = "4" if t > 0.62 else "3" if t > 0.2 else "2" if t > -0.3 else "1" if t > -0.72 else "P"
        body.set(x, y, ch)
    # bright top rim
    for (x, y) in edge_pts(hull, ((0, -1),)):
        if 9 <= x <= 20:
            body.set(x, y, "5" if 11 <= x <= 15 else "4")
    # equator seam with a scanning running light
    ys = int(cy + 2.5)
    xs = [x for (x, y) in hull if y == ys]
    for x in range(min(xs) + 1, max(xs)):
        body.set(x, ys, "K")
    for i, lx in enumerate((7, 10, 13, 16)):
        body.set(lx, ys, "C" if i == f else "e")
        body.set(lx + 1, ys, "B" if i == f else "e")
    # belly plate & cyan under-rim (reflected neon)
    for (x, y) in edge_pts(hull, ((0, 1),)):
        if 8 <= x <= 23:
            body.set(x, y, "e")
    # top-left vent slits
    for vx in (8, 10, 12):
        body.vline(vx, int(cy - 4), int(cy - 2), "2")

    # eye: socket bulges past the hull on the right
    eye = Grid(32, 32)
    ex, ey = 24.5, cy - 1
    sock = ellipse_pts(ex, ey, 4.2, 4.2)
    shade_rim(eye, sock, "P", light="2", dark="1", light_wins=False)
    lens = ellipse_pts(ex + 0.8, ey, 2.6, 2.6)
    eye.fill(lens, "R")
    for (x, y) in edge_pts(lens, ((1, 0), (0, 1))):
        eye.set(x, y, "r")
    glow = ("p", "R", "p", "W")[f]
    eye.set(int(ex + 0.8), int(ey) - 1, glow)
    eye.set(int(ex + 0.8) + 1, int(ey) - 1, "W")
    eye.set(int(ex + 0.8) + 1, int(ey) - 2, "p")

    # thruster nozzle (own layer, under the hull) + flickering flame
    jet = Grid(32, 32)
    nb = max(y for (_, y) in hull) + 1  # first row under the hull
    jet.hline(12, 19, nb - 1, "2")
    jet.hline(12, 19, nb, "2")
    jet.set(12, nb, "3")
    jet.set(19, nb, "1")
    jet.hline(13, 18, nb + 1, "1")
    jet.hline(14, 17, nb + 1, "O")
    jet.hline(15, 16, nb + 1, "Y")
    flame = DRONE_FLAMES[f]
    for i, row in enumerate(flame):
        for j, ch in enumerate(row):
            if ch != ".":
                jet.set(13 + j, nb + 2 + i, ch)

    return stack(32, 32, back, jet, body, eye)


# Thruster flame per frame (6 wide, starts right under the nozzle). Frames 1
# and 2 are bobbed 1px down, so they get the shorter flames.
DRONE_FLAMES = [
    [".yWWy.", ".YyyY.", ".OYYO.", "..OYO.", "..RO..", "...R.."],
    [".yWWy.", ".YyWY.", "..OYO.", "..R..."],
    [".yWWy.", ".YyyY.", ".OYYO.", "..OO..", "...R.."],
    [".yWWy.", ".OYYO.", "..RO.."],
]


def make_drone():
    sheet = Image.new("RGBA", (128, 32), (0, 0, 0, 0))
    for f in range(4):
        sheet.alpha_composite(drone_frame(f).image(), (f * 32, 0))
    return sheet


# ================================================================= CRAWLER ===
def ik_knee(hip, foot, l1, l2, prefer):
    """Two-bone IK; returns the knee on the side that minimises prefer * x."""
    dx, dy = foot[0] - hip[0], foot[1] - hip[1]
    d = max(0.01, min(math.hypot(dx, dy), l1 + l2 - 0.01))
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    mx, my = hip[0] + a * dx / d, hip[1] + a * dy / d
    k1 = (mx + h * dy / d, my - h * dx / d)
    k2 = (mx - h * dy / d, my + h * dx / d)
    return min((k1, k2), key=lambda k: prefer * k[0])


def brush(pts, offsets):
    return {(x + dx, y + dy) for (x, y) in pts for (dx, dy) in offsets}


SQ2 = ((0, 0), (1, 0), (0, 1), (1, 1))


def crawler_leg(g, hip, foot, side, near):
    """side -1: knee bends backwards (rear legs), +1: forwards (front legs)."""
    knee = ik_knee(hip, foot, 8.0, 9.5, -side)
    hi, kn, ft = [(int(round(p[0])), int(round(p[1]))) for p in (hip, knee, foot)]
    off = 0 if side > 0 else -1
    upper = brush(line_pts(*hi, *kn), [(dx + off, dy) for dx, dy in SQ2])
    lower = brush(line_pts(kn[0], kn[1], ft[0], ft[1] - 1), [(off, 0), (off + 1, 0)])
    if near:
        shade_rim(g, upper, "3", light="4", dark="2")
        shade_rim(g, lower, "2", light="4", dark="1", ldirs=((-1, 0),), ddirs=((1, 0),))
    else:
        shade_rim(g, upper, "1", light="2", dark="P")
        shade_rim(g, lower, "1", light="2", dark="P", ldirs=((-1, 0),), ddirs=((1, 0),))
    # knee servo
    kx, ky = kn[0] + off, kn[1]
    g.rect(kx, ky, kx + 1, ky + 1, "4" if near else "2")
    g.set(kx, ky, "5" if near else "3")
    if near:
        g.set(kx + 1, ky + 1, "M")
    # pointed foot claw
    fx = ft[0] + off
    g.hline(fx, fx + 1, ft[1], "3" if near else "1")
    g.set(fx + (2 if side > 0 else -1), ft[1], "2" if near else "P")


def crawler_frame(f):
    W, H = 40, 28
    ground = 26  # lowest coloured row; its outline lands on y=27
    bob = (1, 0, 1, 0)[f]
    step = ((3, 0), (0, 0), (-3, 0), (0, -3))  # foot (dx, lift) per phase
    legs = [  # hip, foot base x, knee side, phase, near?
        ((16, 15), 11, -1, 2, False),
        ((26, 16), 33, +1, 0, False),
        ((13, 16), 7, -1, 0, True),
        ((24, 17), 31, +1, 2, True),
    ]
    far, near = Grid(W, H), Grid(W, H)
    for (hx, hy), fx, side, ph, is_near in legs:
        dx, lift = step[(f + ph) % 4]
        crawler_leg(near if is_near else far, (hx, hy + bob), (fx + dx, ground + lift), side, is_near)

    def shell(g, cx, cy, rx, ry, p=2.3):
        pts = ellipse_pts(cx, cy, rx, ry, p)
        for (x, y) in pts:
            u = (x + 0.5 - cx) / rx
            v = (y + 0.5 - cy) / ry
            t = -0.9 * v - 0.25 * u
            g.set(x, y, "4" if t > 0.66 else "3" if t > 0.22 else "2" if t > -0.3 else
                  "1" if t > -0.72 else "P")
        return pts

    # tail: a data cable with a glitching tip light
    tail = Grid(W, H)
    for i, (tx, ty) in enumerate([(5, 11), (4, 9), (3, 7), (3, 5)]):
        tail.rect(tx, ty + bob, tx + 1, ty + 1 + bob, "3" if i % 2 == 0 else "2")
    tail.set(3, 4 + bob, ("M", "C", "M", "W")[f])
    tail.set(4, 4 + bob, ("N", "B", "m", "C")[f])

    # abdomen (rear) with plates, vents and a magenta neon stripe
    abd = Grid(W, H)
    acx, acy = 13.0, 12.0 + bob
    apts = shell(abd, acx, acy, 9.0, 5.6)
    for sx in (9, 14):
        for (x, y) in apts:
            if x == sx and y < acy + 1:
                abd.set(x, y, "1")
    for (x, y) in apts:
        if y == int(acy + 2) and 6 <= x <= 20:
            abd.set(x, y, "m")
    for lx in (8, 12, 16, 20):
        abd.set(lx, int(acy + 2), "M")
    atop = {}
    for (x, y) in apts:
        atop[x] = min(atop.get(x, 99), y)
    for i, lx in enumerate((7, 11, 16)):
        abd.set(lx, atop[lx] + 1, "C" if i == f % 3 else "M")

    # thorax (front) - smaller, tilted forward
    thx = Grid(W, H)
    tpts = shell(thx, 24.5, 14.0 + bob, 6.0, 4.6)
    for (x, y) in tpts:
        if y == int(14.0 + bob + 2) and 20 <= x <= 28:
            thx.set(x, y, "m")
    thx.set(23, int(14.0 + bob + 2), "M")
    thx.set(26, int(14.0 + bob + 2), "M")

    # head: wedge skull, glowing magenta eye, snapping jaw
    head = Grid(W, H)
    hx, hy = 28, 9 + bob
    skull = poly_pts([(hx, hy + 2), (hx + 4, hy), (hx + 8, hy + 2), (hx + 10.5, hy + 5.5),
                      (hx + 8, hy + 8), (hx, hy + 8)])
    shade_rim(head, skull, "2", light="4", dark="1")
    for (x, y) in skull:
        if y == hy + 1 and x < hx + 6:
            head.set(x, y, "3")
    ex, ey = hx + 6, hy + 3
    head.rect(ex - 1, ey - 1, ex + 2, ey + 1, "n")
    head.rect(ex, ey, ex + 1, ey, "M")
    head.set(ex, ey - 1, "M")
    head.set(ex + 1, ey - 1, "N" if f % 2 else "M")
    head.set(ex, ey, "W")
    head.set(hx + 2, hy + 1, "C")
    jaw = Grid(W, H)
    jy = hy + 7 + (1 if f in (1, 3) else 0)
    jpts = poly_pts([(hx + 1, jy), (hx + 10, jy), (hx + 10.5, jy + 1.5), (hx + 7, jy + 2.5), (hx + 1, jy + 2.5)])
    shade_rim(jaw, jpts, "2", light="3", dark="1")
    for tx in (hx + 5, hx + 7, hx + 9):
        jaw.set(tx, jy - 1, "5")

    g = stack(W, H, far, tail, abd, thx, jaw, head, near)

    # glitch: displace one scanline of the body with an RGB split
    if f in (1, 3):
        gy = int(acy - 2) if f == 1 else int(acy + 1)
        shift = 2 if f == 1 else -2
        seg = [(x, g.get(x, gy)) for x in range(3, 28) if g.get(x, gy) != "."]
        for x, _ in seg:
            g.set(x, gy, ".")
        for x, ch in seg:
            g.set(x + shift, gy, ch)
        lo, hi = seg[0][0] + shift, seg[-1][0] + shift
        g.set(lo, gy, "C")
        g.set(lo + 1, gy, "B")
        g.set(hi, gy, "M")
        g.set(hi - 1, gy, "N")
        g.outline()  # re-close the silhouette around the displaced slice
    return g


def make_crawler():
    sheet = Image.new("RGBA", (160, 28), (0, 0, 0, 0))
    for f in range(4):
        sheet.alpha_composite(crawler_frame(f).image(), (f * 40, 0))
    return sheet


# ================================================================= PICKUPS ===
XP_SMALL = [
    "...BC...",
    "..BWCC..",
    ".BWBCCC.",
    "BBBBCCCC",
    "cccceeee",
    ".ccceee.",
    "..ccee..",
    "...ce...",
]

XP_BIG = [
    "..NNNMMMMm..",
    ".NWWNNMMMMm.",
    "NWNNNNMMMMmm",
    "NNNNNNMMMMmm",
    "MMMMMMmmmmnn",
    ".MMMMMmmmmn.",
    "..MMMMmmmn..",
    "...MMMmmn...",
    "....MMmn....",
    ".....Mn.....",
]

HEART = [
    "..pRR...RRR..",
    ".pWWRR.RRRRr.",
    "pWWpRRRRRRRRr",
    "ppRRRRRRRRRRr",
    "pRRRRRRRRRRrr",
    ".RRRRRRRRRRr.",
    "..RRRRRRRRr..",
    "...RRRRRRr...",
    "....RRRRr....",
    ".....RRr.....",
    "......r......",
]

HEAT_CELL = [
    "...545...",
    ".2344432.",
    "123333321",
    ".aOOOOOo.",
    ".a11111o.",
    ".a11R11o.",
    ".a1RO11o.",
    ".a1ROR1o.",
    ".a1OYO1o.",
    ".a1OWO1o.",
    ".a11111o.",
    ".aOOOOOo.",
    "123333321",
]


def pickup_bolt():
    g = Grid(11, 14)
    pts = poly_pts([(6, 0), (11, 0), (7.5, 5), (11, 5), (3, 14), (5, 8), (1, 8)])
    shade_rim(g, pts, "Y", light="y", dark="O")
    return g


def pickup_shield():
    g = Grid(13, 14)
    pts = poly_pts([(6.5, 0), (13, 3.2), (13, 10.2), (6.5, 14), (0, 10.2), (0, 3.2)])
    inner = {p for p in pts if p not in edge_pts(pts, N4)}
    for (x, y) in pts:
        g.set(x, y, "C" if x < 7 else "c")
    for (x, y) in inner:
        g.set(x, y, "U" if x < 6 else "b")
    for (x, y) in edge_pts(inner, ((-1, 0), (0, -1))):
        if x < 6:
            g.set(x, y, "B")
    # emblem: inner hex ring
    emb = poly_pts([(6.5, 3.5), (9.6, 5.2), (9.6, 8.8), (6.5, 10.5), (3.4, 8.8), (3.4, 5.2)])
    for (x, y) in edge_pts(emb, N4):
        g.set(x, y, "C" if x < 6 else "c")
    g.set(3, 3, "W")
    g.set(4, 3, "W")
    g.set(3, 4, "W")
    return g


def magnet_pts(w, h, arm, tip):
    """Horseshoe magnet opening downwards; returns (red pts, tip pts)."""
    r = w / 2.0
    outer = {(x, y) for x in range(w) for y in range(h)
             if (y + 0.5 >= r) or (x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 <= r * r}
    ri = r - arm
    inner = {(x, y) for x in range(w) for y in range(h)
             if abs(x + 0.5 - r) < ri and ((y + 0.5 >= r) or (x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 < ri * ri)}
    pts = outer - inner
    tips = {(x, y) for (x, y) in pts if y >= h - tip}
    return pts - tips, tips


def pickup_magnet():
    g = Grid(12, 12)
    red, tips = magnet_pts(12, 12, 4, 3)
    shade_rim(g, red, "R", light="p", dark="r")
    shade_rim(g, tips, "5", light="W", dark="4")
    for (x, y) in tips:
        if y == 12 - 3:
            g.set(x, y, "4" if x not in (0, 8) else "5")
    return g


def pickup_bomb():
    g = Grid(14, 14)
    shade_sphere(g, 5.5, 8.5, 5.2, ["w", "v", "V", "u"], lo=-0.45)
    g.set(3, 6, "W")
    g.set(4, 5, "W")
    # cyan EMP ring around the belly
    for x in range(1, 11):
        if g.get(x, 9) != ".":
            g.set(x, 9, "c" if x > 6 else "C")
    # cap + fuse + spark
    g.rect(7, 3, 9, 4, "2")
    g.hline(7, 9, 3, "3")
    g.set(9, 2, "3")
    g.set(10, 1, "4")
    g.set(12, 0, "Y")
    g.set(11, 1, "W")
    g.set(12, 1, "Y")
    g.set(11, 0, "O")
    g.set(13, 1, "O")
    g.set(12, 2, "O")
    g.set(10, 0, "Y")
    return g


def make_pickups():
    sheet = Image.new("RGBA", (128, 16), (0, 0, 0, 0))
    cells = [
        sprite(XP_SMALL),
        sprite(XP_BIG),
        sprite(HEART),
        sprite(HEAT_CELL),
        sprite(pickup_bolt()),
        sprite(pickup_shield()),
        sprite(pickup_magnet()),
        sprite(pickup_bomb()),
    ]
    for i, g in enumerate(cells):
        place_center(sheet, g, i * 16, 0, 16, 16)
    return sheet


# =================================================================== ICONS ===
def badge():
    g = Grid(24, 24)
    for y in range(24):
        for x in range(24):
            if min(x, 23 - x) + min(y, 23 - y) >= 2:
                g.set(x, y, "P")
    pts = g.solid_pts()
    for (x, y) in edge_pts(pts, N4):
        g.set(x, y, "3")
    return g


def icon_energy_ball():
    g = Grid(17, 17)
    shade_sphere(g, 8.5, 8.5, 6.2, ["b", "b", "U", "U", "C", "B"], lo=-0.45)
    # swirling plasma filament + hot core
    for (x, y) in [(4, 10), (5, 11), (6, 11), (7, 11), (8, 11), (9, 10), (10, 9), (11, 7), (11, 6)]:
        g.set(x, y, "C")
    for (x, y) in [(7, 7), (8, 7), (7, 8), (9, 8)]:
        g.set(x, y, "B")
    for (x, y) in [(5, 5), (6, 4), (5, 4), (4, 5)]:
        g.set(x, y, "W")
    # crackling arcs leaping off the orb
    for (x, y) in [(13, 3), (14, 3), (14, 2), (15, 1), (16, 1),
                   (1, 6), (0, 7), (1, 8), (0, 9),
                   (13, 14), (14, 15), (15, 15), (16, 16)]:
        g.set(x, y, "C")
    for (x, y) in [(16, 1), (0, 9), (16, 16)]:
        g.set(x, y, "B")
    return g

def icon_flame():
    g = Grid(16, 17)
    flames = [  # (cx, base, radius, height, sway)
        (8.0, 16.5, 5.6, 16.0, 1.6),
        (3.2, 16.5, 2.4, 8.0, -1.4),
        (12.8, 16.5, 2.4, 9.0, 1.4),
    ]
    for li, (ch, f_) in enumerate((("R", 1.0), ("O", 0.74), ("Y", 0.5), ("W", 0.26))):
        for (cx, base, r, h, s) in flames:
            if f_ * r < 1.0:
                continue
            g.fill(flame_pts(cx, base - (1 - f_) * r * 0.5, r * f_, h * f_, s * f_), ch)
    return g


def icon_orbit():
    g = Grid(17, 17)
    cx, cy = 8.5, 8.5
    th = math.radians(-32)
    ring = set()
    for i in range(160):
        t = 2 * math.pi * i / 160
        x = cx + 7.2 * math.cos(t) * math.cos(th) - 3.4 * math.sin(t) * math.sin(th)
        y = cy + 7.2 * math.cos(t) * math.sin(th) + 3.4 * math.sin(t) * math.cos(th)
        ring.add((int(x), int(y)))
    for (x, y) in ring:
        g.set(x, y, "v")
    shade_sphere(g, cx, cy, 2.6, ["c", "C", "B"])
    g.set(7, 7, "W")
    diamond = Grid.ascii([
        "..N..",
        ".NWM.",
        "NNMMm",
        ".Mmm.",
        "..m..",
    ])
    a = (cx + 7.2 * math.cos(th), cy + 7.2 * math.sin(th))
    b = (cx - 7.2 * math.cos(th), cy - 7.2 * math.sin(th))
    g.blit(diamond, int(a[0]) - 2, int(a[1]) - 2)
    g.blit(diamond, int(b[0]) - 2, int(b[1]) - 2)
    return g


def icon_missile():
    """Rocket on the up-right diagonal. a = along axis, s = across axis
    (pixels with a + s odd lie on the lattice)."""
    g = Grid(16, 16)
    fins = {-2: 3, -3: 4, -4: 4, -5: 4}
    exhaust = {-5: 1, -6: 1, -7: 2, -8: 1, -9: 1, -10: 0, -11: 0, -12: 1}
    for y in range(16):
        for x in range(16):
            a = x - y
            s = x + y - 15
            ch = None
            if 9 <= a <= 13 and abs(s) <= min(2, (13 - a + 1) // 2 + 1 if a > 10 else 2):
                ch = "N" if a == 13 else "p" if s < 0 else "R" if s == 0 else "r"
            elif -4 <= a <= 8 and abs(s) <= 2:
                ch = {-2: "5", -1: "5", 0: "4", 1: "3", 2: "2"}[s]
                if a in (5, 6):
                    ch = "C" if s < 1 else "c"
                if a == 1:
                    ch = "M" if s < 1 else "m"
                if a <= -3:
                    ch = "2" if s < 1 else "1"
            elif a in fins and 3 <= abs(s) <= fins[a]:
                ch = "M" if s < 0 else "m"
            elif a in exhaust and abs(s) <= exhaust[a]:
                ch = "W" if a >= -6 else "B" if a >= -8 else "C" if a >= -10 else "c"
            if ch:
                g.set(x, y, ch)
    return g


BOOT = [
    ".34444.....",
    ".23333.....",
    ".2CCCC.....",
    ".23333.....",
    ".233334....",
    ".2333334...",
    "123333334..",
    "1233333334.",
    "12333333334",
    "12222222223",
    "OOOOOOOOOOO",
    "11111111111",
]


def icon_stomp():
    W, H = 19, 17
    cx, cy, rx, ry = 9.0, 13.0, 8.8, 3.2
    ring = edge_pts(ellipse_pts(cx, cy, rx, ry), N4)
    back, front = Grid(W, H), Grid(W, H)
    for (x, y) in ring:
        (back if y + 0.5 < cy else front).set(x, y, "O" if y + 0.5 < cy else "Y")
    for (x, y) in ring:
        if y + 0.5 >= cy and abs(x + 0.5 - cx) < 4:
            front.set(x, y, "y")
    boot = Grid(W, H).blit(Grid.ascii(BOOT), 4, 1)
    debris = Grid(W, H)
    for (x, y) in [(1, 7), (2, 9), (17, 6), (16, 8)]:
        debris.set(x, y, "Y")
    return stack(W, H, back, debris, boot, front, pad=1)


def icon_chain():
    g = Grid(17, 17)
    path = [(2, 2), (8, 6), (5, 9), (11, 12), (14, 15)]
    core = set()
    for (a, b) in zip(path, path[1:]):
        core |= set(line_pts(*a, *b))
    halo = thick_pts(core, 1.0)
    g.fill(halo, "C")
    g.fill(core, "W")
    for (x, y) in edge_pts(halo, ((1, 0), (0, 1))):
        if (x, y) not in core:
            g.set(x, y, "c")
    # forked branch
    br = set(line_pts(8, 6, 13, 3))
    g.fill(thick_pts(br, 0.6), "c")
    g.fill(br, "B")
    for (x, y) in [(1, 1), (15, 16), (14, 2)]:
        g.set(x, y, "B")
    return g


def icon_cyber_heart():
    g = Grid(17, 15)
    pts = heart_pts(8.5, 7.4, 6.4, 6.4)
    shade_rim(g, pts, "R", light="p", dark="r")
    rim = edge_pts(pts, N4)
    # right half is a darker circuit-board plate behind a seam
    for (x, y) in pts:
        if x >= 9 and (x, y) not in rim:
            g.set(x, y, "r")
        if x == 8 and (x, y) not in rim:
            g.set(x, y, "q")
    traces = [[(10, 12), (10, 9), (13, 9), (13, 5)], [(10, 9), (10, 6)], [(12, 11), (14, 11)]]
    for tr in traces:
        for (a, b) in zip(tr, tr[1:]):
            g.line(*a, *b, "C")
    for (x, y) in [(13, 4), (10, 5), (14, 11), (14, 9)]:
        g.set(x, y, "W")
    g.set(4, 3, "W")
    g.set(3, 4, "W")
    g.set(4, 4, "N")
    g.set(5, 3, "N")
    return g


def icon_servo_leg():
    W, H = 17, 17
    lines = Grid(W, H)
    for (y, x0, x1) in [(4, 0, 3), (8, 0, 5), (12, 1, 4)]:
        lines.hline(x0, x1, y, "c")
        lines.set(x1, y, "C")
    hip, knee = (6.5, 2.5), (13.0, 8.5)
    # armoured thigh, wide at the hip and tapering to the knee, with servo joints
    dx, dy = knee[0] - hip[0], knee[1] - hip[1]
    ln = math.hypot(dx, dy)
    nx, ny = -dy / ln, dx / ln
    thigh = Grid(W, H)
    tp = poly_pts([(hip[0] + nx * 2.6, hip[1] + ny * 2.6), (knee[0] + nx * 1.7, knee[1] + ny * 1.7),
                   (knee[0] - nx * 1.7, knee[1] - ny * 1.7), (hip[0] - nx * 2.6, hip[1] - ny * 2.6)])
    shade_rim(thigh, tp, "3", light="4", dark="2")
    for (x, y) in line_pts(7, 4, 11, 8):
        thigh.set(x, y, "2")
    for (jx, jy), r in ((hip, 2.0), (knee, 1.7)):
        jp = ellipse_pts(jx, jy, r, r)
        shade_rim(thigh, jp, "4", light="5", dark="2")
        thigh.set(int(jx), int(jy), "C")
    # piston shin
    shin = Grid(W, H)
    sp = brush(line_pts(12, 9, 9, 12), SQ2)
    shade_rim(shin, sp, "2", light="5", dark="1")
    # blade foot
    foot = Grid(W, H)
    fp = poly_pts([(6, 12), (11, 12), (16.5, 14.6), (16.5, 16), (6, 16)])
    shade_rim(foot, fp, "3", light="4", dark="1")
    for x in range(6, 17):
        if (x, 15) in fp:
            foot.set(x, 15, "1")
    foot.set(15, 14, "C")
    return stack(W, H, lines, shin, foot, thigh, pad=1)


def icon_magnet_coil():
    g = Grid(18, 17)
    m = Grid(12, 12)
    red, tips = magnet_pts(12, 12, 4, 3)
    shade_rim(m, red, "R", light="p", dark="r")
    shade_rim(m, tips, "5", light="W", dark="4")
    for (x, y) in red:  # copper coil wraps on the arms
        if y in (6, 8) and (x <= 3 or x >= 8):
            m.set(x, y, "O" if x in (0, 1, 8, 9) else "o")
    g.blit(m, 3, 0)
    # field lines from the tips
    for (x, y) in [(1, 12), (0, 14), (1, 16), (16, 12), (17, 14), (16, 16),
                   (5, 14), (6, 15), (8, 16), (9, 16), (11, 15), (12, 14)]:
        g.set(x, y, "C")
    return g


ARMOR_LEFT = [
    "..3444..",
    ".34444..",
    "3444443.",
    "34433322",
    ".2333334",
    ".2C33343",
    "..2C3343",
    "..23C343",
    "..233C43",
    "..2333CW",
    "..123333",
    "...11111",
    "...23434",
    "...12323",
]


def icon_armor():
    left = Grid.ascii(ARMOR_LEFT)
    g = Grid(16, 14)
    g.blit(left, 0, 0)
    right = left.flipped().recolor({"4": "3", "3": "2", "2": "1", "W": "W", "C": "c"})
    for y in range(14):
        for x in range(8):
            ch = right.get(x, y)
            if ch != ".":
                g.set(8 + x, y, ch)
    g.set(7, 9, "W")
    g.set(8, 9, "W")
    g.set(7, 8, "C")
    g.set(8, 8, "C")
    g.set(7, 10, "C")
    g.set(8, 10, "c")
    return g


def icon_heat_sink():
    g = Grid(17, 16)
    g.rect(1, 12, 15, 15, "2")
    g.hline(1, 15, 12, "3")
    g.hline(1, 15, 15, "1")
    g.hline(3, 13, 14, "O")
    g.hline(5, 11, 14, "Y")
    for i, fx in enumerate(range(1, 16, 3)):
        top = 3 + (i % 2)
        g.rect(fx, top, fx + 1, 11, "3")
        g.vline(fx, top, 11, "4")
        g.set(fx, top, "5")
        if fx + 2 <= 15:
            g.vline(fx + 2, 6, 11, "o")
            g.vline(fx + 2, 9, 11, "O")
            g.set(fx + 2, 11, "Y")
    # heat shimmer
    for (x, y) in [(4, 1), (5, 0), (9, 2), (10, 1), (13, 1), (14, 0)]:
        g.set(x, y, "O")
    return g


def icon_overclock():
    g = Grid(17, 17)
    for i in range(3, 14, 2):  # pins
        for (x, y) in [(i, 0), (i, 1), (i, 15), (i, 16), (0, i), (1, i), (15, i), (16, i)]:
            g.set(x, y, "5" if (x < 2 or y < 2) else "4")
    g.rect(2, 2, 14, 14, "2")
    g.hline(2, 14, 2, "3")
    g.vline(2, 2, 14, "3")
    g.hline(2, 14, 14, "1")
    g.vline(14, 2, 14, "1")
    face = ellipse_pts(8.5, 8.5, 4.6, 4.6)
    g.fill(face, "P")
    for (x, y) in edge_pts(face, N4):
        g.set(x, y, "Y")
    for (x, y) in [(8, 5), (8, 6), (8, 7), (8, 8), (9, 8), (10, 7), (11, 6)]:
        g.set(x, y, "W")
    g.set(8, 8, "C")
    # speed arrow
    for (x, y) in [(12, 3), (13, 3), (13, 4)]:
        g.set(x, y, "C")
    return g


def make_icons():
    sheet = Image.new("RGBA", (288, 24), (0, 0, 0, 0))
    icons = [icon_energy_ball, icon_flame, icon_orbit, icon_missile, icon_stomp, icon_chain,
             icon_cyber_heart, icon_servo_leg, icon_magnet_coil, icon_armor, icon_heat_sink,
             icon_overclock]
    for i, fn in enumerate(icons):
        b = badge()
        ic = sprite(fn())
        b.blit(ic, (24 - ic.w) // 2, (24 - ic.h) // 2)
        sheet.alpha_composite(b.image(), (i * 24, 0))
    return sheet


# ============================================================= PROJECTILES ===
def proj_shard():
    g = Grid(12, 12)
    for y in range(12):
        for x in range(12):
            dx, dy = x + 0.5 - 6, y + 0.5 - 6
            along = (dx - dy) / math.sqrt(2)
            across = (dx + dy) / math.sqrt(2)
            if abs(along) / 6.6 + abs(across) / 2.6 <= 1:
                ch = "N" if across < -0.8 else "m" if across > 0.8 else "M"
                if abs(along) < 1.2 and abs(across) < 1.2:
                    ch = "W"
                g.set(x, y, ch)
    return g


MISSILE = [
    "...MMm........",
    "...m4555RRp...",
    "BCcm4445RRRRp.",
    "WCcm3332rRRRr.",
    "...m2222rr r..".replace(" ", "."),
    "...MMm........",
]

LASER = [
    "....rRRRRRpp.",
    "rrRRRppNWWWWN",
    "rrRRRppNWWWWN",
    "....rRRRRRpp.",
]

SPARK = [
    "....W....",
    ".c..B..c.",
    "..c.C.c..",
    "...BWB...",
    "WBCWWWCBW",
    "...BWB...",
    "..c.C.c..",
    ".c..B..c.",
    "....W....",
]


def make_projectiles():
    sheet = Image.new("RGBA", (64, 16), (0, 0, 0, 0))
    cells = [sprite(proj_shard()), sprite(MISSILE), sprite(LASER), sprite(SPARK)]
    for i, g in enumerate(cells):
        place_center(sheet, g, i * 16, 0, 16, 16)
    return sheet


# ================================================================ PLATFORM ===
def make_platform():
    W, H = 96, 16
    g = Grid(W, H)

    def start(y):  # first solid column of the left end cap for a given row
        return {1: 2, 2: 1, 3: 1, 4: 2}.get(y, 2 + max(0, y - 9))

    for x in range(W):
        d = min(x, W - 1 - x)  # distance from nearest end
        for y in range(1, 14):
            if d < start(y):
                continue
            m = x % 32
            if y == 1:
                ch = "W"
            elif y == 2:
                ch = "C"
            elif y == 3:
                ch = "c"
            elif y == 4:
                ch = "K"
            elif y == 5:
                ch = "3"
            elif y == 6:
                ch = "2"
            elif 7 <= y <= 10:
                ch = "M" if (x + y) % 8 < 4 else "n"
                if y == 7:
                    ch = "m" if ch == "M" else "P"
            elif y == 11:
                ch = "2"
            elif y == 12:
                ch = "1"
            else:
                ch = "P"
            # rivets and panel joints (period divides 32 so the middle tiles)
            if y == 6 and x % 8 == 4:
                ch = "5"
            if y == 11 and x % 8 == 0:
                ch = "4"
            if m == 31 and y in (5, 6, 11, 12):
                ch = "1"
            if y == 13 and m in (7, 23):
                ch = "c"
            g.set(x, y, ch)

    # end caps: bolted bracket plate with a warning lamp
    for side in (0, 1):
        def X(d):
            return d if side == 0 else W - 1 - d
        for y in range(5, 14):
            s = start(y)
            for d in range(s, 8):
                ch = "3" if d < 7 else "K"
                if d == s:
                    ch = "4" if side == 0 else "2"
                if y == 13:
                    ch = "1"
                g.set(X(d), y, ch)
        for by in (6, 11):
            g.set(X(4 + (by == 11)), by, "5")
            g.set(X(5 + (by == 11)), by, "1")
        g.set(X(4), 8, "O")
        g.set(X(5), 8, "Y")
        g.set(X(4), 9, "o")
        g.set(X(5), 9, "O")
        # rounded neon tip
        g.set(X(1), 2, "B")
    g.outline()
    # faint underglow row
    for x in range(W):
        d = min(x, W - 1 - x)
        if d >= 6:
            g.set(x, 15, "g")
    return g.image()


# =================================================================== CRATE ===
def crate_grid(damaged):
    rng = random.Random(SEED + 7)
    g = Grid(32, 32)
    x0, x1, y0, y1 = 3, 28, 5, 30
    g.rect(x0, y0, x1, y1, "2")
    g.hline(x0, x1, y0, "4")
    g.rect(x0, y0 + 1, x1, y0 + 2, "3")
    g.hline(x0, x1, y0 + 3, "C")
    g.set(x0, y0 + 3, "c")
    g.set(x1, y0 + 3, "c")
    g.hline(x0, x1, y0 + 4, "1")
    g.vline(x0, y0 + 5, y1 - 2, "3")
    g.vline(x1, y0 + 5, y1 - 2, "1")
    g.hline(x0, x1, y1 - 1, "1")
    g.hline(x0, x1, y1, "P")
    # recessed centre panel
    px0, px1, py0, py1 = 8, 23, 12, 26
    g.rect(px0, py0, px1, py1, "1")
    g.hline(px0, px1, py0, "K")
    g.vline(px0, py0, py1, "K")
    g.hline(px0 + 1, px1, py1, "3")
    g.vline(px1, py0 + 1, py1, "3")
    # neon side strips
    for sx in (5, 26):
        g.vline(sx, 13, 25, "C")
        g.vline(sx + (1 if sx == 5 else -1), 13, 25, "e")
        g.set(sx, 19, "B")
    # corner brackets with bolts
    for (bx, by, fx, fy) in [(x0, 10, 1, 1), (x1, 10, -1, 1), (x0, 28, 1, -1), (x1, 28, -1, -1)]:
        for i in range(4):
            g.set(bx + fx * i, by, "4" if fy > 0 else "3")
            g.set(bx, by + fy * i, "4" if fx > 0 else "3")
            g.set(bx + fx * i, by + fy, "3")
            g.set(bx + fx, by + fy * i, "3")
        g.set(bx + fx, by + fy, "5")
    # glowing magenta symbol: diamond ring with a core
    cx, cy = 15, 19
    for y in range(py0 + 1, py1):
        for x in range(px0 + 1, px1):
            d = abs(x + 0.5 - (cx + 1)) + abs(y - cy)
            if d <= 1:
                g.set(x, y, "W")
            elif 3 <= d <= 4.5:
                g.set(x, y, "M" if (x <= cx) else "m" if d > 4 else "M")
            elif 4.5 < d <= 5.5:
                g.set(x, y, "n")
    if damaged:
        # dead / flickering trim
        for x in range(16, x1):
            g.set(x, y0 + 3, "e" if x % 5 else "c")
        for y in range(16, 22):
            g.set(5, y, "e")
        g.vline(26, 13, 25, "e")
        g.set(26, 15, "C")
        # dimmed, glitched symbol
        for y in range(py0 + 1, py1):
            for x in range(px0 + 1, px1):
                ch = g.get(x, y)
                if ch == "M" and rng.random() < 0.55:
                    g.set(x, y, "m")
                elif ch == "W":
                    g.set(x, y, "N")
        row = [g.get(x, 18) for x in range(px0 + 1, px1)]
        for i, ch in enumerate(row):
            g.set(px0 + 1 + i + 2, 18, ch)
        g.set(px0 + 1, 18, "1")
        g.set(px0 + 2, 18, "C")
        # cracks
        cracks = [[(28, 8), (25, 12), (26, 15), (22, 19), (23, 22)],
                  [(3, 21), (6, 23), (7, 26), (10, 29)],
                  [(12, 5), (14, 8), (13, 10)]]
        for cr in cracks:
            for (a, b) in zip(cr, cr[1:]):
                for (x, y) in line_pts(*a, *b):
                    g.set(x, y, "K")
                    if g.get(x - 1, y) not in ("K", "."):
                        g.set(x - 1, y, "4" if y < 10 else "3")
        # chipped corner
        for (x, y) in [(28, 5), (27, 5), (26, 5), (25, 5), (28, 6), (27, 6), (26, 6), (28, 7), (27, 7), (28, 8)]:
            g.set(x, y, ".")
        g.set(27, 8, "1")
        g.set(26, 7, "1")
        # sparks from the crack
        g.set(24, 12, "Y")
        g.set(23, 11, "W")
    g.outline()
    return g


def make_crate():
    sheet = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    sheet.alpha_composite(crate_grid(False).image(), (0, 0))
    sheet.alpha_composite(crate_grid(True).image(), (32, 0))
    return sheet


# ================================================================= SKYLINE ===
def make_skyline():
    """Three silhouette layers; every x coordinate is wrapped modulo the width,
    so the strip tiles seamlessly. The front layer is a closed ring of
    buildings, which guarantees the bottom row is fully covered."""
    rng = random.Random(SEED + 80)
    W, H = 480, 200
    TOP_LIMIT = H - 185  # tallest structure (antennas may poke a little higher)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()

    def put(x, y, col):
        if 0 <= y < H:
            px[x % W, y] = col

    def rect(x0, y0, x1, y1, col):
        for y in range(max(0, y0), min(H - 1, y1) + 1):
            for x in range(x0, x1 + 1):
                px[x % W, y] = col

    PINK, CYAN, YELLOW, RED = rgba("#ff5ad8"), rgba("#19f5ff"), rgba("#ffe14d"), rgba("#ff2457")
    DIM = [rgba("#b8459f"), rgba("#2aa6bb"), rgba("#bfa647")]
    layers = [
        dict(body="#3a1d63", rim="#45246f", hmin=100, hmax=178, wmin=10, wmax=30, gap=(1, 8),
             win=0.03, cols=DIM, phase=0.0, tower=0.25),
        dict(body="#2e1650", rim="#381c60", hmin=60, hmax=134, wmin=14, wmax=34, gap=(0, 5),
             win=0.05, cols=[PINK, CYAN, YELLOW], phase=2.1, tower=0.12),
        dict(body="#241040", rim="#2c144d", hmin=24, hmax=80, wmin=16, wmax=42, gap=(0, 0),
             win=0.06, cols=[PINK, CYAN, YELLOW], phase=4.0, tower=0.0),
    ]
    antennas_left = 3
    billboard_spots = []

    for li, L in enumerate(layers):
        body, rim = rgba(L["body"]), rgba(L["rim"])
        # lay out the buildings of this layer around the ring
        start = x = rng.randint(0, 12)
        blds = []
        while x < start + W:
            slender = rng.random() < L["tower"]
            w = rng.randint(7, 11) if slender else rng.randint(L["wmin"], L["wmax"])
            if li == 2 and start + W - (x + w) < L["wmin"]:
                w = start + W - x  # close the ring
            wave = 0.5 + 0.5 * math.sin(2 * math.pi * (x + w / 2) / W * 2 + L["phase"])
            h = int(L["hmin"] + (L["hmax"] - L["hmin"]) * (0.35 * wave + 0.65 * rng.random()))
            if slender:
                h += 18
            blds.append((x, w, min(h, H - TOP_LIMIT)))
            x += w + rng.randint(*L["gap"])

        for (bx, w, h) in blds:
            top = H - h
            rect(bx, top, bx + w - 1, H - 1, body)
            tops = [top] * w

            def raise_col(c, rise):
                t = max(TOP_LIMIT, top - rise)
                rect(bx + c, t, bx + c, top - 1, body)
                tops[c] = min(tops[c], t)

            style = rng.choice(["flat", "flat", "setback", "spire", "slant", "boxes", "twin", "dome"])
            if style == "setback" and w >= 12:
                inset = rng.randint(2, max(2, w // 4))
                th = rng.randint(6, 16)
                for c in range(inset, w - inset):
                    raise_col(c, th)
                if w - 2 * inset >= 8 and rng.random() < 0.6:
                    for c in range(inset + 2, w - inset - 2):
                        raise_col(c, th + 5)
            elif style == "spire":
                for c in range(w):
                    raise_col(c, (min(c, w - 1 - c) + 1) // 2)
            elif style == "slant":
                flip = rng.random() < 0.5
                for c in range(w):
                    raise_col(c, ((w - 1 - c) if flip else c) // 2)
            elif style == "boxes":
                for _ in range(rng.randint(1, 2)):
                    bw = rng.randint(3, 6)
                    bxo = rng.randint(1, max(1, w - bw - 1))
                    bh = rng.randint(2, 4)
                    for c in range(bxo, min(w, bxo + bw)):
                        raise_col(c, bh)
            elif style == "twin" and w >= 12:
                th = rng.randint(5, 12)
                for c in list(range(1, 4)) + list(range(w - 4, w - 1)):
                    raise_col(c, th)
            elif style == "dome":
                r = (w - 1) / 2.0
                for c in range(w):
                    raise_col(c, int(round(math.sqrt(max(0.0, r * r - (c - r) ** 2)) * 0.55)))

            # roof rim + a lighter left edge for depth
            for c in range(w):
                put(bx + c, tops[c], rim)
            for y in range(tops[0], H):
                put(bx, y, rim)

            # antenna with a red tip light on a few of the tallest buildings
            if li < 2 and antennas_left > 0 and h > (146 if li == 0 else 116) and w >= 9:
                c = w // 2
                ah = rng.randint(9, 14)
                ty = max(5, tops[c] - ah)
                for y in range(ty, tops[c]):
                    put(bx + c, y, body)
                put(bx + c - 1, tops[c] - 1, body)
                put(bx + c + 1, tops[c] - 1, body)
                put(bx + c, ty - 1, RED)
                antennas_left -= 1

            # sparse lit windows
            sx = rng.choice((3, 4))
            sy = rng.choice((3, 4, 5))
            for wy in range(top + 4, H - 2, sy):
                for wx in range(2, w - 2, sx):
                    if rng.random() < L["win"]:
                        col = rng.choice(L["cols"])
                        put(bx + wx, wy, col)
                        if rng.random() < 0.35 and wx + 1 < w - 2:
                            put(bx + wx + 1, wy, col)
            if li == 1 and w >= 22 and h >= 96:
                billboard_spots.append((bx, w, top))

        if li == 1:
            # one horizontal (magenta) and one vertical (cyan) neon billboard
            rng.shuffle(billboard_spots)
            for n, (bx, w, top) in enumerate(billboard_spots[:2]):
                neon, pale = (PINK, rgba("#ffa6f0")) if n == 0 else (CYAN, rgba("#b5fcff"))
                bw, bh = (min(w - 4, 22), 10) if n == 0 else (8, 20)
                ox, oy = bx + (w - bw) // 2, top + 6
                rect(ox, oy, ox + bw - 1, oy + bh - 1, rgba("#120720"))
                for c in range(bw):
                    put(ox + c, oy, neon)
                    put(ox + c, oy + bh - 1, neon)
                for r in range(bh):
                    put(ox, oy + r, neon)
                    put(ox + bw - 1, oy + r, neon)
                # abstract glyphs: 3x5 cells (side by side, or stacked)
                cells = [(ox + 2 + 4 * i, oy + 2) for i in range((bw - 3) // 4)] if n == 0 else \
                        [(ox + 2, oy + 2 + 6 * i) for i in range((bh - 3) // 6)]
                for (gx, gy) in cells:
                    stem = rng.randint(0, 2)
                    for r in range(5 if n == 0 else 5):
                        put(gx + stem, gy + r, neon)
                    for r in rng.sample(range(5), 3):
                        for c in range(3):
                            if rng.random() < 0.7:
                                put(gx + c, gy + r, pale if r == 0 else neon)
                if n == 0:  # a little support strut under the sign
                    put(ox + 3, oy + bh, rgba(L["rim"]))
                    put(ox + bw - 4, oy + bh, rgba(L["rim"]))
    return img


# ================================================================== GROUND ===
def make_ground():
    rng = random.Random(SEED + 90)
    W, H = 64, 48
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    steps = [rgba(c) for c in ("#241040", "#200e39", "#1c0c32", "#1a0b2e", "#170a29",
                               "#140824", "#11071f", "#0e051a")]
    bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    top_rows = [rgba("#ffb8f3"), rgba("#ff2fd6"), rgba("#a8189c"), rgba("#4a0f52")]
    for y in range(H):
        for x in range(W):
            if y < len(top_rows):
                px[x, y] = top_rows[y]
                continue
            t = (y - 4) / (H - 5) * (len(steps) - 1)
            i = int(t)
            frac = t - i
            if frac * 16 > bayer[y % 4][x % 4] + 0.5:
                i += 1
            i = min(i, len(steps) - 1)
            if rng.random() < 0.07:
                i = max(0, min(len(steps) - 1, i + rng.choice((-1, 1))))
            px[x, y] = steps[i]

    def darker(c, k=2):
        idx = steps.index(c) if c in steps else 3
        return steps[min(len(steps) - 1, idx + k)]

    def lighter(c, k=1):
        idx = steps.index(c) if c in steps else 3
        return steps[max(0, idx - k)]

    # panel seams (staggered like paving slabs)
    for sy in (18, 34):
        for x in range(W):
            px[x, sy] = darker(px[x, sy], 2)
            px[x, sy + 1] = lighter(px[x, sy + 1], 1)
    for (ya, yb, cols) in ((4, 17, (31, 63)), (19, 33, (15, 47)), (35, 47, (31, 63))):
        for y in range(ya, yb + 1):
            for x in cols:
                px[x, y] = darker(px[x, y], 2)
    # neon reflections just under the edge
    for x in range(W):
        if (x * 7) % 11 < 3:
            px[x, 4] = rgba("#3a0f48")
        if (x * 5) % 13 < 2:
            px[x, 5] = rgba("#2c0d40")
    # faint cyan dots of light
    dots = [(6, 10, "#12607a"), (22, 26, "#0f4d63"), (41, 9, "#12607a"), (53, 23, "#0f4d63"),
            (12, 40, "#0c3b4e"), (36, 41, "#0c3b4e"), (58, 14, "#1aa3c2"), (27, 13, "#0f4d63"),
            (47, 30, "#12607a"), (3, 28, "#0c3b4e")]
    for (x, y, c) in dots:
        px[x, y] = rgba(c)
    return img


# ============================================================ EASTER EGGS ===
def capsule_pts(a, b, ra, rb):
    """Pixels within a tapered capsule from a (radius ra) to b (radius rb)."""
    pts = set()
    r = max(ra, rb)
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    for y in range(int(min(a[1], b[1]) - r) - 1, int(max(a[1], b[1]) + r) + 2):
        for x in range(int(min(a[0], b[0]) - r) - 1, int(max(a[0], b[0]) + r) + 2):
            cx_, cy_ = x + 0.5, y + 0.5
            t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((cx_ - a[0]) * dx + (cy_ - a[1]) * dy) / l2))
            rr = ra + (rb - ra) * t
            if (cx_ - a[0] - t * dx) ** 2 + (cy_ - a[1] - t * dy) ** 2 <= rr * rr:
                pts.add((x, y))
    return pts


def bezier(p0, c, p1, n=40):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1])
            for t in (i / n for i in range(n + 1))]


# ---------------------------------------------------------------- hologram ---
HOLO_RAMP = [rgba(c) for c in ("#5c1470", "#a3209a", "#e62ccf", "#ff6fdf", "#ffb6f3", "#ffe3fb")]
HOLO_RIM, HOLO_RIM_LIT = rgba("#19f5ff"), rgba("#a8fbff")


def hologram_figure():
    """A woman in a long-sleeved, ankle-length dress with a bob haircut:
    3/4 pose, weight on one leg, one hand raised to her hair, the hem
    sweeping to the side. Returns {(x, y): (tone, kind)} where kind is
    'body', 'rim' (cyan edge) or 'lit' (pale cyan edge facing the light)."""
    fig = {}  # (x, y) -> [layer, group, tone]
    count = [0]

    def add(pts, tone, group):
        li = count[0]
        count[0] += 1
        out = set()
        for (x, y) in pts:
            if 0 <= x < 48 and 0 <= y < 96:
                fig[(x, y)] = [li, group, tone]
                out.add((x, y))
        return out

    def tone(pts, t):
        for p in pts:
            if p in fig:
                fig[p][2] = t

    # back to front
    add(capsule_pts((27.0, 84.0), (27.6, 88.6), 1.1, 0.9), 2, "farleg")
    add(poly_pts([(26.2, 88.0), (28.6, 88.0), (31.2, 90.2), (30.8, 91.4), (26.0, 91.4)]), 1, "farshoe")
    add(capsule_pts((19.6, 84.0), (19.8, 88.8), 1.2, 1.0), 3, "nearleg")
    add(poly_pts([(18.6, 88.0), (21.2, 88.0), (21.4, 91.6), (15.4, 91.6), (16.0, 90.4)]), 1, "nearshoe")
    raised = add(capsule_pts((30.2, 22.4), (35.2, 13.8), 2.1, 1.7) |
                 capsule_pts((35.2, 13.8), (30.8, 8.8), 1.7, 1.3), 2, "raisedarm")
    add(ellipse_pts(29.8, 8.2, 1.5, 1.5), 3, "raisedhand")
    hair = add(ellipse_pts(24.6, 10.4, 5.4, 6.0) |
               poly_pts([(19.4, 11), (29.8, 10.5), (30.4, 15.2), (29.2, 17.4), (26.4, 17.2), (21, 17)]),
               1, "hair")
    neck = add(poly_pts([(21.6, 15.2), (25.0, 15.2), (25.4, 20.6), (21.4, 20.6)]), 2, "neck")
    dress = add(poly_pts([(17.2, 22.0), (19.5, 20.0), (22.0, 19.4), (26.0, 19.4), (28.8, 20.0), (31.2, 21.8),
                          (30.6, 25.0), (29.6, 29.5), (28.2, 34.0), (29.2, 39.0), (30.0, 46.0), (31.0, 56.0),
                          (32.4, 66.0), (34.6, 76.0), (37.0, 84.0), (35.5, 86.6), (30.0, 87.4), (24.0, 87.6),
                          (18.0, 87.4), (13.6, 86.6), (14.8, 78.0), (15.8, 66.0), (16.2, 56.0), (16.4, 46.0),
                          (16.6, 41.0), (18.6, 36.5), (19.6, 34.0), (18.6, 29.5), (17.6, 25.5)]), 2, "dress")
    lowered = add(capsule_pts((18.4, 22.6), (15.4, 32.4), 2.0, 1.7) |
                  capsule_pts((15.4, 32.4), (15.6, 41.0), 1.7, 1.4), 2, "lowerarm")
    add(ellipse_pts(16.0, 43.2, 1.4, 2.0), 3, "lowerhand")
    face = add(ellipse_pts(22.6, 11.6, 3.3, 4.6), 4, "face")
    hair |= add({(x, y) for (x, y) in face if y + 0.5 < 8.4 + 0.35 * (x - 19) or x <= 19}, 1, "hair")

    # --- dress: light from the left, shadow on the right, drape folds
    rows = {}
    for (x, y) in dress:
        lo, hi = rows.get(y, (99, -1))
        rows[y] = (min(lo, x), max(hi, x))
    for (x, y) in dress:
        lo, hi = rows[y]
        if x <= lo + 2:
            fig[(x, y)][2] = 3
        elif x >= hi - 2:
            fig[(x, y)][2] = 1
    tone({(x, y) for (x, y) in dress if y <= 21 and 21 <= x <= 26}, 3)  # high collar
    tone({(x, y) for (x, y) in dress if y == 22 and 21 <= x <= 26}, 1)
    tone({(x, y) for (x, y) in dress if y in (33, 34)}, 4)  # cinched sash
    tone({(19, 33), (20, 33), (19, 34), (20, 34)}, 5)
    tone({(20, 35), (19, 36), (20, 37), (19, 38), (20, 39)}, 4)
    for (a, b, t) in (((21, 40), (19, 85), 3), ((24, 41), (24, 86), 1), ((27, 41), (31, 84), 3),
                      ((29, 48), (34, 83), 1), ((19, 50), (16, 84), 1)):
        tone(set(line_pts(*a, *b)), t)
    tone({(x, y) for (x, y) in lowered if (x - 1, y) not in lowered}, 3)
    tone({(x, y) for (x, y) in lowered if y >= 40}, 3)
    tone({(x, y) for (x, y) in raised if (x, y - 1) not in raised}, 3)
    tone({(16, 91), (17, 91)}, 4)
    # hair: glossy arc, strands, darker curled ends
    for (x, y) in hair:
        d = math.hypot(x + 0.5 - 25.0, y + 0.5 - 12.0)
        if 5.6 <= d <= 6.6 and y < 10:
            fig[(x, y)][2] = 3
        elif 4.6 <= d < 5.6 and y < 9:
            fig[(x, y)][2] = 2
    tone({(27, y) for y in range(12, 16)}, 2)
    tone({(x, y) for (x, y) in hair if (x, y + 1) not in hair and y > 14}, 0)
    # face: soft shading, lashes, lips, cheek light; shadow under the jaw
    tone({(x, y) for (x, y) in face if x >= 25 or (x >= 24 and y >= 14)}, 3)
    tone({(20, 11), (21, 11), (23, 11), (24, 11)}, 0)
    tone({(21, 14), (22, 14)}, 1)
    tone({(20, 12), (21, 12)}, 5)
    tone({(x, y) for (x, y) in neck if y <= 16}, 1)

    # --- rim light on the silhouette, dark contour where a part overlaps another
    out = {}
    for (x, y), (li, grp, t) in fig.items():
        nbs = ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
        if any(q not in fig for q in nbs):
            lit = (x - 1, y) not in fig or (x, y - 1) not in fig
            out[(x, y)] = (t, "lit" if lit else "rim")
        elif any(fig[q][0] < li and fig[q][1] != grp and {fig[q][1], grp} != {"face", "hair"}
                 for q in nbs):
            out[(x, y)] = (0, "body")
        else:
            out[(x, y)] = (t, "body")
    return out


def hologram_frame(fig, f):
    img = Image.new("RGBA", (48, 96), (0, 0, 0, 0))
    px = img.load()
    body_a, rim_a = (204, 188)[f], (210, 198)[f]
    # projector ring at the feet (drawn first so the figure sits on it)
    ring = edge_pts(ellipse_pts(24.5, 93.3, 12.5, 2.3), N4)
    for (x, y) in ring:
        if 0 <= y < 96:
            px[x, y] = HOLO_RIM[:3] + ((150, 140)[f],)
    for (x, y), (t, kind) in fig.items():
        col = HOLO_RIM if kind == "rim" else HOLO_RIM_LIT if kind == "lit" else HOLO_RAMP[t]
        a = rim_a if kind != "body" else body_a
        if (y + f) % 3 == 2:  # scanline: every 3rd row dimmer and more transparent
            col = tuple(int(c * 0.7) for c in col[:3]) + (255,)
            a = 140
        px[x, y] = col[:3] + (a,)
    # glitch: a few rows slip sideways with a chromatic split at the ends
    for (y0, n, sh) in ([(28, 2, 3), (64, 1, -2)], [(12, 1, -2), (46, 2, 3), (77, 1, 2)])[f]:
        for y in range(y0, y0 + n):
            row = [px[x, y] for x in range(48)]
            new = [(0, 0, 0, 0)] * 48
            for x in range(48):
                if row[x][3] and 0 <= x + sh < 48:
                    new[x + sh] = row[x]
            xs = [x for x in range(48) if new[x][3]]
            if xs:
                lead, trail = (max(xs), min(xs)) if sh > 0 else (min(xs), max(xs))
                new[lead] = HOLO_RIM[:3] + (210,)
                new[trail] = (255, 120, 230, 170)
            for x in range(48):
                px[x, y] = new[x]
    # stray projection sparkles
    rng = random.Random(SEED + 100 + f)
    for _ in range(5):
        while True:
            x, y = rng.randint(6, 41), rng.randint(6, 86)
            if px[x, y][3] == 0 and all(px[x + dx, y + dy][3] == 0 for dx, dy in N8):
                break
        px[x, y] = (HOLO_RIM if rng.random() < 0.6 else HOLO_RAMP[4])[:3] + (150,)
    return img


def make_hologram():
    fig = hologram_figure()
    sheet = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    for f in range(2):
        sheet.paste(hologram_frame(fig, f), (f * 48, 0))
    return sheet


# -------------------------------------------------------------------- dove ---
# Dove poses, 14x14 interior (grey outline added afterwards). W white,
# s pale grey, t grey feather tips / far wing, a beak, 1 eye.
DOVE_POSES = {
    "up": [
        ".t.t.....t....",
        ".WtWt..tst....",
        "..WWWt.sss....",
        "..WWWWtss.....",
        "...WWWWts.....",
        "....WWWWs.WWW.",
        ".....WWWsWW1Wa",
        "tt..WWWWWWWWs.",
        "ttsWWWWWWWWs..",
        "...ssssssss...",
        "..............",
        "..............",
        "..............",
        "..............",
    ],
    "mid": [
        "..............",
        "..............",
        "..............",
        "t.t.t.........",
        "WtWtWWt..tt...",
        ".WWWWWWWs.WWW.",
        "..sWWWWWWWW1Wa",
        "tt..WWWWWWWWs.",
        "ttsWWWWWWWWs..",
        "...ssssssss...",
        "..............",
        "..............",
        "..............",
        "..............",
    ],
    "down": [
        "..............",
        "..............",
        "..............",
        "..............",
        "..............",
        "..........WWW.",
        ".........WW1Wa",
        "tt..WWWWWWWWs.",
        "ttsWWWWWWWWs..",
        "...sWWWWWWs...",
        "...WWWWWWs....",
        "..WWWWWs......",
        ".tWtWt........",
        "..t.t.........",
    ],
}


def dove_grid(f):
    """Frames: wings up, mid, down, mid."""
    pose = ("up", "mid", "down", "mid")[f]
    return Grid.ascii(DOVE_POSES[pose]).padded(1).outline("x")


def make_dove():
    sheet = Image.new("RGBA", (64, 16), (0, 0, 0, 0))
    for f in range(4):
        sheet.paste(dove_grid(f).image(), (f * 16, 0))
    return sheet


# ----------------------------------------------------------------- secrets ---
def secret_mantis():
    W, H = 17, 17

    def blade(mirror):
        g = Grid(W, H)
        outer = bezier((1.6, 16.5), (3.0, 5.0), (15.6, 0.4), 30)
        inner = bezier((5.4, 16.5), (6.6, 7.6), (15.6, 0.4), 30)
        pts = poly_pts(outer + inner[::-1])
        if mirror:
            pts = {(W - 1 - x, y) for (x, y) in pts}
        edge_in = edge_pts(pts, ((1, 0), (0, 1))) if not mirror else edge_pts(pts, ((-1, 0), (0, 1)))
        edge_out = edge_pts(pts, ((-1, 0), (0, -1))) if not mirror else edge_pts(pts, ((1, 0), (0, -1)))
        g.fill(pts, "4" if mirror else "5")
        g.fill(edge_out, "W" if not mirror else "5")
        g.fill(edge_in, "M")
        for (x, y) in pts:  # forearm mount
            if y >= 14:
                g.set(x, y, "2" if (x + y) % 3 else "3")
        return g

    return stack(W, H, blade(True), blade(False), pad=1)


def secret_katana():
    """Diagonal katana: tip top-right, hilt bottom-left (a along, s across)."""
    g = Grid(17, 17)
    for y in range(17):
        for x in range(17):
            a, s = x - y, x + y - 16
            ch = None
            if a == 14 and s == 0:
                ch = "B"
            elif 12 <= a <= 13 and -1 <= s <= 1:
                ch = "5" if s < 0 else "C"
            elif -1 <= a <= 11 and -1 <= s <= 1:
                ch = "5" if s < 0 else "4" if s == 0 else "C"
                if s == 1 and a % 4 == 1:
                    ch = "B"
            elif a == -2 and abs(s) <= 1:
                ch = "Y"
            elif a in (-3, -4) and abs(s) <= 3:
                ch = "O" if s < 0 else "o"
                if abs(s) <= 1 and a == -3:
                    ch = "Y"
            elif -12 <= a <= -5 and abs(s) <= 1:
                ch = "R" if (a + (s == 0)) % 2 else "1"
            elif a == -13 and abs(s) <= 1:
                ch = "3"
            if ch:
                g.set(x, y, ch)
    return g


def secret_sandevistan():
    W, H = 18, 17

    def spine_pts(dx):
        pts = set()
        for i in range(4):
            y0 = 1 + i * 4
            for y in range(y0, y0 + 3):
                for x in range(11, 16):
                    if not ((x in (11, 15)) and y in (y0, y0 + 2)):
                        pts.add((x + dx, y))
            pts |= {(10 + dx, y0 + 1), (16 + dx, y0 + 1)}
        pts |= {(13 + dx, y) for y in range(0, 17)}
        return pts

    layers = []
    for dx, ch in ((-9, "G"), (-6, "Y"), (-3, "M")):
        g = Grid(W, H)
        g.fill(spine_pts(dx), ch)
        layers.append(g)
    main = Grid(W, H)
    sp = spine_pts(0)
    shade_rim(main, sp, "3", light="4", dark="2")
    for i in range(4):
        y0 = 1 + i * 4
        main.set(13, y0 + 1, "C")
        main.set(12, y0 + 1, "c")
        main.set(14, y0 + 1, "B" if i == 0 else "c")
    for y in (4, 8, 12):
        main.set(13, y, "5")
    layers.append(main)
    return stack(W, H, *layers, pad=1)


def secret_thermoptic():
    g = Grid(18, 18)
    body = (ellipse_pts(9.0, 3.6, 2.4, 2.6) |
            poly_pts([(5.6, 6.6), (12.4, 6.6), (11.6, 11.8), (6.4, 11.8)]) |
            capsule_pts((6.0, 7.4), (3.6, 13.4), 1.2, 1.0) |
            capsule_pts((12.0, 7.4), (14.4, 13.4), 1.2, 1.0) |
            capsule_pts((7.6, 11.5), (6.8, 16.6), 1.3, 1.1) |
            capsule_pts((10.4, 11.5), (11.2, 16.6), 1.3, 1.1))
    edge = edge_pts(body, N4)
    for (x, y) in body - edge:  # see-through interior with a faint shimmer
        if (x * 3 + y * 5) % 11 == 0:
            g.set(x, y, "w")
        if (x * 7 + y * 3) % 23 == 0:
            g.set(x, y, "e")
    for i, (x, y) in enumerate(sorted(edge, key=lambda p: math.atan2(p[1] - 9, p[0] - 9))):
        if (x + y) % 3 != 0:
            g.set(x, y, "C" if (x + 2 * y) % 5 else "B")
    for (x, y) in edge:  # ghosted refraction offset
        if (x + y) % 4 == 0 and g.get(x + 1, y) == ".":
            g.set(x + 1, y, "e")
    return g


def secret_jack_in():
    W, H = 17, 17
    cable = Grid(W, H)
    cp = brush([(int(round(x)), int(round(y))) for (x, y) in bezier((1, 16), (9, 16.5), (8.5, 11), 30)], SQ2)
    shade_rim(cable, cp, "1", light="2", dark="P")
    plug = Grid(W, H)
    pp = {(x, y) for x in range(6, 12) for y in range(5, 13)} - {(6, 12), (11, 12)}
    shade_rim(plug, pp, "3", light="4", dark="2")
    for y in (8, 10):
        plug.hline(7, 10, y, "2")
    plug.hline(6, 11, 5, "5")
    plug.set(10, 11, "G")
    tip = Grid(W, H)
    tip.rect(7, 2, 10, 4, "C")
    tip.hline(7, 10, 4, "c")
    tip.set(7, 1, "B")
    tip.set(10, 1, "B")
    tip.set(8, 2, "W")
    tip.set(9, 2, "W")
    sparks = Grid(W, H)
    for (x, y) in [(5, 1), (4, 0), (12, 1), (13, 0), (12, 3), (8, 0)]:
        sparks.set(x, y, "B" if (x + y) % 2 else "C")
    return stack(W, H, cable, plug, tip, sparks, pad=1)


def secret_tears(b):
    """Blue rain streaks on the badge itself, then the dove on top."""
    for (x, y) in [(4, 3), (9, 2), (15, 4), (19, 3), (3, 12), (7, 17), (18, 15), (13, 18), (20, 10),
                   (11, 9), (2, 7), (16, 8)]:
        for i, ch in enumerate("UUb"):
            if b.get(x - (i // 2), y + i) == "P":
                b.set(x - (i // 2), y + i, ch)
    d = dove_grid(1)
    b.blit(d, (24 - d.w) // 2, (24 - d.h) // 2 + 1)
    return b


def secret_holo_head():
    W, H = 17, 17
    fig = {}
    hair = ellipse_pts(9.2, 6.4, 5.3, 5.8) | poly_pts([(4, 6.5), (14.4, 6), (14.8, 11), (13.2, 12.2), (5, 12)])
    neck = {(x, y) for x in range(7, 10) for y in range(10, 14)}
    shoulders = {(x, y) for (x, y) in ellipse_pts(8.6, 18.0, 7.8, 4.6) if y <= 16}
    face = ellipse_pts(7.9, 7.4, 3.1, 4.0)
    bangs = {(x, y) for (x, y) in face if y + 0.5 < 5.0 + 0.3 * (x - 5) or x <= 5}
    for pts, ch in ((shoulders, "M"), (hair, "m"), (neck, "M"), (face, "N"), (bangs, "m")):
        for p in pts:
            fig[p] = ch
    for (x, y) in hair | bangs:
        if 4.4 <= math.hypot(x + 0.5 - 9.5, y + 0.5 - 8) <= 5.4 and y < 5:
            fig[(x, y)] = "M"
    for p in ((6, 7), (9, 7)):
        fig[p] = "m"
    fig[(7, 10)] = "M"
    g = Grid(W, H)
    allp = set(fig)
    for (x, y), ch in fig.items():
        if any(q not in allp for q in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))):
            ch = "B" if ((x - 1, y) not in allp or (x, y - 1) not in allp) else "C"
        if y % 3 == 2:
            ch = {"N": "M", "M": "m", "m": "n", "C": "c", "B": "c"}[ch]
        g.set(x, y, ch)
    for (x, y) in face:  # contour under the jaw
        if (x, y + 1) in neck and (x, y + 1) not in face:
            g.set(x, y, "m")
    return g


def secret_moon():
    W, H = 17, 17
    moon = Grid(W, H)
    disc = ellipse_pts(7.5, 9.5, 6.8, 6.8)
    bite = ellipse_pts(11.0, 7.4, 5.8, 5.8)
    cres = disc - bite
    shade_rim(moon, cres, "l", light="L", dark="d")
    for p in [(3, 8), (2, 11), (5, 13)]:
        if p in cres and p not in edge_pts(cres, N4):
            moon.set(p[0], p[1], "d")
    rocket = Grid(W, H)
    for (x, y), ch in {(13, 4): "5", (14, 3): "5", (15, 2): "R", (14, 4): "4", (13, 3): "5",
                       (12, 4): "M", (13, 5): "M", (12, 5): "O"}.items():
        rocket.set(x, y, ch)
    trail = Grid(W, H)
    for (x, y) in [(11, 6), (10, 7)]:
        trail.set(x, y, "Y" if x == 11 else "O")
    out = stack(W, H, moon, trail, rocket, pad=1)
    for (x, y) in [(9, 9), (8, 11), (14, 12), (16, 9)]:  # dotted flight path (no outline)
        if out.get(x, y) == ".":
            out.set(x, y, "c")
    return out


def make_secrets():
    sheet = Image.new("RGBA", (192, 24), (0, 0, 0, 0))
    makers = [secret_mantis, secret_katana, secret_sandevistan, secret_thermoptic,
              secret_jack_in, None, secret_holo_head, secret_moon]
    for i, fn in enumerate(makers):
        b = badge()
        if fn is None:
            secret_tears(b)
        elif fn in (secret_thermoptic, secret_holo_head):  # see-through / light: no dark outline
            ic = fn()
            b.blit(ic, (24 - ic.w) // 2, (24 - ic.h) // 2)
        else:
            ic = sprite(fn())
            b.blit(ic, (24 - ic.w) // 2, (24 - ic.h) // 2)
        sheet.paste(b.image(), (i * 24, 0))
    return sheet


# ---------------------------------------------------------------- terminal ---
def terminal_frame(f):
    rng = random.Random(SEED + 110 + f)
    W, H = 24, 40
    g = Grid(W, H)
    # base plate and pedestal (base sits on the bottom; its outline is y=39)
    g.rect(4, 36, 19, 38, "1")
    g.hline(4, 19, 36, "3")
    g.hline(5, 18, 37, "2")
    g.set(6, 37, "4")
    g.set(17, 37, "4")
    g.rect(8, 27, 15, 35, "2")
    g.vline(8, 27, 35, "3")
    g.vline(15, 27, 35, "1")
    for y in range(29, 34):
        g.set(11, y, "C" if f == 0 else "e")
        g.set(12, y, "c" if f == 0 else "e")
    g.hline(9, 14, 34, "1")
    # housing
    hp = ellipse_pts(11.5, 14.5, 10.6, 12.6, p=4.0)
    hp = {(x, y) for (x, y) in hp if 2 <= y <= 26}
    shade_rim(g, hp, "2", light="3", dark="1")
    for (x, y) in edge_pts(hp, ((0, -1),)):
        g.set(x, y, "C" if f == 0 else ("e" if x % 3 else "c"))
    g.hline(3, 20, 26, "1")
    # screen
    g.rect(4, 6, 19, 18, "1")
    g.hline(4, 19, 6, "K")
    g.vline(4, 6, 18, "K")
    g.rect(5, 7, 18, 17, "z" if f == 0 else "q")
    if f == 0:
        y = 8
        indent = 0
        while y <= 16:
            n = rng.randint(4, 11 - indent)
            col = rng.choice(("G", "G", "C", "i"))
            for x in range(6 + indent, 6 + indent + n):
                if rng.random() < 0.85:
                    g.set(x, y, col)
            indent = rng.choice((0, 0, 2))
            y += 2
        g.rect(6, 16, 7, 16, "W")
        g.set(17, 8, "G")
    else:
        for y in range(7, 18):
            for x in range(5, 19):
                r = rng.random()
                if r < 0.18:
                    g.set(x, y, "r")
                elif r < 0.24:
                    g.set(x, y, "p")
        for i in range(9):
            g.set(7 + i, 8 + i, "R")
            g.set(16 - i, 8 + i, "R")
            g.set(8 + i, 8 + i, "R")
            g.set(15 - i, 8 + i, "R")
        g.set(11, 12, "W")
        g.set(12, 12, "W")
    # keypad, card slot, status light
    for ky in (20, 22):
        for kx in (5, 7, 9):
            g.set(kx, ky, "4")
            g.set(kx, ky + 1, "1")
    g.hline(13, 18, 21, "K")
    g.set(18, 21, "M" if f == 0 else "1")
    g.rect(17, 23, 18, 24, "G" if f == 0 else "R")
    g.set(17, 23, "W" if f == 0 else "p")
    if f == 1:
        g.set(14, 22, "Y")
        g.set(15, 23, "W")
        for (x, y) in line_pts(19, 10, 16, 14):
            g.set(x, y, "K")
    return g.outline()


def make_terminal():
    sheet = Image.new("RGBA", (48, 40), (0, 0, 0, 0))
    for f in range(2):
        sheet.paste(terminal_frame(f).image(), (f * 24, 0))
    return sheet


# -------------------------------------------------------------------- moon ---
def make_moon():
    rng = random.Random(SEED + 120)
    W = H = 64
    cx = cy = 32.0
    R = 30.6
    rim_c, base, mid, maria = rgba("#f4f0ff"), rgba("#ddd5f5"), rgba("#cbc2ec"), rgba("#b7addf")
    dark, light = rgba("#a297cf"), rgba("#efeaff")
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    blobs = [(22, 24, 9, 6), (38, 20, 7, 5), (36, 38, 10, 7), (20, 42, 6, 5), (46, 32, 5, 7)]
    inside = {}
    for y in range(H):
        for x in range(W):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d > R:
                continue
            inside[(x, y)] = d
            m = max(1 - math.hypot((x + 0.5 - bx) / rx, (y + 0.5 - by) / ry) for (bx, by, rx, ry) in blobs)
            if m > 0.18:
                col = maria
            elif m > 0.0:
                col = maria if (x + y) % 2 else mid
            else:
                col = base
            if rng.random() < 0.05:
                col = mid if col == base else base
            px[x, y] = col
    craters = [(16, 20, 3.2), (44, 14, 2.4), (30, 30, 4.4), (48, 44, 3.4), (24, 50, 2.6),
               (12, 36, 2.0), (40, 54, 2.0), (34, 10, 1.6), (54, 26, 1.8), (26, 38, 1.5)]
    for (ccx, ccy, r) in craters:
        for y in range(int(ccy - r) - 2, int(ccy + r) + 3):
            for x in range(int(ccx - r) - 2, int(ccx + r) + 3):
                if (x, y) not in inside:
                    continue
                dx, dy = x + 0.5 - ccx, y + 0.5 - ccy
                d = math.hypot(dx, dy)
                if d <= r:
                    # floor, with the inner wall facing away from the light in shadow
                    px[x, y] = dark if (d > r - 1.4 and (dx + dy) < 0) else mid
                elif d <= r + 1.0 and (dx + dy) > 0.3 * r:
                    px[x, y] = light
    for (x, y), d in inside.items():  # slightly lighter rim
        if d > R - 1.2 or (d > R - 2.4 and (x + y) < 62):
            px[x, y] = rim_c
    return img


# ------------------------------------------------------------------ katana ---
def make_katana():
    g = Grid(38, 10)
    # pommel and red/black wrapped hilt
    g.rect(0, 3, 1, 6, "3")
    g.set(0, 3, "4")
    g.set(1, 6, "2")
    for x in range(2, 12):
        m = x % 4
        g.set(x, 3, "R" if m == 2 else "1")
        g.set(x, 6, "R" if m == 0 else "1")
        g.set(x, 4, "1" if m == 3 else "R")
        g.set(x, 5, "1" if m == 1 else "R")
    # round guard (tsuba) seen at a slight angle
    gp = ellipse_pts(13.5, 5.0, 1.8, 5.0)
    shade_rim(g, gp, "O", light="Y", dark="o")
    g.set(13, 5, "o")
    # collar + curved blade, cyan cutting edge on the lower side
    g.rect(15, 3, 16, 5, "Y")
    g.vline(16, 3, 5, "O")
    for x in range(17, 38):
        top = 3 - (x >= 27)
        bot = 5 - (x >= 32) - (x >= 36)
        if x == 37:
            g.set(x, 3, "B")
            continue
        for y in range(top, bot + 1):
            g.set(x, y, "4")
        g.set(x, top, "W" if x % 6 == 0 else "5")
        g.set(x, bot, "B" if x % 5 == 2 else "C")
    return sprite(g).image()


# --------------------------------------------------------------- ripperdoc ---
def make_ripperdoc():
    rng = random.Random(SEED + 130)
    W, H = 64, 72
    g = Grid(W, H)
    # sidewalk curb (the bottom row of the sprite is the ground line)
    g.rect(1, 66, 62, 70, "2")
    g.hline(1, 62, 66, "3")
    g.hline(1, 62, 70, "1")
    for x in range(1, 63, 8):
        g.vline(x, 67, 69, "1")
    # walls and pillars
    g.rect(4, 20, 59, 65, "2")
    for x in (4, 52):
        g.rect(x, 20, x + 7, 65, "2")
        g.vline(x, 20, 65, "3")
        g.vline(x + 7, 20, 65, "1")
        for y in range(24, 64, 8):
            g.set(x + 2, y, "4")
            g.set(x + 5, y, "4")
    # shutter housing + rails
    g.rect(12, 21, 51, 25, "3")
    g.hline(12, 51, 21, "4")
    g.hline(12, 51, 25, "1")
    for x in range(14, 50, 6):
        g.set(x, 23, "5")
    g.rect(12, 26, 13, 65, "1")
    g.rect(50, 26, 51, 65, "1")
    # half-raised shutter
    for y in range(26, 57):
        k = (y - 26) % 3
        g.hline(14, 49, y, "3" if k == 0 else "2" if k == 1 else "1")
    g.rect(14, 56, 49, 57, "4")
    g.hline(14, 49, 57, "2")
    g.rect(29, 57, 34, 57, "5")
    # clinic interior glow under the shutter
    g.rect(14, 58, 49, 65, "P")
    g.rect(14, 63, 49, 65, "z")
    g.hline(14, 49, 65, "i")
    for (x, y) in [(18, 60), (22, 61), (41, 59), (45, 61), (46, 61)]:
        g.set(x, y, "G")
    g.rect(30, 60, 33, 62, "1")  # a silhouette of the chair
    g.hline(28, 35, 62, "1")
    # pipes: left down-pipe with brackets, right pipe with an elbow into the wall
    g.rect(1, 20, 2, 65, "3")
    g.vline(1, 20, 65, "4")
    for y in (30, 48):
        g.rect(1, y, 3, y + 1, "1")
    g.rect(60, 28, 61, 65, "2")
    g.vline(60, 28, 65, "3")
    g.rect(58, 26, 61, 27, "2")
    g.hline(58, 61, 26, "3")
    g.rect(60, 44, 62, 45, "1")
    # AC unit on the right pillar
    g.rect(53, 31, 58, 38, "3")
    g.hline(53, 58, 31, "4")
    for y in (33, 35, 37):
        g.hline(54, 57, y, "1")
    # small neon accents on the pillars
    g.rect(6, 34, 7, 35, "M")
    g.set(6, 34, "N")
    g.vline(56, 44, 52, "C")
    g.vline(55, 44, 52, "e")
    # awning with a green neon strip and the light it casts
    g.rect(1, 15, 62, 19, "1")
    g.hline(1, 62, 15, "4")
    g.hline(1, 62, 16, "3")
    g.hline(2, 61, 19, "G")
    g.hline(5, 58, 20, "i")
    for x in range(14, 50):
        if x % 2 == 0:
            g.set(x, 26, "i")
    # sign: dark box, cyan neon frame, glowing green medical cross
    g.rect(24, 13, 25, 14, "1")
    g.rect(38, 13, 39, 14, "1")
    g.rect(20, 1, 43, 12, "P")
    for x in range(20, 44):
        g.set(x, 1, "C")
        g.set(x, 12, "c")
    for y in range(1, 13):
        g.set(20, y, "C")
        g.set(43, y, "c")
    cross = {(x, y) for x in range(30, 34) for y in range(2, 12)} | {(x, y) for x in range(26, 38) for y in range(5, 9)}
    shade_rim(g, cross, "G", dark="i")
    g.set(30, 2, "W")
    g.set(26, 5, "W")
    for (x, y) in edge_pts(cross, N4):
        for dx, dy in N4:
            if g.get(x + dx, y + dy) == "P":
                g.set(x + dx, y + dy, "e")
    # grime: drips under the awning, dirty specks on the metal
    for x in range(5, 59):
        if rng.random() < 0.18 and g.get(x, 21) in ("2", "3"):
            for y in range(21, 21 + rng.randint(2, 7)):
                if g.get(x, y) in ("2", "3"):
                    g.set(x, y, "1")
    for y in range(20, 66):
        for x in range(4, 60):
            if g.get(x, y) in ("2", "3") and rng.random() < 0.05:
                g.set(x, y, "1")
    g.outline()
    # soft neon halo around the sign (outside its outline)
    for y in range(0, 14):
        for x in range(15, 49):
            if g.get(x, y) == "." and any(g.get(x + dx, y + dy) == "K" for dx, dy in N4):
                g.set(x, y, "f")
    return g.image()


# ================================================================= PREVIEW ===
def make_preview(sheets, path):
    S = 4
    bg = rgba("#140a24")
    try:
        font = ImageFont.load_default(size=16)
    except TypeError:
        font = ImageFont.load_default()

    def tile(im, n):
        out = Image.new("RGBA", (im.width * n, im.height), (0, 0, 0, 0))
        for i in range(n):
            out.alpha_composite(im, (i * im.width, 0))
        return out

    items = []
    for name, im, frame_w in sheets:
        items.append((f"{name}  {im.width}x{im.height}", im, frame_w))
        if name == "platform.png":
            row = Image.new("RGBA", (320, 16), (0, 0, 0, 0))
            row.alpha_composite(im.crop((0, 0, 32, 16)), (0, 0))
            for i in range(1, 9):
                row.alpha_composite(im.crop((32, 0, 64, 16)), (i * 32, 0))
            row.alpha_composite(im.crop((64, 0, 96, 16)), (288, 0))
            items.append(("platform.png tiled: cap + 8 middles + cap", row, None))
        if name in ("skyline.png", "ground.png"):
            items.append((f"{name} x2 side by side (seam check)", tile(im, 2), None))
    pad = 16
    width = max(im.width * S for _, im, _ in items) + pad * 2
    height = pad + sum(24 + im.height * S + pad for _, im, _ in items)
    out = Image.new("RGBA", (width, height), bg)
    d = ImageDraw.Draw(out)
    y = pad
    for label, im, frame_w in items:
        d.text((pad, y), label, fill=(220, 210, 255, 255), font=font)
        y += 24
        big = im.resize((im.width * S, im.height * S), Image.NEAREST)
        if frame_w:
            for fx in range(0, im.width, frame_w):
                d.rectangle([pad + fx * S, y, pad + (fx + frame_w) * S - 1, y + im.height * S - 1],
                            outline=(46, 30, 72, 255))
        out.alpha_composite(big, (pad, y))
        y += im.height * S + pad
    out.save(path)


# ==================================================================== MAIN ===
def build_all():
    return [
        ("drone.png", make_drone(), 32),
        ("crawler.png", make_crawler(), 40),
        ("pickups.png", make_pickups(), 16),
        ("icons.png", make_icons(), 24),
        ("projectiles.png", make_projectiles(), 16),
        ("platform.png", make_platform(), 32),
        ("crate.png", make_crate(), 32),
        ("skyline.png", make_skyline(), None),
        ("ground.png", make_ground(), None),
        # easter eggs
        ("hologram.png", make_hologram(), 48),
        ("dove.png", make_dove(), 16),
        ("secrets.png", make_secrets(), 24),
        ("terminal.png", make_terminal(), 24),
        ("moon.png", make_moon(), None),
        ("katana.png", make_katana(), None),
        ("ripperdoc.png", make_ripperdoc(), None),
    ]


EXPECTED = {
    "drone.png": (128, 32), "crawler.png": (160, 28), "pickups.png": (128, 16),
    "icons.png": (288, 24), "projectiles.png": (64, 16), "platform.png": (96, 16),
    "crate.png": (64, 32), "skyline.png": (480, 200), "ground.png": (64, 48),
    "hologram.png": (96, 96), "dove.png": (64, 16), "secrets.png": (192, 24),
    "terminal.png": (48, 40), "moon.png": (64, 64), "katana.png": (40, 12),
    "ripperdoc.png": (64, 72),
}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=IMG_DIR, help="output directory (default: img/)")
    ap.add_argument("--preview", help="also write a 4x contact sheet to this path")
    args = ap.parse_args()
    random.seed(SEED)
    sheets = build_all()
    os.makedirs(args.out, exist_ok=True)
    for name, im, _ in sheets:
        assert im.size == EXPECTED[name], (name, im.size)
        im.save(os.path.join(args.out, name), optimize=True)
        print(f"wrote {name:16s} {im.width}x{im.height}")
    if args.preview:
        make_preview(sheets, args.preview)
        print("wrote preview", args.preview)


if __name__ == "__main__":
    main()
