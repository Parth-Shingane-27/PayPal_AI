import "dotenv/config";
import { pathToFileURL } from "node:url";
import { coreConfig } from "../src/server/config";
import { prisma } from "../src/server/db";
import { invoicePrefixFor } from "../src/server/domain/invoices";
import { CLIENTS, FREELANCERS } from "./seed/people";
import { createRng } from "./seed/prng";
import { type SeedClient, type SeedFreelancer, seedProjects } from "./seed/projects";

/**
 * GlobalGig demo data, deterministic (fixed PRNG seed), no API keys and no
 * Redis needed: 10 freelancers, 10 clients, and six months of projects clients
 * posted, proposals, contracts, milestones in every state, payments, refunds,
 * invoices, payouts and translated threads.
 *
 * Historical captures are "SEED-" ids, not real PayPal captures: they show up
 * in balances and invoices, but cannot be refunded through PayPal.
 */

const DAY = 86_400_000;

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

  // --- Six months of work ---------------------------------------------------------
  const r = await seedProjects({ rng, now, freelancers, clients, platformBps: cfg.PLATFORM_FEE_BPS });

  const summary = { freelancers: freelancers.length, clients: clients.length, ...r };
  if (opts.log !== false) console.log(
    `Seeded ${freelancers.length} freelancers, ${clients.length} clients, ${r.briefs} projects, ${r.quotes} proposals, ${r.contracts} contracts, ` +
      `${r.milestones} milestones ${JSON.stringify(r.states)}, ${r.invoices} invoices, ${r.refunds} refunds, ${r.payouts} payouts, ` +
      `${r.threads} threads with ${r.messages} messages in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
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
