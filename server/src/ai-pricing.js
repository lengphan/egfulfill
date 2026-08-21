/*
 * AI GENERATION — what a seller is charged, and the charge itself.
 *
 * Every render is real money at Google the moment it succeeds (~3–13c an image, 20c–$4.80
 * a clip), so this is the seam between that cost and the seller's wallet. Three rules shape
 * the whole file:
 *
 *   1. CHARGE BEFORE GOOGLE. moveFunds already refuses to overdraw a seller wallet, so
 *      charging first turns that guard into the pre-flight check — an empty wallet is
 *      stopped before a billable call is made, not after. Charging afterwards would mean
 *      paying for renders we cannot bill.
 *   2. NEVER CHARGE FOR A FAILURE. A refusal, an overload or a 402 costs the seller nothing,
 *      so every failure path refunds. For video that is the sweeper, because a clip fails
 *      minutes after the request returned.
 *   3. STAFF GENERATE FREE. The factory's own desk is a tool, not a purchase. Only a seller
 *      has a wallet to charge.
 *
 * The ledger does the hard part: it is idempotent by (account, type, ref), so a retry with
 * the same ref returns the existing charge instead of billing twice.
 */
import crypto from 'crypto';
import { q } from './db.js';
import { isStaff } from './auth.js';
import { moveFunds } from './routes/wallet.js';

export const AI_PRICING_KEY = 'ai_pricing';

/*
 * Sellers are OFF until an admin turns them on. A default that silently opened generation
 * would start spending against our Google account the moment this deployed, which is not a
 * decision a migration should make.
 */
export const AI_PRICING_DEFAULTS = {
  sellersEnabled: false,
  imagePrice: 0.5,          // charged per image, whatever it cost us
  videoPrice: 3,            // charged per clip
  freeImagesPerMonth: 0,    // adoption allowance; 0 = everything is paid
  dailyImageCap: 25,        // bounds the worst case per seller per day
  dailyVideoCap: 3,
};

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

/** One flat price per generation, not per second or per megapixel.
 *  A seller can reason about "50c an image"; nobody can reason about "$0.12/s at 1080p". */
export function priceFor(pricing, kind) {
  return kind === 'video' ? num(pricing.videoPrice, 0) : num(pricing.imagePrice, 0);
}

let _ready;
function ensure() {
  // Created here rather than in schema.sql: schema.sql runs on FIRST db init only, so an
  // existing deployment would never see this table. Same pattern as the other late tables.
  _ready ??= q(`create table if not exists ai_generations (
      id         bigserial primary key,
      seller_id  text not null,
      actor_id   text,
      kind       text not null,
      ref        text unique,
      usd        numeric(10,4) not null default 0,
      free       boolean not null default false,
      created_at timestamptz not null default now()
    )`)
    .then(() => q(`create index if not exists ai_generations_seller on ai_generations (seller_id, created_at desc)`))
    .catch((e) => { _ready = undefined; throw e; });
  return _ready;
}

export async function readPricing() {
  try {
    const r = await q('select value from settings where key=$1', [AI_PRICING_KEY]);
    const v = r.rows[0]?.value;
    const raw = typeof v === 'string' ? JSON.parse(v) : (v || {});
    return {
      sellersEnabled: !!raw.sellersEnabled,
      imagePrice: num(raw.imagePrice, AI_PRICING_DEFAULTS.imagePrice),
      videoPrice: num(raw.videoPrice, AI_PRICING_DEFAULTS.videoPrice),
      freeImagesPerMonth: Math.floor(num(raw.freeImagesPerMonth, AI_PRICING_DEFAULTS.freeImagesPerMonth)),
      dailyImageCap: Math.floor(num(raw.dailyImageCap, AI_PRICING_DEFAULTS.dailyImageCap)),
      dailyVideoCap: Math.floor(num(raw.dailyVideoCap, AI_PRICING_DEFAULTS.dailyVideoCap)),
    };
  } catch {
    // A settings read that fails must not read as "generation is free" — fall back to the
    // defaults, which have sellers switched off.
    return { ...AI_PRICING_DEFAULTS };
  }
}

export async function writePricing(patch) {
  const cur = await readPricing();
  const next = {
    sellersEnabled: patch.sellersEnabled === undefined ? cur.sellersEnabled : !!patch.sellersEnabled,
    imagePrice: num(patch.imagePrice, cur.imagePrice),
    videoPrice: num(patch.videoPrice, cur.videoPrice),
    freeImagesPerMonth: Math.floor(num(patch.freeImagesPerMonth, cur.freeImagesPerMonth)),
    dailyImageCap: Math.floor(num(patch.dailyImageCap, cur.dailyImageCap)),
    dailyVideoCap: Math.floor(num(patch.dailyVideoCap, cur.dailyVideoCap)),
  };
  await q(
    `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [AI_PRICING_KEY, JSON.stringify(next)]);
  return next;
}

/** A team member spends the OWNER's wallet, the same resolution orders and design files use.
 *  Exported because anything HUNG off a generation — the render history, for one — has to be
 *  filed under the same account the money came out of, or a team member's renders would be
 *  invisible to the owner who paid for them. */
export async function effectiveSeller(user) {
  if (!user || isStaff(user)) return null;
  try {
    const r = await q(
      "select owner_id from team_members where lower(email)=lower($1) and status='active' limit 1",
      [String(user.email || '')]);
    if (r.rows[0]?.owner_id) return String(r.rows[0].owner_id);
  } catch { /* no team table yet → they are their own owner */ }
  return String(user.sub);
}

async function usedSince(sellerId, kind, sql) {
  await ensure();
  const r = await q(
    `select count(*)::int as n from ai_generations
      where seller_id=$1 and kind=$2 and created_at >= ${sql}`, [sellerId, kind]);
  return r.rows[0]?.n || 0;
}

const usedToday = (s, k) => usedSince(s, k, "date_trunc('day', now())");
const usedThisMonth = (s, k) => usedSince(s, k, "date_trunc('month', now())");

/** What this caller would pay right now, and what they have left. Seller-safe: our prices
 *  to them, never our cost or margin. */
export async function quoteFor(user) {
  const pricing = await readPricing();
  const sellerId = await effectiveSeller(user);
  if (!sellerId) {
    return { staff: true, enabled: true, imagePrice: 0, videoPrice: 0, freeLeft: 0, imagesLeftToday: null, videosLeftToday: null };
  }
  const [imgToday, vidToday, imgMonth] = await Promise.all([
    usedToday(sellerId, 'image'), usedToday(sellerId, 'video'), usedThisMonth(sellerId, 'image'),
  ]);
  const freeLeft = Math.max(0, pricing.freeImagesPerMonth - imgMonth);
  return {
    staff: false,
    enabled: pricing.sellersEnabled,
    // The channel generated images land in. Named by the SERVER because a team member cannot
    // work out their owner's account id, and guessing it client-side is how the rail would
    // end up pointing at a channel the reader is not allowed to open.
    genChannel: 'gen-' + sellerId,
    imagePrice: freeLeft > 0 ? 0 : pricing.imagePrice,
    videoPrice: pricing.videoPrice,
    freeLeft,
    freeImagesPerMonth: pricing.freeImagesPerMonth,
    imagesLeftToday: Math.max(0, pricing.dailyImageCap - imgToday),
    videosLeftToday: Math.max(0, pricing.dailyVideoCap - vidToday),
  };
}

/**
 * Take the money, or explain why not — BEFORE any billable call is made.
 *
 * Returns { ref, usd, free, sellerId, staff }. Throws an Error carrying `.status` and a
 * sentence meant for a person: 403 switched off, 429 daily cap, 402 not enough balance.
 */
export async function chargeForGeneration(user, kind) {
  const ref = `aigen-${kind}-${crypto.randomBytes(8).toString('hex')}`;
  const sellerId = await effectiveSeller(user);

  // Staff: the factory's own tool. Nothing to charge, nothing to log against a wallet.
  if (!sellerId) return { ref, usd: 0, free: true, staff: true, sellerId: null };

  const pricing = await readPricing();
  if (!pricing.sellersEnabled) {
    const e = new Error('AI generation is not switched on for your account yet.');
    e.status = 403; throw e;
  }

  const cap = kind === 'video' ? pricing.dailyVideoCap : pricing.dailyImageCap;
  const usedT = await usedToday(sellerId, kind);
  if (usedT >= cap) {
    const e = new Error(`You have reached today's limit of ${cap} ${kind === 'video' ? 'clips' : 'images'}. It resets at midnight.`);
    e.status = 429; throw e;
  }

  // The monthly allowance applies to images only — a clip costs us up to fifteen images and
  // is rarely what turns into a listing, so it is never given away.
  let usd = priceFor(pricing, kind);
  let free = false;
  if (kind === 'image' && pricing.freeImagesPerMonth > 0) {
    const usedM = await usedThisMonth(sellerId, 'image');
    if (usedM < pricing.freeImagesPerMonth) { usd = 0; free = true; }
  }

  if (usd > 0) {
    try {
      await moveFunds({
        from: sellerId, to: 'factory', amount: usd, type: 'aigen', ref,
        note: `AI ${kind} generation`, by: String(user.sub || ''),
      });
    } catch (err) {
      if (err && err.code === 'INSUFFICIENT_FUNDS') {
        const e = new Error(`This ${kind} costs $${usd.toFixed(2)} and your wallet holds $${Number(err.balance || 0).toFixed(2)}. Top up to generate.`);
        e.status = 402; e.shortfall = err.shortfall; throw e;
      }
      throw err;
    }
  }

  // Logged AFTER the money moved, so a failed charge never consumes an allowance.
  await ensure();
  await q(
    `insert into ai_generations (seller_id, actor_id, kind, ref, usd, free)
     values ($1,$2,$3,$4,$5,$6) on conflict (ref) do nothing`,
    [sellerId, String(user.sub || ''), kind, ref, usd, free]);

  return { ref, usd, free, staff: false, sellerId };
}

/**
 * BOOK WHAT THE GENERATION COST US — the other side of chargeForGeneration.
 *
 * `chargeForGeneration` records what the SELLER paid; this records what WE paid Google or
 * Anthropic for the same press. They are opposite directions on one activity, and until now
 * only the first existed: a staff render moved no money at all, so the factory's own AI spend
 * — every press of a button that bills at 3c to 24c — appeared in no report anywhere. Seller
 * renders were worse than invisible, showing pure revenue against a cost we never wrote down.
 *
 * Booked at the moment it is INCURRED and never recomputed from today's price list, the same
 * rule the rest of costs.js follows: model prices move, and a report that recalculates history
 * from current rates misstates it.
 *
 * Idempotent on `ref`, which is the generation's own id — the same one the charge and any
 * refund carry — so a retried request books once and a cost can be lined up against the
 * charge it belongs to.
 *
 * Best-effort, never throws: losing an accounting row is bad, failing a render the user has
 * already paid for is worse.
 *
 * @param {string} ref     the generation's id (`charge.ref`)
 * @param {number} usd     what the provider charged US, positive
 * @param {string} note    human line for the ledger — model, size, what it was for
 */
export async function recordGenerationCost(ref, usd, note) {
  const amt = Number(usd);
  if (!ref || !isFinite(amt) || amt <= 0) return;
  try {
    const { recordCost } = await import('./costs.js');
    await recordCost('aigen', amt, String(ref), note || 'AI generation');
  } catch (e) {
    console.error('[ai-pricing] could not book generation cost for', ref, String(e));
  }
}

/**
 * Give it back. Called on every path where the render did not happen — a refusal, an
 * overload, a storage failure, or a video job that failed minutes later.
 *
 * Idempotent twice over: the ledger dedupes on the refund ref, and the log row is removed so
 * a refunded attempt does not eat a daily cap or a free allowance.
 */
export async function refundGeneration(charge, why = 'generation failed') {
  if (!charge || charge.staff || !charge.sellerId) return;
  try {
    if (Number(charge.usd) > 0) {
      await moveFunds({
        from: 'factory', to: charge.sellerId, amount: Number(charge.usd),
        type: 'aigen-refund', ref: `${charge.ref}-refund`, note: `Refund — ${why}`,
      });
    }
    await q('delete from ai_generations where ref=$1', [charge.ref]);
  } catch (e) {
    // A failed refund must be loud in the log but must never mask the original error the
    // caller is already reporting.
    console.error('[ai-pricing] refund failed for', charge.ref, String(e));
  }
}
