import type { Metadata, Viewport } from "next"
import { Geist_Mono, Inter, Outfit, Space_Grotesk } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { LanguageProvider } from "@/lib/i18n"
import { SITE_URL } from "@/lib/site-url"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

/**
 * A SECOND FACE, AND ITS SCOPE IS THE POINT.
 *
 * Playfair was dropped because two alphabets ran through one PRODUCT — it set every screen
 * title in the app and on mobile, so a seller met different letterforms in the place they
 * look first. That argument is about the product, and it still holds: nothing below
 * `app/(app)` or `app/(boards)` gets this, and mobile does not get it at all.
 *
 * What it does not cover is the five PUBLIC pages, which have one job — looking like a
 * company worth buying from — and where Inter's narrow, neutral letterforms are the single
 * biggest reason those pages read as a template. Outfit is wide and geometric: the same
 * family of shape the reference boards are set in, and (unlike the serif) still a sans, so
 * headline and body are one voice at two weights rather than two voices.
 *
 * NEITHER IS WIRED HERE. Only the variables are loaded; which one a visitor sees is a stored
 * KEY an admin picks in Settings › Branding, applied as `data-face` on the marketing wrapper
 * (see app/(marketing)/layout.tsx and the one selector in globals.css). Loading them at the
 * root is only so `next/font` owns the preload, the self-hosted file and the fallback metrics
 * — a stored family name would be a string the browser looks up locally and fails to find.
 *
 * BOTH ARE ALWAYS DOWNLOADED, which is the honest cost of making the choice runtime rather
 * than a deploy: two display faces at three weights each. They are subset to latin and only
 * ever set headlines, so it is a handful of KB — and the alternative is a code change and a
 * deploy every time someone wants to try a typeface, which is the thing the skin already
 * refused to be.
 *
 * Display weights only — 500/600/700. A body weight would invite it into body copy, which is
 * exactly the drift the Playfair note warns about.
 */
const outfit = Outfit({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-outfit" })
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-grotesk" })

/**
 * ONE FACE. Inter, for everything.
 *
 * There was a second — Playfair Display — for the marketing hero and auth, on the argument
 * that a high-contrast serif carries a voice a geometric sans cannot. Fraunces, Space
 * Grotesk and Outfit were tried and rejected before it, each for its own reason, and that
 * search is worth remembering only for its conclusion: it was chasing "sophisticated", and
 * the answer turned out to be fewer things rather than a better serif.
 *
 * It is dropped. `--font-display` and `--font-title` both resolve to this stack in
 * globals.css, so roughly a hundred `font-display` call sites needed no edit at all — and
 * one fewer webfont is downloaded on every first paint.
 */

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--tabular-nums",
})

export const metadata: Metadata = {
  // Makes every relative canonical/OG URL resolve against the app's own host rather than
  // localhost. Without it Next warns at build and social cards point nowhere.
  metadataBase: new URL(SITE_URL),
  title: { default: "EGFUL", template: "%s · EGFUL" },
  // Search Console URL-prefix property for app.egful.store. The DNS method can't be used:
  // app.egful.store is a CNAME to Vercel, so a TXT record at that name is never resolvable.
  verification: { google: "iEGQO5RIl12PF_7Mjt00ZtOhbanPeohsHG6Pnd6uCLE" },
  // Lets iOS run the installed app full-screen (Android reads the manifest).
  appleWebApp: { capable: true, title: "EGFUL Staff", statusBarStyle: "black-translucent" },
  /*
   * iOS DOES NOT READ THE WEB MANIFEST FOR ADD TO HOME SCREEN.
   *
   * Android takes its icon from manifest.icons; Safari looks for a rel="apple-touch-icon"
   * link and, finding none, renders a SCREENSHOT of the page as the home-screen icon. So
   * every iPhone install so far has been getting a blurry picture of whatever was on screen
   * instead of the mark — invisible from the desktop, and the first thing you see on a phone.
   *
   * `apple` is the one that matters here; `icon` keeps the manifest and the tab in step.
   */
  /**
   * THE UPLOADED MARK, not a file baked into the build.
   *
   * Settings › Branding uploads a favicon, stores it, and serves it at
   * /api/branding/favicon — and nothing ever pointed the browser at that URL. The tab kept
   * rendering the packaged icon, so the upload appeared to do nothing at all, which is
   * exactly what it looked like.
   *
   * The route NEVER 404s: uploaded mark if there is one, bundled default otherwise, so
   * pointing at it costs nothing on a deployment that has never uploaded one. It sends
   * max-age=300, so a changed mark appears within five minutes rather than being cached
   * for the life of the tab.
   *
   * `app/favicon.ico` and `app/icon.png` had to GO with this: Next's file convention emits
   * its own <link rel="icon"> and that one wins over anything declared here, so leaving
   * them would have kept the packaged icon winning silently. They are in public/ as
   * fallback-icon.* — nothing links them, and the server's own default is the real
   * fallback.
   */
  icons: {
    icon: [{ url: "/api/branding/favicon", type: "image/png" }],
    apple: [{ url: "/api/branding/favicon", sizes: "180x180", type: "image/png" }],
  },
}
// viewport-fit=cover so the scanner overlay reaches under the iPhone notch.
export const viewport: Viewport = {
  themeColor: "#1a1a18",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", inter.variable, outfit.variable, grotesk.variable)}
    >
      <body>
        {/* Zoom, applied BEFORE first paint.
            Same trick next-themes uses for dark mode, and for the same reason: read from a
            React effect and every load renders at 100% for a frame and then jumps, which reads
            as "my setting didn't save" rather than as a repaint. This is a blocking inline
            script by design — it must run before the body is painted. Kept to one guarded
            statement so a corrupt value can never stop the page booting.

            FIRST CHILD OF <body>, not a child of <html>. React 19 refuses to place a sync
            script between <html> and <body> — "Cannot render a sync or defer <script> outside
            the main document without knowing its order" — and the mismatch it causes takes
            HYDRATION down with it, so the whole app stops at its loading spinner and never
            issues a single request. That is what it was doing in dev: a blank shell, no
            network, no error visible on the page itself.

            The behaviour is unchanged. The browser still executes this synchronously while
            parsing, before anything below it is painted, and document.documentElement exists
            by then — it is the element we are already inside. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var z=parseFloat(localStorage.getItem('eg_zoom'));if(z>0.5&&z<3)document.documentElement.style.setProperty('--eg-zoom',String(z))}catch(e){}`,
          }}
        />
        <ThemeProvider>
          <LanguageProvider>
            {/* The zoom lives HERE, not on <body>, and that placement is load-bearing.
                Base UI portals every menu, popover and tooltip to document.body. A popup is
                positioned from the trigger's getBoundingClientRect, which already reports
                zoomed pixels — so while the zoom was on <body>, the popup applied that zoom a
                second time and drifted further from its trigger the further right the trigger
                sat. Keeping portals OUTSIDE the zoomed element is what makes the coordinates
                line up. */}
            <div className="eg-zoom-root">{children}</div>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
