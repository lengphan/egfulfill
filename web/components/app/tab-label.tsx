"use client"

import { useLabelT } from "@/lib/i18n"

/**
 * A word in a board's tab row.
 *
 * These live in `const TABS = [...]` arrays at module scope, where a hook cannot reach them,
 * and translating at each render site meant adding a hook to nine components. As a leaf it is
 * one import and one swap per board, and the tab arrays stay plain data — which matters,
 * because their `id` is what the code branches on and only the `label` is ever shown.
 *
 * English is the key (useLabelT, `tab` namespace), so an untranslated tab stays English
 * instead of going blank.
 */
export function TabLabel({ children }: { children: string }) {
  const tl = useLabelT()
  return <>{tl("tab", children)}</>
}
