"use client"

import { useLabelT } from "@/lib/i18n"

/**
 * The heading at the top of a page or board.
 *
 * Every board had this as a bare `<h1>` with an English word inside, which is why the
 * sidebar could say "Kho hàng" while the page it opened said "Inventory". Translating it
 * here rather than at each board means a new board gets it for free, and there is one
 * place to change the type scale.
 *
 * `children` is the ENGLISH title, used as its own key (useLabelT) in the same `nav`
 * namespace the sidebar uses — so a board and the nav item that opens it can never drift
 * apart, and a title with no translation stays English rather than rendering blank.
 */
export function PageTitle({ children }: { children: string }) {
  const tl = useLabelT()
  return <h1 className="font-title text-2xl font-semibold tracking-tight">{tl("nav", children)}</h1>
}
