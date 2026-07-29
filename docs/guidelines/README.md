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

The guides reference images in [`images/`](images/). To fill them with real screenshots of **your** app, run the capture script once per account:

```bash
# get your login token: DevTools → Application → Local Storage → eg_token
EG_TOKEN=<your-seller-token> EG_ROLE=seller node docs/guidelines/capture-screenshots.mjs
EG_TOKEN=<your-admin-token>  EG_ROLE=admin  node docs/guidelines/capture-screenshots.mjs
```

Set `BASE_URL=https://app.egful.store` to capture the live app instead of localhost. A few pop-up screens (the Import dialog, the Pick-a-blank picker, the Top-up modal) aren't standalone pages — capture those by hand and save them as `images/import-dialog.png`, `images/variant-picker.png`, `images/wallet-topup.png`.

> These docs live under `docs/` which Caddy keeps private (`@hidden`), so they are never served on the web.
