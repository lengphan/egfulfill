import * as Print from "expo-print"
import * as FileSystem from "expo-file-system/legacy"
import { labelFileUrl, getToken } from "@/lib/api"

/**
 * PRINT A SHIPPING LABEL — the real system print sheet, not a browser tab.
 *
 * This screen used to `Linking.openURL(tracking_label_url)`, which left the app, handed the
 * PDF to Safari or Chrome, and left the human to find Share → Print for themselves. Two
 * things were wrong with it beyond the extra taps: the carrier URL is sometimes a `data:`
 * URL (the USPS-direct path stores the bytes inline), which an opener cannot resolve at
 * all; and the order was stamped `label_printed_at` the moment the OS accepted the URL, so
 * the stamp meant "somebody opened a PDF" while the queue read it as "a label exists on
 * the bench".
 *
 * So: fetch through our own staff-gated route, which resolves both shapes, then hand the
 * file to `expo-print`.
 *
 * WHAT THE RESOLVED PROMISE ACTUALLY MEANS, because the two platforms do not agree and the
 * caller stamps custody on it:
 *   iOS      — resolves once printing has STARTED in the native print window, and REJECTS
 *              if the window is closed without starting. The stamp is true.
 *   Android  — resolves as soon as the print window is DISPLAYED, and never rejects on
 *              cancel. The stamp there means "the print sheet was opened", which is the
 *              same claim the old openURL made, and is the strongest one Android offers.
 * Neither platform can tell us paper came out. `label_printed_at` is a custody claim about
 * a person, not a report from a printer, and it should not be documented as more.
 */
export async function printOrderLabel(orderId: string): Promise<void> {
  const token = await getToken()
  const dest = `${FileSystem.cacheDirectory}label-${orderId.replace(/[^\w.-]+/g, "_")}.pdf`

  const res = await FileSystem.downloadAsync(labelFileUrl(orderId), dest, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  // downloadAsync does NOT throw on a 4xx — it writes the error JSON to the file and
  // reports the status. Printing that would put the word "error" on a label.
  if (res.status === 403) throw new Error("Labels are staff-only.")
  if (res.status === 404) throw new Error("No stored label for this order — buy one first.")
  if (res.status !== 200) throw new Error(`Couldn't fetch the label (HTTP ${res.status}).`)

  const h = res.headers as Record<string, string> | undefined
  const type = String(h?.["Content-Type"] ?? h?.["content-type"] ?? "").toLowerCase()

  // printAsync's `uri` is PDF-ONLY. Shippo hands back a PDF by default but a PNG label is a
  // real option, and a PNG through the PDF path is a silent no-print. An image goes as
  // inlined base64 HTML instead — iOS cannot load a local asset URL into its print WebView,
  // so a data: URI is the documented way, not a shortcut.
  if (type && !/pdf/.test(type)) {
    const b64 = await FileSystem.readAsStringAsync(res.uri, { encoding: FileSystem.EncodingType.Base64 })
    await Print.printAsync({
      html: `<html><body style="margin:0"><img src="data:${type};base64,${b64}" style="width:100%"></body></html>`,
    })
    return
  }
  await Print.printAsync({ uri: res.uri })
}

/** Closing the iOS print sheet rejects, and a cancel is not a failure — the caller must not
 *  raise an alert about something the human deliberately dismissed. */
export const printWasCancelled = (e: unknown) =>
  /did not complete|cancel|dismiss/i.test(e instanceof Error ? e.message : String(e))
