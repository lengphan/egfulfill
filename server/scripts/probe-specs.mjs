/**
 * Does S&S expose garment measurements? Ask them.
 *
 * Runs INSIDE the api container, so it reads SS_ACCOUNT_NUMBER / SS_API_KEY straight from
 * the environment — no bearer token, no shell quoting, nothing to paste wrong. The HTTP
 * probe route exists too, but getting a JWT onto a server over SSH turned out to be the
 * hard part of the question, and the question is worth answering.
 *
 *   docker compose exec api node scripts/probe-specs.mjs 9183
 */
const account = (process.env.SS_ACCOUNT_NUMBER || '').trim()
const key = (process.env.SS_API_KEY || '').trim()
const style = (process.argv[2] || '9183').trim()

if (!account || !key) {
  console.log('S&S is not configured in this container (SS_ACCOUNT_NUMBER / SS_API_KEY).')
  process.exit(1)
}

const auth = 'Basic ' + Buffer.from(`${account}:${key}`).toString('base64')
const BASE = 'https://api.ssactivewear.com/v2'

const paths = [
  `/specs/${style}?mediatype=json`,
  `/specs?styleid=${style}&mediatype=json`,
  `/sizecharts/${style}?mediatype=json`,
  `/styles/${style}?fields=styleID,title,description,specs,sizeChart,specSheet&mediatype=json`,
  `/styles/${style}?mediatype=json`,
]

let found = null
for (const path of paths) {
  let status = 0, body = ''
  try {
    const r = await fetch(BASE + path, { headers: { Authorization: auth, Accept: 'application/json' } })
    status = r.status
    body = (await r.text()).slice(0, 1200)
  } catch (e) { body = 'network: ' + e.message }

  // The SHAPE decides it, not the status. A 200 with no measurement fields is a "no" that
  // looks like a "yes", and that is the answer most likely to mislead.
  // Look for the SHAPE S&S actually uses — generic specName/value pairs — not for column
  // names I guessed at. The first version of this checked for "chest" and friends and
  // reported "no size charts" while a chart sat in its own output: the check was more
  // confident than informed, which is the worst thing a diagnostic can be.
  const measures = /"specName"/.test(body) || /"(chest|bodyLength|sleeveLength|width)"/i.test(body)
  console.log(`\n${status}  ${path}${measures ? '   <-- MEASUREMENTS' : ''}`)
  console.log('   ' + body.replace(/\s+/g, ' ').slice(0, 300))
  if (status === 200 && measures && !found) found = path
}

console.log('\n' + '='.repeat(60))
console.log(found
  ? `YES — measurements at ${found}. A real size chart can be built from the API.`
  : 'NO — nothing returned measurement fields. A size chart would have to be typed in per\n' +
    'style, or lifted from their spec-sheet PDFs, which are not API data.')
