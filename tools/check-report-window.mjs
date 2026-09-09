#!/usr/bin/env node
/**
 * THE ALL-TIME BAR WINDOW, DRIVEN RATHER THAN REASONED ABOUT.
 *
 * `monthWindow` is the one piece of the overview route that is pure date arithmetic, and it
 * is the piece most likely to be quietly wrong: months are not a fixed number of
 * milliseconds, so an index cannot be checked by dividing, and the failure mode is a chart
 * that silently drops columns rather than one that throws.
 *
 * The case that matters is the LONG history. Anchored to the oldest order, a floor with more
 * than 90 months of trading numbers the CURRENT month past the end of the array, and the
 * route's own `i < span` guard then drops it — the chart shows the first seven years and
 * loses this one. Anchored to now, the overflow falls off the far end instead, which is what
 * a 365-day window already does with day 366. Case 4 below is that case.
 *
 * Run: node tools/check-report-window.mjs
 */
import { monthWindow } from '../server/src/routes/reports.js';

const at = (y, m) => new Date(y, m - 1, 15).getTime();   // mid-month, so DST cannot shift it
const NOW = at(2026, 9);                                  // September 2026

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`);
};

/** Where a date lands in the window, and whether the route's guard would keep it. */
const place = (oldest, when, now = NOW) => {
  const { monthIndex, firstMonth, monthSpan } = monthWindow(oldest, now);
  const i = monthIndex(when) - firstMonth;
  return { i, span: monthSpan, kept: i >= 0 && i < monthSpan };
};

console.log('\nmonthWindow — the all-time bar buckets\n');

// 1. One month of history is one column, and today is in it.
check('a single month is one column',
  place(at(2026, 9), at(2026, 9)), { i: 0, span: 1, kept: true });

// 2. Two years of history: 25 columns, oldest first, this month last.
check('25 months spans 25 columns',
  place(at(2024, 9), at(2026, 9)), { i: 24, span: 25, kept: true });
check('the oldest month is column 0',
  place(at(2024, 9), at(2024, 9)), { i: 0, span: 25, kept: true });
check('a month in the middle lands in the middle',
  place(at(2024, 9), at(2025, 9)), { i: 12, span: 25, kept: true });

// 3. The year boundary — the arithmetic is y*12+m, so December to January is the test.
check('December to January is one column apart',
  place(at(2025, 12), at(2026, 1)), { i: 1, span: 10, kept: true });

// 4. THE CASE THIS EXISTS FOR. 10 years of history, capped at 90 columns.
//    THIS month must be the LAST column and must be kept; the oldest must fall off.
check('with 120 months of history the span caps at 90',
  monthWindow(at(2016, 9), NOW).monthSpan, 90);
check('...and THIS month is the final column, not dropped',
  place(at(2016, 9), NOW), { i: 89, span: 90, kept: true });
check('...while the oldest month falls off the front',
  place(at(2016, 9), at(2016, 9)).kept, false);

// 5. An empty floor still yields a usable window rather than NaN.
check('no orders at all is one column',
  monthWindow(NaN, NOW).monthSpan, 1);

// 6. A future-dated order (clock skew on an imported row) must not stretch the window.
check('a future order does not extend the span',
  monthWindow(at(2027, 5), NOW).monthSpan, 1);

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
process.exit(failed ? 1 : 0);
