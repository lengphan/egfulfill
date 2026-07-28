# Admin Guide / Hướng dẫn cho Quản trị

You have **full access** to every board, tool, and setting. This guide covers only what's **admin-only** — for the day-to-day boards, read the [Operator](operator.md) and [Warehouse](warehouse.md) guides, which apply to you in full.

---

## English

You see all factory boards (Dashboard, Orders, Board, Shipping, Inventory, Purchasing, Finance, Broadcasts, Digitizer) **plus** the seller tools (Products, Catalogue, Stores, Reports, SpyDeck, Design Lab, Developers). Admin-only powers:

### Broadcasts — send (`/broadcasts`)
Staff can draft; **only you can send** a seller email broadcast. Sending is opt-out-aware — respect the marketing opt-out.

### Settings — the admin console (`/settings`)
- **Platform** — factory-wide defaults (top-up amounts + minimum, pricing, fees, positions/design surfaces).
- **Users** — promote/demote staff (public signup only ever creates sellers), set daily limits.
- **Permissions** — hide nav pages/tabs per role. **Hide-only**: it can restrict, never expose a staff page to a seller.
- **Suppliers** — how purchase orders pay and ship.
- **Usage** — per-platform API call volume + estimated spend, with monthly **alert** thresholds (alerts only; nothing is throttled).
- **Site content** — the public marketing homepage copy.
- **Activity** — the audit log of who changed what.
- **Backups** — on-demand + nightly database backups to storage.
- **Integrations / API keys** — the platform's connected-service credentials (Stripe, suppliers, Wilcom, mail). Read at call time, so a key saved here applies on the next request.

### Finance — the money authority (`/finance`)
You (and Warehouse) own the ledger. **`POST` a wallet ledger entry is staff-only for a reason** — a seller must never be able to credit themselves. Team members resolve to their owner for balances.

### Cross-cutting rules you enforce
- **Never risk a connected account.** Nothing may suspend a seller's shop or destroy synced data. Sync must not overwrite what it didn't author. This outranks any feature.
- **Money is append-only and idempotent.** Charge on submit, refund on cancel; retries never double-count.
- **Sellers never learn their design was used by another seller** — cross-seller duplicate detection is factory-only.
- **Permissions are hide-only** — the visible set is always `hasCapability && !hidden`.

---

## Tiếng Việt

Bạn có **toàn quyền** với mọi bảng, công cụ và cài đặt. Hướng dẫn này chỉ nói về phần **chỉ dành cho quản trị** — với các bảng hằng ngày, hãy đọc hướng dẫn [Nhân viên vận hành](operator.md) và [Kho](warehouse.md), áp dụng đầy đủ cho bạn.

Bạn thấy tất cả bảng của nhà máy (Dashboard, Orders, Board, Shipping, Inventory, Purchasing, Finance, Broadcasts, Digitizer) **cùng** các công cụ của người bán (Products, Catalogue, Stores, Reports, SpyDeck, Design Lab, Developers). Quyền riêng của quản trị:

### Broadcasts — gửi (`/broadcasts`)
Nhân viên soạn được; **chỉ bạn mới gửi** email cho người bán. Khi gửi phải tôn trọng những người đã chọn không nhận tiếp thị (opt-out).

### Settings — bảng điều khiển quản trị (`/settings`)
- **Platform** — mặc định toàn nhà máy (mức nạp + tối thiểu, giá, phí, vị trí/bề mặt in).
- **Users** — nâng/hạ vai trò nhân viên (đăng ký công khai chỉ tạo người bán), đặt hạn mức hằng ngày.
- **Permissions** — ẩn trang/tab theo vai trò. **Chỉ ẩn**: có thể hạn chế, không bao giờ mở trang nhân viên cho người bán.
- **Suppliers** — cách đơn mua thanh toán và giao.
- **Usage** — lượng gọi API và ước tính chi phí theo nền tảng, có ngưỡng **cảnh báo** hằng tháng (chỉ cảnh báo, không chặn).
- **Site content** — nội dung trang chủ tiếp thị công khai.
- **Activity** — nhật ký ai đã thay đổi gì.
- **Backups** — sao lưu cơ sở dữ liệu theo yêu cầu + hằng đêm lên lưu trữ.
- **Integrations / API keys** — thông tin đăng nhập dịch vụ của nền tảng (Stripe, nhà cung cấp, Wilcom, email). Được đọc lúc gọi, nên khóa lưu ở đây áp dụng ngay lần yêu cầu sau.

### Finance — người nắm tiền (`/finance`)
Bạn (và Kho) nắm sổ cái. **Ghi một dòng sổ ví qua `POST` chỉ dành cho nhân viên có lý do** — người bán không bao giờ được tự cộng tiền cho mình. Thành viên nhóm quy về chủ tài khoản khi tính số dư.

### Nguyên tắc xuyên suốt bạn phải giữ
- **Không bao giờ gây rủi ro cho tài khoản đã kết nối.** Không được làm treo shop của người bán hay phá dữ liệu đã đồng bộ. Đồng bộ không được ghi đè thứ không do mình tạo. Điều này ưu tiên hơn mọi tính năng.
- **Tiền chỉ thêm và bất biến (idempotent).** Trừ khi gửi, hoàn khi hủy; thử lại không bao giờ tính hai lần.
- **Người bán không bao giờ biết thiết kế của họ được người bán khác dùng** — phát hiện trùng lặp giữa các người bán chỉ ở phía nhà máy.
- **Phân quyền chỉ để ẩn** — tập hiển thị luôn là `hasCapability && !hidden`.
