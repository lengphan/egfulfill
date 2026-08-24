// site-content.ts — the editable copy of the public marketing home.
//
// The homepage used to hardcode every string. Now the strings live in the database
// (settings key `site_content`, admin-edited from Settings › Site content) and the page
// reads them here. The values below are the DEFAULTS: they are the exact copy that used to
// be inline, and they are the fallback whenever a field is unset or the API is unreachable.
// A blank field in the editor therefore can NEVER blank the homepage — it falls back to
// this. That property is the whole point, so keep the defaults complete.

import { DEFAULT_MOTION, mergeMotion, type MotionSettings } from "./motion"

/** One column of the strip under the hero. `note` is what the figure MEANS — optional, and
 *  the one sentence a figure is allowed, because it is annotating a number rather than
 *  sitting under a control. */
export type Stat = { value: string; label: string; note?: string }
export type FeatureCard = { title: string; body: string }
export type Step = { n: string; title: string; body: string }
export type Testimonial = { quote: string; name: string; role: string }
export type Faq = { q: string; a: string }
/** A label tied to the hero figure by a hairline. `note` is optional and is the ONE sentence
 *  a figure may carry — it is annotating a picture, not sitting under a control. */
export type Callout = { label: string; note?: string }
/** One numbered card. The numeral comes from the POSITION — see NumberedCards.
 *  `points` is the short list of specifics under the body — the "— No CSV exports" run the
 *  how-it-works steps have always carried. It lives on the ITEM rather than in a second
 *  component because a card with three facts under it is still one card. */
export type NumberedItem = { title: string; body?: string; points?: string[] }

/**
 * THE FIGURE BLOCK, as stored content — the four fields CutoutFigure needs.
 *
 * One type rather than four loose keys on three page objects, because the hero already
 * proved these travel together: a picture with no alt text, or callouts with no picture to
 * tie them to, are both half a figure. Every page that can carry one carries the same shape,
 * so the editor panel for it is written once.
 */
/**
 * THE RANGE A FIGURE MAY BE RESIZED THROUGH — exported because the normalizer and the
 * on-page control both enforce it, and two copies of a limit is how they come to disagree.
 * Half size still reads as a product; past double, a cut-out at the resolution these are
 * generated at is visibly soft.
 */
export const FIGURE_SCALE_MIN = 0.5
export const FIGURE_SCALE_MAX = 2

export type PageFigure = {
  /** Public URL. Wants a PNG with real alpha — see the note on hero.image. Empty renders
   *  NOTHING, which is a real answer: no placeholder where a product should be. */
  image: string
  imageAlt: string
  /**
   * HOW THE PICTURE SITS, not which picture it is.
   *
   * A generated cut-out arrives at whatever size and angle the model felt like, and the only
   * remedy was to generate again and hope. These two are the adjustment: `imageScale`
   * multiplies the figure's height cap, so it is a REAL resize that reflows the column rather
   * than a transform that overlaps whatever is beside it, and `imageRotate` is degrees.
   *
   * Defaults are the identity — 1 and 0 — so stored content written before these existed
   * renders exactly as it did.
   */
  imageScale: number
  /** Degrees, positive clockwise. */
  imageRotate: number
  ghostWord: string
  callouts: Callout[]
}

/** The rule across the top of a section: a word at each end, a hairline between. */
export type RuleLabels = { ruleLeft: string; ruleRight: string }

/** What a marketing page's opening plate says. */
export type PageHead = { title: string; accent: string; sub: string }

/** /features — the six capabilities, as a numbered run. */
export type FeaturesPage = PageHead & RuleLabels & {
  figure: PageFigure
  stats: Stat[]
  /** The six rows. `points` is the specifics column beside each one. */
  items: NumberedItem[]
  cta: { heading: string; button: string }
}

/**
 * /how-it-works — three steps, then the real order statuses.
 *
 * `journey` stores the LABEL and the BODY, and NOT the colour. The labels are the product's
 * own status words (mirroring sellerStatus in lib/order-status.ts) and their tones are
 * resolved from the label at render time — see JOURNEY_TONE in bold-how.tsx. Two reasons,
 * both load-bearing: a stored tone is a Tailwind class an admin would be typing by hand into
 * a public page, and a marketing page that re-tints the pipeline into prettier colours is a
 * page that lies about what the seller will see on their first order.
 */
export type HowPage = PageHead & RuleLabels & {
  figure: PageFigure
  stats: Stat[]
  steps: NumberedItem[]
  journeyHeading: string
  journeyNote: string
  journey: { label: string; body: string }[]
  cta: { heading: string; button: string }
}

export type SiteContent = {
  hero: {
    /**
     * THE DISPLAY WORD — the hero's largest element, and the only one set at poster scale.
     *
     * The page used to open with a SENTENCE ("What if every order printed itself?"), which
     * caps the type at about 3.9rem because a clause has to fit on two lines and still leave
     * room for a subhead. Every reference opens with a WORD instead — SAPFORCE., Ascend,
     * TESTIMONIAL — and that is what lets the type be 9rem and carry the page on its own.
     *
     * It replaces the ghost watermark rather than joining it. `ghostWord` set the brand
     * enormous and pale BEHIND the figure, which is decoration standing in for a display
     * element; the same word at full strength, with the object crossing it, is the thing the
     * watermark was imitating. Empty falls back to the headline, so a site that never sets
     * one still renders.
     */
    word: string
    /** The plain lead of the headline. */
    headline: string
    /** The italic, violet-accented tail of the headline — the brand's one flourish. */
    accent: string
    subhead: string
    ctaPrimary: string
    ctaSecondary: string
    worksWithLabel: string
    integrations: string[]
    /**
     * THE HERO FIGURE — a public URL, and it wants a PNG with a real alpha channel.
     *
     * The route to one is the Studio: generate with Backdrop set to a cut-out-ready sweep,
     * press Remove background, upload the result in Settings › Site content. A JPEG works and
     * will simply sit on the page as a rectangle instead of floating on it, which is the
     * whole difference the cut-out buys.
     *
     * Empty is a real answer, not a missing one: the home page falls back to the app panel
     * rather than drawing a placeholder where a product should be.
     */
    image: string
    /** What the picture IS, for the people who don't get the picture. Falls back to something
     *  honest rather than to "hero image". */
    imageAlt: string
    /** How the picture sits — see the note on PageFigure. 1 and 0 are "as generated". */
    imageScale: number
    imageRotate: number
    /** The word set huge and pale behind the figure. Empty = no ghost. */
    ghostWord: string
    /** The rule across the top of the hero: a word at each end. */
    ruleLeft: string
    ruleRight: string
    /** Labels tied to the figure. At most four are drawn. */
    callouts: Callout[]
  }
  stats: Stat[]
  features: { heading: string; subhead: string; cards: FeatureCard[] }
  steps: { heading: string; items: Step[] }
  testimonials: { heading: string; items: Testimonial[] }
  faq: { heading: string; items: Faq[] }
  cta: { heading: string; subhead: string; button: string }
  /** The other two converted pages. They were hardcoded arrays inside their components until
   *  now, which meant the only way to change a word on /features was a deploy. */
  featuresPage: FeaturesPage
  howPage: HowPage
  /**
   * HOW the marketing pages animate — see lib/motion.ts.
   *
   * It rides in the copy blob rather than getting a settings key of its own, and that is a
   * decision worth defending: it is the same audience (admin), the same surface (the public
   * site), the same route, the same 64KB guard, and the same one fetch the layout already
   * makes. A second key would have bought a second endpoint, a second cache window and the
   * possibility of the two arriving out of step, in exchange for a tidier noun.
   */
  motion: MotionSettings
}

export const DEFAULT_SITE_CONTENT: SiteContent = {
  hero: {
    word: "EGFULFILL",
    /**
     * A STATEMENT, NOT A RHETORICAL QUESTION.
     *
     * "What if every order printed itself?" is the most-used opener in SaaS, and it promises
     * magic — which actively fights what is being sold: a real factory, with people at
     * presses, that you can watch work. The replacement says what happens and who does it.
     */
    headline: "Your orders,",
    accent: "printed and shipped.",
    subhead:
      "Etsy, Shopify & TikTok orders sync into one queue, print on a vetted network, and ship with tracking pushed back to the buyer.",
    ctaPrimary: "Start for free",
    ctaSecondary: "See how it works",
    worksWithLabel: "Works with",
    // Only channels a seller can actually connect today. WooCommerce was listed here and is
    // not built; Amazon is in developer onboarding and is described on /integrations/amazon
    // rather than implied here, because a reviewer who signs up counts what's on the page.
    integrations: ["Etsy", "Shopify", "TikTok Shop"],
    image: "",
    imageAlt: "A printed garment made through EGFULFILL",
    imageScale: 1,
    imageRotate: 0,
    ghostWord: "EGFUL",
    ruleLeft: "EGFULFILL",
    ruleRight: "PRINT ON DEMAND, FULFILLED",
    // Every one of these is a fact about the product, for the same reason the stats below
    // are: a callout on a photograph reads as a specification, and an unsourceable one is
    // exactly what a marketplace reviewer looks for.
    callouts: [
      { label: "7 print methods", note: "DTG, DTF, embroidery, sublimation and more" },
      { label: "One queue", note: "Every store's orders in one place" },
      { label: "Tracking pushed back", note: "Automatically, to the marketplace" },
    ],
  },
  /**
   * THE BAND UNDER THE HERO, and every figure in it must be one WE CAN POINT AT.
   *
   * These used to read "2.4M+ orders shipped" and "99.2% on-time fulfillment" — numbers
   * nobody could source. A marketplace assessing us for API access reads unattributable
   * performance claims as a policy problem (Amazon's website guidelines bar them outright),
   * and it is the same rule the app already follows: no invented numbers. Counts of things
   * that exist are safe; rates and totals are not, unless something measures them.
   *
   * `note` says what the figure MEANS, which is what turns a row of numbers into a spec
   * sheet rather than four unexplained digits.
   */
  stats: [
    { value: "3", label: "Marketplaces", note: "Etsy, Shopify and TikTok Shop sync in" },
    { value: "7", label: "Print methods", note: "One network, every decoration" },
    { value: "$0", label: "Platform fee", note: "You pay per order, never per month" },
    { value: "1", label: "Queue", note: "However many stores you run" },
    { value: "24h", label: "Artwork check", note: "Before anything reaches a press" },
  ],
  features: {
    heading: "Everything after the sale, handled.",
    subhead: "From the moment an order lands to the tracking number your buyer sees.",
    cards: [
      { title: "Every store, one queue", body: "Orders from Etsy, Shopify & TikTok Shop sync in automatically — no CSV exports, no copy-paste, no missed orders." },
      { title: "Vetted print network", body: "Quality-checked partners with QC at every stage — not a black box." },
      { title: "Tracking, automatic", body: "Cheapest label bought and tracking pushed back to the marketplace for you." },
      { title: "Transparent wallet", body: "A prepaid wallet with clear per-order charges and instant payouts. Always know exactly what you paid and why." },
    ],
  },
  steps: {
    heading: "Live in three steps.",
    items: [
      { n: "01", title: "Connect your stores", body: "OAuth into Etsy, Shopify or TikTok Shop in about two minutes." },
      { n: "02", title: "Upload your designs", body: "Map artwork to products once — we handle placement and print files." },
      { n: "03", title: "We fulfill, hands-off", body: "Print, pack, ship, and track. You just watch orders go out." },
    ],
  },
  /**
   * EMPTY ON PURPOSE, and the homepage skips the whole section when it is.
   *
   * The three that used to live here — "Maya R.", "Devon K.", "Priya S." — were written, not
   * collected. Attributed quotes from people who do not exist are the single easiest thing for
   * a marketplace reviewer to catch, and we ask real sellers for real ones instead. Add them
   * here (or in Settings › Site content) only with the seller's permission.
   */
  testimonials: {
    heading: "Sellers who stopped touching orders.",
    items: [],
  },
  faq: {
    heading: "Questions, answered.",
    items: [
      { q: "Which marketplaces do you sync with?", a: "Etsy, Shopify and TikTok Shop today. Orders flow into one queue automatically and tracking is pushed back to each marketplace. Amazon is in developer onboarding — see the Amazon integration page." },
      { q: "Is there a monthly fee?", a: "No. The platform is free — you only pay the per-order fulfillment cost when an order ships, funded from your prepaid wallet." },
      { q: "How does shipping pricing work?", a: "We rate-shop across carriers and buy the cheapest available label, billed at cost. You always see the exact charge on each order." },
      { q: "Can I use my own designs?", a: "Yes. Upload artwork to your library, map it to products once, and our mini designer handles placement and print-ready files." },
      { q: "What about quality control?", a: "Every order is quality-checked at each stage on a vetted print network — intake, print, and pack — before it ships." },
    ],
  },
  cta: {
    heading: "Ready to put fulfillment on autopilot?",
    subhead: "Connect a store and send your first hands-off order today. No monthly fee.",
    button: "Start for free",
  },

  /**
   * ── /features ─────────────────────────────────────────────────────────────────
   *
   * The exact copy that was hardcoded in bold-features.tsx, moved here without a word
   * changed. The six stay a numbered RUN rather than becoming NumberedCards: that component
   * checkers light and dark two-up, which is right for four short problems and wrong for six
   * capabilities that each carry a body and a three-item spec column. The run's own big
   * numerals already give the reading order a card grid can't.
   */
  featuresPage: {
    title: "Everything after",
    accent: "the sale.",
    sub: "Six things this platform does so you don't have to. Every one of them runs whether you're watching or not.",
    ruleLeft: "EGFULFILL",
    ruleRight: "WHAT THE PLATFORM DOES",
    figure: {
      image: "",
      imageAlt: "A printed garment made through EGFULFILL",
      imageScale: 1,
      imageRotate: 0,
      ghostWord: "EGFUL",
      callouts: [
        { label: "Printed on demand", note: "Nothing is made until it sells" },
        { label: "Checked before it ships", note: "Intake, print and pack" },
        { label: "Shipped at cost", note: "Cheapest label, tracking pushed back" },
      ],
    },
    /* Countable facts, every one of them sourceable from the product — see the note on
       `stats` above. 7 print methods is the seven sku suffixes the order pipeline actually
       carries; 3 QC stages is the intake/print/pack run named in the copy below. */
    stats: [
      { value: "3", label: "Marketplaces", note: "Etsy, Shopify and TikTok Shop" },
      { value: "7", label: "Print methods", note: "One network, every decoration" },
      { value: "3", label: "QC stages", note: "Intake, print and pack" },
      { value: "$0", label: "Monthly fee", note: "You pay per order, never per month" },
      { value: "1", label: "Queue", note: "However many stores you run" },
    ],
    items: [
      {
        title: "Every store, one queue",
        body: "Connect Etsy, Shopify, TikTok Shop and WooCommerce. Orders sync in automatically — no CSV exports, no copy-paste, no missed orders. Tracking is pushed back to each marketplace the moment a label is bought.",
        points: ["OAuth in ~2 minutes", "Real-time order sync", "Tracking pushed back automatically"],
      },
      {
        title: "Design once, map forever",
        body: "Upload artwork to your library and map it to products a single time. Our mini designer handles placement, sizing and print-ready file generation — including embroidery thread matching.",
        points: ["Reusable design library", "Auto placement & print files", "Embroidery thread matching"],
      },
      {
        title: "Vetted print network",
        body: "Your orders print on a quality-checked partner network with QC at intake, print and pack. Not a black box — you can see each order's stage in real time.",
        points: ["QC at every stage", "Per-order status visibility", "Consistent quality"],
      },
      {
        title: "Cheapest-label shipping",
        body: "We rate-shop across carriers and buy the cheapest available label, billed at cost. Tracking flows back to the buyer automatically — you never touch a shipping screen.",
        points: ["Multi-carrier rate shopping", "Billed at cost", "Automatic tracking"],
      },
      {
        title: "Transparent wallet",
        body: "A prepaid wallet with clear per-order charges. See exactly what each order costs before it prints — no mystery invoices, no surprise fees.",
        points: ["Per-order cost breakdown", "Prepaid, no monthly fee", "Instant reconciliation"],
      },
      {
        title: "Quality you can trust",
        body: "Every order is inspected on a vetted network before it ships. Issues are caught early, so your buyers get exactly what they ordered.",
        points: ["Pre-ship inspection", "Early issue detection", "Reprints handled for you"],
      },
    ],
    cta: { heading: "All of it, from the first order.", button: "Start free" },
  },

  /**
   * ── /how-it-works ─────────────────────────────────────────────────────────────
   *
   * Also verbatim from bold-how.tsx. This page is the one the figure kit was made for: the
   * reference board's annotated product panel IS a how-it-works diagram, so the steps get an
   * object to point at rather than three boxes of prose.
   */
  howPage: {
    title: "Three steps.",
    accent: "Then it runs.",
    sub: "Connect, upload, submit. Everything after that happens without you opening a shipping screen.",
    ruleLeft: "EGFULFILL",
    ruleRight: "HOW IT WORKS",
    figure: {
      image: "",
      imageAlt: "A printed garment made through EGFULFILL",
      imageScale: 1,
      imageRotate: 0,
      ghostWord: "EGFUL",
      /* What HAPPENS to the object, in order — which is what makes this figure a diagram of
         the process rather than a photograph with adjectives stuck to it. */
      callouts: [
        { label: "Your artwork", note: "Mapped to the product once, reused forever" },
        { label: "Our press", note: "Printed or stitched on a vetted network" },
        { label: "Their doorstep", note: "Cheapest label, tracking pushed back" },
      ],
    },
    stats: [
      { value: "2 min", label: "To connect a store", note: "OAuth, not a CSV export" },
      { value: "1", label: "Upload per design", note: "Mapped to products once" },
      { value: "24h", label: "Artwork check", note: "Before anything reaches a press" },
      { value: "4", label: "Statuses you'll see", note: "The same four your orders show" },
      { value: "0", label: "Shipping screens", note: "We rate-shop and buy the label" },
    ],
    steps: [
      {
        title: "Connect your stores",
        body: "Sign in to Etsy, Shopify, TikTok Shop or WooCommerce in about two minutes. Existing orders import right away, and new ones stream into one queue from then on.",
        points: ["No CSV exports", "Every store, one login", "Existing orders backfilled"],
      },
      {
        title: "Upload your designs",
        body: "Add artwork once and map it to a product. The mini designer sets placement and size, generates the print files, and matches embroidery thread — so every order comes out right.",
        points: ["Reusable design library", "Print files made for you", "Placement handled"],
      },
      {
        title: "We make and ship it",
        body: "You submit an order; we accept it, produce it on a vetted network, buy the cheapest label, and push tracking back to your shop. You watch orders go out.",
        points: ["Reviewed before production", "Cheapest-label shipping", "Tracking pushed back"],
      },
    ],
    journeyHeading: "What you'll actually see.",
    journeyNote: "These are the exact statuses on your orders — not a simplified version for this page.",
    journey: [
      { label: "Draft", body: "Lands in your queue the moment it syncs. Edit it, add items — nothing is charged yet." },
      { label: "Pending", body: "You submit it and we accept it into production. Still cancellable, for a full refund." },
      { label: "In process", body: "Being made — printed or stitched, scanned, checked, packed. Nothing for you to do." },
      { label: "Fulfilled", body: "Out the door on the cheapest label, with tracking pushed back to your shop." },
    ],
    cta: { heading: "Connect a store and watch it work.", button: "Start free" },
  },

  motion: DEFAULT_MOTION,
}

/**
 * Overlay a stored (possibly partial) blob onto the defaults.
 *
 * Scalars: a non-empty stored value wins; blank or missing falls back to the default —
 * this is what stops a cleared field from blanking the page. Arrays (stats, cards, FAQ…)
 * are replaced WHOLESALE when present, not merged element-by-element: the editor owns the
 * whole list, so removing a testimonial has to actually remove it. An absent array key
 * keeps the default list.
 */
export function mergeSiteContent(stored: unknown): SiteContent {
  const d = DEFAULT_SITE_CONTENT
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>
  const str = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() !== "" ? v : fallback
  const arr = <T,>(v: unknown, fallback: T[]) => (Array.isArray(v) && v.length ? (v as T[]) : fallback)
  const obj = (k: string) => (s[k] && typeof s[k] === "object" ? (s[k] as Record<string, unknown>) : {})
  /* A CLAMPED NUMBER, because these two reach the DOM as a height and a rotation. Anything
     that is not a finite number — a string from a hand-edited blob, a NaN from an empty
     field, null from an older record — falls back rather than rendering `NaNrem`, and the
     range is enforced here as well as in the control: the control is not the only writer. */
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

  const hero = obj("hero")
  const features = obj("features")
  const steps = obj("steps")
  const testimonials = obj("testimonials")
  const faq = obj("faq")
  const cta = obj("cta")

  /* ── The two page blobs ────────────────────────────────────────────────────────
     The same rules as everything above, applied one level deeper: a blank scalar falls back
     so a cleared field can never blank a live page, and a present array replaces wholesale
     so deleting the sixth feature actually deletes it. */
  const nest = (parent: Record<string, unknown>, k: string) =>
    (parent[k] && typeof parent[k] === "object" && !Array.isArray(parent[k])
      ? (parent[k] as Record<string, unknown>)
      : {})
  /* image / ghostWord / callouts are kept AS TYPED — blank is a deliberate choice for all
     three (no picture, no ghost word, no labels) and `str` would resurrect a default the
     admin had just cleared. Same three fields, same reasoning, as the hero above. */
  const figureOf = (stored: Record<string, unknown>, dflt: PageFigure): PageFigure => ({
    image: typeof stored.image === "string" ? stored.image : dflt.image,
    imageAlt: str(stored.imageAlt, dflt.imageAlt),
    imageScale: num(stored.imageScale, dflt.imageScale, FIGURE_SCALE_MIN, FIGURE_SCALE_MAX),
    imageRotate: num(stored.imageRotate, dflt.imageRotate, -180, 180),
    ghostWord: typeof stored.ghostWord === "string" ? stored.ghostWord : dflt.ghostWord,
    callouts: Array.isArray(stored.callouts) ? (stored.callouts as Callout[]) : dflt.callouts,
  })
  const featuresPage = obj("featuresPage")
  const howPage = obj("howPage")
  const fCta = nest(featuresPage, "cta")
  const hCta = nest(howPage, "cta")

  return {
    hero: {
      word: str(hero.word, d.hero.word),
      headline: str(hero.headline, d.hero.headline),
      accent: str(hero.accent, d.hero.accent),
      subhead: str(hero.subhead, d.hero.subhead),
      ctaPrimary: str(hero.ctaPrimary, d.hero.ctaPrimary),
      ctaSecondary: str(hero.ctaSecondary, d.hero.ctaSecondary),
      worksWithLabel: str(hero.worksWithLabel, d.hero.worksWithLabel),
      integrations: arr<string>(hero.integrations, d.hero.integrations),
      // Empty is a valid, intentional value (no banner) — the default is also empty, so a
      // blank here stays blank rather than resurrecting a default image.
      image: typeof hero.image === "string" ? hero.image : d.hero.image,
      imageAlt: str(hero.imageAlt, d.hero.imageAlt),
      imageScale: num(hero.imageScale, d.hero.imageScale, FIGURE_SCALE_MIN, FIGURE_SCALE_MAX),
      imageRotate: num(hero.imageRotate, d.hero.imageRotate, -180, 180),
      // Blank is a real choice for all three of these — no ghost word, no rule label — so
      // they are kept as typed rather than run through `str`, which would resurrect a
      // default the admin had deliberately cleared.
      ghostWord: typeof hero.ghostWord === "string" ? hero.ghostWord : d.hero.ghostWord,
      ruleLeft: typeof hero.ruleLeft === "string" ? hero.ruleLeft : d.hero.ruleLeft,
      ruleRight: typeof hero.ruleRight === "string" ? hero.ruleRight : d.hero.ruleRight,
      callouts: Array.isArray(hero.callouts) ? (hero.callouts as Callout[]) : d.hero.callouts,
    },
    // isArray, not `arr` — `arr` falls back to the defaults on an EMPTY list, which is right
    // for the FAQ (a homepage with no questions is a mistake) and wrong here: a strip an
    // admin has emptied is an admin removing a section, and it has to stay gone.
    stats: Array.isArray(s.stats) ? (s.stats as Stat[]) : d.stats,
    features: {
      heading: str(features.heading, d.features.heading),
      subhead: str(features.subhead, d.features.subhead),
      cards: arr<FeatureCard>(features.cards, d.features.cards),
    },
    steps: {
      heading: str(steps.heading, d.steps.heading),
      items: arr<Step>(steps.items, d.steps.items),
    },
    testimonials: {
      heading: str(testimonials.heading, d.testimonials.heading),
      items: arr<Testimonial>(testimonials.items, d.testimonials.items),
    },
    faq: {
      heading: str(faq.heading, d.faq.heading),
      items: arr<Faq>(faq.items, d.faq.items),
    },
    cta: {
      heading: str(cta.heading, d.cta.heading),
      subhead: str(cta.subhead, d.cta.subhead),
      button: str(cta.button, d.cta.button),
    },
    featuresPage: {
      title: str(featuresPage.title, d.featuresPage.title),
      accent: str(featuresPage.accent, d.featuresPage.accent),
      sub: str(featuresPage.sub, d.featuresPage.sub),
      ruleLeft: typeof featuresPage.ruleLeft === "string" ? featuresPage.ruleLeft : d.featuresPage.ruleLeft,
      ruleRight: typeof featuresPage.ruleRight === "string" ? featuresPage.ruleRight : d.featuresPage.ruleRight,
      figure: figureOf(nest(featuresPage, "figure"), d.featuresPage.figure),
      // isArray, not `arr`: an emptied strip is an admin REMOVING the section, and it has to
      // stay gone — exactly as for the homepage stats above.
      stats: Array.isArray(featuresPage.stats) ? (featuresPage.stats as Stat[]) : d.featuresPage.stats,
      items: arr<NumberedItem>(featuresPage.items, d.featuresPage.items),
      cta: {
        heading: str(fCta.heading, d.featuresPage.cta.heading),
        button: str(fCta.button, d.featuresPage.cta.button),
      },
    },
    howPage: {
      title: str(howPage.title, d.howPage.title),
      accent: str(howPage.accent, d.howPage.accent),
      sub: str(howPage.sub, d.howPage.sub),
      ruleLeft: typeof howPage.ruleLeft === "string" ? howPage.ruleLeft : d.howPage.ruleLeft,
      ruleRight: typeof howPage.ruleRight === "string" ? howPage.ruleRight : d.howPage.ruleRight,
      figure: figureOf(nest(howPage, "figure"), d.howPage.figure),
      stats: Array.isArray(howPage.stats) ? (howPage.stats as Stat[]) : d.howPage.stats,
      steps: arr<NumberedItem>(howPage.steps, d.howPage.steps),
      journeyHeading: str(howPage.journeyHeading, d.howPage.journeyHeading),
      journeyNote: str(howPage.journeyNote, d.howPage.journeyNote),
      // The tone is NOT stored — it is resolved from the label. See the note on HowPage.
      journey: Array.isArray(howPage.journey)
        ? (howPage.journey as { label: string; body: string }[])
        : d.howPage.journey,
      cta: {
        heading: str(hCta.heading, d.howPage.cta.heading),
        button: str(hCta.button, d.howPage.cta.button),
      },
    },
    // Its own merge, because the rule for a number is not the rule for a string: 0 is a
    // legitimate value for every motion field and `str`'s "blank falls back" test would throw
    // it away. mergeMotion also clamps, so a hand-typed 40-second duration cannot ship.
    motion: mergeMotion(s.motion),
  }
}

/**
 * Read the site content for the Server-Component homepage.
 *
 * Runs on the Vercel server, so it needs the ABSOLUTE API origin — a relative `/api` only
 * resolves in the browser (via the Next rewrite). Mirrors next.config's API_ORIGIN with the
 * same `https://egful.store` fallback.
 *
 * ISR, not no-store: the homepage is hit constantly and its copy changes rarely, so a
 * 60-second revalidate means an edit shows within a minute without a DB round-trip per view.
 * ANY failure — API down, bad JSON, timeout — falls back to the baked-in defaults, because a
 * marketing homepage that 500s over a copy service is a far worse outcome than slightly
 * stale copy.
 */
export async function getSiteContent(): Promise<SiteContent> {
  const origin = (process.env.API_ORIGIN || "https://egful.store").replace(/\/+$/, "")
  try {
    const res = await fetch(`${origin}/api/site-content`, { next: { revalidate: 60 } })
    if (!res.ok) return DEFAULT_SITE_CONTENT
    const body = (await res.json()) as { content?: unknown }
    return mergeSiteContent(body?.content)
  } catch {
    return DEFAULT_SITE_CONTENT
  }
}
