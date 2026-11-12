import type { Milestone, MilestoneState, Prisma, ReleaseKind } from "@/generated/prisma/client";
import { coreConfig } from "../../config";
import { prisma, type Tx } from "../../db";
import { netOnRelease } from "../../domain/balances";
import { autoReleaseAt, describeState, type MilestoneEventName, type TransitionActor, transition } from "../../domain/milestones";
import { money } from "../../domain/money";
import { AppError, notFound } from "../../errors";
import { actorId, type Actor, asJson } from "../audit";
import { issueInvoice } from "./invoices";
import { type GigOwner, ownerWhere } from "./owner";

/**
 * Milestone actions taken by people (buttons and API routes) and by code
 * acting on facts (PayPal capture, completed refund, auto-release timer).
 * No agent tool calls anything in this file.
 *
 * Every change goes through applyTransition: the pure state machine decides,
 * a guarded update (WHERE state = from) applies it, and a milestone_events row
 * plus an agent_actions row record who did it.
 */

export const NOTE_MAX = 2000;

type Extra = Prisma.MilestoneUpdateManyMutationInput;

type Applied = { milestone: Milestone; from: MilestoneState; to: MilestoneState; event: MilestoneEventName };

function transitionActor(actor: Actor): TransitionActor {
  if (actor.type === "CLIENT") return "CLIENT";
  if (actor.type === "FREELANCER") return "FREELANCER";
  if (actor.type === "SYSTEM") return "SYSTEM";
  throw new AppError("FORBIDDEN", "Only the client, the freelancer or GlobalGig can change a milestone.");
}

/**
 * Applies one event inside `tx`. Throws AppError for a refused transition and
 * CONFLICT when the milestone changed under us (the caller re-reads).
 */
export async function applyTransition(
  tx: Tx,
  milestoneId: string,
  event: MilestoneEventName,
  actor: Actor,
  opts: { note?: string | null; extra?: Extra; now?: Date } = {},
): Promise<Applied> {
  const now = opts.now ?? new Date();
  const m = await tx.milestone.findUnique({ where: { id: milestoneId }, include: { contract: { select: { revisions_allowed: true } } } });
  if (!m) throw notFound("Milestone");
  const res = transition(m.state, event, {
    actor: transitionActor(actor),
    now,
    autoReleaseAt: m.auto_release_at,
    revisionCount: m.revision_count,
    revisionsAllowed: m.contract.revisions_allowed,
  });
  if (!res.ok) throw new AppError(res.code === "FORBIDDEN" ? "FORBIDDEN" : "CONFLICT", res.reason, { state: m.state, code: res.code });

  const moved = await tx.milestone.updateMany({ where: { id: m.id, state: m.state }, data: { state: res.to, ...opts.extra } });
  if (moved.count !== 1) throw new AppError("CONFLICT", "This milestone just changed. Refresh and try again.");

  await tx.milestoneEvent.create({
    data: { milestone_id: m.id, event, from_state: m.state, to_state: res.to, actor: actor.type, actor_id: actorId(actor), note: opts.note ?? null, created_at: now },
  });
  await tx.agentAction.create({
    data: {
      kind: "TOOL",
      tool: `milestone.${event.toLowerCase()}`,
      input: asJson({ milestone_id: m.id, contract_id: m.contract_id, note: opts.note ?? null }),
      output: asJson({ from: m.state, to: res.to }),
      status: "SUCCEEDED",
      actor: actor.type,
      actor_id: actorId(actor),
      freelancer_id: m.freelancer_id,
      created_at: now,
    },
  });
  const milestone = await tx.milestone.findUniqueOrThrow({ where: { id: m.id } });
  return { milestone, from: m.state, to: res.to, event };
}

/**
 * Release bookkeeping, in the same transaction as the ACCEPTED transition:
 * net_to_freelancer on the payment (less anything refunded from holding),
 * the invoice, and contract completion.
 */
async function release(tx: Tx, milestone: Milestone, kind: ReleaseKind, now: Date) {
  const open = await tx.milestoneRefund.count({ where: { milestone_id: milestone.id, status: { in: ["PROPOSED", "PENDING"] } } });
  if (open) {
    // Rolls back the ACCEPTED transition with the rest of the transaction.
    throw new AppError("CONFLICT", "A refund for this milestone is waiting for approval or for PayPal. It can be released once that refund is settled.");
  }
  const payment = await tx.milestonePayment.findFirst({
    where: { milestone_id: milestone.id, status: "COMPLETED", released_at: null },
    include: { refunds: { where: { from_holding: true, status: "COMPLETED" } } },
  });
  if (!payment) throw new Error(`Milestone ${milestone.id} reached ACCEPTED without a captured, unreleased payment`);
  const net = netOnRelease(
    {
      grossMinor: payment.gross_minor,
      paypalFeeMinor: payment.paypal_fee_minor ?? 0,
      platformFeeMinor: payment.platform_fee_minor ?? 0,
      fxCostMinor: payment.fx_cost_minor ?? 0,
    },
    payment.refunds.map((r) => ({
      amountMinor: r.amount_minor,
      paypalFeeReturnedMinor: r.paypal_fee_returned_minor ?? 0,
      platformFeeReturnedMinor: r.platform_fee_returned_minor ?? 0,
    })),
  );
  await tx.milestonePayment.update({ where: { id: payment.id }, data: { net_to_freelancer_minor: net, released_at: now } });
  await tx.milestone.update({ where: { id: milestone.id }, data: { released_at: now, release_kind: kind, auto_release_at: null } });
  await issueInvoice(tx, milestone.id, now);
  await syncContractStatus(tx, milestone.contract_id, now);
  return { net_minor: net, currency: payment.currency };
}

/** ACTIVE once anything is funded; COMPLETED when every milestone is settled. */
export async function syncContractStatus(tx: Tx, contractId: string, now = new Date()) {
  const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: { milestones: { select: { state: true } } } });
  if (c.status === "CANCELLED") return;
  const settled = c.milestones.every((m) => m.state === "ACCEPTED" || m.state === "REFUNDED" || m.state === "CANCELLED");
  const anyFunded = c.milestones.some((m) => m.state !== "AWAITING_FUNDING" && m.state !== "CANCELLED");
  if (settled && c.milestones.some((m) => m.state !== "CANCELLED")) {
    if (c.status !== "COMPLETED") await tx.contract.update({ where: { id: c.id }, data: { status: "COMPLETED", completed_at: now } });
  } else if (settled) {
    await tx.contract.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
  } else if (anyFunded && c.status === "DRAFT") {
    await tx.contract.update({ where: { id: c.id }, data: { status: "ACTIVE", activated_at: now } });
  }
}

async function owned(o: GigOwner, milestoneId: string) {
  const m = await prisma.milestone.findFirst({ where: { id: milestoneId, ...ownerWhere(o) } });
  if (!m) throw notFound("Milestone");
  return m;
}

const actorFor = (o: GigOwner): Actor => (o.type === "FREELANCER" ? { type: "FREELANCER", freelancerId: o.freelancerId } : { type: "CLIENT", clientId: o.clientId });

function cleanNote(note: string | null | undefined, required: string | null = null): string | null {
  const t = (note ?? "").trim();
  if (!t && required) throw new AppError("INVALID_INPUT", required);
  if (t.length > NOTE_MAX) throw new AppError("INVALID_INPUT", `Notes are limited to ${NOTE_MAX} characters.`);
  return t || null;
}

// --- Freelancer actions ---------------------------------------------------------

export async function startMilestone(o: GigOwner, milestoneId: string, now = new Date()) {
  const m = await owned(o, milestoneId);
  return prisma.$transaction(async (tx) => (await applyTransition(tx, m.id, "START", actorFor(o), { extra: { started_at: now }, now })).milestone);
}

/**
 * Hands the work over. Attachments already uploaded to the contract's thread
 * can be linked as deliverables. Starts the auto-release countdown.
 */
export async function deliverMilestone(o: GigOwner, milestoneId: string, input: { note?: string | null; attachmentIds?: string[] }, now = new Date()) {
  const m = await owned(o, milestoneId);
  const note = cleanNote(input.note);
  const days = coreConfig().AUTO_RELEASE_DAYS;
  return prisma.$transaction(async (tx) => {
    const applied = await applyTransition(tx, m.id, "DELIVER", actorFor(o), {
      note,
      now,
      extra: { delivered_at: now, auto_release_at: autoReleaseAt(now, days), ...(m.started_at ? {} : { started_at: now }) },
    });
    if (input.attachmentIds?.length) {
      const linked = await tx.attachment.updateMany({
        where: { id: { in: input.attachmentIds }, thread: { contract_id: m.contract_id, freelancer_id: m.freelancer_id } },
        data: { milestone_id: m.id },
      });
      if (linked.count !== new Set(input.attachmentIds).size) throw notFound("Attachment");
    }
    return applied.milestone;
  });
}

// --- Client actions -------------------------------------------------------------

/** "Accept delivery": the client's click releases the money to the freelancer. */
export async function acceptDelivery(o: GigOwner, milestoneId: string, now = new Date()) {
  const m = await owned(o, milestoneId);
  return prisma.$transaction(async (tx) => {
    const applied = await applyTransition(tx, m.id, "ACCEPT", actorFor(o), { now });
    const released = await release(tx, applied.milestone, applied.from === "DISPUTED" ? "DISPUTE_RESOLVED" : "CLIENT_ACCEPTED", now);
    return { milestone: await tx.milestone.findUniqueOrThrow({ where: { id: m.id } }), released };
  });
}

export async function requestRevision(o: GigOwner, milestoneId: string, note: string, now = new Date()) {
  const m = await owned(o, milestoneId);
  const text = cleanNote(note, "Say what should change.");
  return prisma.$transaction(
    async (tx) =>
      (await applyTransition(tx, m.id, "REQUEST_REVISION", actorFor(o), { note: text, now, extra: { revision_count: { increment: 1 }, auto_release_at: null } })).milestone,
  );
}

/** Freezes the money in holding; it moves only by an approved refund or the client accepting. */
export async function openDispute(o: GigOwner, milestoneId: string, reason: string, now = new Date()) {
  const m = await owned(o, milestoneId);
  const text = cleanNote(reason, "Describe the problem so the freelancer can respond.");
  return prisma.$transaction(
    async (tx) =>
      (await applyTransition(tx, m.id, "OPEN_DISPUTE", actorFor(o), { note: text, now, extra: { disputed_at: now, dispute_reason: text, auto_release_at: null } }))
        .milestone,
  );
}

/** Either party may cancel a milestone that was never funded. */
export async function cancelMilestone(o: GigOwner, milestoneId: string, now = new Date()) {
  const m = await owned(o, milestoneId);
  return prisma.$transaction(async (tx) => {
    const pending = await tx.milestonePayment.count({ where: { milestone_id: m.id, status: { in: ["PENDING"] } } });
    if (pending) throw new AppError("CONFLICT", "A payment for this milestone is still being processed by PayPal.");
    await tx.milestonePayment.updateMany({ where: { milestone_id: m.id, status: "CREATED" }, data: { status: "VOIDED" } });
    const applied = await applyTransition(tx, m.id, "CANCEL", actorFor(o), { now });
    await syncContractStatus(tx, m.contract_id, now);
    return applied.milestone;
  });
}

// --- Code acting on facts --------------------------------------------------------

const SYSTEM_ACTOR: Actor = { type: "SYSTEM" };

/**
 * The auto-release job: releases one delivered milestone whose countdown has
 * passed. Idempotent: a milestone that is no longer DELIVERED, or not yet due,
 * is left alone and reported as skipped.
 */
export async function autoReleaseMilestone(milestoneId: string, now = new Date()): Promise<"RELEASED" | "SKIPPED"> {
  try {
    return await prisma.$transaction(async (tx) => {
      const applied = await applyTransition(tx, milestoneId, "AUTO_RELEASE", SYSTEM_ACTOR, { now, note: `No response within ${coreConfig().AUTO_RELEASE_DAYS} days of delivery.` });
      await release(tx, applied.milestone, "AUTO_RELEASED", now);
      return "RELEASED" as const;
    });
  } catch (err) {
    if (err instanceof AppError && (err.code === "CONFLICT" || err.code === "NOT_FOUND")) return "SKIPPED";
    throw err;
  }
}

/** Delivered milestones whose auto-release time has passed. */
export function milestonesDueForAutoRelease(now = new Date(), limit = 200) {
  return prisma.milestone.findMany({
    where: { state: "DELIVERED", auto_release_at: { lte: now } },
    select: { id: true },
    orderBy: { auto_release_at: "asc" },
    take: limit,
  });
}

/** One sweep of the auto-release job. Safe to run concurrently and repeatedly. */
export async function sweepAutoReleases(now = new Date()): Promise<{ released: number; skipped: number }> {
  let released = 0;
  let skipped = 0;
  for (const { id } of await milestonesDueForAutoRelease(now)) {
    if ((await autoReleaseMilestone(id, now)) === "RELEASED") released++;
    else skipped++;
  }
  return { released, skipped };
}

/** Called after a capture completes (route or webhook). Idempotent: FUNDED twice is a no-op. */
export async function markFunded(tx: Tx, milestoneId: string, now = new Date()) {
  const m = await tx.milestone.findUniqueOrThrow({ where: { id: milestoneId } });
  if (m.state !== "AWAITING_FUNDING") return m;
  const applied = await applyTransition(tx, m.id, "FUND", SYSTEM_ACTOR, { now, extra: { funded_at: now } });
  await syncContractStatus(tx, m.contract_id, now);
  const contract = await tx.contract.findUniqueOrThrow({ where: { id: m.contract_id } });
  if (contract.quote_id) {
    const accepted = await tx.quote.updateMany({ where: { id: contract.quote_id, status: "SENT" }, data: { status: "ACCEPTED", decided_at: now } });
    // The first funded milestone settles the project: close it and turn the other proposals down.
    const quote = accepted.count > 0 ? await tx.quote.findUnique({ where: { id: contract.quote_id }, select: { brief_id: true } }) : null;
    if (quote?.brief_id) {
      await tx.quote.updateMany({ where: { brief_id: quote.brief_id, id: { not: contract.quote_id }, status: "SENT" }, data: { status: "DECLINED", decided_at: now } });
      await tx.brief.updateMany({ where: { id: quote.brief_id, status: { not: "CLOSED" } }, data: { status: "CLOSED" } });
    }
  }
  return applied.milestone;
}

/**
 * Called when an approved refund has completed at PayPal. A full refund ends
 * the milestone (REFUNDED); a partial refund of a disputed milestone resolves
 * it by releasing the rest; a partial refund after release changes no state.
 */
export async function afterRefundCompleted(tx: Tx, refundId: string, now = new Date()) {
  const r = await tx.milestoneRefund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true, milestone: true } });
  const refunded = await tx.milestoneRefund.aggregate({ where: { payment_id: r.payment_id, status: "COMPLETED" }, _sum: { amount_minor: true } });
  const total = refunded._sum.amount_minor ?? 0;
  const note = `Refund of ${money(r.amount_minor, r.currency).display}: ${r.reason}`;
  if (total >= r.payment.gross_minor) {
    if (r.milestone.state !== "REFUNDED") {
      await applyTransition(tx, r.milestone_id, "REFUND", SYSTEM_ACTOR, { now, note, extra: { auto_release_at: null } });
      await syncContractStatus(tx, r.contract_id, now);
    }
    return "REFUNDED" as const;
  }
  if (r.milestone.state === "DISPUTED") {
    const applied = await applyTransition(tx, r.milestone_id, "RESOLVE_RELEASE", SYSTEM_ACTOR, { now, note });
    await release(tx, applied.milestone, "DISPUTE_RESOLVED", now);
    return "RELEASED_REST" as const;
  }
  return "PARTIAL" as const;
}

// --- Reads ----------------------------------------------------------------------

export function milestoneView(m: Milestone, locale: string) {
  return {
    milestone_id: m.id,
    contract_id: m.contract_id,
    position: m.position,
    title: m.title,
    amount: money(m.amount_minor, m.currency, locale),
    state: m.state,
    state_label: describeState(m.state),
    due_date: m.due_date?.toISOString().slice(0, 10) ?? null,
    revision_count: m.revision_count,
    funded_at: m.funded_at?.toISOString() ?? null,
    delivered_at: m.delivered_at?.toISOString() ?? null,
    auto_release_at: m.auto_release_at?.toISOString() ?? null,
    released_at: m.released_at?.toISOString() ?? null,
    release_kind: m.release_kind,
    dispute_reason: m.dispute_reason,
  };
}

export async function getMilestone(o: GigOwner, milestoneId: string) {
  const m = await prisma.milestone.findFirst({
    where: { id: milestoneId, ...ownerWhere(o) },
    include: { events: { orderBy: { created_at: "asc" } }, attachments: { select: { id: true, file_name: true, content_type: true, size_bytes: true, created_at: true } } },
  });
  if (!m) throw notFound("Milestone");
  return {
    ...milestoneView(m, o.locale),
    history: m.events.map((e) => ({ event: e.event, from: e.from_state, to: e.to_state, by: e.actor, note: e.note, at: e.created_at.toISOString() })),
    deliverables: m.attachments.map((a) => ({ attachment_id: a.id, file_name: a.file_name, content_type: a.content_type, size_bytes: a.size_bytes, url: `/api/attachments/${a.id}` })),
  };
}
