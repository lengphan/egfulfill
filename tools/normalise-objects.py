"""
NORMALISE + RE-SHADOW — one framing and one light for every object in the field.

WHY THIS EXISTS. Every shot puts the garment at a different fraction of its own canvas
(measured: 54% to 77%). The scatter sizes objects as a percent of the CONTAINER, so two
objects set to the same `w` rendered at wildly different apparent sizes. That is what made
the field read as a pile of unrelated pictures rather than a set — not the colours.

So: trim each cut-out to its own alpha bounding box, then re-pad every one onto an identical
canvas at an identical garment-to-canvas ratio. After this, `w` in the scatter means exactly
what it says, and a form's apparent size is a DESIGN choice rather than an accident of how
the model happened to frame that particular shot.

THE SHADOW IS SYNTHESISED, NOT INHERITED. Background removal takes the baked contact shadow
with it — that is why a fresh cut-out lands weightless. Re-baking it here from the silhouette
means all twelve share one light, which is the other half of looking like a set, and it makes
the charcoal-hoodie failure structurally impossible: reach is now a constant, not a property
of whichever shot the model returned.

Parameters are derived from the family that was already on the page and measured to match it:
spread ~105% of the object's width, darkest composited pixel dropping the page luminance ~50%.
"""
from PIL import Image, ImageFilter
import glob, os, statistics

CANVAS   = 1024
FIT      = 0.76   # garment's longest side, as a fraction of the canvas
BASELINE = 0.86   # where the garment's BOTTOM sits. MUST exceed FIT, or a garment fitted to
                  # 0.76 of the canvas starts above its top edge and is silently clipped —
                  # which is exactly what the first contact sheet showed.
SPREAD   = 1.06   # shadow width against garment width
DEPTH    = 0.13   # shadow height against garment height
BLUR     = 24
PEAK     = 0.30
BG       = (243, 244, 245)   # --mk-surface, the page it lands on

def lum(c):
    f = lambda u: (u/255)/12.92 if u/255 <= .04045 else (((u/255)+.055)/1.055)**2.4
    return .2126*f(c[0]) + .7152*f(c[1]) + .0722*f(c[2])
LBG = lum(BG)

def strip_baked_shadow(im):
    """The two objects already on the page carry a baked shadow; below the garment's last
       opaque row there is nothing BUT shadow, so that is exactly what to clear."""
    W, H = im.size
    a = im.split()[3].load()
    rows = [y for y in range(H) if max(a[x, y] for x in range(0, W, 2)) > 200]
    if not rows:
        return im
    out = im.copy(); p = out.load()
    for y in range(rows[-1] + 3, H):
        for x in range(W):
            r, g, b, _ = p[x, y]; p[x, y] = (r, g, b, 0)
    return out

def normalise(path):
    im = Image.open(path).convert('RGBA')
    im = strip_baked_shadow(im)
    bb = im.split()[3].point(lambda v: 255 if v > 8 else 0).getbbox()
    g  = im.crop(bb)
    gw, gh = g.size
    s  = (CANVAS * FIT) / max(gw, gh)
    g  = g.resize((max(1, round(gw*s)), max(1, round(gh*s))), Image.LANCZOS)
    gw, gh = g.size

    out = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    ox  = (CANVAS - gw) // 2
    oy  = round(CANVAS * BASELINE) - gh

    # The contact shadow, from this object's own silhouette so it fits the form it belongs to.
    sil = g.split()[3].point(lambda v: 255 if v > 128 else 0)
    sw, sh = max(8, round(gw*SPREAD)), max(6, round(gh*DEPTH))
    pool = Image.new('L', (CANVAS, CANVAS), 0)
    pool.paste(sil.resize((sw, sh), Image.LANCZOS), (ox - (sw-gw)//2, oy + gh - round(sh*0.45)))
    pool = pool.filter(ImageFilter.GaussianBlur(BLUR)).point(lambda v: int(v*PEAK))
    shadow = Image.merge('RGBA', (Image.new('L', (CANVAS, CANVAS), 82),)*3 + (pool,))

    assert oy >= 0, f'{path}: garment would clip the top edge (oy={oy}); BASELINE must exceed FIT'
    out = Image.alpha_composite(shadow, Image.alpha_composite(out, _place(g, ox, oy)))
    return out

def _place(g, ox, oy):
    lay = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    lay.paste(g, (ox, oy))
    return lay

def report(name, im):
    p = im.load(); a = im.split()[3].load()
    rows = [y for y in range(CANVAS) if max(a[x, y] for x in range(0, CANVAS, 2)) > 200]
    cols = [x for x in range(CANVAS) if any(a[x, y] > 200 for y in range(0, CANVAS, 2))]
    gw = cols[-1]-cols[0]; hem = rows[-1]
    wide = 0; dark = 1
    for y in range(hem+1, CANVAS):
        e = [x for x in range(CANVAS) if a[x, y] > 10]
        if e: wide = max(wide, e[-1]-e[0])
        for x in range(0, CANVAS, 2):
            r, g_, b, al = p[x, y]
            if al > 3:
                f = al/255
                dark = min(dark, lum(tuple(round(c*f + z*(1-f)) for c, z in zip((r, g_, b), BG))))
    print(f"  {name:18s} garment {gw/CANVAS*100:4.1f}% of canvas   shadow spread {wide/gw*100:4.0f}%   drop {(LBG-dark)/LBG*100:4.1f}%")

print("normalised objects:")
for f in sorted(glob.glob('raw-*.png')):
    name = f[4:-4]
    im = normalise(f)
    im.save(f'obj-{name}.png')
    report(name, im)


# ─────────────────────────────────────────────────────────────────────────────────────────
# GRADE THE SET — pull each colour story to one colour, without flattening the cloth.
#
# The shoot returns garments that are individually right and collectively not a set: in the
# iris story the hoodie sat 17 points of lightness below the tee, and in charcoal the tee ran
# warm (+8 R−B) while the hoodie ran cool (−7). On a page whose premise is "one palette, many
# forms", that reads as twelve unrelated pictures — the same failure normalise() fixes for
# SIZE, in the other dimension.
#
# The correction is an OFFSET in CIELAB, not a repaint. Every garment pixel moves by the same
# delta, so weave, crease, fold shadow and the fleece's own variation survive intact. Chroma
# is matched fully because a garment being bluer or browner than its row is what reads as
# wrong; lightness is matched at STRENGTH_L, because a hoodie genuinely IS heavier cloth than
# a tee and grading that away makes the field look printed rather than photographed.
#
# The target is the story's MEDIAN, not the mean: with four objects one outlier drags a mean
# and the whole row moves to meet the object that was wrong.
#
# Run: python3 tools/normalise-objects.py   (expects raw-<form>-<story>.png cut-outs in cwd)
# ─────────────────────────────────────────────────────────────────────────────────────────
from PIL import Image
import numpy as np, statistics

FORMS = ['tee', 'crew', 'hoodie', 'cap']
STORIES = ['natural', 'charcoal', 'iris']
STRENGTH_L = 0.70   # lightness: partial, so cloth weight survives
STRENGTH_C = 1.00   # chroma: full, a row must be one colour

def srgb_to_lab(a):
    a = a.astype(np.float64)/255
    m = a <= 0.04045
    a = np.where(m, a/12.92, ((a+0.055)/1.055)**2.4)
    M = np.array([[.4124,.3576,.1805],[.2126,.7152,.0722],[.0193,.1192,.9505]])
    xyz = a @ M.T / np.array([.95047, 1.0, 1.08883])
    e, k = 216/24389, 24389/27
    f = np.where(xyz > e, np.cbrt(xyz), (k*xyz+16)/116)
    return np.stack([116*f[...,1]-16, 500*(f[...,0]-f[...,1]), 200*(f[...,1]-f[...,2])], -1)

def lab_to_srgb(lab):
    L, A, B = lab[...,0], lab[...,1], lab[...,2]
    fy = (L+16)/116; fx = fy + A/500; fz = fy - B/200
    e, k = 216/24389, 24389/27
    g = lambda t: np.where(t**3 > e, t**3, (116*t-16)/k)
    xyz = np.stack([g(fx), np.where(L > k*e, ((L+16)/116)**3, L/k), g(fz)], -1) * np.array([.95047,1.0,1.08883])
    M = np.array([[3.2406,-1.5372,-.4986],[-.9689,1.8758,.0415],[.0557,-.2040,1.0570]])
    r = xyz @ M.T
    r = np.clip(r, 0, None)
    r = np.where(r <= .0031308, r*12.92, 1.055*np.power(r, 1/2.4) - 0.055)
    return np.clip(r, 0, 1)*255

def body(im):
    """The garment's own colour — fully opaque pixels in the middle band, away from the
       collar, the folded edge and any antialiased rim."""
    a = np.array(im)
    W, H = im.size
    m = (a[...,3] > 250)
    m[:int(H*.28)] = False; m[int(H*.70):] = False
    m[:, :int(W*.34)] = False; m[:, int(W*.66):] = False
    return m

for story in STORIES:
    ims = {f: Image.open(f'obj-{f}-{story}.png').convert('RGBA') for f in FORMS}
    labs, masks = {}, {}
    for f, im in ims.items():
        arr = np.array(im)
        masks[f] = body(im)
        labs[f] = srgb_to_lab(arr[...,:3])
    means = {f: labs[f][masks[f]].mean(0) for f in FORMS}
    tgt = np.array([statistics.median(means[f][i] for f in FORMS) for i in range(3)])
    print(f"{story}: target L*{tgt[0]:.1f} a*{tgt[1]:+.1f} b*{tgt[2]:+.1f}")
    for f in FORMS:
        d = tgt - means[f]
        d[0] *= STRENGTH_L; d[1] *= STRENGTH_C; d[2] *= STRENGTH_C
        arr = np.array(ims[f]).astype(np.float64)
        opaque = arr[...,3] > 0
        lab = labs[f] + d                      # ONE offset for every pixel: texture survives
        rgb = lab_to_srgb(lab)
        arr[...,:3] = np.where(opaque[...,None], rgb, arr[...,:3])
        Image.fromarray(np.clip(arr,0,255).astype(np.uint8), 'RGBA').save(f'obj-{f}-{story}.png')
        print(f"   {f:7s} moved dL {d[0]:+5.1f}  da {d[1]:+5.1f}  db {d[2]:+5.1f}")
