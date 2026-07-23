"use client"

import { Translate, Check } from "@phosphor-icons/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LOCALES } from "@/lib/i18n/catalog"
import { useLocale, useT } from "@/lib/i18n"

// Header language switch. Mirrors the topbar icon-button styling so it sits inline with
// the search / theme controls. Flipping the locale re-renders every component reading
// useT — no reload.
export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale()
  const t = useT()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("topbar.language")}
        title={t("topbar.language")}
        className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Translate size={18} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => setLocale(l.code)}
            className="justify-between gap-4"
          >
            {l.native}
            {locale === l.code && <Check size={14} weight="bold" className="text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
