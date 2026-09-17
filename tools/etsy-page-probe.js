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

  /* 3. EVERY LEVEL ABOVE THE ORDER LINK, rather than one guessed container.
        The first version walked up until a level held MORE than one order link and reported
        that — which is the list, not the row, and on a page filtered to a single order it is
        most of <body>. Reporting each level instead cannot pick wrong: the row is whichever
        level first contains the thumbnails, and that is visible in the counts. */
  const a0 = orderLinks[0]
  if (!a0) { say('NO ORDER LINKS \u2014 is this the sold-orders page, and has it finished loading?'); return }
  say('')
  say('--- levels above the first order link ---')
  say('   lvl  tag.class                        imgs links  chars')
  let n = a0
  for (let up = 0; up <= 10 && n; up++, n = n.parentElement) {
    if (!n.tagName) break
    const tag = n.tagName.toLowerCase() + (cls(n) ? '.' + cls(n) : '')
    say('   ' + String(up).padEnd(4)
      + tag.slice(0, 32).padEnd(33)
      + String(n.querySelectorAll('img').length).padEnd(5)
      + String(n.querySelectorAll('a').length).padEnd(6)
      + (n.textContent || '').trim().length)
  }

  /* 4. WHERE AN ITEM LIVES. Anchored on the thumbnails, because an order row cannot render
        without them and their alt text is usually the product title — which is the field the
        reader actually needs and currently cannot find. */
  say('')
  say('--- thumbnails and what sits around them ---')
  const imgs = [...document.querySelectorAll('img')].filter((im) => {
    const s2 = im.getAttribute('src') || ''
    return /etsystatic|ii_fullxfull|il_/.test(s2)
  })
  say('listing-looking images:', imgs.length)
  for (const im of imgs.slice(0, 3)) {
    const alt = im.getAttribute('alt') || ''
    say('   img src', mask(im.getAttribute('src')))
    say('       alt is', alt.length, 'chars', alt.length ? '(a title lives here)' : '(EMPTY \u2014 no title on the image)')
    let q = im.parentElement, path = []
    for (let k = 0; k < 4 && q && q.tagName; k++, q = q.parentElement) {
      path.push(q.tagName.toLowerCase() + (cls(q) ? '.' + cls(q) : ''))
    }
    say('       ancestors:', path.join(' < '))
  }

  /* 5. LINK SHAPES ACROSS THE WHOLE PAGE. If items do not link to /listing/ they link to
        something, and that something is what the card reader should key on instead. */
  say('')
  say('--- link shapes on this page ---')
  const shapes = new Map()
  for (const a of document.querySelectorAll('a')) {
    const k = mask(a.getAttribute('href'))
    shapes.set(k, (shapes.get(k) || 0) + 1)
  }
  for (const [k, v] of [...shapes].sort((x, y) => y[1] - x[1]).slice(0, 16)) say('   ' + String(v).padEnd(4) + k)

  say('')
  say('=== copy everything above ===')
  try { copy(out.join('\n')); say('(also copied to your clipboard)') } catch {}
})()
