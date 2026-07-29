# Quản trị — Hướng dẫn sử dụng

Bạn có **toàn quyền** với mọi bảng, công cụ và cài đặt. Các bảng hằng ngày hoạt động y như trong hướng dẫn [Nhân viên vận hành](operator.md) và [Kho](warehouse.md) — hãy đọc cả hai. Phần này nói về những gì **chỉ dành cho quản trị**.

---

## Gửi broadcast cho người bán

Nhân viên soạn được; **chỉ bạn mới gửi**.

1. Mở **Broadcasts**, viết mới hoặc mở bản nháp.
2. Kiểm tra đối tượng nhận, rồi **Send**. Khi gửi phải tôn trọng lựa chọn **không nhận tiếp thị (opt-out)** của người bán — không được bỏ qua.

![Broadcasts](../images/broadcasts.png)

---

## Bảng điều khiển quản trị — Settings

**Settings** là nơi bạn vận hành nền tảng. Các tab chính:

![Settings](../images/settings.png)

- **Platform** — mặc định toàn nhà máy: mức nạp + tối thiểu, giá, phí, vị trí/bề mặt in.
- **Users** — nâng/hạ vai trò nhân viên (đăng ký công khai chỉ tạo *người bán*) và đặt hạn mức hằng ngày.
- **Permissions** — ẩn trang/tab theo vai trò. **Chỉ ẩn**: có thể hạn chế, không bao giờ mở trang nhân viên cho người bán.
- **Suppliers** — cách đơn mua thanh toán và giao.
- **Usage** — lượng gọi API + ước tính chi phí theo nền tảng, có ngưỡng **cảnh báo** hằng tháng. Chỉ cảnh báo — không chặn. Đặt chi phí/lần gọi và hạn mức tháng cho từng nền tảng ở đây.
- **Site content** — nội dung trang chủ tiếp thị công khai.
- **Activity** — nhật ký ai đã thay đổi gì.
- **Backups** — sao lưu cơ sở dữ liệu theo yêu cầu + hằng đêm.
- **Integrations / API keys** — thông tin đăng nhập dịch vụ của nền tảng (Stripe, nhà cung cấp, Wilcom, email). Được đọc lúc gọi, nên khóa lưu ở đây áp dụng ngay lần yêu cầu sau.

---

## Người nắm tiền — Finance

Bạn và Kho nắm sổ cái (xem [Hướng dẫn Kho](warehouse.md) để hiểu cách hoạt động). Riêng quản trị: cộng tiền vào ví **chỉ nhân viên mới làm được** — người bán không bao giờ được tự cộng tiền cho mình.

![Finance](../images/finance.png)

---

## Nguyên tắc bạn phải giữ

- **Không bao giờ gây rủi ro cho tài khoản đã kết nối.** Không được làm treo shop của người bán hay phá dữ liệu đã đồng bộ; đồng bộ không ghi đè thứ không do mình tạo. Điều này ưu tiên hơn mọi tính năng.
- **Tiền chỉ thêm và bất biến** — trừ khi gửi, hoàn khi hủy; thử lại không bao giờ tính hai lần.
- **Người bán không bao giờ biết thiết kế của họ được người bán khác dùng** — phát hiện trùng lặp chỉ ở phía nhà máy.
- **Phân quyền chỉ để ẩn** — hiển thị = `hasCapability && !hidden`.
