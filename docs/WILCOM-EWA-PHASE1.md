# Digitizer — Phase 1 build spec (Wilcom EWA)

Turn the [Digitizer mockup](https://claude.ai/code/artifact/4cea47fa-60a3-47ee-a846-ba4241d5c326)
into the working **Synced orders** flow: buyer artwork → **Preview** (TrueView + stitch
count) → **Generate** (machine file) → attaches to the order. Maker + History follow.

Connection is proven (the `api/info` alphabet list came back). Credentials live in
Settings › Integrations (`WILCOM_APP_ID` / `WILCOM_APP_KEY`), read at call time.

## The API contract (from apiguide.wilcom.com)

REST, base `https://public.ewa.wilcomapps.com/`. POST form params `appId`, `appKey`,
`requestXml`. Response is XML, HTTP 200 on success; files come back base64.

**`api/bitmapArtDesign`** (Generate — raster → machine file) and **`api/bitmapArtTrueview`**
(Preview — raster → proof, no file). Request:

```xml
<xml>
  <bitmap file="art.png"/>                     <!-- references a <file> below. ATTR NAME UNCONFIRMED — verify on first live call -->
  <autodigitize_options width="100" height="100"/>  <!-- mm; omit → DPI sizes it; one given → aspect kept -->
  <output design_file="out.emb" trueview_file="out_tv.png" dpi="120"/>  <!-- design_file only for Design; trueview_file for both -->
  <files><file filename="art.png" filecontents="<base64>"/></files>
</xml>
```

Response:

```xml
<xml>
  <files>
    <file filename="out.emb" filecontents="<base64>"/>
    <file filename="out_tv.png" filecontents="<base64>"/>
  </files>
  <design_info num_stitches="12480" num_colours="4" num_trims="" num_objects=""
               num_colour_changes="" width="95.0" height="60.0" machine_name="..."/>
</xml>
```

- `<file>`: `filename` + `filecontents` (base64; attribute values XML-entity-encoded).
- `<design_info>`: `num_stitches`, `num_colours`, `num_trims`, `num_objects`,
  `num_colour_changes`, `width`/`height` (mm, double), `machine_name`; child `colorways` →
  `colorway` → `threads` → `thread` (the thread list).
- `<output>`: `design_file` (compulsory for Design), `trueview_file`, `design_version`
  (default e4.5; e4.5/e4.2/e4.1/e4.0/e3.x/e2 + 2025/2024 native — version applies to native
  .EMB only, not stitch formats like .DST), `dpi` (default 96, max 300). Filenames: only
  `0-9 a-z A-Z - _ space`.

**Limits (hard):** request ≤ 20 MB; auto-digitize input ≤ 2 MB, ≤ 5,000,000 px,
≤ 22,500 mm² (~150 mm²), ≤ 90 s. Validate + downscale before sending (reuse the canvas
downscale used elsewhere).

## Server (server/src/routes/wilcom.js — extends the existing client)

- `POST /api/wilcom/preview` — `{ image (dataURL), filename?, width?, height? }` →
  `bitmapArtTrueview` → `{ ok, trueview (base64 png), stitches, colours, width, height }`.
- `POST /api/wilcom/digitize` — same input + `{ format? }` → `bitmapArtDesign` →
  `{ ok, trueview, machineFile:{filename,base64,format}, stitches, colours, width, height }`.
- Shared `buildBitmapXml()` + a regex response parser (dependency-free, like the connection
  test: base64 has no `"`/`>`, so attribute regex is safe). Add `fast-xml-parser` only when
  the Maker's richer recipes land.
- Validate input against the limits above; 413 with a clear message if over.
- Persist each generation for History (below).

## Persistence — History tab

New table `wilcom_generations` (idempotent-at-load, like the other late tables):
`id, seller_id, order_id, line_id, source ('order'|'maker'), type ('auto'|'lettering'|'monogram'),
name, stitches, colours, width, height, formats text[], trueview_url, file_url, created_at`.
Store the TrueView PNG + machine file in R2 (via storage.js `putObject`, like seller_images) —
NOT base64 in Postgres. Order-attached files also go through `POST /api/design_files` so they
show on the order (the path CLAUDE.md notes the library upload isn't wired to — wire it here).

## Frontend (web/app/(app)/design or a new /digitizer surface)

Three tabs from the mockup: **Synced orders** (reuse `/api/design/order-uploads` for the
raw artwork list; Preview → `/api/wilcom/preview`, Generate → `/api/wilcom/digitize`; facts
appear only after Preview), **Maker** (lettering/monogram — Phase 2), **History** (from
`wilcom_generations`, table, searchable). Both list tabs get the search box.

## Build order

1. **Server**: preview + digitize endpoints + validation + regex parse. Boot-test. ← start here
2. **Confirm** the `<bitmap>` attribute name on a real call (only unknown left); fix if wrong.
3. **Persist** generations to R2 + `wilcom_generations`; attach order files via design_files.
4. **Frontend** Synced-orders tab wired to the endpoints (facts-after-preview).
5. **History** tab + search. 6. **Maker** (lettering) = Phase 2.

## Open items

- `<bitmap>` element's file-reference attribute (`file`? `filename`?) — confirm on first live call.
- Thread recolour (`autodigitize_options > threads > thread`) → map to DEFAULT_THREAD_PALETTE — Phase 2.
