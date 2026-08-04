import type { Metadata, Viewport } from "next"
import { Geist_Mono, Inter, Fraunces } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { LanguageProvider } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

// Editorial serif for marketing display headlines (used via the `font-display`
// utility). The app UI stays all-Inter.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
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
      className={cn("antialiased", fontMono.variable, "font-sans", inter.variable, fraunces.variable)}
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
          <LanguageProvider>{children}</LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
