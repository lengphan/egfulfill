// Message catalog for the app UI.
//
// English is the source of truth AND the fallback: any key missing from a non-English
// locale renders the English string (see useT in ./index), so a half-translated surface
// never shows a blank or a raw key — it just shows English until its Vietnamese lands.
//
// Add a language → add a locale map below + an entry in LOCALES.
// Add a string    → add the English key first, then its translation(s).

export type Locale = "en" | "vi"

export const DEFAULT_LOCALE: Locale = "en"

// Order here is the order shown in the switcher. `native` is what a speaker of that
// language calls it (shown in the menu); `label` is its English name.
export const LOCALES: { code: Locale; label: string; native: string }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "vi", label: "Vietnamese", native: "Tiếng Việt" },
]

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "vi"
}

type Dict = Record<string, string>

// English is complete; other locales may be PARTIAL — missing keys fall back to English.
const en: Dict = {
  "topbar.searchOrders": "Search orders (⌘K)",
  "topbar.toggleTheme": "Toggle theme",
  "topbar.language": "Language",
  "topbar.balance": "Balance",
  "topbar.new": "New",
  "topbar.new.manualOrder": "Manual order",
  "topbar.new.syncPlatforms": "Sync from platforms",
  "topbar.yourProfile": "Your profile",
  "topbar.accountMenu": "Account menu",
  "topbar.profileSettings": "Profile & settings",
  "topbar.logout": "Log out",
}

// AI-drafted Vietnamese — pending human review before it's treated as final.
const vi: Dict = {
  "topbar.searchOrders": "Tìm đơn hàng (⌘K)",
  "topbar.toggleTheme": "Đổi giao diện sáng/tối",
  "topbar.language": "Ngôn ngữ",
  "topbar.balance": "Số dư",
  "topbar.new": "Tạo mới",
  "topbar.new.manualOrder": "Đơn thủ công",
  "topbar.new.syncPlatforms": "Đồng bộ từ nền tảng",
  "topbar.yourProfile": "Trang cá nhân",
  "topbar.accountMenu": "Menu tài khoản",
  "topbar.profileSettings": "Hồ sơ & cài đặt",
  "topbar.logout": "Đăng xuất",

  // Nav labels + section headings — keyed by their English string (see useLabelT), so
  // English needs no entry here and an omitted key (e.g. the "SpyDeck" brand name) keeps
  // its English. AI-drafted, pending review.
  "nav.Dashboard": "Tổng quan",
  "nav.Orders": "Đơn hàng",
  "nav.Products": "Sản phẩm",
  "nav.Stores": "Cửa hàng",
  "nav.Reports": "Báo cáo",
  "nav.Wallet": "Ví",
  "nav.Design Lab": "Xưởng thiết kế",
  "nav.Chat": "Trò chuyện",
  "nav.Developers": "Nhà phát triển",
  "nav.Help": "Trợ giúp",
  "nav.Settings": "Cài đặt",
  "nav.Board": "Bảng thiết kế",
  "nav.Earnings": "Thu nhập",
  "nav.Dispatch": "Xuất hàng",
  "nav.Shipments": "Kiện hàng",
  "nav.Scan": "Quét mã",
  "nav.Inventory": "Kho hàng",
  "nav.Purchase": "Mua hàng",
  "nav.Suppliers": "Nhà cung cấp",
  "nav.Billing": "Thanh toán",
  "nav.Campaigns": "Chiến dịch",
  "nav.Broadcasts": "Email hàng loạt",
  "nav.Digitizer": "Số hóa thêu",
  "nav.Catalogue": "Danh mục",
  "nav.Notifications": "Thông báo",
  // Section headings
  "nav.Account": "Tài khoản",
  "nav.Tools": "Công cụ",
  // Shared chrome
  "nav.Log out": "Đăng xuất",
  "nav.Open menu": "Mở menu",
  "nav.Close menu": "Đóng menu",

  // ── Orders / Production board ─────────────────────────────────────────────
  // Factory statuses — StageBadge, the filter tabs, and the per-item status select.
  // Keyed by English label; the ids in factory-status.ts (which mirror the server) are
  // untouched. AI-drafted, pending review.
  "stage.New": "Mới",
  "stage.Received": "Đã nhận",
  "stage.Draft": "Nháp",
  "stage.Submitted": "Đã gửi",
  "stage.Pending": "Chờ duyệt",
  "stage.Awaiting scan": "Chờ quét",
  "stage.Printed": "Đã in",
  "stage.Working": "Đang làm",
  "stage.Shipped": "Đã gửi hàng",
  "stage.On hold": "Tạm giữ",
  "stage.Flagged": "Gắn cờ",
  "stage.Backorder": "Thiếu hàng",
  "stage.Cancelled": "Đã hủy",
  "stage.Refunded": "Đã hoàn tiền",
  "stage.All": "Tất cả",
  "stage.Issues": "Sự cố",
  // Column headers (FACTORY_COLS labels)
  "col.Status": "Trạng thái",
  "col.Order": "Đơn",
  "col.Tracking": "Mã vận đơn",
  "col.Store": "Cửa hàng",
  "col.Customer": "Khách hàng",
  "col.Items": "Sản phẩm",
  "col.List": "Danh mục",
  // Readiness tags
  "ui.Label": "Nhãn",
  "ui.Scan": "Quét",
  "ui.Design": "Thiết kế",
  // Board chrome + row actions
  "ui.Production queue": "Hàng chờ sản xuất",
  "ui.Import": "Nhập",
  "ui.New order": "Đơn mới",
  "ui.Nothing here": "Không có gì ở đây",
  "ui.No orders are in production yet.": "Chưa có đơn nào đang sản xuất.",
  "ui.No orders match this filter.": "Không có đơn nào khớp bộ lọc này.",
  "ui.Start order": "Bắt đầu đơn",
  "ui.Create new label": "Tạo nhãn mới",
  "ui.Next stage": "Bước tiếp theo",
  "ui.Shipped": "Đã gửi hàng",
  "ui.Board": "Bảng",
  "ui.Sent": "Đã gửi",
  "ui.More actions": "Thêm thao tác",
  "ui.Open order": "Mở đơn",
  "ui.Reopen label": "Mở lại nhãn",
  "ui.Print blank labels": "In nhãn phôi",
  "ui.Set all items to": "Đặt tất cả thành",
  "ui.Production": "Sản xuất",
  "ui.Exceptions": "Sự cố",
  "ui.Flag…": "Gắn cờ…",
  "ui.Flag / hold": "Gắn cờ / tạm giữ",
  "ui.catch up": "bắt kịp",
  // Variant fields (Blank/Colour/Size/Method) + the read-only strip
  "field.Blank": "Phôi",
  "field.Colour": "Màu sắc",
  "field.Color": "Màu sắc",
  "field.Size": "Kích cỡ",
  "field.Method": "Kiểu in",
  "field.Required": "Bắt buộc",
  "field.Any": "Bất kỳ",
  "field.Choose…": "Chọn…",
  "field.Pick a blank…": "Chọn phôi…",
  "field.Not set up for production yet": "Chưa sẵn sàng sản xuất",
  "field.No variant set": "Chưa chọn biến thể",
  "field.Buyer": "Người mua",
  // Stat cards
  "stat.To approve": "Chờ duyệt",
  "stat.seller paid, waiting on you": "khách đã trả, chờ bạn duyệt",
  "stat.nothing waiting": "không có gì chờ",
  "stat.Need design": "Cần thiết kế",
  "stat.no approved file yet": "chưa có file được duyệt",
  "stat.all designs approved": "tất cả thiết kế đã duyệt",
  "stat.Short on stock": "Thiếu hàng tồn",
  "stat.stock not loaded": "chưa tải được tồn kho",
  "stat.can't be made yet": "chưa thể sản xuất",
  "stat.blanks on hand": "đủ phôi trong kho",
  "stat.Awaiting scan": "Chờ quét",
  "stat.labels made, not scanned": "đã tạo nhãn, chưa quét",
  "stat.scan queue clear": "hàng chờ quét đã hết",
}

export const messages: Record<Locale, Dict> = { en, vi }
