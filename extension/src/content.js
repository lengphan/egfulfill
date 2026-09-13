/**
 * THE PAGE SIDE. It answers one question and volunteers nothing.
 *
 * This script does NOT send anything anywhere. It has no network access of its own and no
 * timer: it sits idle until the popup asks it to scan, reads the document, and hands the
 * result back through the extension's own message channel. Every decision about what to do
 * with those rows — and every request to our API — happens in popup.js, behind a button the
 * seller pressed.
 *
 * That split is deliberate and worth keeping. A content script that could post to a server
 * on its own is one edit away from being a background exfiltrator; one that can only reply
 * to a question cannot become that by accident.
 */

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.type !== 'eg:scan') return undefined

  try {
    const parse = globalThis.EG_PARSE
    if (!parse) {
      /* parse.js is listed before this file in the manifest, so it is missing only if Chrome
         refused to load it — which it does silently for a syntax error. Say so plainly
         rather than reporting zero orders, which looks like an empty page. */
      reply({ ok: false, error: 'parse.js did not load — check the extension for a syntax error.' })
      return true
    }
    const { rows, stats } = parse.extractOrders(document, msg.wanted || [])
    reply({ ok: true, rows, stats, url: location.pathname })
  } catch (e) {
    reply({ ok: false, error: String((e && e.message) || e) })
  }
  /* Keep the channel open for the async reply. Returning false here is the classic way to
     make a popup hang forever waiting for a response Chrome already threw away. */
  return true
})
