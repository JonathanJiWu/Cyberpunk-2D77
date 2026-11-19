#!/usr/bin/env python3
"""
Individual Contributor art for Cyberpunk 2D77 (v3.2): Paine (Cyber Widow),
Tetsu (Chrome Ronin) and Sudo (Hackerman).

Each hero is a small 3D model made of signed-distance shapes (ellipsoids,
round cones, rounded boxes, blended where flesh or cloth should flow) hung on
a posable skeleton. A frame is ray-marched at 3-4x, cel-shaded with one fixed
top-left key light, a rim light in the IC's colour and a little ambient
occlusion, then turned into pixel art: majority-vote downsampling, cleanup of
lone pixels, hand-placed face details and a 1px selective dark outline.
One model for every pose keeps proportions consistent between frames, and
the light stays top-left when a hero turns around (the left-facing rows are
rendered, not mirrored).

Deterministic (no randomness, integer hashes only): re-running writes
byte-identical PNGs. Needs Pillow and numpy.

Usage:
    python3 tools/art_ics.py                    # writes the PNGs into img/
    python3 tools/art_ics.py --only busts       # some of them (busts, sheets, landing, portraits)
    python3 tools/art_ics.py --preview DIR      # also writes enlarged previews to DIR

Writes:
    bust-paine.png, bust-tetsu.png, bust-sudo.png
                      192x240  select-screen busts, 3/4 view, rim-lit in the IC colour
    widow3.png        480x720  PAINE  6 rows x 6 frames of 80x120
    tetsu3.png        480x720  TETSU
    hackerman3.png    480x720  SUDO
        rows: 0 front, 1 facing left, 2 facing right, 3 back (frame 0 looks up),
              4 attack facing left, 5 attack facing right
        cols: 0-3 run cycle (contact, passing, contact, passing), 4 idle, 5 airborne;
              attack rows: 0-3 (Paine: draw, full draw, release, recover)
        soles on y=113, outline on y=114 (drawn at -40, -115 like the old 32x48 x2.5)
    hero-landing3.png 320x360  rows Paine / Tetsu / Sudo x 4 frames of 80x120:
                               leap, impact, hold, rise (facing right)
    portraits3.png    192x64   Paine, Tetsu, Sudo HUD portraits of 64x64
"""

import argparse
import math
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "img")


# =============================================================== vectors ====
def unit(v):
    v = np.asarray(v, dtype=np.float64)
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-12 else v


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)


def lerp(a, b, t):
    return np.asarray(a, float) * (1 - t) + np.asarray(b, float) * t


def basis_from(axis, up=(0, 1, 0)):
    """Rotation whose local x points along `axis` (y as close to `up` as possible)."""
    x = unit(axis)
    u = np.asarray(up, float)
    if abs(float(np.dot(x, unit(u)))) > 0.98:
        u = np.array([0.0, 0.0, 1.0])
    z = unit(np.cross(x, u))
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


class Frame:
    """Local -> world transform: p_world = R @ (p * s) + T."""

    def __init__(self, R=None, T=(0, 0, 0), s=1.0):
        self.R = np.eye(3) if R is None else np.asarray(R, dtype=np.float64)
        self.T = np.asarray(T, dtype=np.float64)
        self.s = float(s)

    def p(self, v):
        return self.R @ (np.asarray(v, dtype=np.float64) * self.s) + self.T

    def d(self, v):
        return self.R @ np.asarray(v, dtype=np.float64)

    def sub(self, R=None, T=(0, 0, 0), s=1.0):
        R = np.eye(3) if R is None else np.asarray(R, dtype=np.float64)
        return Frame(self.R @ R, self.p(T), self.s * s)


def ihash(i):
    """Deterministic integer hash -> [0, 1)."""
    i = np.asarray(i, dtype=np.int64) & 0xFFFFFFFF
    i = (i ^ (i >> 16)) * 0x45D9F3B & 0xFFFFFFFF
    i = (i ^ (i >> 16)) * 0x45D9F3B & 0xFFFFFFFF
    i = i ^ (i >> 16)
    return (i & 0xFFFF) / 65536.0


# ===================================================== distance functions ===
def sd_ell(P, c, r, A):
    q = (P - c) @ A
    q0 = q / r
    q1 = q / (r * r)
    k0 = np.sqrt((q0 * q0).sum(1))
    k1 = np.sqrt((q1 * q1).sum(1))
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sd_cone(P, a, b, r1, r2):
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = P - a
    y = pa @ ba
    z = y - l2
    w = pa * l2 - np.outer(y, ba)
    x2 = (w * w).sum(1)
    y2 = y * y * l2
    z2 = z * z * l2
    k = math.copysign(1.0, rr) * rr * rr * x2 if rr != 0 else np.zeros_like(x2)
    d1 = np.sqrt(x2 + z2) * il2 - r2
    d2 = np.sqrt(x2 + y2) * il2 - r1
    d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))


def sd_box(P, c, half, A, rr):
    q = np.abs((P - c) @ A) - (half - rr)
    o = np.maximum(q, 0)
    return np.sqrt((o * o).sum(1)) + np.minimum(q.max(1), 0) - rr


def sd_plane(P, p0, n):
    return (P - p0) @ n


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


# ============================================================== palette =====
PAL = {}
PAL_LIST = []


def pal(h):
    h = h.lower()
    if h not in PAL:
        PAL[h] = len(PAL_LIST)
        PAL_LIST.append((int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)))
    return PAL[h]


# Lights, in world space (x right, y up, z toward the viewer)
KEY = unit((-0.5, 0.66, 0.6))  # top-left key
RIMD = unit((0.95, 0.12, -0.3))  # the IC-coloured rim, from the right and behind
VIEW = np.array([0.0, 0.0, 1.0])
HALF = unit(KEY + VIEW)

MATS = [None]


class Mat:
    """A material: a dark-to-light ramp plus how light lands on it.

    kind: diffuse | leather (diffuse + a sharp sheen) | chrome (reflects a
    sky / horizon / street environment) | hair (strand highlights) | flat
    (emissive, unlit)."""

    def __init__(self, ramp, kind="diffuse", th=None, rim=None, outline=None, line=None, sheen=0.0, gloss=30,
                 ao=0.55, wrap=0.35, lineable=True, hi=None, bounce=None):
        self.ramp = np.array([pal(c) for c in ramp], dtype=np.int16)
        self.kind = kind
        n = len(ramp)
        if th is None:
            th = {1: [], 2: [0.45], 3: [0.3, 0.62], 4: [0.2, 0.45, 0.74], 5: [0.14, 0.36, 0.62, 0.86],
                  6: [0.12, 0.3, 0.5, 0.7, 0.88], 7: [0.1, 0.24, 0.4, 0.56, 0.72, 0.88]}[n]
        self.th = np.array(th, dtype=np.float64)
        self.rim = np.array([pal(c) for c in rim], dtype=np.int16) if rim else None
        self.outline = pal(outline) if outline else int(self.ramp[0])
        self.line = pal(line) if line else int(self.ramp[0])
        self.sheen = sheen
        self.gloss = gloss
        self.ao = ao
        self.wrap = wrap
        self.lineable = lineable
        self.hi = pal(hi) if hi else None
        self.bounce = pal(bounce) if bounce else None
        MATS.append(self)
        self.id = len(MATS) - 1


def shade(m, N, AO, T, S):
    """Palette index for each lit point of material m."""
    if m.kind == "flat":
        return np.full(len(N), m.ramp[-1], dtype=np.int16)
    nl = N @ KEY
    v = np.clip((nl + m.wrap) / (1 + m.wrap), 0, 1)
    v = v * (1 - m.ao * AO)
    if m.kind == "chrome":
        # reflect the view ray: bright sky, a dark horizon band, a dim street
        ry = 2 * N[:, 2] * N[:, 1]
        rx = 2 * N[:, 2] * N[:, 0]
        env = np.where(ry > 0.5, 1.0, np.where(ry > 0.18, 0.78, np.where(ry > -0.1, 0.14, 0.5 - 0.15 * np.clip(-ry, 0, 1))))
        env = env - 0.12 * np.clip(rx, 0, 1)
        v = np.clip(0.62 * env + 0.38 * v, 0, 1) * (1 - 0.5 * m.ao * AO)
    if m.kind == "hair" and S is not None:
        strand = ihash(np.floor(S).astype(np.int64))
        v = np.clip(v + (strand - 0.5) * 0.16, 0, 1)
    idx = np.searchsorted(m.th, v)
    out = m.ramp[np.clip(idx, 0, len(m.ramp) - 1)].copy()
    if m.kind == "hair" and T is not None:
        th_ = T @ HALF
        kk = np.sqrt(np.clip(1 - th_ * th_, 0, 1)) ** m.gloss
        strand = ihash(np.floor(S).astype(np.int64) * 7 + 3) if S is not None else 0.5
        lit = nl > -0.1
        spec = kk * (0.45 + 0.9 * strand) * lit
        if m.hi is not None:
            out[spec > m.sheen] = m.hi
    elif m.sheen > 0:
        s = np.clip(N @ HALF, 0, 1) ** m.gloss
        hi = m.hi if m.hi is not None else m.ramp[-1]
        out[s > m.sheen] = hi
    if m.bounce is not None:
        # a cool neon bounce from the street on surfaces facing down-left
        b = (N[:, 1] < -0.35) & (N[:, 0] < 0.2) & (v < 0.45)
        out[b] = m.bounce
    if m.rim is not None:
        r = N @ RIMD
        out[r > 0.74] = m.rim[0]
        if len(m.rim) > 1:
            out[r > 0.9] = m.rim[1]
    return out


# ============================================================== shapes ======
class Prim:
    __slots__ = ("kind", "args", "mat", "k", "sub", "bc", "br", "tan", "sfn", "tag")

    def __init__(self, kind, args, mat, k, sub, bc, br, tan=None, sfn=None, tag=None):
        self.kind, self.args, self.mat, self.k, self.sub = kind, args, mat, k, sub
        self.bc, self.br, self.tan, self.sfn, self.tag = bc, br, tan, sfn, tag

    def dist(self, P):
        if self.kind == "ell":
            return sd_ell(P, *self.args)
        if self.kind == "cone":
            return sd_cone(P, *self.args)
        if self.kind == "box":
            return sd_box(P, *self.args)
        return sd_plane(P, *self.args)


class Part:
    """Shapes blended into one surface; parts meet with a crease (and maybe a line)."""

    def __init__(self, group, paint=None, line=True):
        self.prims = []
        self.group = group
        self.paint = paint
        self.line = line

    def _add(self, kind, args, mat, k, sub, bc, br, tan=None, sfn=None, tag=None):
        self.prims.append(Prim(kind, args, mat, k, sub, np.asarray(bc, float), float(br), tan, sfn, tag))
        return self

    def ell(self, F, c, r, mat, R=None, k=0.0, sub=False, tan=None, sfn=None, tag=None):
        R = np.eye(3) if R is None else np.asarray(R, float)
        rw = np.asarray(r, float) * F.s
        return self._add("ell", (F.p(c), rw, F.R @ R), mat, k, sub, F.p(c), float(rw.max()), tan, sfn, tag)

    def cone(self, F, a, b, r1, r2, mat, k=0.0, sub=False, tan=None, sfn=None, tag=None):
        A, B = F.p(a), F.p(b)
        r1w, r2w = r1 * F.s, r2 * F.s
        L = float(np.linalg.norm(B - A))
        if L <= abs(r1w - r2w) + 1e-3:  # degenerate: just a ball
            return self.ell(F, a, (max(r1, r2),) * 3, mat, k=k, sub=sub, tan=tan, sfn=sfn, tag=tag)
        return self._add("cone", (A, B, r1w, r2w), mat, k, sub, (A + B) / 2, L / 2 + max(r1w, r2w), tan, sfn, tag)

    def box(self, F, c, half, mat, R=None, rr=0.5, k=0.0, sub=False, tag=None):
        R = np.eye(3) if R is None else np.asarray(R, float)
        hw = np.asarray(half, float) * F.s
        return self._add("box", (F.p(c), hw, F.R @ R, rr * F.s), mat, k, sub, F.p(c), float(np.linalg.norm(hw)), tag=tag)

    def plane(self, F, p0, n, k=0.0):
        """Cut away everything on the +n side of the plane."""
        return self._add("plane", (F.p(p0), unit(F.d(n))), None, k, True, F.p(p0), 0.0)

    def sdf(self, P, want_mat=False):
        d = None
        best = None
        mat = None
        for pr in self.prims:
            di = pr.dist(P)
            if pr.sub:
                d = smax(d, di if pr.kind == "plane" else -di, pr.k) if d is not None else di
                continue
            if want_mat:
                if best is None:
                    best, mat = di.copy(), np.full(len(P), -1, np.int32)
                    mat[:] = self.prims.index(pr)
                else:
                    closer = di < best
                    best[closer] = di[closer]
                    mat[closer] = self.prims.index(pr)
            d = di if d is None else smin(d, di, pr.k)
        return (d, mat) if want_mat else d

    def bounds(self):
        bs = [(pr.bc, pr.br) for pr in self.prims if not pr.sub]
        lo = np.min([c - r for c, r in bs], axis=0)
        hi = np.max([c + r for c, r in bs], axis=0)
        return lo, hi


class Model:
    def __init__(self):
        self.parts = []
        self.feats = []  # 2D details drawn after the reduction: (kind, ...)

    def part(self, group, paint=None, line=True):
        p = Part(group, paint, line)
        self.parts.append(p)
        return p


# ============================================================= renderer =====
class Render:
    """Ray-march a Model into supersampled buffers, shade, reduce to pixels."""

    def __init__(self, w, h, ss, ox, oy):
        self.w, self.h, self.ss, self.ox, self.oy = w, h, ss, ox, oy
        H, W = h * ss, w * ss
        self.Z = np.full((H, W), -1e9, np.float64)
        self.M = np.zeros((H, W), np.int16)
        self.G = np.zeros((H, W), np.int16)
        self.N = np.zeros((H, W, 3), np.float64)
        self.T = np.zeros((H, W, 3), np.float64)
        self.S = np.zeros((H, W), np.float64)
        self.hasT = np.zeros((H, W), bool)

    def trace_part(self, part):
        ss = self.ss
        lo, hi = part.bounds()
        j0 = max(0, int(math.floor((lo[0] + self.ox) * ss)))
        j1 = min(self.w * ss, int(math.ceil((hi[0] + self.ox) * ss)) + 1)
        i0 = max(0, int(math.floor((self.oy - hi[1]) * ss)))
        i1 = min(self.h * ss, int(math.ceil((self.oy - lo[1]) * ss)) + 1)
        if j1 <= j0 or i1 <= i0:
            return
        jj, ii = np.meshgrid(np.arange(j0, j1), np.arange(i0, i1))
        jj, ii = jj.ravel(), ii.ravel()
        xs = (jj + 0.5) / ss - self.ox
        ys = self.oy - (ii + 0.5) / ss
        # only rays that pass near some shape
        near = np.zeros(len(xs), bool)
        for pr in part.prims:
            if pr.sub:
                continue
            near |= (xs - pr.bc[0]) ** 2 + (ys - pr.bc[1]) ** 2 <= (pr.br + 0.5) ** 2
        xs, ys, jj, ii = xs[near], ys[near], jj[near], ii[near]
        if not len(xs):
            return
        z = np.full(len(xs), hi[2] + 1.0)
        zmin = lo[2] - 1.0
        alive = np.ones(len(xs), bool)
        hit = np.zeros(len(xs), bool)
        eps = 0.25 / ss
        for _ in range(96):
            idx = np.nonzero(alive)[0]
            if not len(idx):
                break
            P = np.stack([xs[idx], ys[idx], z[idx]], 1)
            d = part.sdf(P)
            h = d < eps
            hit[idx[h]] = True
            alive[idx[h]] = False
            step = np.maximum(d[~h] * 0.85, eps * 0.5)
            z[idx[~h]] -= step
            gone = idx[~h][z[idx[~h]] < zmin]
            alive[gone] = False
        if not hit.any():
            return
        xs, ys, z, jj, ii = xs[hit], ys[hit], z[hit], jj[hit], ii[hit]
        front = z > self.Z[ii, jj]
        if not front.any():
            return
        xs, ys, z, jj, ii = xs[front], ys[front], z[front], jj[front], ii[front]
        P = np.stack([xs, ys, z], 1)
        e = 0.08
        n = np.stack([
            part.sdf(P + [e, 0, 0]) - part.sdf(P - [e, 0, 0]),
            part.sdf(P + [0, e, 0]) - part.sdf(P - [0, e, 0]),
            part.sdf(P + [0, 0, e]) - part.sdf(P - [0, 0, e]),
        ], 1)
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        _, which = part.sdf(P, want_mat=True)
        mats = np.array([pr.mat.id if pr.mat is not None else 0 for pr in part.prims], np.int16)[which]
        if part.paint is not None:
            mats = part.paint(P, n, mats)
        self.Z[ii, jj] = z
        self.M[ii, jj] = mats
        self.G[ii, jj] = part.group
        self.N[ii, jj] = n
        self.hasT[ii, jj] = False
        for k, pr in enumerate(part.prims):
            if pr.tan is None:
                continue
            sel = which == k
            if not sel.any():
                continue
            t = pr.tan(P[sel]) if callable(pr.tan) else np.broadcast_to(np.asarray(pr.tan, float), (sel.sum(), 3))
            nn = n[sel]
            t = t - (t * nn).sum(1, keepdims=True) * nn
            t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
            self.T[ii[sel], jj[sel]] = t
            self.S[ii[sel], jj[sel]] = pr.sfn(P[sel]) if pr.sfn is not None else 0
            self.hasT[ii[sel], jj[sel]] = True

    def render(self, model):
        for part in model.parts:
            self.trace_part(part)

    def ao(self, radius):
        """Crevice darkness from the depth buffer: neighbours in front -> darker."""
        cov = (self.M > 0).astype(np.float64)
        zc = np.where(cov > 0, self.Z, 0.0)
        r = max(1, int(radius))

        def box(a):
            c = np.cumsum(np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r))), 0), 1)
            return c[2 * r + 1:, 2 * r + 1:] - c[:-2 * r - 1, 2 * r + 1:] - c[2 * r + 1:, :-2 * r - 1] + c[:-2 * r - 1, :-2 * r - 1]

        s = box(cov)
        mean = box(zc) / np.maximum(s, 1)
        return np.clip((mean - self.Z) / (radius / self.ss * 1.6), 0, 1) * (cov > 0)

    def smooth_normals(self, radius):
        """Blur normals within each group: blended shapes read as one surface."""
        r = max(1, int(radius))

        def box(a):
            c = np.cumsum(np.cumsum(np.pad(a, ((r + 1, r), (r + 1, r))), 0), 1)
            return c[2 * r + 1:, 2 * r + 1:] - c[:-2 * r - 1, 2 * r + 1:] - c[2 * r + 1:, :-2 * r - 1] + c[:-2 * r - 1, :-2 * r - 1]

        out = self.N.copy()
        for g in np.unique(self.G[self.M > 0]):
            mask = ((self.G == g) & (self.M > 0)).astype(np.float64)
            w = box(mask)
            for c in range(3):
                out[..., c] = np.where(mask > 0, box(self.N[..., c] * mask) / np.maximum(w, 1e-9), out[..., c])
        out /= np.maximum(np.linalg.norm(out, axis=2, keepdims=True), 1e-9)
        self.N = out

    def shade(self, ao_radius=None, smooth=0):
        if smooth:
            self.smooth_normals(smooth)
        ao = self.ao(ao_radius or 3 * self.ss)
        C = np.full(self.M.shape, -1, np.int16)
        for mid in np.unique(self.M):
            if mid == 0:
                continue
            m = MATS[mid]
            sel = self.M == mid
            T = self.T[sel] if m.kind == "hair" else None
            S = self.S[sel] if m.kind == "hair" else None
            if T is not None:
                miss = ~self.hasT[sel]
                T = T.copy()
                T[miss] = (0, -1, 0)
            C[sel] = shade(m, self.N[sel], ao[sel], T, S)
        self.C = C
        return C

    def reduce(self):
        """Majority vote per output pixel -> index image, material, group, depth."""
        ss, h, w = self.ss, self.h, self.w
        n = ss * ss

        def blocks(a):
            return a.reshape(h, ss, w, ss).transpose(0, 2, 1, 3).reshape(h, w, n)

        C = blocks(self.C).astype(np.int32)
        M = blocks(self.M).astype(np.int32)
        G = blocks(self.G).astype(np.int32)
        Z = blocks(self.Z)
        covered = C >= 0
        cov = covered.sum(2)
        # count how many samples share each sample's colour; centre samples win ties
        cnt = np.zeros(C.shape, np.int32)
        for k in range(n):
            cnt[..., k] = (C == C[..., k:k + 1]).sum(2)
        cy, cx = np.divmod(np.arange(n), ss)
        centre = -((cy - (ss - 1) / 2) ** 2 + (cx - (ss - 1) / 2) ** 2)
        score = cnt * 100 + (centre - centre.min())[None, None, :]
        score[~covered] = -1
        k = score.argmax(2)
        take = lambda a: np.take_along_axis(a, k[..., None], 2)[..., 0]
        out = take(C)
        opaque = cov * 2 >= n
        self.img = np.where(opaque, out, -1).astype(np.int32)
        self.mat = np.where(opaque, take(M), 0)
        self.grp = np.where(opaque, take(G), 0)
        self.dep = np.where(opaque, np.where(covered, Z, -1e9).max(2), -1e9)
        return self.img

    # ------------------------------------------------------- 1x passes -----
    def project(self, p):
        """World point -> output pixel (x, y) floats."""
        return p[0] + self.ox, self.oy - p[1]

    def cleanup(self, keep=None):
        """Lone pixels inside a flat area take the area's colour."""
        img = self.img
        h, w = img.shape
        out = img.copy()
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                c = img[y, x]
                if c < 0 or (keep is not None and keep[y, x]):
                    continue
                nb = [img[y - 1, x], img[y + 1, x], img[y, x - 1], img[y, x + 1]]
                if nb[0] >= 0 and nb.count(nb[0]) == 4 and nb[0] != c:
                    out[y, x] = nb[0]
                elif min(nb) >= 0:
                    same = sum(1 for v in nb if v == c)
                    if same == 0:
                        vals, cnts = np.unique(nb, return_counts=True)
                        if cnts.max() >= 3:
                            out[y, x] = vals[cnts.argmax()]
        self.img = out

    def inner_lines(self, dz=2.0, pairs=None):
        """Where a nearer part overlaps a farther one, darken the far side's edge."""
        img, grp, dep, mat = self.img, self.grp, self.dep, self.mat
        h, w = img.shape
        out = img.copy()
        for y in range(h):
            for x in range(w):
                if img[y, x] < 0:
                    continue
                m = MATS[mat[y, x]]
                if m is None or not m.lineable:
                    continue
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    yy, xx = y + dy, x + dx
                    if not (0 <= yy < h and 0 <= xx < w) or img[yy, xx] < 0:
                        continue
                    if grp[yy, xx] != grp[y, x] and dep[yy, xx] - dep[y, x] > dz:
                        if pairs is None or (grp[yy, xx], grp[y, x]) in pairs:
                            out[y, x] = m.line
                            break
        self.img = out

    def outline(self):
        img, dep, mat = self.img, self.dep, self.mat
        h, w = img.shape
        out = img.copy()
        for y in range(h):
            for x in range(w):
                if img[y, x] >= 0:
                    continue
                best, bz = None, -1e18
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and img[yy, xx] >= 0 and dep[yy, xx] > bz:
                        best, bz = (yy, xx), dep[yy, xx]
                if best is not None:
                    m = MATS[mat[best]]
                    out[y, x] = m.outline if m is not None else pal("#0b0416")
        self.img = out

    def to_image(self):
        lut = np.array(PAL_LIST + [(0, 0, 0)], dtype=np.uint8)
        idx = np.where(self.img >= 0, self.img, len(PAL_LIST))
        rgb = lut[idx]
        a = np.where(self.img >= 0, 255, 0).astype(np.uint8)
        return Image.fromarray(np.dstack([rgb, a]), "RGBA")


# ======================================================= 1x feature paint ===
def put(R, x, y, c, front=None):
    """Set one output pixel (if inside, and optionally only on opaque pixels)."""
    x, y = int(math.floor(x)), int(math.floor(y))
    if 0 <= x < R.w and 0 <= y < R.h:
        if front == "on" and R.img[y, x] < 0:
            return
        R.img[y, x] = c


def line_px(x0, y0, x1, y1):
    x0, y0, x1, y1 = int(math.floor(x0)), int(math.floor(y0)), int(math.floor(x1)), int(math.floor(y1))
    pts = []
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy
    return pts


def stamp(R, x, y, rows, key, flip=False, front="on"):
    """Paint an ASCII map with its top-left at (x, y); '.' is skipped."""
    x, y = int(round(x)), int(round(y))
    for j, row in enumerate(rows):
        for i, ch in enumerate(row[::-1] if flip else row):
            if ch == "." or ch == " ":
                continue
            put(R, x + i, y + j, key[ch], front)


def poly_fill(R, pts, c, front="on", ss=4):
    """Fill a polygon given in output-pixel coordinates (centre-sampled)."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0, x1 = int(math.floor(min(xs))), int(math.ceil(max(xs)))
    y0, y1 = int(math.floor(min(ys))), int(math.ceil(max(ys)))
    im = Image.new("L", ((x1 - x0 + 1) * ss, (y1 - y0 + 1) * ss), 0)
    ImageDraw.Draw(im).polygon([((px - x0) * ss, (py - y0) * ss) for px, py in pts], fill=255)
    a = np.asarray(im).reshape(y1 - y0 + 1, ss, x1 - x0 + 1, ss).mean((1, 3))
    for j in range(a.shape[0]):
        for i in range(a.shape[1]):
            if a[j, i] >= 128:
                put(R, x0 + i, y0 + j, c, front)


# ============================================================ materials =====
# One set per hero. Ramps run dark -> light and lean cool in the shadows,
# warm in the light; `rim` is the IC colour where the rim light grazes.
RED, BLUE, GREEN = "#ff2457", "#4da6ff", "#5aff7a"


def materials():
    M = {}
    # --- Paine: red hair, black heat-proof leather, red piping, pyro glow
    M["p_skin"] = Mat(["#3a1724", "#7a3440", "#b0574f", "#d98068", "#f0a688", "#ffd2b4"],
                      th=[0.07, 0.22, 0.42, 0.68, 0.9], rim=["#ff5577", "#ff9aae"], line="#5a2232", outline="#2a0c18", ao=0.3)
    M["p_lips"] = Mat(["#5c1626", "#8e2738", "#b8414e", "#d8656b"], th=[0.15, 0.42, 0.75], rim=["#ff5577"], outline="#2a0c18")
    M["p_hair"] = Mat(["#26040f", "#4a0a1d", "#7a1127", "#ab1b2c", "#d82e2e", "#f2563a"], kind="hair",
                      th=[0.1, 0.24, 0.42, 0.62, 0.84], hi="#ff9a6a", sheen=0.72, gloss=90, rim=[RED, "#ff8aa6"],
                      outline="#1a020a", line="#26040f", ao=0.7)
    M["p_stub"] = Mat(["#2e121c", "#4d1f2a", "#6e3236", "#8c4642"], th=[0.2, 0.45, 0.72], rim=[RED], outline="#1a020a")
    M["p_leather"] = Mat(["#09060d", "#110c18", "#1a1424", "#251d33", "#342a47"], kind="leather",
                         th=[0.12, 0.3, 0.56, 0.84], sheen=0.86, gloss=70, hi="#6c5f8c", rim=["#a6113e", RED],
                         outline="#050308", line="#050308", bounce="#1c1a3a")
    M["p_strap"] = Mat(["#1e1219", "#34212a", "#4d3138", "#6a454a"], th=[0.15, 0.4, 0.75], rim=["#a6113e", RED],
                       outline="#050308")
    M["p_trim"] = Mat(["#5c0a2b", "#a6113e", "#ff2457", "#ff6f8f"], th=[0.2, 0.5, 0.82], rim=["#ff8aa6"], outline="#2a0410")
    M["p_metal"] = Mat(["#1b1628", "#2f2843", "#4a4266", "#706893", "#a8a2cc", "#e2defa"], kind="leather",
                       sheen=0.75, gloss=40, rim=[RED, "#ff8aa6"], outline="#0b0814")
    M["p_glow"] = Mat(["#ffb03a"], kind="flat", lineable=False, outline="#7a2a08")
    M["p_glowhot"] = Mat(["#fff1c2"], kind="flat", lineable=False, outline="#7a2a08")
    M["p_neon"] = Mat([RED], kind="flat", lineable=False, outline="#3a0414")
    # --- Tetsu: mirror chrome, black under-suit, electric-blue trim and optic
    M["t_chrome"] = Mat(["#15172a", "#2a2e48", "#474d6e", "#6f7699", "#a3aacb", "#d6dbf2", "#ffffff"], kind="chrome",
                        th=[0.12, 0.27, 0.44, 0.62, 0.8, 0.95], rim=["#2d6fd6", BLUE], outline="#07081a", line="#0d0f22", ao=0.7)
    M["t_dark"] = Mat(["#0a0a12", "#13131f", "#1d1d2d", "#2a2a3f", "#3b3b55"], kind="leather", sheen=0.7, gloss=30,
                      hi="#56567a", rim=["#1d4a99", BLUE], outline="#040408", line="#040408")
    M["t_trim"] = Mat(["#0b2a66", "#1f5fc2", BLUE, "#a6d4ff"], th=[0.2, 0.5, 0.82], rim=["#cfe8ff"], outline="#05122e")
    M["t_cloth"] = Mat(["#0a1124", "#121d3a", "#1b2b54", "#273d70", "#36528c"], th=[0.14, 0.34, 0.6, 0.86],
                       rim=["#1f5fc2", BLUE], outline="#04070f", line="#04070f")
    M["t_glow"] = Mat([BLUE], kind="flat", lineable=False, outline="#05122e")
    M["t_glowhot"] = Mat(["#dff0ff"], kind="flat", lineable=False, outline="#05122e")
    M["t_visor"] = Mat(["#03040a", "#070a16", "#0c1224"], th=[0.4, 0.8], kind="leather", sheen=0.8, gloss=50,
                       hi="#3c5a8a", outline="#020306")
    # --- Sudo: purple hoodie, jeans, white sneakers, black battery, green LEDs
    M["s_skin"] = Mat(["#3b1f24", "#64343a", "#93524f", "#bd7865", "#dc9d81", "#f2c4a4", "#ffe6cf"],
                      th=[0.1, 0.22, 0.36, 0.52, 0.7, 0.9], rim=["#8cffa6", "#d4ffdc"], line="#4a2630", outline="#22101a")
    M["s_hair"] = Mat(["#24110c", "#45210f", "#6e3716", "#9c541f", "#c9782b", "#e8a046"], kind="hair",
                      th=[0.1, 0.24, 0.42, 0.62, 0.84], hi="#ffd07a", sheen=0.55, gloss=22, rim=["#5aff7a", "#c8ffd2"],
                      outline="#140806", line="#24110c", ao=0.7)
    M["s_hood"] = Mat(["#170a2b", "#2a1450", "#40207a", "#5a2d91", "#7845bd", "#9a68dc"], th=[0.1, 0.25, 0.45, 0.68, 0.9],
                      rim=["#3fcf6a", GREEN], outline="#0a0418", line="#0d061c", bounce="#2a2f66")
    M["s_jeans"] = Mat(["#0b0e1e", "#141a33", "#1f294d", "#2d3a68", "#3e4f86"], rim=["#3fcf6a", GREEN], outline="#05060e")
    M["s_white"] = Mat(["#4a4a66", "#7d7d9c", "#b4b4cc", "#e4e4f2", "#ffffff"], rim=["#c8ffd2"], outline="#16162a")
    M["s_plastic"] = Mat(["#08080e", "#101018", "#1a1a26", "#262636", "#36364c"], kind="leather", sheen=0.72, gloss=30,
                         hi="#5a5a78", rim=["#2f9a4c", GREEN], outline="#030306", line="#030306")
    M["s_metal"] = Mat(["#1e1e2c", "#3a3a52", "#5c5c7a", "#8a8aa8", "#c0c0d8", "#ffffff"], kind="leather", sheen=0.7,
                       gloss=36, rim=["#3fcf6a", GREEN], outline="#0a0a14")
    M["s_copper"] = Mat(["#3a1606", "#6e2c0a", "#a8480f", "#d96a1a", "#ff9b3a", "#ffd08a"], kind="leather",
                        sheen=0.7, gloss=30, rim=[GREEN], outline="#1c0a02")
    M["s_led"] = Mat([GREEN], kind="flat", lineable=False, outline="#06200c")
    M["s_ledhot"] = Mat(["#d4ffdc"], kind="flat", lineable=False, outline="#06200c")
    M["s_screen"] = Mat(["#0b3b2c"], kind="flat", lineable=False, outline="#031a12")
    M["s_amber"] = Mat(["#ffe14d"], kind="flat", lineable=False, outline="#3a2a04")
    M["s_lips"] = Mat(["#4e1e26", "#7a3138", "#a24a4c", "#c46a64"], th=[0.15, 0.42, 0.75], outline="#22101a")
    return M


MAT = materials()
INK = pal("#0b0416")  # generic darkest ink


# ======================================================= feature helpers ====
def proj(R, F, p):
    """Local point (frame F) -> output pixel coords + world z."""
    w = F.p(p)
    x, y = R.project(w)
    return x, y, float(w[2])


def visible(R, x, y, z, tol=1.5):
    xi, yi = int(math.floor(x)), int(math.floor(y))
    if not (0 <= xi < R.w and 0 <= yi < R.h):
        return False
    return R.img[yi, xi] >= 0 and z >= R.dep[yi, xi] - tol


def facing(F, n):
    """How much a local direction faces the viewer (0 = edge-on, 1 = straight at us)."""
    return float(unit(F.d(n))[2])


def stroke(R, pts, c, width=1, front="on"):
    """A polyline in output pixels."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        for (x, y) in line_px(x0, y0, x1, y1):
            put(R, x, y, c, front)
            if width > 1:
                put(R, x, y + 1, c, front)


def disc(R, cx, cy, rx, ry, c, front="on"):
    for y in range(int(math.floor(cy - ry - 1)), int(math.ceil(cy + ry + 1))):
        for x in range(int(math.floor(cx - rx - 1)), int(math.ceil(cx + rx + 1))):
            if ((x + 0.5 - cx) / max(rx, 0.01)) ** 2 + ((y + 0.5 - cy) / max(ry, 0.01)) ** 2 <= 1.0:
                put(R, x, y, c, front)


# ================================================================ busts ======
# 192x240, ox=96, oy=240: world units are bust pixels, y up from the bottom.
BUST_W, BUST_H, BUST_SS = 192, 240, 3


def face_left(theta_deg):
    """Body rotation for a 3/4 view facing screen-left (the key light's side)."""
    return rot_y(math.pi + math.radians(theta_deg))


def human_head(P, H, skin, jaw=1.0, chin=1.0, nose=1.0, cheek=1.0, face=1.0):
    """A bust-scale human head in frame H (x forward, y up, z right; ~92 tall).
    Lips, eyes and brows are painted afterwards (cleaner than modelled ones)."""
    P.ell(H, (-3, 6, 0), (41, 42, 34), skin)
    P.ell(H, (12, -9, 0), np.array((25, 27, 25 * jaw)) * face, skin, k=14)
    for zs in (-1, 1):
        P.cone(H, (-7, -15, 23 * zs * jaw), (20, -34, 7.5 * zs * jaw), 8, 6.5, skin, k=10)
        P.ell(H, (22, -3, 19 * zs * cheek), (9, 7, 9), skin, k=8)
        P.ell(H, (31, 9, 12 * zs), (5, 3.5, 10), skin, k=6)
        P.ell(H, (-4, -3, 32 * zs), (8, 13, 4.5), skin, k=3)
        P.ell(H, (34.5 + 2 * (nose - 1), -12.5, 4.2 * zs * nose), (3, 2.6, 3), skin, k=2)
    P.ell(H, (25, -36, 0), np.array((7.5, 7.5, 9.5)) * chin, skin, k=8)
    P.cone(H, (33, 5, 0), (37.5 + 4 * (nose - 1), -9, 0), 2.4, 3.4 * nose, skin, k=3)
    P.ell(H, (37 + 4 * (nose - 1), -10.5, 0), np.array((3.6, 3.4, 4)) * nose, skin, k=2)
    P.ell(H, (32, -22, 0), (3.5, 4, 8.5), skin, k=6)  # the fullness around the mouth


def face_x(z, y=0.0):
    """Roughly where the face surface is (head-local x) at side offset z."""
    return 35.0 - 0.034 * z * z - 0.004 * y * y


def paint_lips(R, H, col, width=8.2, smirk=0.0, open_=0.0, y=-23.0, up_h=2.0, lo_h=2.6):
    """Lips on the face, from 3D contour points (so they turn with the head).
    smirk lifts the near (-z) corner; open_ parts them (teeth)."""
    def P(z, dy, dx=0.0):
        return proj(R, H, (face_x(z, y) + dx + 1.2, y + dy, z))[:2]

    zs = np.linspace(-width, width, 13)
    lift = lambda z: smirk * max(0.0, -z / width) ** 1.6
    mouth = [P(z, lift(z)) for z in zs]
    upper = [P(z, lift(z) + up_h * (1 - (z / width) ** 2) ** 0.7 + (0.6 if abs(abs(z) - 2.2) < 1.2 else 0)) for z in zs]
    lower = [P(z, lift(z) * 0.6 - open_ - lo_h * (1 - (z / width) ** 2) ** 0.8) for z in zs]
    poly_fill(R, upper + mouth[::-1], col["lip_dk"], front="on")
    poly_fill(R, mouth + lower[::-1], col["lip"], front="on")
    if open_ > 0.6:
        teeth = [P(z, lift(z) - 0.2) for z in zs[2:-2]] + [P(z, lift(z) * 0.6 - open_ + 0.4) for z in zs[2:-2][::-1]]
        poly_fill(R, teeth, col["teeth"], front="on")
    # a highlight on the lower lip, toward the light
    for z in zs[3:6]:
        x, yy = P(z, lift(z) * 0.6 - open_ - lo_h * 0.45)
        put(R, x, yy, col["lip_hi"])
    stroke(R, mouth, col["mouth"])
    if smirk > 0:
        x, yy = P(-width - 0.8, smirk + 0.8)
        put(R, x, yy, col["mouth"])


def paint_nose(R, H, col, nose=1.0):
    """The far side of the nose in shadow, a nostril and a lit tip."""
    pts = [proj(R, H, (34.5 + 3.5 * t * nose, 3 - 13.5 * t, 3.2 + 0.8 * t))[:2] for t in np.linspace(0, 1, 7)]
    stroke(R, pts[2:], col["nose_sh"])
    x, y, _ = proj(R, H, (35.5 + 2 * (nose - 1), -13.4, -3.6))
    put(R, x, y, col["nostril"])
    put(R, x + 1, y, col["nostril"])
    x, y, _ = proj(R, H, (38.5 + 4 * (nose - 1), -9.5, -1.2))
    put(R, x, y, col["nose_hi"])


def chain(P, F, pts, radii, mat, k=6, sw=2.6, sub=False):
    """Round cones through a list of local points (hair locks, tails, cables)."""
    for (a, ra), (b, rb) in zip(zip(pts, radii), zip(pts[1:], radii[1:])):
        A, B = F.p(a), F.p(b)
        axis = unit(B - A)
        bn = unit(np.cross(axis, VIEW))  # across the lock, in view

        def tan(Q, axis=axis):
            return np.broadcast_to(axis, Q.shape)

        def sfn(Q, A=A, bn=bn):
            return ((Q - A) @ bn) / sw

        P.cone(F, a, b, ra, rb, mat, k=k, sub=sub, tan=tan, sfn=sfn)


def body_coords(B):
    """World points -> body-frame coordinates (for paint functions)."""
    return lambda P: (P - B.T) @ B.R / B.s


def eye(R, cx, cy, w, h, outer, look, col, tilt=1.2, liner=2, wing=2, lashes=True, lower=True):
    """A painted eye: lids, sclera, iris, pupil and a catchlight from the key light.
    outer: +1 when the outer corner is to the right; look: iris shift (px)."""
    n = max(6, int(w * 2))
    up, lo = [], []
    for i in range(n + 1):
        t = i / n
        x = cx + outer * (t - 0.5) * w
        up.append((x, cy - h * 0.55 * math.sin(math.pi * t) ** 0.85 - tilt * t + tilt * 0.4))
        lo.append((x, cy + h * 0.42 * math.sin(math.pi * t) ** 1.1 - 0.5 * tilt * t + tilt * 0.3))
    poly_fill(R, up + lo[::-1], col["white"], front=None)
    # iris + pupil, kept inside the opening
    mask = R.img == col["white"]
    ix, iy = cx + look, cy + 0.2
    rx = min(h * 0.62, 3.3) * min(1.0, 0.55 + w / 24)
    ry = h * 0.66
    for y in range(int(iy - ry - 1), int(iy + ry + 2)):
        for x in range(int(ix - rx - 1), int(ix + rx + 2)):
            if not (0 <= y < R.h and 0 <= x < R.w) or not mask[y, x]:
                continue
            d = ((x + 0.5 - ix) / rx) ** 2 + ((y + 0.5 - iy) / ry) ** 2
            if d <= 1.0:
                R.img[y, x] = col["iris_dk"] if d > 0.55 or y + 0.5 < iy - ry * 0.2 else col["iris"]
            if ((x + 0.5 - ix) / max(rx * 0.42, 0.6)) ** 2 + ((y + 0.5 - iy) / max(ry * 0.42, 0.6)) ** 2 <= 1.0:
                R.img[y, x] = col["pupil"]
    # the lid's shadow on the top of the eyeball
    for (x, y) in up[1:-1]:
        xi, yi = int(math.floor(x)), int(math.floor(y)) + 1
        if 0 <= yi < R.h and 0 <= xi < R.w and R.img[yi, xi] == col["white"]:
            R.img[yi, xi] = col["white_sh"]
    put(R, ix - rx * 0.35, iy - ry * 0.45, col["spark"])
    if lower:
        stroke(R, lo[n // 3:], col["lid_lo"])
    stroke(R, up, col["liner"], width=liner)
    if wing:
        ex, ey = up[-1]
        stroke(R, [(ex, ey), (ex + outer * wing, ey - wing * 0.6), (ex + outer * (wing + 1.5), ey - wing * 0.9)], col["liner"])
    if lashes:
        for t in (0.62, 0.78, 0.9):
            x, y = up[int(t * n)]
            put(R, x + outer * 0.5, y - 1, col["liner"])
    stroke(R, [(x, y - 2.2 - 0.6 * math.sin(math.pi * i / n)) for i, (x, y) in enumerate(up)][1:-1], col["crease"])


def brow(R, pts, thick, col_dark, col_light=None):
    """A tapered brow along pts (inner -> outer), filled as a polygon."""
    n = len(pts)
    top = [(x, y) for (x, y) in pts]
    bot = [(x, y + thick * (1 - 0.7 * i / max(1, n - 1)) + 0.4) for i, (x, y) in enumerate(pts)]
    poly_fill(R, top + bot[::-1], col_dark, front="on")
    if col_light is not None:
        stroke(R, pts[: max(2, n // 2)], col_light)


def paine_bust():
    m = Model()
    B = Frame(face_left(34), (12, 0, 0))
    # head turned a little more toward us, chin down a touch, a slight tilt
    H = B.sub(rot_y(math.radians(16)) @ rot_z(math.radians(-5)) @ rot_x(math.radians(-3)), (8, 158, 0))
    S, L = MAT["p_skin"], MAT["p_lips"]
    hc = lambda P: (P - H.T) @ H.R / H.s

    def head_paint(P, n, mats):
        Q = hc(P)
        out = mats.copy()
        shaved = (Q[:, 2] < -21) & (Q[:, 1] > -9) & (Q[:, 1] < 26) & (Q[:, 0] < 16) & (Q[:, 0] > -40)
        ear = ((Q[:, 0] + 4) / 9) ** 2 + ((Q[:, 1] + 3) / 14) ** 2 < 1.0
        out[shaved & ~ear & (mats == S.id)] = MAT["p_stub"].id
        return out

    head = m.part(1, paint=head_paint)
    human_head(head, H, S, jaw=0.92, chin=0.9, nose=0.9, cheek=1.0)
    head.cone(B, (-1, 96, 0), (5, 136, 0), 17, 16, S, k=6)  # neck
    # hair: the cap (cut away over the face, and shaved over the near ear)
    hair = m.part(2)
    tie_w = H.p((-37.0, 35.0, 0.0))
    tx, ty = tie_w[0], tie_w[1]

    def cap_tan(Q):
        return tie_w[None, :] - Q

    def cap_s(Q):
        return np.arctan2(Q[:, 1] - ty, Q[:, 0] - tx) * 16.0

    hm = MAT["p_hair"]
    hair.ell(H, (-6, 10, 0), (47, 47, 39.5), hm, tan=cap_tan, sfn=cap_s)
    hair.plane(H, (30, 30, 0), (1, -1.2, 0), k=3)
    hair.box(H, (-10, -14, -44), (40, 30, 26), None, sub=True, k=3)  # undercut above the near ear
    hair.cone(H, (-36, 38, 0), (-43, 43, 0), 7.5, 7, MAT["p_metal"], k=1)  # the tie
    # side-swept bangs, from the parting across to the far temple
    chain(hair, H, [(16, 47, -18), (31, 41, -6), (39, 32, 8), (38.5, 21, 20), (33, 9, 28), (26, -5, 32)],
          [7, 8.5, 8, 6.5, 5, 3], hm, k=8, sw=1.7)
    chain(hair, H, [(8, 49, -8), (24, 44, 6), (31, 34, 20), (29, 22, 31)], [6, 7, 5.5, 3.5], hm, k=8, sw=1.7)
    # the high ponytail, falling behind the near shoulder
    t0 = B.R.T @ (H.p((-44, 43, 0)) - B.T)
    tail = [t0 + np.array(d, float) for d in ((0, 0, 0), (-10, 4, 2), (-22, -2, 4), (-30, -18, 6), (-33, -38, 6),
                                              (-31, -60, 4), (-26, -82, 2), (-20, -100, 0))]
    chain(hair, B, tail, [7, 11, 12.5, 12, 11, 9.5, 7.5, 4], hm, k=7, sw=1.7)
    # torso: black heat-proof leather, a harness strap, red piping
    bc = body_coords(B)
    lea = MAT["p_leather"]

    def torso_paint(P, n, mats):
        Q = bc(P)
        out = mats.copy()
        # harness strap: near shoulder -> far hip, across the chest
        d = np.abs((Q[:, 1] - 96) + (Q[:, 2] + 40) * 1.25) / 1.6
        out[(d < 4.2) & (Q[:, 0] > -8)] = MAT["p_strap"].id
        # piping down the outside of the sleeves
        out[(np.abs(Q[:, 0] + 7) < 1.6) & (np.abs(Q[:, 2]) > 44) & (Q[:, 1] < 92)] = MAT["p_trim"].id
        # a seam over the shoulder
        out[(np.abs(Q[:, 1] - (99 - 0.32 * np.abs(Q[:, 2]))) < 1.3) & (np.abs(Q[:, 2]) > 24) & (Q[:, 0] > -12)] = MAT["p_trim"].id
        return out

    T = m.part(3, paint=torso_paint)
    T.ell(B, (0, 44, 0), (38, 56, 48), lea)
    for zs in (-1, 1):
        T.ell(B, (22, 50, 19 * zs), (15, 17, 16), lea, k=10)
        T.cone(B, (-4, 98, 14 * zs), (-6, 88, 46 * zs), 12, 19, lea, k=12)
        T.ell(B, (-5, 80, 50 * zs), (21, 22, 19), lea, k=10)
        T.cone(B, (-6, 74, 53 * zs), (-10, 0, 56 * zs), 18, 16, lea, k=8)
    buckle = m.part(6)
    buckle.box(B, (37, 60, -2), (4, 6, 6), MAT["p_metal"], R=rot_x(math.radians(-38)) @ rot_y(math.radians(-10)), rr=1.5)

    def collar_paint(P, n, mats):
        Q = bc(P)
        out = mats.copy()
        out[Q[:, 1] > 118.5] = MAT["p_trim"].id
        out[Q[:, 0] > 11.5] = MAT["p_trim"].id
        ang = np.arctan2(Q[:, 2], Q[:, 0])  # 0 = front, -pi/2 = the near side
        for a0 in (-1.15, -1.5):
            out[(np.abs(ang - a0) < 0.06) & (Q[:, 1] > 99) & (Q[:, 1] < 113)] = MAT["p_glow"].id
        return out

    col = m.part(5, paint=collar_paint)
    col.cone(B, (-3, 90, 0), (-1, 122, 0), 24, 22, lea)
    col.cone(B, (-3, 88, 0), (-1, 124, 0), 20.5, 18.5, None, sub=True, k=1)
    col.plane(B, (13, 0, 0), (1, 0, 0), k=2)
    # the collapsed bow on her back, peeking over the near shoulder
    bow = m.part(4)
    bow.cone(B, (-30, 60, -30), (-40, 176, -22), 4.5, 3.6, MAT["p_metal"])
    bow.ell(B, (-40.5, 179, -22), (4.4, 4.4, 4.4), MAT["p_neon"], k=1)
    bow.cone(B, (-37, 150, -24), (-38.5, 162, -23.5), 5.2, 5.2, MAT["p_trim"], k=0.5)
    return m, B, H


PAINE_FACE = {"white": pal("#ecdcd6"), "white_sh": pal("#b99ea2"), "iris": pal("#55b07a"), "iris_dk": pal("#265e42"),
              "pupil": pal("#0b0408"), "spark": pal("#ffffff"), "liner": pal("#1a0610"), "lid_lo": pal("#b0574f"),
              "crease": pal("#b0574f"), "lip": pal("#b8414e"), "lip_dk": pal("#8e2738"), "lip_hi": pal("#e07a7e"),
              "mouth": pal("#4a0f1e"), "teeth": pal("#f2e6e0"), "nose_sh": pal("#b0574f"), "nostril": pal("#5c2230"),
              "nose_hi": pal("#ffd2b4")}


def paine_bust_finish(R, m, B, H):
    R.cleanup()
    R.inner_lines(dz=3)
    F = PAINE_FACE
    for side in (-1, 1):  # -1: the near eye (her left), +1: the far one
        z = 14.0 * side
        cx, cy, _ = proj(R, H, (face_x(z) + 0.5, 1.0, z))
        k = facing(H, (0.8, 0.05, 0.6 * side))
        w = 15.0 * float(np.clip(k * 1.15, 0.45, 1.0))
        outer = 1 if side < 0 else -1
        eye(R, cx, cy, w, 6.0, outer, 1.6 if side < 0 else 0.8, F, tilt=1.4, liner=2, wing=3 if side < 0 else 1)
        # brows: sharp, the far one a little higher (one eyebrow of attitude)
        lift = 1.2 if side > 0 else 0.0
        pts = [proj(R, H, (face_x(z * 0 + (4 + 16 * t) * side, 10) + 1.5, 9.0 + lift + 2.2 * math.sin(math.pi * min(1, t * 1.25) * 0.85),
                           (4 + 16 * t) * side))[:2] for t in np.linspace(0, 1, 12)]
        brow(R, pts, 2.8 if side < 0 else 2.2, pal("#4a0a1d"), pal("#7a1127"))
    paint_nose(R, H, F, nose=0.9)
    paint_lips(R, H, F, width=8.0, smirk=1.6, y=-22.5)
    # the pyro implant glowing along the undercut
    pts = [proj(R, H, p_)[:2] for p_ in ((2, 15, -36.0), (-8, 14, -37.6), (-18, 11, -37.4), (-26, 6, -35.5))]
    stroke(R, pts, pal("#ff7a1a"))
    stroke(R, pts[1:3], pal("#ffd27a"))
    for p_ in ((2, 15, -36.0), (-26, 6, -35.5)):
        x, y, _ = proj(R, H, p_)
        disc(R, x, y, 1.4, 1.4, pal("#ff9b21"))
        put(R, x, y, pal("#fff1c2"))
    R.outline()


def tetsu_bust():
    m = Model()
    B = Frame(face_left(30), (4, 0, 0))
    H = B.sub(rot_y(math.radians(14)) @ rot_z(math.radians(-2)), (8, 166, 0))
    ch, dk, tr, cl = MAT["t_chrome"], MAT["t_dark"], MAT["t_trim"], MAT["t_cloth"]
    hc = lambda P: (P - H.T) @ H.R / H.s
    bc = body_coords(B)

    def helm_paint(P, n, mats):
        Q = hc(P)
        out = mats.copy()
        # a blue band around the back of the helmet, a dark ridge seam over the top
        out[(np.abs(Q[:, 1] + 3) < 1.6) & (Q[:, 0] < 14) & (mats == ch.id)] = tr.id
        out[(np.abs(Q[:, 2]) < 0.9) & (Q[:, 1] > 20) & (Q[:, 0] < 22) & (mats == ch.id)] = dk.id
        # grille slits on the jaw guard
        grill = (Q[:, 0] > 24) & (Q[:, 1] < -20) & (Q[:, 1] > -36) & (np.abs(Q[:, 2]) < 9)
        out[grill & (np.mod(Q[:, 1] + 40, 4.0) < 1.3)] = dk.id
        return out

    hp = m.part(1, paint=helm_paint)
    hp.ell(H, (-3, 8, 0), (38, 40, 32), ch)
    hp.ell(H, (12, -6, 0), (24, 27, 23), ch, k=8)
    hp.box(H, (23, -27, 0), (9, 10, 12), ch, rr=4, k=5)
    for zs in (-1, 1):
        hp.box(H, (19, -14, 17 * zs), (11, 13, 4), ch, R=rot_y(-0.55 * zs) @ rot_z(0.15), rr=2.5, k=4)
        hp.ell(H, (30, 10, 11 * zs), (6, 4, 11), ch, k=4)  # brow plates
    flare = m.part(2)
    for zs in (-1, 1):  # side flares, a nod to a samurai helmet
        flare.box(H, (-2, 10, 33 * zs), (17, 15, 2.5), ch, R=rot_y(0.35 * zs) @ rot_x(-0.55 * zs) @ rot_z(-0.25), rr=2)
    vis = m.part(3)
    vis.box(H, (30.5, 1.5, 0), (5.5, 3.4, 19), MAT["t_visor"], R=rot_y(0.0), rr=1.6)
    crest = m.part(4)
    crest.box(H, (-8, 50, 0), (22, 3.6, 1.6), ch, R=rot_z(math.radians(16)), rr=1.4)
    crest.box(H, (14, 44, 0), (5, 4, 2.6), tr, R=rot_z(math.radians(30)), rr=1.2, k=1)

    def neck_paint(P, n, mats):
        Q = bc(P)
        out = mats.copy()
        out[np.mod(Q[:, 1], 6.0) < 1.4] = MAT["t_dark"].id
        return out

    nk = m.part(5, paint=neck_paint)
    nk.cone(B, (0, 96, 0), (6, 140, 0), 16, 14, MAT["t_cloth"])
    # scarf: a ring around the neck, tails streaming back
    sc = m.part(6)
    sc.cone(B, (-3, 104, 0), (-1, 122, 0), 28, 25, cl)
    sc.ell(B, (6, 104, 0), (26, 10, 30), cl, k=8)
    chain(sc, B, [(-22, 116, 12), (-44, 108, 16), (-62, 94, 20), (-76, 74, 22), (-84, 54, 22)], [10, 10, 9, 7.5, 5], cl, k=5)

    def plate_paint(edge_y):
        def f(P, n, mats):
            Q = bc(P)
            out = mats.copy()
            out[(Q[:, 1] < edge_y + 2.2) & (mats == ch.id)] = tr.id
            return out
        return f

    T = m.part(7)
    T.ell(B, (0, 46, 0), (44, 60, 56), ch)
    T.ell(B, (30, 62, 0), (14, 26, 30), ch, k=10)  # the chest plate's keel
    T.cone(B, (-6, 0, 0), (-6, 30, 0), 46, 48, dk, k=6)
    # pauldrons: three stacked chrome lames per shoulder, blue edges
    for zs in (-1, 1):
        for i, (y, rz, rx) in enumerate(((94, 30, 32), (82, 33, 34), (70, 35, 34))):
            pp = m.part(8 + i, paint=plate_paint(y - 18 + i * 1.5))
            pp.ell(B, (-4, y, (58 + 5 * i) * zs), (rx, 20, rz), ch, R=rot_x(0.28 * zs))
        arm = m.part(11)
        arm.cone(B, (-6, 60, 64 * zs), (-8, 0, 66 * zs), 22, 20, dk)
    # the monoblade on his back: hilt and guard over the near shoulder
    sw = m.part(12)
    sw.cone(B, (-30, 118, -34), (-38, 196, -28), 4.2, 3.8, dk)
    sw.ell(B, (-30.5, 121, -33.5), (9, 2.2, 9), ch, R=rot_z(0.1))
    sw.ell(B, (-38.5, 199, -28), (4.6, 4.6, 4.6), MAT["t_glow"], k=1)
    return m, B, H


TETSU_FACE = {"glow": pal(BLUE), "core": pal("#dff0ff"), "halo": pal("#1f5fc2"), "scar": pal("#15172a"), "scar_hi": pal("#d6dbf2")}


def tetsu_bust_finish(R, m, B, H):
    R.cleanup()
    R.inner_lines(dz=3)
    F = TETSU_FACE
    # one live optic behind the visor (near side), the other dark
    x, y, _ = proj(R, H, (36.5, 1.5, -10.5))
    for yy in range(int(y) - 1, int(y) + 2):
        for xx in range(int(x) - 9, int(x) + 8):
            if 0 <= yy < R.h and 0 <= xx < R.w and MATS[R.mat[yy, xx]] is MAT["t_visor"]:
                R.img[yy, xx] = F["halo"] if abs(xx - x) > 4 else F["glow"]
    disc(R, x, y, 3.2, 2.6, F["glow"])
    disc(R, x, y, 1.6, 1.2, F["core"])
    put(R, x - 5, y, F["core"])
    x2, y2, _ = proj(R, H, (36.5, 1.5, 10.5))
    disc(R, x2, y2, 1.3, 1.6, pal("#0b2a66"))
    # an old cut across the far cheek plate
    pts = [proj(R, H, p_)[:2] for p_ in ((31, -4, 9), (27, -14, 15), (23, -22, 19))]
    stroke(R, pts, F["scar"])
    stroke(R, [(px + 1, py) for px, py in pts], F["scar_hi"])
    R.outline()


def sudo_bust():
    m = Model()
    B = Frame(face_left(28), (2, -4, 0))
    # the slouch: head pushed forward and down, a nervous tilt
    H = B.sub(rot_y(math.radians(18)) @ rot_z(math.radians(-7)) @ rot_x(math.radians(5)), (18, 150, 0))
    sk = MAT["s_skin"]
    head = m.part(1)
    human_head(head, H, sk, jaw=1.03, chin=0.92, nose=1.1, cheek=1.1)
    head.cone(B, (2, 92, 0), (14, 128, 0), 16, 15, sk, k=6)
    hair = m.part(2)
    hm = MAT["s_hair"]
    crown = H.p((-6, 30, 0))

    def cap_tan(Q):
        return Q - crown[None, :]

    def cap_s(Q):
        return np.arctan2(Q[:, 1] - crown[1], Q[:, 0] - crown[0]) * 14.0

    hair.ell(H, (-6, 12, 0), (45, 44, 38), hm, tan=cap_tan, sfn=cap_s)
    hair.plane(H, (30, 26, 0), (1, -1.0, 0), k=3)
    tufts = [((14, 40, -12), (34, 56, -24), 10), ((2, 46, 6), (14, 68, 12), 10), ((-12, 44, -14), (-18, 66, -30), 10),
             ((-24, 36, 10), (-46, 52, 20), 10), ((-30, 22, -20), (-54, 28, -36), 9), ((22, 36, 16), (42, 44, 32), 8),
             ((-36, 4, 8), (-56, -6, 16), 8), ((26, 34, -6), (44, 20, -14), 8), ((30, 30, 8), (44, 14, 14), 7),
             ((20, 40, -26), (34, 30, -38), 7)]
    for a_, b_, r_ in tufts:
        chain(hair, H, [a_, b_], [r_, 1.6], hm, k=7, sw=1.8)
    # headphones around the neck
    hpn = m.part(3, paint=None)
    pl = MAT["s_plastic"]
    for zs in (-1, 1):
        hpn.ell(B, (18, 100, 27 * zs), (9, 13, 12), pl, R=rot_y(0.5 * zs))
    chain(hpn, B, [(18, 100, -27), (-8, 112, -30), (-26, 114, 0), (-8, 112, 30), (18, 100, 27)], [3, 3.4, 3.4, 3.4, 3], pl, k=2)
    # the hoodie, the hood bunched behind the neck, drawstrings
    hood = MAT["s_hood"]
    T = m.part(4)
    T.ell(B, (0, 40, 0), (44, 60, 52), hood)
    for zs in (-1, 1):
        T.cone(B, (-2, 92, 14 * zs), (2, 80, 48 * zs), 14, 22, hood, k=12)
        T.ell(B, (0, 72, 50 * zs), (24, 24, 22), hood, k=10)
        T.cone(B, (0, 68, 54 * zs), (6, 0, 58 * zs), 22, 20, hood, k=8)
    hd = m.part(5)
    hd.ell(B, (-24, 104, 0), (22, 17, 34), hood)
    hd.cone(B, (-6, 96, 0), (-2, 108, 0), 26, 24, hood, k=6)
    hd.cone(B, (-6, 94, 0), (-2, 112, 0), 19, 18, None, sub=True, k=2)
    ds = m.part(6)
    for zs in (-1, 1):
        ds.cone(B, (30, 96, 9 * zs), (38, 62, 11 * zs), 1.6, 1.4, MAT["s_white"])
        ds.ell(B, (38.5, 59, 11 * zs), (2.2, 3.4, 2.2), MAT["s_metal"], k=0.5)
    # backpack battery peeking over the shoulders, straps, the cable
    bp = m.part(7)
    bp.box(B, (-46, 104, 0), (16, 32, 48), pl, rr=7)
    for zs in (-1, 1):
        st = m.part(8)
        st.box(B, (16, 80, 40 * zs), (3, 26, 7), pl, R=rot_z(-0.35) @ rot_x(0.12 * zs), rr=1.5)
    cab = m.part(9)
    chain(cab, B, [(-34, 128, -36), (-12, 116, -50), (12, 96, -52), (28, 70, -46), (34, 40, -40)], [3.4, 3.4, 3.2, 3, 3], pl, k=2)
    return m, B, H


SUDO_FACE = {"white": pal("#f4ece6"), "white_sh": pal("#c4aea6"), "iris": pal("#5f86c9"), "iris_dk": pal("#2a3f6e"),
             "pupil": pal("#0b0408"), "spark": pal("#ffffff"), "liner": pal("#2a1416"), "lid_lo": pal("#bd7865"),
             "crease": pal("#bd7865"), "lip": pal("#b25a56"), "lip_dk": pal("#8a3f40"), "lip_hi": pal("#e08a80"),
             "mouth": pal("#3a1416"), "teeth": pal("#fff6ee"), "nose_sh": pal("#bd7865"), "nostril": pal("#64343a"),
             "nose_hi": pal("#ffe6cf")}


def glasses(R, H, col, lens_r=9.5, glare_near=True):
    """Big round glasses: thick frames, the near lens flaring with screen glare."""
    centres = []
    for side in (-1, 1):
        z = 14.5 * side
        cx, cy, _ = proj(R, H, (face_x(z) + 4.5, 0.5, z))
        k = facing(H, (0.8, 0.05, 0.6 * side))
        rx, ry = lens_r * float(np.clip(k * 1.1, 0.4, 1.0)), lens_r
        centres.append((cx, cy, rx, ry))
        if side < 0 and glare_near:
            # glare: the lens turns into a bright screen reflection, diagonal bands
            for y in range(int(cy - ry - 1), int(cy + ry + 2)):
                for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                    d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
                    if d <= 1.0:
                        band = (x - cx) + (y - cy) * 0.9
                        c = col["glare"] if -6 < band < 1 else (col["glare_hi"] if 2 < band < 4 else None)
                        if c is not None:
                            put(R, x, y, c, front=None)
        # frame ring
        n = 40
        pts = [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
        stroke(R, pts, col["frame"], width=2, front=None)
    (x0, y0, r0, _), (x1, y1, r1, _) = centres
    stroke(R, [(x0 - r0, y0 - 1), (x1 + r1, y1 - 1)], col["frame"], width=2, front=None)
    stroke(R, [(x0 + r0, y0 - 2), (x0 + r0 + 18, y0 - 4)], col["frame"], width=1)


def sudo_bust_finish(R, m, B, H):
    R.cleanup()
    R.inner_lines(dz=3)
    F = SUDO_FACE
    for side in (-1, 1):
        z = 14.0 * side
        cx, cy, _ = proj(R, H, (face_x(z) + 0.5, 1.0, z))
        k = facing(H, (0.8, 0.05, 0.6 * side))
        w = 13.0 * float(np.clip(k * 1.15, 0.45, 1.0))
        eye(R, cx, cy, w, 6.4, 1 if side < 0 else -1, 0.4, F, tilt=-0.4, liner=1, wing=0, lashes=False)
        # worried brows: inner ends up
        pts = [proj(R, H, (face_x((4 + 15 * t) * side, 10) + 1.5, 12.5 - 3.5 * t, (4 + 15 * t) * side))[:2] for t in np.linspace(0, 1, 10)]
        brow(R, pts, 2.4, pal("#45210f"), pal("#6e3716"))
    paint_nose(R, H, F, nose=1.1)
    paint_lips(R, H, F, width=10.0, smirk=1.0, open_=3.0, y=-22.5, up_h=1.2, lo_h=1.6)
    glasses(R, H, {"frame": pal("#120d18"), "glare": pal("#c8ffd2"), "glare_hi": pal("#ffffff")})
    # a nervous bead of sweat
    x, y, _ = proj(R, H, (14, 20, -30))
    stamp(R, x, y, [".a.", "aba", "bcb", ".b."], {"a": pal("#d4ffff"), "b": pal("#7fd8ff"), "c": pal("#ffffff")})
    R.outline()


def render_bust(build):
    m, B, H = build()
    R = Render(BUST_W, BUST_H, BUST_SS, BUST_W / 2, BUST_H)
    R.render(m)
    R.shade(ao_radius=4 * BUST_SS, smooth=BUST_SS)
    R.reduce()
    return R, m, B, H
