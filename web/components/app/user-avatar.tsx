"use client"

import { type User } from "@/lib/auth"

// The ONE place a user avatar is drawn — topbar, settings preview, anywhere else.
// Cosmetic only: an optional emoji + colour, falling back to the name's initial on
// the default dark chip, which is exactly what shipped before avatars existed.
export const AVATAR_COLORS = [
  "#111827", // default (near-black chip)
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#64748b", // slate
]

export const AVATAR_EMOJIS = ["🐙", "🦊", "🐳", "🌵", "🍄", "⚡", "🔥", "🌙", "⭐", "🎨", "🧵", "📦", "🚀", "🍩", "🐝", "🦄"]

/** Readable text on a given chip colour — light chips need dark glyphs. */
const onColor = (hex?: string | null) => {
  if (!hex) return "#ffffff"
  const h = hex.replace("#", "")
  if (h.length !== 6) return "#ffffff"
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  // Perceived luminance — the same rule the badge colours use.
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111827" : "#ffffff"
}

export function UserAvatar({
  user,
  size = 32,
  className = "",
}: {
  user?: Pick<User, "name" | "avatar_emoji" | "avatar_color"> | null
  size?: number
  className?: string
}) {
  const emoji = user?.avatar_emoji || ""
  const bg = user?.avatar_color || "#111827"
  const initial = (user?.name || "?").charAt(0).toUpperCase()
  return (
    <span
      aria-hidden
      className={"inline-flex shrink-0 items-center justify-center rounded-full font-bold " + className}
      style={{
        width: size,
        height: size,
        background: bg,
        color: onColor(bg),
        // Emoji render at their own colour, so size them by the chip instead.
        fontSize: emoji ? Math.round(size * 0.52) : Math.round(size * 0.42),
        lineHeight: 1,
      }}
    >
      {emoji || initial}
    </span>
  )
}
