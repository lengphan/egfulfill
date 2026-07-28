# Warehouse Guide / Hướng dẫn cho Kho

You do everything an operator does **plus custody and money**: writing stock, buying labels, placing supplier orders, and Finance. With that comes the responsibility to keep the ledger honest.

---

## English

Everything in the **[Operator guide](operator.md)** applies to you too. What's **extra** for Warehouse:

### Finance (`/finance`)
Two tabs: **Wallet** (house balances + every transaction) and **Partner costs** (what byeastside / Pink Design / carriers / suppliers are owed).
- The wallet ledger is **append-only** — balance is the sum of every entry. You don't edit history; you add a correcting entry.
- Costs are booked **as they're incurred** (a label's postage, a purchase order's total), and reversed on cancel.

### Inventory → Scan (write) (`/inventory`)
Unlike an operator (read-only at the station), **you can write stock in and out** at the Scan station. Stock is held against the **blank** SKU (strip the print-method suffix like `-EMB` / `-DTG`).

### Purchasing → place orders (`/purchasing`)
You can take a draft PO and **actually place it** with S&S / Otto. Supplier ordering is double-gated off by default until it's live — confirm the payload before committing real money.

### Shipping → buy + void labels (`/shipping`)
Buy labels (through Shippo) and handle refunds/voids. A USPS credit-card error means the request wrongly took the USPS-direct path — it should always go through the aggregator.

### Developers (`/developers`)
Available to you for **connection testing** (verifying an integration works), not for minting seller-facing production keys.

### Boundaries
- You may reverse wallet-affecting steps — but every reversal must leave the ledger balanced. Never destroy a synced order or anything a connected shop owns.
- **Sending** seller broadcasts and **platform settings / user roles / permissions** stay with Admin.

---

## Tiếng Việt

Bạn làm mọi việc như nhân viên vận hành **cộng thêm phần giữ hàng và tiền**: ghi kho, mua tem, đặt hàng nhà cung cấp, và Tài chính. Kèm theo đó là trách nhiệm giữ sổ cái trung thực.

Tất cả trong **[Hướng dẫn Nhân viên vận hành](operator.md)** cũng áp dụng cho bạn. Phần **thêm** cho Kho:

### Finance — Tài chính (`/finance`)
Hai tab: **Wallet** (số dư nhà máy + mọi giao dịch) và **Partner costs** (khoản phải trả cho byeastside / Pink Design / hãng vận chuyển / nhà cung cấp).
- Sổ ví **chỉ thêm, không sửa** — số dư là tổng của mọi dòng. Không sửa lịch sử; muốn chỉnh thì thêm một dòng điều chỉnh.
- Chi phí được ghi **ngay khi phát sinh** (tiền tem, tổng đơn mua) và đảo lại khi hủy.

### Inventory → Scan (ghi kho) (`/inventory`)
Khác với nhân viên vận hành (chỉ xem tại trạm), **bạn ghi nhập/xuất kho được** tại trạm Scan. Tồn kho tính theo mã **blank** (bỏ hậu tố kiểu in như `-EMB` / `-DTG`).

### Purchasing → đặt hàng (`/purchasing`)
Bạn có thể lấy đơn mua nháp và **đặt thật** với S&S / Otto. Đặt hàng nhà cung cấp mặc định bị khóa hai lớp cho đến khi bật live — kiểm tra nội dung đơn trước khi chi tiền thật.

### Shipping → mua + hủy tem (`/shipping`)
Mua tem (qua Shippo) và xử lý hoàn/hủy. Lỗi thẻ tín dụng USPS nghĩa là yêu cầu đã đi nhầm đường USPS trực tiếp — luôn phải qua nhà tổng hợp.

### Developers — Nhà phát triển (`/developers`)
Bạn dùng để **kiểm tra kết nối** (xác minh tích hợp hoạt động), không phải để tạo khóa production cho người bán.

### Ranh giới
- Bạn được đảo các bước ảnh hưởng ví — nhưng mỗi lần đảo phải để sổ cái cân bằng. Không bao giờ xóa đơn đã đồng bộ hay dữ liệu do shop kết nối sở hữu.
- **Gửi** broadcast cho người bán và **cài đặt nền tảng / vai trò người dùng / phân quyền** vẫn thuộc về Quản trị.
