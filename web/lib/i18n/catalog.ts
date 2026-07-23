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
}

export const messages: Record<Locale, Dict> = { en, vi }
