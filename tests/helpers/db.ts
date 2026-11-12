import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import type { MilestoneState } from "@/generated/prisma/enums";

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
  agent: "PROFILE" as const,
  sessionId: null,
});
export const clientAudit = (clientId: string) => ({ actor: { type: "CLIENT" as const, clientId }, agent: null, sessionId: null });


/** A project post. OPEN by default so freelancers can see it. */
export async function makeBrief(
  clientId: string,
  over: Partial<{ title: string; description: string; locale: string; skills: string[]; budget_minor: number | null; budget_currency: string | null; status: "DRAFT" | "OPEN" | "CLOSED" }> = {},
) {
  return prisma.brief.create({
    data: {
      client_id: clientId,
      title: over.title ?? "Logo for a bakery",
      description: over.description ?? "We need a new logo and a small colour palette for our bakery.",
      locale: over.locale ?? "en-US",
      skills: over.skills ?? ["logo design"],
      budget_minor: over.budget_minor === undefined ? 90_000 : over.budget_minor,
      budget_currency: over.budget_currency === undefined ? (over.budget_minor === null ? null : "USD") : over.budget_currency,
      status: over.status ?? "OPEN",
    },
  });
}

/** A proposal a freelancer sent on a project (SENT, in the project's currency). */
export async function makeProposal(
  freelancerId: string,
  brief: { id: string; client_id: string; locale: string },
  over: Partial<{ total_minor: number; currency: string; delivery_days: number; revisions: number; scope: string; status: "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN" }> = {},
) {
  const now = new Date();
  return prisma.quote.create({
    data: {
      client_id: brief.client_id,
      freelancer_id: freelancerId,
      brief_id: brief.id,
      locale: brief.locale,
      currency: over.currency ?? "USD",
      status: over.status ?? "SENT",
      request_message: "Project",
      total_minor: over.total_minor ?? 60_000,
      delivery_days: over.delivery_days ?? 14,
      revisions: over.revisions ?? 2,
      scope: over.scope ?? "Three concepts, one round of changes and final files.",
      sent_at: now,
      expires_at: new Date(now.getTime() + 14 * 86_400_000),
    },
  });
}
