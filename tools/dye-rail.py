"""
DYE THE RAIL — one photograph per garment, every colourway we sell.

At 11 credits a generated colour, the 41 colourways of a Gildan 18000 cost ~450 credits and
the 47 of an 18500 another ~520. Dyed in the file they cost nothing, and they are BETTER: a
generated recolour is a new roll of the dice that can drift the fold, the hanger or the hem,
while a dye moves colour and touches nothing else, so every colourway of a garment is provably
the same garment.

THE METHOD IS A DYE, NOT A PAINT. Real dyed cloth keeps its own shading — folds, weave and
fold shadows are luminance structure belonging to the garment, not to the colour. So L* is
preserved and merely re-centred on the target, its contrast scaled so a dark dye does not
crush the folds flat. Chroma is set from the target and rolled off in shadow, because cloth
desaturates where light does not reach; holding chroma flat through the shadows is exactly
what makes a recolour read as a fill tool.

THE HANGER IS NOT CLOTH. A cut-out holds two materials and only one of them is dyed — a navy
hanger is the single most obvious tell that a colourway was faked. Wood is separated by CHROMA
AND POSITION TOGETHER, never either alone: by chroma alone a warm bone garment is nearly as
orange as pale wood, and by position alone a hoodie's hood sits at exactly the hanger's height
(the confusion that scaled a tee into a 7055px canvas earlier the same day).

Colours come from lib/color-swatch.ts — the same table the catalogue chips read — so a rail
garment and its colour chip can never disagree about what "Navy" looks like.
"""
import numpy as np, json, sys
from PIL import Image

_src = open('/Users/linhphan/Downloads/claude/tools/normalise-objects.py').read()
_ns = {}
exec(_src[_src.index('def srgb_to_lab'):_src.index('def body(')], {'np': np}, _ns)
to_lab, to_rgb = _ns['srgb_to_lab'], _ns['lab_to_srgb']

CAN_W, CAN_H, TOP = 1050, 1500, 0.012
TARGET_H = round(CAN_H * (1 - TOP - 0.02))


def prep(path, rel=1.0):
    """Crop the photographed hook, align by the hanger, scale to a shared garment length."""
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    a = im.split()[3].load()
    cover = [sum(1 for x in range(0, W, 2) if a[x, y] > 40) * 2 for y in range(H)]
    hookEnd = next(y for y in range(H) if cover[y] > W * 0.045)
    body = im.crop((0, hookEnd, W, H))
    bb = body.split()[3].point(lambda v: 255 if v > 8 else 0).getbbox()
    g = body.crop(bb)
    s = (TARGET_H * rel) / g.size[1]
    g = g.resize((round(g.size[0] * s), round(g.size[1] * s)), Image.LANCZOS)
    ga = g.split()[3].load()
    hx = [x for x in range(g.size[0]) if any(ga[x, y] > 120 for y in range(min(14, g.size[1])))]
    mid = (hx[0] + hx[-1]) // 2 if hx else g.size[0] // 2
    out = Image.new('RGBA', (CAN_W, CAN_H), (0, 0, 0, 0))
    out.paste(g, (CAN_W // 2 - mid, round(CAN_H * TOP)))
    return out


def wood_mask(arr, lab):
    a = arr[..., 3]
    C = np.hypot(lab[..., 1], lab[..., 2])
    warm = lab[..., 2] > lab[..., 1] * 0.8
    g = a > 200
    rows = np.where(g.any(1))[0]
    band = g.copy()
    band[rows[0] + int((rows[-1] - rows[0]) * 0.22):] = False
    return band & (C > np.median(C[g]) * 1.9) & warm


def dye(im, hex_target):
    arr = np.array(im).astype(np.float64)
    a = arr[..., 3]
    lab = to_lab(arr[..., :3])
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]

    g = a > 200
    wood = wood_mask(arr, lab)
    cloth = (a > 8) & ~wood

    t = np.array([[[int(hex_target[i:i + 2], 16) for i in (1, 3, 5)]]], dtype=np.float64)
    tL, tA, tB = to_lab(t)[0, 0]

    ref = g & ~wood
    mL = L[ref].mean()
    k = max(0.55, min(1.25, tL / max(mL, 1)))
    Ln = tL + (L - mL) * k

    lo, hi = np.percentile(L[ref], 4), np.percentile(L[ref], 96)
    roll = 0.55 + 0.45 * np.clip((L - lo) / max(hi - lo, 1), 0, 1)
    rgb = to_rgb(np.stack([np.clip(Ln, 0, 100), tA * roll, tB * roll], -1))

    out = arr.copy()
    out[..., :3] = np.where(cloth[..., None], rgb, arr[..., :3])
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA')


if __name__ == '__main__':
    GARMENTS = {
        'hoodie': ('/tmp/objs/hood-side.png', 1.00),
        'crew':   ('/tmp/objs/crew-side.png', 0.99),
        'tee':    ('/tmp/objs/side-lit.png',  0.97),
    }
    COLOURS = json.load(open('/tmp/objs/colours.json'))
    OUT = '/Users/linhphan/Downloads/claude/web/public/frames'
    for form, (path, rel) in GARMENTS.items():
        base = prep(path, rel)
        for slug, hexv in COLOURS.items():
            im = dye(base, hexv)
            # 820px is twice the tallest height the rail renders; WebP because these are
            # photographs with alpha, the case PNG handles worst. 21MB of PNG became 2MB.
            w = round(im.size[0] * 820 / im.size[1])
            im.resize((w, 820), Image.LANCZOS).save(f'{OUT}/rail-{form}-{slug}.webp', 'WEBP', quality=88, method=6)
        print(f'{form:7s} {len(COLOURS)} colourways')
