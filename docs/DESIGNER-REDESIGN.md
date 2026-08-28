# The two editors — what was built, and what is still open

Design Maker (`web/components/app/design-maker.tsx`) and the order designer
(`DesignCanvasDialog` in `web/components/app/design-canvas.tsx`). Written 2026-08-27,
**rewritten 2026-08-28 after the work landed** — the first version of this file described a
plan, and two of its conclusions turned out to be wrong. Superseded parts are marked.

Research and the original function tables:
https://claude.ai/code/artifact/a89fcb0d-b687-4d60-b9b9-032b948e9a28

## 1. What was wrong

They were described as a full editor and its shortened version. They were not:
`DesignCanvasDialog` was 2,460 lines in one function against the Maker's 1,060, and they
carried **disjoint** feature sets. Only the Maker had print zone, DPI, layers, text, zoom.
Only the dialog had thread matching, files, buyer's file, board card, fee tier.

The consequence was a real defect, not an inconsistency: **the surface that places artwork on
lines the factory prints showed neither the printable area nor the resolution**, while the
one for speculative product templates showed both. `DesignStage` had accepted a `printZone`
since it was written and one of its two callers passed it; `layerDpi` was exported from
design-maker.tsx and imported by nothing.

## 2. What is shared now

| Module | What it owns |
|---|---|
| `components/app/artwork-panel.tsx` | sources, grid, browse-all, `ImageThumb`, `reloadToken` |
| `components/app/face-tile.tsx` | the garment tiles — a LIST of layers, not one artwork |
| `lib/stage-zoom.ts` | wheel zoom. A callback ref, because the dialog is portalled |
| `lib/print-zone.ts` | the printable rectangle, `outsideZone`, `fitToZone` |
| `lib/print-quality.ts` | `layerDpi`, `printedInches`, `dpiVerdict`, `useNaturalSizes` |

What still differs is the context panel, and that is correct: an order line and a product
template are different things.

## 3. Two conclusions from the first draft that were WRONG

**"Keep the order designer a dialog"** → then fullscreen → then a dialog again. The
reasoning that took it fullscreen was sound for the Maker and wrong for a window that opens
off one line while you work a queue. It is a bounded dialog, and the header/footer structure
the fullscreen pass introduced was kept.

**"Level the features — layers and text into the order editor"** is not a wiring job.
`postOrderDesign` takes a single `data` and `pos` PER SIDE. One artwork per face is the
SERVER's model, and design-canvas documents it as deliberate:

> an order line holds one artwork per face, and giving it a list to hold one item would be a
> worse model, not a more general one

Levelling that is a data-model change and needs its own piece of work.

## 4. Traps that cost time here

- **The print area is product-configured** (`printAreas[side]`, product editor › Print sides,
  stored in `catalog_products.data`). A product with none falls back to a hardcoded
  per-garment-type table calibrated against one bundled tee flat — so a wrong-looking box
  usually means *not set*, not broken.
- **`pos` is a percentage of a SQUARE stage.** The frame's aspect is not ours to change, and
  zoom must scale a WRAPPER — anything reaching `pos` silently resizes the print.
- **The dialog is portalled.** An effect reading `ref.current` on mount finds null and never
  runs again. That is why zoom uses a callback ref, and it is invisible on the Maker.
- **The dialog holds a SNAPSHOT of the line** (`editing` in the order list). A save plus a
  parent reload does not refresh it; the variant patch is merged locally.
- **`@theme` accepts custom properties only.** A comment inside it is a build error, and
  neither tsc nor eslint sees it — only loading the page does.

## 5. Still open

- **Layers / text on an order line** — the model change above.
- **The rail shape** on the marketing catalogue — raised, never specified.
- **Button variants**: measured at outline 211 · ghost 69 · secondary 12 · destructive 4, so
  only ~33% of buttons declare themselves the main action. Now that the fill is settled this
  is the next real sweep.
- **`bg-primary/10 text-primary`** survives in 8 places that are NOT selection (badges,
  speaker labels, step markers, a channel colour). Left deliberately — see the commit.
