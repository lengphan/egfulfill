#!/usr/bin/env node
/**
 * THE GATE FOR listing-description.js — the one parser behind every publish path.
 *
 * It EXECUTES the real module on real descriptions rather than reading the regexes, because
 * the bug this file was written for was invisible in the source: `squash()` collapsed every
 * run of whitespace before the parser looked at anything, so a SINGLE newline was gone
 * before any rule could see it. The regexes were all correct about the text they were given.
 *
 * Two halves, and the second is the one that prevents recurrence:
 *   STRUCTURE — a description the seller gave structure to keeps it, on all three channels.
 *   FLAT      — a description with NO line breaks parses exactly as it did before line
 *               markers existed. Every scraped listing is that shape, and the colour-run
 *               protection ("Silver - Burnt Orange - Light Pink") lives here.
 */
import {
  descriptionBlocks, descriptionText, descriptionHtml,
} from '../server/src/listing-description.js'
import { ttDescriptionHtml } from '../server/src/routes/tiktok.js'

let failures = 0
const shape = (t) => descriptionBlocks(t).map((b) => (b.type === 'ul' ? `UL${b.items.length}` : 'P')).join(' ')

function check(name, got, want) {
  const ok = got === want
  if (!ok) { failures++; console.log(`  FAIL  ${name}\n        want: ${want}\n        got:  ${got}`) }
  else console.log(`  ok    ${name}`)
}

console.log('\nSTRUCTURE — a line the seller broke is a line they meant')

// The shape the publish screen's assistant is PROMPTED to produce. This is the case that
// shipped broken: writer and publisher disagreed about the format of the same field.
const bulletDot = `A practical, polished apron designed for cafes and studios.
• Full-Length Coverage — 68 x 75 cm
• Spacious Front Pockets — Keeps tools within reach
• Personalized Embroidery — Add a name or logo`
check('"• " bullets become a list', shape(bulletDot), 'P UL3')
check('Etsy emits no markup', /[<>]/.test(descriptionText(bulletDot)), false)
check('Shopify/TikTok emit <ul>', descriptionHtml(bulletDot).includes('<ul><li>Full-Length'), true)

// What a seller types by hand, and the exact shape the owner reported.
const bulletDash = `A practical, polished apron.
- Full-Length Coverage — 68 x 75 cm
- Comfortable X-Back Design — Distributes weight
- Adjustable Fit — Adjustable straps`
check('"- " bullets become a list', shape(bulletDash), 'P UL3')
check('the marker is stripped, the words are not',
  descriptionBlocks(bulletDash)[1].items[1], 'Comfortable X-Back Design — Distributes weight')

check('"* " bullets become a list', shape('Lead in.\n* one item\n* two item'), 'P UL2')
check('numbered lines still become a list', shape('Read first.\n1- Check photos\n2- Pick a size'), 'P UL2')

// A list must END. This is the lesson the numbered pass already paid for once.
check('prose after a list is not swallowed',
  shape('Lead.\n- one\n- two\nShipping takes 3-5 business days and is tracked throughout.'),
  'P UL2 P')

/* TIKTOK CLEANS BEFORE THE PARSER RUNS, and that is its own chance to undo all of this.
   Its strip used to include \n, so it published the wall for a while after the other two
   were fixed. Executed, not read: this calls the real exported function. */
check('TikTok keeps the seller\'s bullets',
  ttDescriptionHtml(bulletDot, 'Apron').includes('<ul><li>Full-Length'), true)
check('TikTok still drops angle brackets',
  /[<>]/.test(ttDescriptionHtml('Hi <script>x</script> there\n- one\n- two', 'x')
    .replace(/<\/?(p|ul|li)>/g, '')), false)
check('TikTok still kills entities',
  ttDescriptionHtml('a &nbsp; b\n- one\n- two', 'x').includes('&nbsp;'), false)

console.log('\nFLAT — a scraped description parses as it always did')

// The original incident: one run of text, numbered steps, no line breaks anywhere.
const scraped = 'Disney Family Vacation How to Order T-shirt 1- Please, check and review all photos 2- Please choose your t-shirt style and size 3- Send us the names you want printed on the shirts'
check('flat numbered steps still list', shape(scraped), 'P UL3')

// THE colour run. A bare " - " in flat prose is a hyphen, never a bullet.
const colours = 'Available in Silver - Burnt Orange - Light Pink - Safety Pink.'
check('flat colour run stays one paragraph', shape(colours), 'P')
check('flat colour run keeps its words', descriptionText(colours), colours)

// One marked line is a dash, not a list — two is the floor.
check('a single dashed line is not a list', shape('Our apron is built to last.\n- and it is comfortable'), 'P')

// The trailing \s+ in LINE_MARKER. Without it these lose their first character.
check('"-20% off" is not a marker',
  descriptionBlocks('Sale on now.\n-20% off everything\n-30% off aprons')[0].text,
  'Sale on now. -20% off everything -30% off aprons')
check('a hyphenated word opening a line is intact',
  descriptionBlocks('Details below.\nX-Back Design is standard.\nY-Front is not.')[0].text.includes('X-Back Design'),
  true)

console.log('\nEMPTY / FALLBACK')
check('empty text falls back to the title', descriptionText('', 'My Apron'), 'My Apron')
check('empty text falls back to a <p>', descriptionHtml('', 'My Apron'), '<p>My Apron</p>')
check('empty with no fallback is empty', descriptionHtml(''), '')

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n')
process.exit(failures ? 1 : 0)
