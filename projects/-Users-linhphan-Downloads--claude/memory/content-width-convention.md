---
name: content-width-convention
description: Centered content-column max-widths used across EGFULFILL pages (seller vs settings)
metadata:
  type: project
---

EGFULFILL pages use centered content columns (`max-width:Npx;margin:0 auto;width:100%`) on the main content wrapper inside the `margin-left:220px` area, so content doesn't stretch edge-to-edge on wide screens.

- **Seller app pages → 1600px**: seller, orders, analytics, wallet, design-lab, products-dash, chat (bumped from 1400 — user wanted them stretched wider). design-maker keeps its own 1400px; apidocs self-centers via `.api-layout`.
- **Settings → 1040px** (narrower on purpose): settings.html, plus the `#section-settings` block in operator/warehouse/admin.

**Why:** user found full-width content "clogged"; settings should be tighter than general pages.
**How to apply:** add `max-width:…;margin:0 auto;width:100%` to the existing content padding `<div>` right after `</header>`; don't introduce a new wrapper.
