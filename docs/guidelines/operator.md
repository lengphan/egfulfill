# Operator Guide / Hướng dẫn cho Nhân viên vận hành

You work the production floor. **Your zone ends at the scan** — anything that moves money (refunds, wallet reverts, buying against the house account) belongs to Warehouse or Admin.

---

## English

### Dashboard (`/overview`)
The factory home board — today's workload across production, with counters that link to the queue that needs you.

### Orders (`/operator`)
The production hub — every order that's been pushed to the floor.
- Move a line through its stages (design → production → …). Your reach depends on where a line already is; the board blocks a move your role can't make.
- **Marketplace orders arrive with variants unset** — the factory's own picks pre-fill, others don't.
- **Shipping is an order-level claim**: a parcel can't go out half-made, so "shipped" is gated until every line is ready.
- Open an order to see its lines, artwork, and status.

### Board (`/designer`)
The design/artwork board (read + work the cards that concern production). Claim a card, follow its status; design approval is a designer/admin step.

### Shipping (`/shipping`)
Two tabs: **Dispatch** (today's out-queue, emptied by evening) and **Shipments** (the parcel archive).
- Buy labels through the aggregator (Shippo) — never the USPS-direct path.

### Inventory (`/inventory`)
Two tabs: **Stock** (levels on hand) and **Scan** (the stock in/out station).
- On the Scan station you can **read**, but **writing stock is a Warehouse action** — the station enforces this.
- Stock is held against the **blank** SKU, not the marketplace listing SKU.

### Purchasing (`/purchasing`)
**Suppliers** (browse S&S / Otto) + **Purchase** (cart / on-order / history). You can build draft purchase orders; **placing an order with a supplier is a human click that belongs to Warehouse/Admin.**

### Broadcasts (`/broadcasts`)
Seller email broadcasts. You can **draft**, but **only an admin can send** — the send button won't be there for you.

### Digitizer (`/digitizer`)
The Wilcom embroidery workspace — drop artwork + text, arrange the layers, and export a machine file (`.emb`) or a PNG preview.

### Tools you can also use
- **SpyDeck** — competitor research. **Products** — the catalogue + blanks. **Catalogue** (`/published-catalog`) — the outward shop window. **Design Lab** — the artwork workspace.

### Shared
- **Chat**, **Help**, **Notifications**, **Settings** (your profile + the parts your role is allowed).

### Boundaries — do NOT
- Reverse a shipped/charged step, refund, or touch a wallet balance — that's Warehouse/Admin.
- Place a live supplier order, or write stock at the Scan station.

---

## Tiếng Việt

Bạn làm ở khâu sản xuất. **Phạm vi của bạn kết thúc ở bước quét (scan)** — mọi thứ liên quan đến tiền (hoàn tiền, đảo ví, chi từ tài khoản nhà máy) thuộc về Kho (Warehouse) hoặc Quản trị (Admin).

### Dashboard — Trang chủ (`/overview`)
Bảng điều khiển của nhà máy — khối lượng công việc hôm nay, các số liệu bấm vào dẫn đến việc cần làm.

### Orders — Đơn hàng (`/operator`)
Trung tâm sản xuất — mọi đơn đã được đẩy xuống xưởng.
- Chuyển từng dòng qua các giai đoạn (thiết kế → sản xuất → …). Bạn tới đâu tùy vào dòng đang ở đâu; bảng sẽ chặn thao tác vượt quyền của bạn.
- **Đơn từ sàn về chưa có biến thể** — chỉ các lựa chọn do chính nhà máy đặt mới điền sẵn.
- **"Đã giao" là trạng thái ở cấp đơn**: kiện hàng không thể đi khi chưa làm xong, nên trạng thái "shipped" bị khóa cho đến khi mọi dòng sẵn sàng.
- Mở một đơn để xem các dòng, hình thiết kế và trạng thái.

### Board — Bảng thiết kế (`/designer`)
Bảng thiết kế/artwork (xem và xử lý các thẻ liên quan sản xuất). Nhận thẻ, theo dõi trạng thái; duyệt thiết kế là bước của Thiết kế/Quản trị.

### Shipping — Giao hàng (`/shipping`)
Hai tab: **Dispatch** (hàng cần đi hôm nay, dọn sạch trong ngày) và **Shipments** (kho lưu kiện hàng).
- Mua tem qua nhà tổng hợp (Shippo) — không dùng đường USPS trực tiếp.

### Inventory — Tồn kho (`/inventory`)
Hai tab: **Stock** (số lượng tồn) và **Scan** (trạm nhập/xuất kho).
- Ở trạm Scan bạn **xem được**, nhưng **ghi kho là thao tác của Kho** — trạm sẽ chặn.
- Tồn kho tính theo mã **blank**, không phải mã listing của sàn.

### Purchasing — Mua hàng (`/purchasing`)
**Suppliers** (duyệt S&S / Otto) + **Purchase** (giỏ / đang đặt / lịch sử). Bạn có thể tạo đơn mua **nháp**; **đặt hàng thật với nhà cung cấp là thao tác của Kho/Quản trị.**

### Broadcasts — Gửi email (`/broadcasts`)
Email gửi cho người bán. Bạn có thể **soạn**, nhưng **chỉ admin mới gửi được** — nút gửi sẽ không hiện với bạn.

### Digitizer — Số hóa thêu (`/digitizer`)
Xưởng thêu Wilcom — thả ảnh + chữ, sắp xếp các lớp, xuất tệp máy (`.emb`) hoặc ảnh PNG xem trước.

### Công cụ bạn cũng dùng được
- **SpyDeck** — nghiên cứu đối thủ. **Products** — danh mục + blank. **Catalogue** (`/published-catalog`) — cửa sổ bán ra ngoài. **Design Lab** — xưởng thiết kế.

### Dùng chung
- **Chat**, **Help**, **Notifications**, **Settings** (hồ sơ của bạn + phần vai trò được phép).

### Ranh giới — KHÔNG được
- Đảo ngược bước đã giao/đã trừ tiền, hoàn tiền, hay động vào số dư ví — đó là việc của Kho/Quản trị.
- Đặt đơn mua thật với nhà cung cấp, hay ghi kho ở trạm Scan.
