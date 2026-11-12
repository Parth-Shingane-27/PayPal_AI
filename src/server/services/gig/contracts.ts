import type { ContractStatus, MilestoneState, Prisma } from "@/generated/prisma/client";
import { prisma } from "../../db";
import { checkMilestonePlan, MAX_MILESTONES, splitEvenly } from "../../domain/milestones";
import { money, parseDecimal } from "../../domain/money";
import { AppError, notFound } from "../../errors";
import { applyTransition, milestoneView } from "./milestones";
import { type GigOwner, lockClient, ownerWhere } from "./owner";

/**
 * Contracts and milestone plans. The price is fixed by the freelancer (a sent
 * proposal); a plan only splits that total into milestones, and code checks
 * the split adds up.
 *
 * propose_milestone_plan writes a DRAFT contract (milestones waiting to be funded):
 * nothing is charged until the client approves milestone 1 in PayPal.
 */

const DAY = 86_400_000;

export type PlanMilestoneInput = {
  title: string;
  description?: string | null;
  /** Decimal in the contract currency; null on every milestone = split evenly. */
  amount: string | null;
  due_in_days?: number | null;
};

export type PlanSource = { quoteId: string };

type Priced = {
  source: "QUOTE";
  freelancerId: string;
  quoteId: string;
  title: string;
  scope: string;
  currency: string;
  totalMinor: number;
  revisions: number;
  deliveryDays: number;
};

async function priceOf(clientId: string, src: PlanSource, now: Date): Promise<Priced> {
  const q = await prisma.quote.findFirst({ where: { id: src.quoteId, client_id: clientId }, include: { brief: { select: { title: true } } } });
  if (!q) throw notFound("Proposal");
  if (q.status !== "SENT" || q.total_minor === null) throw new AppError("CONFLICT", `This proposal is ${q.status.toLowerCase()}.`);
  if (q.expires_at && q.expires_at < now) throw new AppError("CONFLICT", "This proposal has expired. Ask the freelancer for a new one.");
  return {
    source: "QUOTE",
    freelancerId: q.freelancer_id,
    quoteId: q.id,
    title: (q.brief?.title ?? "Custom project").slice(0, 140),
    scope: q.scope ?? q.request_message,
    currency: q.currency,
    totalMinor: q.total_minor,
    revisions: q.revisions ?? 1,
    deliveryDays: q.delivery_days ?? 14,
  };
}

/** Amounts for the plan: all given (checked) or all null (even split). */
function planAmounts(totalMinor: number, currency: string, milestones: PlanMilestoneInput[]): number[] {
  if (milestones.length === 0 || milestones.length > MAX_MILESTONES) throw new AppError("INVALID_INPUT", `A plan needs 1 to ${MAX_MILESTONES} milestones.`);
  const given = milestones.filter((m) => m.amount !== null).length;
  if (given === 0) {
    try {
      return splitEvenly(totalMinor, milestones.length);
    } catch {
      throw new AppError("INVALID_INPUT", "The total is too small to split into that many milestones.");
    }
  }
  if (given !== milestones.length) throw new AppError("INVALID_INPUT", "Give an amount for every milestone, or for none (then the total is split evenly).");
  return milestones.map((m) => parseDecimal(m.amount!, currency));
}

export async function proposeMilestonePlan(o: GigOwner, src: PlanSource, milestones: PlanMilestoneInput[], now = new Date()) {
  if (o.type !== "CLIENT") throw new AppError("FORBIDDEN", "Only the client builds a milestone plan.");
  const priced = await priceOf(o.clientId, src, now);
  const amounts = planAmounts(priced.totalMinor, priced.currency, milestones);
  const check = checkMilestonePlan(priced.totalMinor, amounts);
  const m = (minor: number) => money(minor, priced.currency, o.locale);
  if (!check.ok) {
    throw new AppError("INVALID_INPUT", `The milestones must add up to the total of ${m(priced.totalMinor).display}. ${check.issues.map((i) => i.message).join(" ")}`, {
      total: m(priced.totalMinor),
      milestones_sum: m(check.sum),
      difference: m(priced.totalMinor - check.sum),
    });
  }
  for (const ms of milestones) {
    if (!ms.title.trim() || ms.title.length > 140) throw new AppError("INVALID_INPUT", "Each milestone needs a title of at most 140 characters.");
    if (ms.due_in_days !== null && ms.due_in_days !== undefined && (!Number.isInteger(ms.due_in_days) || ms.due_in_days < 1 || ms.due_in_days > 365)) {
      throw new AppError("INVALID_INPUT", "Due dates must be 1 to 365 days from today.");
    }
  }

  const contract = await prisma.$transaction(async (tx) => {
    await lockClient(tx, o.clientId);
    // One draft per proposal: a new plan replaces the old one if nothing was paid.
    const old = await tx.contract.findFirst({
      where: { client_id: o.clientId, status: "DRAFT", quote_id: priced.quoteId },
      include: { payments: { select: { status: true } } },
    });
    if (old) {
      if (old.payments.some((p) => p.status === "PENDING" || p.status === "COMPLETED")) {
        throw new AppError("CONFLICT", "A payment on this plan is already being processed by PayPal, so the plan can no longer change.");
      }
      await tx.milestonePayment.deleteMany({ where: { contract_id: old.id } });
      await tx.contract.delete({ where: { id: old.id } });
    }
    return tx.contract.create({
      data: {
        client_id: o.clientId,
        freelancer_id: priced.freelancerId,
        source: priced.source,
        quote_id: priced.quoteId,
        title: priced.title,
        scope: priced.scope,
        locale: o.locale,
        currency: priced.currency,
        total_minor: priced.totalMinor,
        revisions_allowed: priced.revisions,
        status: "DRAFT",
        milestones: {
          create: milestones.map((ms, i) => {
            // Default due dates spread the delivery time evenly across milestones.
            const days = ms.due_in_days ?? Math.ceil((priced.deliveryDays * (i + 1)) / milestones.length);
            return {
              freelancer_id: priced.freelancerId,
              client_id: o.clientId,
              position: i + 1,
              title: ms.title.trim(),
              description: (ms.description ?? "").trim().slice(0, 2000),
              currency: priced.currency,
              amount_minor: amounts[i]!,
              due_date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY),
            };
          }),
        },
      },
      include: { milestones: { orderBy: { position: "asc" } } },
    });
  });

  return {
    contract_id: contract.id,
    status: contract.status,
    title: contract.title,
    total: m(contract.total_minor),
    milestones_sum: m(check.sum),
    adds_up: true,
    revisions_allowed: contract.revisions_allowed,
    milestones: contract.milestones.map((ms) => milestoneView(ms, o.locale)),
    charged: false,
    next_step: "Nothing is charged yet. When the client is ready, create_milestone_payment starts PayPal checkout for milestone 1 only.",
  };
}

const contractInclude = {
  milestones: { orderBy: { position: "asc" as const } },
  freelancer: { select: { name: true, country: true } },
  client: { select: { name: true, company_name: true, country: true } },
} as const;

export async function getContract(o: GigOwner, contractId: string) {
  const c = await prisma.contract.findFirst({ where: { id: contractId, ...ownerWhere(o) }, include: contractInclude });
  if (!c) throw notFound("Contract");
  return contractView(c, o);
}

type ContractWith = Prisma.ContractGetPayload<{ include: typeof contractInclude }>;

function contractView(c: ContractWith, o: GigOwner) {
  const m = (minor: number) => money(minor, c.currency, o.locale);
  const sum = (states: MilestoneState[]) => c.milestones.filter((x) => states.includes(x.state)).reduce((s, x) => s + x.amount_minor, 0);
  return {
    contract_id: c.id,
    title: c.title,
    scope: c.scope,
    status: c.status,
    source: c.source,
    market: c.locale,
    currency: c.currency,
    total: m(c.total_minor),
    in_holding: m(sum(["FUNDED", "IN_PROGRESS", "DELIVERED", "REVISION_REQUESTED", "DISPUTED"])),
    released: m(sum(["ACCEPTED"])),
    awaiting_funding: m(sum(["AWAITING_FUNDING"])),
    revisions_allowed: c.revisions_allowed,
    freelancer: { name: c.freelancer.name, country: c.freelancer.country },
    client: { name: c.client.company_name ?? c.client.name, country: c.client.country },
    milestones: c.milestones.map((ms) => milestoneView(ms, o.locale)),
    created_at: c.created_at.toISOString(),
  };
}

export async function listContracts(o: GigOwner, opts: { status?: ContractStatus; milestoneState?: MilestoneState; limit?: number } = {}) {
  const rows = await prisma.contract.findMany({
    where: { ...ownerWhere(o), ...(opts.status ? { status: opts.status } : {}), ...(opts.milestoneState ? { milestones: { some: { state: opts.milestoneState } } } : {}) },
    include: contractInclude,
    orderBy: { updated_at: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
  });
  return rows.map((c) => contractView(c, o));
}

/** A client can drop a DRAFT plan (nothing was charged). */
export async function cancelDraftContract(o: GigOwner, contractId: string) {
  if (o.type !== "CLIENT") throw new AppError("FORBIDDEN", "Only the client can cancel a draft plan.");
  return prisma.$transaction(async (tx) => {
    await lockClient(tx, o.clientId);
    const c = await tx.contract.findFirst({ where: { id: contractId, client_id: o.clientId }, include: { payments: { select: { status: true } } } });
    if (!c) throw notFound("Contract");
    if (c.status !== "DRAFT" || c.payments.some((p) => p.status === "PENDING" || p.status === "COMPLETED")) {
      throw new AppError("CONFLICT", "Only a plan with nothing paid can be cancelled. Cancel or dispute single milestones instead.");
    }
    await tx.milestonePayment.updateMany({ where: { contract_id: c.id, status: "CREATED" }, data: { status: "VOIDED" } });
    const open = await tx.milestone.findMany({ where: { contract_id: c.id, state: "AWAITING_FUNDING" }, select: { id: true } });
    for (const ms of open) await applyTransition(tx, ms.id, "CANCEL", { type: "CLIENT", clientId: o.clientId });
    await tx.contract.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
    return { contract_id: c.id, status: "CANCELLED" as const };
  });
}
