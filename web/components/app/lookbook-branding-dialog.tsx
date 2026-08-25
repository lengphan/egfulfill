"use client"

import { useLabelT } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getFactorySettings, setFactorySettings } from "@/lib/api"
/* The SAME default the catalogue falls back to when no accent is set. It was typed here
   twice as a literal, so the swatch could have offered one colour while the print used
   another — a picker whose default disagrees with the thing it configures. */
import { HOUSE_ACCENT } from "@/components/app/catalog-print"

/** `title` is who publishes it — the wordmark on the cover and in every footer. `headline` is
 *  what this edition is CALLED, set in 72px on the cover. Two different things: a private-label
 *  buyer changes one of them and not the other. */
export type LookbookBrand = {
  title: string; headline: string; tagline: string; accent: string; contact: string
  /** The back cover's reach-us block, one field each so it can be laid out and so a missing
   *  one is visible rather than buried in a paragraph. Blank rows are not printed. */
  email: string; phone: string; site: string; address: string
}

/**
 * THE COVER, EDITED WHERE THE COVER IS.
 *
 * These four fields lived in Settings › Platform, three screens from the document they
 * describe — so setting a cover colour meant leaving the catalogue, typing a hex, coming back
 * and looking. They are not platform policy like a postage band; they are this document's
 * masthead, and the only way to judge them is against the page.
 *
 * It writes through setFactorySettings, which is admin-only server-side, so the button that
 * opens this is gated to admin as well: a warehouse user who can print a catalogue would
 * otherwise meet a 403 after typing.
 *
 * `onSaved` hands the values straight back, so the sheet behind repaints without a refetch —
 * the whole point of editing here rather than there.
 */
export function LookbookBrandingDialog({
  open, onOpenChange, brand, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  brand: LookbookBrand
  onSaved: (b: LookbookBrand) => void
}) {
  const tl = useLabelT()
  const [title, setTitle] = useState(brand.title)
  const [headline, setHeadline] = useState(brand.headline)
  const [tagline, setTagline] = useState(brand.tagline)
  const [accent, setAccent] = useState(brand.accent)
  const [contact, setContact] = useState(brand.contact)
  const [email, setEmail] = useState(brand.email)
  const [phone, setPhone] = useState(brand.phone)
  const [site, setSite] = useState(brand.site)
  const [address, setAddress] = useState(brand.address)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Re-seeded on OPEN, not on mount: the dialog stays mounted between opens, so a value
  // saved and then reopened would otherwise show what was typed the first time.
  // Deferred, per this codebase's react-hooks/set-state-in-effect rule: a straight setState
  // in an effect body cascades a render before paint, and every app page defers the same way.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setTitle(brand.title); setHeadline(brand.headline)
      setTagline(brand.tagline); setAccent(brand.accent); setContact(brand.contact)
      setEmail(brand.email); setPhone(brand.phone); setSite(brand.site); setAddress(brand.address)
      setErr(null)
    }, 0)
    return () => clearTimeout(t)
  }, [open, brand])

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      /**
       * READ, THEN WRITE THE WHOLE OBJECT.
       *
       * setFactorySettings replaces what it is sent, and this dialog knows four of the
       * platform's several dozen fields. Posting only these would blank every fee and band on
       * the way past. So the current settings are read and the four are laid over them —
       * expensive-looking and correct, where the cheap version silently deletes the price
       * list.
       */
      const cur = (await getFactorySettings()) as Record<string, unknown>
      const r = await setFactorySettings({
        ...cur,
        lookbook_title: title.trim(),
        lookbook_headline: headline.trim(),
        lookbook_tagline: tagline.trim(),
        lookbook_accent: accent.trim(),
        lookbook_contact: contact,
        lookbook_email: email.trim(),
        lookbook_phone: phone.trim(),
        lookbook_site: site.trim(),
        lookbook_address: address,
      } as Parameters<typeof setFactorySettings>[0])
      if ((r as { error?: string })?.error) throw new Error((r as { error?: string }).error!)
      onSaved({
        title: title.trim() || "EGFUL",
        headline: headline.trim() || "The catalogue",
        tagline: tagline.trim(), accent: accent.trim(), contact,
        email: email.trim(), phone: phone.trim(), site: site.trim(), address,
      })
      onOpenChange(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the branding.")
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{tl("lookbook", "Lookbook branding")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">{tl("lookbook", "Name on the cover")}</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="EGFUL" className="h-9" />
            <span className="block text-2xs text-muted-foreground">{tl("lookbook", "Also the wordmark in each page footer.")}</span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{tl("lookbook", "Lookbook name")}</span>
            <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder={tl("lookbook", "The catalogue")} className="h-9" />
            {/* Said because the cover sets it in 72px and breaks it before the last word: a
                long name is a small name. */}
            <span className="block text-2xs text-muted-foreground">
              {tl("lookbook", "The big words on the cover. Two or three words print best — the last one drops to its own line.")}
            </span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{tl("lookbook", "Cover tagline")}</span>
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder={tl("lookbook", "Print-on-demand, made to order")} className="h-9" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{tl("lookbook", "Accent colour")}</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : HOUSE_ACCENT}
                onChange={(e) => setAccent(e.target.value)}
                aria-label={tl("lookbook", "Lookbook accent colour")}
                className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
              />
              <Input value={accent} onChange={(e) => setAccent(e.target.value)} placeholder={HOUSE_ACCENT} className="h-9 flex-1 tabular-nums" />
            </div>
            {/* Stated rather than discovered at the printer: the covers reverse cream type out
                of this colour, so a light value makes the title vanish. */}
            <span className="block text-2xs text-muted-foreground">
              {tl("lookbook", "Prints full-bleed on the covers with the title reversed out — keep it dark.")}
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium">{tl("lookbook", "Email")}</span>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tl("lookbook", "orders@egful.store")} className="h-9" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{tl("lookbook", "Phone")}</span>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 …" className="h-9" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{tl("lookbook", "Online")}</span>
              <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="egful.store" className="h-9" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{tl("lookbook", "Address")}</span>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={tl("lookbook", "City, country")} className="h-9" />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{tl("lookbook", "Anything else on the back cover")}</span>
            <textarea
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              rows={2}
              placeholder={tl("lookbook", "orders@egful.store\negful.store")}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
            <span className="block text-2xs text-muted-foreground">{tl("lookbook", "Left blank, the block is omitted rather than printed empty.")}</span>
          </label>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{tl("lookbook", "Cancel")}</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? tl("lookbook", "Saving…") : tl("lookbook", "Save branding")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
