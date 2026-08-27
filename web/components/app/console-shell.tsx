"use client"

import { createContext, useContext, useState, type ElementType, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useLabelT } from "@/lib/i18n"

/**
 * THE CONSOLE SHELL — one band at the top of a page: what this is · the numbers · what you
 * can do. The work starts directly under it.
 *
 * Measured on the nine boards at 1440×950 before this existed: a row of outlined stat cards
 * took 122px starting at y≈96, so the top fifth of every screen went to four boxes usually
 * reading zero, and a queue people read all day began below it. The figures are the same
 * figures — they have simply stopped being cards.
 *
 * HOW IT REACHES THE CARDS IT DID NOT RENDER.
 *
 * The stat cards live deep inside each view (DispatchBoard, PurchaseView, WalletDashboard…),
 * and lifting them would mean a render-prop through seven components. Instead the shell
 * publishes a DOM node, and `StatGrid` portals into it when one is present — so a page opts
 * in by being wrapped, and NOTHING about the views themselves changes. Outside a shell,
 * every StatGrid renders exactly as it always has.
 *
 * The node arrives by CALLBACK REF, not an effect: a ref callback re-renders on attach,
 * which is what the portal needs, and it keeps this off the `set-state-in-effect` path the
 * lint config rejects.
 */
const RailNode = createContext<HTMLElement | null>(null)
/** Where a view's own action row goes, so a page has ONE band of actions and not three. */
const ActionNode = createContext<HTMLElement | null>(null)
/** True only inside the rail. StatCard reads it to draw a figure instead of a card. */
const InRail = createContext(false)

export const useRailNode = () => useContext(RailNode)
export const useActionNode = () => useContext(ActionNode)

/**
 * Hoists a view's action row into the page band.
 *
 * Purchasing stacked SIX horizontal bands before any content: the top bar, the figure rail,
 * the page tabs, a floating Receive/Settings/New-PO row sitting on bare canvas belonging to
 * nothing, the Cart/Ongoing/History tabs, and finally the panel's own header. Shipping did
 * the same with Print/Add-label/More/Scanned/Finish.
 *
 * Wrapping that row in this puts it where the page's other actions already are. Outside a
 * ConsoleShell it renders in place exactly as before, so no existing caller changes.
 */
export function ActionsPortal({ children }: { children: ReactNode }) {
  const node = useActionNode()
  if (!node) return <>{children}</>
  return createPortal(children, node)
}
export const useInRail = () => useContext(InRail)

/** Renders `children` into the page header's figure rail, as figures rather than cards. */
export function RailPortal({ children }: { children: ReactNode }) {
  const node = useRailNode()
  if (!node) return null
  return createPortal(<InRail.Provider value={true}>{children}</InRail.Provider>, node)
}

export function ConsoleShell({
  title,
  icon: Icon,
  actions,
  tabs,
  bare,
  children,
}: {
  /** ENGLISH, used as its own key in the `nav` namespace — same contract as PageTitle, so a
   *  page and the sidebar item that opens it can never drift apart. */
  title: string
  icon?: ElementType
  /** The page's actions, right-aligned in the band. */
  actions?: ReactNode
  /** A tab bar, under the rule, so the tabs read as belonging to the page. */
  tabs?: ReactNode
  /** This page has no figures and no page-level actions, so on desktop there is no band to
   *  draw. The mobile hero still renders, because below md the top bar is gone. */
  bare?: boolean
  children: ReactNode
}) {
  const tl = useLabelT()
  const [rail, setRail] = useState<HTMLDivElement | null>(null)
  const [acts, setActs] = useState<HTMLSpanElement | null>(null)

  return (
    <RailNode.Provider value={rail}>
    <ActionNode.Provider value={acts}>
      <div className="space-y-4">
        {/* The rule belongs to whatever is LAST. A tab bar carries its own underline rail,
            so a border here as well draws two horizontal lines 20px apart, which reads as a
            rendering fault rather than a division. */}
        {/* NO BAND AT ALL when a page has nothing to put in it. Sourcing has no StatGrid and
            passes no actions, so on desktop — where naming the page is the top bar's job —
            this drew a rule and 4rem of padding around nothing. `:empty` cannot detect it:
            the rail and action slots are always present as elements, they just hide
            themselves. So the page says so. */}
        <div className={tabs ? undefined : (bare ? "max-md:border-b max-md:border-border" : "border-b border-border")}>
          <div className={"flex flex-wrap items-end gap-x-6 gap-y-3 pb-4" + (bare ? " md:hidden" : "")}>
            {/* MOBILE ONLY, and that is not a responsive nicety — it is the difference
                between one page title and two.
                topbar.tsx is `hidden … md:flex` and renders its own <h1> from the nav, so on
                desktop the page is ALREADY named above this band. Repeating it here printed
                "Purchasing" twice on every one of these pages and put two <h1>s in the
                document. Below md the top bar is gone, so the page has to name itself —
                which is exactly the `md:hidden` hero the original views carried before this
                component replaced them. */}
            <div className="flex min-w-0 items-center gap-2.5 pb-[7px] md:hidden">
              {Icon && <Icon size={20} weight="regular" className="shrink-0 text-muted-foreground" />}
              <h1 className="font-title text-2xl font-semibold tracking-tight">{tl("nav", title)}</h1>
            </div>

            {/* The rail SCROLLS rather than wraps: a figure that drops to its own line stops
                being comparable with the ones beside it, which is the only reason to put
                them in a row. The divider and padding only appear once something is in it —
                an empty rail must not leave a stray vertical rule beside the title. */}
            <div
              ref={setRail}
              /* The left rule and its padding exist to separate the rail from the MOBILE
                 title beside it. On desktop there is no title here, so the rail starts at
                 the page's own left edge like everything else on the page. */
              className="-mx-1 flex min-w-0 flex-1 items-end gap-6 overflow-x-auto px-1 pb-0.5 empty:hidden sm:gap-9 max-md:[&:not(:empty)]:border-l max-md:[&:not(:empty)]:border-border/70 max-md:[&:not(:empty)]:pl-6"
            />

            {/* One row, whatever fills it: `actions` passed by the page, plus anything a
                view hoists in through ActionsPortal. empty:hidden so a page with neither
                does not leave a gap. */}
            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 empty:hidden">
              {actions}
              <span ref={setActs} className="contents" />
            </div>
          </div>
          {tabs}
        </div>
        {children}
      </div>
    </ActionNode.Provider>
    </RailNode.Provider>
  )
}
