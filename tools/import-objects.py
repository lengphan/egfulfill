"""
BRING A GENERATED CUT-OUT INTO THE APP — one framing for every object in the set.

The renders live outside the repo (the ploykit sandbox) at 4–5MB of PNG each, and every
shot puts its subject at a different fraction of its own canvas. Both are fatal to a set:
the megabytes because these load in the app header, and the framing because the band sizes
objects as a percentage of the BAND, so two objects given the same `h` would render at
wildly different apparent sizes — which is what makes a group read as a pile of unrelated
pictures rather than as a family.

So: trim to the alpha bounding box, re-pad onto an identical square at an identical
subject-to-canvas ratio, resize, and write webp. After this `h` in a layout means exactly
what it says. Same argument as tools/normalise-objects.py, which does this for the
marketing rail — kept separate because that one also re-bakes a contact shadow, and these
objects are lit from inside the band, not standing on a floor.
"""
from PIL import Image
import os, sys

SRC = os.path.expanduser("~/Downloads/ploykit/gen")
DST = "web/public/ploy/obj"
CANVAS = 640
FIT = 0.94          # subject's longest side against the canvas

def bring(stem, name):
    im = Image.open(f"{SRC}/{stem}-cut.png").convert("RGBA")
    box = im.getbbox()
    if not box:
        print(f"{name}: empty"); return
    im = im.crop(box)
    scale = (CANVAS * FIT) / max(im.size)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    sq = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    sq.paste(im, ((CANVAS - im.width) // 2, (CANVAS - im.height) // 2))
    out = f"{DST}/{name}.webp"
    sq.save(out, "WEBP", quality=90, method=6)
    print(f"{name:10} {im.size[0]:>3}x{im.size[1]:<3} -> {os.path.getsize(out)//1024:>4}KB")

PAIRS = [
    ("70-star", "star"), ("71-torus", "torus"), ("72-squiggle", "squiggle"), ("73-cloud", "cloud"),
    ("80-blob-peri", "blob-peri"), ("81-blob-lime", "blob-lime"), ("22-chrome", "chrome"),
    ("40-hoodie", "hoodie"), ("41-tee", "tee"), ("42-cap", "cap"), ("43-beanie", "beanie"),
    ("44-socks", "socks"), ("45-shorts", "shorts"), ("46-varsity", "varsity"), ("21-puffer", "puffer"),
]

os.makedirs(DST, exist_ok=True)
for stem, name in (PAIRS if len(sys.argv) == 1 else [p for p in PAIRS if p[1] in sys.argv[1:]]):
    if os.path.exists(f"{SRC}/{stem}-cut.png"):
        bring(stem, name)
    else:
        print(f"{name}: no {stem}-cut.png")
