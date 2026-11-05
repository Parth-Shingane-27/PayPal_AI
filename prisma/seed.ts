import "dotenv/config";
import { randomUUID } from "node:crypto";
import { coreConfig } from "../src/server/config";
import { prisma } from "../src/server/db";
import { estimateSaleFees } from "../src/server/domain/fees";
import { getMarket } from "../src/server/domain/markets";
import { applyBps } from "../src/server/domain/money";
import { closeQueues, enqueueEmbedding } from "../src/server/queue";

/**
 * Demo data: 2 sellers, 3 buyers, 4 products with hand-written listings, and a
 * short order history so the Treasury and Operations agents have something to
 * work with. Needs no API keys; embeddings are queued for the worker.
 *
 * Historical payments are seed data, not real PayPal captures: their capture
 * ids start with "SEED-" and their fees are marked as estimates.
 */

type ListingSeed = {
  locale: string;
  title: string;
  seo_title: string;
  description: string;
  price_minor: number;
  status?: "DRAFT" | "PUBLISHED";
};

type ProductSeed = {
  sku: string;
  title: string;
  description: string;
  source_locale: string;
  cost_minor: number;
  shipping_minor: number;
  margin_bps: number;
  attributes: Record<string, unknown>;
  listings: ListingSeed[];
};

const US_PRODUCTS: ProductSeed[] = [
  {
    sku: "WALNUT-BOARD",
    title: "Hand-carved walnut serving board",
    description:
      "A serving board carved by hand from a single piece of American black walnut. Finished with food-safe mineral oil and beeswax. Each board has its own grain pattern.",
    source_locale: "en-US",
    cost_minor: 1800,
    shipping_minor: 900,
    margin_bps: 3000,
    attributes: {
      material: "American black walnut",
      dimensions_cm: "40.6 x 20.3 x 1.9",
      dimensions_in: "16 x 8 x 0.75",
      weight_kg: 0.95,
      weight_lb: 2.1,
      care: "Hand wash only; re-oil monthly",
    },
    listings: [
      {
        locale: "en-US",
        title: "Hand-Carved Black Walnut Serving Board",
        seo_title: "Hand-Carved Black Walnut Serving Board, 16 x 8 in",
        description:
          "Carved by hand from a single piece of American black walnut, this 16 x 8 inch board is ready for cheese, bread or charcuterie. Finished with food-safe mineral oil and beeswax. Weighs 2.1 lb. Hand wash and re-oil monthly.",
        price_minor: 4999,
      },
      {
        locale: "hi-IN",
        title: "हाथ से तराशा गया अखरोट की लकड़ी का सर्विंग बोर्ड",
        seo_title: "हाथ से बना अखरोट लकड़ी सर्विंग बोर्ड, 40 x 20 सेमी",
        description:
          "अमेरिकन ब्लैक वॉलनट की एक ही लकड़ी से हाथ से तराशा गया 40 x 20 सेमी का बोर्ड — चीज़, ब्रेड या नाश्ता परोसने के लिए उत्तम। फ़ूड-सेफ़ मिनरल ऑयल और मधुमोम से तैयार। वज़न 950 ग्राम। केवल हाथ से धोएँ और हर महीने तेल लगाएँ।",
        price_minor: 5499,
      },
      {
        locale: "ja-JP",
        title: "手彫りウォールナット サービングボード",
        seo_title: "手彫りブラックウォールナット サービングボード 40×20cm",
        description:
          "アメリカン・ブラックウォールナットの一枚板から手彫りで仕上げた、40×20cmのサービングボードです。チーズやパン、オードブルに。食品用ミネラルオイルと蜜蝋で仕上げています。重さ約950g。手洗いのみ、月に一度のオイル塗布をおすすめします。",
        price_minor: 7980,
      },
    ],
  },
  {
    sku: "MERINO-BEANIE",
    title: "Merino wool beanie",
    description:
      "A soft, warm beanie knitted from 100% merino wool. Breathable and itch-free. One size fits most adults.",
    source_locale: "en-US",
    cost_minor: 900,
    shipping_minor: 500,
    margin_bps: 3000,
    attributes: {
      material: "100% merino wool",
      size: "One size (head 54-60 cm / 21-23.5 in)",
      colors: ["charcoal", "forest green", "oatmeal"],
      care: "Hand wash cold, dry flat",
    },
    listings: [
      {
        locale: "en-US",
        title: "Merino Wool Beanie, One Size",
        seo_title: "Soft Merino Wool Beanie, Itch-Free, One Size",
        description:
          "Knitted from 100% merino wool: soft, warm, breathable and itch-free. Fits heads 21-23.5 inches. Available in charcoal, forest green and oatmeal. Hand wash cold and dry flat.",
        price_minor: 2999,
      },
      {
        locale: "ja-JP",
        title: "メリノウール ニット帽(フリーサイズ)",
        seo_title: "チクチクしないメリノウール ニット帽 フリーサイズ",
        description:
          "メリノウール100%で編んだ、柔らかく暖かいニット帽です。通気性が良く、チクチクしません。頭囲54〜60cmに対応。カラーはチャコール、フォレストグリーン、オートミール。冷水で手洗いし、平置きで乾かしてください。",
        price_minor: 4980,
      },
      {
        locale: "hi-IN",
        title: "मेरिनो ऊन की टोपी (फ़्री साइज़)",
        seo_title: "मुलायम मेरिनो ऊन की टोपी, बिना चुभन, फ़्री साइज़",
        description:
          "100% मेरिनो ऊन से बुनी मुलायम और गर्म टोपी — हवादार और बिना चुभन वाली। 54-60 सेमी सिर के नाप में फ़िट। रंग: चारकोल, फ़ॉरेस्ट ग्रीन और ओटमील। ठंडे पानी में हाथ से धोएँ और समतल सुखाएँ।",
        price_minor: 3299,
      },
    ],
  },
];

const DE_PRODUCTS: ProductSeed[] = [
  {
    sku: "KUCKUCKSUHR-MINI",
    title: "Handgefertigte Mini-Kuckucksuhr",
    description:
      "Kleine Kuckucksuhr aus Lindenholz, im Schwarzwald von Hand geschnitzt und bemalt. Mechanisches 1-Tage-Werk mit Kuckucksruf zur vollen und halben Stunde.",
    source_locale: "de-DE",
    cost_minor: 4500,
    shipping_minor: 1500,
    margin_bps: 3500,
    attributes: {
      material: "Lindenholz",
      dimensions_cm: "22 x 16 x 11",
      movement: "mechanisches 1-Tage-Werk",
      origin: "Schwarzwald, Deutschland",
    },
    listings: [
      {
        locale: "de-DE",
        title: "Handgeschnitzte Mini-Kuckucksuhr aus dem Schwarzwald",
        seo_title: "Mini-Kuckucksuhr handgeschnitzt, Schwarzwald, 22 cm",
        description:
          "Kleine Kuckucksuhr aus Lindenholz, im Schwarzwald von Hand geschnitzt und bemalt. Mechanisches 1-Tage-Werk, Kuckucksruf zur vollen und halben Stunde. Maße: 22 x 16 x 11 cm.",
        price_minor: 11999,
      },
      {
        locale: "en-US",
        title: "Hand-Carved Black Forest Mini Cuckoo Clock",
        seo_title: "Mini Cuckoo Clock, Hand-Carved in the Black Forest",
        description:
          "A small cuckoo clock carved and painted by hand from linden wood in Germany's Black Forest. Mechanical one-day movement; the cuckoo calls on the hour and half hour. About 8.7 x 6.3 x 4.3 inches.",
        price_minor: 13999,
      },
      {
        locale: "hi-IN",
        title: "हाथ से तराशी गई ब्लैक फ़ॉरेस्ट मिनी कुकू घड़ी",
        seo_title: "ब्लैक फ़ॉरेस्ट की हाथ से बनी मिनी कुकू घड़ी, 22 सेमी",
        description:
          "जर्मनी के ब्लैक फ़ॉरेस्ट में लिंडन की लकड़ी से हाथ से तराशी और रंगी गई छोटी कुकू घड़ी। मैकेनिकल 1-दिन की चाबी वाली मशीन; हर घंटे और आधे घंटे पर कुकू की आवाज़। आकार: 22 x 16 x 11 सेमी।",
        price_minor: 13999,
      },
      {
        locale: "ja-JP",
        title: "黒い森の手彫りミニ鳩時計",
        seo_title: "ドイツ黒い森 手彫りミニ鳩時計 22cm 機械式",
        description:
          "ドイツ・シュヴァルツヴァルト(黒い森)で、菩提樹の木から一つずつ手彫り・手塗りで仕上げた小さな鳩時計です。機械式1日巻きムーブメントで、毎正時と30分にカッコウが鳴きます。サイズ:22×16×11cm。",
        price_minor: 21980,
      },
    ],
  },
  {
    sku: "LEDER-A5",
    title: "Notizbuchhülle aus Leder, A5",
    description:
      "Hülle für A5-Notizbücher aus pflanzlich gegerbtem Rindsleder, von Hand genäht. Mit Stifthalter und Innenfach.",
    source_locale: "de-DE",
    cost_minor: 1400,
    shipping_minor: 600,
    margin_bps: 3000,
    attributes: {
      material: "pflanzlich gegerbtes Rindsleder",
      fits: "A5 (14,8 x 21 cm)",
      features: ["Stifthalter", "Innenfach"],
    },
    listings: [
      {
        locale: "de-DE",
        title: "Notizbuchhülle aus Leder für A5, handgenäht",
        seo_title: "Lederhülle A5 Notizbuch, pflanzlich gegerbt, handgenäht",
        description:
          "Hülle für A5-Notizbücher aus pflanzlich gegerbtem Rindsleder, von Hand genäht. Mit Stifthalter und Innenfach für Karten und Notizen.",
        price_minor: 4499,
      },
      {
        locale: "en-GB",
        title: "Hand-Stitched Leather A5 Notebook Cover",
        seo_title: "Leather A5 Notebook Cover, Veg-Tanned, Hand-Stitched",
        description:
          "A cover for A5 notebooks made from vegetable-tanned cowhide and stitched by hand. Includes a pen loop and an inner pocket for cards and notes.",
        price_minor: 4299,
      },
      {
        locale: "ja-JP",
        title: "手縫いレザー A5ノートカバー",
        seo_title: "植物タンニンなめし革 手縫いA5ノートカバー ペンホルダー付",
        description:
          "植物タンニンなめしの牛革を一針ずつ手縫いしたA5ノート用カバーです。ペンホルダーと、カードやメモを入れられる内ポケット付き。",
        price_minor: 7980,
      },
      {
        locale: "en-US",
        title: "Hand-Stitched Leather Notebook Cover (A5)",
        seo_title: "Leather A5 Notebook Cover, Hand-Stitched, Pen Loop",
        description:
          "Fits A5 notebooks (5.8 x 8.3 in). Vegetable-tanned cowhide, stitched by hand, with a pen loop and an inner pocket.",
        price_minor: 4999,
        status: "DRAFT",
      },
    ],
  },
];

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const cfg = coreConfig();
  if (cfg.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    agent_actions, agent_sessions, webhook_events, payouts, payout_schedules, refunds, payments,
    order_items, orders, listings, products, buyers, sellers RESTART IDENTITY CASCADE`);

  const sellerUs = await prisma.seller.create({
    data: {
      name: "Maple & Pine Goods",
      email: "seller.us@globalcart.test",
      paypal_email: process.env.SEED_US_PAYOUT_EMAIL ?? "seller-us-payouts@personal.example.com",
      country: "US",
      currency: "USD",
      locale: "en-US",
    },
  });
  const sellerDe = await prisma.seller.create({
    data: {
      name: "Schwarzwald Werkstatt",
      email: "seller.de@globalcart.test",
      paypal_email: process.env.SEED_DE_PAYOUT_EMAIL ?? "seller-de-payouts@personal.example.com",
      country: "DE",
      currency: "EUR",
      locale: "de-DE",
    },
  });

  const [ava, priya, haruto] = await Promise.all([
    prisma.buyer.create({ data: { name: "Ava Thompson", email: "ava@globalcart.test", locale: "en-US", country: "US" } }),
    prisma.buyer.create({ data: { name: "Priya Sharma", email: "priya@globalcart.test", locale: "hi-IN", country: "IN" } }),
    prisma.buyer.create({ data: { name: "Haruto Sato", email: "haruto@globalcart.test", locale: "ja-JP", country: "JP" } }),
  ]);

  const listingIds: Record<string, string> = {};
  const published: string[] = [];

  for (const [seller, products] of [
    [sellerUs, US_PRODUCTS],
    [sellerDe, DE_PRODUCTS],
  ] as const) {
    for (const p of products) {
      const product = await prisma.product.create({
        data: {
          seller_id: seller.id,
          sku: p.sku,
          title: p.title,
          description: p.description,
          source_locale: p.source_locale,
          cost_minor: p.cost_minor,
          cost_currency: seller.currency,
          shipping_minor: p.shipping_minor,
          margin_bps: p.margin_bps,
          attributes: p.attributes as object,
        },
      });
      for (const l of p.listings) {
        const status = l.status ?? "PUBLISHED";
        const listing = await prisma.listing.create({
          data: {
            product_id: product.id,
            seller_id: seller.id,
            locale: l.locale,
            currency: getMarket(l.locale).currency,
            title: l.title,
            description: l.description,
            seo_title: l.seo_title,
            price_minor: l.price_minor,
            status,
            published_at: status === "PUBLISHED" ? new Date() : null,
          },
        });
        listingIds[`${p.sku}:${l.locale}`] = listing.id;
        if (status === "PUBLISHED") published.push(listing.id);
      }
    }
  }

  // --- Order history ------------------------------------------------------
  type HistorySeed = {
    seller: typeof sellerUs;
    buyer: typeof ava;
    listing: string; // "SKU:locale"
    quantity: number;
    daysAgo: number;
    outcome: "PAID" | "REFUNDED" | "PARTIAL_REFUND" | "FAILED";
    refundReason?: string;
  };

  // Days ago that fall on a given day of last calendar month (for "last month" questions).
  const lastMonthDay = (day: number) => {
    const now = new Date();
    const target = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day, 12);
    return Math.round((now.getTime() - target) / DAY);
  };

  const history: HistorySeed[] = [
    { seller: sellerUs, buyer: ava, listing: "WALNUT-BOARD:en-US", quantity: 1, daysAgo: 52, outcome: "PAID" },
    { seller: sellerUs, buyer: ava, listing: "MERINO-BEANIE:en-US", quantity: 2, daysAgo: 41, outcome: "PAID" },
    { seller: sellerUs, buyer: haruto, listing: "WALNUT-BOARD:ja-JP", quantity: 1, daysAgo: 33, outcome: "PAID" },
    { seller: sellerUs, buyer: priya, listing: "MERINO-BEANIE:hi-IN", quantity: 1, daysAgo: 20, outcome: "PAID" },
    {
      seller: sellerUs, buyer: ava, listing: "WALNUT-BOARD:en-US", quantity: 1, daysAgo: 12, outcome: "PARTIAL_REFUND",
      refundReason: "Board arrived with a small scratch; buyer kept it with a partial refund.",
    },
    { seller: sellerUs, buyer: priya, listing: "WALNUT-BOARD:hi-IN", quantity: 1, daysAgo: 6, outcome: "PAID" },
    { seller: sellerUs, buyer: haruto, listing: "MERINO-BEANIE:ja-JP", quantity: 1, daysAgo: 3, outcome: "FAILED" },
    { seller: sellerDe, buyer: ava, listing: "KUCKUCKSUHR-MINI:en-US", quantity: 1, daysAgo: 48, outcome: "PAID" },
    { seller: sellerDe, buyer: haruto, listing: "KUCKUCKSUHR-MINI:ja-JP", quantity: 1, daysAgo: 37, outcome: "PAID" },
    { seller: sellerDe, buyer: ava, listing: "LEDER-A5:en-GB", quantity: 2, daysAgo: 30, outcome: "PAID" },
    {
      seller: sellerDe, buyer: haruto, listing: "LEDER-A5:ja-JP", quantity: 1, daysAgo: 22, outcome: "REFUNDED",
      refundReason: "Buyer received the wrong colour; full refund, item returned.",
    },
    {
      seller: sellerDe, buyer: haruto, listing: "KUCKUCKSUHR-MINI:ja-JP", quantity: 1, daysAgo: 9, outcome: "REFUNDED",
      refundReason: "Clock mechanism damaged in transit; full refund.",
    },
    { seller: sellerDe, buyer: priya, listing: "KUCKUCKSUHR-MINI:hi-IN", quantity: 1, daysAgo: 7, outcome: "PAID" },
    // Domestic German sales last month.
    { seller: sellerDe, buyer: ava, listing: "KUCKUCKSUHR-MINI:de-DE", quantity: 1, daysAgo: lastMonthDay(6), outcome: "PAID" },
    { seller: sellerDe, buyer: ava, listing: "LEDER-A5:de-DE", quantity: 2, daysAgo: lastMonthDay(19), outcome: "PAID" },
    { seller: sellerDe, buyer: ava, listing: "LEDER-A5:en-GB", quantity: 1, daysAgo: 2, outcome: "PAID" },
  ];

  const now = Date.now();
  for (const h of history) {
    const [, locale] = h.listing.split(":") as [string, string];
    const market = getMarket(locale);
    const listingId = listingIds[h.listing];
    if (!listingId) throw new Error(`Seed listing ${h.listing} missing`);
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    const at = new Date(now - h.daysAgo * DAY);
    const gross = listing.price_minor * h.quantity;
    const est = estimateSaleFees(gross, {
      currency: listing.currency,
      marketCountry: market.country,
      sellerCountry: h.seller.country,
      sellerCurrency: h.seller.currency,
      platformBps: cfg.PLATFORM_FEE_BPS,
    });
    const paypalFee = est.paypal_fee + est.international_fee;
    const platformFee = applyBps(gross, cfg.PLATFORM_FEE_BPS);
    const failed = h.outcome === "FAILED";

    const order = await prisma.order.create({
      data: {
        buyer_id: h.buyer.id,
        seller_id: h.seller.id,
        currency: listing.currency,
        locale,
        status:
          failed ? "PENDING_PAYMENT"
          : h.outcome === "REFUNDED" ? "REFUNDED"
          : h.outcome === "PARTIAL_REFUND" ? "PARTIALLY_REFUNDED"
          : "PAID",
        paid_at: failed ? null : at,
        created_at: at,
        items: {
          create: {
            listing_id: listing.id,
            title: listing.title,
            sku: h.listing.split(":")[0]!,
            unit_price_minor: listing.price_minor,
            quantity: h.quantity,
          },
        },
      },
    });

    if (failed) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await prisma.payment.create({
          data: {
            order_id: order.id,
            seller_id: h.seller.id,
            paypal_order_id: `SEED-ORDER-${randomUUID()}`,
            invoice_id: `${order.id}-${randomUUID()}`,
            status: "DECLINED",
            currency: listing.currency,
            gross_minor: gross,
            failure_reason: "INSTRUMENT_DECLINED",
            created_at: new Date(at.getTime() + attempt * 60_000),
          },
        });
      }
      continue;
    }

    const payment = await prisma.payment.create({
      data: {
        order_id: order.id,
        seller_id: h.seller.id,
        paypal_order_id: `SEED-ORDER-${randomUUID()}`,
        invoice_id: `${order.id}-${randomUUID()}`,
        status: "COMPLETED",
        currency: listing.currency,
        gross_minor: gross,
        paypal_fee_minor: paypalFee,
        fee_is_estimate: true,
        platform_fee_minor: platformFee,
        fx_cost_minor: 0,
        net_to_seller_minor: gross - paypalFee - platformFee,
        capture_id: `SEED-CAPTURE-${randomUUID()}`,
        captured_at: at,
        created_at: at,
      },
    });

    if (h.outcome === "REFUNDED" || h.outcome === "PARTIAL_REFUND") {
      const amount = h.outcome === "REFUNDED" ? gross : Math.round(gross / 5);
      const platformReturned = Math.round((platformFee * amount) / gross);
      await prisma.refund.create({
        data: {
          payment_id: payment.id,
          order_id: order.id,
          seller_id: h.seller.id,
          currency: listing.currency,
          amount_minor: amount,
          reason: h.refundReason ?? "Refund",
          status: "COMPLETED",
          paypal_refund_id: `SEED-REFUND-${randomUUID()}`,
          paypal_fee_returned_minor: 0,
          platform_fee_returned_minor: platformReturned,
          seller_debit_minor: amount - platformReturned,
          created_at: new Date(at.getTime() + DAY),
          completed_at: new Date(at.getTime() + DAY),
        },
      });
    }
  }

  for (const id of published) await enqueueEmbedding(id);

  console.log(
    `Seeded 2 sellers, 3 buyers, ${US_PRODUCTS.length + DE_PRODUCTS.length} products, ` +
      `${Object.keys(listingIds).length} listings (${published.length} published, embeddings queued), ` +
      `${history.length} historical orders.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues();
    await prisma.$disconnect();
  });
