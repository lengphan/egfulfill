# Nhân viên vận hành — Hướng dẫn sử dụng

Bạn làm ở khâu sản xuất. **Phạm vi của bạn kết thúc ở bước quét (scan)** — các việc liên quan tiền (hoàn tiền, đảo ví, chi từ tài khoản nhà máy) thuộc về Kho/Quản trị. Sau khi đăng nhập, bạn vào **Dashboard** của nhân viên.

![Dashboard nhân viên](../images/staff-overview.png)

---

## Xử lý hàng chờ sản xuất

1. Mở **Orders** (trung tâm sản xuất) — mọi đơn đã đẩy xuống xưởng.

   ![Trung tâm sản xuất](../images/production-hub.png)

2. Nhấn một đơn để xem các dòng, artwork và giai đoạn hiện tại.
3. Chuyển từng dòng qua các giai đoạn bằng nút trạng thái. Bảng chỉ cho phép thao tác mà vai trò bạn được làm từ vị trí hiện tại của dòng.
4. Dòng từ sàn có thể chưa có biến thể — chỉ lựa chọn do chính nhà máy đặt mới điền sẵn.
5. **"Đã giao" là ở cấp đơn**: bảng không cho đánh dấu *shipped* đến khi mọi dòng sẵn sàng — kiện hàng không đi khi chưa làm xong.

---

## Bảng thiết kế

Mở **Board** để xem các thẻ artwork. Bạn có thể nhận và theo dõi thẻ, nhưng **duyệt** thiết kế là bước của Thiết kế/Quản trị (nhãn giữ màu hổ phách đến khi duyệt thì chuyển tím).

![Bảng thiết kế](../images/designer-board.png)

---

## Giao hàng (Shipping)

**Shipping** có hai tab:

- **Dispatch** — hàng cần đi hôm nay; xử lý cho hết trong ngày.
- **Shipments** — kho lưu các kiện đã gửi.

Mua tem qua nhà tổng hợp (hệ thống tự lo) — nếu thấy lỗi thẻ tín dụng USPS, tức là yêu cầu đi nhầm đường; báo lại.

![Shipping — Dispatch + Shipments](../images/shipping.png)

---

## Tồn kho (Inventory)

**Inventory** có hai tab:

- **Stock** — số lượng tồn.
- **Scan** — trạm nhập/xuất kho. Bạn **xem được** ở đây, nhưng **ghi nhập/xuất kho là thao tác của Kho** — trạm sẽ chặn.

Tồn kho tính theo mã **blank** (bỏ hậu tố kiểu in như `-EMB` / `-DTG`).

![Inventory — Stock + Scan](../images/inventory.png)

---

## Mua hàng (Purchasing)

**Purchasing** = **Suppliers** (duyệt S&S / Otto) + **Purchase** (giỏ / đang đặt / lịch sử). Bạn có thể tạo đơn mua **nháp**, nhưng **đặt thật với nhà cung cấp là thao tác của Kho/Quản trị**.

![Purchasing](../images/purchasing.png)

---

## Các trang khác bạn dùng được

- **Digitizer** — biến artwork + chữ thành tệp máy thêu (`.emb`) hoặc PNG. ![Digitizer](../images/digitizer.png)
- **Broadcasts** — bạn **soạn** email cho người bán; chỉ admin mới **gửi**. ![Broadcasts](../images/broadcasts.png)
- **Products / Catalogue / SpyDeck / Design Lab** — công cụ dùng chung. ![Products](../images/products-list.png)
- **Chat, Help, Notifications, Settings** — dùng chung.

---

## KHÔNG được

- Đảo ngược bước đã giao/đã trừ tiền, hoàn tiền, hay động vào số dư ví — đó là việc của Kho/Quản trị.
- Đặt đơn mua thật với nhà cung cấp, hay ghi kho ở trạm Scan.
