# Designer redesign — research and plan

Design Maker (`web/components/app/design-maker.tsx`) and the mini designer
(`DesignCanvasDialog` in `web/components/app/design-canvas.tsx`). Written 2026-08-27
against commit `dc98265b`. Nothing here is built — this is the plan and the function
table the redesign mandate requires *before* drawing.

Full write-up, with the reference research and both function tables:
https://claude.ai/code/artifact/a89fcb0d-b687-4d60-b9b9-032b948e9a28

## 1. The headline

They are described as a full editor and its shortened version. They are not.

| | lines | shape |
|---|---|---|
| `DesignMaker` — the "full" one | 1,060 | full-screen route, three columns |
| `DesignCanvasDialog` — the "mini" one | 2,460, one function | dialog, two columns |

The short one is 2.3× the long one. They are not full-and-short; they are two disjoint
halves. They share exactly four imports: `DesignStage`, `readImageFile`,
`useBackgroundRemoval`, `Pos`/`DEFAULT_POS`.

Only the Maker has: print zone, DPI meter, multi-layer, text layers, zoom, layer list, publish.
Only the dialog has: thread match, files-on-line, buyer's file, board card, send-to-designer,
partner push, fee tier, apply-to-all, seller's own mockup.

## 2. Three defects, verified in source

1. **The order dialog draws no print zone.** `DesignStage` accepts `printZone`;
   `design-maker.tsx:1182` passes it, `design-canvas.tsx` never does. The surface that
   places artwork on lines the factory prints cannot show the printable area.
2. **The order dialog computes no resolution.** `layerDpi` and `dpiVerdict` are exported
   from `design-maker.tsx` and imported by **nothing**. A 600px buyer upload can be placed
   across a 14" front print and saved silently.
3. **The dialog's right rail is twelve stacked panels**, ~900 lines of JSX in one 380px
   column, all on screen at once.

Also live: the Maker's tool-rail buttons use `rounded-xl` → `--radius` (26px) on a ~48px
box, so they render as circles, which the primitive rules forbid.

## 3. The earlier prototype

Recovered from the `Mapper.dc.html` artboard of the *EGFUL Product Screens* artifact.
It draws a **mapper** — one artwork, eight blanks, per-blank live toggles, "5 of 8 products
live / Publish changes" — not an editor. That is the publish flow (Printful/Fourthwall's
model) and we don't have it; worth building **separately**. Its skin (DM Sans, `#ff5a00`,
cool zinc) predates `workshop` and is superseded.

Take three ideas from it, discard the skin: DPI and physical size stated as fact; the
method constraint explained at the point of decision ("embroidery caps at 12 thread
colours, this uses 19"); cost visible while editing.

## 4. Reference — Fourthwall

- Faces are **silhouettes each carrying their own artwork**, all visible at once.
- Properties come to the **selection as a floating bar**; there is no right properties rail.
- Physical size and DPI are printed **inside the print zone**, on the garment.
- Cost is live under the stage.

## 5. The proposal — one room, two contexts

One editor shell, opened from two places; only the context panel differs.

```
[ faces ]  [        stage        ]  [ context drawer ]
 silhouette  print zone always drawn   one tab at a time
 per side,   size + DPI inside it      order: Design·Threads·Files·Board
 own art     layers, text, zoom        product: Blank·Artwork·Text
             selection property bar
```

The dialog **stays a dialog** — it opens from a row inside a 700-row queue and a
full-screen route loses your place.

## 6. Sequence

- **A** Close the two defects — pass `printZone`, lift the DPI helpers into `lib/` and call
  them from the dialog. Small, and the part with real production consequence.
- **B** The selection property bar, adopted by both. Load-bearing: without it the rail
  cannot empty.
- **C** The faces column — replaces two different side-switchers with one.
- **D** The context drawer — twelve panels become four tabs; the Maker's rail and
  properties panel merge into three.
- **E** Level the feature sets — threads into the Maker; layers/text/zoom onto an order line.
- **F** The Mapper, scoped separately.

## 7. Constraints on this path

- `rounded-xl`+ all resolve to 26px. Controls take `--radius-control` (10px), badges 8px,
  `rounded-full` is count badges and avatars only.
- No prose under a control. The drawer and property bar are where subtitles breed.
- Import `tab-bar` / `dropzone` / `empty-state` / `region`; never hand-roll a bar.
- Never name the supplier — the Blank tab prints product name and SKU, nothing else.
- Incremental loading in the Artwork grid is a CLICK, never an effect watching list length
  (CLAUDE.md §2.8).
- Draw on the real pages at localhost. A drawing has six controls and these screens have
  forty — which is how the earlier prototype came to be drawn and never applied. The
  function tables are the floor.

## 8. Function tables

In the artifact linked above. Every control on both surfaces, each assigned one of three
fates — stays visible / moves elsewhere / collapses into a named menu — plus the four
capabilities the redraw adds. Nothing is deleted.
