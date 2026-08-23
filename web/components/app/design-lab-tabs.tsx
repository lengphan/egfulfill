"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { tabsListVariants, tabsTriggerVariants } from "@/components/ui/tabs"
import { getToken } from "@/lib/auth"
import { cn } from "@/lib/utils"

/**
 * Design Lab's three surfaces as one toggle bar.
 *
 * Links, not shadcn Tabs, because the maker lives on its own route — it's a full-height
 * editor that doesn't fit in a tab panel, and the bar renders there too so it still reads
 * as one of the three. That means these ARE navigation, so they stay anchors with
 * aria-current; role="tab" would promise the ARIA tab pattern (arrow keys, a controlled
 * tabpanel) that links can't honour. Styling comes from tabsTriggerVariants so the bar
 * can't drift from the real tab bars in Settings and Wallet.
 */
// No icons. A toggle bar is three or four words the eye reads as a set; an icon in front
// of each turns it into a row of competing marks, and none of them tell you anything the
// word doesn't already say.
const TABS = [
  // ?tab=library rather than a bare /design: navigating from ?tab=templates to a URL with
  // NO search params left useSearchParams() holding the old value, so the hook kept
  // reporting "templates" and clicking Library re-rendered the Templates panel. Both hrefs
  // carrying a param makes it a value change, which the hook does track.
  /**
   * ARTWORK, not "Images" — and the same word the editor's rail uses.
   *
   * ONE THING HAD FIVE NAMES. This tab said Images, its own header said "Your images", its
   * cards said "Untitled design", the editor's rail tool said Artwork, that rail's first
   * group said "Your uploads", and the button under it said "Saved designs & templates".
   * A seller asking "where is my logo" had six places to look and no way to tell that four
   * of them were the same place.
   *
   * Three nouns now, and each is the SAME word wherever it appears: ARTWORK is a flat
   * picture, a TEMPLATE is a blank plus artwork plus where it sits, a MACHINE FILE is the
   * stitch file. "Design" is reserved for the thing on the canvas — which is why the fourth
   * toggle keeps it — and it is saved AS artwork or AS a template, which is exactly what the
   * editor's Save menu now says.
   */
  { key: "library", label: "Artwork", href: "/design?tab=library" },
  { key: "templates", label: "Templates", href: "/design?tab=templates" },
  // BESIDE Templates, not inside it. A template is a blank plus artwork plus where it sits;
  // a machine file is the cut file, which has no placement to carry and no blank it belongs
  // to — the same .EMB runs on a cap and on a left chest. Two questions, two surfaces.
  { key: "machine", label: "Machine files", href: "/design?tab=machine" },
  // "Design", not "Design maker". It sits beside two one-word toggles, and the bar reads as
  // a set of three — a two-word member of a three-word set is the one the eye stops on.
  { key: "maker", label: "Design", href: "/design/maker" },
] as const

export type DesignLabTab = (typeof TABS)[number]["key"]

/** Which toggle the current URL is on. Kept here so the page and the bar can't disagree. */
export function useDesignLabTab(): DesignLabTab {
  const pathname = usePathname()
  const search = useSearchParams()
  if (pathname?.startsWith("/design/maker")) return "maker"
  const tab = search.get("tab")
  // An explicit list rather than a chain of ternaries: a fourth surface arriving is where a
  // chain quietly starts answering "library" for a tab that exists.
  return tab === "templates" || tab === "machine" ? tab : "library"
}

export function DesignLabTabs({ className }: { className?: string }) {
  const active = useDesignLabTab()
  // Read after mount — getToken() touches localStorage, which the prerender doesn't have.
  // Deferred rather than set inline, matching how every other page here reads the session.
  const [signedOut, setSignedOut] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setSignedOut(!getToken()), 0)
    return () => clearTimeout(id)
  }, [])

  return (
    <nav aria-label="Design Lab sections" className={cn(tabsListVariants(), "h-8", className)}>
      {TABS.map(({ key, label, href }) => {
        const on = key === active
        // The maker is the only surface that needs a session — it loads the catalog and
        // saves. Signed out it renders an empty stage with a Save that 401s, so it's
        // disabled here the way the old "Open maker" button was.
        const disabled = signedOut && key === "maker"
        const body = label
        const classes = cn(tabsTriggerVariants({ active: on }), "px-3")

        // The active toggle is inert on purpose: navigating to a tab's bare href while
        // already on it would strip ?template=/?product= out from under a loaded maker
        // session, leaving the editor holding a template the URL no longer names.
        if (on || disabled) {
          return (
            <span
              key={key}
              aria-current={on ? "page" : undefined}
              aria-disabled={disabled || undefined}
              title={disabled ? "Sign in to use the design maker" : undefined}
              className={cn(classes, disabled && "opacity-50")}
            >
              {body}
            </span>
          )
        }
        return (
          <Link key={key} href={href} className={classes}>
            {body}
          </Link>
        )
      })}
    </nav>
  )
}
