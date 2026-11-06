import { randomUUID } from "node:crypto";
import type { Prisma } from "../../src/generated/prisma/client";
import { prisma } from "../../src/server/db";
import { estimatePayoutFee, estimateSaleFees } from "../../src/server/domain/fees";
import { getMarket } from "../../src/server/domain/markets";
import { applyBps } from "../../src/server/domain/money";
import { roundUpToPricePoint } from "../../src/server/domain/pricing";
import { ART_TONE_COUNT, productArtUrl } from "../../src/server/domain/product-art";
import { convertAtReference } from "../../src/server/domain/reference-rates";
import {
  BUYER_MARKETS,
  CATALOGUE,
  COUNTRY_NAME,
  ENGLISH_MARKETS,
  LEGACY_PRODUCT_FACTS,
  type Lang,
  langOf,
  templateDescription,
} from "./catalogue";
import { createRng, type Rng } from "./prng";
import { fill, type Scenario, SCRIPTS, SUBJECTS } from "./scripts";

/**
 * Dummy marketplace history for the dashboards: catalogue for all sellers,
 * ~6 months of orders across 10 sellers x 10 buyers, payouts, daily listing
 * traffic and buyer-seller conversations.
 *
 * Eval safety (scripts/eval.ts): the legacy US/DE rows from seed.ts are left
 * untouched, and generated US/DE orders are always PAID (no refunds, no
 * failures), so the DE refund and anomaly cases still see exactly the legacy
 * refunds. Generated listings are not queued for embedding.
 */

const DAY = 86_400_000;
const HISTORY_DAYS = 182;

export type SeedSeller = { slug: string; id: string; name: string; country: string; currency: string; locale: string; paypal_email: string };
export type SeedBuyer = { id: string; name: string; locale: string; country: string };

type PoolListing = { id: string; product_id: string; seller_id: string; locale: string; currency: string; price_minor: number; title: string; sku: string; hero: boolean };

/** Storyline per seller: base orders per week, monthly growth, refund propensity. */
const STORY: Record<string, { perWeek: number; growth: number; refundRate: number }> = {
  us: { perWeek: 3.4, growth: 1.04, refundRate: 0 },
  de: { perWeek: 2.8, growth: 1.03, refundRate: 0 },
  gb: { perWeek: 2.6, growth: 1.14, refundRate: 0.06 },
  ca: { perWeek: 2.6, growth: 0.94, refundRate: 0.05 },
  au: { perWeek: 1.8, growth: 1.05, refundRate: 0.07 },
  fr: { perWeek: 2.6, growth: 1.06, refundRate: 0.05 },
  es: { perWeek: 1.7, growth: 1.08, refundRate: 0.09 },
  it: { perWeek: 2.3, growth: 1.02, refundRate: 0.04 },
  mx: { perWeek: 1.3, growth: 1.1, refundRate: 0.12 },
  jp: { perWeek: 2.1, growth: 1.05, refundRate: 0.05 },
};
const PROBLEM_SKUS = new Set(["BARRO-NEGRO", "BOL-MOUSTIERS"]);

const REFUND_REASONS = [
  "Arrived chipped; buyer kept it with a partial refund.",
  "Parcel delayed at customs for three weeks; partial refund as goodwill.",
  "Wrong size sent; full refund after return.",
  "Item lost in transit; full refund.",
  "Glaze flaw on arrival; partial refund agreed in messages.",
  "Buyer changed their mind before dispatch; full refund.",
];

function chunked<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function insertMany<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>, size = 2000): Promise<void> {
  for (const batch of chunked(rows, size)) await insert(batch);
}

function localPrice(usdCents: number, locale: string, sellerCountry: string): number {
  const market = getMarket(locale);
  const uplift = market.country === sellerCountry ? 1 : 1.08;
  const raw = convertAtReference(Math.round(usdCents * uplift), "USD", market.currency);
  return roundUpToPricePoint(raw, market.rounding, market.currency);
}

const firstName = (name: string) => name.split(" ")[0] ?? name;

export async function seedMarketplace(opts: { sellers: SeedSeller[]; buyers: SeedBuyer[]; platformBps: number; now?: Date }) {
  const rng = createRng(20261106);
  const now = opts.now ?? new Date();
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sellerBySlug = new Map(opts.sellers.map((s) => [s.slug, s]));
  const sellerById = new Map(opts.sellers.map((s) => [s.id, s]));

  // --- Catalogue -----------------------------------------------------------
  const productRows: Prisma.ProductCreateManyInput[] = [];
  const listingRows: Prisma.ListingCreateManyInput[] = [];
  const heroProducts = new Set<string>();

  for (const [slug, products] of Object.entries(CATALOGUE)) {
    const seller = sellerBySlug.get(slug);
    if (!seller) throw new Error(`Catalogue seller ${slug} missing`);
    const srcLang = langOf(seller.locale);
    for (const [i, p] of products.entries()) {
      const productId = randomUUID();
      if (p.hero) heroProducts.add(productId);
      const srcTitle = p.t[srcLang] ?? p.t.en;
      const created = new Date(startOfToday - (HISTORY_DAYS + 20 - i * 3) * DAY);
      productRows.push({
        id: productId,
        seller_id: seller.id,
        sku: p.sku,
        title: srcTitle,
        description: srcLang === "en" ? p.d : (p.ds ?? templateDescription(srcLang, srcTitle, seller.name, seller.country, p.d)),
        source_locale: seller.locale,
        cost_minor: convertAtReference(Math.round(p.usd * 0.36), "USD", seller.currency),
        cost_currency: seller.currency,
        shipping_minor: convertAtReference(Math.round(p.usd * 0.14), "USD", seller.currency),
        margin_bps: 3000,
        attributes: (p.attributes ?? {}) as Prisma.InputJsonValue,
        image_url: productArtUrl(p.motif, rng.int(0, ART_TONE_COUNT - 1), seller.country),
        category: p.category,
        stock: p.stock,
        created_at: created,
      });

      const locales = new Set<string>([seller.locale, ...ENGLISH_MARKETS, ...(p.hero ? BUYER_MARKETS : [])]);
      for (const locale of locales) {
        const lang = langOf(locale);
        const title = p.t[lang] ?? (lang === "en" ? p.t.en : undefined);
        if (!title) throw new Error(`${p.sku} has no ${lang} title for ${locale}`);
        const description =
          lang === "en" ? p.d : lang === srcLang && p.ds ? p.ds : templateDescription(lang, title, seller.name, seller.country, p.d);
        // A few secondary-market listings stay as drafts so the Products page has work to do.
        const draft = !p.hero && locale !== seller.locale && locale !== "en-US" && rng.chance(0.12);
        listingRows.push({
          id: randomUUID(),
          product_id: productId,
          seller_id: seller.id,
          locale,
          currency: getMarket(locale).currency,
          title,
          description,
          seo_title: title.slice(0, 70),
          price_minor: localPrice(p.usd, locale, seller.country),
          status: draft ? "DRAFT" : "PUBLISHED",
          published_at: draft ? null : created,
          created_at: created,
        });
      }
    }
  }
  await prisma.product.createMany({ data: productRows });
  await insertMany(listingRows, (b) => prisma.listing.createMany({ data: b }));

  // Legacy products get art and catalogue facts too.
  const legacy = await prisma.product.findMany({ where: { sku: { in: Object.keys(LEGACY_PRODUCT_FACTS) } }, include: { seller: true } });
  for (const p of legacy) {
    const f = LEGACY_PRODUCT_FACTS[p.sku]!;
    await prisma.product.update({
      where: { id: p.id },
      data: { image_url: productArtUrl(f.motif, rng.int(0, ART_TONE_COUNT - 1), p.seller.country), category: f.category, stock: f.stock },
    });
  }

  // --- Listing pool (legacy + generated, published only) ------------------------
  const published = await prisma.listing.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, product_id: true, seller_id: true, locale: true, currency: true, price_minor: true, title: true, product: { select: { sku: true } } },
  });
  const pool: PoolListing[] = published.map((l) => ({
    id: l.id,
    product_id: l.product_id,
    seller_id: l.seller_id,
    locale: l.locale,
    currency: l.currency,
    price_minor: l.price_minor,
    title: l.title,
    sku: l.product.sku,
    hero: heroProducts.has(l.product_id) || l.product.sku === "WALNUT-BOARD" || l.product.sku === "KUCKUCKSUHR-MINI",
  }));
  const poolBySeller = new Map<string, PoolListing[]>();
  for (const l of pool) poolBySeller.set(l.seller_id, [...(poolBySeller.get(l.seller_id) ?? []), l]);

  // --- Orders, payments, refunds ------------------------------------------------
  const orders: Prisma.OrderCreateManyInput[] = [];
  const items: Prisma.OrderItemCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const refunds: Prisma.RefundCreateManyInput[] = [];
  /** Orders by listing+day, for traffic correlation. */
  const unitsByListingDay = new Map<string, number>();

  for (const seller of opts.sellers) {
    const story = STORY[seller.slug];
    const listings = poolBySeller.get(seller.id) ?? [];
    if (!story || listings.length === 0) continue;
    const legacySeller = seller.slug === "us" || seller.slug === "de";

    for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
      const monthsFromStart = (HISTORY_DAYS - daysAgo) / 30;
      const dow = new Date(startOfToday - daysAgo * DAY).getUTCDay();
      const weekend = dow === 0 || dow === 6 ? 1.25 : 0.92;
      // Gentle lift into November.
      const season = daysAgo < 45 ? 1.15 : 1;
      const mean = (story.perWeek / 7) * story.growth ** monthsFromStart * weekend * season;
      const count = rng.poisson(mean);

      for (let k = 0; k < count; k++) {
        const buyer = rng.weighted(opts.buyers, (b) => (b.country === seller.country ? 3 : 1) * (b.locale === "hi-IN" ? 0.8 : 1));
        const inHome = listings.filter((l) => l.locale === buyer.locale);
        const english = listings.filter((l) => l.locale.startsWith("en-"));
        const options = inHome.length > 0 && rng.chance(0.85) ? inHome : english.length > 0 ? english : listings;
        const first = rng.weighted(options, (l) => (l.hero ? 3 : 1));
        const lineListings = [first];
        if (rng.chance(0.22)) {
          const second = options.filter((l) => l.id !== first.id && l.locale === first.locale);
          if (second.length > 0) lineListings.push(rng.pick(second));
        }

        const at = new Date(startOfToday - daysAgo * DAY + rng.int(7, 22) * 3_600_000 + rng.int(0, 59) * 60_000);
        const orderId = randomUUID();
        const market = getMarket(first.locale);
        let gross = 0;
        for (const l of lineListings) {
          const quantity = rng.chance(0.82) ? 1 : 2;
          gross += l.price_minor * quantity;
          items.push({ id: randomUUID(), order_id: orderId, listing_id: l.id, title: l.title, sku: l.sku, unit_price_minor: l.price_minor, quantity });
          const key = `${l.id}|${daysAgo}`;
          unitsByListingDay.set(key, (unitsByListingDay.get(key) ?? 0) + quantity);
        }

        const refundRate = legacySeller ? 0 : story.refundRate * (lineListings.some((l) => PROBLEM_SKUS.has(l.sku)) ? 2.5 : 1);
        const roll = rng.next();
        const failed = !legacySeller && roll < 0.035;
        const refundKind = !failed && roll < 0.035 + refundRate ? (rng.chance(0.6) ? "PARTIAL" : "FULL") : null;

        orders.push({
          id: orderId,
          buyer_id: buyer.id,
          seller_id: seller.id,
          currency: first.currency,
          locale: first.locale,
          status: failed ? "PENDING_PAYMENT" : refundKind === "FULL" ? "REFUNDED" : refundKind === "PARTIAL" ? "PARTIALLY_REFUNDED" : "PAID",
          paid_at: failed ? null : at,
          created_at: at,
        });

        if (failed) {
          const attempts = rng.int(1, 3);
          for (let a = 0; a < attempts; a++) {
            payments.push({
              id: randomUUID(),
              order_id: orderId,
              seller_id: seller.id,
              paypal_order_id: `SEED-ORDER-${randomUUID()}`,
              invoice_id: `${orderId}-${randomUUID()}`,
              status: "DECLINED",
              currency: first.currency,
              gross_minor: gross,
              failure_reason: rng.pick(["INSTRUMENT_DECLINED", "PAYER_ACTION_REQUIRED", "INSTRUMENT_DECLINED"]),
              created_at: new Date(at.getTime() + a * 90_000),
            });
          }
          continue;
        }

        const est = estimateSaleFees(gross, {
          currency: first.currency,
          marketCountry: market.country,
          sellerCountry: seller.country,
          sellerCurrency: seller.currency,
          platformBps: opts.platformBps,
        });
        const paypalFee = est.paypal_fee + est.international_fee;
        const platformFee = applyBps(gross, opts.platformBps);
        const fx = est.conversion_cost;
        const paymentId = randomUUID();
        payments.push({
          id: paymentId,
          order_id: orderId,
          seller_id: seller.id,
          paypal_order_id: `SEED-ORDER-${randomUUID()}`,
          invoice_id: `${orderId}-${randomUUID()}`,
          status: "COMPLETED",
          currency: first.currency,
          gross_minor: gross,
          paypal_fee_minor: paypalFee,
          fee_is_estimate: true,
          platform_fee_minor: platformFee,
          fx_cost_minor: fx,
          net_to_seller_minor: gross - paypalFee - platformFee - fx,
          capture_id: `SEED-CAPTURE-${randomUUID()}`,
          captured_at: at,
          created_at: at,
        });

        if (refundKind) {
          const amount = refundKind === "FULL" ? gross : Math.max(1, Math.round(gross * (0.2 + rng.next() * 0.3)));
          const platformReturned = Math.round((platformFee * amount) / gross);
          const when = new Date(Math.min(at.getTime() + rng.int(3, 12) * DAY, now.getTime() - 3_600_000));
          refunds.push({
            id: randomUUID(),
            payment_id: paymentId,
            order_id: orderId,
            seller_id: seller.id,
            currency: first.currency,
            amount_minor: amount,
            reason: refundKind === "FULL" ? rng.pick([REFUND_REASONS[2]!, REFUND_REASONS[3]!, REFUND_REASONS[5]!]) : rng.pick([REFUND_REASONS[0]!, REFUND_REASONS[1]!, REFUND_REASONS[4]!]),
            status: "COMPLETED",
            paypal_refund_id: `SEED-REFUND-${randomUUID()}`,
            paypal_fee_returned_minor: 0,
            platform_fee_returned_minor: platformReturned,
            seller_debit_minor: amount - platformReturned,
            created_at: when,
            completed_at: when,
          });
        }
      }
    }
  }

  await insertMany(orders, (b) => prisma.order.createMany({ data: b }));
  await insertMany(items, (b) => prisma.orderItem.createMany({ data: b }));
  await insertMany(payments, (b) => prisma.payment.createMany({ data: b }));
  await insertMany(refunds, (b) => prisma.refund.createMany({ data: b }));

  // --- Payouts: monthly sweeps of most of the available balance ------------------
  const allPayments = await prisma.payment.findMany({
    where: { status: "COMPLETED" },
    select: { seller_id: true, currency: true, net_to_seller_minor: true, captured_at: true },
  });
  const allRefunds = await prisma.refund.findMany({ select: { seller_id: true, currency: true, seller_debit_minor: true, created_at: true } });
  const schedules: Prisma.PayoutScheduleCreateManyInput[] = [];
  const payouts: Prisma.PayoutCreateManyInput[] = [];
  const nowDate = new Date(now);
  for (const seller of opts.sellers) {
    // Sweep only the seller's three biggest currencies; small foreign balances wait.
    const grossBy = new Map<string, number>();
    for (const p of allPayments) {
      if (p.seller_id !== seller.id) continue;
      grossBy.set(p.currency, (grossBy.get(p.currency) ?? 0) + convertAtReference(p.net_to_seller_minor ?? 0, p.currency, "USD"));
    }
    const currencies = [...grossBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
    for (const currency of currencies) {
      let paidOut = 0;
      for (let m = 5; m >= 1; m--) {
        const boundary = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - m + 1, 3, 9));
        if (boundary.getTime() >= now.getTime()) continue;
        const earned = allPayments
          .filter((p) => p.seller_id === seller.id && p.currency === currency && p.captured_at && p.captured_at < boundary)
          .reduce((s, p) => s + (p.net_to_seller_minor ?? 0), 0);
        const debited = allRefunds
          .filter((r) => r.seller_id === seller.id && r.currency === currency && r.created_at < boundary)
          .reduce((s, r) => s + (r.seller_debit_minor ?? 0), 0);
        const available = earned - debited - paidOut;
        const amount = Math.floor(available * 0.7);
        if (amount < convertAtReference(5000, "USD", currency)) continue;
        const fee = estimatePayoutFee(amount, currency);
        const scheduleId = randomUUID();
        schedules.push({ id: scheduleId, seller_id: seller.id, currency, status: "APPROVED", created_at: new Date(boundary.getTime() - DAY) });
        payouts.push({
          id: randomUUID(),
          schedule_id: scheduleId,
          seller_id: seller.id,
          currency,
          amount_minor: amount,
          fee_minor: fee,
          fee_is_estimate: true,
          receiver_email: seller.paypal_email,
          scheduled_for: boundary,
          status: "SUCCESS",
          sender_batch_id: `SEED-BATCH-${randomUUID()}`,
          paypal_batch_id: `SEED-PB-${randomUUID()}`,
          completed_at: new Date(boundary.getTime() + 2 * 3_600_000),
          created_at: new Date(boundary.getTime() - DAY),
        });
        paidOut += amount + fee;
      }
    }
  }
  await prisma.payoutSchedule.createMany({ data: schedules });
  await prisma.payout.createMany({ data: payouts });

  // --- Daily listing traffic -----------------------------------------------------
  const stats: Prisma.ListingDailyStatCreateManyInput[] = [];
  for (const l of pool) {
    const story = STORY[sellerById.get(l.seller_id)?.slug ?? ""] ?? { growth: 1 };
    // Tuned so storefront conversion lands around 1-3%, like a small craft shop.
    const base = (l.hero ? 2.4 : 1.0) * (l.locale === "en-US" ? 1.4 : 1) * (0.7 + rng.next() * 0.6);
    for (let daysAgo = HISTORY_DAYS; daysAgo >= 0; daysAgo--) {
      const trend = story.growth ** ((HISTORY_DAYS - daysAgo) / 30);
      const units = unitsByListingDay.get(`${l.id}|${daysAgo}`) ?? 0;
      const views = Math.max(rng.poisson(base * trend), units * rng.int(12, 30));
      const cartAdds = Math.max(units, Math.round(views * (0.04 + rng.next() * 0.05)));
      stats.push({ listing_id: l.id, day: new Date(startOfToday - daysAgo * DAY), views, cart_adds: cartAdds });
    }
  }
  await insertMany(stats, (b) => prisma.listingDailyStat.createMany({ data: b }), 5000);

  // --- Ratings from paid order lines ------------------------------------------------
  const unitsByProduct = new Map<string, number>();
  const productOfListing = new Map(pool.map((l) => [l.id, l.product_id]));
  const allItems = await prisma.orderItem.findMany({ where: { order: { status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } } }, select: { listing_id: true, quantity: true } });
  for (const it of allItems) {
    const pid = productOfListing.get(it.listing_id);
    if (pid) unitsByProduct.set(pid, (unitsByProduct.get(pid) ?? 0) + it.quantity);
  }
  const allProducts = await prisma.product.findMany({ select: { id: true, sku: true } });
  for (const p of allProducts) {
    const units = unitsByProduct.get(p.id) ?? 0;
    if (units === 0) continue;
    const avg = PROBLEM_SKUS.has(p.sku) ? 3.4 + rng.next() * 0.4 : 4.2 + rng.next() * 0.7;
    await prisma.product.update({ where: { id: p.id }, data: { rating_avg: Math.round(avg * 10) / 10, rating_count: Math.max(1, Math.round(units * 0.4)) } });
  }

  // --- Conversations ----------------------------------------------------------------
  const conversationCount = await seedConversations(rng, opts, startOfToday, now);

  return {
    products: productRows.length,
    listings: listingRows.length,
    orders: orders.length,
    refunds: refunds.length,
    payouts: payouts.length,
    stats: stats.length,
    conversations: conversationCount,
  };
}

async function seedConversations(rng: Rng, opts: { sellers: SeedSeller[]; buyers: SeedBuyer[] }, startOfToday: number, now: Date): Promise<number> {
  // Titles of each product per language, from its listings.
  const listings = await prisma.listing.findMany({ select: { product_id: true, locale: true, title: true } });
  const products = await prisma.product.findMany({ select: { id: true, seller_id: true, title: true, source_locale: true } });
  const titles = new Map<string, Partial<Record<Lang, string>>>();
  for (const p of products) titles.set(p.id, { [langOf(p.source_locale)]: p.title });
  for (const l of listings) {
    const t = titles.get(l.product_id)!;
    const lang = langOf(l.locale);
    if (!t[lang] || l.locale === "en-US") t[lang] = l.title;
  }
  const titleIn = (productId: string, lang: Lang) => {
    const t = titles.get(productId) ?? {};
    return t[lang] ?? t.en ?? Object.values(t)[0] ?? "";
  };

  const orders = await prisma.order.findMany({
    where: { status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
    select: { id: true, buyer_id: true, seller_id: true, status: true, paid_at: true, items: { select: { listing: { select: { product_id: true } } }, take: 1 } },
    orderBy: { paid_at: "desc" },
  });

  const conversations: Prisma.ConversationCreateManyInput[] = [];
  const messages: Prisma.MessageCreateManyInput[] = [];

  for (const buyer of opts.buyers) {
    const sellers = rng.shuffle(opts.sellers).slice(0, 6);
    for (const seller of sellers) {
      const shared = orders.filter((o) => o.buyer_id === buyer.id && o.seller_id === seller.id && o.paid_at);
      const refunded = shared.find((o) => o.status !== "PAID");
      let scenario: Scenario;
      let order: (typeof shared)[number] | undefined;
      if (refunded) {
        scenario = "damaged";
        order = refunded;
      } else if (shared.length > 0 && rng.chance(0.8)) {
        scenario = rng.pick(["shipping", "thanks", "thanks"] as const);
        order = rng.pick(shared.slice(0, 4));
      } else {
        scenario = rng.pick(["question", "question", "custom"] as const);
      }
      const productId =
        order?.items[0]?.listing.product_id ?? rng.pick(products.filter((p) => p.seller_id === seller.id)).id;

      const buyerLang = langOf(buyer.locale);
      const sellerLang = langOf(seller.locale);
      const script = SCRIPTS[scenario];
      // ~30% wait on the seller's reply: end on a buyer line.
      let length = script.length;
      const awaitingSeller = rng.chance(0.3);
      if (awaitingSeller) length = length % 2 === 0 ? length - 1 : length;

      const start = order?.paid_at
        ? order.paid_at.getTime() + rng.int(2, 6) * DAY
        : startOfToday - rng.int(2, 150) * DAY + rng.int(8, 20) * 3_600_000;
      const gaps = Array.from({ length }, () => rng.int(1, 26) * 3_600_000 + rng.int(0, 59) * 60_000);
      const span = gaps.slice(1).reduce((s, g) => s + g, 0);
      const latestStart = now.getTime() - span - 15 * 60_000;
      let t = Math.min(start, latestStart);

      const conversationId = randomUUID();
      for (let i = 0; i < length; i++) {
        if (i > 0) t += gaps[i]!;
        const fromBuyer = i % 2 === 0;
        const senderLang = fromBuyer ? buyerLang : sellerLang;
        const recipientLang = fromBuyer ? sellerLang : buyerLang;
        const vars = (lang: Lang) => ({ product: titleIn(productId, lang), country: COUNTRY_NAME[buyer.country]?.[lang] ?? buyer.country, name: firstName(buyer.name) });
        messages.push({
          id: randomUUID(),
          conversation_id: conversationId,
          sender: fromBuyer ? "BUYER" : "SELLER",
          body: fill(script[i]![senderLang], vars(senderLang)),
          body_locale: fromBuyer ? buyer.locale : seller.locale,
          translation: recipientLang === senderLang ? null : fill(script[i]![recipientLang], vars(recipientLang)),
          created_at: new Date(t),
        });
      }
      const endedOnBuyer = length % 2 === 1;
      const recent = now.getTime() - t < 12 * DAY;
      conversations.push({
        id: conversationId,
        seller_id: seller.id,
        buyer_id: buyer.id,
        product_id: productId,
        order_id: order?.id ?? null,
        subject: SUBJECTS[scenario].en,
        status: !endedOnBuyer && !recent && scenario !== "question" ? "CLOSED" : "OPEN",
        last_message_at: new Date(t),
        seller_unread: endedOnBuyer ? 1 : 0,
        buyer_unread: !endedOnBuyer && recent && rng.chance(0.6) ? 1 : 0,
        created_at: new Date(t - span),
      });
    }
  }
  await prisma.conversation.createMany({ data: conversations });
  await insertMany(messages, (b) => prisma.message.createMany({ data: b }));
  return conversations.length;
}
