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

  // ── Dashboards (seller + staff) ───────────────────────────────────────────
  // Keyed strings, so these MUST be listed here: useT falls back en → key, and a missing
  // English entry renders the raw key. The useLabelT namespaces below (kpi./range./
  // shortcut./speed.) need no English side — they fall back to the value itself.
  //
  // MONEY IS NOT TRANSLATED. Every figure on these cards stays USD, formatted en-US,
  // because sellers list on international marketplaces and price in dollars. Only the
  // words around the figure move. The one exception in the app is the VietQR top-up,
  // where the amount is genuinely converted to VND before it is charged.
  "dash.goodMorning": "Good morning",
  "dash.goodAfternoon": "Good afternoon",
  "dash.goodEvening": "Good evening",
  "dash.there": "there",
  "dash.newToday": "new today",
  "dash.revenue": "Revenue",
  "dash.recentOrders": "Recent orders",
  "dash.viewAll": "View all",
  "dash.openQueue": "Open queue",
  "dash.item": "Item",
  "dash.openOrder": "Open order {num}",
  "dash.demo": "Showing sample data — sign in to load your live dashboard.",
  "dash.errFigures": "Couldn't load your orders, so these figures are unavailable — they are not zero.",
  "dash.errCounts": "Couldn't load orders, so these counts are unavailable — they are not zero.",
  "dash.errRecent": "Couldn't load recent orders.",
  "dash.errServer": "Couldn't reach the server.",
  "dash.errSignedOut": "You're signed out.",
  "dash.noChart": "No revenue data to chart — your orders couldn't be loaded.",
  "dash.noOrders": "No orders yet.",
  "dash.productionLine": "Production line",
  // English pluralises, Vietnamese doesn't — so the count picks the key rather than the
  // render site splicing an "s" onto a translated noun.
  "dash.onHoldOne": "1 order on hold — need attention",
  "dash.onHold": "{n} orders on hold — need attention",
  "dash.ofAllOrders": "of all orders",
  "dash.shippedLower": "shipped",
  "dash.allOrdersLower": "all orders",
  "dash.fulfillmentSpeed": "Fulfillment speed",
  "dash.noDataYet": "no data yet",
  "dash.collecting": "collecting",
  "dash.ofDelivered": "of {n} delivered",
  "dash.oneOrder": "1 order",
  "dash.nOrders": "{n} orders",
  "dash.compare": "Compare",
  "dash.thisPeriod": "This period",
  "dash.previous": "Previous",
  "dash.7d": "7d",
  "dash.4weeks": "4 weeks",
  "dash.3months": "3 months",
  // Shortcut launcher
  "dash.jumpTo": "Jump to",
  "dash.edit": "Edit",
  "dash.done": "Done",
  "dash.addShortcut": "Add shortcut",
  "dash.removeShortcut": "Remove {label}",
  "dash.noShortcuts": "No shortcuts — tap Edit to add some.",
  // KPI captions that interpolate — these go through useT, not useLabelT, so unlike the
  // rest of the kpi.* namespace they need their English source listed here.
  "kpi.throughPlatform": "{window} · through the platform",
  "kpi.afterCosts": "after {cost} costs",
  "kpi.pctOfAll": "{pct}% of all",
  // Production-line tooltip
  "dash.lineCount": "{label}: {n} orders",
  "dash.lineShare": "{pct}% of the floor",
  "dash.lineOldest": "Oldest waiting {age}",
  "dash.today": "today",
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
  // The merged section shells (see the tabbed-wrapper nav consolidation) — these are the
  // labels staffNav actually emits, and they were the ones still reading English on the
  // staff shortcut tiles. "SpyDeck" is deliberately still absent: it's a brand name.
  "nav.Shipping": "Vận chuyển",
  "nav.Purchasing": "Mua hàng",
  "nav.Sourcing": "Tìm nguồn hàng",
  "nav.Finance": "Tài chính",
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

  // ── Dashboards (seller + staff) ───────────────────────────────────────────
  // AI-drafted, pending review. Figures stay USD — only the words move.
  "dash.goodMorning": "Chào buổi sáng",
  "dash.goodAfternoon": "Chào buổi chiều",
  "dash.goodEvening": "Chào buổi tối",
  "dash.there": "bạn",
  "dash.newToday": "đơn mới hôm nay",
  "dash.revenue": "Doanh thu",
  "dash.recentOrders": "Đơn gần đây",
  "dash.viewAll": "Xem tất cả",
  "dash.openQueue": "Mở hàng chờ",
  "dash.item": "Sản phẩm",
  "dash.openOrder": "Mở đơn {num}",
  "dash.demo": "Đang hiển thị dữ liệu mẫu — đăng nhập để xem bảng điều khiển thật của bạn.",
  "dash.errFigures": "Không tải được đơn hàng nên các số liệu này không khả dụng — chúng không phải bằng 0.",
  "dash.errCounts": "Không tải được đơn hàng nên các số liệu này không khả dụng — chúng không phải bằng 0.",
  "dash.errRecent": "Không tải được đơn hàng gần đây.",
  "dash.errServer": "Không kết nối được máy chủ.",
  "dash.errSignedOut": "Bạn đã đăng xuất.",
  "dash.noChart": "Không có dữ liệu doanh thu để vẽ biểu đồ — không tải được đơn hàng của bạn.",
  "dash.noOrders": "Chưa có đơn nào.",
  "dash.productionLine": "Dây chuyền sản xuất",
  "dash.onHoldOne": "1 đơn đang tạm giữ — cần xử lý",
  "dash.onHold": "{n} đơn đang tạm giữ — cần xử lý",
  "dash.ofAllOrders": "trên tổng số đơn",
  "dash.shippedLower": "đã gửi",
  "dash.allOrdersLower": "tổng số đơn",
  "dash.fulfillmentSpeed": "Tốc độ hoàn tất",
  "dash.noDataYet": "chưa có dữ liệu",
  "dash.collecting": "đang thu thập",
  "dash.ofDelivered": "trên {n} đơn đã giao",
  "dash.oneOrder": "1 đơn",
  "dash.nOrders": "{n} đơn",
  "dash.compare": "So sánh",
  "dash.thisPeriod": "Kỳ này",
  "dash.previous": "Kỳ trước",
  "dash.7d": "7 ngày",
  "dash.4weeks": "4 tuần",
  "dash.3months": "3 tháng",
  "dash.jumpTo": "Truy cập nhanh",
  "dash.edit": "Sửa",
  "dash.done": "Xong",
  "dash.addShortcut": "Thêm lối tắt",
  "dash.removeShortcut": "Bỏ {label}",
  "dash.noShortcuts": "Chưa có lối tắt — nhấn Sửa để thêm.",
  "dash.lineCount": "{label}: {n} đơn",
  "dash.lineShare": "{pct}% của xưởng",
  "dash.lineOldest": "Chờ lâu nhất {age}",
  "dash.today": "hôm nay",

  // KPI tiles — keyed by their English label (useLabelT), so a tile whose wording isn't
  // listed here keeps its English rather than going blank.
  "kpi.Orders (30d)": "Đơn hàng (30 ngày)",
  "kpi.Revenue (30d)": "Doanh thu (30 ngày)",
  "kpi.Open orders": "Đơn đang mở",
  "kpi.Wallet balance": "Số dư ví",
  "kpi.GMV": "GMV",
  // "Doanh thu của chúng ta" is the literal translation and it TRUNCATES — the MiniStat
  // label is a single truncating line, and Vietnamese runs long. This says the same thing
  // (our income, as opposed to the GMV beside it) in a width the tile actually has.
  "kpi.Our revenue": "Doanh thu xưởng",
  "kpi.Profit": "Lợi nhuận",
  "kpi.Orders": "Đơn hàng",
  "kpi.Avg order": "Giá trị đơn TB",
  "kpi.To receive": "Chờ nhận",
  "kpi.In production": "Đang sản xuất",
  "kpi.Working": "Đang làm",
  "kpi.Shipped": "Đã gửi hàng",
  "kpi.New": "Mới",
  "kpi.In review": "Đang duyệt",
  // KPI captions
  "kpisub.last 30 days": "30 ngày qua",
  "kpisub.gross, last 30 days": "tổng, 30 ngày qua",
  "kpisub.in the pipeline": "đang trong quy trình",
  "kpisub.available to fulfill": "khả dụng để sản xuất",
  "kpisub.we earned": "chúng ta thu được",
  "kpisub.nothing booked": "chưa ghi nhận khoản nào",
  "kpisub.nothing booked yet": "chưa ghi nhận khoản nào",
  "kpisub.loading": "đang tải",
  "kpisub.per order": "mỗi đơn",
  "kpisub.new intake": "hàng mới về",
  "kpisub.scan → pack": "quét → đóng gói",
  "kpisub.being made": "đang sản xuất",
  "kpisub.awaiting start": "chờ bắt đầu",
  "kpisub.artwork check": "kiểm tra thiết kế",
  "kpi.throughPlatform": "{window} · qua nền tảng",
  "kpi.afterCosts": "sau {cost} chi phí",
  "kpi.pctOfAll": "{pct}% tổng số",

  // Money window toggle
  "range.Today": "Hôm nay",
  "range.7 days": "7 ngày",
  "range.30 days": "30 ngày",
  "range.All": "Tất cả",
  "rangesub.today": "hôm nay",
  "rangesub.last 7 days": "7 ngày qua",
  "rangesub.last 30 days": "30 ngày qua",
  "rangesub.all time": "toàn thời gian",

  // Shortcut tile captions
  "shortcut.Production queue": "Hàng chờ sản xuất",
  // NOT "Bảng thiết kế" — that's nav.Board, this tile's own label, and the tile would then
  // print the same two words twice. The blurb has to say something the label doesn't.
  "shortcut.Artwork board": "Duyệt file thiết kế",
  "shortcut.Dispatch + shipments": "Xuất hàng + kiện hàng",
  "shortcut.Stock levels + scan": "Tồn kho + quét mã",
  "shortcut.Browse, cart + orders": "Duyệt, giỏ + đơn mua",
  "shortcut.Wallet + costs": "Ví + chi phí",
  "shortcut.Seller email": "Email người bán",
  "shortcut.Supplier costing": "Tính giá nhà cung cấp",
  "shortcut.Ad spend": "Chi phí quảng cáo",
  "shortcut.Payouts": "Chi trả",
  "shortcut.Machine files": "File máy thêu",
  "shortcut.Competitor research": "Nghiên cứu đối thủ",
  "shortcut.Catalog + blanks": "Danh mục + phôi",
  "shortcut.Trade shop window": "Gian hàng bán buôn",
  "shortcut.Design lab": "Xưởng thiết kế",
  "shortcut.Seller stores": "Cửa hàng người bán",
  "shortcut.Analytics": "Phân tích",
  "shortcut.API keys": "Khóa API",

  // Fulfilment-speed rows
  "speed.Production": "Sản xuất",
  "speed.Transit": "Vận chuyển",
  "speed.Total lead time": "Tổng thời gian",
  "speed.On-time": "Đúng hẹn",
  "speed.placed → shipped": "đặt → gửi hàng",
  "speed.shipped → delivered": "gửi hàng → giao",
  "speed.placed → delivered": "đặt → giao",
  "speed.delivered by USPS ETA": "giao đúng dự kiến của USPS",

  // Extra column headers used by the seller dashboard's recent-orders table.
  "col.Total": "Tổng",
  "col.Date": "Ngày",

  // Channel slots that aren't brand names (Etsy/Shopify/TikTok stay as they are).
  "ui.Manual": "Thủ công",
  "ui.Other": "Khác",
}

export const messages: Record<Locale, Dict> = { en, vi }
