"use client"

/**
 * The React half of lib/motion.ts — the context and the hook.
 *
 * Separate from lib/motion.ts so that file stays importable from Server Components (the
 * marketing layout reads the stored presets there). This one is the client boundary.
 */
import { createContext, useContext } from "react"
import { DEFAULT_MOTION, type MotionPreset, type MotionSettings, type PresetName } from "@/lib/motion"

/**
 * DEFAULTED, NOT NULLABLE.
 *
 * A component using `Rise` outside the marketing layout — the login page, the preview panel in
 * Settings, whatever gets built next — animates with the house values rather than throwing or
 * standing still. There is no such thing as "no motion configured", only "not overridden".
 */
const MotionContext = createContext<MotionSettings>(DEFAULT_MOTION)

export function MotionProvider({ value, children }: { value: MotionSettings; children: React.ReactNode }) {
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>
}

export function useMotionPreset(name: PresetName = "rise"): MotionPreset {
  return useContext(MotionContext)[name] ?? DEFAULT_MOTION[name]
}
