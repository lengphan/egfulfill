# EGFULFILL — How-to Guides

Step-by-step guidance for using each page, organised by role. **English and Vietnamese are separate** — pick your language folder.

Hướng dẫn từng bước cho mỗi trang, theo vai trò. **Tiếng Anh và Tiếng Việt để riêng** — chọn thư mục ngôn ngữ của bạn.

| Role | English | Tiếng Việt |
|---|---|---|
| Seller / Người bán | [en/seller.md](en/seller.md) | [vi/seller.md](vi/seller.md) |
| Operator / Nhân viên vận hành | [en/operator.md](en/operator.md) | [vi/operator.md](vi/operator.md) |
| Warehouse / Kho | [en/warehouse.md](en/warehouse.md) | [vi/warehouse.md](vi/warehouse.md) |
| Designer / Thiết kế | [en/designer.md](en/designer.md) | [vi/designer.md](vi/designer.md) |
| Admin / Quản trị | [en/admin.md](en/admin.md) | [vi/admin.md](vi/admin.md) |

## Screenshots

The guides reference images in [`images/`](images/). To fill them with real screenshots of **your** app, run the capture tool **on your Mac** (not the server — it's headless and has no browser), against the live app.

```bash
# 1. Sign in to app.egful.store, then: DevTools → Application → Local Storage → copy eg_token
# 2. In a terminal, from the repo:
cd docs/guidelines
npm install     # one-time: pulls puppeteer + a bundled Chrome (~large download, local only)

# 3. Capture. Run once per account so both seller-only and staff-only pages are covered:
EG_TOKEN=<seller-token> EG_ROLE=seller BASE_URL=https://app.egful.store npm run capture
EG_TOKEN=<admin-token>  EG_ROLE=admin  BASE_URL=https://app.egful.store npm run capture
```

(Drop `BASE_URL=…` to capture `http://localhost:3000` instead, if you're running the app locally.)

A few pop-up screens — the **Import dialog**, the **Pick-a-blank** picker, the **Top-up** modal — aren't standalone pages, so capture those by hand and save them as `images/import-dialog.png`, `images/variant-picker.png`, `images/wallet-topup.png`.

> These docs live under `docs/` which Caddy keeps private (`@hidden`), so they are never served on the web.
