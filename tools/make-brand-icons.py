#!/usr/bin/env python3
"""
ONE MARK, EVERY PLACE IT IS AN ICON — regenerated from a single master file.

    python3 tools/make-brand-icons.py

The master is `brand/egful-e-512.png`: the black `e` on periwinkle #C0C4FF that the site
already serves as its favicon (Settings > Branding, /api/branding/favicon). It was living
ONLY in the database, so the browser tab wore it and the two installable surfaces — the
Chrome extension and the phone — still wore the older cream `eg` tile. This script is how
they are kept in step: change the master, run this, commit what it writes.

THE MASTER IS THE DRAWING; THIS FILE OWNS THE COLOURS (2026-09-14). The master is read for
its SHAPE only — every pixel's distance from the ground towards the ink becomes an alpha
mask, and each output is painted fresh from that mask in `INK` and `GROUND` below. So a
palette change is two constants here and a re-run, and the master is never repainted or
lost. It also means the master's own #C0C4FF is now only a source encoding, which is why
`SRC_*` and the output pair are named apart.

WHY PAPER ON PERIWINKLE. `hue.base` #6B7CFF is the app's IDENTITY colour — mobile/lib/theme.ts
reserves it for large fills, and an app icon is the largest fill the brand has. The icon and
the app that opens from it are now the same purple; they were not before, because the ground
was #C0C4FF, which is the MARKETING periwinkle from the web kit. The glyph is knocked out in
`canvas` #FBFAF7, the same warm paper the app's pages are, rather than white.

  A solid colour tile is also what makes an icon findable on a crowded home screen, which is
  the reason the ground carries the colour and the letter carries the paper, and not the
  reverse. Black-on-pale read as a placeholder at 60dp.

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
                                            which is why that must equal GROUND below.
  brand/egful-e-512-app.png                 the same mark at the master's size, in the new
                                            colours, for uploading at Settings > Branding.
                                            THE BROWSER TAB IS SERVED FROM THE DATABASE, not
                                            from this repo, so it is the one surface a script
                                            cannot keep in step — this file is what a person
                                            uploads to close that gap by hand.

NOT written: mobile/assets/notification-icon.png (Android wants a white-on-transparent
silhouette that it tints itself — a different drawing, not this one scaled) or splash-mark.png.
Changing either is a deliberate choice, not a consequence of changing the icon.
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, "brand", "egful-e-512.png")

# How the master is PAINTED — read only, to recover the glyph's alpha from it.
SRC_GROUND = (192, 196, 255)      # #C0C4FF
SRC_INK = (18, 18, 18)

# What every output is painted IN. Both come from mobile/lib/theme.ts.
GROUND = (0x6B, 0x7C, 0xFF)       # #6B7CFF — hue.base, the identity colour
INK = (0xFB, 0xFA, 0xF7)          # #FBFAF7 — canvas, the app's warm paper


def out(*parts):
    p = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


src = Image.open(MASTER).convert("RGB")

# ── the glyph's alpha, once ──────────────────────────────────────────────────
# Alpha from HOW FAR each pixel is from the ground towards the ink, not a threshold. A
# binary key leaves the anti-aliased rim either fully on or fully off, and on a home screen
# at 192dp that reads as a jagged letter. The counter inside the `e` stays transparent with
# everything else, which is right: the ground shows through it, exactly as the master has it.
lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
lo, hi = lum(SRC_INK), lum(SRC_GROUND)
alpha = Image.new("L", src.size, 0)
sp, ap = src.load(), alpha.load()
for y in range(src.height):
    for x in range(src.width):
        a = (hi - lum(sp[x, y])) / (hi - lo)
        ap[x, y] = int(round(min(1.0, max(0.0, a)) * 255))


def painted(size):
    """The mark at `size`, glyph in INK on a solid GROUND, no alpha."""
    layer = Image.new("RGBA", (size, size), INK + (0,))
    layer.putalpha(alpha.resize((size, size), Image.LANCZOS))
    flat = Image.new("RGB", (size, size), GROUND)
    flat.paste(layer, (0, 0), layer)
    return flat


# ── the extension: full-bleed, small ─────────────────────────────────────────
for s in (16, 32, 48, 128):
    painted(s).save(out("extension", "icons", f"icon-{s}.png"))

# ── iOS / Expo: 1024 full-bleed, flattened onto the ground so there is no alpha ──
painted(1024).save(out("mobile", "assets", "icon.png"))

# ── Settings > Branding: the favicon a person re-uploads by hand ─────────────
painted(src.width).save(out("brand", "egful-e-512-app.png"))

# ── Android adaptive foreground: the glyph alone, inside the safe zone ────────
glyph = Image.new("RGBA", src.size, INK + (0,))
glyph.putalpha(alpha)
glyph = glyph.crop(glyph.getbbox())
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
print("wrote brand/egful-e-512-app.png         (upload at Settings > Branding)")
print("android.adaptiveIcon.backgroundColor must be #%02X%02X%02X" % GROUND)
