"""Cut a blank off the studio sweep, shadow and all.

Two passes, because one is not enough. A chromaticity key drops the SWEEP (a shadow is the
sweep at lower luminance, so dividing luminance out folds it back into the ground) — but the
contact shadow is bluer than the paper, not just darker, so it survives as a blob under the
object. What actually separates it is CONNECTEDNESS: the shadow touches the frame edge and
the garment does not. So the second pass keeps only the component that isn't reachable from
the border.
"""
from PIL import Image, ImageFilter
from scipy import ndimage
import numpy as np, sys, os

SCR = os.path.dirname(os.path.abspath(__file__))

def cut(name, loose=0.055):
    im = Image.open(f"web/public/ploy/blank/{name}.webp").convert("RGB")
    a = np.asarray(im).astype(np.float32)
    c = a / (a.sum(axis=-1, keepdims=True) + 1e-6)
    corners = np.concatenate([c[:12,:12].reshape(-1,3), c[:12,-12:].reshape(-1,3),
                              c[-12:,:12].reshape(-1,3), c[-12:,-12:].reshape(-1,3)])
    bg = np.median(corners, axis=0)
    d = np.sqrt(((c - bg) ** 2).sum(axis=2))

    # Everything that could be ground, generously — this includes the shadow.
    groundish = d < loose
    # The ground is what the border reaches. A garment does not touch the frame.
    lab, n = ndimage.label(groundish)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:,0], lab[:,-1]]))) - {0}
    ground = np.isin(lab, list(border))
    # ONE OBJECT, and only the holes that are actually pinholes.
    #
    # binary_fill_holes filled the gap between a model's legs and called it garment, and the
    # largest-component test is what removes a cap's shadow: that shadow floats free of the
    # frame edge, so "not reachable from the border" wrongly promoted it to foreground.
    obj = ~ground
    lab2, n2 = ndimage.label(obj)
    if n2:
        sizes = ndimage.sum(obj, lab2, range(1, n2 + 1))
        obj = lab2 == (int(np.argmax(sizes)) + 1)
    holes = ndimage.binary_fill_holes(obj) & ~obj
    hlab, hn = ndimage.label(holes)
    if hn:
        hsz = ndimage.sum(holes, hlab, range(1, hn + 1))
        small = {i + 1 for i, sz in enumerate(hsz) if sz < obj.sum() * 0.004}
        obj = obj | np.isin(hlab, list(small))
    # Soft edge from the chroma distance, but only inside the object.
    alpha = np.clip((d - 0.012) / 0.030, 0, 1) * obj
    m = Image.fromarray((alpha*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    out = im.copy(); out.putalpha(m)
    out = out.crop(out.getbbox())
    side = max(out.size)
    sq = Image.new("RGBA", (side, side), (0,0,0,0))
    sq.paste(out, ((side-out.width)//2, (side-out.height)//2))
    sq.thumbnail((760,760), Image.LANCZOS)
    sq.save(f"{SCR}/cut-{name}.webp", "WEBP", quality=92, method=6)
    print(f"{name:9} covers {(np.asarray(sq)[...,3] > 8).mean()*100:5.1f}%")

for n in sys.argv[1:]:
    cut(n)
