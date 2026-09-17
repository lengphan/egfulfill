/**
 * WHAT DOES ETSY'S ORDERS PAGE ACTUALLY LOOK LIKE?
 *
 * Paste this into DevTools on https://www.etsy.com/your/orders/sold and send back what it
 * prints. It exists because extension/src/parse.js has to be written against real markup and
 * there is no capture of that page in this repo — the address ladder was, the item reader was
 * not, and the item reader is the half returning nothing.
 *
 * IT REPORTS SHAPE, NEVER CONTENT. No buyer name, no street, no order total leaves the page:
 * every digit in a URL is masked, text is reported as a LENGTH, and the only strings printed
 * are tag names, class names and URL shapes. That is deliberate — this output gets pasted
 * into a chat, and a diagnostic that leaks a buyer's address is a worse bug than the one it
 * is diagnosing.
 *
 * IT READS. It does not fetch, click, expand or navigate — same rule as the extension.
 */
;(() => {
  const mask = (u) => String(u || '').replace(/\d+/g, 'N').slice(0, 80)
  const cls = (el) => (el.getAttribute && el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
  const out = []
  const say = (...a) => { out.push(a.join(' ')); console.log(...a) }

  say('=== EGFUL PAGE PROBE ===')
  say('url shape      :', mask(location.pathname + location.search))

  /* 1. THE ANCHORS THE READER KEYS ON. If `order_id=` links are zero, nothing else matters. */
  const orderLinks = document.querySelectorAll('a[href*="order_id="]')
  const addrBlocks = document.querySelectorAll('.address')
  const listingLnk = document.querySelectorAll('a[href*="/listing/"]')
  say('order_id links :', orderLinks.length)
  say('.address blocks:', addrBlocks.length, '(the half that works today)')
  say('/listing/ links:', listingLnk.length, '(the half that finds items — 0 means the card reader cannot work)')

  /* 2. EMBEDDED JSON. The strategy that would give real transaction ids and artwork URLs. */
  let withReceipt = 0, withTransactions = 0, biggest = 0, parseable = 0
  for (const s of document.querySelectorAll('script')) {
    const t = s.textContent || ''
    if (t.length < 40) continue
    if (/receipt_id|receiptId/.test(t)) withReceipt++
    if (/"transactions"|'transactions'/.test(t)) withTransactions++
    if (/receipt_id/.test(t)) {
      biggest = Math.max(biggest, t.length)
      const i = t.search(/[[{]/), j = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
      if (i >= 0 && j > i) { try { JSON.parse(t.slice(i, j + 1)); parseable++ } catch {} }
    }
  }
  say('scripts w/ receipt_id   :', withReceipt)
  say('scripts w/ transactions :', withTransactions, '(0 means the JSON strategy cannot work)')
  say('of those, valid JSON    :', parseable, '  largest chars:', biggest)

  /* 3. WHAT AN ORDER ROW IS MADE OF. Walk up from the first order link the way the reader
        does, and describe the container: its tag, its classes, and every link shape inside. */
  const a0 = orderLinks[0]
  if (!a0) { say('NO ORDER LINKS — is this the sold-orders page, and is it finished loading?'); return }
  let n = a0, up = 0
  while (n.parentElement && up < 12) {
    n = n.parentElement; up++
    if (n.querySelectorAll('a[href*="order_id="]').length > 1) { n = n; break }
  }
  say('')
  say('--- one order row, ' + up + ' levels up ---')
  say('container      :', n.tagName.toLowerCase(), cls(n) && ('.' + cls(n)))
  say('text length    :', (n.textContent || '').trim().length, 'chars (content NOT printed)')

  const shapes = new Map()
  for (const a of n.querySelectorAll('a')) {
    const k = mask(a.getAttribute('href'))
    shapes.set(k, (shapes.get(k) || 0) + 1)
  }
  say('link shapes inside this row:')
  for (const [k, v] of [...shapes].slice(0, 14)) say('   ', v + '×', k)

  say('images inside  :', n.querySelectorAll('img').length)
  const imgShapes = new Set()
  for (const im of [...n.querySelectorAll('img')].slice(0, 4)) imgShapes.add(mask(im.getAttribute('src')))
  for (const k of imgShapes) say('    img', k)

  /* 4. THE DIRECT CHILDREN, so a name for the item container can be found. */
  say('child skeleton :')
  const walk = (el, depth) => {
    if (depth > 3) return
    for (const c of [...el.children].slice(0, 6)) {
      say('   '.repeat(depth + 1) + c.tagName.toLowerCase() + (cls(c) ? '.' + cls(c) : '')
        + '  [' + (c.textContent || '').trim().length + ' chars]')
      walk(c, depth + 1)
    }
  }
  walk(n, 0)

  say('')
  say('=== copy everything above ===')
  try { copy(out.join('\n')); say('(also copied to your clipboard)') } catch {}
})()
