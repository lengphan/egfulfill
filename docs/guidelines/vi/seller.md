# Người bán — Hướng dẫn sử dụng

Tất cả những gì bạn làm với vai trò chủ shop. Nếu bạn là **thành viên nhóm**, bạn chỉ thấy những trang mà chủ đã chia sẻ cho bạn.

---

## Làm quen

Khi đăng nhập, bạn vào **Dashboard (Trang chủ)**. Thanh bên trái để di chuyển: Dashboard, Orders (Đơn hàng), Products (Sản phẩm), Stores (Cửa hàng), SpyDeck, Reports (Báo cáo), Wallet (Ví), Design Lab (Xưởng thiết kế), Chat — và trong mục *Account*: Developers, Help, Settings.

![Dashboard và thanh bên của người bán](../images/seller-dashboard.png)

---

## Đưa đơn vào hệ thống — 3 cách

Có **3 cách để đơn về hàng chờ**. Dùng cách nào thì đơn cũng nằm cùng một chỗ: **Orders**.

### A. Đồng bộ từ sàn đã kết nối (Etsy / Shopify / TikTok)

Tốt nhất cho bán hàng thật — đơn tự chảy về.

1. Vào **Stores**.
2. Nhấn **Connect** ở Etsy, Shopify hoặc TikTok. Một cửa sổ popup mở ra để bạn đăng nhập sàn đó và cấp quyền.
3. Lần đầu kết nối, chọn **lấy đơn cũ tới đâu** (mốc thời gian backfill).
4. Xong — đơn mới tự đồng bộ và hiện trong **Orders**.

![Stores — kết nối sàn](../images/stores.png)

> Đồng bộ không thay đổi gì phía sàn — an toàn cho shop đang chạy. Etsy có thể ẩn địa chỉ người mua đến khi Etsy duyệt ứng dụng; đó là quy định của Etsy, không phải lỗi.

### B. Nhập bằng bảng tính (hàng loạt / thủ công)

Tốt nhất khi bạn đã có danh sách đơn trong bảng tính.

1. Vào **Orders** → nhấn **Import**.
2. Lấy đúng định dạng: nhấn **Template (.xlsx)** để tải bảng mẫu. Cột **bắt buộc** để trơn; cột **tùy chọn** ghi `(optional)` — có thể để trống.
3. Điền dữ liệu. Bắt buộc chỉ có **tên, địa chỉ, thành phố, bang, mã bưu chính** của người nhận, cùng **Item SKU** hoặc **Product Title**.
4. Đưa vào bằng 3 cách — đều trong tab **File**: kéo/tải **.csv, .xlsx hoặc .xls**, **Paste** dòng sao chép từ bảng tính, hoặc nạp **Google Sheet** bằng đường liên kết.
5. Xem bản xem trước — dòng hợp lệ màu xanh, dòng bị bỏ hiển thị lý do. Nhấn **Import**.

![Nhập đơn — file, paste hoặc Google Sheet](../images/import-dialog.png)

> Mẹo: điền **Template ID** của mẫu thiết kế đã lưu vào cột đó, hệ thống sẽ áp cả thiết kế (blank + artwork + vị trí + kiểu in) cho bạn.

### C. Nhập tay từng đơn

Tốt nhất cho đơn lẻ.

1. Vào **Orders** → **New order** (`/orders/new`).
2. Điền khách hàng + địa chỉ giao, thêm sản phẩm, chọn blank/màu/size.
3. Lưu — đơn vào hàng chờ như mọi đơn khác.

![Biểu mẫu tạo đơn thủ công](../images/order-new.png)

---

## Xử lý một đơn đến khi xong

Dù đơn về bằng cách nào, nó chưa sẵn sàng cho đến khi mỗi dòng được **thiết lập** và đơn được **gửi (Submit)**.

1. Mở đơn từ **Orders**.

   ![Hàng chờ đơn hàng](../images/orders-list.png)

2. Với mỗi dòng, nếu chưa chọn blank sẽ thấy **"Pick a blank…"**. Nhấn vào và chọn **blank**, rồi **màu / size / kiểu in**.

   ![Chọn blank cho một dòng](../images/variant-picker.png)

   - Đơn từ sàn về **chưa có biến thể** — bạn phải chọn.
   - Hai dòng cùng sản phẩm là **hai công việc riêng** — thiết lập từng dòng.
3. Khi mọi dòng đã thiết lập, nhấn **Submit**. Thao tác này **trừ ví** để sản xuất và gửi xuống nhà máy. Giá **khóa lại** khi gửi — nên chọn xong biến thể trước.
4. Cần sửa sau khi gửi? **Cancel** trước (hoàn ví), sửa, rồi gửi lại.
5. Khi giao xong, **mã vận đơn** tự đẩy về cho người mua.

---

## Products — danh mục của bạn

Thiết lập sản phẩm để đơn được tính giá và sản xuất.

1. Vào **Products** → **New product** (hoặc mở một sản phẩm để sửa).
2. Mục **Photo**: ảnh đầu là ảnh **Main**; gắn thẻ **màu** cho từng ảnh, thêm ô ảnh khi cần.
3. Đặt giá theo từng bậc size: **Product cost / Base cost / Shipping** — lợi nhuận mỗi sản phẩm hiển thị sẵn.
4. Luôn đặt **blank** — sản xuất và tồn kho dựa vào nó.

![Trình sửa sản phẩm — mục Photo + giá](../images/product-editor.png)

---

## Wallet — trả phí sản xuất

Phí sản xuất trừ vào số dư trả trước, nhớ nạp đủ.

1. Vào **Wallet** → **Top up**.
2. Chọn **thẻ (Stripe)**, **PayPal**, hoặc **VietQR** (quét mã QR để trả từ ngân hàng Việt Nam). Lưu ý mức nạp **tối thiểu**.
3. Số dư cập nhật khi thanh toán xác nhận; mọi khoản trừ và hoàn đều nằm trong lịch sử.

![Ví và nạp tiền](../images/wallet-topup.png)

---

## Các trang còn lại

- **Reports** — phân tích doanh số và giao hàng theo thời gian. ![Reports](../images/reports.png)
- **SpyDeck** — nghiên cứu sản phẩm và cửa hàng đối thủ. Chỉ xem. ![SpyDeck](../images/spydeck.png)
- **Design Lab** — tạo và lưu artwork, thư viện ảnh, chuẩn bị tệp cho đơn. ![Design Lab](../images/design-lab.png)
- **Chat** — kênh hỗ trợ trực tiếp với EGFULFILL. Hỏi bất cứ điều gì. ![Chat](../images/chat.png)
- **Developers** — khóa API + sandbox, chỉ khi bạn tự tích hợp. ![Developers](../images/developers.png)
- **Settings** — Hồ sơ, khóa API của bạn, **Team** (mời thành viên và chọn trang cho họ), và Gói của bạn. ![Settings](../images/settings.png)

---

## Nguyên tắc nhanh

- Thiết lập **mọi** dòng (blank + biến thể) **trước khi** gửi — giá khóa khi gửi.
- Giữ đủ **số dư ví** nếu không sẽ không gửi được.
- Muốn sửa đơn đã gửi: **hủy → sửa → gửi lại**.
- Thành viên nhóm chỉ thấy trang bạn chia sẻ trong **Settings → Team**.
