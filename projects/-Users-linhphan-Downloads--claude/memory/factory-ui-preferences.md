---
name: factory-ui-preferences
description: User's design-system preferences for factory boards (buttons, rows, header)
metadata:
  type: feedback
---

User's preferences for the factory boards (operator/warehouse/admin):
- Primary per-order action buttons (Flag/Label/Scan) should be **flat beige**, **no emoji/icons**, **one-word labels**. Implemented as a shared `.btn-beige` class (`#e9e6e0` light / `#33302c` dark, no border). Affirmative CTAs like green "Approve" stay green.
- Table row highlight should be subtle — active/selected row lightened to `#faf9f7` (from `#f6f5f4`).
- **operator.html is the canonical header layout.** Other boards should match it: control order search → `EN | VI` (plain inline, color-only `.lang-opt`, between search & theme) → theme → bell → New → profile, with `gap:11px` and `18px/2px` dividers.

**Why:** user explicitly likes operator's cleaner, more breathable header and wants beige flat buttons over dark/outlined ones.
**How to apply:** when adding/editing factory-board buttons or headers, follow these tokens. See [[purchases-sync-architecture]] for the purchases data flow.
