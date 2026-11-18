"""Builds desktop/icon.png, the desktop app's icon, from existing art.

Paine's 48x48 portrait (the first cell of img/portraits.png) is upscaled 10x
with nearest-neighbour (crisp pixels), centred on a 512x512 canvas with a soft
neon-pink glow behind it. electron-builder turns the PNG into the Windows .ico
and the macOS .icns.

    python3 tools/make_icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SIZE = 512
SCALE = 10  # 48 px -> 480 px

portrait = Image.open(ROOT / "img" / "portraits.png").convert("RGBA").crop((0, 0, 48, 48))
art = portrait.resize((48 * SCALE, 48 * SCALE), Image.NEAREST)
offset = (SIZE - art.width) // 2

# Neon glow: a pink rounded square, blurred, behind the portrait
glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ImageDraw.Draw(glow).rounded_rectangle(
    (offset - 4, offset - 4, offset + art.width + 4, offset + art.height + 4), radius=28, fill=(255, 47, 214, 200)
)
glow = glow.filter(ImageFilter.GaussianBlur(7))

icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
icon.alpha_composite(glow)
icon.alpha_composite(art, (offset, offset))

out = ROOT / "desktop" / "icon.png"
out.parent.mkdir(exist_ok=True)
icon.save(out, optimize=True)
print(f"wrote {out.relative_to(ROOT)} ({SIZE}x{SIZE})")
