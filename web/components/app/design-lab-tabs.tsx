"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { tabsListVariants, tabsTriggerVariants } from "@/components/ui/tabs"
import { getToken, getUser } from "@/lib/auth"
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
  /**
   * FILES LEADS, for the people who see it at all.
   *
   * It is the factory's artwork library — every picture an order asked for, and whether we
   * already hold the stitch file for it — and it was its own board at /artwork. It is the
   * SAME QUESTION Machine files asks from the other end: that tab holds the files we have,
   * this one holds the artwork waiting on one. Two shelves in two places is how "have we
   * digitised this before" gets answered by guessing.
   *
   * FIRST because it is where the work starts. A seller's own three tabs are a library they
   * browse; this is a queue with a count of orders waiting on each row, and a queue that
   * opens fourth is one somebody has to remember to go to.
   *
   * STAFF, AND NOT ALL STAFF. Every card names the shops that ordered a design, which is the
   * narrowest §6 surface in the app — so it keeps exactly the roles its old nav item carried
   * (operator · designer · admin), and warehouse does not see it even though the rest of
   * Design Lab is open to them. A seller's bar therefore still opens on Artwork, unchanged.
   * The server refuses a seller outright; this gate is the second lock, not the first.
   */
  { key: "files", label: "Files", href: "/design?tab=files", roles: ["operator", "designer", "admin"] },
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
] as const satisfies readonly { key: string; label: string; href: string; roles?: readonly string[] }[]

export type DesignLabTab = (typeof TABS)[number]["key"]

/**
 * Which toggle the current URL is on. Kept here so the page and the bar can't disagree.
 *
 * A BARE `/design` IS NOT A TAB, IT IS A DEFAULT — and the default is the first toggle this
 * role can see. It was hard-coded to Artwork, so pressing Design Lab in the sidebar landed
 * on the second tab and read as the bar jumping off Files by itself.
 *
 * `role` IS THREE STATES, not two, and that is what stops the flash. `null` means nobody has
 * read the session yet (it lives in storage, which a prerender has not got), and answering
 * "library" then would paint Artwork for a frame and swap — the same jump, one tick shorter.
 * So it answers NOTHING until the role is known and the page draws its skeleton. `""` is the
 * answer "read it, nobody is signed in", which is not staff and lands on Artwork like any
 * seller. A caller that passes nothing is not role-aware and keeps the old behaviour.
 *
 * An explicit URL always wins and never waits: only the default consults the role.
 */
export function useDesignLabTab(role?: string | null): DesignLabTab | null {
  const pathname = usePathname()
  const search = useSearchParams()
  if (pathname?.startsWith("/design/maker")) return "maker"
  const tab = search.get("tab")
  // An explicit list rather than a chain of ternaries: a fifth surface arriving is where a
  // chain quietly starts answering "library" for a tab that exists.
  if (tab === "templates" || tab === "machine" || tab === "files" || tab === "library") return tab
  if (role === undefined) return "library"
  if (role === null) return null
  return canSeeDesignLabTab("files", role) ? "files" : "library"
}

/**
 * MAY THIS ROLE SEE THIS TOGGLE? Exported so the PAGE asks the same question the BAR does —
 * a tab hidden from the bar but still rendered by the panel underneath is a gate that only
 * looks like one, and ?tab=files is a URL anyone can type.
 */
export function canSeeDesignLabTab(key: DesignLabTab, role?: string | null): boolean {
  const t = TABS.find((x) => x.key === key)
  const roles = (t as { roles?: readonly string[] } | undefined)?.roles
  return !roles || (!!role && roles.includes(role))
}

export function DesignLabTabs({ className }: { className?: string }) {
  const tl = useLabelT()
  // Read after mount — getToken() touches localStorage, which the prerender doesn't have.
  // Deferred rather than set inline, matching how every other page here reads the session.
  const [signedOut, setSignedOut] = useState(false)
  // null = not read yet · "" = read, nobody signed in. See useDesignLabTab.
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    const id = setTimeout(() => {
      setSignedOut(!getToken())
      setRole(getUser()?.role ?? "")
    }, 0)
    return () => clearTimeout(id)
  }, [])
  /* DECLARED AFTER `role`, and that is not style: read above it this is TS2448 and the
     React Compiler drops the component — the trap §7 records, in the file that names it. */
  const active = useDesignLabTab(role)

  return (
    <nav aria-label={tl("designLab", "Design Lab sections")} className={cn(tabsListVariants(), "h-8", className)}>
      {TABS.filter(({ key }) => canSeeDesignLabTab(key, role)).map(({ key, label, href }) => {
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
              title={disabled ? tl("designLab", "Sign in to use the design maker") : undefined}
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
