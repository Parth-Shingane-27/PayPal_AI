import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Prisma } from "../src/generated/prisma/client";
import { coreConfig } from "../src/server/config";
import { prisma } from "../src/server/db";
import { invoicePrefixFor } from "../src/server/domain/invoices";
import { listMarkets, roundUpToPricePoint } from "../src/server/domain/markets";
import { currencyExponent } from "../src/server/domain/money";
import { convertAtReference } from "../src/server/domain/reference-rates";
import { CLIENTS, FREELANCERS, type Lang, langOf } from "./seed/people";
import { createRng } from "./seed/prng";
import { type SeedClient, type SeedFreelancer, type SeedPage, seedProjects } from "./seed/projects";
import { HOURLY_MARKUP, PACKAGE_MARKUP, SERVICES } from "./seed/services";

/**
 * GlobalGig demo data, deterministic (fixed PRNG seed), no API keys and no
 * Redis needed: 10 freelancers, 10 clients, 40 services with packages and a
 * page per market, and six months of briefs, quotes, contracts, milestones
 * in every state, payments, refunds, invoices, payouts and translated threads.
 *
 * Historical captures are "SEED-" ids, not real PayPal captures: they show up
 * in balances and invoices, but cannot be refunded through PayPal.
 * Embeddings for search are added by the worker (Phase 4).
 */

const DAY = 86_400_000;

/** Rounds a base price up to a tidy number in its currency (5 units, or 500 for JPY/PHP/MXN). */
function tidy(minor: number, currency: string): number {
  const unit = 10 ** currencyExponent(currency);
  const step = (["JPY", "PHP", "MXN"].includes(currency) ? 500 : 5) * unit;
  return Math.ceil(minor / step) * step;
}

/** Wipes the database and writes the demo data. Exported for tests/integration/seed.test.ts. */
export async function runSeed(opts: { now?: number; log?: boolean } = {}) {
  const cfg = coreConfig();
  if (cfg.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");
  const rng = createRng(20_261_110);
  const now = opts.now ?? Date.now();
  const started = now;

  // Wipe every table except Prisma's migration history.
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);

  // --- People -------------------------------------------------------------------
  const payoutEmail: Record<string, string | undefined> = { emily: process.env.SEED_US_PAYOUT_EMAIL, jonas: process.env.SEED_DE_PAYOUT_EMAIL };
  const prefixes = new Set<string>();
  const freelancers: SeedFreelancer[] = [];
  for (const f of FREELANCERS) {
    let prefix = invoicePrefixFor(f.name);
    while (prefixes.has(prefix)) prefix = `${prefix}${prefixes.size}`;
    prefixes.add(prefix);
    const paypal_email = payoutEmail[f.slug] ?? `freelancer-${f.slug}-payouts@personal.example.com`;
    const row = await prisma.freelancer.create({
      data: {
        name: f.name,
        email: `${f.slug}@globalgig.test`,
        paypal_email,
        country: f.country,
        currency: f.currency,
        locale: f.locale,
        headline: f.headline,
        bio: f.bio,
        skills: f.skills,
        languages: f.languages,
        timezone: f.timezone,
        availability: f.availability,
        portfolio_links: [`https://portfolio.example.com/${f.slug}`],
        hourly_floor_minor: f.hourly_floor_minor,
        invoice_prefix: prefix,
        created_at: new Date(now - 200 * DAY),
      },
    });
    freelancers.push({ ...f, id: row.id, invoice_prefix: prefix, paypal_email });
  }
  const clients: SeedClient[] = [];
  for (const c of CLIENTS) {
    const row = await prisma.client.create({
      data: { name: c.name, email: `${c.slug}@globalgig.test`, locale: c.locale, country: c.country, company_name: c.company_name, tax_id: c.tax_id, created_at: new Date(now - 200 * DAY) },
    });
    clients.push({ ...c, id: row.id });
  }

  // --- Services, packages, pages ---------------------------------------------------
  const marketsByLang = new Map<Lang, ReturnType<typeof listMarkets>>();
  for (const m of listMarkets()) marketsByLang.set(langOf(m.locale), [...(marketsByLang.get(langOf(m.locale)) ?? []), m]);
  const pages: SeedPage[] = [];
  // Pages and prices are inserted in bulk below: one round trip per batch, not per page (matters on a remote DB).
  const pageRows: Prisma.ServicePageCreateManyInput[] = [];
  const priceRows: Prisma.ServicePagePriceCreateManyInput[] = [];
  let serviceCount = 0;
  let pageCount = 0;
  let draftPages = 0;
  for (const f of freelancers) {
    const specs = SERVICES[f.slug];
    if (!specs) throw new Error(`No services for ${f.slug}`);
    for (const [index, s] of specs.entries()) {
      const sourceLang = (Object.keys(s.t).find((l) => l !== "en") as Lang | undefined) ?? "en";
      const source = s.t[langOf(f.locale)] ?? s.t.en!;
      const tiers = ["BASIC", "STANDARD", "PREMIUM"] as const;
      const hourly = s.model === "HOURLY" ? tidy(Math.round(f.hourly_floor_minor * HOURLY_MARKUP), f.currency) : null;
      const service = await prisma.service.create({
        data: {
          freelancer_id: f.id,
          code: s.code,
          title: source.title,
          description: source.description,
          source_locale: s.t[langOf(f.locale)] ? f.locale : sourceLang === "en" ? "en-US" : f.locale,
          category: s.category,
          tags: s.tags,
          pricing_model: s.model,
          currency: f.currency,
          hourly_rate_minor: hourly,
          rating_avg: Math.round((4.3 + rng.next() * 0.7) * 10) / 10,
          rating_count: rng.int(3, 60),
          created_at: new Date(now - (190 - index * 10) * DAY),
          packages:
            s.model === "PACKAGES"
              ? {
                  create: tiers.map((tier, i) => ({
                    tier,
                    name: tier[0] + tier.slice(1).toLowerCase(),
                    scope: s.scopes![i]!,
                    deliverables: [],
                    delivery_days: s.days![i]!,
                    revisions: [1, 2, 4][i]!,
                    estimated_hours: s.hours![i]!,
                    base_price_minor: tidy(Math.round(s.hours![i]! * f.hourly_floor_minor * PACKAGE_MARKUP), f.currency),
                  })),
                }
              : undefined,
        },
        include: { packages: true },
      });
      serviceCount++;

      for (const [lang, text] of Object.entries(s.t) as [Lang, { title: string; description: string }][]) {
        for (const m of marketsByLang.get(lang) ?? []) {
          // The 4th service's non-English pages are left as drafts for the Profile agent to finish.
          const status = index === 3 && lang !== "en" ? "DRAFT" : "PUBLISHED";
          const price = (minor: number) => roundUpToPricePoint(convertAtReference(minor, f.currency, m.currency), m.rounding, m.currency);
          const pageId = randomUUID();
          const prices = service.packages.map((p) => ({ package_id: p.id, price_minor: price(p.base_price_minor) }));
          pageRows.push({
            id: pageId,
            service_id: service.id,
            freelancer_id: f.id,
            locale: m.locale,
            currency: m.currency,
            title: text.title,
            description: text.description,
            seo_title: text.title.slice(0, 70),
            hourly_rate_minor: hourly === null ? null : price(hourly),
            status,
            published_at: status === "PUBLISHED" ? new Date(now - (180 - index * 10) * DAY) : null,
            created_at: new Date(now - (185 - index * 10) * DAY),
          });
          priceRows.push(...prices.map((x) => ({ page_id: pageId, ...x })));
          pageCount++;
          if (status === "DRAFT") {
            draftPages++;
            continue;
          }
          pages.push({
            id: pageId,
            service_id: service.id,
            freelancer_id: f.id,
            locale: m.locale,
            currency: m.currency,
            title: text.title,
            category: s.category,
            hero: s.hero,
            model: s.model,
            hourly_rate_minor: hourly === null ? null : price(hourly),
            packages: service.packages.map((p) => ({
              id: p.id,
              tier: p.tier,
              name: p.name,
              scope: p.scope,
              delivery_days: p.delivery_days,
              revisions: p.revisions,
              price_minor: prices.find((x) => x.package_id === p.id)!.price_minor,
            })),
          });
        }
      }
    }
  }

  await prisma.servicePage.createMany({ data: pageRows });
  await prisma.servicePagePrice.createMany({ data: priceRows });

  // --- Six months of work ---------------------------------------------------------
  const r = await seedProjects({ rng, now, freelancers, clients, pages, platformBps: cfg.PLATFORM_FEE_BPS });

  const summary = { freelancers: freelancers.length, clients: clients.length, services: serviceCount, pages: pageCount, draftPages, ...r };
  if (opts.log !== false) console.log(
    `Seeded ${freelancers.length} freelancers, ${clients.length} clients, ${serviceCount} services, ${pageCount} service pages (${draftPages} drafts), ` +
      `${r.briefs} briefs, ${r.quotes} quotes, ${r.contracts} contracts, ${r.milestones} milestones ${JSON.stringify(r.states)}, ` +
      `${r.invoices} invoices, ${r.refunds} refunds, ${r.payouts} payouts, ${r.threads} threads with ${r.messages} messages, ${r.stats} daily page stats ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
  return summary;
}

// `npm run db:seed` runs this file directly; tests import runSeed instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSeed()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
