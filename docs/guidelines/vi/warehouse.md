# Kho — Hướng dẫn sử dụng

Bạn làm mọi việc như nhân viên vận hành **cộng thêm giữ hàng và tiền**: ghi kho, mua tem, đặt hàng nhà cung cấp, và Tài chính. Hãy đọc **[Hướng dẫn Nhân viên vận hành](operator.md)** trước — tất cả đều áp dụng. Dưới đây là phần **thêm**.

---

## Ghi kho tại trạm Scan

Khác với nhân viên vận hành (chỉ xem tại trạm), bạn **nhập/xuất kho được**.

1. Mở **Inventory → Scan**.
2. Quét hoặc nhập sản phẩm, chọn **in (nhập)** hoặc **out (xuất)**, đặt số lượng, xác nhận.
3. Kho thay đổi theo mã **blank** — bỏ hậu tố kiểu in (`-EMB` / `-DTG` / …) nếu có.

![Inventory — trạm Scan](../images/inventory.png)

---

## Mua và hủy tem vận chuyển

1. Mở **Shipping → Dispatch**, chọn một đơn.
2. Mua tem — tự động đi qua nhà tổng hợp. (Lỗi thẻ tín dụng USPS nghĩa là đi nhầm đường USPS trực tiếp — báo lại.)
3. Cần hủy? Dùng thao tác **void/refund** của tem.

![Shipping](../images/shipping.png)

---

## Đặt hàng nhà cung cấp

1. Mở **Purchasing → Purchase**, xem đơn mua nháp.
2. **Đặt (Place)** với S&S / Otto. Đặt hàng bị khóa đến khi bật live — **kiểm tra nội dung đơn trước khi chi tiền thật**.

![Purchasing](../images/purchasing.png)

---

## Tài chính (Finance)

**Finance** có hai tab:

- **Wallet** — số dư nhà máy và mọi giao dịch.
- **Partner costs** — khoản phải trả cho byeastside / Pink Design / hãng vận chuyển / nhà cung cấp.

![Finance](../images/finance.png)

Quy tắc sổ cái:

- **Chỉ thêm, không sửa** — không sửa lịch sử; muốn chỉnh thì **thêm** một dòng cân đối.
- Chi phí ghi **ngay khi phát sinh** (tiền tem, tổng đơn mua) và đảo lại khi hủy.
- Mọi lần đảo phải để sổ cái **cân bằng**.

---

## Cũng thuộc về bạn

- **Developers** — dùng để **kiểm tra kết nối** (xác minh tích hợp hoạt động), không phải tạo khóa cho người bán.
- Tất cả bảng của nhân viên vận hành + công cụ dùng chung.

## KHÔNG được

- Phá đơn đã đồng bộ hay dữ liệu do shop kết nối sở hữu.
- **Gửi** broadcast cho người bán, hay đổi cài đặt nền tảng / vai trò / phân quyền — đó là việc của Quản trị.
