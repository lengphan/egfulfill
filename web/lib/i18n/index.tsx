"use client"

// Lightweight, dependency-free i18n for web/. Cookie-backed (so marketing SSR can read
// the choice later) with an English fallback baked into t(), so an untranslated string
// always renders in English rather than blank. This is the ONLY place locale state lives.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { DEFAULT_LOCALE, isLocale, messages, type Locale } from "@/lib/i18n/catalog"

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
