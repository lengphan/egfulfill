"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Check, Warning, UploadSimple } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getBranding, setBranding, uploadBrandingAsset, type Branding } from "@/lib/api"

/**
 * BRANDING — the marks and the name, changeable without a deploy.
 *
 * What is NOT here, on purpose: the palette and the typeface.
 *
 * `--primary` inks ~247 pieces of TEXT as well as filling buttons, the status colours carry
 * meaning on the factory floor (emerald shipped, amber hold, red alert), and contrast in
 * this app is measured rather than eyeballed — cream on the periwinkle plate is 1.83:1, a
 * documented ghost. A free colour picker here is a way to make a quarter of the app
 * unreadable in four seconds, and nobody would notice until a seller could not read their
 * own order status. Colours belong behind vetted presets with a contrast gate; that is a
 * separate piece of work, not a text field.
 */
export function BrandingPanel() {
  const [b, setB] = useState<Branding | null>(null)
  const [appName, setAppName] = useState("")
  const [busy, setBusy] = useState<null | "save" | "favicon" | "logo">(null)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** Bumped after an upload so the browser re-fetches a URL that did not change. */
  const [bust, setBust] = useState(0)
  const faviconRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    getBranding()
      .then((r) => { setB(r); setAppName(r.appName ?? "") })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load branding."))
  }, [])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  const save = async () => {
    setBusy("save"); setErr(null); setSaved(false)
    try {
      const r = await setBranding({ appName: appName.trim() })
      if (r.error) throw new Error(r.error)
      setB((p) => ({ ...(p ?? {}), ...r }))
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save.")
    } finally { setBusy(null) }
  }

  const upload = async (kind: "favicon" | "logo", file?: File) => {
    if (!file) return
    // 2MB is the server's ceiling; catching it here means a clear sentence instead of a 413.
    if (file.size > 2 * 1024 * 1024) { setErr("That file is over 2MB — a mark should be far smaller."); return }
    setBusy(kind); setErr(null)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(String(fr.result))
        fr.onerror = () => rej(new Error("Couldn't read that file."))
        fr.readAsDataURL(file)
      })
      const r = await uploadBrandingAsset(kind, dataUrl)
      if (r.error || !r.url) throw new Error(r.error || "Upload failed.")
      setB((p) => ({ ...(p ?? {}), [kind === "favicon" ? "faviconUrl" : "logoUrl"]: r.url }))
      setBust((n) => n + 1)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.")
    } finally {
      setBusy(null)
      if (kind === "favicon" && faviconRef.current) faviconRef.current.value = ""
      if (kind === "logo" && logoRef.current) logoRef.current.value = ""
    }
  }

  // The favicon URL is stable by design — only the bytes behind it change — so a preview
  // needs a cache-buster or it shows the mark you just replaced.
  const faviconSrc = b?.faviconUrl ? `${b.faviconUrl}${b.faviconUrl.includes("?") ? "&" : "?"}v=${bust}` : ""

  return (
    <SectionCard title="Branding" bodyClassName="p-5">
      <div className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
          {/* FAVICON */}
          <div>
            <p className="text-sm font-medium">Favicon</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The browser tab, the phone home screen and the installed app. Upload one <strong>512&times;512 PNG</strong>, square, mark centred — everything else is scaled from it.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex size-14 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
                {faviconSrc
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={faviconSrc} alt="" className="size-full object-contain" />
                  : <span className="text-2xs text-muted-foreground">none</span>}
              </span>
              <input ref={faviconRef} type="file" accept="image/png,image/jpeg,image/webp,image/x-icon,image/svg+xml"
                     className="hidden" onChange={(e) => upload("favicon", e.target.files?.[0])} />
              <Button size="sm" variant="outline" disabled={busy === "favicon"} onClick={() => faviconRef.current?.click()}>
                {busy === "favicon" ? <CircleNotch size={14} className="animate-spin" /> : <UploadSimple size={14} />}
                {busy === "favicon" ? "Uploading…" : "Replace"}
              </Button>
            </div>
          </div>

          {/* LOGO */}
          <div>
            <p className="text-sm font-medium">Logo</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Used on emails and printed sheets. A wide PNG or SVG with transparent ground.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex h-14 w-28 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40 px-2">
                {b?.logoUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={b.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
                  : <span className="text-2xs text-muted-foreground">none</span>}
              </span>
              <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                     className="hidden" onChange={(e) => upload("logo", e.target.files?.[0])} />
              <Button size="sm" variant="outline" disabled={busy === "logo"} onClick={() => logoRef.current?.click()}>
                {busy === "logo" ? <CircleNotch size={14} className="animate-spin" /> : <UploadSimple size={14} />}
                {busy === "logo" ? "Uploading…" : "Replace"}
              </Button>
            </div>
          </div>
        </div>

        <label className="flex max-w-sm flex-col gap-1.5">
          <span className="text-sm font-medium">App name</span>
          <Input value={appName} onChange={(e) => { setAppName(e.target.value); setSaved(false) }} placeholder="EGFUL" maxLength={60} />
          <span className="text-xs text-muted-foreground">Shown on the phone home screen, which fits about 12 characters.</span>
        </label>

        {err && <p className="text-sm text-destructive">{err}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={save} disabled={busy === "save" || appName === (b?.appName ?? "")}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          {saved && <span className="inline-flex items-center gap-1 text-sm text-success"><Check size={14} weight="bold" /> Saved</span>}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <Warning size={14} className="mt-0.5 shrink-0" />
          <span>
            Colours and typefaces are set in code, not here. <strong>--primary</strong> inks around 247 pieces of text as well as filling buttons, and the status colours (shipped, hold, alert) carry meaning on the floor — so a picker in this panel could make a quarter of the app unreadable without anyone noticing. Ask and they can be changed properly, with the contrast measured.
          </span>
        </div>
      </div>
    </SectionCard>
  )
}
