#!/usr/bin/env python3
"""
ONE MARK, EVERY PLACE IT IS AN ICON — regenerated from a single master file.

    python3 tools/make-brand-icons.py

The master is `brand/egful-e-512.png`: the black `e` on periwinkle #C0C4FF that the site
already serves as its favicon (Settings > Branding, /api/branding/favicon). It was living
ONLY in the database, so the browser tab wore it and the two installable surfaces — the
Chrome extension and the phone — still wore the older cream `eg` tile. This script is how
they are kept in step: change the master, run this, commit what it writes.

What it writes, and why each is shaped differently:

  extension/icons/icon-{16,32,48,128}.png   full-bleed square. Chrome draws the toolbar
                                            icon as given and rounds nothing.
  mobile/assets/icon.png                    1024 full-bleed, NO alpha and NO baked corners.
                                            iOS applies its own mask; corners drawn into the
                                            file get rounded a second time.
  mobile/assets/adaptive-icon.png           1024, the GLYPH ALONE on transparent at 60%.
                                            Android crops an adaptive foreground to a circle
                                            or squircle and only the inner ~66% is safe, so a
                                            full-bleed square loses its edges. The ground is
                                            android.adaptiveIcon.backgroundColor in app.json,
                                            which is why that is the periwinkle and not white.

NOT written: mobile/assets/notification-icon.png (Android wants a white-on-transparent
silhouette that it tints itself — a different drawing, not this one scaled) or splash-mark.png.
Changing either is a deliberate choice, not a consequence of changing the icon.
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, "brand", "egful-e-512.png")
GROUND = (192, 196, 255)          # #C0C4FF — the ground the master is painted on

def out(*parts):
    p = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p

src = Image.open(MASTER).convert("RGB")

# ── the extension: full-bleed, small ─────────────────────────────────────────
for s in (16, 32, 48, 128):
    src.resize((s, s), Image.LANCZOS).save(out("extension", "icons", f"icon-{s}.png"))

# ── iOS / Expo: 1024 full-bleed, flattened onto the ground so there is no alpha ──
big = src.resize((1024, 1024), Image.LANCZOS)
flat = Image.new("RGB", (1024, 1024), GROUND)
flat.paste(big, (0, 0))
flat.save(out("mobile", "assets", "icon.png"))

# ── Android adaptive foreground: the glyph alone, inside the safe zone ────────
# Alpha from HOW FAR each pixel is from the ground towards the ink, not a threshold. A
# binary key leaves the anti-aliased rim either fully on or fully off, and on a home screen
# at 192dp that reads as a jagged letter. The counter inside the `e` goes transparent with
# everything else, which is right: Android paints the ground behind it, exactly as the
# master has it.
ink = (18, 18, 18)
lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
lo, hi = lum(ink), lum(GROUND)
rgba = Image.new("RGBA", src.size, (0, 0, 0, 0))
sp, dp = src.load(), rgba.load()
for y in range(src.height):
    for x in range(src.width):
        v = lum(sp[x, y])
        a = (hi - v) / (hi - lo)              # 1 at ink, 0 at ground
        a = 0.0 if a < 0 else (1.0 if a > 1 else a)
        if a > 0:
            dp[x, y] = (ink[0], ink[1], ink[2], int(round(a * 255)))
glyph = rgba.crop(rgba.getbbox())
side = int(1024 * 0.60)                        # inside Android's ~66% safe circle
w, h = glyph.size
scale = side / max(w, h)
glyph = glyph.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
canvas.paste(glyph, ((1024 - glyph.width) // 2, (1024 - glyph.height) // 2), glyph)
canvas.save(out("mobile", "assets", "adaptive-icon.png"))

print("wrote extension/icons/icon-{16,32,48,128}.png")
print("wrote mobile/assets/icon.png            (1024, no alpha)")
print("wrote mobile/assets/adaptive-icon.png   (1024, glyph on transparent)")
print("android.adaptiveIcon.backgroundColor must be #%02X%02X%02X" % GROUND)
