import type { Metadata, Viewport } from "next"
import { Geist_Mono, Inter, Playfair_Display } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { LanguageProvider } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

/**
 * MARKETING DISPLAY FACE — Playfair Display. Chosen from a rendered specimen of the real
 * headline on the real plate, not from a description.
 *
 * Three faces were tried and rejected here first, and the reasons are worth keeping because
 * each one was a different mistake:
 *
 *   Fraunces        the original. Judged to lack character — correctly, as shipped: its
 *                   personality lives in custom SOFT/WONK axes that were both at zero.
 *   Space Grotesk   a WIDE face. At the hero's 6.2rem its generous sidebearings scale up
 *                   with the type, so the headline read as spaced-out letters, not words.
 *   Outfit          narrow and punchy with a real 900, but a neutral geometric sans has no
 *                   voice by design — "alright, but not sophisticated".
 *
 * Playfair Display is a high-contrast transitional serif: the dramatic thick/thin stroke
 * modulation is what reads as "sophisticated", and it is exactly what a geometric sans
 * cannot do at any weight. Variable 400–900, so `font-display font-black` is a real 900.
 *
 * NOTE it is a WIDE face — wider than Outfit — so the hero wraps to two lines where Outfit
 * fit one. That is a compositional change, not a bug; the hero's leading is already tuned
 * for a two-line headline.
 *
 * This face is MARKETING + auth only. App page titles take `--font-title`; see globals.css.
 */
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display-face",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: { default: "EGFULFILL", template: "%s · EGFULFILL" },
  // Lets iOS run the installed app full-screen (Android reads the manifest).
  appleWebApp: { capable: true, title: "EGFULFILL Staff", statusBarStyle: "black-translucent" },
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
      className={cn("antialiased", fontMono.variable, "font-sans", inter.variable, playfair.variable)}
    >
      {/* Zoom, applied BEFORE first paint.
          Same trick next-themes uses for dark mode, and for the same reason: read from a
          React effect and every load renders at 100% for a frame and then jumps, which reads
          as "my setting didn't save" rather than as a repaint. This is a blocking inline
          script by design — it must run before the body is painted. Kept to one guarded
          statement so a corrupt value can never stop the page booting. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{var z=parseFloat(localStorage.getItem('eg_zoom'));if(z>0.5&&z<3)document.documentElement.style.setProperty('--eg-zoom',String(z))}catch(e){}`,
        }}
      />
      <body>
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
