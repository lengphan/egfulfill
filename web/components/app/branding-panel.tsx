"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleNotch, Check, Warning, UploadSimple } from "@phosphor-icons/react"
import { SectionCard } from "@/components/app/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getBranding, setBranding, uploadBrandingAsset, type Branding } from "@/lib/api"
import { ACCENTS, rememberAccent, type AccentKey } from "@/lib/accent"
import { SKINS, rememberSkin, type SkinKey } from "@/lib/skin"

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
 * own order status.
 *
 * THE ACCENT IS THE EXCEPTION, and it is the vetted-preset-with-a-contrast-gate version this
 * comment used to describe as future work. It is a KEY, not a colour: the values live in
 * globals.css, the server allow-lists the keys, and both went through
 * tools/check-pop-presets.mjs, which measures ink contrast on the fill and OKLab distance to
 * every reserved status colour in both themes. There are two, and two is the honest number —
 * an accent has to be a light enough FILL to carry dark text, which is exactly the band dark
 * mode packs every status colour into. The swatches paint themselves from the same CSS
 * declaration the app runs on, so this panel cannot show one colour and apply another.
 */
export function BrandingPanel() {
  const [b, setB] = useState<Branding | null>(null)
  const [appName, setAppName] = useState("")
  const [busy, setBusy] = useState<null | "save" | "favicon" | "logo">(null)
  const [saved, setSaved] = useState(false)
  const [accent, setAccentState] = useState<AccentKey>("rose")
  const [skin, setSkinState] = useState<SkinKey>("studio")
  const [err, setErr] = useState<string | null>(null)
  /**
   * A CACHE-BUSTER THAT DOES NOT REPEAT ITSELF.
   *
   * The favicon URL is stable by design — only the bytes behind it change — so the preview
   * needs a changing query or it shows the mark you just replaced. This was a counter
   * starting at 0, and it starts at 0 again on every mount: upload, leave the page, come
   * back, upload a different file, and the URL is `?v=1` for the second time. The browser
   * serves the FIRST image out of cache, and the panel says nothing has changed while the
   * server holds the new mark. That is exactly what "I changed it and it didn't save" looks
   * like when the save worked.
   *
   * A timestamp cannot collide with the previous one.
   */
  const [bust, setBust] = useState(0)
  const faviconRef = useRef<HTMLInputElement>(null)
  const logoRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    getBranding()
      .then((r) => {
        setB(r); setAppName(r.appName ?? "")
        if (r.accent === "rose" || r.accent === "lime") setAccentState(r.accent)
        if (r.skin === "studio" || r.skin === "press") setSkinState(r.skin)
      })
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

  /**
   * Paint FIRST, then save. Waiting for the round trip to show the colour makes choosing an
   * accent feel broken on a slow connection — you click a swatch and nothing happens. And if
   * the save fails the paint is put back, so the panel never shows an accent the server does
   * not hold.
   */
  const pickAccent = async (key: AccentKey) => {
    const before = accent
    setAccentState(key); rememberAccent(key); setErr(null)
    try {
      const r = await setBranding({ accent: key })
      if (r.error) throw new Error(r.error)
    } catch (e) {
      setAccentState(before); rememberAccent(before)
      setErr(e instanceof Error ? e.message : "Couldn't save the accent.")
    }
  }

  /** Same shape as pickAccent, and for the same reason: a palette that waits for a round
   *  trip before it moves reads as a control that did nothing. Reverted if the save fails,
   *  so the panel never shows a skin the server does not hold. */
  const pickSkin = async (key: SkinKey) => {
    const before = skin
    setSkinState(key); rememberSkin(key); setErr(null)
    try {
      const r = await setBranding({ skin: key })
      if (r.error) throw new Error(r.error)
    } catch (e) {
      setSkinState(before); rememberSkin(before)
      setErr(e instanceof Error ? e.message : "Couldn't save the palette.")
    }
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
      setBust(Date.now())
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
            {/* SAID WHERE IT HAPPENED. One "Saved" chip at the bottom of a panel with three
                controls cannot tell you WHICH of them saved, and it is 40cm from the mark
                you just replaced. */}
            <p className="mt-1.5 text-2xs text-muted-foreground">
              Saves the moment you upload — no Save needed. The tab may take a minute to
              catch up, and a hard reload is instant.
            </p>
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

        <div>
          <p className="text-sm font-medium">Palette</p>
          {/**
            * THE SITE'S COLOURS, CHANGEABLE WITHOUT A DEPLOY — which is the whole reason this
            * exists. Every previous palette change was a code edit and a release, and on a
            * site carrying live orders that is the last thing anyone wants to be doing in
            * order to try a shade.
            *
            * A KEY, not a colour, exactly as the accent below. globals.css owns the values
            * under [data-skin="…"], the server allow-lists the keys, and the swatches paint
            * themselves from that same declaration — so this panel cannot preview one
            * palette and apply another.
            */}
          <div className="mt-2 flex flex-wrap gap-2">
            {SKINS.map((sk) => (
              <button
                key={sk.key}
                type="button"
                onClick={() => void pickSkin(sk.key)}
                aria-pressed={skin === sk.key}
                className={"flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors " +
                  (skin === sk.key ? "border-foreground" : "border-border hover:border-foreground/30")}
              >
                {/* THE PLATE OVER THE PAPER, which is the one thing that actually separates
                    the two: a dark rectangle on white, or a violet one on warm paper. Both
                    resolved through data-skin, never from a hex typed in here. */}
                <span data-skin={sk.key} className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-md border border-border"
                  style={{ background: "var(--mk-surface)" }}>
                  <span className="size-3 rounded-[3px]" style={{ background: "var(--mk-accent)" }} />
                </span>
                <span>
                  <span className="block text-sm font-medium">{sk.label}</span>
                  <span className="block text-xs text-muted-foreground">{sk.what}</span>
                </span>
                {skin === sk.key && <Check size={14} weight="bold" className="ml-1 shrink-0" />}
              </button>
            ))}
          </div>
          {/* THE LIMIT, SAID PLAINLY rather than discovered. The public marketing pages are
              served to people with no session, so they render whatever globals.css declares
              on :root — this choice reaches the app, the boards and sign-in. */}
          <p className="mt-2 text-xs text-muted-foreground">Applies to the app, the boards and sign-in. The public pages use the built-in default.</p>
        </div>

        <div>
          <p className="text-sm font-medium">Accent</p>
          {/* The one colour in the app, and it carries one meaning: something is new and it
              is for you. Unread badge, unread dot, unread row — nothing else, because an
              accent spent on two things is just a second UI colour. */}
          <div className="mt-2 flex flex-wrap gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => void pickAccent(a.key)}
                aria-pressed={accent === a.key}
                className={"flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors " +
                  (accent === a.key ? "border-foreground" : "border-border hover:border-foreground/30")}
              >
                {/* data-pop on the SWATCH: globals.css declares [data-pop="…"] as a plain
                    attribute rule, so the chip resolves var(--pop) to that preset's own
                    value — the same declaration the app runs on. A hex copied into this file
                    is how a settings panel ends up previewing a colour it doesn't apply. */}
                <span data-pop={a.key} className="size-6 shrink-0 rounded-md" style={{ background: "var(--pop)" }} />
                <span>
                  <span className="block text-sm font-medium">{a.label}</span>
                  <span className="block text-xs text-muted-foreground">{a.what}</span>
                </span>
                {accent === a.key && <Check size={14} weight="bold" className="ml-1 shrink-0" />}
              </button>
            ))}
          </div>
        </div>

        {err && <p className="text-sm text-destructive">{err}</p>}

        <div className="flex flex-wrap items-center gap-3">
          {/* SAVE IS FOR THE NAME, and it has to say so. It was one unlabelled Save under a
              panel with three controls, disabled whenever the name had not been edited — so
              after replacing a mark it sat greyed out, and the only reading available was
              "this panel refuses to save". The uploads write immediately and always did;
              the button never governed them. */}
          <Button
            size="sm" onClick={save}
            disabled={busy === "save" || appName === (b?.appName ?? "")}
            title={appName === (b?.appName ?? "") ? "The app name hasn't changed. Marks save the moment you upload them." : undefined}
          >
            {busy === "save" ? "Saving…" : "Save app name"}
          </Button>
          {saved && <span className="inline-flex items-center gap-1 text-sm text-success"><Check size={14} weight="bold" /> Saved</span>}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <Warning size={14} className="mt-0.5 shrink-0" />
          <span>
            The palette and the accent are chosen from presets that have been measured, never typed as a colour. What a preset cannot reach is set in code: <strong>--primary</strong> inks around 247 pieces of text as well as filling buttons, and the status colours (shipped, hold, alert) carry meaning on the floor — so a free picker could make a quarter of the app unreadable without anyone noticing. Ask for another preset and it can be added properly, with the contrast measured.
          </span>
        </div>
      </div>
    </SectionCard>
  )
}
