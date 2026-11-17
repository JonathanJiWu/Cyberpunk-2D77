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

Cyber re-skins (recoloured in place from the existing sheets, read-only):
    reaper-cyber.png 200x192  from death.png    (4x4 frames of 50x48)
    dragon-cyber.png 384x384  from dragon.png   (4x4 frames of 96x96)
    goat-cyber.png   320x320  from redgoat.png  (4x4 frames of 80x80)
City:
    aerodyne.png     128x24   2 frames of 64x24   flying car
    city-mid.png     640x420  seamless dense midground cityscape
    facade.png       128x64   2 wall tiles of 64x64, seamless both ways
Heroes (paine.png grid: 6 rows x 4 frames of 32x48 - walk down, left, right,
up, attack left, attack right; soles on y=44, outline on y=45 like paine.png):
    tetsu.png        128x288  TETSU, chrome ronin
    sudo.png         128x288  SUDO, netrunner
    paine-attack.png 128x96   Paine's firing pose (derived from paine.png), left / right
    portraits.png    144x48   Paine, Tetsu, Sudo busts (48x48 each)
Enemies (facing right), boss and effects:
    ninja.png        160x48   4 frames of 40x48   run x3, dash
    enforcer.png     224x56   4 frames of 56x56   walk x3, shield bash
    bomber.png       128x32   4 frames of 32x32   hover x3, armed
    sniper.png       160x40   4 frames of 40x40   idle x3, recoil + flash
    overseer.png     384x96   4 frames of 96x96   idle, idle, charging, rage
    fx.png           256x32   8 effect cells of 32x32
Set pieces and final bosses (characters face RIGHT):
    hero-landing.png 128x144  rows Paine / Tetsu / Sudo x 4 frames of 32x48: fall, impact, glint, rise
    billboard.png    576x128  6 frames of 96x128  hologram ad (game adds scanlines / flicker)
    kiss.png          32x16   heart, lips
    legend.png       320x64   5 frames of 64x64   "The Legend" bust
    hardware.png     512x40   8 level-up hardware illustrations of 64x40
    overseer-avatar.png 896x96  14 frames of 64x96   humanoid Overseer chassis, feet on y=94
    goat-final.png  1344x96   14 frames of 96x96   bipedal cyber goat final boss, feet on y=94
"""

import argparse
import colorsys
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
    # heroes
    "E": "#e6e9f5",  # chrome bright
    "F": "#aab1cf",  # chrome light
    "H": "#717898",  # chrome mid
    "I": "#454a68",  # chrome dark
    "S": "#2b2e45",  # chrome deepest
    "9": "#3b1d63",  # hoodie dark
    "0": "#5a2d91",  # hoodie
    "A": "#7d48c2",  # hoodie light
    "T": "#a070e0",  # hoodie highlight
    "6": "#f0b48a",  # skin
    "7": "#c98563",  # skin shade
    "8": "#8f4a3c",  # skin dark / mouth
    "X": "#c4581e",  # hair (orange)
    "Q": "#f39a3c",  # hair highlight
    "Z": "#7a2f12",  # hair dark
    "J": "#2d3f75",  # jeans
    "j": "#1c2852",  # jeans shade
    # paine.png colours (portrait / firing pose)
    "!": "#b8ada8", "@": "#a4938c", "$": "#867670", "%": "#6b5b55", "&": "#49403d",
    "*": "#ffebce", "+": "#ffc89b", "=": "#e8a08d", "?": "#aa7162",
    "<": "#5c4766", ">": "#493357", "^": "#b7140d", "~": "#8e0f0c",
    ":": "#242424", ";": "#3a3a3a", "/": "#1f1f1f", "`": "#000000",
    # final goat fur / skin (redgoat.png family)
    ")": "#3d0a04", "[": "#751809", "]": "#ae1f08", "{": "#e2310e", "}": "#f26945",
    "|": "#2a1f1a", "-": "#533b2f", "_": "#7d5d4d",
    # translucent glows: never outlined, never count as solid
    "g": ("#19f5ff", 110),
    "h": ("#ff2fd6", 70),
    "f": ("#39ff8a", 80),
    "k": ("#39ff8a", 150),  # holo panel green
    "D": ("#19f5ff", 150),  # holo panel cyan
    "#": ("#3f7cff", 130),  # blue energy glow
    "(": ("#ff2457", 110),  # red warning glow
}
GLOW = {"g", "h", "f", "k", "D", "#", "("}
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


# ================================================================ RE-SKINS ===
# The cyber re-skins load an existing sheet (read-only) and recolour its
# pixels in place, keeping the sheet size, frame grid and silhouettes. The
# only pixels added are 1px translucent glows, clipped to each frame.
RESKIN_DELTA = {}


def load_source(name):
    with Image.open(os.path.join(IMG_DIR, name)) as im:
        return im.convert("RGBA")


def hls_of(c):
    h, l, s = colorsys.rgb_to_hls(c[0] / 255, c[1] / 255, c[2] / 255)
    return h * 360, l, s


def nearest_stop(stops, v):
    return rgba(min(stops, key=lambda st: abs(st[0] - v))[1])


def frame_cells(w, h, fw, fh):
    for fy in range(h // fh):
        for fx in range(w // fw):
            yield fx * fw, fy * fh, fy


def add_glow(op, pts, col, alpha, x0, y0, fw, fh):
    """Translucent halo on transparent pixels 4-adjacent to pts, inside the frame."""
    c = rgba(col)[:3] + (alpha,)
    for (x, y) in pts:
        for dx, dy in N4:
            nx, ny = x + dx, y + dy
            if x0 <= nx < x0 + fw and y0 <= ny < y0 + fh and op[nx, ny][3] == 0:
                op[nx, ny] = c


def check_reskin(src, out, fw, fh, name):
    """Per-frame bbox may move by at most 2px; returns the max delta."""
    worst = 0
    for x0, y0, _ in frame_cells(src.width, src.height, fw, fh):
        a = src.crop((x0, y0, x0 + fw, y0 + fh)).getbbox()
        b = out.crop((x0, y0, x0 + fw, y0 + fh)).getbbox()
        if a is None and b is None:
            continue
        d = max(abs(p - q) for p, q in zip(a, b))
        worst = max(worst, d)
    assert worst <= 2, (name, worst)
    return worst


def frame_classes(sp, x0, y0, fw, fh, classify):
    cls = {}
    for y in range(y0, y0 + fh):
        for x in range(x0, x0 + fw):
            p = sp[x, y]
            if p[3]:
                cls[(x, y)] = classify(p[:3])
    return cls


# ------------------------------------------------------------ cyber reaper ---
REAPER_ROBE = [(0.00, "#0b0416"), (0.12, "#140b26"), (0.18, "#1c1233"), (0.22, "#231840"),
               (0.28, "#2c214f"), (0.33, "#352a5c"), (0.36, "#3b3064"), (0.39, "#42376e"),
               (0.42, "#4a4078"), (0.44, "#504682"), (0.49, "#5d5490")]
REAPER_STAFF = {(0x75, 0x52, 0x2b): "#3d3560", (0x9a, 0x77, 0x37): "#5a4f86",
                (0xbe, 0x93, 0x47): "#8a80c0", (0x42, 0x2b, 0x28): "#1a0b2e"}
LIGHT_GREY = (0xcf, 0xcf, 0xcf)


def reaper_class(c):
    r, g, b = c
    if r == g == b:
        return "robe"
    if g > r and r == b:
        return "blade"
    if b > r:
        return "skull"
    return "staff"


def make_reaper_cyber():
    src = load_source("death.png")
    sp = src.load()
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    op = out.load()
    FW, FH = 50, 48
    for x0, y0, row in frame_cells(src.width, src.height, FW, FH):
        cls = frame_classes(sp, x0, y0, FW, FH, reaper_class)
        # light grey belongs to the blade where it touches it, else it is a staff band
        greys = [p for p in cls if sp[p][:3] == LIGHT_GREY]
        changed = True
        while changed:
            changed = False
            for (x, y) in greys:
                if cls[(x, y)] != "blade" and any(cls.get((x + dx, y + dy)) == "blade" for dx, dy in N8):
                    cls[(x, y)] = "blade"
                    changed = True
        for p in greys:
            if cls[p] != "blade":
                cls[p] = "band"
        # the blade body is drawn in robe greys: grow it out from the highlight line
        core = {p for p, k in cls.items() if k == "blade"}
        for (x, y), k in list(cls.items()):
            if k == "robe" and any((x + dx, y + dy) in core for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2)):
                cls[(x, y)] = "bladebody"
        ys = [y for (_, y) in cls]
        top, bot = min(ys), max(ys)
        xs = [x for (x, _) in cls]
        midx = (min(xs) + max(xs)) / 2
        blade = set()
        for (x, y), k in cls.items():
            c = sp[x, y][:3]
            h, l, s = hls_of(c)
            if k == "robe":
                col = nearest_stop(REAPER_ROBE, l)
                if c == (0, 0, 0) and y > top + (bot - top) * 0.55:
                    col = rgba("#0b5578")  # fold lines become circuit traces
            elif k == "band":
                col = rgba("#19f5ff")
            elif k == "staff":
                col = rgba(REAPER_STAFF.get(c, "#2a2440"))
            elif k == "blade":
                blade.add((x, y))
                col = rgba("#ffffff") if l >= 0.6 else rgba("#ffa6f0")
            elif k == "bladebody":
                blade.add((x, y))
                col = rgba("#ff2fd6") if l >= 0.2 else rgba("#a8189c")
            else:  # skull -> dark faceplate with red LED eyes and a dim grille
                if c == (0x16, 0x28, 0x48):
                    col = rgba("#ff2457")
                elif c == (0x71, 0xac, 0xef):
                    col = rgba("#ffffff")
                elif c == (0x35, 0x44, 0x60):
                    col = rgba("#5c0a2b")
                elif c == (0x5c, 0x47, 0x66):
                    col = rgba("#1a0b2e")
                else:
                    col = rgba("#8a80c0" if l >= 0.85 else "#5a4f86" if l >= 0.7 else
                               "#3d3560" if l >= 0.5 else "#2a2440")
            op[x, y] = col
        # trace end points light up as nodes
        traces = [p for p in cls if op[p] == rgba("#0b5578")]
        tset = set(traces)
        for (x, y) in traces:
            if sum((x + dx, y + dy) in tset for dx, dy in N8) <= 1:
                op[x, y] = rgba("#19f5ff")
        # visor band between the two glints of the front view
        glints = [p for p in cls if sp[p][:3] == (0x71, 0xac, 0xef)]
        for (ax, ay) in glints:
            for (bx, by) in glints:
                if ay == by and bx > ax + 1:
                    for x in range(ax + 1, bx):
                        if cls.get((x, ay)) == "skull":
                            op[x, ay] = rgba("#a6113e")
        # cyan rim light along the right-hand silhouette edge of the robe
        for (x, y), k in cls.items():
            if k != "robe":
                continue
            right_open = (x + 1, y) not in cls
            top_open = (x, y - 1) not in cls and x > midx
            if right_open or top_open:
                op[x, y] = rgba("#19f5ff")
                if (x - 1, y) in cls and cls[(x - 1, y)] == "robe" and right_open:
                    op[x - 1, y] = rgba("#0e9fc6")
        add_glow(op, blade, "#ff2fd6", 110, x0, y0, FW, FH)
    RESKIN_DELTA["reaper-cyber.png"] = check_reskin(src, out, FW, FH, "reaper")
    return out


# ------------------------------------------------------------- mech dragon ---
DRAGON_STEEL = [(0.10, "#0d0b17"), (0.13, "#141220"), (0.15, "#191726"), (0.22, "#232133"),
                (0.25, "#2a283b"), (0.27, "#302e42"), (0.33, "#3c3a51"), (0.38, "#49475f"),
                (0.40, "#504e67"), (0.42, "#57556e"), (0.46, "#66647e"), (0.50, "#7a7893"),
                (0.56, "#b4b2cc"), (0.60, "#ecebf7")]
DRAGON_CHROME = [(0.26, "#3e3960"), (0.34, "#524e78"), (0.39, "#67638e"), (0.45, "#7f7ca6"),
                 (0.49, "#918eb6"), (0.55, "#a7a4c9"), (0.61, "#bdbadb"), (0.64, "#cdcae8"),
                 (0.70, "#e2e0f5")]
DRAGON_HOLO = [(0.29, "#0b4f6e"), (0.39, "#0e86a8"), (0.48, "#14c3dc"), (0.58, "#3ef0ff"),
               (0.64, "#a8fbff")]
DRAGON_EYES = {(0xd0, 0x7a, 0x1b): "#a6113e", (0xe0, 0x97, 0x22): "#ff2457",
               (0xff, 0xcb, 0x30): "#ffffff", (0xff, 0xff, 0xff): "#ffffff"}


def dragon_class(c):
    if c in DRAGON_EYES:
        return "eye"
    h, l, s = hls_of(c)
    if 200 <= h <= 230 and s > 0.2:
        return "wing"
    if s < 0.12 and (h < 10 or h > 350):
        return "body"
    if 18 <= h < 26:
        return "belly"
    if 26 <= h <= 35 and l >= 0.45:
        return "claw"
    return "dark"


def make_dragon_cyber():
    src = load_source("dragon.png")
    sp = src.load()
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    op = out.load()
    FW = FH = 96
    for x0, y0, row in frame_cells(src.width, src.height, FW, FH):
        cls = frame_classes(sp, x0, y0, FW, FH, dragon_class)
        for (x, y), k in cls.items():
            c = sp[x, y][:3]
            h, l, s = hls_of(c)
            if k == "body":
                col = nearest_stop(DRAGON_STEEL, l)
            elif k == "belly":
                col = nearest_stop(DRAGON_CHROME, l)
                if (y - y0) % 6 == 0:  # armour plate segments
                    col = nearest_stop(DRAGON_CHROME, l - 0.12)
            elif k == "claw":
                col = rgba("#ffffff" if l > 0.8 else "#cdc8ef" if l > 0.6 else "#8a80c0")
            elif k == "eye":
                col = rgba(DRAGON_EYES[c])
            elif k == "dark":
                col = nearest_stop(DRAGON_STEEL, l * 0.9)
            else:  # holographic wing membrane with scanlines
                col = nearest_stop(DRAGON_HOLO, l)
                a = 190
                if (y - y0) % 3 == 2:
                    col = tuple(int(v * 0.7) for v in col[:3]) + (255,)
                    a = 150
                col = col[:3] + (a,)
            op[x, y] = col
        # neon seams where the plating meets the chest armour; glowing wing struts
        for (x, y), k in cls.items():
            if k != "body":
                continue
            nb = [cls.get((x + dx, y + dy)) for dx, dy in N4]
            if "belly" in nb:
                op[x, y] = rgba("#19f5ff")
            elif nb.count("wing") >= 2:
                op[x, y] = rgba("#ff2fd6")
            elif "wing" in nb:
                op[x, y] = rgba("#a8189c")
        if row == 3:  # back view: neon spine seam and glowing wing edges
            cx = x0 + 47
            for (x, y), k in cls.items():
                if k != "body":
                    continue
                if x in (cx, cx + 1) and (y - y0) % 3 != 0 and y > min(p[1] for p in cls) + 16:
                    op[x, y] = rgba("#19f5ff")
                elif (x, y - 1) not in cls and abs(x - cx) > 12:
                    op[x, y] = rgba("#ff2fd6")
        # orange thruster glow near the tail tip (side and back views)
        if row in (1, 2, 3):
            low = [p for p in cls if p[1] > y0 + 40]
            if row == 1:
                tip = max(low, key=lambda p: (p[0], -p[1]))
                core, outward = (tip[0] - 3, tip[1]), (1, 0)
            elif row == 2:
                tip = min(low, key=lambda p: (p[0], p[1]))
                core, outward = (tip[0] + 3, tip[1]), (-1, 0)
            else:
                tip = max(low, key=lambda p: (p[1], -abs(p[0] - x0 - 48)))
                core, outward = (tip[0], tip[1] - 3), (0, 1)
            hot = []
            for (x, y) in cls:
                d = math.hypot(x - core[0], y - core[1])
                if d <= 1.0:
                    op[x, y] = rgba("#fff6b8")
                elif d <= 2.3:
                    op[x, y] = rgba("#ff9b21")
                    hot.append((x, y))
            ex, ey = tip[0] + outward[0], tip[1] + outward[1]
            if x0 <= ex < x0 + FW and y0 <= ey < y0 + FH and op[ex, ey][3] == 0:
                op[ex, ey] = rgba("#ff9b21")[:3] + (150,)
    RESKIN_DELTA["dragon-cyber.png"] = check_reskin(src, out, FW, FH, "dragon")
    return out


# --------------------------------------------------------------- cyber goat ---
GOAT_EYES = {(0xbc, 0xa3, 0x00): "#b5fcff", (0x89, 0x6b, 0x00): "#19f5ff"}
GOAT_STEEL = [(0.00, "#0b0416"), (0.12, "#2a2440"), (0.19, "#3d3560"), (0.26, "#5a4f86"),
              (0.31, "#7a71b0"), (0.34, "#9a92cc"), (0.36, "#b4aedb"), (0.40, "#cdc8ef")]


def goat_class(c):
    if c in GOAT_EYES:
        return "eye"
    if c == (0, 0, 0):
        return "black"
    r, g, b = c
    h, l, s = hls_of(c)
    if r == g == b:
        return "grey"
    if 38 <= h <= 60 or (30 <= h < 38 and s > 0.85):
        return "staff"
    if 15 <= h <= 30 and l < 0.17:
        return "stroke"
    return "keep"


def make_goat_cyber():
    src = load_source("redgoat.png")
    sp = src.load()
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    op = out.load()
    FW = FH = 80
    for x0, y0, row in frame_cells(src.width, src.height, FW, FH):
        cls = frame_classes(sp, x0, y0, FW, FH, goat_class)
        ys = [y for (_, y) in cls]
        top, bot = min(ys), max(ys)
        horn_line = top + (bot - top) * 0.3
        staff = set()
        red = {p for p, k in cls.items() if k == "keep" and hls_of(sp[p][:3])[2] > 0.5}
        for (x, y), k in cls.items():
            c = sp[x, y][:3]
            h, l, s = hls_of(c)
            if k == "keep":
                col = sp[x, y]
            elif k == "black":
                col = rgba("#0b0416")
            elif k == "grey":
                col = nearest_stop(GOAT_STEEL, l)
            elif k == "eye":
                col = rgba(GOAT_EYES[c])
            elif k == "stroke":
                # muscle strokes on the fur become circuit traces
                nb = sum((x + dx, y + dy) in red for dx, dy in N4)
                col = rgba("#0e9fc6") if nb >= 2 else sp[x, y]
            else:  # staff -> neon energy staff: magenta edge, cyan body, white core
                staff.add((x, y))
                col = rgba("#ffffff" if l >= 0.78 else "#19f5ff" if l >= 0.5 else
                           "#0e9fc6" if l >= 0.3 else "#ff2fd6")
            op[x, y] = col
        # trace nodes
        traces = {p for p in cls if op[p] == rgba("#0e9fc6") and cls[p] == "stroke"}
        for (x, y) in traces:
            if sum((x + dx, y + dy) in traces for dx, dy in N8) <= 1:
                op[x, y] = rgba("#19f5ff")
        # chrome horns with neon tips (connected grey blobs above the head)
        horns = {p for p, k in cls.items() if k in ("grey", "black") and p[1] < horn_line}
        seen = set()
        for start in sorted(horns):
            if start in seen or cls[start] != "grey":
                continue
            comp, stack_ = [], [start]
            seen.add(start)
            while stack_:
                p = stack_.pop()
                comp.append(p)
                for dx, dy in N8:
                    q = (p[0] + dx, p[1] + dy)
                    if q in horns and q not in seen:
                        seen.add(q)
                        stack_.append(q)
            ty = min(y for (_, y) in comp)
            for (x, y) in comp:
                if y <= ty + 1:
                    op[x, y] = rgba("#b5fcff" if y == ty else "#19f5ff")
                elif y <= ty + 3 and cls[(x, y)] == "grey":
                    op[x, y] = rgba("#19f5ff")
        # chrome implant ring around the left-most eye
        eyes = [p for p, k in cls.items() if k == "eye"]
        if eyes:
            ex = min(x for (x, _) in eyes)
            eys = [y for (x, y) in eyes if x == ex]
            for y in range(min(eys) - 1, max(eys) + 2):
                for x in (ex - 1, ex, ex + 1):
                    if (x, y) in cls and cls[(x, y)] not in ("eye",) and (x, y) not in red:
                        op[x, y] = rgba("#8a80c0" if y < min(eys) or x < ex else "#3d3560")
        add_glow(op, staff, "#19f5ff", 100, x0, y0, FW, FH)
    RESKIN_DELTA["goat-cyber.png"] = check_reskin(src, out, FW, FH, "goat")
    return out


# ================================================================ AERODYNE ===
def aerodyne_frame(f):
    W, H = 64, 24
    spoiler, body, glass = Grid(W, H), Grid(W, H), Grid(W, H)
    sp_ = poly_pts([(2.5, 5.6), (10.5, 5.6), (11.5, 7.0), (4.0, 7.8)])
    shade_rim(spoiler, sp_, "2", light="3", dark="1")
    spoiler.vline(6, 7, 8, "1")
    bp = poly_pts([(3.0, 8.6), (10, 8.2), (20, 7.6), (24, 4.2), (36, 3.8), (42, 7.4), (52, 9.6),
                   (61.6, 12.2), (61.6, 13.6), (55, 16.4), (9, 16.4), (3.4, 14.2)])
    for (x, y) in bp:
        body.set(x, y, "2" if y <= 9 else "1" if y <= 14 else "P")
    for (x, y) in edge_pts(bp, ((0, -1),)):
        body.set(x, y, "4" if 44 <= x <= 54 or 8 <= x <= 14 else "3")
    body.hline(6, 54, 11, "K")          # body crease
    body.hline(7, 53, 10, "3")
    body.hline(10, 50, 12, "m")         # magenta side accent
    body.set(10, 12, "n")
    body.set(50, 12, "M")
    body.hline(10, 53, 15, "C" if f == 0 else "c")  # underglow strip
    for x in range(12, 52, 4):
        body.set(x, 15, "B" if f == 1 else "C")
    for sx in (18, 41):                 # door seams
        body.vline(sx, 9, 14, "K")
    # headlight (right) and tail light (left)
    body.set(60, 12, "W")
    body.set(59, 12, "W")
    body.set(58, 12, "B")
    body.set(61, 13, "B")
    body.set(3, 10, "R" if f == 0 else "r")
    body.set(3, 11, "R" if f == 0 else "r")
    body.set(4, 10, "p" if f == 0 else "r")
    # marker lights that alternate between the frames
    body.set(13, 12, "O" if f == 1 else "o")
    body.set(47, 12, "O" if f == 1 else "o")
    gp = poly_pts([(21.6, 7.8), (25.2, 4.8), (35.6, 4.6), (40.6, 7.8)])
    glass.fill(gp, "e")
    for (x, y) in gp:
        if (x - y) in (21, 22, 30):
            glass.set(x, y, "c")
    glass.set(26, 5, "B")
    glass.set(27, 5, "C")
    pods = Grid(W, H)
    for (a, b) in ((11, 18), (44, 51)):
        pp = poly_pts([(a, 15.5), (b + 1, 15.5), (b, 18.4), (a + 1, 18.4)])
        shade_rim(pods, pp, "2", light="3", dark="1")
        pods.hline(a + 2, b - 1, 18, "M" if f == 0 else "m")
    beacon = Grid(W, H)
    if f == 0:
        beacon.set(7, 5, "W")
    else:
        beacon.set(7, 5, "r")
    g = stack(W, H, pods, spoiler, body, glass, beacon)
    # soft underglow below the car (outside the outline)
    for x in range(12, 52):
        if g.get(x, 20) == ".":
            g.set(x, 20, "g")
    for x in range(16, 48, 2):
        if g.get(x, 21) == ".":
            g.set(x, 21, "g")
    return g


def make_aerodyne():
    sheet = Image.new("RGBA", (128, 24), (0, 0, 0, 0))
    for f in range(2):
        sheet.paste(aerodyne_frame(f).image(), (f * 64, 0))
    return sheet


# ================================================================ CITY MID ===
class WrapCanvas:
    """RGBA canvas whose x coordinate wraps, so anything drawn tiles seamlessly."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.px = self.img.load()

    def put(self, x, y, col):
        if 0 <= y < self.h:
            self.px[x % self.w, y] = col

    def get(self, x, y):
        return self.px[x % self.w, y] if 0 <= y < self.h else (0, 0, 0, 0)

    def rect(self, x0, y0, x1, y1, col):
        for y in range(max(0, y0), min(self.h - 1, y1) + 1):
            for x in range(x0, x1 + 1):
                self.px[x % self.w, y] = col

    def blend(self, x, y, col, a):
        if not (0 <= y < self.h):
            return
        dr, dg, db, da = self.px[x % self.w, y]
        a = a / 255.0
        da = da / 255.0
        oa = a + da * (1 - a)
        if oa <= 0:
            return
        mix = [int(round((c * a + d * da * (1 - a)) / oa)) for c, d in zip(col[:3], (dr, dg, db))]
        self.px[x % self.w, y] = tuple(mix) + (int(round(oa * 255)),)


def make_glyphs(rng, n=28):
    """Abstract 5x5 neon glyphs built from strokes (deliberately not letters)."""
    out = []
    while len(out) < n:
        g = set()
        for _ in range(rng.randint(2, 3)):
            kind = rng.choice(("h", "v", "box", "dot", "diag", "hook"))
            if kind == "h":
                r, a = rng.randint(0, 4), rng.randint(0, 2)
                g |= {(c, r) for c in range(a, min(5, a + rng.randint(3, 5)))}
            elif kind == "v":
                c, a = rng.randint(0, 4), rng.randint(0, 2)
                g |= {(c, r) for r in range(a, min(5, a + rng.randint(3, 5)))}
            elif kind == "box":
                ox, oy = rng.randint(0, 2), rng.randint(0, 2)
                g |= {(ox + i, oy + j) for i in range(3) for j in range(3) if i != 1 or j != 1}
            elif kind == "dot":
                g.add((rng.randint(0, 4), rng.randint(0, 4)))
            elif kind == "diag":
                ox, oy = rng.randint(0, 2), rng.randint(0, 2)
                g |= {(ox + i, oy + i) for i in range(3)}
            else:
                c = rng.randint(1, 3)
                g |= {(c, r) for r in range(0, 4)} | {(c - 1, 4), (c + 1, 0)}
        if 7 <= len(g) <= 14:
            out.append(sorted(g))
    return out


def make_city_mid():
    rng = random.Random(SEED + 140)
    W, H = 640, 420
    cv = WrapCanvas(W, H)
    MAG, CYA, YEL, ORA = rgba("#ff2fd6"), rgba("#19f5ff"), rgba("#ffe14d"), rgba("#ff9b21")
    PALE = {MAG: rgba("#ffc2f4"), CYA: rgba("#c8fdff"), YEL: rgba("#fff6c4"), ORA: rgba("#ffd9a8")}
    NEONS = [MAG, MAG, CYA, CYA, YEL, ORA]
    LIT = [(rgba("#ffd36b"), 40), (rgba("#ffe14d"), 10), (rgba("#19f5ff"), 22), (rgba("#ff6fd8"), 20),
           (rgba("#ff9b21"), 8)]
    RED = rgba("#ff2457")
    glyphs = make_glyphs(random.Random(SEED + 141))

    def lit_colour():
        r = rng.random() * sum(w for _, w in LIT)
        for c, w in LIT:
            r -= w
            if r <= 0:
                return c
        return LIT[0][0]

    def lift(c, k):
        return tuple(min(255, max(0, v + k)) for v in c[:3]) + (255,)

    layers = [
        dict(body="#1d1442", hmin=250, hmax=410, wmin=34, wmax=66, gap=(4, 16), lit=0.12, signs=0.15),
        dict(body="#160e33", hmin=170, hmax=340, wmin=38, wmax=74, gap=(2, 12), lit=0.18, signs=0.45),
        dict(body="#100a26", hmin=90, hmax=240, wmin=44, wmax=92, gap=(0, 0), lit=0.22, signs=0.4),
    ]
    all_layers = []
    for li, L in enumerate(layers):
        base_body = rgba(L["body"])
        start = x = rng.randint(0, 20)
        blds = []
        while x < start + W:
            w = rng.randint(L["wmin"], L["wmax"])
            if li == 2 and start + W - (x + w) < L["wmin"]:
                w = start + W - x
            wave = 0.5 + 0.5 * math.sin(2 * math.pi * (x + w / 2) / W * 2 + li * 1.7)
            h = int(L["hmin"] + (L["hmax"] - L["hmin"]) * (0.4 * wave + 0.6 * rng.random()))
            blds.append(dict(x=x, w=w, h=h, top=H - h))
            x += w + rng.randint(*L["gap"])
        all_layers.append(blds)

        for b in blds:
            bx, w, top = b["x"], b["w"], b["top"]
            tint = rng.choice(((0, 0, 0), (-3, -1, 6), (4, 0, 3), (-2, 1, 2)))
            body = tuple(min(255, max(0, v + t)) for v, t in zip(base_body[:3], tint)) + (255,)
            rim, dark = lift(body, 22), lift(body, -9)
            cv.rect(bx, top, bx + w - 1, H - 1, body)
            # crown: setback / parapet / slanted cap
            style = rng.choice(("parapet", "setback", "setback", "slant", "flat"))
            if style == "setback" and w > 40:
                ins = rng.randint(5, w // 4)
                th = rng.randint(8, 22)
                cv.rect(bx + ins, top - th, bx + w - 1 - ins, top - 1, body)
                cv.rect(bx + ins, top - th, bx + w - 1 - ins, top - th, rim)
                b["crown"] = (bx + ins, bx + w - 1 - ins, top - th)
            elif style == "slant":
                for c in range(w):
                    rise = c // 4
                    cv.rect(bx + c, top - rise, bx + c, top - 1, body)
                    cv.put(bx + c, top - rise, rim)
                b["crown"] = (bx + w - 3, bx + w - 1, top - (w - 1) // 4)
            elif style == "parapet":
                for c in range(0, w, 3):
                    cv.put(bx + c, top - 1, rim)
                b["crown"] = (bx, bx + w - 1, top)
            else:
                b["crown"] = (bx, bx + w - 1, top)
            cv.rect(bx, top, bx + w - 1, top, rim)
            cv.rect(bx, top + 1, bx + w - 1, top + 1, lift(body, 8))
            for y in range(top, H):
                cv.put(bx, y, rim)
                cv.put(bx + w - 1, y, dark)
            # window grid
            ww, wh, sx, sy = rng.choice(((2, 2, 4, 5), (1, 2, 3, 4), (3, 1, 5, 4), (2, 1, 4, 3), (2, 3, 4, 6)))
            dim = lift(body, 8)
            p_lit = L["lit"] * (0.5 + rng.random())
            prim, sec = lit_colour(), lit_colour()
            stripe = rng.random() < 0.25
            for wy in range(top + 6, H - 3, sy):
                active = rng.random() < 0.6  # whole floors are either busy or mostly dark
                for wx in range(bx + 3, bx + w - 3 - ww, sx):
                    lit = rng.random() < p_lit * (1.9 if active else 0.2)
                    if stripe and (wx - bx) // sx % 5 == 2:
                        lit = rng.random() < 0.85
                    col = (prim if rng.random() < 0.8 else sec) if lit else dim
                    if lit and li == 0:
                        col = tuple(int(v * 0.75) for v in col[:3]) + (255,)
                    cv.rect(wx, wy, wx + ww - 1, wy + wh - 1, col)
            # vertical neon strip down one corner
            if li > 0 and rng.random() < 0.22 and b["h"] > 100:
                col = rng.choice(NEONS)
                ex = bx + 1 if rng.random() < 0.5 else bx + w - 2
                y0_ = top + rng.randint(4, 20)
                for y in range(y0_, min(H, y0_ + rng.randint(40, 130))):
                    cv.put(ex, y, col)
                    cv.blend(ex - 1, y, col, 60)
                    cv.blend(ex + 1, y, col, 60)
            # horizontal neon tube along a floor line
            for _ in range(2 if b["h"] > 200 else 1):
                if li == 0 or rng.random() > 0.45:
                    continue
                ny = top + rng.randint(12, max(13, min(110, b["h"] - 30)))
                col = rng.choice(NEONS)
                for x in range(bx + 2, bx + w - 2):
                    cv.put(x, ny, col)
                    cv.blend(x, ny + 1, col, 70)
                    cv.blend(x, ny - 1, col, 45)
            # neon roofline on some buildings
            if rng.random() < 0.25:
                col = rng.choice(NEONS)
                x0_, x1_, ty = b["crown"]
                for x in range(x0_, x1_ + 1):
                    cv.put(x, ty, col)
            # side pipe
            if rng.random() < 0.3 and b["h"] > 120:
                px_ = bx + (2 if rng.random() < 0.5 else w - 4)
                for y in range(top + 8, H):
                    cv.put(px_, y, lift(body, 22))
                    cv.put(px_ + 1, y, lift(body, 10))
                    if (y - top) % 14 == 0:
                        cv.put(px_ - 1, y, lift(body, 22))
                        cv.put(px_ + 2, y, lift(body, 22))
            b["li"] = li

        # rooftop furniture for this layer
        for b in blds:
            x0_, x1_, ty = b["crown"]
            span = x1_ - x0_
            r = rng.random()
            mast = lift(rgba(L["body"]), 26)
            if r < 0.35 and span >= 4:      # antenna with a red light
                ax = rng.randint(x0_ + 1, x1_ - 1)
                ah = rng.randint(10, 30)
                for y in range(ty - ah, ty):
                    cv.put(ax, y, mast)
                for cy_ in range(ty - ah + 4, ty - 2, 6):
                    cv.put(ax - 1, cy_, mast)
                    cv.put(ax + 1, cy_, mast)
                cv.put(ax, ty - ah - 1, RED)
                for dx, dy in N4:
                    cv.blend(ax + dx, ty - ah - 1 + dy, RED, 70)
            elif r < 0.6 and span >= 14:    # water tank on legs
                tw = rng.randint(8, min(12, span - 2))
                tx = rng.randint(x0_ + 1, x1_ - tw)
                tank = lift(rgba(L["body"]), 14)
                for lx in (tx + 1, tx + tw - 2):
                    cv.rect(lx, ty - 3, lx, ty - 1, mast)
                cv.rect(tx, ty - 12, tx + tw - 1, ty - 4, tank)
                for yy in (ty - 10, ty - 7):
                    cv.rect(tx, yy, tx + tw - 1, yy, lift(tank, -10))
                cv.rect(tx + 1, ty - 13, tx + tw - 2, ty - 13, tank)
                cv.rect(tx + 3, ty - 14, tx + tw - 4, ty - 14, tank)
                cv.rect(tx, ty - 12, tx, ty - 4, lift(tank, 12))
            elif r < 0.8 and span >= 10:    # rooftop pipes + AC box
                cv.rect(x0_ + 2, ty - 4, x0_ + 6, ty - 1, lift(rgba(L["body"]), 18))
                for x in range(x0_ + 6, x1_ - 1):
                    cv.put(x, ty - 2, mast)
                cv.rect(x1_ - 2, ty - 6, x1_ - 2, ty - 2, mast)

        # vertical glyph signs hung off building corners
        for b in blds:
            if rng.random() > L["signs"] or b["h"] < 120:
                continue
            n = rng.randint(4, 8)
            sw, sh = 9, n * 7 + 3
            col = rng.choice(NEONS)
            right = rng.random() < 0.5
            sx_ = b["x"] + b["w"] - 4 if right else b["x"] - 5
            sy_ = b["top"] + rng.randint(10, max(11, min(60, b["h"] - sh - 20)))
            if sy_ + sh > H - 10:
                continue
            for yy in range(sy_ - 2, sy_ + sh + 2):  # glow halo
                for xx in range(sx_ - 2, sx_ + sw + 2):
                    cv.blend(xx, yy, col, 34)
            cv.rect(sx_, sy_, sx_ + sw - 1, sy_ + sh - 1, rgba("#0b0518"))
            for xx in range(sx_, sx_ + sw):
                cv.put(xx, sy_, col)
                cv.put(xx, sy_ + sh - 1, col)
            for yy in range(sy_, sy_ + sh):
                cv.put(sx_, yy, col)
                cv.put(sx_ + sw - 1, yy, col)
            for i in range(n):
                gl = rng.choice(glyphs)
                for (gx, gy) in gl:
                    cv.put(sx_ + 2 + gx, sy_ + 2 + i * 7 + gy, PALE[col] if gy == 2 else col)
            for yy in (sy_ - 2, sy_ - 1, sy_ + sh, sy_ + sh + 1):  # mounting pole
                cv.put(sx_ + sw // 2, yy, rgba("#3d3560"))

        # cables over lower buildings (between buildings i and i+2)
        if li > 0:
            for i in range(len(blds)):
                a, mid_, c = blds[i], blds[(i + 1) % len(blds)], blds[(i + 2) % len(blds)]
                hi_top = max(a["top"], c["top"])
                if mid_["top"] - hi_top < 18 or rng.random() < 0.15:
                    continue
                xa = a["x"] + a["w"] - 1
                xc = c["x"] + (W if c["x"] < a["x"] else 0)
                ya = rng.randint(hi_top + 4, min(hi_top + 20, mid_["top"] - 14))
                yc = ya + rng.randint(-4, 4)
                sag = rng.randint(5, 12)
                lights = rng.random() < 0.6
                lc = rng.choice((YEL, MAG, CYA))
                for k in range(xc - xa + 1):
                    t = k / max(1, xc - xa)
                    y = int(round(ya + (yc - ya) * t + sag * 4 * t * (1 - t)))
                    cv.put(xa + k, y, rgba("#07040f"))
                    if lights and k % 6 == 3:
                        cv.put(xa + k, y + 1, lc)
        # short cables across the gaps between neighbouring buildings
        if li < 2:
            for i in range(len(blds)):
                a, c = blds[i], blds[(i + 1) % len(blds)]
                xa = a["x"] + a["w"] - 1
                xc = c["x"] + (W if c["x"] < a["x"] else 0)
                if xc - xa < 5 or rng.random() < 0.3:
                    continue
                for _ in range(rng.randint(1, 3)):
                    hi_top = max(a["top"], c["top"])
                    ya = rng.randint(hi_top + 10, min(H - 60, hi_top + 120))
                    yc = ya + rng.randint(-6, 6)
                    sag = rng.randint(2, 5)
                    for k in range(xc - xa + 1):
                        t = k / max(1, xc - xa)
                        y = int(round(ya + (yc - ya) * t + sag * 4 * t * (1 - t)))
                        cv.put(xa + k, y, rgba("#07040f"))

    # holographic billboards on two tall mid-layer buildings
    tall = sorted([b for b in all_layers[1] if b["w"] >= 46], key=lambda b: b["top"])[:2]
    for n, b in enumerate(tall):
        bw, bh = 40, 26
        ox = b["x"] + (b["w"] - bw) // 2 + (8 if n == 0 else -8)
        oy = b["top"] + 14
        main, acc = (CYA, MAG) if n == 0 else (MAG, CYA)
        for y in range(oy, oy + bh):
            for x in range(ox, ox + bw):
                edge = x in (ox, ox + bw - 1) or y in (oy, oy + bh - 1)
                scan = (y - oy) % 3 == 2
                cv.blend(x, y, main, 170 if edge else (30 if scan else 70))
        if n == 0:   # ringed planet
            for y in range(oy + 3, oy + bh - 3):
                for x in range(ox + 3, ox + bw - 3):
                    d = math.hypot(x + 0.5 - (ox + 20), (y + 0.5 - (oy + 13)))
                    ring = abs(math.hypot((x + 0.5 - (ox + 20)) / 15.0, (y + 0.5 - (oy + 13)) / 4.0) - 1) < 0.09
                    if d <= 7.5 and (y - oy) % 3 != 2:
                        cv.blend(x, y, acc, 200 if d > 6.4 else 150)
                    elif ring and (y > oy + 13 or d > 7.5):
                        cv.blend(x, y, rgba("#ffffff"), 190)
        else:        # chevrons + bars
            for k in range(3):
                for i in range(6):
                    for (x, y) in ((ox + 6 + k * 8 + i, oy + 7 + i), (ox + 6 + k * 8 + i, oy + 18 - i)):
                        if (y - oy) % 3 != 2:
                            cv.blend(x, y, acc, 210)
            for i in range(3):
                cv.rect(ox + 30, oy + 7 + i * 4, ox + 35, oy + 8 + i * 4, rgba("#ffffff")[:3] + (255,))
        # mounting struts
        for x in (ox + 6, ox + bw - 7):
            cv.put(x, oy + bh, rgba("#2a2440"))
            cv.put(x, oy + bh + 1, rgba("#2a2440"))
    return cv.img


# ================================================================== FACADE ===
def make_facade():
    sheet = Image.new("RGBA", (128, 64), (0, 0, 0, 0))
    WALL, SEAM, PIL_ = rgba("#140c26"), rgba("#0f081f"), rgba("#191030")
    SILL, DARKW, REFL = rgba("#21173a"), rgba("#0b0617"), rgba("#2a2050")
    LITS = [(rgba("#e0a84a"), rgba("#ffd36b")), (rgba("#14a9bd"), rgba("#19f5ff")),
            (rgba("#c24a98"), rgba("#ff6fd8"))]
    for v in range(2):
        rng = random.Random(SEED + 160 + v)
        tile = Image.new("RGBA", (64, 64), WALL)
        px = tile.load()
        for y in range(64):
            for x in range(64):
                if x % 32 == 0:
                    px[x, y] = PIL_
                if y % 16 == 15:
                    px[x, y] = SEAM
        for cy in range(8):
            for cx in range(8):
                x0, y0 = cx * 8 + 2, cy * 8 + 1
                r = rng.random()
                if r < 0.17:
                    base, top = LITS[rng.randrange(3)]
                    for y in range(y0, y0 + 5):
                        for x in range(x0, x0 + 4):
                            px[x, y] = top if y == y0 else base
                    if rng.random() < 0.4:  # half-drawn blind
                        for x in range(x0, x0 + 4):
                            px[x, y0 + 1] = tuple(int(c * 0.6) for c in base[:3]) + (255,)
                    px[x0 + 1, y0 + 4] = tuple(int(c * 0.7) for c in base[:3]) + (255,)
                else:
                    for y in range(y0, y0 + 5):
                        for x in range(x0, x0 + 4):
                            px[x, y] = DARKW
                    if r < 0.45:
                        px[x0, y0] = REFL
                for x in range(x0 - 1, x0 + 5):
                    px[x, y0 + 5] = SILL
        if v == 1:
            # thin vertical neon strip between window columns (runs the full height)
            for y in range(64):
                px[40, y] = rgba("#ff2fd6")
                for x in (39, 41):
                    px[x, y] = rgba("#3a1046")
            # wall-mounted AC unit with a drip stain
            box = rgba("#3d3560")
            for y in range(23, 30):
                for x in range(9, 18):
                    px[x, y] = box
            for x in range(9, 18):
                px[x, 23] = rgba("#5a4f86")
                px[x, 29] = rgba("#2a2440")
            for y in (25, 27):
                for x in range(10, 13):
                    px[x, y] = rgba("#2a2440")
            fan = ellipse_pts(15.0, 26.0, 2.0, 2.0)
            for (x, y) in fan:
                px[x, y] = rgba("#2a2440")
            px[15, 26] = rgba("#8a80c0")
            for y in range(30, 38):
                px[8, y] = rgba("#0d071b")
        sheet.paste(tile, (v * 64, 0))
    return sheet


# ================================================================== HEROES ===
# Playable heroes share paine.png's grid: 32x48 frames, rows = walk down,
# walk left, walk right (mirror of left), walk up, attack left, attack right
# (mirror). Walk frames 0 and 2 are the neutral pose, 1 and 3 are steps with
# the upper body 1px lower. Shoe soles sit on y=44 so the outline row is 45,
# exactly like paine.png.
HW, HH = 32, 48


def layer():
    return Grid(HW, HH)


def put_ascii(g, rows, x0, y0, flip=False):
    for y, row in enumerate(rows):
        if flip:
            row = row[::-1]
        for x, ch in enumerate(row):
            if ch != ".":
                g.set(x0 + x, y0 + y, ch)


def hero_sheet(frame_fn, rows=(0, 1, 2, 3, 4, 5)):
    sheet = Image.new("RGBA", (128, len(rows) * 48), (0, 0, 0, 0))
    for i, r in enumerate(rows):
        for f in range(4):
            sheet.paste(frame_fn(r, f).image(), (f * 32, i * 48))
    return sheet


def mirrored(g):
    out = g.flipped()
    out.outlined = g.outlined
    return out


# -------------------------------------------------------------------- SUDO ---
SUDO_SHOE_FRONT = [".sWWs.", "WWWWWs", "GWWWWG", "tttttt"]
SUDO_SHOE_SIDE = ["..sWWW.", ".WWGGWW", "WWWWWWs", "ttttttt"]
SUDO_SHOE_BACK = [".WWWW.", "WWWWWW", "sGWWGs", "tttttt"]


def messy_hair(cx, cy, rx, ry, spikes, strands=()):
    """Ellipse of hair with triangular spikes (angle deg, length, half width)
    pushed out from its edge; returns (pts, strand pixels)."""
    pts = ellipse_pts(cx, cy, rx, ry)
    for (ang, ln, w) in spikes:
        a = math.radians(ang)
        ex, ey = cx + rx * 0.92 * math.cos(a), cy + ry * 0.92 * math.sin(a)
        tx, ty = cx + (rx + ln) * math.cos(a), cy + (ry + ln) * math.sin(a)
        nx_, ny_ = -math.sin(a), math.cos(a)
        pts |= poly_pts([(ex + nx_ * w, ey + ny_ * w), (tx, ty), (ex - nx_ * w, ey - ny_ * w)])
    lines = set()
    for (a, b_) in strands:
        lines |= set(line_pts(*a, *b_))
    return pts, lines & pts


def shade_hair(g, hp, lines, b, dark_from):
    g.fill(hp, "X")
    for (x, y) in hp:
        if (x - 1, y - 1) not in hp or (x, y - 1) not in hp:
            g.set(x, y, "Q")
        elif (x + 1, y + 1) not in hp or y >= dark_from + b:
            g.set(x, y, "Z")
    for (x, y) in lines:
        if g.get(x, y) == "X":
            g.set(x, y, "Z")


def sudo_head(view, b, f):
    """Hair, face, glasses and headset. view: 'front', 'side' (facing left), 'back'."""
    hair, face, gear = layer(), layer(), layer()
    tip = "G" if f % 2 == 0 else "W"
    if view in ("front", "back"):
        spikes = [(-165, 2.5, 2.0), (-135, 3.2, 2.4), (-105, 1.6, 2.4), (-75, 1.6, 2.4), (-45, 3.2, 2.4),
                  (-12, 3.0, 2.0), (10, 2.5, 1.8), (170, 2.5, 1.8)]
        cy_ = 10.0 + b
        strands = [((16, 3 + b), (11, 9 + b)), ((16, 3 + b), (20, 9 + b)), ((13, 2 + b), (9, 8 + b)), ((19, 2 + b), (23, 8 + b))]
        if view == "back":
            spikes += [(55, 2.5, 2.0), (80, 3.0, 2.0), (100, 3.0, 2.0), (125, 2.5, 2.0)]
            cy_ = 10.0 + b
            strands = [((16, 3 + b), (x_, 19 + b)) for x_ in (9, 12, 15, 18, 21, 24)]
        hp, lines = messy_hair(16.0, cy_, 9.0, 7.6, spikes, strands)
        shade_hair(hair, hp, lines, b, 17 if view == "front" else 19)
        if view == "front":
            fp = {(x, y) for (x, y) in ellipse_pts(15.8, 13.8 + b, 6.3, 6.6, p=2.4) if y >= 9 + b}
            face.fill(fp, "6")
            for (x, y) in fp:
                if x >= 20 or y >= 19 + b:
                    face.set(x, y, "7")
            for (x, y) in ((11, 9), (12, 9), (12, 10), (15, 9), (16, 9), (16, 10), (17, 9), (20, 9), (20, 10), (21, 9)):
                face.set(x, y + b, "X")  # jagged bangs
            for cx in (12.6, 19.0):
                ring = ellipse_pts(cx, 13.6 + b, 2.7, 2.7)
                face.fill(ring, "C")
                face.fill(edge_pts(ring, N4), "K")
                lx, ly = int(cx) - 1, 12 + b
                face.set(lx, ly, "B")
                face.set(int(cx) + 1, 15 + b, "c")
            face.hline(15, 16, 13 + b, "K")
            face.set(15, 18 + b, "8")
            face.set(16, 18 + b, "8")
            face.set(14, 17 + b, "7")
            face.set(17, 17 + b, "7")
            face.set(11, 17 + b, "p")
            face.set(21, 17 + b, "p")
            face.rect(14, 19 + b, 17, 21 + b, "7")
            # headset: band over the hair, ear cups, mic boom, antenna
            for i in range(41):
                a = math.pi + math.pi * i / 40
                gear.set(int(round(16 + 7.6 * math.cos(a))), int(round(11.0 + b + 7.4 * math.sin(a))), "2")
            for x0 in (6, 23):
                gear.rect(x0, 12 + b, x0 + 2, 16 + b, "2")
                gear.vline(x0, 12 + b, 16 + b, "3")
                gear.set(x0 + 1, 14 + b, "G")
            gear.line(8, 17 + b, 11, 19 + b, "2")
            gear.set(12, 19 + b, "M")
            gear.line(25, 11 + b, 27, 5 + b, "3")
            gear.set(27, 4 + b, tip)
        else:
            for i in range(41):
                a = math.pi * i / 40
                gear.set(int(round(16 + 7.6 * math.cos(a + math.pi))), int(round(11.0 + b - 7.4 * math.sin(a))), "2")
            for x0 in (6, 23):
                gear.rect(x0, 12 + b, x0 + 2, 16 + b, "2")
                gear.vline(x0 + 2, 12 + b, 16 + b, "3")
            gear.line(6, 11 + b, 4, 5 + b, "3")
            gear.set(4, 4 + b, tip)
            gear.set(16, 20 + b, "G")  # neck port seen from behind
    else:  # side, facing left
        spikes = [(-160, 2.5, 2.0), (-125, 2.8, 2.4), (-95, 1.6, 2.4), (-62, 2.4, 2.4), (-30, 4.0, 2.4),
                  (0, 4.0, 2.2), (28, 3.5, 2.0), (55, 2.5, 1.8)]
        strands = [((15, 3 + b), (22, 8 + b)), ((18, 3 + b), (24, 11 + b)), ((14, 4 + b), (19, 9 + b)),
                   ((21, 12 + b), (23, 17 + b))]
        hp, lines = messy_hair(16.8, 10.2 + b, 8.2, 7.6, spikes, strands)
        hp |= poly_pts([(18, 14 + b), (25, 12 + b), (24, 19.5 + b), (18, 19.5 + b)])
        shade_hair(hair, hp, lines, b, 18)
        fp = {(x, y) for (x, y) in ellipse_pts(12.4, 13.8 + b, 5.2, 6.2, p=2.4) if y >= 9 + b}
        fp.add((7, 14 + b))
        face.fill(fp, "6")
        for (x, y) in fp:
            if x >= 16 or y >= 19 + b:
                face.set(x, y, "7")
        for (x, y) in ((8, 9), (9, 9), (9, 10), (12, 9), (13, 9), (13, 10), (14, 9), (8, 10)):
            face.set(x, y + b, "X")
        ring = ellipse_pts(10.6, 13.6 + b, 2.7, 2.7)
        face.fill(ring, "C")
        face.fill(edge_pts(ring, N4), "K")
        face.set(9, 12 + b, "B")
        face.set(11, 15 + b, "c")
        face.hline(13, 16, 13 + b, "K")
        face.set(8, 18 + b, "8")
        face.set(9, 18 + b, "8")
        face.set(12, 17 + b, "p")
        face.rect(13, 19 + b, 16, 21 + b, "7")
        gear.rect(16, 12 + b, 19, 16 + b, "2")
        gear.vline(16, 12 + b, 16 + b, "3")
        gear.set(17, 14 + b, "G")
        for y in range(3, 12):
            gear.set(17 + (1 if y < 6 else 0), y + b, "3")
        gear.line(16, 17 + b, 12, 19 + b, "2")
        gear.set(11, 19 + b, "M")
        gear.line(19, 11 + b, 22, 5 + b, "3")
        gear.set(22, 4 + b, tip)
    return hair, face, gear


def sudo_body(view, b, arm_pose, f):
    """Torso (hoodie), arms and cyberdeck. arm_pose: 'neutral', 'fwd', 'back' for walking."""
    torso, near_arm, far_arm, deck, cable = layer(), layer(), layer(), layer(), layer()
    if view in ("front", "back"):
        tp = poly_pts([(8.5, 21.5 + b), (23.5, 21.5 + b), (24.5, 25 + b), (24.2, 35.5), (7.8, 35.5), (7.5, 25 + b)])
        torso.fill(tp, "0")
        for (x, y) in tp:
            if x <= 9:
                torso.set(x, y, "A")
            elif x >= 22:
                torso.set(x, y, "9")
            if y >= 34:
                torso.set(x, y, "9" if x % 2 else "0")
        if view == "front":
            hood = ellipse_pts(16.0, 21.5 + b, 7.0, 2.6)
            torso.fill(hood, "A")
            torso.fill({(x, y) for (x, y) in hood if abs(x + 0.5 - 16) < 3.5 and y >= 21 + b}, "9")
            for sx in (14, 18):
                torso.vline(sx, 23 + b, 26 + b, "s")
            torso.hline(11, 20, 29 + b, "9")
            torso.vline(10, 30 + b, 32 + b, "9")
            torso.vline(21, 30 + b, 32 + b, "9")
            for (a, c) in (((12, 24), (12, 27)), ((12, 27), (15, 27)), ((20, 24), (20, 26)), ((20, 26), (18, 26))):
                torso.line(a[0], a[1] + b, c[0], c[1] + b, "G")
            for (x, y) in ((15, 27), (18, 26), (12, 24), (20, 24)):
                torso.set(x, y + b, "W" if (x + y) % 2 else "G")
            torso.set(22, 31 + b, "i")
            torso.set(9, 26 + b, "i")
        else:
            hood = poly_pts([(10.5, 20.5 + b), (21.5, 20.5 + b), (22.5, 24 + b), (19, 28.5 + b), (13, 28.5 + b), (9.5, 24 + b)])
            torso.fill(hood, "A")
            torso.fill({(x, y) for (x, y) in hood if 12 <= x <= 19 and 22 + b <= y <= 26 + b}, "0")
            torso.vline(16, 21 + b, 27 + b, "9")
            torso.rect(13, 30 + b, 18, 33 + b, "G")
            torso.rect(14, 31 + b, 17, 32 + b, "z")
            torso.set(15, 31 + b, "G")
            for (a, c) in (((12, 31), (10, 31)), ((19, 32), (22, 32)), ((16, 29), (16, 28))):
                torso.line(a[0], a[1] + b, c[0], c[1] + b, "G")
        # sleeves: hands swing a little on the step frames
        lsh = {"neutral": 0, "fwd": -1, "back": 1}[arm_pose]
        for side, sx in ((-1, 7), (1, 24)):
            dy = lsh if side < 0 else -lsh
            sp_ = capsule_pts((sx + 0.5 + (1 if side < 0 else -1), 23.5 + b), (sx + 0.5, 31.5 + b + dy), 2.3, 2.0)
            arm = near_arm
            shade_rim(arm, sp_, "0", light="A", dark="9")
            for (x, y) in sp_:
                if y >= 31 + b + dy:
                    arm.set(x, y, "9")
            arm.fill(ellipse_pts(sx + 0.5, 33.5 + b + dy, 1.4, 1.4), "6")
        dside = 24 if view == "front" else 6
        dy = (-lsh if view == "front" else lsh)
        deck.rect(dside - 1, 32 + b + dy, dside + 4, 35 + b + dy, "2")
        deck.hline(dside - 1, dside + 4, 32 + b + dy, "3")
        deck.rect(dside, 33 + b + dy, dside + 3, 34 + b + dy, "z")
        deck.set(dside + (1 if f % 2 else 2), 33 + b + dy, "G")
        deck.set(dside + 3, 34 + b + dy, "G")
        if view == "front":
            cable.fill(set(line_pts(18, 20 + b, 22, 23 + b)) | set(line_pts(22, 23 + b, 25, 31 + b + dy)), "c")
            cable.set(18, 20 + b, "G")
        else:
            cable.fill(set(line_pts(16, 21 + b, 11, 24 + b)) | set(line_pts(11, 24 + b, 8, 31 + b + dy)), "c")
    return torso, near_arm, far_arm, deck, cable


def sudo_side_body(b, hand, far_hand, lean=0, deck_far=False, f=0):
    """Side view (facing left). hand / far_hand are (x, y) positions of the near / far hand."""
    torso, near_arm, far_arm, deck, cable = layer(), layer(), layer(), layer(), layer()
    L_ = lean
    tp = poly_pts([(11.5 + L_, 21.5 + b), (19.5 + L_, 21.0 + b), (22.0 + L_, 24 + b), (22.4, 35.5), (10.4, 35.5),
                   (10.0 + L_, 27 + b)])
    torso.fill(tp, "0")
    for (x, y) in tp:
        if x <= 11 + L_:
            torso.set(x, y, "A")
        elif x >= 21 + L_:
            torso.set(x, y, "9")
        if y >= 34:
            torso.set(x, y, "9" if x % 2 else "0")
    hood = ellipse_pts(20.0 + L_, 22.0 + b, 3.6, 3.0)
    torso.fill(hood, "A")
    torso.fill({(x, y) for (x, y) in hood if x <= 19 + L_ and y >= 22 + b}, "9")
    for (a, c) in (((13, 25), (13, 28)), ((13, 28), (16, 28)), ((18, 25), (18, 27))):
        torso.line(a[0] + L_, a[1] + b, c[0] + L_, c[1] + b, "G")
    torso.set(16 + L_, 28 + b, "W")
    torso.set(18 + L_, 27 + b, "W")
    sh = (17.0 + L_, 24.0 + b)
    fsh = (19.0 + L_, 24.0 + b)
    fa = capsule_pts(fsh, far_hand, 2.0, 1.8)
    shade_rim(far_arm, fa, "9", light="0", dark="9")
    far_arm.fill(ellipse_pts(far_hand[0], far_hand[1] + 0.5, 1.3, 1.3), "7")
    na = capsule_pts(sh, hand, 2.3, 2.0)
    shade_rim(near_arm, na, "0", light="A", dark="9")
    hx, hy = hand
    for (x, y) in na:
        if math.hypot(x + 0.5 - hx, y + 0.5 - hy) < 2.2:
            near_arm.set(x, y, "9")
    near_arm.fill(ellipse_pts(hx, hy + 0.5, 1.5, 1.5), "6")
    dx_, dy_ = (far_hand if deck_far else hand)
    dx_, dy_ = int(dx_) - 3, int(dy_) - 1
    deck.rect(dx_, dy_, dx_ + 4, dy_ + 3, "2")
    deck.hline(dx_, dx_ + 4, dy_, "3")
    deck.rect(dx_ + 1, dy_ + 1, dx_ + 3, dy_ + 2, "z")
    deck.set(dx_ + (1 if f % 2 else 2), dy_ + 1, "G")
    cable.fill(set(line_pts(17 + L_, 20 + b, 15 + L_, 23 + b)) | set(line_pts(15 + L_, 23 + b, dx_ + 4, dy_ + 1)), "c")
    cable.set(17 + L_, 20 + b, "G")
    return torso, near_arm, far_arm, deck, cable


def sudo_legs(view, f):
    legs, shoes = layer(), layer()
    if view in ("front", "back"):
        la = 2 if f == 1 else 0
        ra = 2 if f == 3 else 0
        shoe = SUDO_SHOE_FRONT if view == "front" else SUDO_SHOE_BACK
        for x0, lift in ((11, la), (18, ra)):
            legs.rect(x0, 34, x0 + 2, 41 - lift, "J")
            legs.vline(x0 + 2, 34, 41 - lift, "j")
        for x0, lift in ((9, la), (17, ra)):
            put_ascii(shoes, shoe, x0, 41 - lift)
        return legs, shoes, layer(), layer()
    # side, facing left: near / far leg
    near_l, far_l, near_s, far_s = layer(), layer(), layer(), layer()
    pose = {0: (0, 0), 1: (-4, 4), 2: (0, 0), 3: (4, -4)}[f]
    for (g_leg, g_shoe, hipx, dx, dark) in ((near_l, near_s, 14.0, pose[0], False), (far_l, far_s, 16.5, pose[1], True)):
        foot_x = hipx + dx
        lift = 1 if (dx > 0 and not dark and f == 3) or (dx > 0 and dark and f == 1) else 0
        lp = capsule_pts((hipx, 34.5), (foot_x, 40.5 - lift), 1.6, 1.4)
        shade_rim(g_leg, lp, "j" if dark else "J", light=None if dark else "J", dark="j")
        put_ascii(g_shoe, SUDO_SHOE_SIDE, int(foot_x) - 3, 41 - lift)
        if dark:
            g_shoe.recolor({"W": "s", "s": "t", "G": "i"})
    return near_l, near_s, far_l, far_s


def sudo_frame(row, f):
    if row == 2:
        return mirrored(sudo_frame(1, f))
    if row == 5:
        return mirrored(sudo_frame(4, f))
    if row in (0, 3):
        view = "front" if row == 0 else "back"
        b = 1 if f in (1, 3) else 0
        arm = {0: "neutral", 1: "fwd", 2: "neutral", 3: "back"}[f]
        legs, shoes, _, _ = sudo_legs(view, f)
        hair, face, gear = sudo_head(view, b, f)
        torso, near_arm, far_arm, deck, cable = sudo_body(view, b, arm, f)
        if view == "front":
            return stack(HW, HH, legs, shoes, torso, near_arm, deck, cable, hair, face, gear)
        return stack(HW, HH, deck, cable, legs, shoes, torso, near_arm, hair, face, gear)
    if row == 1:
        b = 1 if f in (1, 3) else 0
        swing = {0: 0, 1: -2, 2: 0, 3: 2}[f]
        near_l, near_s, far_l, far_s = sudo_legs("side", f)
        hair, face, gear = sudo_head("side", b, f)
        torso, near_arm, far_arm, deck, cable = sudo_side_body(b, (14.5 + swing, 32.0 + b), (20.5 - swing, 31.0 + b), f=f)
        return stack(HW, HH, far_arm, far_l, far_s, near_l, near_s, torso, cable, hair, face, gear, near_arm, deck)
    # row 4: cast attack facing left
    b = 0
    lean = (0, -1, -1, 0)[f]
    hand = [(10.5, 21.0), (7.5, 23.5), (6.5, 23.5), (11.5, 28.5)][f]
    near_l, near_s, far_l, far_s = sudo_legs("side", 0)
    hair, face, gear = sudo_head("side", b, f)
    if lean:
        for g_ in (hair, face, gear):
            g_.px = [row_[1:] + ["."] for row_ in g_.px]
    torso, near_arm, far_arm, deck, cable = sudo_side_body(b, hand, (17.5 + lean, 30.0), lean=lean, deck_far=True, f=f)
    fx = layer()
    if f == 1:   # glyph panel appears in front of the hand
        fx.rect(1, 18, 5, 28, "k")
        for y in (18, 28):
            fx.hline(1, 5, y, "G")
        for x in (1, 5):
            fx.vline(x, 18, 28, "G")
        for (x, y) in ((3, 20), (2, 22), (4, 22), (3, 24), (2, 26), (4, 26), (3, 23)):
            fx.set(x, y, "C")
        fx.set(3, 21, "W")
    elif f == 2:  # cast flare
        fx.rect(0, 17, 6, 29, "k")
        for (x, y) in ((3, 23), (2, 23), (4, 23), (3, 22), (3, 24)):
            fx.set(x, y, "W")
        for r_ in range(2, 6):
            for (dx, dy) in ((r_, 0), (-r_, 0), (0, r_), (0, -r_)):
                fx.set(3 + dx, 23 + dy, "B" if r_ < 4 else "G")
        for (dx, dy) in ((2, 2), (-2, 2), (2, -2), (-2, -2), (3, 3), (-3, -3), (3, -3), (-3, 3)):
            fx.set(3 + dx, 23 + dy, "C")
    elif f == 3:  # fading sparkles
        for (x, y) in ((2, 20), (4, 24), (1, 26), (5, 19), (3, 28)):
            fx.set(x, y, "i" if (x + y) % 2 else "D")
    g = stack(HW, HH, far_arm, deck, far_l, far_s, near_l, near_s, torso, cable, hair, face, gear, near_arm)
    return g.blit(fx)


def make_sudo():
    return hero_sheet(sudo_frame)


# ------------------------------------------------------------------- TETSU ---
def draw_blade(g, grip, ang, length, hilt=4, edge_side=1, bright=False, guard=True):
    """Katana from a grip point along angle ang (radians, screen coords). The
    cutting edge glows cyan on edge_side (+1/-1 = perpendicular side)."""
    dx, dy = math.cos(ang), math.sin(ang)
    nx, ny = -dy * edge_side, dx * edge_side
    spine, edge = set(), set()
    for i in range(int(length * 2) + 1):
        t = i / 2.0
        px_, py_ = grip[0] + dx * t, grip[1] + dy * t
        spine.add((int(round(px_)), int(round(py_))))
        if t < length - 1:
            edge.add((int(round(px_ + nx * 0.9)), int(round(py_ + ny * 0.9))))
    g.fill(edge, "B" if bright else "C")
    g.fill(spine, "E" if bright else "F")
    tip = (int(round(grip[0] + dx * length)), int(round(grip[1] + dy * length)))
    g.set(tip[0], tip[1], "W" if bright else "B")
    for i in range(1, hilt * 2 + 1):
        t = i / 2.0
        p = (int(round(grip[0] - dx * t)), int(round(grip[1] - dy * t)))
        g.set(p[0], p[1], "R" if int(t) % 2 == 0 else "1")
        g.set(int(round(p[0] + nx * 0.8)), int(round(p[1] + ny * 0.8)), "q" if int(t) % 2 else "R")
    end = (int(round(grip[0] - dx * (hilt + 0.8))), int(round(grip[1] - dy * (hilt + 0.8))))
    g.set(end[0], end[1], "F")
    if guard:
        for s_ in (-1.5, -0.5, 0.5, 1.5):
            g.set(int(round(grip[0] + nx * s_ / 0.9 * 0.9)), int(round(grip[1] + ny * s_)), "H")


def plate(g, pts, base="H", light="F", dark="I", hi="E", spec=True):
    shade_rim(g, pts, base, light=light, dark=dark)
    if pts and base == "H":  # chrome: bright upper band, darker lower band
        y0 = min(y for (_, y) in pts)
        y1 = max(y for (_, y) in pts)
        span = max(1, y1 - y0)
        for (x, y) in pts:
            if g.get(x, y) == "H":
                t = (y - y0) / span
                if t < 0.34:
                    g.set(x, y, "F")
                elif t > 0.8 and span >= 4:
                    g.set(x, y, "I")
    for (x, y) in edge_pts(pts, ((0, -1),)):
        if (x - 1, y) in pts and (x + 1, y) in pts:
            g.set(x, y, hi)
    inner = [p for p in pts if all((p[0] + dx, p[1] + dy) in pts for dx, dy in N8)]
    if spec and inner:
        x, y = min(inner, key=lambda p: (p[0] + p[1], p[1]))
        g.set(x, y, "W")
        if (x + 1, y) in inner:
            g.set(x + 1, y, hi)


def tetsu_helmet(view, b, dx=0):
    """Kabuto-style helmet: dome, flared laced neck guard, mask with a red slit, short crest."""
    guard, helm, visor = layer(), layer(), layer()
    if view in ("front", "back"):
        sp_ = poly_pts([(9.5 + dx, 12 + b), (22.5 + dx, 12 + b), (26.2 + dx, 19.6 + b), (5.8 + dx, 19.6 + b)])
        plate(guard, sp_, spec=False)
        for y in (14, 16, 18):
            for (x, yy) in sp_:
                if yy == y + b:
                    guard.set(x, yy, "I")
        for (x, y) in sp_:
            if y in (15 + b, 17 + b) and (x - dx) % 3 == 0:
                guard.set(x, y, "R")
        plate(helm, ellipse_pts(16.0 + dx, 10.0 + b, 6.8, 6.6))
        helm.hline(10 + dx, 22 + dx, 10 + b, "I")
        crest = poly_pts([(14.2 + dx, 5.5 + b), (16.0 + dx, 0.6 + b), (17.8 + dx, 5.5 + b)])
        helm.fill(crest, "E")
        helm.fill({p for p in crest if p[0] >= 16 + dx}, "F")
        helm.set(16 + dx, 2 + b, "R")
        helm.set(16 + dx, 3 + b, "R")
        if view == "front":
            fp = {(x, y) for (x, y) in ellipse_pts(16.0 + dx, 13.0 + b, 4.6, 5.4) if y >= 11 + b}
            visor.fill(fp, "S")
            visor.hline(12 + dx, 19 + dx, 12 + b, "R")
            visor.hline(14 + dx, 17 + dx, 12 + b, "p")
            visor.set(15 + dx, 12 + b, "W")
            mg = poly_pts([(12.6 + dx, 14 + b), (19.4 + dx, 14 + b), (18.4 + dx, 17 + b), (16 + dx, 18.6 + b), (13.6 + dx, 17 + b)])
            plate(visor, mg, spec=False)
            for x in (14, 16):
                visor.vline(x + dx, 15 + b, 16 + b, "I")
    else:  # side, facing left
        sp_ = poly_pts([(14.5 + dx, 11.5 + b), (21.5 + dx, 11.5 + b), (24.8 + dx, 19.6 + b), (14.5 + dx, 19.6 + b)])
        plate(guard, sp_, spec=False)
        for y in (14, 16, 18):
            for (x, yy) in sp_:
                if yy == y + b and x > 16 + dx:
                    guard.set(x, yy, "I")
        for (x, y) in sp_:
            if y in (15 + b, 17 + b) and (x - dx) % 3 == 0 and x > 16 + dx:
                guard.set(x, y, "R")
        plate(helm, ellipse_pts(15.2 + dx, 10.0 + b, 6.8, 6.6))
        helm.hline(9 + dx, 21 + dx, 10 + b, "I")
        crest = poly_pts([(12.8 + dx, 5.4 + b), (14.2 + dx, 0.7 + b), (19.4 + dx, 1.4 + b), (18.0 + dx, 2.8 + b),
                          (17.4 + dx, 5.4 + b)])
        helm.fill(crest, "E")
        helm.fill({p for p in crest if p[1] >= 3 + b}, "F")
        helm.set(15 + dx, 2 + b, "R")
        helm.set(16 + dx, 2 + b, "R")
        fp = {(x, y) for (x, y) in ellipse_pts(11.6 + dx, 13.2 + b, 3.4, 5.0) if y >= 11 + b}
        visor.fill(fp, "S")
        visor.hline(8 + dx, 13 + dx, 12 + b, "R")
        visor.hline(8 + dx, 10 + dx, 12 + b, "p")
        visor.set(8 + dx, 12 + b, "W")
        mg = poly_pts([(7.4 + dx, 14 + b), (13.4 + dx, 14 + b), (13 + dx, 17.6 + b), (9 + dx, 18.6 + b), (7.0 + dx, 16.4 + b)])
        plate(visor, mg, spec=False)
        visor.vline(10 + dx, 15 + b, 16 + b, "I")
    return guard, helm, visor


def tetsu_scarf(view, b, f, dx=0):
    g = layer()
    wave = (0, 1, 0, -1)[f % 4]
    if view in ("front", "back"):
        g.rect(11 + dx, 19 + b, 21 + dx, 21 + b, "R")
        g.hline(11 + dx, 21 + dx, 21 + b, "r")
        tx = 19 if view == "front" else 13
        tp = poly_pts([(tx + dx, 21 + b), (tx + 3 + dx, 21 + b), (tx + 3.5 + dx + wave * 0.5, 28 + b),
                       (tx + 2 + dx, 26.5 + b), (tx + 1 + dx, 28.5 + b), (tx - 0.5 + dx, 27 + b)])
        shade_rim(g, tp, "R", light="p", dark="r")
    else:
        g.rect(11 + dx, 19 + b, 19 + dx, 21 + b, "R")
        g.hline(11 + dx, 19 + dx, 21 + b, "r")
        tp = poly_pts([(18 + dx, 19 + b), (24 + dx, 19.5 + b + wave), (29 + dx, 21 + b + wave), (27.5 + dx, 22.5 + b + wave),
                       (29 + dx, 24.5 + b + wave), (24 + dx, 23.5 + b + wave), (19 + dx, 22 + b)])
        shade_rim(g, tp, "R", light="p", dark="r")
    return g


def tetsu_legs(view, f, stance=None):
    legs, boots = layer(), layer()
    far_legs, far_boots = layer(), layer()
    if view in ("front", "back"):
        la = 1 if f == 1 else 0
        ra = 1 if f == 3 else 0
        legs.rect(14, 34, 17, 37, "1")
        for x0, lift in ((9, la), (18, ra)):
            lp = {(x, y) for x in range(x0, x0 + 5) for y in range(34, 41 - lift)}
            plate(legs, lp)
            legs.hline(x0, x0 + 4, 37 - lift, "E" if view == "front" else "I")
            legs.hline(x0, x0 + 4, 38 - lift, "I")
            bp = {(x, y) for x in range(x0 - 1, x0 + 6) for y in range(40 - lift, 45 - lift)}
            plate(boots, bp, base="I", light="H", dark="S", hi="F")
            boots.hline(x0 - 1, x0 + 5, 44 - lift, "S")
            boots.hline(x0, x0 + 4, 42 - lift, "R" if view == "front" else "q")
        return legs, boots, far_legs, far_boots
    # side, facing left; stance = (near foot dx, far foot dx)
    pose = stance or {0: (0, 0), 1: (-4, 4), 2: (0, 0), 3: (4, -4)}[f]
    for g_leg, g_boot, hipx, dxf, far in ((legs, boots, 14.5, pose[0], False),
                                          (far_legs, far_boots, 17.5, pose[1], True)):
        fx_ = hipx + dxf
        lift = 1 if stance is None and ((dxf > 0 and not far and f == 3) or (dxf > 0 and far and f == 1)) else 0
        lp = capsule_pts((hipx, 34.5), (fx_, 39.5 - lift), 2.5, 2.2)
        if far:
            shade_rim(g_leg, lp, "I", light="H", dark="S")
        else:
            plate(g_leg, lp)
        kx, ky = int(round((hipx + fx_) / 2 - 1.5)), 37 - lift
        g_leg.rect(kx, ky, kx + 1, ky + 1, "S" if far else "E")
        bx = int(round(fx_)) - 4
        bp = {(x, y) for x in range(bx, bx + 8) for y in range(41 - lift, 45 - lift)} | \
             {(x, y) for x in range(bx + 2, bx + 7) for y in range(39 - lift, 41 - lift)}
        if far:
            shade_rim(g_boot, bp, "S", light="I", dark="S")
        else:
            plate(g_boot, bp, base="I", light="H", dark="S", hi="F")
            g_boot.hline(bx + 2, bx + 6, 41 - lift, "R")
        g_boot.hline(bx, bx + 7, 44 - lift, "S")
    return legs, boots, far_legs, far_boots


def tetsu_torso(view, b, dx=0):
    torso, pads = layer(), layer()
    if view in ("front", "back"):
        tp = poly_pts([(9 + dx, 20.5 + b), (23 + dx, 20.5 + b), (24 + dx, 27 + b), (22 + dx, 34.5 + b),
                       (10 + dx, 34.5 + b), (8 + dx, 27 + b)])
        plate(torso, tp)
        torso.rect(14 + dx, 19 + b, 17 + dx, 20 + b, "1")
        if view == "front":
            torso.vline(16 + dx, 22 + b, 28 + b, "I")
            torso.hline(10 + dx, 22 + dx, 26 + b, "R")
            torso.set(15 + dx, 24 + b, "R")
            torso.set(17 + dx, 24 + b, "R")
            for y in (29, 31):
                torso.hline(11 + dx, 21 + dx, y + b, "I")
        else:
            torso.vline(16 + dx, 21 + b, 33 + b, "I")
            torso.hline(10 + dx, 22 + dx, 28 + b, "I")
        torso.rect(10 + dx, 33 + b, 22 + dx, 34 + b, "S")
        torso.set(16 + dx, 33 + b, "R")
        torso.set(15 + dx, 33 + b, "R")
        for x0 in (9, 19):  # hip tassets
            tsp = {(x, y) for x in range(x0 + dx, x0 + 5 + dx) for y in range(35 + b, 38 + b)}
            plate(pads, tsp)
            pads.hline(x0 + dx, x0 + 4 + dx, 37 + b, "R" if view == "front" else "I")
    else:
        tp = poly_pts([(10.5 + dx, 21 + b), (20.5 + dx, 20.5 + b), (22.5 + dx, 25 + b), (21.5 + dx, 34.5 + b),
                       (11 + dx, 34.5 + b), (9 + dx, 27 + b)])
        plate(torso, tp)
        torso.rect(12 + dx, 19 + b, 16 + dx, 20 + b, "1")
        torso.hline(10 + dx, 16 + dx, 26 + b, "R")
        for y in (29, 31):
            torso.hline(11 + dx, 20 + dx, y + b, "I")
        torso.rect(11 + dx, 33 + b, 21 + dx, 34 + b, "S")
        torso.set(12 + dx, 33 + b, "R")
        tsp = {(x, y) for x in range(12 + dx, 19 + dx) for y in range(35 + b, 38 + b)}
        plate(pads, tsp)
        pads.hline(12 + dx, 18 + dx, 37 + b, "R")
    return torso, pads


def tetsu_pauldron(cx, cy):
    g = layer()
    pp = ellipse_pts(cx, cy, 4.4, 3.6)
    plate(g, pp)
    for (x, y) in pp:
        if (x, y + 1) not in pp:
            g.set(x, y, "R")
    return g


def tetsu_arm(shoulder, hand, far=False):
    g = layer()
    ap = capsule_pts(shoulder, hand, 2.4, 2.1)
    if far:
        shade_rim(g, ap, "I", light="H", dark="S")
    else:
        plate(g, ap)
    fist = ellipse_pts(hand[0], hand[1] + 0.6, 2.0, 2.0)
    shade_rim(g, fist, "I" if far else "H", light="I" if far else "F", dark="S")
    return g


def tetsu_back_sword(view, b, dx=0):
    g = layer()
    if view == "front":
        draw_blade(g, (22.0 + dx, 17.0 + b), math.radians(120), 22, hilt=4)
    elif view == "back":
        draw_blade(g, (11.0 + dx, 16.0 + b), math.radians(58), 22, hilt=4, edge_side=-1)
    else:
        draw_blade(g, (22.0 + dx, 15.0 + b), math.radians(97), 24, hilt=4, edge_side=-1)
    return g


def tetsu_frame(row, f):
    if row == 2:
        return mirrored(tetsu_frame(1, f))
    if row == 5:
        return mirrored(tetsu_frame(4, f))
    if row in (0, 3):
        view = "front" if row == 0 else "back"
        b = 1 if f in (1, 3) else 0
        sw = {0: 0, 1: -1, 2: 0, 3: 1}[f]
        legs, boots, _, _ = tetsu_legs(view, f)
        torso, pads = tetsu_torso(view, b)
        guard, helm, visor = tetsu_helmet(view, b)
        sword = tetsu_back_sword(view, b)
        scarf = tetsu_scarf(view, b, f)
        arm_l = tetsu_arm((7.5, 25.5 + b), (6.5, 32.0 + b + sw))
        arm_r = tetsu_arm((24.5, 25.5 + b), (25.5, 32.0 + b - sw))
        pl, pr = tetsu_pauldron(7.0, 23.0 + b), tetsu_pauldron(25.0, 23.0 + b)
        if view == "front":
            return stack(HW, HH, sword, legs, boots, torso, pads, scarf, arm_l, arm_r, pl, pr, guard, helm, visor)
        return stack(HW, HH, legs, boots, torso, pads, arm_l, arm_r, pl, pr, sword, scarf, guard, helm, visor)
    if row == 1:
        b = 1 if f in (1, 3) else 0
        sw = {0: 0, 1: -2, 2: 0, 3: 2}[f]
        legs, boots, far_legs, far_boots = tetsu_legs("side", f)
        torso, pads = tetsu_torso("side", b)
        guard, helm, visor = tetsu_helmet("side", b)
        sword = tetsu_back_sword("side", b)
        scarf = tetsu_scarf("side", b, f)
        far_arm = tetsu_arm((18.5, 25.0 + b), (19.5 - sw, 32.0 + b), far=True)
        arm = tetsu_arm((15.5, 25.5 + b), (14.5 + sw, 32.5 + b))
        pd = tetsu_pauldron(15.5, 23.0 + b)
        return stack(HW, HH, far_arm, sword, far_legs, far_boots, legs, boots, torso, pads, scarf, guard, helm,
                     visor, arm, pd)
    # row 4: katana attack facing left
    lean = (1, -1, -2, 0)[f]
    grip = [(20.0, 14.0), (8.0, 26.0), (10.0, 32.0), (12.0, 27.0)][f]
    ang = [math.radians(-55), math.radians(180), math.radians(135), math.radians(-115)][f]
    length = [13, 9, 12, 13][f]
    stance = (-4, 4)
    legs, boots, far_legs, far_boots = tetsu_legs("side", 0, stance=stance)
    torso, pads = tetsu_torso("side", 0, dx=lean)
    guard, helm, visor = tetsu_helmet("side", 0, dx=lean)
    scarf = tetsu_scarf("side", 0, (1, 3, 1, 0)[f], dx=lean)
    far_arm = tetsu_arm((18.5 + lean, 25.0), (grip[0] + 1.5, grip[1] + 1.0), far=True)
    arm = tetsu_arm((15.5 + lean, 25.5), grip)
    pd = tetsu_pauldron(15.5 + lean, 23.0)
    blade = layer()
    draw_blade(blade, grip, ang, length, hilt=3, edge_side=-1 if f in (0, 3) else 1, bright=(f == 1))
    trail = layer()
    if f == 1:  # swing smear: a crescent from overhead down to the blade
        for y in range(HH):
            for x in range(HW):
                d = math.hypot(x + 0.5 - 16, y + 0.5 - 27)
                a = math.degrees(math.atan2(y + 0.5 - 27, x + 0.5 - 16))
                if -175 <= a <= -95 and 12.0 <= d <= 15.5:
                    trail.set(x, y, "W" if d < 13.2 else "B" if d < 14.4 else "C")
    if f == 2:
        for y in range(HH):
            for x in range(HW):
                d = math.hypot(x + 0.5 - 16, y + 0.5 - 27)
                a = math.degrees(math.atan2(y + 0.5 - 27, x + 0.5 - 16))
                if 150 <= a <= 178 and 12.5 <= d <= 14.5 and (x + y) % 2 == 0:
                    trail.set(x, y, "c")
    behind = f == 0
    layers = [far_arm, far_legs, far_boots, legs, boots, torso, pads, scarf, guard, helm, visor]
    if behind:
        layers = [blade] + layers + [arm, pd]
    else:
        layers = layers + [arm, pd, blade]
    g = stack(HW, HH, *layers)
    for y in range(HH):
        for x in range(HW):
            if trail.get(x, y) != "." and g.get(x, y) == ".":
                g.set(x, y, trail.get(x, y))
    return g


def make_tetsu():
    return hero_sheet(tetsu_frame)


# ------------------------------------------------------------ PAINE ATTACK ---
def make_paine_attack():
    """Firing pose built on paine.png's own left-facing neutral frame: the
    resting hand is painted out in Paine's outfit colours and a new arm in
    Paine's palette is drawn on top, ending in a blue energy glow."""
    src = load_source("paine.png")
    base = src.crop((0, 48, 32, 96))
    sheet = Image.new("RGBA", (128, 96), (0, 0, 0, 0))
    arms = [((14.0, 25.0), (8.5, 29.5)), ((14.0, 25.0), (6.5, 25.0)), ((15.0, 25.0), (7.5, 24.5)),
            ((14.0, 25.0), (9.5, 30.0))]
    for f in range(4):
        fr = base.copy()
        fp = fr.load()
        for y in range(28, 33):  # hide the hand that rests on the hip
            for x in range(9, 16):
                if fp[x, y][3] and fp[x, y][:3] != (0, 0, 0):
                    edge = any(fp[x + dx, y + dy][3] == 0 for dx, dy in N4)
                    fp[x, y] = (0, 0, 0, 255) if edge else (0x24, 0x24, 0x24, 255)
        if f == 2:  # recoil: upper body leans back 1px
            lean = Image.new("RGBA", (32, 48), (0, 0, 0, 0))
            lean.paste(fr.crop((0, 0, 31, 34)), (1, 0))
            lean.paste(fr.crop((0, 34, 32, 48)), (0, 34))
            fr = lean
        sh, hand = arms[f]
        arm = Grid(32, 48)
        ap = capsule_pts(sh, hand, 1.7, 1.5)
        shade_rim(arm, ap, "/", light=";", dark="/")
        hp = ellipse_pts(hand[0], hand[1] + 0.2, 1.7, 1.7)
        shade_rim(arm, hp, "+", light="*", dark="=")
        arm.outline("`")
        fr.alpha_composite(arm.image())
        glow = Grid(32, 48)
        hx, hy = int(hand[0]) - 1, int(hand[1])
        if f == 1:
            glow.fill({p for p in ellipse_pts(hx + 0.5, hy + 0.5, 3.0, 3.0) if fr.getpixel(p)[3] == 0}, "#")
            for (x, y) in ((hx - 1, hy), (hx - 2, hy), (hx - 1, hy - 1), (hx - 1, hy + 1)):
                glow.set(x, y, "B")
            glow.set(hx - 1, hy, "W")
        elif f == 2:
            cx_, cy_ = 3, hy
            glow.fill(ellipse_pts(cx_ + 0.5, cy_ + 0.5, 5.5, 5.5), "#")
            for r_ in range(1, 6):
                for (dx, dy) in ((r_, 0), (-r_, 0), (0, r_), (0, -r_)):
                    glow.set(cx_ + dx, cy_ + dy, "W" if r_ == 1 else "B" if r_ < 3 else "U")
            for (dx, dy) in ((1, 1), (-1, -1), (1, -1), (-1, 1), (2, 2), (-2, -2), (2, -2), (-2, 2)):
                glow.set(cx_ + dx, cy_ + dy, "B" if abs(dx) == 1 else "C")
            glow.set(cx_, cy_, "W")
            glow.set(hx - 1, hy, "W")
        elif f == 3:
            glow.fill({p for p in ellipse_pts(hx + 0.5, hy + 0.5, 2.2, 2.2) if fr.getpixel(p)[3] == 0}, "#")
            glow.set(hx - 1, hy, "U")
        fr.alpha_composite(glow.image())
        sheet.paste(fr, (f * 32, 0))
        sheet.paste(fr.transpose(Image.FLIP_LEFT_RIGHT), (f * 32, 48))
    return sheet


# --------------------------------------------------------------- PORTRAITS ---
def portrait_badge(col, dark):
    g = Grid(48, 48)
    inside = {(x, y) for y in range(48) for x in range(48) if min(x, 47 - x) + min(y, 47 - y) >= 3}
    g.fill(inside, "P")
    for (x, y) in inside:
        if y % 3 == 0:
            g.set(x, y, "w")
    ring1 = edge_pts(inside, N4)
    in2 = inside - ring1
    ring2 = edge_pts(in2, N4)
    in3 = in2 - ring2
    ring3 = edge_pts(in3, N4)
    g.fill(ring1, "K")
    g.fill(ring2, col)
    g.fill(ring3, dark)
    return g, in3 - ring3


def portrait_paine():
    hair, face, body = Grid(48, 48), Grid(48, 48), Grid(48, 48)
    sp_ = ellipse_pts(24, 53, 19, 13)
    shade_rim(body, sp_, ":", light=";", dark="/")
    body.fill(set(line_pts(19, 41, 23, 47)) | set(line_pts(20, 41, 24, 47)), "^")
    body.rect(20, 34, 27, 40, "=")
    body.rect(21, 38, 26, 40, "+")
    fp = {(x, y) for (x, y) in ellipse_pts(24, 26.5, 9.2, 10.4) if y >= 17}
    shade_rim(face, fp, "+", light="*", dark="=")
    for (x, y) in fp:
        if x >= 30 or y >= 34:
            face.set(x, y, "=")
    for ex in (17, 27):
        face.hline(ex, ex + 4, 23, "`")
        face.rect(ex, 24, ex + 4, 28, "<")
        face.rect(ex + 1, 26, ex + 3, 28, ">")
        face.set(ex + 3, 24, "W")
        face.set(ex + 3, 25, "W")
        face.hline(ex, ex + 4, 29, "=")
    face.set(24, 30, "=")
    face.hline(23, 25, 33, "?")
    face.set(18, 31, "=")
    face.set(30, 31, "=")
    spikes = [(-170, 5, 3), (-150, 7, 3), (-128, 8, 3.4), (-105, 8, 3.4), (-80, 9, 3.4), (-56, 8, 3.4),
              (-33, 7, 3), (-12, 5, 3), (8, 4, 2.6), (172, 4, 2.6)]
    hp, lines = messy_hair(24, 18, 14.0, 11.0, spikes,
                           [((24, 6), (16, 16)), ((24, 6), (32, 16)), ((19, 7), (12, 15)), ((29, 7), (36, 14))])
    bp = set()
    for (bx, by) in ((15, 22), (19, 21), (23, 22), (27, 21), (31, 22)):
        bp |= poly_pts([(bx - 2.6, 15), (bx, by), (bx + 2.6, 15)])
    bp |= {(x, y) for (x, y) in hp if y <= 17}
    hp |= poly_pts([(13, 18), (15.5, 18), (15.5, 31), (14, 29)]) | poly_pts([(32.5, 18), (35, 18), (34, 29), (32.5, 31)])
    bangs = Grid(48, 48)
    for g_, pts in ((hair, hp), (bangs, bp)):
        g_.fill(pts, "$")
        for (x, y) in pts:
            if (x - 1, y - 1) not in pts or (x, y - 1) not in pts:
                g_.set(x, y, "!")
            elif (x - 2, y - 2) not in pts:
                g_.set(x, y, "@")
            elif (x + 1, y + 1) not in pts or y >= 20:
                g_.set(x, y, "%")
        for q in lines:
            if q in pts:
                g_.set(q[0], q[1], "%")
    return [body, hair, face, bangs]


def portrait_tetsu():
    body, guard, helm, mask, scarf = (Grid(48, 48) for _ in range(5))
    plate(body, {(x, y) for x in range(15, 34) for y in range(40, 48)})
    body.hline(16, 32, 43, "R")
    for cx in (8, 40):
        pp = ellipse_pts(cx, 46, 9, 7)
        plate(body, pp)
        for (x, y) in pp:
            if (x, y + 1) not in pp or y == 44:
                body.set(x, y, "R")
    sc = {(x, y) for x in range(14, 35) for y in range(35, 41)}
    shade_rim(scarf, sc, "R", light="p", dark="r")
    scarf.fill(poly_pts([(29, 40), (34, 40), (35.5, 47.5), (31, 46), (29, 47.5)]), "R")
    scarf.fill(set(line_pts(29, 41, 30, 47)), "r")
    sp_ = poly_pts([(11, 22), (37, 22), (42, 36), (6, 36)])
    plate(guard, sp_, spec=False)
    for y in (26, 30, 34):
        guard.fill({p for p in sp_ if p[1] == y}, "I")
    for (x, y) in sp_:
        if y in (28, 32) and x % 4 == 0:
            guard.set(x, y, "R")
    plate(helm, ellipse_pts(24, 18, 12.5, 11.5))
    helm.hline(12, 36, 20, "I")
    crest = poly_pts([(20.5, 9), (24, -0.5), (27.5, 9)])
    helm.fill(crest, "E")
    helm.fill({p for p in crest if p[0] >= 24}, "F")
    helm.rect(23, 3, 24, 5, "R")
    fp = {(x, y) for (x, y) in ellipse_pts(24, 28, 8.4, 8.8) if y >= 22}
    mask.fill(fp, "S")
    mask.rect(17, 25, 31, 26, "R")
    mask.hline(20, 28, 25, "p")
    mask.hline(22, 26, 25, "W")
    mask.hline(19, 29, 26, "r")
    mg = poly_pts([(17, 29), (31, 29), (29.5, 34), (24, 36.6), (18.5, 34)])
    plate(mask, mg, spec=False)
    for x in (21, 24, 27):
        mask.vline(x, 31, 33, "I")
    return [body, scarf, guard, helm, mask]


def portrait_sudo():
    body, face, hair, gear = (Grid(48, 48) for _ in range(4))
    sp_ = ellipse_pts(24, 53, 19, 13)
    shade_rim(body, sp_, "0", light="A", dark="9")
    hood = ellipse_pts(24, 40, 11.5, 4.2)
    body.fill(hood, "A")
    body.fill({(x, y) for (x, y) in hood if abs(x + 0.5 - 24) < 6 and y >= 40}, "9")
    for sx in (20, 28):
        body.vline(sx, 42, 46, "s")
    for (a, c) in (((13, 43), (13, 47)), ((13, 43), (16, 43)), ((34, 44), (34, 47)), ((34, 44), (31, 44))):
        body.line(*a, *c, "G")
    body.set(16, 43, "W")
    body.set(31, 44, "W")
    body.rect(21, 34, 27, 40, "7")
    fp = {(x, y) for (x, y) in ellipse_pts(24, 27, 9.4, 10.4) if y >= 18}
    shade_rim(face, fp, "6", dark="7")
    for (x, y) in fp:
        if x >= 31:
            face.set(x, y, "7")
    for (cx, cy) in ((19.5, 27.5), (29.0, 27.5)):
        ring = ellipse_pts(cx, cy, 4.6, 4.6)
        face.fill(ring, "C")
        face.fill(edge_pts(ring, N4), "K")
        x0, y0 = int(cx) - 2, int(cy) - 2
        face.set(x0, y0, "W")
        face.set(x0 + 1, y0, "B")
        face.set(x0, y0 + 1, "B")
        face.set(int(cx) + 2, int(cy) + 2, "c")
        face.set(int(cx) + 1, int(cy) + 2, "c")
    face.hline(23, 25, 27, "K")
    face.hline(20, 28, 33, "8")
    face.hline(21, 27, 33, "W")
    face.hline(21, 27, 34, "8")
    face.hline(22, 26, 35, "8")
    for (x, y) in ((15, 31), (17, 32), (31, 32), (33, 31)):
        face.set(x, y, "7")
    face.set(16, 33, "p")
    face.set(32, 33, "p")
    spikes = [(-170, 4, 3), (-148, 6, 3), (-125, 7, 3.4), (-100, 8, 3.4), (-76, 8, 3.4), (-52, 7, 3.4),
              (-28, 6, 3), (-8, 4, 2.6), (10, 3, 2.4), (170, 3, 2.4)]
    hp, lines = messy_hair(24, 17, 14.0, 11.0, spikes,
                           [((24, 5), (17, 14)), ((24, 5), (31, 14)), ((19, 6), (12, 14)), ((29, 6), (36, 13))])
    for (bx, by) in ((16, 23), (21, 22), (26, 23), (31, 22)):
        hp |= poly_pts([(bx - 2.6, 17), (bx, by), (bx + 2.6, 17)])
    shade_hair(hair, hp, lines, 0, 22)
    for i in range(61):
        a = math.pi + math.pi * i / 60
        gear.set(int(round(24 + 12.6 * math.cos(a))), int(round(20 + 12.4 * math.sin(a))), "2")
    for x0 in (8, 36):
        gear.rect(x0, 23, x0 + 4, 31, "2")
        gear.vline(x0, 23, 31, "3")
        gear.set(x0 + 2, 27, "G")
    gear.line(39, 22, 44, 5, "3")
    gear.set(44, 4, "G")
    gear.line(11, 32, 17, 35, "2")
    gear.set(18, 35, "M")
    return [body, hair, face, gear]


def make_portraits():
    sheet = Image.new("RGBA", (144, 48), (0, 0, 0, 0))
    for i, (fn, col, dark) in enumerate(((portrait_paine, "C", "e"), (portrait_tetsu, "R", "q"),
                                         (portrait_sudo, "G", "i"))):
        badge_, inner = portrait_badge(col, dark)
        bust = Grid(48, 48)
        for lay in fn():
            bust.blit(lay.copy().outline())
        for (x, y) in inner:
            if bust.get(x, y) != ".":
                badge_.set(x, y, bust.get(x, y))
        sheet.paste(badge_.image(), (i * 48, 0))
    return sheet


# ================================================================= ENEMIES ===
def make_ninja():
    sheet = Image.new("RGBA", (160, 48), (0, 0, 0, 0))
    poses = [
        dict(hip=(18.5, 31.0), nf=(26.5, 46.0), ff=(10.5, 41.0), nh=(14.0, 31.0), fh=(25.0, 28.0)),
        dict(hip=(18.5, 30.0), nf=(19.0, 46.0), ff=(23.0, 38.5), nh=(19.0, 32.0), fh=(19.0, 30.0)),
        dict(hip=(18.5, 31.0), nf=(11.0, 41.5), ff=(26.0, 46.0), nh=(25.0, 29.0), fh=(13.0, 29.5)),
        dict(hip=(16.5, 36.0), nf=(30.5, 46.0), ff=(4.5, 46.0), nh=(31.0, 31.0), fh=(9.0, 34.0)),
    ]
    for f, P in enumerate(poses):
        dash = f == 3
        hx, hy = P["hip"]
        lean = 6 if dash else 3
        chest = (hx + lean, hy - (8 if dash else 10))
        head = (chest[0] + (3 if dash else 2), chest[1] - 6)
        far_l, far_a, torso, headg, near_l, near_a, blade, scarf = (Grid(40, 48) for _ in range(8))
        for g_, foot, far in ((far_l, P["ff"], True), (near_l, P["nf"], False)):
            knee = ik_knee((hx, hy), foot, 8.5, 9.0, -1)
            kn = (int(round(knee[0])), int(round(knee[1])))
            thigh = brush(line_pts(int(hx), int(hy), *kn), SQ2)
            shin = brush(line_pts(kn[0], kn[1], int(foot[0]), int(foot[1]) - 1), [(0, 0), (1, 0)])
            col, lite = ("1", "2") if far else ("2", "3")
            shade_rim(g_, thigh | shin, col, light=lite, dark="1" if not far else "P")
            g_.set(kn[0], kn[1], "3" if not far else "2")
            fx_, fy_ = int(foot[0]), int(foot[1])
            g_.hline(fx_ - 1, fx_ + 2, fy_, "S" if far else "1")
            g_.set(fx_ + 2, fy_ - 1, "S" if far else "2")
            if not far:
                g_.set(kn[0] + 1, kn[1], "M")
        tp = capsule_pts((hx, hy), chest, 3.0, 4.2)
        shade_rim(torso, tp, "2", light="3", dark="1")
        for (x, y) in edge_pts(tp, ((-1, 0),)):
            torso.set(x, y, "m")
        torso.set(int(chest[0]) + 1, int(chest[1]) + 2, "M")
        torso.set(int(chest[0]) + 2, int(chest[1]) + 3, "M")
        torso.set(int(chest[0]), int(chest[1]) + 3, "M")
        hp = ellipse_pts(head[0], head[1], 4.4, 4.6)
        hp |= poly_pts([(head[0] - 3, head[1] - 2), (head[0] - 7, head[1] - 4), (head[0] - 3, head[1] + 1)])
        shade_rim(headg, hp, "2", light="4", dark="1")
        vy = int(head[1])
        headg.hline(int(head[0]) - 1, int(head[0]) + 4, vy, "M")
        headg.hline(int(head[0]) + 1, int(head[0]) + 3, vy, "N")
        headg.set(int(head[0]) + 3, vy, "W")
        wave = (0, 1, 0, 0)[f]
        sp = (chest[0] - 1, chest[1] - 2)
        tail = poly_pts([(sp[0], sp[1] - 1), (sp[0] - 8, sp[1] + 1 + wave), (sp[0] - 13, sp[1] - 1 + 2 * wave),
                         (sp[0] - 12, sp[1] + 1.5 + 2 * wave), (sp[0] - 8, sp[1] + 3 + wave), (sp[0], sp[1] + 2)]) \
            if not dash else poly_pts([(sp[0], sp[1] - 1), (sp[0] - 16, sp[1] - 2), (sp[0] - 15, sp[1] + 0.5),
                                        (sp[0] - 9, sp[1] + 1), (sp[0], sp[1] + 2)])
        shade_rim(scarf, tail, "M", light="N", dark="m")
        for g_, hand, far in ((far_a, P["fh"], True), (near_a, P["nh"], False)):
            sh = (chest[0] + (1 if far else 0), chest[1] + 1)
            ap = capsule_pts(sh, hand, 1.6, 1.3)
            shade_rim(g_, ap, "1" if far else "2", light="2" if far else "4", dark="P" if far else "1")
            g_.fill(ellipse_pts(hand[0], hand[1], 1.3, 1.3), "2")
        nh = P["nh"]
        ang = math.radians(0 if dash else 35)
        ln = 9 if dash else 6
        for i in range(ln * 2):
            t = i / 2
            x, y = int(round(nh[0] + 1 + math.cos(ang) * t)), int(round(nh[1] + math.sin(ang) * t))
            blade.set(x, y, "W")
            blade.set(x, y + (1 if not dash else -1), "M")
        blade.set(int(round(nh[0] + 1 + math.cos(ang) * ln)), int(round(nh[1] + math.sin(ang) * ln)), "N")
        g = stack(40, 48, scarf, far_a, far_l, torso, headg, near_l, near_a, blade)
        if dash:
            for (y, x0, x1) in ((28, 0, 5), (33, 1, 7), (38, 0, 4), (42, 2, 6)):
                for x in range(x0, x1 + 1):
                    if g.get(x, y) == ".":
                        g.set(x, y, "m" if x < x1 else "N")
        sheet.paste(g.image(), (f * 40, 0))
    return sheet


def make_enforcer():
    sheet = Image.new("RGBA", (224, 56), (0, 0, 0, 0))
    for f in range(4):
        bash = f == 3
        bob = (0, 1, 1, 0)[f]
        lean = 3 if bash else 0
        lifts = [(0, 0), (4, 0), (0, 4), (0, 0)][f]
        feet = [(30, 21), (32, 20), (29, 23), (35, 15)][f]
        far_leg, near_leg, body, head, far_arm, shield, near_arm = (Grid(56, 56) for _ in range(7))
        for g_, fx_, lift, hipx, far in ((far_leg, feet[1], lifts[1], 22, True), (near_leg, feet[0], lifts[0], 29, False)):
            hip = (hipx + lean * 0.5, 36 + bob)
            foot = (fx_, 50 - lift)
            knee = ((hip[0] + foot[0]) / 2 + 2, (hip[1] + foot[1]) / 2 - 1)
            lp = capsule_pts(hip, knee, 4.0, 3.4) | capsule_pts(knee, foot, 3.2, 2.8)
            if far:
                shade_rim(g_, lp, "I", light="H", dark="S")
            else:
                plate(g_, lp)
            kp = ellipse_pts(knee[0], knee[1], 2.4, 2.4)
            shade_rim(g_, kp, "S" if far else "Y", light="I" if far else "y", dark="S" if far else "O")
            fp = {(x, y) for x in range(int(foot[0]) - 6, int(foot[0]) + 6) for y in range(int(foot[1]), int(foot[1]) + 5)}
            fp -= {(int(foot[0]) - 6, int(foot[1])), (int(foot[0]) + 5, int(foot[1]))}
            if far:
                shade_rim(g_, fp, "S", light="I", dark="S")
            else:
                plate(g_, fp, base="I", light="H", dark="S", hi="F")
                g_.hline(int(foot[0]) - 5, int(foot[0]) + 4, int(foot[1]) + 4, "S")
        tp = ellipse_pts(26 + lean, 26 + bob, 13.5, 12.0, p=3.0)
        plate(body, tp)
        for (x, y) in tp:  # hazard band at the waist
            if 33 + bob <= y <= 35 + bob:
                body.set(x, y, "Y" if (x + y) % 6 < 3 else "S")
        body.rect(21 + lean, 20 + bob, 30 + lean, 23 + bob, "S")
        for x in range(22, 30, 2):
            body.vline(x + lean, 20 + bob, 23 + bob, "I")
        body.set(16 + lean, 26 + bob, "R")
        hp = ellipse_pts(28 + lean, 13 + bob, 6.5, 5.0)
        plate(head, hp)
        head.rect(29 + lean, 12 + bob, 34 + lean, 14 + bob, "S")
        head.hline(30 + lean, 34 + lean, 13 + bob, "R")
        head.set(33 + lean, 13 + bob, "W")
        head.set(32 + lean, 13 + bob, "p")
        head.vline(23 + lean, 6 + bob, 9 + bob, "I")
        head.set(23 + lean, 5 + bob, "R")
        fa = capsule_pts((17 + lean, 22 + bob), (14 + lean, 33 + bob), 3.4, 3.0)
        shade_rim(far_arm, fa, "I", light="H", dark="S")
        far_arm.fill(ellipse_pts(14 + lean, 35 + bob, 3.0, 2.6), "S")
        sx0 = 40 + (9 if bash else 0)
        spts = {(x, y) for x in range(sx0 - 6, sx0 + 4) for y in range(8 + bob, 48 + bob)}
        spts -= {(sx0 - 6, 8 + bob), (sx0 + 3, 8 + bob), (sx0 - 6, 47 + bob), (sx0 + 3, 47 + bob)}
        shade_rim(shield, spts, "2", light="3", dark="1")
        for (x, y) in edge_pts(spts, ((1, 0), (0, -1), (0, 1))):
            shield.set(x, y, "C")
        for (x, y) in edge_pts(spts, ((1, 0),)):
            shield.set(x, y, "B" if y % 4 else "W")
        shield.rect(sx0 - 4, 13 + bob, sx0 + 1, 15 + bob, "e")
        shield.hline(sx0 - 4, sx0 + 1, 13 + bob, "c")
        for i in range(4):
            shield.set(sx0 - 3 + i // 2, 24 + bob + i, "C")
            shield.set(sx0 - 3 + i // 2, 34 + bob - i, "C")
        shield.vline(sx0 - 1, 22 + bob, 36 + bob, "1")
        na = capsule_pts((33 + lean, 22 + bob), (sx0 - 7, 28 + bob), 3.2, 2.8)
        plate(near_arm, na)
        g = stack(56, 56, far_arm, far_leg, near_leg, body, head, near_arm, shield)
        if bash:
            for (y, x0) in ((12, 52), (20, 53), (28, 53), (36, 53), (44, 52)):
                for x in range(x0, 56):
                    if g.get(x, y) == ".":
                        g.set(x, y, "g")
        sheet.paste(g.image(), (f * 56, 0))
    return sheet


def make_bomber():
    sheet = Image.new("RGBA", (128, 32), (0, 0, 0, 0))
    for f in range(4):
        dy = (0, -1, 0, 0)[f]
        armed = f == 3
        rotors, body, light = Grid(32, 32), Grid(32, 32), Grid(32, 32)
        for mx in (8, 23):
            rotors.vline(mx, 6 + dy, 9 + dy, "3")
            blades = [(-4, 4), (-2, 2), (-4, 4), (-3, 3)][f]
            for x in range(mx + blades[0], mx + blades[1] + 1):
                if f != 1 or abs(x - mx) <= 2:
                    rotors.set(x, 5 + dy, "4" if abs(x - mx) > 1 else "5")
            rotors.set(mx, 5 + dy, "2")
        bp = ellipse_pts(16, 18 + dy, 9.4, 9.0)
        shade_sphere(body, 16, 18 + dy, 9.4, ["1", "2", "3", "4"], lo=-0.5, pts=bp)
        for (x, y) in bp:
            if 20 + dy <= y <= 23 + dy:
                body.set(x, y, "Y" if (x - y) % 6 < 3 else "1")
        body.hline(8, 24, 19 + dy, "S")
        body.hline(8, 24, 24 + dy, "S")
        body.rect(14, 25 + dy, 18, 26 + dy, "S")
        body.set(16, 26 + dy, "O")
        body.set(22, 15 + dy, "C")
        body.set(23, 15 + dy, "B")
        lp = ellipse_pts(16, 10 + dy, 3.6, 3.2)
        light.fill(lp, "R")
        if armed:
            light.fill(ellipse_pts(16, 10 + dy, 2.2, 2.0), "p")
            light.set(16, 10 + dy, "W")
            light.set(15, 10 + dy, "W")
            light.set(16, 9 + dy, "W")
        else:
            for (x, y) in lp:
                if (x + 1, y + 1) not in lp:
                    light.set(x, y, "r")
            light.set(15, 9 + dy, "p")
        g = stack(32, 32, rotors, body, light)
        if armed:
            for (x, y) in ellipse_pts(16, 10, 7.0, 6.0):
                if g.get(x, y) == ".":
                    g.set(x, y, "(")
            for (x, y) in ((16, 1), (16, 0), (9, 9), (23, 9), (11, 3), (21, 3)):
                if g.get(x, y) == ".":
                    g.set(x, y, "R")
        sheet.paste(g.image(), (f * 32, 0))
    return sheet


def make_sniper():
    sheet = Image.new("RGBA", (160, 40), (0, 0, 0, 0))
    for f in range(4):
        dy = (0, -1, 1, 0)[f]
        rec = f == 3
        dx = -2 if rec else 0
        fin, body, barrel, scope, jet = (Grid(40, 40) for _ in range(5))
        fin.fill(poly_pts([(8 + dx, 16 + dy), (3 + dx, 11 + dy), (5 + dx, 11 + dy), (11 + dx, 16 + dy)]), "2")
        fin.fill(poly_pts([(8 + dx, 25 + dy), (3 + dx, 30 + dy), (5 + dx, 30 + dy), (11 + dx, 25 + dy)]), "1")
        bp = ellipse_pts(15 + dx, 20.5 + dy, 9.0, 6.6, p=2.8)
        plate(body, bp, base="2", light="3", dark="1", hi="4")
        body.hline(8 + dx, 22 + dx, 22 + dy, "1")
        body.set(12 + dx, 19 + dy, "Y")
        body.set(14 + dx, 19 + dy, "Y")
        end = 38 if not rec else 34
        barrel.rect(23 + dx, 19 + dy, end, 20 + dy, "3")
        barrel.hline(23 + dx, end, 19 + dy, "4")
        barrel.rect(end - 3, 18 + dy, end - 1, 21 + dy, "2")
        barrel.vline(end - 2, 18 + dy, 21 + dy, "3")
        barrel.rect(28 + dx, 18 + dy, 29 + dx, 21 + dy, "2")
        scope.rect(11 + dx, 11 + dy, 20 + dx, 13 + dy, "1")
        scope.hline(11 + dx, 20 + dx, 11 + dy, "2")
        scope.vline(21 + dx, 11 + dy, 13 + dy, "Y")
        scope.set(21 + dx, 12 + dy, "W")
        scope.vline(15 + dx, 14 + dy, 14 + dy, "1")
        flick = ("C", "c", "B", "C")[f]
        jet.hline(13 + dx, 17 + dx, 27 + dy, "2")
        jet.set(14 + dx, 28 + dy, flick)
        jet.set(15 + dx, 28 + dy, "B")
        jet.set(16 + dx, 28 + dy, flick)
        jet.set(15 + dx, 29 + dy, flick if f != 1 else "c")
        g = stack(40, 40, fin, jet, barrel, body, scope)
        for (x, y) in ((22 + dx, 12 + dy), (23 + dx, 12 + dy), (22 + dx, 11 + dy), (22 + dx, 13 + dy)):
            if g.get(x, y) == ".":
                g.set(x, y, "Y" if x == 22 + dx and y == 12 + dy else "y")
        if rec:
            for (x, y, ch) in ((37, 19, "W"), (38, 19, "W"), (37, 20, "W"), (38, 20, "y"), (39, 19, "Y"), (39, 20, "Y"),
                               (36, 17, "Y"), (37, 16, "O"), (36, 22, "Y"), (37, 23, "O"), (39, 17, "O"), (39, 22, "O"),
                               (38, 18, "y"), (38, 21, "y")):
                g.set(x, y + dy, ch)
        sheet.paste(g.image(), (f * 40, 0))
    return sheet


# ================================================================ OVERSEER ===
def make_overseer():
    sheet = Image.new("RGBA", (384, 96), (0, 0, 0, 0))
    W = H = 96
    cx, cy = 48.0, 44.0
    for f in range(4):
        rng = random.Random(SEED + 300 + f)
        open_ = (0, 1, 5, 2)[f]
        rot = (0, 3, 0, -2)[f]
        rage, charge = f == 3, f == 2
        seam_cols = ("R", "p") if rage else None
        cables, jets, plates_, seams, ring, hexg, eye = (Grid(W, H) for _ in range(7))
        # cables hanging from below (fanned out so they never cross)
        r0, r1 = 20 + open_, 36 + open_
        for i, (a, ex, ey) in enumerate(((60, 70, 86), (80, 56, 90), (100, 40, 90), (120, 26, 86))):
            ar = math.radians(a)
            sx, sy = cx + (r1 - 3) * math.cos(ar), cy + (r1 - 3) * math.sin(ar)
            sway = (0, 1, -1, 2)[f] * (1 if i % 2 else -1)
            pts = bezier((sx, sy), ((sx + ex) / 2, max(sy, ey) + 3), (ex + sway, ey), 40)
            cp = brush([(int(round(x)), int(round(y))) for (x, y) in pts], SQ2)
            shade_rim(cables, cp, "1", light="3", dark="P")
            px_, py_ = int(round(ex + sway)), int(round(ey))
            cables.rect(px_ - 1, py_, px_ + 2, py_ + 2, "3")
            cables.set(px_, py_ + 1, ("C", "M")[i % 2] if not rage else "R")
        # thruster glows under the lower plates
        for a in (50, 130):
            ar = math.radians(a)
            tx, ty = int(round(cx + (r1 + 1) * math.cos(ar))), int(round(cy + (r1 + 1) * math.sin(ar)))
            jets.rect(tx - 2, ty - 1, tx + 2, ty + 1, "2")
            flame = ("C", "B", "C", "O")[f]
            jets.set(tx, ty + 2, "W")
            jets.set(tx - 1, ty + 2, flame)
            jets.set(tx + 1, ty + 2, flame)
            jets.set(tx, ty + 3, flame)
            if f in (0, 2):
                jets.set(tx, ty + 4, "c" if not rage else "o")
        # six segmented armour plates lit from the upper left; horns on top, fins on the sides
        lx_, ly_ = -0.6, -0.8
        for k in range(6):
            mid = -120 + k * 60 + rot
            pts = set()
            for y in range(H):
                for x in range(W):
                    d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                    a = math.degrees(math.atan2(y + 0.5 - cy, x + 0.5 - cx))
                    da = (a - mid + 180) % 360 - 180
                    if abs(da) <= 24 and r0 <= d <= r1 - abs(da) * 0.07:
                        pts.add((x, y))
            hm = None
            if k in (0, 1):
                hm = math.radians(mid + (-10 if k == 0 else 10))
                ln, w = 10, 0.13
            elif k in (2, 5):
                hm = math.radians(mid + (8 if k == 2 else -8))
                ln, w = 5, 0.10
            if hm is not None:
                b1 = (cx + (r1 - 3) * math.cos(hm - w), cy + (r1 - 3) * math.sin(hm - w))
                b2 = (cx + (r1 - 3) * math.cos(hm + w), cy + (r1 - 3) * math.sin(hm + w))
                tip = (cx + (r1 + ln) * math.cos(hm), cy + (r1 + ln) * math.sin(hm))
                pts |= poly_pts([b1, tip, b2])
            for (x, y) in pts:
                d = max(0.01, math.hypot(x + 0.5 - cx, y + 0.5 - cy))
                v = ((x + 0.5 - cx) * lx_ + (y + 0.5 - cy) * ly_) / d
                if d < r0 + 1.6:
                    v -= 0.6
                elif d > r1 - 1.6:
                    v += 0.25 if v > 0 else -0.25
                plates_.set(x, y, "E" if v > 0.6 else "F" if v > 0.15 else "H" if v > -0.3 else "I" if v > -0.75 else "S")
                if abs(d - (r0 + 7)) < 0.5:
                    plates_.set(x, y, "S")
            for off in (-13, 0, 13):  # three rivets per plate
                ar = math.radians(mid + off)
                plates_.set(int(round(cx + (r0 + 11) * math.cos(ar))), int(round(cy + (r0 + 11) * math.sin(ar))),
                            "W" if k in (0, 1, 5) else "F")
            if rage:  # cracks glowing red
                x, y = rng.choice(sorted(pts))
                for _ in range(12):
                    if (x, y) in pts:
                        plates_.set(x, y, "K")
                        if (x + 1, y) in pts:
                            plates_.set(x + 1, y, "R")
                    x += rng.choice((-1, 0, 1))
                    y += rng.choice((-1, 1))
        # glowing seams in the gaps between plates
        for k in range(6):
            gap = -90 + k * 60 + rot
            for y in range(H):
                for x in range(W):
                    d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                    a = math.degrees(math.atan2(y + 0.5 - cy, x + 0.5 - cx))
                    da = abs((a - gap + 180) % 360 - 180)
                    if r0 + 1 <= d <= r1 - 2 and da <= 4.5:
                        if rage:
                            seams.set(x, y, "p" if da < 1.6 else "R")
                        else:
                            core, outer = ("B", "C") if k % 2 == 0 else ("N", "M")
                            seams.set(x, y, core if da < 1.6 else outer)
        # dark inner ring with status lights
        rp = {(x, y) for y in range(H) for x in range(W) if 16.5 <= math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r0 + 0.5}
        shade_rim(ring, rp, "S", light="I", dark="P")
        for k in range(12):
            a = math.radians(k * 30 + 15 + rot)
            ring.set(int(round(cx + 18 * math.cos(a))), int(round(cy + 18 * math.sin(a))),
                     ("R" if rage else ("C", "M")[k % 2]) if (k + f) % 3 else "W")
        # hexagonal eye housing
        hexo = poly_pts([(cx + 18.5 * math.cos(math.radians(-90 + 60 * i)), cy + 18.5 * math.sin(math.radians(-90 + 60 * i)))
                         for i in range(6)])
        hexi = poly_pts([(cx + 14.8 * math.cos(math.radians(-90 + 60 * i)), cy + 14.8 * math.sin(math.radians(-90 + 60 * i)))
                         for i in range(6)])
        plate(hexg, hexo)
        hexg.fill(hexi, "P")
        # iris
        ir = (9.5, 10.5, 10.5, 9.5)[f]
        iris = ellipse_pts(cx, cy, ir, ir)
        for (x, y) in iris:
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if charge:
                ch = "W" if d < 3.5 else "y" if d < 5.5 else "Y" if d < 7 else "O" if d < 8.5 else "R"
            else:
                ch = "q" if d > ir - 1.2 else "r" if d > ir - 3 else "R" if d > 3 else "p"
            eye.set(x, y, ch)
        if not charge:
            pw = 0 if rage else 1
            for y in range(int(cy - ir + 2), int(cy + ir - 1)):
                for x in range(int(cx) - pw - 1, int(cx) + pw + 1):
                    if (x, y) in iris:
                        eye.set(x, y, "K")
            eye.set(int(cx) - 4, int(cy) - 4, "W")
            eye.set(int(cx) - 3, int(cy) - 4, "W")
            eye.set(int(cx) - 4, int(cy) - 3, "N")
            if f == 1:
                for (x, y) in edge_pts(iris, N4):
                    eye.set(x, y, "R")
        g = stack(W, H, cables, jets, plates_, ring, hexg)
        g.blit(seams).blit(eye)
        # glows
        if charge:
            for (x, y) in ellipse_pts(cx, cy, 13, 13):
                if g.get(x, y) in ("P",):
                    g.set(x, y, "O")
            for i in range(8):  # energy arcs from the plates to the eye
                a = math.radians(i * 45 + 22)
                pts = [(cx + (r0 + 2) * math.cos(a), cy + (r0 + 2) * math.sin(a)),
                       (cx + 13 * math.cos(a + 0.15), cy + 13 * math.sin(a + 0.15))]
                for (x, y) in line_pts(*pts[0], *pts[1]):
                    g.set(x, y, "B" if (x + y) % 2 else "W")
        if rage:
            for (x, y) in ellipse_pts(cx, cy, 44, 44):
                if g.get(x, y) == "." and any(g.get(x + dx, y + dy) not in (".", "h") for dx, dy in N4):
                    g.set(x, y, "h")
            for _ in range(14):
                x, y = rng.randint(6, 89), rng.randint(4, 90)
                if g.get(x, y) == ".":
                    g.set(x, y, rng.choice(("R", "O", "Y")))
            for (x, y) in iris:
                if g.get(x, y) == "P":
                    g.set(x, y, "q")
        sheet.paste(g.image(), (f * 96, 0))
    return sheet


# ====================================================================== FX ===
def make_fx():
    sheet = Image.new("RGBA", (256, 32), (0, 0, 0, 0))
    cells = [Grid(32, 32) for _ in range(8)]
    # [0] muzzle flash: blue energy burst pointing right
    g = cells[0]
    for y in range(32):
        for x in range(32):
            dx, dy = x + 0.5 - 9, y + 0.5 - 16
            d = math.hypot(dx, dy)
            a = math.degrees(math.atan2(dy, dx))
            ray = max(0.0, math.cos(math.radians(a * 4))) if abs(a) < 80 else 0
            reach = 5 + 14 * ray * (1 if abs(a) < 30 else 0.5)
            if d < 4.5:
                g.set(x, y, "W" if d < 2.5 else "B")
            elif dx > -3 and d < reach:
                g.set(x, y, "B" if d < reach * 0.5 else "U" if d < reach * 0.8 else "b")
    # [1] slash arc (white/cyan) and [2] heavy slash (red/white): crescents sweeping right
    for idx, cols, thick in ((1, ("W", "B", "C"), 3.4), (2, ("W", "p", "R"), 5.0)):
        g = cells[idx]
        for y in range(32):
            for x in range(32):
                d1 = math.hypot(x + 0.5 - 10, y + 0.5 - 16)
                d2 = math.hypot(x + 0.5 - 10 + thick, y + 0.5 - 16)
                if d1 <= 13.5 and d2 > 13.5 and x + 0.5 > 10:
                    a = abs(math.degrees(math.atan2(y + 0.5 - 16, x + 0.5 - 10)))
                    if a > 82:
                        continue
                    w = 13.5 - d1
                    g.set(x, y, cols[0] if w > thick * 0.45 or a < 20 else cols[1] if w > thick * 0.2 else cols[2])
        if idx == 2:
            for (x, y) in ((25, 6), (27, 10), (28, 22), (26, 26)):
                g.set(x, y, "R")
    # [3] hack ring: green circular glyph ring
    g = cells[3]
    for y in range(32):
        for x in range(32):
            d = math.hypot(x + 0.5 - 16, y + 0.5 - 16)
            a = (math.degrees(math.atan2(y + 0.5 - 16, x + 0.5 - 16)) + 360) % 360
            if 12.6 <= d <= 13.6:
                g.set(x, y, "G")
            elif 10.5 <= d <= 12.0 and int(a // 15) % 3 != 2:
                g.set(x, y, "i" if int(a // 5) % 2 else "G")
            elif 7.5 <= d <= 8.3 and int(a // 10) % 2 == 0:
                g.set(x, y, "k")
    for k in range(6):
        a = math.radians(k * 60 + 30)
        x, y = int(round(16 + 14.6 * math.cos(a))), int(round(16 + 14.6 * math.sin(a)))
        g.set(x, y, "W")
    g.set(16, 16, "G")
    g.set(15, 16, "k")
    g.set(17, 16, "k")
    # [4] small explosion
    g = cells[4]
    blob = set()
    for (bx, by, r_) in ((16, 17, 8), (11, 14, 5), (21, 13, 5.5), (12, 21, 4.5), (21, 21, 5)):
        blob |= ellipse_pts(bx, by, r_, r_)
    for (x, y) in blob:
        d = math.hypot(x + 0.5 - 16, y + 0.5 - 16)
        g.set(x, y, "W" if d < 3 else "y" if d < 5.5 else "Y" if d < 8 else "O" if d < 10 else "o")
    for (x, y) in edge_pts(blob, N4):
        if (x + y) % 3 == 0:
            g.set(x, y, "r")
    for (x, y) in ((3, 6), (28, 5), (29, 27), (4, 27), (16, 2)):
        g.set(x, y, "O")
    # [5] dust puff
    g = cells[5]
    cloud = set()
    for (bx, by, r_) in ((11, 21, 5.5), (19, 20, 6.5), (15, 15, 5.0), (24, 23, 4.0), (6, 24, 3.0)):
        cloud |= ellipse_pts(bx, by, r_, r_ * 0.85)
    for (x, y) in cloud:
        top = min(yy for (xx, yy) in cloud if xx == x)
        g.set(x, y, "s" if y - top < 2 else "t" if y < 22 else "4")
    for (x, y) in edge_pts(cloud, ((1, 0), (0, 1))):
        if y >= 20:
            g.set(x, y, "3")
    for (x, y) in ((3, 18), (28, 16), (26, 12), (8, 13)):
        g.set(x, y, "t")
    # [6] stun icon: glitchy stars
    g = cells[6]
    for (sx, sy, col, r_) in ((9, 14, "Y", 4), (17, 9, "C", 5), (24, 15, "Y", 4)):
        for i in range(-r_, r_ + 1):
            g.set(sx + i, sy, col)
            g.set(sx, sy + i, col)
        for i in (-1, 1):
            g.set(sx + i, sy + i, col)
            g.set(sx + i, sy - i, col)
        g.set(sx, sy, "W")
    for (x, y, ch) in ((6, 20, "C"), (7, 20, "C"), (19, 18, "M"), (20, 18, "M"), (26, 7, "C"), (13, 4, "Y")):
        g.set(x, y, ch)
    # [7] hex shield bubble: cyan, mostly transparent inside
    g = cells[7]
    hexo = poly_pts([(16 + 14.5 * math.cos(math.radians(-90 + 60 * i)), 16 + 14.5 * math.sin(math.radians(-90 + 60 * i)))
                     for i in range(6)])
    edge = edge_pts(hexo, N8)
    for (x, y) in hexo:
        if (x + 2 * y) % 7 == 0:
            g.set(x, y, "g")
    for i in range(6):
        a = math.radians(-90 + 60 * i)
        for (x, y) in line_pts(16, 16, int(round(16 + 7 * math.cos(a))), int(round(16 + 7 * math.sin(a)))):
            if (x + y) % 2 == 0:
                g.set(x, y, "g")
    g.fill(edge, "C")
    for (x, y) in edge:
        if y < 12 and x < 16:
            g.set(x, y, "B")
    g.set(10, 6, "W")
    for i, c in enumerate(cells):
        sheet.paste(c.image(), (i * 32, 0))
    return sheet


# ===================================================================== RIG ===
# Small joint-based helpers shared by the big characters: limbs are tapered
# capsules, each body part lives on its own layer (so stack() draws a dark
# contour between overlapping parts), and every frame is finally shifted so
# its lowest opaque row lands on the requested baseline.
def seg(g, a, b, ra, rb, base, light, dark):
    pts = capsule_pts(a, b, ra, rb)
    shade_rim(g, pts, base, light=light, dark=dark)
    return pts


def shifted(g, dx, dy):
    out = Grid(g.w, g.h)
    for y in range(g.h):
        for x in range(g.w):
            ch = g.px[y][x]
            if ch != ".":
                out.set(x + dx, y + dy, ch)
    out.outlined = g.outlined
    return out


def align_bottom(g, row):
    low = max(y for y in range(g.h) for x in range(g.w) if g.px[y][x] != ".")
    return shifted(g, 0, row - low) if low != row else g


def seam_line(g, a, b, ch, offset=(0, 0)):
    for (x, y) in line_pts(a[0] + offset[0], a[1] + offset[1], b[0] + offset[0], b[1] + offset[1]):
        if g.get(x, y) != ".":
            g.set(x, y, ch)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def unit(v):
    ln = math.hypot(v[0], v[1]) or 1.0
    return (v[0] / ln, v[1] / ln)


def torso_poly(chest, pelvis, w_top, w_waist, w_hip, up=2.0):
    d = unit((chest[0] - pelvis[0], chest[1] - pelvis[1]))
    n = (-d[1], d[0])
    waist = lerp(pelvis, chest, 0.3)
    pts = [(chest[0] + n[0] * w_top / 2 + d[0] * up, chest[1] + n[1] * w_top / 2 + d[1] * up),
           (chest[0] - n[0] * w_top / 2 + d[0] * up, chest[1] - n[1] * w_top / 2 + d[1] * up),
           (waist[0] - n[0] * w_waist / 2, waist[1] - n[1] * w_waist / 2),
           (pelvis[0] - n[0] * w_hip / 2 - d[0] * 3, pelvis[1] - n[1] * w_hip / 2 - d[1] * 3),
           (pelvis[0] + n[0] * w_hip / 2 - d[0] * 3, pelvis[1] + n[1] * w_hip / 2 - d[1] * 3),
           (waist[0] + n[0] * w_waist / 2, waist[1] + n[1] * w_waist / 2)]
    return poly_pts(pts), d, n


# ====================================================== OVERSEER  AVATAR ===
def _ov(**kw):
    base = dict(head=(33, 14), chest=(32, 30), pelvis=(31, 53),
                sn=(37, 27), en=(40, 41), hn=(40, 54), sf=(26, 27), ef=(23, 41), hf=(23, 54),
                kn=(37, 73), fn=(38, 89), kf=(27, 73), ff=(26, 89),
                trail=(-3, 26), eye="normal", fx=None)
    base.update(kw)
    return base


OV_POSES = [
    _ov(),                                                                     # 0 idle
    _ov(head=(33, 13), chest=(32, 29), sn=(37, 26), sf=(26, 26), en=(40, 40), ef=(23, 40), eye="pulse",
        trail=(-4, 25)),                                                       # 1 idle (breathing)
    _ov(head=(38, 15), chest=(35, 31), pelvis=(31, 54), sn=(39, 28), sf=(29, 28),       # 2 run: contact
        en=(32, 41), hn=(27, 51), ef=(39, 39), hf=(45, 45),
        kn=(41, 70), fn=(47, 89), kf=(24, 71), ff=(16, 81), trail=(-12, 18)),
    _ov(head=(37, 14), chest=(35, 30), pelvis=(31, 52), sn=(39, 27), sf=(29, 27),       # 3 run: pass
        en=(37, 41), hn=(35, 53), ef=(31, 41), hf=(31, 52),
        kn=(35, 72), fn=(33, 89), kf=(39, 65), ff=(34, 78), trail=(-13, 17)),
    _ov(head=(38, 15), chest=(35, 31), pelvis=(31, 54), sn=(39, 28), sf=(29, 28),       # 4 run: contact (other leg)
        en=(43, 39), hn=(49, 45), ef=(28, 41), hf=(22, 50),
        kn=(26, 71), fn=(18, 81), kf=(39, 70), ff=(45, 89), trail=(-12, 19)),
    _ov(head=(37, 14), chest=(35, 30), pelvis=(31, 52), sn=(39, 27), sf=(29, 27),       # 5 run: pass (other leg)
        en=(36, 41), hn=(37, 52), ef=(30, 41), hf=(28, 52),
        kn=(41, 65), fn=(37, 78), kf=(31, 72), ff=(30, 89), trail=(-13, 18)),
    _ov(head=(35, 13), chest=(33, 30), pelvis=(32, 51), sn=(38, 26), sf=(27, 27),       # 6 jump / airborne
        en=(43, 19), hn=(46, 10), ef=(20, 30), hf=(13, 24),
        kn=(41, 62), fn=(38, 76), kf=(30, 64), ff=(23, 76), trail=(-9, 24)),
    _ov(head=(47, 27), chest=(40, 35), pelvis=(29, 51), sn=(43, 32), sf=(36, 30),       # 7 dash
        en=(33, 42), hn=(24, 45), ef=(28, 37), hf=(18, 38),
        kn=(41, 66), fn=(49, 88), kf=(20, 68), ff=(9, 83), trail=(-24, 6), fx="dash"),
    _ov(head=(33, 14), chest=(31, 31), pelvis=(29, 54), sn=(37, 27), sf=(26, 28),       # 8 shoot (arm cannon)
        en=(45, 28), hn=(52, 28), ef=(33, 38), hf=(40, 31),
        kn=(39, 73), fn=(44, 89), kf=(22, 74), ff=(17, 89), fx="cannon"),
    _ov(head=(33, 18), chest=(32, 35), pelvis=(32, 58), sn=(38, 32), sf=(26, 32),       # 9 eye-laser charge
        en=(43, 45), hn=(47, 55), ef=(21, 45), hf=(17, 55),
        kn=(42, 75), fn=(46, 89), kf=(22, 75), ff=(17, 89), eye="hot", fx="charge"),
    _ov(head=(41, 36), chest=(36, 46), pelvis=(28, 65), sn=(41, 43), sf=(31, 42),       # 10 slam
        en=(47, 60), hn=(49, 86), ef=(24, 38), hf=(17, 29),
        kn=(40, 75), fn=(40, 89), kf=(21, 80), ff=(13, 89), trail=(-12, 14), fx="slam"),
    _ov(head=(33, 30), chest=(31, 46), pelvis=(29, 67), sn=(37, 43), sf=(25, 43),       # 11 vent (kneeling)
        en=(42, 56), hn=(43, 67), ef=(20, 56), hf=(19, 68),
        kn=(42, 71), fn=(43, 89), kf=(25, 89), ff=(12, 89), eye="dim", fx="vent", trail=(-10, 16)),
    _ov(head=(34, 14), chest=(32, 30), pelvis=(31, 53), sn=(37, 27), sf=(26, 27),       # 12 taunt (beckon)
        en=(44, 37), hn=(46, 27), ef=(21, 40), hf=(26, 49), fx="beckon"),
    _ov(head=(27, 17), chest=(29, 33), pelvis=(32, 54), sn=(34, 30), sf=(23, 30),       # 13 hurt
        en=(40, 29), hn=(46, 23), ef=(18, 36), hf=(12, 30),
        kn=(40, 73), fn=(44, 89), kf=(29, 74), ff=(25, 89), eye="dim", fx="hurt", trail=(-2, 25)),
]


def ov_head(g, glow, H, mode, f):
    cx, cy = H
    hexo = poly_pts([(cx + 10.6 * math.cos(math.radians(-90 + 60 * i)), cy + 10.6 * math.sin(math.radians(-90 + 60 * i)))
                     for i in range(6)])
    hexi = poly_pts([(cx + 7.6 * math.cos(math.radians(-90 + 60 * i)), cy + 7.6 * math.sin(math.radians(-90 + 60 * i)))
                     for i in range(6)])
    plate(g, hexo)
    g.fill(hexi, "P")
    for i in range(6):  # neon corner seams
        a = math.radians(-90 + 60 * i)
        g.set(int(round(cx + 9.2 * math.cos(a))), int(round(cy + 9.2 * math.sin(a))), "C" if i % 2 else "M")
    ix = cx + 1.2
    r_i = 5.0 if mode == "pulse" else 4.4
    iris = ellipse_pts(ix, cy, r_i, r_i)
    for (x, y) in iris:
        d = math.hypot(x + 0.5 - ix, y + 0.5 - cy)
        if mode == "hot":
            ch = "W" if d < 2.4 else "y" if d < 3.4 else "Y"
        elif mode == "dim":
            ch = "q" if d > 3.0 else "r"
        else:
            ch = "q" if d > r_i - 1.1 else "r" if d > r_i - 2.0 else "R" if d > 1.4 else "p"
        g.set(x, y, ch)
    if mode != "hot":
        for y in range(int(cy) - 3, int(cy) + 4):
            g.set(int(ix), y, "K")
        g.set(int(ix) - 2, int(cy) - 3, "W")
        g.set(int(ix) - 3, int(cy) - 2, "W")
    if mode == "hot":
        for (x, y) in ellipse_pts(cx, cy, 12, 12):
            glow.set(x, y, "(")
        for i in range(8):
            a = math.radians(i * 45 + 22)
            for r_ in range(9, 13):
                glow.set(int(round(cx + r_ * math.cos(a))), int(round(cy + r_ * math.sin(a))), "W" if r_ < 11 else "y")


def ov_arm(g, S, E, Hd, far, cannon=False):
    up, low = ("1", "2", "P") if far else ("2", "3", "1"), ("I", "H", "S") if far else ("H", "F", "I")
    seg(g, S, E, 3.7, 3.2, *up)
    if cannon:
        d = unit((Hd[0] - E[0], Hd[1] - E[1]))
        tip = (Hd[0] + d[0] * 6, Hd[1] + d[1] * 6)
        seg(g, E, tip, 3.6, 3.4, "I", "H", "S")
        for t in (0.3, 0.6):
            p = lerp(E, tip, t)
            g.vline(int(p[0]), int(p[1]) - 3, int(p[1]) + 3, "S")
        g.vline(int(tip[0]), int(tip[1]) - 2, int(tip[1]) + 2, "M")
        g.vline(int(tip[0]) - 1, int(tip[1]) - 2, int(tip[1]) + 2, "N")
        return tip
    seg(g, E, Hd, 3.4, 2.9, *low)
    seam_line(g, E, Hd, "M" if far else "C", (1, 0))
    fist = ellipse_pts(Hd[0], Hd[1] + 0.5, 3.2, 3.2)
    shade_rim(g, fist, low[0], light=low[1], dark=low[2])
    return Hd


def ov_pauldron(g, S, far):
    pp = ellipse_pts(S[0], S[1], 6.2, 5.0)
    if far:
        shade_rim(g, pp, "I", light="H", dark="S")
    else:
        plate(g, pp)
    for (x, y) in pp:
        if (x, y + 1) not in pp:
            g.set(x, y, "M" if not far else "m")


def ov_leg(g, hip, K, F, far, kneel_shin=False):
    th = ("1", "2", "P") if far else ("2", "3", "1")
    sh = ("I", "H", "S") if far else ("H", "F", "I")
    seg(g, hip, K, 4.8, 4.0, *th)
    seg(g, K, F, 3.9, 3.0, *sh)
    seam_line(g, K, F, "C" if not far else "e", (1, 0))
    seam_line(g, hip, K, "M" if not far else "m", (1, 0))
    kp = ellipse_pts(K[0], K[1], 3.7, 3.7)
    shade_rim(g, kp, sh[0], light="E" if not far else "H", dark=sh[2])
    fx_, fy_ = int(F[0]), int(F[1])
    fp = {(x, y) for x in range(fx_ - 3, fx_ + 7) for y in range(fy_, fy_ + 5)}
    fp -= {(fx_ + 6, fy_), (fx_ + 5, fy_), (fx_ + 6, fy_ + 1)}
    shade_rim(g, fp, sh[0], light=sh[1], dark=sh[2])
    g.hline(fx_ - 3, fx_ + 6, fy_ + 4, "S")
    if not far:
        g.set(fx_ + 4, fy_ + 2, "C")


def ov_frame(f):
    P = OV_POSES[f]
    W, H = 64, 96
    cab, farA, farL, torso, nearL, head, nearA, glow, fx = (Grid(W, H) for _ in range(9))
    pv, ch = P["pelvis"], P["chest"]
    # cable "coat tail" hanging from the back of the waist
    tx, ty = P["trail"]
    sway = (0, 1, -1, 1, -1, 1, 0, 0, 0, 0, 0, 0, 0, -1)[f]
    for i, (ox, oy) in enumerate(((-5, -3), (-6, 1), (-4, 4))):
        a = (pv[0] + ox, pv[1] + oy)
        end = (a[0] + tx - 3 * i + sway, a[1] + ty + 3 * i)
        mid = ((a[0] + end[0]) / 2 - 2, max(a[1], end[1]) - (ty * 0.25 if ty > 10 else -3))
        pts = [(int(round(x)), int(round(y))) for (x, y) in bezier(a, mid, end, 40)]
        cp = thick_pts(pts, 1.0)
        shade_rim(cab, cp, "2", light="4", dark="1")
        for k_, (x, y) in enumerate(pts):
            if k_ % 9 == 4:
                for (xx, yy) in thick_pts([(x, y)], 1.0):
                    if (xx, yy) in cp:
                        cab.set(xx, yy, "H")
        ex, ey = int(round(end[0])), int(round(end[1]))
        cab.rect(ex - 1, ey, ex + 1, ey + 2, "H")
        cab.set(ex, ey + 2, ("C", "M", "C")[i])
    # legs
    hip_n = (pv[0] + 3, pv[1] + 3)
    hip_f = (pv[0] - 3, pv[1] + 3)
    ov_leg(farL, hip_f, P["kf"], P["ff"], True)
    ov_leg(nearL, hip_n, P["kn"], P["fn"], False)
    # torso: chrome chest plates, black segmented abdomen, neon seams
    tp, d, n = torso_poly(ch, pv, 23, 14, 16)
    shade_rim(torso, tp, "1", light="2", dark="P")
    span = math.hypot(ch[0] - pv[0], ch[1] - pv[1])
    for (x, y) in tp:
        t = ((x + 0.5 - pv[0]) * d[0] + (y + 0.5 - pv[1]) * d[1]) / span
        if t > 0.58:
            torso.set(x, y, "H" if t < 0.9 else "F")
        elif t < 0.12:
            torso.set(x, y, "I")
        elif int(t * 14) % 2 == 0 and torso.get(x, y) == "1":
            torso.set(x, y, "2")
    for (x, y) in edge_pts({p for p in tp if ((p[0] + 0.5 - pv[0]) * d[0] + (p[1] + 0.5 - pv[1]) * d[1]) / span > 0.58},
                           ((0, 1),)):
        torso.set(x, y, "M")
    seam_line(torso, lerp(pv, ch, 0.12), lerp(pv, ch, 0.56), "C")
    neck = lerp(ch, P["head"], 0.5)
    seg(torso, ch, neck, 2.6, 2.4, "S", "I", "P")
    if P["fx"] == "vent":  # chest plates swung open around a glowing core
        core = lerp(pv, ch, 0.72)
        for side in (-1, 1):
            a = (core[0] + n[0] * 7 * side, core[1] + n[1] * 7 * side)
            flap = poly_pts([(a[0], a[1] - 6), (a[0] + 5 * side, a[1] - 4), (a[0] + 5 * side, a[1] + 4), (a[0], a[1] + 5)])
            plate(torso, flap)
        cp = ellipse_pts(core[0], core[1], 5.2, 5.2)
        torso.fill(cp, "S")
        for (x, y) in ellipse_pts(core[0], core[1], 4.2, 4.2):
            dd = math.hypot(x + 0.5 - core[0], y + 0.5 - core[1])
            torso.set(x, y, "W" if dd < 1.8 else "y" if dd < 2.8 else "Y" if dd < 3.6 else "O")
        for i, (sx, sy) in enumerate(((-4, -10), (3, -12), (8, -8), (-8, -6))):
            for k in range(3):
                glow.set(int(core[0]) + sx + (k % 2), int(core[1]) + sy - k * 2, "g" if i % 2 else "s")
    # arms + pauldrons
    ov_arm(farA, P["sf"], P["ef"], P["hf"], True)
    ov_pauldron(farA, P["sf"], True)
    tip = ov_arm(nearA, P["sn"], P["en"], P["hn"], False, cannon=(P["fx"] == "cannon"))
    ov_pauldron(nearA, P["sn"], False)
    ov_head(head, glow, P["head"], P["eye"], f)
    g = stack(W, H, cab, farA, farL, torso, nearL, head, nearA)
    # effects (no outline)
    kind = P["fx"]
    if kind == "dash":
        for (y, x0, x1) in ((30, 0, 8), (38, 2, 12), (46, 0, 7), (56, 3, 10), (64, 0, 6)):
            for x in range(x0, x1 + 1):
                if g.get(x, y) == ".":
                    g.set(x, y, "c" if x < x1 else "B")
    elif kind == "cannon":
        x0, y0 = int(tip[0]) + 1, int(tip[1])
        for (dx, dy, c) in ((0, 0, "W"), (1, 0, "W"), (2, 0, "N"), (3, 0, "M"), (4, 0, "M"), (5, 0, "m"), (1, -1, "N"),
                            (1, 1, "N"), (2, -2, "M"), (2, 2, "M"), (3, -3, "m"), (3, 3, "m"), (0, -1, "W"), (0, 1, "W")):
            if 0 <= x0 + dx < W:
                g.set(x0 + dx, y0 + dy, c)
    elif kind == "slam":
        hx, hy = int(P["hn"][0]), 93
        for r_ in (5, 8, 11):
            for x in range(hx - r_, hx + r_ + 1):
                y = hy - int(round(math.sqrt(max(0, r_ * r_ - (x - hx) ** 2)) * 0.35))
                if g.get(x, y) == "." and (x + r_) % 2 == 0:
                    g.set(x, y, "W" if r_ == 5 else "B" if r_ == 8 else "C")
        for (x, y) in ((hx - 9, 86), (hx + 10, 85), (hx + 6, 83), (hx - 5, 84)):
            g.set(x, y, "3")
    elif kind == "beckon":
        hx, hy = int(P["hn"][0]), int(P["hn"][1])
        for (dx, dy) in ((2, -3), (3, -4), (4, -3)):
            g.set(hx + dx, hy + dy, "F")
        for (dx, dy) in ((-3, -6), (-2, -7), (6, -6), (7, -7)):
            if g.get(hx + dx, hy + dy) == ".":
                g.set(hx + dx, hy + dy, "C")
    elif kind == "hurt":
        for (dx, dy, c) in ((-10, -6, "Y"), (-8, -9, "W"), (-12, 2, "O"), (8, -8, "Y"), (10, -3, "W"), (-4, -11, "O")):
            x, y = int(P["head"][0]) + dx, int(P["head"][1]) + dy
            if g.get(x, y) == ".":
                g.set(x, y, c)
    for y in range(H):
        for x in range(W):
            if glow.get(x, y) != "." and g.get(x, y) == ".":
                g.set(x, y, glow.get(x, y))
    return align_bottom(g, 94)


def make_overseer_avatar():
    sheet = Image.new("RGBA", (896, 96), (0, 0, 0, 0))
    for f in range(14):
        sheet.paste(ov_frame(f).image(), (f * 64, 0))
    return sheet


# ============================================================= FINAL GOAT ===
def _gp(**kw):
    base = dict(head=(61, 22), ang=0, jaw=0, chest=(50, 38), pelvis=(45, 62),
                sn=(56, 38), en=(62, 52), hn=(63, 65), sf=(42, 37), ef=(37, 52), hf=(35, 64),
                kn=(55, 74), cn=(50, 85), fn=(53, 92), kf=(47, 75), cf=(42, 85), ff=(45, 92),
                tail=(22, 80), mode="normal", fx=None)
    base.update(kw)
    return base


GOAT_POSES = [
    _gp(),                                                                            # 0 idle
    _gp(head=(61, 21), chest=(50, 37), sn=(56, 37), sf=(42, 36), en=(63, 51), ef=(36, 51), tail=(21, 82)),
    _gp(head=(65, 23), chest=(53, 39), pelvis=(46, 62), sn=(59, 39), sf=(45, 38),        # 2 run: contact
        en=(55, 52), hn=(50, 62), ef=(50, 50), hf=(57, 58),
        kn=(60, 72), cn=(58, 83), fn=(62, 92), kf=(43, 76), cf=(34, 80), ff=(29, 88), tail=(18, 74)),
    _gp(head=(64, 21), chest=(53, 37), pelvis=(46, 60), sn=(59, 37), sf=(45, 36),        # 3 run: pass
        en=(60, 51), hn=(59, 63), ef=(41, 51), hf=(40, 62),
        kn=(53, 72), cn=(48, 82), fn=(51, 92), kf=(53, 67), cf=(47, 76), ff=(50, 83), tail=(17, 72)),
    _gp(head=(65, 23), chest=(53, 39), pelvis=(46, 62), sn=(59, 39), sf=(45, 38),        # 4 run: contact (other)
        en=(64, 50), hn=(70, 58), ef=(41, 52), hf=(36, 61),
        kn=(44, 75), cn=(35, 80), fn=(30, 88), kf=(59, 72), cf=(57, 83), ff=(61, 92), tail=(18, 75)),
    _gp(head=(64, 21), chest=(53, 37), pelvis=(46, 60), sn=(59, 37), sf=(45, 36),        # 5 run: pass (other)
        en=(58, 51), hn=(56, 63), ef=(44, 51), hf=(46, 62),
        kn=(55, 67), cn=(49, 76), fn=(52, 83), kf=(51, 72), cf=(46, 82), ff=(49, 92), tail=(17, 71)),
    _gp(head=(72, 38), ang=32, chest=(60, 44), pelvis=(44, 60), sn=(64, 45), sf=(53, 42),  # 6 charge
        en=(58, 57), hn=(52, 64), ef=(48, 54), hf=(42, 60),
        kn=(60, 73), cn=(62, 83), fn=(68, 92), kf=(38, 72), cf=(28, 76), ff=(20, 84), tail=(12, 58)),
    _gp(head=(60, 18), ang=-12, chest=(50, 35), pelvis=(46, 58), sn=(57, 34), sf=(43, 33),  # 7 leap
        en=(68, 26), hn=(74, 16), ef=(32, 28), hf=(24, 20),
        kn=(58, 62), cn=(52, 72), fn=(56, 78), kf=(48, 66), cf=(40, 72), ff=(42, 79), tail=(26, 84)),
    _gp(head=(64, 40), ang=18, chest=(53, 52), pelvis=(45, 72), sn=(60, 52), sf=(45, 50),  # 8 stomp landing
        en=(67, 66), hn=(70, 88), ef=(36, 66), hf=(30, 88),
        kn=(60, 78), cn=(55, 87), fn=(60, 92), kf=(40, 80), cf=(34, 88), ff=(38, 92), tail=(16, 88), fx="stomp"),
    _gp(head=(64, 26), ang=8, jaw=28, chest=(52, 40), pelvis=(45, 63), sn=(58, 40), sf=(44, 39),  # 9 fire breath
        en=(64, 53), hn=(68, 62), ef=(38, 54), hf=(35, 64),
        kn=(58, 75), cn=(54, 85), fn=(58, 92), kf=(44, 76), cf=(37, 85), ff=(39, 92), fx="fire"),
    _gp(head=(58, 22), ang=-34, jaw=30, chest=(49, 38), pelvis=(45, 62), sn=(56, 37), sf=(41, 36),  # 10 roar
        en=(68, 34), hn=(80, 28), ef=(30, 34), hf=(18, 28), fx="roar"),
    _gp(mode="rage", fx="steam", hn=(64, 64), hf=(34, 63)),                               # 11 enraged idle
    _gp(head=(53, 23), ang=-20, chest=(46, 39), pelvis=(46, 62), sn=(52, 39), sf=(38, 38),  # 12 hurt
        en=(60, 34), hn=(67, 28), ef=(30, 46), hf=(22, 42),
        kn=(56, 72), cn=(54, 82), fn=(58, 88), kf=(44, 76), cf=(39, 85), ff=(41, 92), mode="hurt", fx="sparks"),
    _gp(head=(64, 52), ang=38, jaw=10, chest=(53, 58), pelvis=(46, 75), sn=(59, 58), sf=(46, 56),  # 13 defeated
        en=(63, 68), hn=(62, 77), ef=(41, 72), hf=(38, 88),
        kn=(61, 78), cn=(58, 87), fn=(62, 92), kf=(45, 92), cf=(32, 90), ff=(26, 92), tail=(18, 92), mode="dim"),
]


def rotated_pts(H, ang, test, radius=30):
    """Pixels whose head-local coordinates (rotated by ang degrees) pass test(lx, ly)."""
    ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    out = set()
    for y in range(int(H[1] - radius), int(H[1] + radius) + 1):
        for x in range(int(H[0] - radius), int(H[0] + radius) + 1):
            dx, dy = x + 0.5 - H[0], y + 0.5 - H[1]
            lx, ly = dx * ca + dy * sa, -dx * sa + dy * ca
            if test(lx, ly):
                out.add((x, y))
    return out


def to_global(H, ang, p):
    ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    return (H[0] + p[0] * ca - p[1] * sa, H[1] + p[0] * sa + p[1] * ca)


def goat_head(back, head, horns_far, glow, P):
    H, ang, jaw, mode = P["head"], P["ang"], P["jaw"], P["mode"]
    k_ = 1.22  # skull scale (horns keep their size so they stay inside the frame)
    ell = lambda cx, cy, rx, ry: (lambda lx, ly: ((lx / k_ - cx) / rx) ** 2 + ((ly / k_ - cy) / ry) ** 2 <= 1)
    pol = lambda pts: (lambda lx, ly: point_in_poly(lx / k_, ly / k_, pts))
    sc = lambda p: (p[0] * k_, p[1] * k_)
    mane = rotated_pts(H, ang, ell(-7, 6, 7.5, 9.5))
    shade_rim(back, mane, "]", light="{", dark="[")
    # horns (chrome, ridged, cyan tips)
    for g_, base_, ctrl, tip, r0, far in ((horns_far, (-4, -5), (-8, -17), (-21, -13), 3.2, True),
                                          (head, (0, -6), (-2, -18), (-16, -17), 3.8, False)):
        pts = bezier(to_global(H, ang, sc(base_)), to_global(H, ang, ctrl), to_global(H, ang, tip), 40)
        hp = set()
        for i, (x, y) in enumerate(pts):
            r_ = r0 * (1 - i / 48)
            hp |= ellipse_pts(x, y, max(0.7, r_), max(0.7, r_))
        shade_rim(g_, hp, "I" if far else "F", light="H" if far else "E", dark="S" if far else "I")
        for i, (x, y) in enumerate(pts):
            if i % 5 == 2 and i < 32:
                g_.set(int(x), int(y), "S" if far else "H")
        tip_col = "R" if mode == "rage" else "C"
        for (x, y) in pts[-7:]:
            g_.set(int(x), int(y), tip_col)
        g_.set(int(pts[-1][0]), int(pts[-1][1]), "W" if not far else tip_col)
    ear = rotated_pts(H, ang, pol([(-5, -2), (-13, 0), (-6, 2)]))
    shade_rim(head, ear, "-", light="_", dark="|")
    skull = rotated_pts(H, ang, ell(-1, -1, 7.5, 6.8)) | rotated_pts(H, ang, pol([(2, -5), (13, 2), (13.5, 6), (5, 8), (0, 5)]))
    shade_rim(head, skull, "-", light="_", dark="|")
    hinge = (1, 5)
    ja = math.radians(jaw)

    def jp(p):
        dx, dy = p[0] - hinge[0], p[1] - hinge[1]
        return (hinge[0] + dx * math.cos(ja) - dy * math.sin(ja), hinge[1] + dx * math.sin(ja) + dy * math.cos(ja))

    jaw_poly = [jp(p) for p in ((0, 5), (11.5, 7), (6, 10.5), (1, 9))]
    if jaw > 5:  # open mouth glowing inside
        mouth = rotated_pts(H, ang, pol([(2, 6), (13, 6), jaw_poly[1], jaw_poly[2], jaw_poly[0]]))
        head.fill(mouth, "q")
        for (x, y) in mouth:
            if (x - 1, y) in mouth and (x + 1, y) in mouth and (x, y - 1) in mouth:
                head.set(x, y, "O" if P["fx"] == "fire" else "R")
    jaw_pts = rotated_pts(H, ang, pol(jaw_poly))
    shade_rim(head, jaw_pts, "-", light="_", dark="|")
    beard = rotated_pts(H, ang, pol([jp((3, 9)), jp((8, 10)), jp((5, 15))]))
    head.fill(beard, "|")
    for (lx, ly) in ((0, -4), (2, -3.6), (4, -3), (6, -2.4)):
        x, y = to_global(H, ang, sc((lx, ly)))
        head.set(int(x), int(y), "|")
    nx_, ny_ = to_global(H, ang, sc((12, 3)))
    head.set(int(nx_), int(ny_), "|")
    head.set(int(nx_) - 1, int(ny_), "|")
    ex, ey = to_global(H, ang, sc((3.5, -0.5)))
    ex, ey = int(ex), int(ey)
    eye = {"dim": ("r", "q"), "hurt": ("R", "r")}.get(mode, ("R", "W"))
    head.rect(ex, ey, ex + 2, ey + 1, eye[0])
    head.set(ex + 1, ey, eye[1])
    head.set(ex + 2, ey, eye[1] if mode == "rage" else eye[0])
    if mode not in ("dim", "hurt"):
        for (x, y) in ellipse_pts(ex + 1, ey + 0.5, 3.4 if mode == "rage" else 2.4, 2.2):
            glow.set(x, y, "(")
    return to_global(H, ang, sc(jp((12, 8))))


def goat_frame(f):
    P = GOAT_POSES[f]
    W, H = 96, 96
    rage = P["mode"] == "rage"
    circ = "R" if rage else "C"
    tail, farA, farL, horns_far, back, torso, nearL, head, nearA, glow = (Grid(W, H) for _ in range(10))
    pv, ch = P["pelvis"], P["chest"]
    # cable tail
    tb = (pv[0] - 9, pv[1] - 1)
    te = P["tail"]
    ctrl = ((tb[0] + te[0]) / 2 - 2, max(tb[1], te[1]) + 4)
    pts = [(int(round(x)), int(round(y))) for (x, y) in bezier(tb, ctrl, te, 50)]
    tp_ = thick_pts(pts, 1.4)
    shade_rim(tail, tp_, "2", light="4", dark="1")
    for i, (x, y) in enumerate(pts):
        if i % 7 == 3:
            for q in thick_pts([(x, y)], 1.4):
                if q in tp_:
                    tail.set(q[0], q[1], "H")
    d_ = unit((te[0] - pts[-6][0], te[1] - pts[-6][1]))
    n_ = (-d_[1], d_[0])
    spike = poly_pts([(te[0] + n_[0] * 2.5, te[1] + n_[1] * 2.5), (te[0] + d_[0] * 6, te[1] + d_[1] * 6),
                      (te[0] - n_[0] * 2.5, te[1] - n_[1] * 2.5)])
    tail.fill(spike, "R" if rage else "C")
    tail.fill(edge_pts(spike, ((1, 0), (0, 1))), "r" if rage else "c")
    # legs (digitigrade): thigh fur, chrome knee, shin, metatarsus, split hoof
    for g_, hip, K, C_, F, far in ((farL, (pv[0] - 4, pv[1] + 2), P["kf"], P["cf"], P["ff"], True),
                                   (nearL, (pv[0] + 3, pv[1] + 2), P["kn"], P["cn"], P["fn"], False)):
        fur = ("[", "]", ")") if far else ("]", "{", "[")
        seg(g_, hip, K, 7.4, 6.0, fur[0], fur[1], fur[2])
        seg(g_, K, C_, 5.2, 4.0, fur[0] if far else "[", fur[1], fur[2] if far else ")")
        seg(g_, C_, F, 3.6, 3.0, "|", "-", ")")
        kp = ellipse_pts(K[0], K[1], 3.8, 3.8)
        if far:
            shade_rim(g_, kp, "I", light="H", dark="S")
        else:
            plate(g_, kp)
            g_.set(int(K[0]) + 3, int(K[1]) - 2, "F")
            g_.set(int(K[0]) + 4, int(K[1]) - 3, "E")
            seam_line(g_, hip, K, circ, (2, 0))
        fx_, fy_ = int(F[0]), int(F[1])
        hoof = {(x, y) for x in range(fx_ - 3, fx_ + 6) for y in range(fy_ - 1, fy_ + 2)}
        shade_rim(g_, hoof, "I" if far else "H", light="H" if far else "F", dark="S")
        g_.vline(fx_ + 1, fy_ - 1, fy_ + 1, "S")
    # torso: fur, brown chest skin with circuits, chrome chest plate
    tp, d, n = torso_poly(ch, pv, 36, 23, 26)
    shade_rim(torso, tp, "]", light="{", dark="[")
    span = math.hypot(ch[0] - pv[0], ch[1] - pv[1])
    rng = random.Random(SEED + 500 + f)
    for (x, y) in tp:
        t = ((x + 0.5 - pv[0]) * d[0] + (y + 0.5 - pv[1]) * d[1]) / span
        s_ = (x + 0.5 - pv[0]) * n[0] + (y + 0.5 - pv[1]) * n[1]
        front = s_ < -2
        if front and 0.15 < t < 0.78:
            torso.set(x, y, "-" if s_ > -8 else "_")
        if front and t >= 0.72:
            torso.set(x, y, "H" if t < 0.92 else "F")
        if torso.get(x, y) == "]" and rng.random() < 0.08:
            torso.set(x, y, "[")
    plate_edge = {p for p in tp if ((p[0] + 0.5 - pv[0]) * d[0] + (p[1] + 0.5 - pv[1]) * d[1]) / span >= 0.72
                  and ((p[0] + 0.5 - pv[0]) * n[0] + (p[1] + 0.5 - pv[1]) * n[1]) < -2}
    for (x, y) in edge_pts(plate_edge, ((0, 1),)):
        torso.set(x, y, circ)
    for k in range(3):  # abdominal muscle lines + circuit traces
        a = lerp(pv, ch, 0.25 + k * 0.15)
        b = (a[0] - n[0] * 9, a[1] - n[1] * 9)
        seam_line(torso, (a[0] - n[0] * 3, a[1] - n[1] * 3), b, "|")
    seam_line(torso, lerp(pv, ch, 0.2), lerp(pv, ch, 0.7), circ, (int(round(-n[0] * 5)), int(round(-n[1] * 5))))
    neck = lerp(ch, P["head"], 0.55)
    seg(torso, ch, neck, 7.0, 6.0, "]", "{", "[")
    # arms: fur upper arm with spiked pauldron, chrome-braced forearm, clawed fist
    for g_, S_, E_, Hd, far in ((farA, P["sf"], P["ef"], P["hf"], True), (nearA, P["sn"], P["en"], P["hn"], False)):
        fur = ("[", "]", ")") if far else ("]", "{", "[")
        seg(g_, S_, E_, 6.4, 5.4, *fur)
        seg(g_, E_, Hd, 5.0, 4.2, "|" if far else "-", "-" if far else "_", ")" if far else "|")
        br = capsule_pts(lerp(E_, Hd, 0.35), lerp(E_, Hd, 0.75), 4.8, 4.4)
        shade_rim(g_, br, "I" if far else "H", light="H" if far else "F", dark="S")
        if not far:
            seam_line(g_, lerp(E_, Hd, 0.35), lerp(E_, Hd, 0.75), circ, (1, 0))
        fist = ellipse_pts(Hd[0], Hd[1] + 1, 4.4, 4.2)
        shade_rim(g_, fist, "|", light="-", dark=")")
        dv = unit((Hd[0] - E_[0], Hd[1] - E_[1]))
        for k in (-1, 0, 1):
            cx_ = Hd[0] + dv[0] * 4 + dv[1] * k * 2
            cy_ = Hd[1] + 1 + dv[1] * 4 - dv[0] * k * 2
            g_.fill(ellipse_pts(cx_, cy_, 1.0, 1.0), "F" if not far else "H")
        pp = ellipse_pts(S_[0], S_[1] - 1, 8.0, 6.4)
        for side in (-3, 2):
            pp |= poly_pts([(S_[0] + side - 1.5, S_[1] - 5), (S_[0] + side - 1, S_[1] - 11), (S_[0] + side + 1.5, S_[1] - 5)])
        if far:
            shade_rim(g_, pp, "I", light="H", dark="S")
        else:
            plate(g_, pp)
            for (x, y) in pp:
                if (x, y + 1) not in pp:
                    g_.set(x, y, circ)
    mouth = goat_head(back, head, horns_far, glow, P)
    g = stack(W, H, tail, farA, farL, horns_far, back, torso, nearL, head, nearA)
    # effects
    kind = P["fx"]
    frng = random.Random(SEED + 600 + f)
    if kind == "fire":
        mx, my = mouth
        for x in range(int(mx) + 1, W):
            t = (x - mx) / (W - mx)
            half = 2 + t * 9
            cy_ = my - t * 3
            for y in range(int(cy_ - half) - 1, int(cy_ + half) + 2):
                d_ = abs(y + 0.5 - cy_) / half
                if d_ <= 1 - frng.random() * 0.25 * t:
                    ch_ = "W" if d_ < 0.25 and t < 0.5 else "y" if d_ < 0.45 else "Y" if d_ < 0.65 else "O" if d_ < 0.85 else "o"
                    if t > 0.85 and frng.random() < 0.4:
                        ch_ = "R"
                    g.set(x, y, ch_)
    elif kind == "roar":
        mx, my = mouth
        for r_ in (6, 10, 14):
            for k in range(-3, 4):
                a = math.radians(-60 + k * 12)
                x, y = int(round(mx + r_ * math.cos(a))), int(round(my + r_ * math.sin(a)))
                if g.get(x, y) == ".":
                    g.set(x, y, "W" if r_ == 6 else "p" if r_ == 10 else "R")
    elif kind == "stomp":
        for (cx_, side) in ((P["hn"][0], 1), (P["hf"][0], -1), (P["fn"][0], 1)):
            for k in range(4):
                x = int(cx_) + side * (5 + k * 3)
                y = 93 - k % 2
                for q in ellipse_pts(x, y - 1, 2.2 - k * 0.3, 1.8):
                    if g.get(*q) == ".":
                        g.set(q[0], q[1], "t" if k < 2 else "4")
    elif kind == "steam":
        for (sx, sy) in ((74, 18), (77, 14), (80, 10), (46, 26), (44, 21), (38, 24)):
            for q in ellipse_pts(sx, sy, 1.8, 1.5):
                if g.get(*q) == ".":
                    g.set(q[0], q[1], "s" if (q[0] + q[1]) % 3 else "t")
    elif kind == "sparks":
        for _ in range(9):
            x, y = frng.randint(48, 80), frng.randint(14, 50)
            if g.get(x, y) == ".":
                g.set(x, y, frng.choice(("Y", "W", "O")))
    if rage:  # enraged: neon seams turn red and the silhouette smoulders
        for y in range(H):
            for x in range(W):
                if g.get(x, y) == "." and any(g.get(x + dx, y + dy) not in (".", "(", "s", "t") for dx, dy in N4) \
                        and (x + y) % 2 == 0:
                    g.set(x, y, "(")
    for y in range(H):
        for x in range(W):
            if glow.get(x, y) != "." and g.get(x, y) == ".":
                g.set(x, y, glow.get(x, y))
    return align_bottom(g, 94)


def make_goat_final():
    sheet = Image.new("RGBA", (1344, 96), (0, 0, 0, 0))
    for f in range(14):
        sheet.paste(goat_frame(f).image(), (f * 96, 0))
    return sheet


# ============================================================ HERO LANDING ===
# Poses are authored facing LEFT (the heroes' native side view) and mirrored.
LAND_POSES = [
    dict(head=(0, 5), chest=(16, 27), pelvis=(17, 36), sn=(13, 28), hn=(4, 11), sf=(19, 28), hf=(28, 9),
         hipn=(15, 37), kn=(10, 39), fn=(14, 43), hipf=(18, 37), kf=(17, 40), ff=(22, 43)),        # falling
    dict(head=(-5, 11), chest=(12, 30), pelvis=(20, 37), sn=(11, 31), hn=(5, 42), sf=(17, 30), hf=(28, 24),
         hipn=(18, 38), kn=(11, 36), fn=(10, 43), hipf=(21, 38), kf=(22, 43), ff=(29, 43)),        # impact
    dict(head=(-4, 8), chest=(12, 29), pelvis=(20, 37), sn=(11, 30), hn=(5, 42), sf=(17, 29), hf=(28, 23),
         hipn=(18, 38), kn=(11, 36), fn=(10, 43), hipf=(21, 38), kf=(22, 43), ff=(29, 43)),        # head up
    dict(head=(-1, 5), chest=(15, 27), pelvis=(17, 37), sn=(14, 28), hn=(11, 36), sf=(18, 28), hf=(22, 35),
         hipn=(15, 38), kn=(11, 40), fn=(12, 43), hipf=(18, 38), kf=(21, 41), ff=(20, 43)),        # half-stand
]


def land_foot(g, F, style, flat=True):
    fx_, fy_ = int(F[0]), int(F[1])
    if style == "sudo":
        put_ascii(g, ["..sWWW.", "WWWGGWs", "ttttttt"], fx_ - 4, fy_ - 1)
    elif style == "tetsu":
        bp = {(x, y) for x in range(fx_ - 4, fx_ + 3) for y in range(fy_ - 2, fy_ + 2)}
        plate(g, bp, base="I", light="H", dark="S", hi="F")
        g.hline(fx_ - 4, fx_ + 2, fy_ + 1, "S")
        g.hline(fx_ - 2, fx_ + 2, fy_ - 2, "R")
    else:
        g.rect(fx_ - 4, fy_ - 2, fx_ + 2, fy_ + 1, ";")
        g.hline(fx_ - 4, fx_ + 2, fy_ + 1, "/")
        g.hline(fx_ - 1, fx_ + 2, fy_ - 2, "^")


def land_frame(hero, f):
    P = LAND_POSES[f]
    hdx, hdy = P["head"]
    farA, farL, torso, nearL, nearA, extra = (layer() for _ in range(6))
    ch, pv = P["chest"], P["pelvis"]
    # legs
    for g_, hip, K, F, far in ((farL, P["hipf"], P["kf"], P["ff"], True), (nearL, P["hipn"], P["kn"], P["fn"], False)):
        if hero == "tetsu":
            lp = capsule_pts(hip, K, 2.5, 2.3) | capsule_pts(K, (F[0], F[1] - 2), 2.3, 2.0)
            shade_rim(g_, lp, "I", light="H", dark="S") if far else plate(g_, lp)
            g_.rect(int(K[0]) - 1, int(K[1]) - 1, int(K[0]), int(K[1]), "S" if far else "E")
        elif hero == "sudo":
            lp = capsule_pts(hip, K, 1.7, 1.5) | capsule_pts(K, (F[0], F[1] - 1), 1.5, 1.4)
            shade_rim(g_, lp, "j" if far else "J", light=None if far else "J", dark="j")
        else:
            lp = capsule_pts(hip, K, 2.0, 1.8) | capsule_pts(K, (F[0], F[1] - 2), 1.8, 1.6)
            shade_rim(g_, lp, "/" if far else ":", light=":" if far else ";", dark="`")
            g_.set(int(K[0]), int(K[1]), "^" if not far else "~")
        land_foot(g_, F, hero)
        if far:
            g_.recolor({"W": "s", "s": "t", "G": "i", "H": "I", "F": "H", ";": ":"})
    # torso
    if hero == "tetsu":
        tp, d, n = torso_poly(ch, pv, 12, 10, 10)
        plate(torso, tp)
        mid = lerp(pv, ch, 0.15)
        seam_line(torso, (mid[0] - n[0] * 6, mid[1] - n[1] * 6), (mid[0] + n[0] * 6, mid[1] + n[1] * 6), "R")
        seam_line(torso, lerp(pv, ch, 0.7), lerp(pv, ch, 0.7), "R")
        # katana on the back: hilt above the shoulder blade
        hb = (ch[0] + 4, ch[1] - 3)
        draw_blade(extra, hb, math.radians(100 if f else 85), 14, hilt=4, edge_side=-1)
    elif hero == "sudo":
        tp, d, n = torso_poly(ch, pv, 12, 11, 12)
        torso.fill(tp, "0")
        shade_rim(torso, tp, "0", light="A", dark="9")
        seam_line(torso, lerp(pv, ch, 0.35), lerp(pv, ch, 0.75), "G", (-2, 0))
        hood = ellipse_pts(ch[0] + 4, ch[1] - 1, 3.4, 2.8)
        torso.fill(hood, "A")
        if f == 0:  # hoodie hem fluttering up
            for (x, y) in ((pv[0] - 5, pv[1] - 2), (pv[0] + 5, pv[1] - 3), (pv[0] + 6, pv[1] - 5)):
                torso.fill(ellipse_pts(x, y, 1.6, 2.2), "0")
    else:
        tp, d, n = torso_poly(ch, pv, 11, 9, 10)
        span = math.hypot(ch[0] - pv[0], ch[1] - pv[1])
        for (x, y) in tp:
            t = ((x + 0.5 - pv[0]) * d[0] + (y + 0.5 - pv[1]) * d[1]) / span
            torso.set(x, y, "/" if t > 0.55 else "+" if t > 0.32 else ":")
        shade_rim(torso, {p for p in tp if torso.get(*p) == "/"}, "/", light=";", dark="`")
        seam_line(torso, lerp(pv, ch, 0.6), lerp(pv, ch, 0.95), "^", (1, 0))
    # arms
    for g_, S_, Hd, far in ((farA, P["sf"], P["hf"], True), (nearA, P["sn"], P["hn"], False)):
        E_ = lerp(S_, Hd, 0.5)
        if hero == "tetsu":
            ap = capsule_pts(S_, Hd, 2.4, 2.1)
            shade_rim(g_, ap, "I", light="H", dark="S") if far else plate(g_, ap)
            fist = ellipse_pts(Hd[0], Hd[1], 2.0, 2.0)
            shade_rim(g_, fist, "I" if far else "H", light="I" if far else "F", dark="S")
            if not far:
                pp = ellipse_pts(S_[0], S_[1] - 1, 4.0, 3.2)
                plate(g_, pp)
                for (x, y) in pp:
                    if (x, y + 1) not in pp:
                        g_.set(x, y, "R")
        elif hero == "sudo":
            ap = capsule_pts(S_, Hd, 2.2, 1.9)
            shade_rim(g_, ap, "9" if far else "0", light="0" if far else "A", dark="9")
            g_.fill(ellipse_pts(Hd[0], Hd[1], 1.4, 1.4), "7" if far else "6")
        else:
            ap = capsule_pts(S_, Hd, 1.8, 1.6)
            shade_rim(g_, ap, "/", light=";" if not far else ":", dark="`")
            g_.fill(ellipse_pts(Hd[0], Hd[1], 1.5, 1.5), "=" if far else "+")
    if hero == "sudo" and f != 0:  # the cyberdeck lands with the far hand
        hx, hy = int(P["hf"][0]), int(P["hf"][1])
        farA.rect(hx - 2, hy - 1, hx + 2, hy + 1, "2")
        farA.set(hx, hy, "G")
    if hero == "sudo" and f == 0:
        hx, hy = int(P["hf"][0]), int(P["hf"][1])
        farA.rect(hx - 2, hy - 4, hx + 2, hy - 2, "2")
        farA.set(hx - 1, hy - 3, "G")
    # head
    if hero == "tetsu":
        guard, helm, visor = tetsu_helmet("side", 0)
        heads = [shifted(guard, hdx, hdy), shifted(helm, hdx, hdy), shifted(visor, hdx, hdy)]
        scarf = layer()
        nx, ny = 15 + hdx, 20 + hdy
        if f == 0:  # scarf whipping upward while falling
            sp = poly_pts([(nx + 2, ny), (nx + 6, ny - 6), (nx + 9, ny - 12), (nx + 11, ny - 11), (nx + 8, ny - 4),
                           (nx + 5, ny + 1)])
        else:
            sp = poly_pts([(nx + 2, ny - 1), (nx + 8, ny - 3), (nx + 14, ny - 2), (nx + 12, ny), (nx + 15, ny + 2),
                           (nx + 8, ny + 2), (nx + 3, ny + 2)])
        sp |= {(x, y) for x in range(nx - 3, nx + 4) for y in range(ny - 1, ny + 2)}
        shade_rim(scarf, sp, "R", light="p", dark="r")
        layers = [extra, farA, farL, torso, nearL, scarf] + heads + [nearA]
        g = stack(HW, HH, *layers)
    elif hero == "sudo":
        hair, face, gear = sudo_head("side", 0, f)
        if f == 0:  # hair blown upward
            hair.fill(poly_pts([(12, 4), (14, -1), (16, 4)]) | poly_pts([(17, 3), (20, -1), (21, 4)]), "X")
        heads = [shifted(hair, hdx, hdy), shifted(face, hdx, hdy), shifted(gear, hdx, hdy)]
        g = stack(HW, HH, farA, farL, torso, nearL, *heads, nearA)
    else:
        g = stack(HW, HH, farA, farL, torso, nearL, nearA)
    img_layers = []
    if hero == "paine":
        src = load_source("paine.png").crop((0, 48, 32, 70))  # hair + face, facing left
        img_layers.append((src, hdx, hdy))
    # eye glint once the head comes up
    glint = None
    if f == 2:
        glint = {"paine": (10, 12), "tetsu": (8, 11), "sudo": (9, 12)}[hero]
        glint = (glint[0] + hdx, glint[1] + hdy)
    # ground impact puffs
    if f == 1:
        for (cx, cy) in ((2.5, 43.0), (30.0, 43.5), (6.0, 44.0)):
            for (x, y) in ellipse_pts(cx, cy, 1.8, 1.3):
                if g.get(x, y) == ".":
                    g.set(x, y, "t" if y < 43 else "4")
    low = max(y for y in range(HH) for x in range(HW) if g.px[y][x] != ".")
    sh = 45 - low
    g = shifted(g, 0, sh)
    img_layers = [(src, dx, dy + sh) for (src, dx, dy) in img_layers]
    if glint:
        glint = (glint[0], glint[1] + sh)
    img = g.image()
    for (src, dx, dy) in img_layers:
        img.alpha_composite(src, (dx, dy))
    if glint:
        px = img.load()
        gx, gy = glint
        for (x, y, c) in ((gx, gy, "#ffffff"), (gx - 1, gy, "#b5fcff"), (gx + 1, gy, "#b5fcff"),
                          (gx, gy - 1, "#b5fcff"), (gx, gy + 1, "#b5fcff"), (gx - 2, gy, "#19f5ff"),
                          (gx, gy - 2, "#19f5ff")):
            if 0 <= x < 32 and 0 <= y < 48:
                px[x, y] = rgba(c)
    return img.transpose(Image.FLIP_LEFT_RIGHT)


def make_hero_landing():
    sheet = Image.new("RGBA", (128, 144), (0, 0, 0, 0))
    for r, hero in enumerate(("paine", "tetsu", "sudo")):
        for f in range(4):
            sheet.paste(land_frame(hero, f), (f * 32, r * 48))
    return sheet


# =============================================================== BILLBOARD ===
# Giant hologram ad (original character). Hologram palette only (cyan,
# magenta, pale pink, violet) on transparent; the game adds scanlines,
# flicker and additive blending, so there is no dark outline.
def bb_face_pts(cx, cy):
    pts = set()
    for y in range(int(cy - 20), int(cy + 21)):
        t = (y + 0.5 - cy)
        if t < 4:
            hw = 15.0 * math.sqrt(max(0.0, 1 - ((t - 4) / 22.0) ** 2))
        else:
            hw = 15.0 * (1 - ((t - 4) / 17.5) ** 1.7)
        for x in range(int(cx - hw) - 1, int(cx + hw) + 2):
            if abs(x + 0.5 - cx) <= hw:
                pts.add((x, y))
    return pts


def bb_eye(g, cx, cy, state):
    """state: open / closed / wink-closed (smiling arc)."""
    if state == "open":
        al = {(x, y) for (x, y) in ellipse_pts(cx, cy, 5.2, 3.2)}
        g.fill(al, "W")
        iris = ellipse_pts(cx + 0.5, cy + 0.3, 2.8, 2.9)
        g.fill({p for p in iris if p in al or p[1] < cy}, "M")
        g.fill({p for p in iris if (p[0] + p[1]) % 3 == 0 and p in al}, "m")
        g.fill(ellipse_pts(cx + 0.5, cy + 0.6, 1.2, 1.3), "n")
        g.set(int(cx) - 1, int(cy) - 1, "W")
        g.set(int(cx), int(cy) - 1, "W")
        for x in range(int(cx) - 6, int(cx) + 7):  # thick upper lash line with a flick
            yy = int(round(cy - 3.2 + ((x + 0.5 - cx) / 6.0) ** 2 * 1.6))
            g.set(x, yy, "n")
            g.set(x, yy - 1, "n" if abs(x + 0.5 - cx) < 5 else ".")
        g.set(int(cx) + 6, int(cy) - 3, "n")
        g.set(int(cx) + 7, int(cy) - 4, "n")
        g.hline(int(cx) - 4, int(cx) + 4, int(cy) + 3, "p")
    else:
        for x in range(int(cx) - 5, int(cx) + 6):
            yy = int(round(cy + 0.5 - (1 - ((x + 0.5 - cx) / 5.5) ** 2) * 2.2))
            g.set(x, yy, "n")
            g.set(x, yy + 1, "m")
        g.set(int(cx) + 6, int(cy) - 1, "n")
        g.set(int(cx) - 6, int(cy) + 1, "n")


def bb_hand(g, cx, cy, kind):
    """Small stylised hands: 'wave' (open palm, fingers up), 'lips' (fingertips
    pointing up-left) and 'palm' (big open palm toward the viewer)."""
    if kind == "palm":
        palm = ellipse_pts(cx, cy, 7.5, 7.0)
        for i, (dx, ln) in enumerate(((-6, 6), (-2.5, 9), (1.5, 9.5), (5.5, 8))):
            palm |= capsule_pts((cx + dx, cy - 4), (cx + dx * 1.15, cy - 4 - ln), 1.9, 1.6)
        palm |= capsule_pts((cx + 6, cy + 1), (cx + 12, cy - 4), 2.0, 1.7)
        shade_rim(g, palm, "N", light="W", dark="p")
        for x in range(int(cx) - 4, int(cx) + 5):
            g.set(x, int(cy) + 2, "p")
        return
    if kind == "wave":
        palm = ellipse_pts(cx, cy, 4.2, 4.6)
        for dx, ln in ((-3, 5), (-1, 6), (1.2, 6), (3.2, 5)):
            palm |= capsule_pts((cx + dx, cy - 2), (cx + dx * 1.2, cy - 2 - ln), 1.1, 1.0)
        palm |= capsule_pts((cx - 3, cy + 1), (cx - 7, cy - 2), 1.2, 1.0)
    else:  # fingertips to the lips
        palm = ellipse_pts(cx, cy, 4.0, 4.4)
        for dx, ln in ((-2, 6), (0, 7), (2, 6)):
            palm |= capsule_pts((cx + dx, cy - 2), (cx + dx - 3, cy - 2 - ln), 1.1, 1.0)
    shade_rim(g, palm, "N", light="W", dark="p")


def billboard_frame(f):
    W, H = 96, 128
    sway = (0, 2, 0, -1, 0, 1)[f]
    hx = 48 + sway
    body, arm_back, neck, hair_back, face, hair, arm_front, fxg = (Grid(W, H) for _ in range(8))
    # shoulders + futuristic high-collar jacket
    bp = poly_pts([(hx - 10, 66), (hx + 10, 66), (hx + 30, 76), (hx + 33, 88), (hx + 26, 128), (hx - 26, 128),
                   (hx - 33, 88), (hx - 30, 76)])
    shade_rim(body, bp, "v", light="V", dark="w")
    for (x, y) in bp:
        if abs(x + 0.5 - hx) < 2.5 and y > 74:
            body.set(x, y, "C" if y % 6 else "B")  # glowing zip seam
    for side in (-1, 1):  # collar flaps and shoulder seams
        body.fill(poly_pts([(hx + side * 3, 62), (hx + side * 13, 66), (hx + side * 11, 78), (hx + side * 3, 74)]), "V")
        body.line(hx + side * 13, 77, hx + side * 28, 80, "C")
        body.line(hx + side * 22, 90, hx + side * 20, 126, "M")
    for y in (100, 112):
        for x in range(hx - 22, hx + 23):
            if body.get(x, y) == "v":
                body.set(x, y, "w")
    neck.fill({(x, y) for x in range(hx - 6, hx + 7) for y in range(52, 70)}, "N")
    neck.fill({(x, y) for x in range(hx - 6, hx + 7) for y in range(52, 59)}, "p")
    neck.fill(poly_pts([(hx - 9, 62), (hx + 9, 62), (hx + 7, 68), (hx - 7, 68)]), "V")
    neck.hline(hx - 8, hx + 8, 62, "C")
    # hair (neon bob), face
    fcx, fcy = hx, 40
    hb = ellipse_pts(fcx, 37, 21.5, 23.0)
    hb = {(x, y) for (x, y) in hb if y <= 56}
    hair_back.fill(hb, "c")
    fp = bb_face_pts(fcx, fcy)
    shade_rim(face, fp, "N", light="W", dark="p")
    for (x, y) in fp:
        if x + 0.5 > fcx + 10 or y > fcy + 15:
            face.set(x, y, "p" if face.get(x, y) == "N" else face.get(x, y))
    eyes = {0: ("open", "open"), 1: ("open", "open"), 2: ("open", "open"), 3: ("open", "open"),
            4: ("closed", "closed"), 5: ("open", "closed")}[f]
    bb_eye(face, fcx - 8, fcy + 2, eyes[0])
    bb_eye(face, fcx + 8, fcy + 2, eyes[1])
    for side in (-1, 1):  # brows
        for k in range(7):
            x = fcx + side * (4 + k)
            face.set(x, fcy - 5 - (1 if 1 <= k <= 4 else 0) - (1 if f in (2, 5) and side == 1 else 0), "m")
    face.vline(fcx, fcy + 6, fcy + 9, "p")
    face.set(fcx - 1, fcy + 10, "p")
    face.set(fcx + 1, fcy + 10, "p")
    for side in (-1, 1):
        face.fill(ellipse_pts(fcx + side * 10, fcy + 9, 2.4, 1.2), "p")
    my = fcy + 14
    if f in (2, 5):   # open smile
        mouth = {(x, y) for x in range(fcx - 5, fcx + 6) for y in (my, my + 1, my + 2)
                 if abs(x - fcx) < 6 - (y - my) * 1.5}
        face.fill(mouth, "n")
        face.hline(fcx - 4, fcx + 4, my, "W")
        face.set(fcx - 6, my - 1, "M")
        face.set(fcx + 6, my - 1, "M")
    elif f == 4:      # puckered kiss
        face.fill(ellipse_pts(fcx + 0.5, my + 1, 2.4, 2.2), "M")
        face.set(fcx, my + 1, "n")
        face.set(fcx - 1, my, "N")
    else:             # soft smile
        face.hline(fcx - 4, fcx + 4, my, "M")
        face.hline(fcx - 3, fcx + 3, my + 1, "M")
        face.hline(fcx - 2, fcx + 2, my + 2, "N")
        face.set(fcx - 5, my - 1, "M")
        face.set(fcx + 5, my - 1, "M")
        face.hline(fcx - 3, fcx + 3, my, "m")
    # bob: blunt fringe + side panels, glossy band
    hp = {(x, y) for (x, y) in ellipse_pts(fcx, 37, 21.5, 23.0) if y < fcy - 8}
    for side in (-1, 1):
        hp |= poly_pts([(fcx + side * 21.5, 30), (fcx + side * 11, 30), (fcx + side * 13, 50), (fcx + side * 16, 57),
                        (fcx + side * 23, 56)])
    for x in range(fcx - 16, fcx + 17):  # fringe with a few sharp points
        for y in range(fcy - 12, fcy - 8 + (2 if (x - fcx) % 6 == 0 else 0)):
            hp.add((x, y))
    shade_rim(hair, hp, "C", light="B", dark="c")
    for (x, y) in hp:
        if 22 <= y <= 24 and hair.get(x, y) == "C":
            hair.set(x, y, "B")
        if (x - fcx) % 5 == 0 and y > 33 and abs(x - fcx) > 12 and hair.get(x, y) == "C":
            hair.set(x, y, "c")
        if 18 <= y <= 20 and (x - fcx) % 9 == 4 and hair.get(x, y) == "C":
            hair.set(x, y, "B")
    for side in (-1, 1):  # glowing earrings
        hair.fill(ellipse_pts(fcx + side * 17, 56, 1.4, 1.4), "M")
    # arms / gestures
    for side in (-1, 1):
        if (side == 1 and f in (2, 3, 4)):
            continue
        ap = capsule_pts((hx + side * 27, 80), (hx + side * 29, 128), 5.6, 5.2)
        shade_rim(arm_back, ap, "v", light="V", dark="w")
        arm_back.line(hx + side * 27, 84, hx + side * 29, 126, "C")
    if f == 2:   # small wave
        ap = capsule_pts((hx + 27, 80), (hx + 34, 100), 5.6, 5.0) | capsule_pts((hx + 34, 100), (hx + 36, 76), 4.8, 4.2)
        shade_rim(arm_front, ap, "v", light="V", dark="w")
        arm_front.hline(hx + 32, hx + 40, 80, "C")
        bb_hand(arm_front, hx + 37, 68, "wave")
        for (x, y) in ((hx + 44, 60), (hx + 45, 64), (hx + 44, 68)):
            fxg.set(x, y, "B")
    elif f == 3:  # fingertips to the lips
        ap = capsule_pts((hx + 27, 80), (hx + 20, 104), 5.6, 5.0) | capsule_pts((hx + 20, 104), (hx + 8, 64), 4.8, 4.2)
        shade_rim(arm_front, ap, "v", light="V", dark="w")
        arm_front.line(hx + 12, 68, hx + 18, 70, "C")
        bb_hand(arm_front, hx + 7, 60, "lips")
    elif f == 4:  # arm extended toward the viewer, kiss blown
        ap = capsule_pts((hx + 27, 80), (hx + 26, 100), 6.4, 7.4)
        shade_rim(arm_front, ap, "v", light="V", dark="w")
        arm_front.fill(ellipse_pts(hx + 26, 98, 7.0, 4.0), "C")
        bb_hand(arm_front, hx + 26, 92, "palm")
        for (x, y, c) in ((hx + 38, 74, "M"), (hx + 40, 72, "N"), (hx + 42, 70, "M"), (hx + 12, 76, "N")):
            fxg.set(x, y, c)
    g = Grid(W, H)
    for lay in (hair_back, body, arm_back, neck, face, hair, arm_front, fxg):
        g.blit(lay)
    return g


def make_billboard():
    sheet = Image.new("RGBA", (576, 128), (0, 0, 0, 0))
    for f in range(6):
        sheet.paste(billboard_frame(f).image(), (f * 96, 0))
    return sheet


def make_kiss():
    sheet = Image.new("RGBA", (32, 16), (0, 0, 0, 0))
    heart = Grid(16, 16)
    hp = heart_pts(8, 7.6, 5.0, 5.0)
    shade_rim(heart, hp, "M", light="N", dark="m")
    heart.set(5, 5, "W")
    heart.set(6, 5, "W")
    heart.set(5, 6, "N")
    for (x, y) in edge_pts(hp, N4):
        for dx, dy in N4:
            if heart.get(x + dx, y + dy) == ".":
                heart.set(x + dx, y + dy, "h")
    lips = Grid(16, 16)
    up = poly_pts([(1.5, 8), (4.5, 5.2), (8, 6.6), (11.5, 5.2), (14.5, 8), (8, 8.6)])
    lo = poly_pts([(1.5, 8.4), (8, 9.0), (14.5, 8.4), (11.5, 11.8), (4.5, 11.8)])
    shade_rim(lips, up, "R", light="p", dark="r")
    shade_rim(lips, lo, "M", light="N", dark="m")
    lips.hline(3, 12, 8, "n")
    lips.set(5, 10, "W")
    lips.set(6, 10, "N")
    for (x, y) in edge_pts(up | lo | {(x, 8) for x in range(3, 13)}, N4):
        for dx, dy in N4:
            if lips.get(x + dx, y + dy) == ".":
                lips.set(x + dx, y + dy, "h")
    for (x, y) in ((2, 3), (13, 2), (14, 13)):
        lips.set(x, y, "N")
    sheet.paste(heart.image(), (0, 0))
    sheet.paste(lips.image(), (16, 0))
    return sheet


# ================================================================== LEGEND ===
# An original bust: shoulder-length dark hair with a silver streak, short
# beard, black suit, a small cyan temple implant and a cyan rim light.
def legend_frame(f):
    W = H = 64
    suit, hair_back, neck, face, hair, hand = (Grid(W, H) for _ in range(6))
    sp_ = {(x, y) for (x, y) in ellipse_pts(32, 72, 31, 24) if y < 64}
    shade_rim(suit, sp_, "1", light="2", dark="P")
    for side in (-1, 1):  # lapels
        suit.fill(poly_pts([(32 + side * 4, 48), (32 + side * 12, 49), (32 + side * 7, 58), (32 + side * 1, 63)]), "2")
        suit.line(32 + side * 12, 49, 32 + side * 2, 63, "3")
    suit.fill(poly_pts([(28, 47), (36, 47), (33, 63), (31, 63)]), "P")
    neck.rect(27, 38, 37, 49, "7")
    neck.hline(27, 37, 38, "8")
    hb = ellipse_pts(32, 25, 14.0, 15.0) | poly_pts([(18, 26), (24, 26), (25, 47), (19, 48)]) | \
        poly_pts([(40, 26), (46, 26), (45, 48), (39, 47)])
    shade_rim(hair_back, hb, "1", light="2", dark="P")
    fp = {(x, y) for (x, y) in ellipse_pts(32, 28, 10.2, 13.0) if y >= 16}
    shade_rim(face, fp, "6", light="6", dark="7")
    for (x, y) in fp:
        if x >= 38:
            face.set(x, y, "7")
    beard = {(x, y) for (x, y) in fp if y >= 33 or (y >= 30 and abs(x + 0.5 - 32) > 7.5)}
    face.fill(beard, "1")
    for (x, y) in beard:
        if (x * 3 + y) % 5 == 0:
            face.set(x, y, "2")
    face.fill({(x, y) for x in range(29, 36) for y in (32, 33)}, "1")  # moustache
    eyes_closed = f == 3
    for ex in (26, 36):
        face.hline(ex - 2, ex + 2, 23, "1")    # straight brows
        face.hline(ex - 1, ex + 1, 22, "1")
        if eyes_closed:
            face.hline(ex - 2, ex + 2, 27, "8")
            face.set(ex - 2, 26, "8")
        else:
            face.hline(ex - 2, ex + 2, 26, "P")  # heavy lids: calm, half-closed
            face.hline(ex - 1, ex + 1, 27, "8")
            face.set(ex, 27, "K")
            face.set(ex + 1, 27, "W" if ex == 26 else "8")
    face.line(32, 26, 33, 30, "7")
    face.set(32, 31, "8")
    face.set(34, 31, "8")
    my = 35
    if f == 1:      # talking
        face.rect(30, my, 34, my + 1, "q")
        face.hline(30, 34, my, "8")
    elif f == 2:    # smirk
        face.hline(29, 33, my, "8")
        face.set(34, my - 1, "8")
        face.set(35, my - 1, "8")
    elif f == 4:    # pleased half smile while pointing
        face.hline(29, 34, my, "8")
        face.set(35, my - 1, "8")
        face.set(28, my - 1, "8")
    else:
        face.hline(29, 35, my, "8")
    # hair: center part, falls to the shoulders, silver streak, temple implant
    hp = {(x, y) for (x, y) in ellipse_pts(32, 24, 13.5, 14.5) if y < 20} | \
        poly_pts([(18.5, 16), (24, 17), (22.5, 30), (24, 46), (19, 47)]) | \
        poly_pts([(40, 17), (45.5, 16), (45, 47), (40, 46), (41.5, 30)])
    shade_rim(hair, hp, "1", light="3", dark="P")
    for (x, y) in hp:
        if (x - 32) % 4 == 2 and y > 14:
            hair.set(x, y, "P")
        elif y < 16 and math.hypot(x + 0.5 - 30, y + 0.5 - 18) > 9 and hair.get(x, y) == "1":
            hair.set(x, y, "2")
    hair.vline(32, 10, 19, "P")
    hair.line(31, 11, 26, 18, "P")
    hair.line(33, 11, 38, 18, "P")
    for (x, y) in ((24, 13), (23, 14), (23, 15), (22, 16), (22, 17), (21, 18), (21, 19), (21, 20)):
        hair.set(x, y, "5" if y % 2 else "4")
    face.vline(42, 21, 25, "C")
    face.set(41, 23, "c")
    if f == 4:  # finger guns at the lower right
        hp2 = capsule_pts((52, 63), (50, 52), 4.6, 4.2)
        shade_rim(hand, hp2, "1", light="2", dark="P")
        fist = ellipse_pts(50, 48, 3.6, 3.4)
        shade_rim(hand, fist, "6", light="6", dark="7")
        hand.fill(capsule_pts((50, 46), (43, 44), 1.2, 1.0), "6")
        hand.fill(capsule_pts((52, 46), (53, 40), 1.1, 1.0), "6")
        hand.set(44, 44, "7")
    g = stack(W, H, hair_back, suit, neck, face, hair, hand)
    # cyan rim light down the right-hand edge
    for y in range(H):
        xs = [x for x in range(W) if g.get(x, y) not in (".", "K")]
        if xs:
            xm = max(xs)
            g.set(xm, y, "C")
            if g.get(xm - 1, y) not in (".", "K"):
                g.set(xm - 1, y, "c")
    return g


def make_legend():
    sheet = Image.new("RGBA", (320, 64), (0, 0, 0, 0))
    for f in range(5):
        sheet.paste(legend_frame(f).image(), (f * 64, 0))
    return sheet


# ================================================================ HARDWARE ===
def hw_cell(i):
    g = Grid(64, 40)
    if i == 0:      # CPU
        g.rect(14, 3, 49, 36, "i")
        for k in range(15, 49, 2):
            for (x, y) in ((k, 3), (k, 36), (14, k - 12 if k - 12 <= 36 else 36), (49, k - 12 if k - 12 <= 36 else 36)):
                g.set(x, y, "Y")
        g.rect(19, 8, 44, 31, "F")
        shade_rim(g, {(x, y) for x in range(19, 45) for y in range(8, 32)}, "F", light="E", dark="H")
        g.rect(23, 12, 40, 27, "H")
        g.rect(24, 13, 39, 26, "F")
        g.fill(poly_pts([(28, 23), (31.5, 15), (35, 23)]), "C")
        g.fill(poly_pts([(30, 21), (31.5, 18), (33, 21)]), "F")
        g.hline(26, 37, 25, "c")
        g.set(16, 5, "Y")
        g.set(17, 5, "Y")
        g.set(16, 6, "Y")
    elif i == 1:    # RAM stick
        g.rect(3, 12, 60, 28, "i")
        g.hline(3, 60, 12, "G")
        for k in range(6):
            x0 = 6 + k * 9
            g.rect(x0, 15, x0 + 6, 23, "1")
            g.hline(x0, x0 + 6, 15, "2")
        for x in range(4, 60):
            if x not in (31, 32):
                g.set(x, 27, "Y" if x % 2 else "O")
                g.set(x, 28, "Y" if x % 2 else "O")
        g.rect(31, 26, 32, 28, ".")
        g.rect(3, 6, 60, 10, "2")
        for x in range(4, 60):
            t = (x - 4) / 56
            g.set(x, 8, "M" if t < 0.33 else "V" if t < 0.66 else "C")
            g.set(x, 7, "N" if t < 0.33 else "u" if t < 0.66 else "B")
    elif i == 2:    # GPU
        g.rect(1, 4, 2, 35, "F")
        for y in (9, 15, 21):
            g.rect(2, y, 2, y + 3, "K")
        g.rect(3, 6, 61, 31, "1")
        shade_rim(g, {(x, y) for x in range(3, 62) for y in range(6, 32)}, "1", light="2", dark="P")
        g.fill(poly_pts([(3, 6), (14, 6), (10, 12), (3, 12)]), "3")
        g.fill(poly_pts([(61, 6), (50, 6), (54, 12), (61, 12)]), "3")
        for x in range(4, 61):
            t = (x - 4) / 56
            g.set(x, 6, "M" if t < 0.3 else "V" if t < 0.6 else "C")
        for fcx in (20, 44):
            g.fill(ellipse_pts(fcx, 19, 10.2, 10.2), "P")
            for a in range(0, 360, 40):
                for r_ in range(3, 10):
                    ang = math.radians(a + r_ * 6)
                    g.set(int(round(fcx + r_ * math.cos(ang))), int(round(19 + r_ * math.sin(ang))), "3")
            g.fill(edge_pts(ellipse_pts(fcx, 19, 10.2, 10.2), N4), "2")
            g.fill(ellipse_pts(fcx, 19, 2.6, 2.6), "C")
            g.set(fcx - 1, 18, "B")
        g.rect(18, 32, 50, 34, "Y")
        for x in range(18, 51, 2):
            g.set(x, 34, "O")
    elif i == 3:    # M.2 SSD
        g.rect(4, 15, 59, 26, "i")
        g.rect(4, 15, 9, 26, "Y")
        g.rect(4, 19, 6, 21, ".")
        g.rect(13, 16, 45, 25, "2")
        g.hline(13, 45, 16, "3")
        g.rect(16, 18, 26, 23, "1")
        g.rect(29, 18, 39, 23, "1")
        g.hline(14, 44, 24, "M")
        g.rect(48, 18, 53, 23, "1")
        g.fill(ellipse_pts(59.5, 20.5, 2.5, 2.5), ".")
        g.set(56, 20, "Y")
    elif i == 4:    # network card with two antennas
        g.rect(8, 18, 10, 37, "F")
        g.rect(11, 20, 52, 33, "i")
        g.rect(24, 23, 34, 30, "1")
        g.rect(25, 24, 33, 29, "2")
        g.set(29, 26, "C")
        g.rect(18, 34, 46, 35, "Y")
        for ax, tilt in ((15, -4), (48, 4)):
            g.rect(ax - 1, 16, ax + 1, 19, "3")
            g.line(ax, 15, ax + tilt, 2, "2")
            g.line(ax + 1, 15, ax + tilt + 1, 2, "3")
            g.set(ax + tilt, 1, "C")
            g.set(ax + tilt + 1, 1, "B")
        for (x, y) in ((6, 4), (5, 6), (6, 8), (57, 4), (58, 6), (57, 8)):
            g.set(x, y, "C")
    elif i == 5:    # PSU
        bp = {(x, y) for x in range(4, 50) for y in range(5, 36)}
        shade_rim(g, bp, "2", light="3", dark="1")
        fan = ellipse_pts(23, 20.5, 12.2, 12.2)
        g.fill(fan, "1")
        for r_ in (3.5, 6.5, 9.5):
            g.fill(edge_pts(ellipse_pts(23, 20.5, r_, r_), N4), "3")
        g.hline(12, 34, 20, "3")
        g.vline(23, 9, 32, "3")
        g.fill(ellipse_pts(23, 20.5, 2, 2), "C")
        g.rect(38, 9, 46, 15, "1")
        g.rect(40, 11, 44, 13, "R")
        g.set(42, 18, "G")
        g.hline(5, 48, 34, "C")
        for k, (c, y0) in enumerate((("Y", 24), ("1", 27), ("R", 30))):
            for (x, y) in bezier((49, y0), (56, y0 + 2), (62, y0 - 4 + k * 3), 20):
                g.set(int(round(x)), int(round(y)), c)
    elif i == 6:    # tower cooler: fin stack, front fan with RGB ring, heat pipes
        for x0 in (22, 27, 32, 37):
            g.rect(x0, 1, x0 + 1, 7, "o")
            g.set(x0, 1, "O")
        for y in range(6, 37):
            g.hline(14, 49, y, "F" if y % 2 else "H")
        fan = ellipse_pts(31.5, 21.5, 13.0, 13.0)
        g.rect(17, 7, 46, 36, "1")
        g.fill(fan, "P")
        ring = edge_pts(fan, N4)
        for (x, y) in ring:
            a = math.atan2(y - 21.5, x - 31.5)
            g.set(x, y, "M" if a < -1 else "V" if a < 1 else "C")
        for a in range(0, 360, 45):
            for r_ in range(3, 12):
                ang = math.radians(a + r_ * 5)
                g.set(int(round(31.5 + r_ * math.cos(ang))), int(round(21.5 + r_ * math.sin(ang))), "3")
        g.fill(ellipse_pts(31.5, 21.5, 2.8, 2.8), "2")
        g.set(31, 21, "C")
    else:           # cyberware neural chip
        bp = {(x, y) for x in range(14, 50) for y in range(10, 32)}
        shade_rim(g, bp, "w", light="v", dark="P")
        for x in range(16, 49, 3):
            g.set(x, 31, "Y")
            g.set(x, 10, "Y")
        for (a, b) in (((32, 21), (17, 14)), ((32, 21), (17, 28)), ((32, 21), (47, 14)), ((32, 21), (47, 28)),
                       ((32, 21), (32, 11)), ((32, 21), (32, 30))):
            g.line(*a, *b, "C")
        for (x, y) in ((17, 14), (17, 28), (47, 14), (47, 28)):
            g.fill(ellipse_pts(x + 0.5, y + 0.5, 1.4, 1.4), "B")
        hexc = poly_pts([(32 + 8 * math.cos(math.radians(-90 + 60 * k)), 21 + 8 * math.sin(math.radians(-90 + 60 * k)))
                         for k in range(6)])
        shade_rim(g, hexc, "m", light="M", dark="n")
        g.fill(ellipse_pts(32, 21, 3.6, 3.6), "M")
        g.fill(ellipse_pts(32, 21, 2.2, 2.2), "N")
        g.set(31, 20, "W")
        g.set(32, 20, "W")
    g.outline()
    if i == 7:
        for (x, y) in ellipse_pts(32, 21, 12, 12):
            if g.get(x, y) == ".":
                g.set(x, y, "h")
    return g


def make_hardware():
    sheet = Image.new("RGBA", (512, 40), (0, 0, 0, 0))
    for i in range(8):
        sheet.paste(hw_cell(i).image(), (i * 64, 0))
    return sheet


# ================================================================= PREVIEW ===
RESKIN_SOURCES = {"reaper-cyber.png": ("death.png", 50), "dragon-cyber.png": ("dragon.png", 96),
                  "goat-cyber.png": ("redgoat.png", 80)}


def make_preview(sheets, path):
    S = 4
    GAP = 8
    bg = rgba("#140a24")
    try:
        font = ImageFont.load_default(size=16)
    except TypeError:
        font = ImageFont.load_default()

    def tile(im, nx, ny=1):
        out = Image.new("RGBA", (im.width * nx, im.height * ny), (0, 0, 0, 0))
        for j in range(ny):
            for i in range(nx):
                out.alpha_composite(im, (i * im.width, j * im.height))
        return out

    def side_by_side(*ims):
        out = Image.new("RGBA", (sum(i.width for i in ims) + GAP * (len(ims) - 1), max(i.height for i in ims)),
                        (0, 0, 0, 0))
        x = 0
        for i in ims:
            out.alpha_composite(i, (x, 0))
            x += i.width + GAP
        return out

    items = []  # (label, image, [(x offset, width, frame width)], row labels)
    hero_rows = ["row 0: walk down", "row 1: walk left", "row 2: walk right", "row 3: walk up",
                 "row 4: attack left", "row 5: attack right"]
    for name, im, frame_w in sheets:
        if name in ("tetsu.png", "sudo.png"):
            items.append((f"{name}  {im.width}x{im.height}", im, [(0, im.width, 32)], hero_rows))
            continue
        if name == "hero-landing.png":
            items.append((f"{name}  {im.width}x{im.height}  (f0 fall, f1 impact, f2 head up + glint, f3 rise)", im,
                          [(0, im.width, 32)], ["row 0: Paine", "row 1: Tetsu", "row 2: Sudo"]))
            continue
        if name == "paine-attack.png":
            src = load_source("paine.png").crop((0, 48, 128, 144))
            items.append((f"paine.png rows 1-2 (walk left/right, left)  vs  {name}  {im.width}x{im.height} (right)",
                          side_by_side(src, im), [(0, 128, 32), (128 + GAP, 128, 32)],
                          ["row 0: fire left", "row 1: fire right"]))
            continue
        if name in RESKIN_SOURCES:
            src_name, fw = RESKIN_SOURCES[name]
            src = load_source(src_name)
            items.append((f"{src_name} (source, left)  ->  {name}  {im.width}x{im.height}  "
                          f"max bbox delta {RESKIN_DELTA.get(name, '?')}px",
                          side_by_side(src, im), [(0, src.width, fw), (src.width + GAP, im.width, fw)], None))
            continue
        items.append((f"{name}  {im.width}x{im.height}", im, [(0, im.width, frame_w)] if frame_w else [], None))
        if name == "platform.png":
            row = Image.new("RGBA", (320, 16), (0, 0, 0, 0))
            row.alpha_composite(im.crop((0, 0, 32, 16)), (0, 0))
            for i in range(1, 9):
                row.alpha_composite(im.crop((32, 0, 64, 16)), (i * 32, 0))
            row.alpha_composite(im.crop((64, 0, 96, 16)), (288, 0))
            items.append(("platform.png tiled: cap + 8 middles + cap", row, [], None))
        if name in ("skyline.png", "ground.png", "city-mid.png"):
            items.append((f"{name} x2 side by side (seam check)", tile(im, 2), [], None))
        if name == "facade.png":
            items.append(("facade.png tile 0 and tile 1, each tiled 3x3 (seam check)",
                          side_by_side(tile(im.crop((0, 0, 64, 64)), 3, 3), tile(im.crop((64, 0, 128, 64)), 3, 3)),
                          [], None))
    pad = 16
    width = max(im.width * S + (260 if rl else 0) for _, im, _, rl in items) + pad * 2
    height = pad + sum(24 + im.height * S + pad for _, im, _, _ in items)
    out = Image.new("RGBA", (width, height), bg)
    d = ImageDraw.Draw(out)
    y = pad
    for label, im, frames, row_labels in items:
        d.text((pad, y), label, fill=(220, 210, 255, 255), font=font)
        y += 24
        for i, rl in enumerate(row_labels or []):
            d.text((pad + im.width * S + 16, y + i * 48 * S + 48 * S // 2 - 8), rl, fill=(255, 225, 77, 255), font=font)
        big = im.resize((im.width * S, im.height * S), Image.NEAREST)
        for (ox, w, fw) in frames:
            for fx in range(0, w, fw):
                x0 = pad + (ox + fx) * S
                d.rectangle([x0, y, x0 + fw * S - 1, y + im.height * S - 1], outline=(46, 30, 72, 255))
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
        # cyber re-skins of existing enemies + dense city art
        ("reaper-cyber.png", make_reaper_cyber(), 50),
        ("dragon-cyber.png", make_dragon_cyber(), 96),
        ("goat-cyber.png", make_goat_cyber(), 80),
        ("aerodyne.png", make_aerodyne(), 64),
        ("city-mid.png", make_city_mid(), None),
        ("facade.png", make_facade(), 64),
        # heroes, new enemies, second boss, fx
        ("tetsu.png", make_tetsu(), 32),
        ("sudo.png", make_sudo(), 32),
        ("paine-attack.png", make_paine_attack(), 32),
        ("portraits.png", make_portraits(), 48),
        ("ninja.png", make_ninja(), 40),
        ("enforcer.png", make_enforcer(), 56),
        ("bomber.png", make_bomber(), 32),
        ("sniper.png", make_sniper(), 40),
        ("overseer.png", make_overseer(), 96),
        ("fx.png", make_fx(), 32),
        # landing poses, billboard, legend, level-up hardware, final bosses
        ("hero-landing.png", make_hero_landing(), 32),
        ("billboard.png", make_billboard(), 96),
        ("kiss.png", make_kiss(), 16),
        ("legend.png", make_legend(), 64),
        ("hardware.png", make_hardware(), 64),
        ("overseer-avatar.png", make_overseer_avatar(), 64),
        ("goat-final.png", make_goat_final(), 96),
    ]


EXPECTED = {
    "drone.png": (128, 32), "crawler.png": (160, 28), "pickups.png": (128, 16),
    "icons.png": (288, 24), "projectiles.png": (64, 16), "platform.png": (96, 16),
    "crate.png": (64, 32), "skyline.png": (480, 200), "ground.png": (64, 48),
    "hologram.png": (96, 96), "dove.png": (64, 16), "secrets.png": (192, 24),
    "terminal.png": (48, 40), "moon.png": (64, 64), "katana.png": (40, 12),
    "ripperdoc.png": (64, 72), "reaper-cyber.png": (200, 192), "dragon-cyber.png": (384, 384),
    "goat-cyber.png": (320, 320), "aerodyne.png": (128, 24), "city-mid.png": (640, 420),
    "facade.png": (128, 64), "tetsu.png": (128, 288), "sudo.png": (128, 288), "paine-attack.png": (128, 96),
    "portraits.png": (144, 48), "ninja.png": (160, 48), "enforcer.png": (224, 56), "bomber.png": (128, 32),
    "sniper.png": (160, 40), "overseer.png": (384, 96), "fx.png": (256, 32),
    "hero-landing.png": (128, 144), "billboard.png": (576, 128), "kiss.png": (32, 16), "legend.png": (320, 64),
    "hardware.png": (512, 40), "overseer-avatar.png": (896, 96), "goat-final.png": (1344, 96),
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
        extra = f"  (max per-frame bbox delta {RESKIN_DELTA[name]}px)" if name in RESKIN_DELTA else ""
        print(f"wrote {name:16s} {im.width}x{im.height}{extra}")
    if args.preview:
        make_preview(sheets, args.preview)
        print("wrote preview", args.preview)


if __name__ == "__main__":
    main()
