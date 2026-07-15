"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { CheckCircle, Warning, CircleNotch } from "@phosphor-icons/react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createVietqrPayment, vietqrStatus, type VietqrPayment } from "@/lib/api"

const PRESETS = [50_000, 100_000, 200_000, 500_000]
const vnd = (n: number) => `${n.toLocaleString("en-US")}₫`

type Phase = "amount" | "qr" | "paid" | "error"

export function TopUpDialog({
  open,
  onOpenChange,
  onFunded,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onFunded: () => void
}) {
  const [amount, setAmount] = useState("100000")
  const [phase, setPhase] = useState<Phase>("amount")
  const [payment, setPayment] = useState<VietqrPayment | null>(null)
  const [qrImg, setQrImg] = useState("")
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // Reset when closed (deferred so it isn't a synchronous mount-effect setState).
  useEffect(() => {
    if (open) return stopPoll
    stopPoll()
    const id = setTimeout(() => {
      setPhase("amount")
      setPayment(null)
      setQrImg("")
      setError(null)
    }, 0)
    return () => {
      clearTimeout(id)
      stopPoll()
    }
  }, [open, stopPoll])

  const start = async () => {
    const amt = Math.round(Number(amount) || 0)
    if (amt < 1000) {
      setError("Enter at least 1,000₫.")
      return
    }
    setError(null)
    setPhase("qr")
    try {
      const p = await createVietqrPayment(amt)
      if (p.error || !(p.qrCode || p.qrLink)) throw new Error(p.error || "Couldn't create the payment QR.")
      setPayment(p)
      // Render the VA-backed QR: prefer VietQR's ready image, else draw the EMVCo string.
      if (p.qrLink) setQrImg(p.qrLink)
      else if (p.qrCode) setQrImg(await QRCode.toDataURL(p.qrCode, { width: 240, margin: 1 }))
      // Poll the reference until the callback marks it paid.
      const ref = p.note || ""
      if (ref) {
        pollRef.current = setInterval(async () => {
          try {
            const s = await vietqrStatus(ref)
            if (s.paid) {
              stopPoll()
              setPhase("paid")
              onFunded()
            }
          } catch {
            /* keep polling */
          }
        }, 4000)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed.")
      setPhase("error")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add funds</DialogTitle>
        </DialogHeader>

        {phase === "amount" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(String(v))}
                  className={
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " +
                    (Number(amount) === v ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")
                  }
                >
                  {vnd(v)}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Amount (VND)</span>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder="100000"
              />
            </label>
            {error && <div className="text-sm text-destructive">{error}</div>}
            <Button className="w-full" onClick={start}>
              Generate VietQR
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Scan with any VN banking app. Your balance updates automatically once paid.
            </p>
          </div>
        )}

        {phase === "qr" && (
          <div className="flex flex-col items-center gap-4 py-2">
            {qrImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrImg} alt="VietQR payment code" className="size-56 rounded-xl border border-border" />
            ) : (
              <div className="flex size-56 items-center justify-center rounded-xl border border-border">
                <CircleNotch size={28} className="animate-spin text-muted-foreground" />
              </div>
            )}
            {payment && (
              <div className="text-center">
                <div className="text-lg font-semibold tabular-nums">{vnd(Number(payment.amount) || 0)}</div>
                <div className="font-mono text-xs text-muted-foreground">Ref {payment.note}</div>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleNotch size={15} className="animate-spin" /> Waiting for payment…
            </div>
          </div>
        )}

        {phase === "paid" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle size={30} weight="fill" />
            </span>
            <div className="font-semibold">Payment received</div>
            <div className="text-sm text-muted-foreground">Your wallet balance has been updated.</div>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <Warning size={28} weight="fill" />
            </span>
            <div className="font-semibold">Couldn&apos;t start the payment</div>
            <div className="text-sm text-muted-foreground">{error}</div>
            <Button variant="outline" className="w-full" onClick={() => setPhase("amount")}>
              Try again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
