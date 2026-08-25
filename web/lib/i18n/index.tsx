"use client"

// Lightweight, dependency-free i18n for web/. Cookie-backed (so marketing SSR can read
// the choice later) with an English fallback baked into t(), so an untranslated string
// always renders in English rather than blank. This is the ONLY place locale state lives.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { DEFAULT_LOCALE, isLocale, messages, type Locale } from "@/lib/i18n/catalog"
import { fmtDate as fmtDateRaw } from "@/lib/order-format"

const COOKIE = "eg_lang"

type Ctx = { locale: Locale; setLocale: (l: Locale) => void }
const LanguageContext = createContext<Ctx | null>(null)

function readCookieLocale(): Locale | null {
  if (typeof document === "undefined") return null
  const m = document.cookie.match(/(?:^|;\s*)eg_lang=([^;]+)/)
  const v = m ? decodeURIComponent(m[1]) : null
  return isLocale(v) ? v : null
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Start at the default on BOTH server and client so the first render matches (no
  // hydration mismatch); adopt the saved locale after mount. English users never see a
  // change; a Vietnamese user sees English for one frame, then Vietnamese — the same
  // tradeoff next-themes makes for the theme.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  // Adopt the saved choice after mount. setTimeout(0), not a bare setState, to stay clear
  // of react-hooks/set-state-in-effect — the pattern used across the app shell.
  useEffect(() => {
    const id = setTimeout(() => {
      let saved = readCookieLocale()
      if (!saved) {
        try { const ls = localStorage.getItem(COOKIE); if (isLocale(ls)) saved = ls } catch {}
      }
      if (saved) setLocaleState(saved)
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // Keep <html lang> honest for a11y / the browser. Root layout sets suppressHydrationWarning,
  // so mutating it after mount doesn't warn.
  useEffect(() => { document.documentElement.lang = locale }, [locale])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try {
      localStorage.setItem(COOKIE, l)
      // A cookie (not just localStorage) so marketing SSR can read the choice later.
      document.cookie = `${COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`
    } catch { /* private mode / storage disabled — session-only locale is fine */ }
  }, [])

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLocale(): Ctx {
  const ctx = useContext(LanguageContext)
  // Fall back rather than throw, so a component rendered outside the provider still works
  // (in English) instead of crashing the tree.
  return ctx ?? { locale: DEFAULT_LOCALE, setLocale: () => {} }
}

// t(key, vars?) → translated string with {var} interpolation. Falls back
// current-locale → English → the key itself, so a missing translation degrades to
// English and can never render blank.
export function useT() {
  const { locale } = useLocale()
  return useCallback((key: string, vars?: Record<string, string | number>) => {
    const s = messages[locale]?.[key] ?? messages.en[key] ?? key
    if (!vars) return s
    return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
  }, [locale])
}

// Translate a value whose identity IS its English string — nav labels, section
// headings, status words that live in data modules. Looks up `${ns}.${value}` and
// falls back to the VALUE itself (not the key), so English needs no catalog entry and a
// missing translation shows the original English. Keeps the data modules untranslated:
// only the render site calls this.
export function useLabelT() {
  const { locale } = useLocale()
  return useCallback((ns: string, value: string) => {
    const key = `${ns}.${value}`
    return messages[locale]?.[key] ?? messages.en[key] ?? value
  }, [locale])
}

/**
 * DATES FOLLOW THE LOCALE. Money does NOT.
 *
 * 28 call sites passed "en-US" to toLocaleDateString, so a Vietnamese seller read
 * "Tuesday, Aug 26" under a heading that said "Chào buổi sáng" — English on a page with no
 * other English left on it. A date is not a currency: the figure is the same number in both
 * languages, only the month name and the order of the parts change.
 *
 * Money stays en-US on purpose and must NOT route through here (see the note at the top of
 * catalog.ts): sellers list on international marketplaces and price in dollars, so "$1,250.50"
 * is the same string in every language. Reformatting it as "1.250,50" would change what the
 * number appears to say.
 *
 *   const fmtDate = useDateFormat()
 *   fmtDate(order.created_at, { month: "short", day: "numeric" })
 *
 * Returns an em dash for anything unparseable, which is what the call sites already did by
 * hand — a blank cell reads as a column that failed to load rather than a date we don't have.
 */
export function useDateFormat() {
  const { locale } = useLocale()
  // Intl wants a BCP-47 tag, and our locale codes are only the language half.
  const tag = locale === "vi" ? "vi-VN" : "en-US"
  return useCallback((value: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) => {
    if (value == null || value === "") return "—"
    const d = value instanceof Date ? value : new Date(value)
    if (isNaN(d.getTime())) return "—"
    return d.toLocaleDateString(tag, opts)
  }, [tag])
}

/** The same, for a wall-clock time. Same locale rule, same em-dash fallback. */
export function useTimeFormat() {
  const { locale } = useLocale()
  const tag = locale === "vi" ? "vi-VN" : "en-US"
  return useCallback((value: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) => {
    if (value == null || value === "") return "—"
    const d = value instanceof Date ? value : new Date(value)
    if (isNaN(d.getTime())) return "—"
    return d.toLocaleTimeString(tag, opts)
  }, [tag])
}


/**
 * The app's "MMM d" order date, in the reader's locale.
 *
 * lib/order-format.fmtDate is shared with non-React code, so it cannot be a hook and takes
 * the locale tag as an argument instead. This supplies it, and keeps the call signature the
 * 44 existing call sites already use — fmtDate(value) — so switching a file over is an
 * import change, not an edit to every row.
 */
export function useOrderDate() {
  const { locale } = useLocale()
  const tag = locale === "vi" ? "vi-VN" : "en-US"
  return useCallback(
    (s?: string | null, opts?: Intl.DateTimeFormatOptions) => fmtDateRaw(s, tag, opts),
    [tag],
  )
}


/** The BCP-47 tag for the active locale, for the shared formatters that take one. */
export function useLocaleTag() {
  const { locale } = useLocale()
  return locale === "vi" ? "vi-VN" : "en-US"
}
