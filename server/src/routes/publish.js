// Where a product can be published, as ONE list.
//
// The publish dialog used to hardcode three tabs — Etsy, TikTok, Shopify — which is a
// statement about which integrations exist, not about where THIS seller can actually send
// a listing. A seller with one Etsy shop saw two tabs they could never use; a seller with
// two Etsy shops could only ever publish to whichever they connected first.
//
// So the client asks this route instead, and renders whatever comes back. One shop → no
// picker at all. Four shops across three platforms → four rows. Two Etsy shops → two rows
// that differ by shop name. None of those are branches in the UI; they're just lengths of
// this array.
import { destinationsFor, PLATFORM_EXTRA_FIELDS } from '../destinations.js';

const LABEL = { etsy: 'Etsy', tiktok: 'TikTok Shop', shopify: 'Shopify' };

export function publishRoutes(app, requireAuth) {
  app.get('/api/publish/destinations', { preHandler: requireAuth }, async (req) => {
    const rows = await destinationsFor(req.user);
    // TikTok's publish gate, read HERE as well as in the publish route, so the dialog can
    // say "dry run" on the row BEFORE anything is sent rather than reporting a green tick
    // for a product that was never created. Read at call time, never at module load — the
    // flag is set in the environment and a module-level snapshot would need a deploy to
    // notice a change.
    const ttLive = String(process.env.TIKTOK_PUBLISH_LIVE || '') === '1';
    return {
      destinations: rows.map((c) => ({
        connection_id: c.id,
        platform: c.platform,
        platform_label: LABEL[c.platform] || c.platform,
        // The name the seller knows the shop by. shop_id is the fallback because a row
        // with no name is still a real destination, and "Etsy shop" twice over is worse
        // than an id you can at least tell apart.
        shop_name: c.shop_name || c.shop_id,
        shop_id: c.shop_id,
        connected_at: c.created_at,
        // What this row needs on top of the shared fields. The dialog expands a row only
        // when this is non-empty, which is why ticking an Etsy shop adds no work.
        extra_fields: PLATFORM_EXTRA_FIELDS[c.platform] || [],
        // Publishing here creates nothing yet — said on the row, not discovered afterwards.
        dry_run: c.platform === 'tiktok' && !ttLive,
      })),
    };
  });
}
