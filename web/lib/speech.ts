"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * DICTATION — speak instead of typing, anywhere there is a box you write into.
 *
 * The Web Speech API, which every Chromium browser and Safari already ship. That choice is
 * the whole design:
 *
 *  - It costs NOTHING and needs no key. The alternative (post the audio to Whisper or
 *    Google STT) bills per minute, needs a credential, and would have to be metered and
 *    booked to wallet_ledger like every other AI call here. Dictating a sentence into a
 *    prompt box is not worth building a billing path for.
 *  - It needs no server route, so it cannot 502 the API.
 *  - It is not universal. Firefox does not implement it, and that has to be SAID rather
 *    than shown as a mic button that does nothing (CLAUDE.md §4: an empty state must never
 *    look identical to a broken feature). `supported` is false there and callers hide the
 *    control.
 *
 * The audio does leave the machine on Chrome — it goes to Google's recogniser, the same as
 * dictation in the OS. Worth knowing before this is pointed at anything confidential; it is
 * fine for a chat message or an image prompt, which is all it is wired to.
 */

/* The API is not in TypeScript's DOM lib, so the shape we use is declared here rather than
   pulled in as a dependency. Only the members this file touches. */
type SpeechRecognitionAlternativeLike = { transcript: string }
type SpeechRecognitionResultLike = { isFinal: boolean; 0: SpeechRecognitionAlternativeLike; length: number }
type SpeechRecognitionEventLike = { resultIndex: number; results: { length: number } & Record<number, SpeechRecognitionResultLike> }
type SpeechRecognitionErrorEventLike = { error: string }
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function ctor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Can this browser dictate at all? Safe on the server — returns false during SSR, and the
 *  hook re-checks on mount so the control appears once hydrated rather than never. */
export const dictationSupported = () => ctor() !== null

/** Our two app locales → the BCP-47 tags the recogniser wants. A Vietnamese speaker
 *  dictating into an `en-US` recogniser gets confident nonsense, not an error, which is the
 *  worst failure available — so the language follows the app's own switcher. */
const RECOGNISER_LANG: Record<string, string> = { en: "en-US", vi: "vi-VN" }
export const recogniserLang = (locale: string | undefined) => RECOGNISER_LANG[String(locale ?? "en")] ?? "en-US"

/**
 * A recogniser that hands finished phrases to `onText` and exposes what it is still
 * hearing as `interim`.
 *
 * `onText` receives a CHUNK, not the whole transcript — the caller decides where it lands,
 * which is what lets the same hook serve a chat composer that appends at the caret and a
 * prompt box that appends at the end.
 */
export function useDictation({ lang, onText, onInterim }: {
  lang: string
  onText: (chunk: string) => void
  /** Words heard but not yet settled, fired as they change. The caller decides where they
   *  go; nothing here draws them. */
  onInterim?: (text: string) => void
}) {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState("")
  const [error, setError] = useState<string | null>(null)

  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const wantOnRef = useRef(false)
  /**
   * RESTARTS ARE BOUNDED, and this is not a formality.
   *
   * Chrome ends a recognition session on a long silence even with `continuous`, so holding
   * the mic on across a pause means starting it again — and "restart it when it ends" is
   * precisely the shape CLAUDE.md §2.8 is about: a handler that re-arms on the state its
   * own action produced. If the microphone is dead or the tab is muted, `onend` fires
   * immediately and the pair spins as fast as the browser allows.
   *
   * So: the counter resets every time speech is actually heard, and 20 consecutive restarts
   * with nothing said means the person walked away — it stops and says so. An ERROR never
   * restarts at all.
   */
  const restartsRef = useRef(0)
  /* Latest-value refs, written in an effect rather than during render — `react-hooks/refs`
     forbids the render-phase assignment, and the recogniser only reads these from its own
     callbacks, which always run after commit. */
  const onTextRef = useRef(onText)
  const onInterimRef = useRef(onInterim)
  const langRef = useRef(lang)
  useEffect(() => { onTextRef.current = onText; onInterimRef.current = onInterim; langRef.current = lang })

  /* Deferred with setTimeout(fn, 0) — the pattern used across the app pages, because
     `react-hooks/set-state-in-effect` rejects a synchronous setState in an effect body.
     It cannot be initial state either: `ctor()` reads `window`, and this renders on the
     server first. So the button appears a tick after hydration rather than never. */
  useEffect(() => {
    const id = setTimeout(() => setSupported(ctor() !== null), 0)
    return () => clearTimeout(id)
  }, [])

  const stop = useCallback(() => {
    wantOnRef.current = false
    restartsRef.current = 0
    setListening(false)
    setInterim("")
    const r = recRef.current
    recRef.current = null
    if (r) { r.onend = null; r.onresult = null; r.onerror = null; try { r.stop() } catch { /* already stopped */ } }
  }, [])

  const start = useCallback(() => {
    const C = ctor()
    if (!C) { setError("This browser can't do speech recognition. Chrome, Edge and Safari can."); return }
    if (recRef.current) return
    setError(null)
    wantOnRef.current = true

    const spawn = () => {
      const r = new C()
      recRef.current = r
      r.lang = langRef.current
      r.continuous = true
      r.interimResults = true
      r.maxAlternatives = 1

      r.onresult = (e) => {
        restartsRef.current = 0            // speech heard — the run is healthy
        let live = ""
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]
          const text = res[0]?.transcript ?? ""
          if (res.isFinal) { const t = text.trim(); if (t) onTextRef.current(t) }
          else live += text
        }
        setInterim(live)
        // From the recogniser's own callback, not an effect — this is an event, and the
        // caller writes it straight into whatever field it owns.
        onInterimRef.current?.(live)
      }

      r.onerror = (e) => {
        // `no-speech` and `aborted` are ordinary — someone paused, or pressed stop. Anything
        // else ends the session with a sentence, because a mic button that silently does
        // nothing is the failure this whole file is trying not to ship.
        if (e.error === "no-speech" || e.error === "aborted") return
        wantOnRef.current = false
        setError(
          e.error === "not-allowed" || e.error === "service-not-allowed"
            ? "Microphone access was refused. Allow it for this site in your browser's address bar, then try again."
            : e.error === "network"
              ? "Speech recognition couldn't reach the network."
              : `Speech recognition stopped: ${e.error}`,
        )
      }

      r.onend = () => {
        recRef.current = null
        setInterim("")
        if (!wantOnRef.current) { setListening(false); return }
        if (restartsRef.current >= 20) {
          wantOnRef.current = false
          setListening(false)
          setError("Stopped listening — nothing was said for a while.")
          return
        }
        restartsRef.current += 1
        spawn()
      }

      try { r.start() } catch { /* start() throws if one is already running; onend will settle it */ }
    }

    setListening(true)
    spawn()
  }, [])

  const toggle = useCallback(() => { if (wantOnRef.current) stop(); else start() }, [start, stop])

  // Never leave a live microphone behind when the surface unmounts.
  useEffect(() => stop, [stop])

  return { supported, listening, interim, error, start, stop, toggle, clearError: () => setError(null) }
}
