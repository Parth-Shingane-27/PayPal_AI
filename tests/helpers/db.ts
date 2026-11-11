import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import type { MilestoneState, PackageTier } from "@/generated/prisma/enums";
import { getMarket } from "@/server/domain/markets";

/** Empties every table in the test database (all but Prisma's own bookkeeping). */
export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

let n = 0;
const uniq = () => `${Date.now()}-${++n}`;

export async function makeFreelancer(
  over: Partial<{ country: string; currency: string; locale: string; name: string; hourly_floor_minor: number; timezone: string; skills: string[] }> = {},
) {
  const u = uniq();
  return prisma.freelancer.create({
    data: {
      name: over.name ?? `Freelancer ${u}`,
      email: `freelancer-${u}@test.local`,
      paypal_email: `payouts-${u}@test.local`,
      country: over.country ?? "US",
      currency: over.currency ?? "USD",
      locale: over.locale ?? "en-US",
      timezone: over.timezone ?? "America/New_York",
      skills: over.skills ?? ["logo design", "branding"],
      languages: ["en"],
      hourly_floor_minor: over.hourly_floor_minor ?? 4000,
      invoice_prefix: `T${u.replace(/\D/g, "").slice(-7)}`,
    },
  });
}

export async function makeClient(over: Partial<{ locale: string; country: string; name: string; company_name: string | null; tax_id: string | null }> = {}) {
  const u = uniq();
  return prisma.client.create({
    data: {
      name: over.name ?? `Client ${u}`,
      email: `client-${u}@test.local`,
      locale: over.locale ?? "en-US",
      country: over.country ?? "US",
      company_name: over.company_name ?? null,
      tax_id: over.tax_id ?? null,
    },
  });
}

/** A package service with Basic / Standard / Premium in the freelancer's currency. */
export async function makeService(freelancerId: string, over: Partial<{ currency: string; code: string; title: string; prices: Record<PackageTier, number> }> = {}) {
  const prices = over.prices ?? { BASIC: 15_000, STANDARD: 30_000, PREMIUM: 60_000 };
  const tiers: { tier: PackageTier; days: number; revisions: number; hours: number }[] = [
    { tier: "BASIC", days: 3, revisions: 1, hours: 3 },
    { tier: "STANDARD", days: 5, revisions: 2, hours: 6 },
    { tier: "PREMIUM", days: 10, revisions: 4, hours: 12 },
  ];
  return prisma.service.create({
    data: {
      freelancer_id: freelancerId,
      code: over.code ?? `SVC-${uniq()}`,
      title: over.title ?? "Logo design",
      description: "A logo and brand mark, delivered as vector files.",
      source_locale: "en-US",
      category: "Design",
      pricing_model: "PACKAGES",
      currency: over.currency ?? "USD",
      packages: {
        create: tiers.map((t) => ({
          tier: t.tier,
          name: t.tier[0] + t.tier.slice(1).toLowerCase(),
          scope: `${t.tier.toLowerCase()} scope`,
          delivery_days: t.days,
          revisions: t.revisions,
          estimated_hours: t.hours,
          base_price_minor: prices[t.tier],
        })),
      },
    },
    include: { packages: true },
  });
}

/**
 * A contract with milestones in the given states. Funded milestones get a
 * COMPLETED payment with fees; released ones also get net_to_freelancer.
 */
export async function makeContract(
  freelancerId: string,
  clientId: string,
  milestones: { amount_minor: number; state?: MilestoneState }[],
  over: Partial<{ currency: string; locale: string; revisions_allowed: number; title: string; status: "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED" }> = {},
) {
  const currency = over.currency ?? "USD";
  const total = milestones.reduce((s, m) => s + m.amount_minor, 0);
  const contract = await prisma.contract.create({
    data: {
      client_id: clientId,
      freelancer_id: freelancerId,
      source: "QUOTE",
      title: over.title ?? "Brand identity",
      scope: "Logo, palette and guidelines.",
      locale: over.locale ?? "en-US",
      currency,
      total_minor: total,
      revisions_allowed: over.revisions_allowed ?? 2,
      status: over.status ?? "ACTIVE",
    },
  });
  const now = new Date();
  const rows = [];
  for (const [i, m] of milestones.entries()) {
    const state = m.state ?? "AWAITING_FUNDING";
    const funded = state !== "AWAITING_FUNDING" && state !== "CANCELLED";
    const released = state === "ACCEPTED";
    const milestone = await prisma.milestone.create({
      data: {
        contract_id: contract.id,
        freelancer_id: freelancerId,
        client_id: clientId,
        position: i + 1,
        title: `Milestone ${i + 1}`,
        currency,
        amount_minor: m.amount_minor,
        state,
        funded_at: funded ? now : null,
        delivered_at: state === "DELIVERED" || released ? now : null,
        released_at: released ? now : null,
        release_kind: released ? "CLIENT_ACCEPTED" : null,
      },
    });
    let payment = null;
    if (funded) {
      const paypalFee = Math.round(m.amount_minor * 0.0349) + 49;
      const platformFee = Math.round(m.amount_minor * 0.05);
      payment = await prisma.milestonePayment.create({
        data: {
          milestone_id: milestone.id,
          contract_id: contract.id,
          freelancer_id: freelancerId,
          client_id: clientId,
          paypal_order_id: `PP-${randomUUID()}`,
          paypal_invoice_id: `${milestone.id}-${randomUUID()}`,
          status: "COMPLETED",
          currency,
          gross_minor: m.amount_minor,
          paypal_fee_minor: paypalFee,
          platform_fee_minor: platformFee,
          fx_cost_minor: 0,
          net_to_freelancer_minor: released ? m.amount_minor - paypalFee - platformFee : null,
          capture_id: `CAP-${randomUUID()}`,
          captured_at: now,
          released_at: released ? now : null,
        },
      });
    }
    rows.push({ milestone, payment });
  }
  return { contract, milestones: rows };
}

export const freelancerAudit = (freelancerId: string) => ({
  actor: { type: "FREELANCER" as const, freelancerId },
  agent: "PROJECTS" as const,
  sessionId: null,
});
export const clientAudit = (clientId: string) => ({ actor: { type: "CLIENT" as const, clientId }, agent: null, sessionId: null });

/** A service page in one market with a price per package (market currency, minor units). */
export async function makeServicePage(
  service: { id: string; freelancer_id: string; packages: { id: string; tier: PackageTier }[] },
  over: Partial<{ locale: string; title: string; description: string; status: "DRAFT" | "PUBLISHED"; prices: Partial<Record<PackageTier, number>>; hourly_rate_minor: number | null }> = {},
) {
  const locale = over.locale ?? "en-US";
  const prices = over.prices ?? { BASIC: 15_000, STANDARD: 30_000, PREMIUM: 60_000 };
  return prisma.servicePage.create({
    data: {
      service_id: service.id,
      freelancer_id: service.freelancer_id,
      locale,
      currency: getMarket(locale).currency,
      title: over.title ?? "Logo design",
      description: over.description ?? "A logo and brand mark, delivered as vector files.",
      seo_title: over.title ?? "Logo design",
      hourly_rate_minor: over.hourly_rate_minor ?? null,
      status: over.status ?? "PUBLISHED",
      published_at: (over.status ?? "PUBLISHED") === "PUBLISHED" ? new Date() : null,
      prices: { create: service.packages.filter((p) => prices[p.tier] !== undefined).map((p) => ({ package_id: p.id, price_minor: prices[p.tier]! })) },
    },
    include: { prices: true },
  });
}
