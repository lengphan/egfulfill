"use client"

import { useEffect, useRef } from "react"
import { useReducedMotion } from "motion/react"

/**
 * Rotating dot-matrix globe rendered on canvas. Points are distributed with a
 * fibonacci sphere, rotated around the Y axis, and depth-shaded front-to-back.
 * A handful of "network nodes" pulse in brand violet to read as live shipping
 * hubs. Honors prefers-reduced-motion (renders a single static frame).
 */
export function DeploymentGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const DPR = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = Math.round(w * DPR)
      canvas.height = Math.round(h * DPR)
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    }
    resize()

    // Fibonacci sphere
    const N = 820
    const golden = Math.PI * (3 - Math.sqrt(5))
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const th = golden * i
      return { x: Math.cos(th) * r, y, z: Math.sin(th) * r }
    })
    // Deterministic "hub" nodes that pulse
    const nodeSet = new Set([44, 128, 235, 360, 470, 588, 690, 770])

    let raf = 0
    let rot = 0.6
    let t = 0

    const draw = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      const R = Math.min(w, h) * 0.46
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)

      // soft violet core glow
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.15)
      g.addColorStop(0, "rgba(112,86,255,0.20)")
      g.addColorStop(0.55, "rgba(112,86,255,0.06)")
      g.addColorStop(1, "rgba(112,86,255,0)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2)
      ctx.fill()

      for (let i = 0; i < N; i++) {
        const p = pts[i]
        const x = p.x * cos - p.z * sin
        const z = p.x * sin + p.z * cos
        const sx = cx + x * R
        const sy = cy + p.y * R
        const depth = (z + 1) / 2 // 0 = back, 1 = front

        if (nodeSet.has(i)) {
          const pulse = 0.55 + 0.45 * Math.sin(t / 26 + i)
          const a = (0.35 + depth * 0.65) * pulse
          const rad = 2.4 + depth * 1.8
          ctx.beginPath()
          ctx.fillStyle = `rgba(124,101,255,${a})`
          ctx.shadowColor = "rgba(124,101,255,0.9)"
          ctx.shadowBlur = 10 * depth * pulse
          ctx.arc(sx, sy, rad, 0, Math.PI * 2)
          ctx.fill()
          ctx.shadowBlur = 0
        } else {
          const a = 0.1 + depth * 0.5
          ctx.beginPath()
          ctx.fillStyle = `rgba(196,198,214,${a})`
          ctx.arc(sx, sy, 0.9 + depth * 1.0, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      t += 1
      if (!reduce) rot += 0.0018
      raf = requestAnimationFrame(draw)
    }

    draw()
    window.addEventListener("resize", resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [reduce])

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
}
