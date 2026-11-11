import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { estimatePayoutFee } from "@/server/domain/fees";
import { closeQueues, QUEUE_NAMES, queuePrefix, redisConnection } from "@/server/queue";
import { approveFreelancerAction, rejectFreelancerAction } from "@/server/services/gig/approvals";
import { cancelDraftContract, getContract, proposeMilestonePlan } from "@/server/services/gig/contracts";
import { getInvoiceForMilestone, listInvoices } from "@/server/services/gig/invoices";
import { freelancerLedger } from "@/server/services/gig/ledger";
import { captureMilestoneFunding, startMilestoneFunding } from "@/server/services/gig/milestone-payments";
import { acceptDelivery, deliverMilestone, openDispute, requestRevision, startMilestone, sweepAutoReleases } from "@/server/services/gig/milestones";
import type { GigOwner } from "@/server/services/gig/owner";
import { proposeFreelancerPayoutSchedule, runFreelancerPayout } from "@/server/services/gig/payouts";
import { closeQuote, requestQuote, sendQuote, viewQuote } from "@/server/services/gig/quotes";
import { proposeMilestoneRefund } from "@/server/services/gig/refunds";
import { processWebhookEvent, storeWebhookEvent } from "@/server/services/webhooks";
import { clientAudit, freelancerAudit, makeClient, makeContract, makeFreelancer, makeService, resetDb } from "../helpers/db";
import { fakeFx, fakePayPal } from "../helpers/fakes";

beforeEach(resetDb);
afterAll(closeQueues);

const DAY = 86_400_000;
const action = (tool: string, input: unknown = {}) => ({ id: randomUUID(), tool, input });
const asFreelancer = (id: string, locale = "en-US"): GigOwner => ({ type: "FREELANCER", freelancerId: id, locale });
const asClient = (id: string, locale = "de-DE"): GigOwner => ({ type: "CLIENT", clientId: id, locale });

/** An Indian logo designer selling to a German client: a de-DE page with EUR package prices. */
async function world() {
  const f = await makeFreelancer({ name: "Priya Raman Krishnan", country: "IN", currency: "USD", locale: "en-US", timezone: "Asia/Kolkata" });
  const c = await makeClient({ name: "Jonas Weber", locale: "de-DE", country: "DE", company_name: "Nordlicht GmbH", tax_id: "DE123456789" });
  const svc = await makeService(f.id);
  const page = await prisma.servicePage.create({
    data: {
      service_id: svc.id,
      freelancer_id: f.id,
      locale: "de-DE",
      currency: "EUR",
      title: "Logodesign",
      description: "Ein Logo als Vektordatei.",
      seo_title: "Logodesign",
      status: "PUBLISHED",
      published_at: new Date(),
      prices: { create: svc.packages.map((p) => ({ package_id: p.id, price_minor: { BASIC: 12_000, STANDARD: 30_000, PREMIUM: 60_000 }[p.tier] })) },
    },
  });
  return { f, c, svc, page, fo: asFreelancer(f.id), co: asClient(c.id) };
}

/** Plan -> PayPal order -> capture for the next milestone. */
async function fundNext(w: Awaited<ReturnType<typeof world>>, contractId: string, pp = fakePayPal()) {
  const started = await startMilestoneFunding(w.co, contractId, clientAudit(w.c.id), { paypal: pp.api });
  const captured = await captureMilestoneFunding(w.co, started.paypal_order_id, clientAudit(w.c.id), { paypal: pp.api, fx: fakeFx() });
  return { started, captured, pp };
}

describe("package -> milestone plan -> fund -> deliver -> accept -> invoice", () => {
  it("holds the money until the client accepts, then releases it net of fees and invoices it", async () => {
    const w = await world();
    const plan = await proposeMilestonePlan(w.co, { servicePageId: w.page.id, tier: "STANDARD" }, [
      { title: "Concepts", amount: null },
      { title: "Final files", amount: null },
    ]);
    expect(plan).toMatchObject({ status: "DRAFT", adds_up: true, charged: false, total: { amount_minor: 30_000, currency: "EUR" } });
    expect(plan.milestones.map((m) => m.amount.amount_minor)).toEqual([15_000, 15_000]);
    expect(plan.milestones.every((m) => m.state === "AWAITING_FUNDING" && m.due_date)).toBe(true);

    const pp = fakePayPal();
    const started = await startMilestoneFunding(w.co, plan.contract_id, clientAudit(w.c.id), { paypal: pp.api });
    expect(started).toMatchObject({ position: 1, reused: false, amount: { amount_minor: 15_000 } });
    // A service: no item category, no shipping address.
    const order = pp.calls.find((c) => c.op === "createOrder")!.args[1] as { kind: string; totalMinor: number; currency: string };
    expect(order).toMatchObject({ kind: "service", totalMinor: 15_000, currency: "EUR" });
    // A second click reuses the live PayPal order.
    expect((await startMilestoneFunding(w.co, plan.contract_id, clientAudit(w.c.id), { paypal: pp.api })).reused).toBe(true);
    expect(pp.count("createOrder")).toBe(1);

    // Nothing captured yet: nothing in holding.
    expect(await freelancerLedger(w.f.id)).toEqual([]);

    const captured = await captureMilestoneFunding(w.co, started.paypal_order_id, clientAudit(w.c.id), { paypal: pp.api, fx: fakeFx() });
    expect(captured).toMatchObject({ milestone_state: "FUNDED", payment_status: "COMPLETED", already_captured: false });
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: plan.contract_id } })).status).toBe("ACTIVE");
    let [line] = await freelancerLedger(w.f.id);
    expect(line).toMatchObject({ currency: "EUR", inHolding: 15_000, released: 0, available: 0 });
    // Capturing again is harmless.
    expect((await captureMilestoneFunding(w.co, started.paypal_order_id, clientAudit(w.c.id), { paypal: pp.api })).already_captured).toBe(true);
    expect(pp.count("captureOrder")).toBe(1);

    const m1 = plan.milestones[0]!.milestone_id;
    await startMilestone(w.fo, m1);
    const now = new Date();
    const delivered = await deliverMilestone(w.fo, m1, { note: "Three concepts attached." }, now);
    expect(delivered.state).toBe("DELIVERED");
    expect(delivered.auto_release_at?.getTime()).toBe(now.getTime() + 7 * DAY);

    const { released } = await acceptDelivery(w.co, m1);
    const pay = await prisma.milestonePayment.findFirstOrThrow({ where: { milestone_id: m1, status: "COMPLETED" } });
    const net = 15_000 - pay.paypal_fee_minor! - pay.platform_fee_minor! - pay.fx_cost_minor!;
    expect(released.net_minor).toBe(net);
    expect(pay.platform_fee_minor).toBe(750);
    [line] = await freelancerLedger(w.f.id);
    expect(line).toMatchObject({ inHolding: 0, released: net, available: net });

    const inv = await getInvoiceForMilestone(w.co, m1);
    expect(inv).toMatchObject({
      number: `GG-${w.f.invoice_prefix}-000001`,
      locale: "de-DE",
      currency: "EUR",
      to: { name: "Jonas Weber", company: "Nordlicht GmbH", tax_id: "DE123456789" },
      total: { amount_minor: 15_000 },
    });
    expect(inv.lines).toHaveLength(1);
    // Both parties see it; nobody else does.
    expect((await getInvoiceForMilestone(w.fo, m1)).number).toBe(inv.number);
    const other = await makeClient();
    await expect(getInvoiceForMilestone(asClient(other.id), m1)).rejects.toThrow(/not found/);

    // Milestone 2: the next invoice number, and the contract completes.
    const second = await fundNext(w, plan.contract_id);
    expect(second.started.position).toBe(2);
    const m2 = plan.milestones[1]!.milestone_id;
    await deliverMilestone(w.fo, m2, {});
    await acceptDelivery(w.co, m2);
    expect((await listInvoices(w.fo)).map((i) => i.number).sort()).toEqual([`GG-${w.f.invoice_prefix}-000001`, `GG-${w.f.invoice_prefix}-000002`]);
    expect((await getContract(w.co, plan.contract_id)).status).toBe("COMPLETED");
    await expect(startMilestoneFunding(w.co, plan.contract_id, clientAudit(w.c.id), { paypal: pp.api })).rejects.toThrow(/completed/);

    // Every step is on the audit trail.
    const tools = (await prisma.agentAction.findMany({ where: { freelancer_id: w.f.id }, select: { tool: true } })).map((a) => a.tool);
    expect(tools).toEqual(expect.arrayContaining(["milestone.fund", "milestone.start", "milestone.deliver", "milestone.accept"]));
    // PayPal calls are audited by the real client against the freelancer (the fake only records the context).
    expect(pp.calls.find((c) => c.op === "captureOrder")!.args[0]).toMatchObject({ actor: "CLIENT", actorId: w.c.id, freelancerId: w.f.id });
  });

  it("checks that a plan adds up to the package price", async () => {
    const w = await world();
    await expect(
      proposeMilestonePlan(w.co, { servicePageId: w.page.id, tier: "BASIC" }, [
        { title: "A", amount: "50" },
        { title: "B", amount: "60" },
      ]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", details: { total: { amount_minor: 12_000 }, milestones_sum: { amount_minor: 11_000 }, difference: { amount_minor: 1_000 } } });
    await expect(proposeMilestonePlan(w.co, { servicePageId: w.page.id, tier: "BASIC" }, [{ title: "A", amount: "60" }, { title: "B", amount: null }])).rejects.toThrow(
      /every milestone, or for none/,
    );
    // A page for another market cannot be bought from here.
    await expect(proposeMilestonePlan(asClient(w.c.id, "en-US"), { servicePageId: w.page.id, tier: "BASIC" }, [{ title: "A", amount: null }])).rejects.toThrow(/another market/);
  });

  it("replaces a draft plan, and lets the client cancel a draft with nothing paid", async () => {
    const w = await world();
    const a = await proposeMilestonePlan(w.co, { servicePageId: w.page.id, tier: "PREMIUM" }, [{ title: "All", amount: null }]);
    const b = await proposeMilestonePlan(w.co, { servicePageId: w.page.id, tier: "PREMIUM" }, [{ title: "Half", amount: "300" }, { title: "Half", amount: "300" }]);
    expect(await prisma.contract.count({ where: { id: a.contract_id } })).toBe(0);
    expect(b.milestones).toHaveLength(2);
    await expect(cancelDraftContract(w.co, b.contract_id)).resolves.toMatchObject({ status: "CANCELLED" });
    expect(await prisma.milestoneEvent.count({ where: { event: "CANCEL" } })).toBe(2);
  });
});

describe("owner checks", () => {
  it("keeps every party to their own milestones and to their own buttons", async () => {
    const w = await world();
    const plan = await proposeMilestonePlan(w.co, { servicePageId: w.page.id, tier: "BASIC" }, [{ title: "All", amount: null }]);
    const mallory = await makeClient();
    const eve = await makeFreelancer();
    const pp = fakePayPal();
    await expect(startMilestoneFunding(asClient(mallory.id), plan.contract_id, clientAudit(mallory.id), { paypal: pp.api })).rejects.toThrow(/Contract not found/);
    await expect(startMilestoneFunding(w.fo, plan.contract_id, freelancerAudit(w.f.id), { paypal: pp.api })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await fundNext(w, plan.contract_id, pp);
    const m = plan.milestones[0]!.milestone_id;
    await expect(deliverMilestone(asFreelancer(eve.id), m, {})).rejects.toThrow(/Milestone not found/);
    await deliverMilestone(w.fo, m, {});
    // The freelancer can never release their own milestone.
    await expect(acceptDelivery(w.fo, m)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(acceptDelivery(asClient(mallory.id), m)).rejects.toThrow(/Milestone not found/);
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: m } })).state).toBe("DELIVERED");
  });
});

describe("quotes", () => {
  it("goes REQUESTED -> SENT -> plan -> funded -> ACCEPTED", async () => {
    const w = await world();
    const brief = await prisma.brief.create({ data: { client_id: w.c.id, title: "Rebrand", description: "Rebrand our bakery chain.", locale: "de-DE" } });
    const q = await requestQuote(w.co, { servicePageId: w.page.id, briefId: brief.id, message: "Können Sie ein Logo für unsere Bäckerei machen?" });
    expect(q).toMatchObject({ status: "REQUESTED", total: null, already_requested: false });
    expect((await prisma.brief.findUniqueOrThrow({ where: { id: brief.id } })).status).toBe("OPEN");
    expect((await requestQuote(w.co, { servicePageId: w.page.id, briefId: brief.id, message: "again" })).already_requested).toBe(true);

    await expect(proposeMilestonePlan(w.co, { quoteId: q.quote_id }, [{ title: "All", amount: null }])).rejects.toThrow(/not sent a price/);
    await expect(sendQuote(asFreelancer((await makeFreelancer()).id), q.quote_id, { total: "900", delivery_days: 10, revisions: 2, scope: "Logo, palette and a short guide." })).rejects.toThrow(
      /not found/,
    );
    const sent = await sendQuote(w.fo, q.quote_id, { total: "900", delivery_days: 10, revisions: 2, scope: "Logo, palette and a short guide." });
    expect(sent).toMatchObject({ status: "SENT", total: { amount_minor: 90_000, currency: "EUR" } });

    const plan = await proposeMilestonePlan(w.co, { quoteId: q.quote_id }, [
      { title: "Concepts", amount: "300" },
      { title: "Final", amount: "600" },
    ]);
    expect(plan.revisions_allowed).toBe(2);
    // Once a plan exists, the freelancer cannot change the price under it.
    await expect(sendQuote(w.fo, q.quote_id, { total: "1200", delivery_days: 10, revisions: 2, scope: "A bigger scope than before." })).rejects.toThrow(/milestone plan/);
    await fundNext(w, plan.contract_id);
    expect((await viewQuote(w.co, q.quote_id)).status).toBe("ACCEPTED");
    await expect(closeQuote(w.co, q.quote_id)).rejects.toThrow(/already accepted/);
  });

  it("treats a quote past its validity as expired", async () => {
    const w = await world();
    const q = await requestQuote(w.co, { servicePageId: w.page.id, message: "Price?" });
    const t0 = new Date("2026-11-01T00:00:00Z");
    await sendQuote(w.fo, q.quote_id, { total: "100", delivery_days: 3, revisions: 1, scope: "One logo, two drafts.", valid_days: 2 }, t0);
    expect((await viewQuote(w.co, q.quote_id, new Date("2026-11-04T00:00:00Z"))).status).toBe("EXPIRED");
    await expect(proposeMilestonePlan(w.co, { quoteId: q.quote_id }, [{ title: "All", amount: null }], new Date("2026-11-04T00:00:00Z"))).rejects.toThrow(/expired/);
  });
});

describe("revisions and disputes", () => {
  it("stops revisions at the contract limit", async () => {
    const w = await world();
    const { milestones } = await makeContract(w.f.id, w.c.id, [{ amount_minor: 10_000, state: "DELIVERED" }], { currency: "EUR", revisions_allowed: 1 });
    const m = milestones[0]!.milestone.id;
    await requestRevision(w.co, m, "Bigger font, please.");
    await deliverMilestone(w.fo, m, { note: "Updated." });
    await expect(requestRevision(w.co, m, "Again.")).rejects.toThrow(/revision/);
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: m } })).revision_count).toBe(1);
    await expect(requestRevision(w.co, m, "  ")).rejects.toThrow(/what should change/);
  });

  it("a partial refund of a disputed milestone releases the rest, with the refund on the invoice", async () => {
    const w = await world();
    const plan = await proposeMilestonePlan(w.co, { servicePageId: w.page.id, tier: "STANDARD" }, [{ title: "All", amount: null }]);
    await fundNext(w, plan.contract_id);
    const m = plan.milestones[0]!.milestone_id;
    await deliverMilestone(w.fo, m, {});
    await openDispute(w.co, m, "Only half of what we agreed was delivered.");
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: m } })).auto_release_at).toBeNull();

    const a = action("propose_refund");
    const proposal = await proposeMilestoneRefund(w.f.id, { milestoneId: m, amount: "100.00", reason: "Partial delivery", rationale: "Agreed with client" }, freelancerAudit(w.f.id), a);
    expect(proposal).toMatchObject({ status: "PENDING_APPROVAL", from_holding: true, full_refund: false });
    // Proposing moved nothing: the money is still in holding.
    expect((await freelancerLedger(w.f.id))[0]).toMatchObject({ inHolding: 30_000, available: 0 });
    // The client cannot release while a refund is pending approval.
    await expect(acceptDelivery(w.co, m)).rejects.toThrow(/refund for this milestone is waiting/);

    const pp = fakePayPal({ refundCapture: async () => ({ refundId: "R-1", status: "COMPLETED", paypalFeeReturnedMinor: 300 }) });
    const d = await approveFreelancerAction(a.id, w.f.id, { paypal: pp.api });
    expect(d.status).toBe("EXECUTED");
    expect(d.result).toMatchObject({ milestone_effect: "RELEASED_REST", freelancer_debit: { amount_minor: 0 } });
    expect((await approveFreelancerAction(a.id, w.f.id, { paypal: pp.api })).already_decided).toBe(true);
    expect(pp.count("refundCapture")).toBe(1);

    const ms = await prisma.milestone.findUniqueOrThrow({ where: { id: m } });
    expect(ms).toMatchObject({ state: "ACCEPTED", release_kind: "DISPUTE_RESOLVED" });
    const pay = await prisma.milestonePayment.findFirstOrThrow({ where: { milestone_id: m } });
    const refund = await prisma.milestoneRefund.findFirstOrThrow({ where: { milestone_id: m } });
    const expected = 30_000 - 10_000 - (pay.paypal_fee_minor! - 300) - (pay.platform_fee_minor! - refund.platform_fee_returned_minor!) - pay.fx_cost_minor!;
    expect(pay.net_to_freelancer_minor).toBe(expected);
    expect((await freelancerLedger(w.f.id))[0]).toMatchObject({ inHolding: 0, released: expected, refunded: 0, available: expected });
    const inv = await getInvoiceForMilestone(w.fo, m);
    expect(inv.lines.map((l) => l.amount.amount_minor)).toEqual([30_000, -10_000]);
    expect(inv.total.amount_minor).toBe(20_000);
  });

  it("before acceptance, refunds out of holding must be full unless disputed; a full one ends the milestone", async () => {
    const w = await world();
    const plan = await proposeMilestonePlan(w.co, { servicePageId: w.page.id, tier: "BASIC" }, [{ title: "All", amount: null }]);
    await fundNext(w, plan.contract_id);
    const m = plan.milestones[0]!.milestone_id;
    await expect(proposeMilestoneRefund(w.f.id, { milestoneId: m, amount: "10.00", reason: "r", rationale: "r" }, freelancerAudit(w.f.id), action("propose_refund"))).rejects.toMatchObject({
      code: "NOT_REFUNDABLE",
    });
    const a = action("propose_refund");
    await proposeMilestoneRefund(w.f.id, { milestoneId: m, reason: "Cannot take this on", rationale: "r" }, freelancerAudit(w.f.id), a);
    await approveFreelancerAction(a.id, w.f.id, { paypal: fakePayPal().api });
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: m } })).state).toBe("REFUNDED");
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: plan.contract_id } })).status).toBe("COMPLETED");
    // From holding: the freelancer's balance never moved.
    expect(await freelancerLedger(w.f.id)).toEqual([]);
    expect(await prisma.invoice.count()).toBe(0);
  });

  it("a refund after release is debited from the released balance", async () => {
    const w = await world();
    const plan = await proposeMilestonePlan(w.co, { servicePageId: w.page.id, tier: "BASIC" }, [{ title: "All", amount: null }]);
    await fundNext(w, plan.contract_id);
    const m = plan.milestones[0]!.milestone_id;
    await deliverMilestone(w.fo, m, {});
    await acceptDelivery(w.co, m);
    const before = (await freelancerLedger(w.f.id))[0]!;
    const a = action("propose_refund");
    await proposeMilestoneRefund(w.f.id, { milestoneId: m, amount: "40.00", reason: "Goodwill", rationale: "r" }, freelancerAudit(w.f.id), a);
    const pp = fakePayPal({ refundCapture: async () => ({ refundId: "R-2", status: "COMPLETED", paypalFeeReturnedMinor: 100 }) });
    await approveFreelancerAction(a.id, w.f.id, { paypal: pp.api });
    const after = (await freelancerLedger(w.f.id))[0]!;
    // debit = 4000 - 100 PayPal fee returned - 200 platform fee returned (5% of 4000)
    expect(after.refunded).toBe(3_700);
    expect(after.available).toBe(before.available - 3_700);
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: m } })).state).toBe("ACCEPTED");
  });

  it("a rejected refund proposal moves nothing", async () => {
    const w = await world();
    const { milestones } = await makeContract(w.f.id, w.c.id, [{ amount_minor: 5_000, state: "DISPUTED" }], { currency: "EUR" });
    const a = action("propose_refund");
    await proposeMilestoneRefund(w.f.id, { milestoneId: milestones[0]!.milestone.id, reason: "r", rationale: "r" }, freelancerAudit(w.f.id), a);
    expect((await rejectFreelancerAction(a.id, w.f.id)).status).toBe("REJECTED");
    expect((await prisma.milestoneRefund.findFirstOrThrow()).status).toBe("REJECTED");
    await expect(approveFreelancerAction(a.id, w.f.id)).rejects.toThrow(/rejected/);
    await expect(rejectFreelancerAction(a.id, (await makeFreelancer()).id)).rejects.toThrow(/not found/);
  });
});

describe("auto-release", () => {
  it("releases an unanswered delivery after AUTO_RELEASE_DAYS, once, as SYSTEM", async () => {
    const w = await world();
    const plan = await proposeMilestonePlan(w.co, { servicePageId: w.page.id, tier: "BASIC" }, [{ title: "All", amount: null }]);
    await fundNext(w, plan.contract_id);
    const m = plan.milestones[0]!.milestone_id;
    const t0 = new Date();
    await deliverMilestone(w.fo, m, {}, t0);

    expect(await sweepAutoReleases(new Date(t0.getTime() + 6 * DAY))).toEqual({ released: 0, skipped: 0 });
    expect(await sweepAutoReleases(new Date(t0.getTime() + 7 * DAY + 1))).toEqual({ released: 1, skipped: 0 });
    expect(await sweepAutoReleases(new Date(t0.getTime() + 8 * DAY))).toEqual({ released: 0, skipped: 0 });

    const ms = await prisma.milestone.findUniqueOrThrow({ where: { id: m }, include: { events: true } });
    expect(ms).toMatchObject({ state: "ACCEPTED", release_kind: "AUTO_RELEASED", auto_release_at: null });
    expect(ms.events.find((e) => e.event === "AUTO_RELEASE")).toMatchObject({ actor: "SYSTEM", actor_id: null });
    expect(await prisma.agentAction.count({ where: { tool: "milestone.auto_release", actor: "SYSTEM", freelancer_id: w.f.id, agent: null } })).toBe(1);
    expect(await prisma.invoice.count({ where: { milestone_id: m } })).toBe(1);
  });

  it("does not release a delivery the client answered", async () => {
    const w = await world();
    const { milestones } = await makeContract(w.f.id, w.c.id, [{ amount_minor: 5_000, state: "FUNDED" }], { currency: "EUR", revisions_allowed: 2 });
    const m = milestones[0]!.milestone.id;
    const t0 = new Date();
    await deliverMilestone(w.fo, m, {}, t0);
    await requestRevision(w.co, m, "Change the colour.", new Date(t0.getTime() + DAY));
    expect(await sweepAutoReleases(new Date(t0.getTime() + 30 * DAY))).toEqual({ released: 0, skipped: 0 });
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: m } })).state).toBe("REVISION_REQUESTED");
  });
});

describe("payouts", () => {
  it("never pays out money in holding; pays released money after approval", async () => {
    const w = await world();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const { milestones } = await makeContract(w.f.id, w.c.id, [{ amount_minor: 50_000, state: "DELIVERED" }], { currency: "EUR" });
    await expect(
      proposeFreelancerPayoutSchedule(w.f.id, { currency: "EUR", payouts: [{ amount: "ALL_AVAILABLE", date: today }], rationale: "r" }, freelancerAudit(w.f.id), action("propose_payout_schedule")),
    ).rejects.toThrow(/in holding becomes available only when clients accept/);

    // makeContract's payment has no real capture to settle; release through the client's click.
    await prisma.milestone.update({ where: { id: milestones[0]!.milestone.id }, data: { auto_release_at: new Date(now.getTime() + DAY) } });
    await acceptDelivery(asClient(w.c.id), milestones[0]!.milestone.id);
    const available = (await freelancerLedger(w.f.id))[0]!.available;
    expect(available).toBeGreaterThan(0);

    const a = action("propose_payout_schedule");
    const out = await proposeFreelancerPayoutSchedule(w.f.id, { currency: "EUR", payouts: [{ amount: "ALL_AVAILABLE", date: today }], rationale: "Pay me" }, freelancerAudit(w.f.id), a);
    const payoutId = out.payouts[0]!.payout_id;
    const amount = out.payouts[0]!.amount.amount_minor;
    expect(amount + estimatePayoutFee(amount, "EUR")).toBeLessThanOrEqual(available);
    expect((await approveFreelancerAction(a.id, w.f.id)).status).toBe("EXECUTED");
    expect((await freelancerLedger(w.f.id))[0]!.reserved).toBe(amount + estimatePayoutFee(amount, "EUR"));

    const q = new Queue(QUEUE_NAMES.payouts, { connection: redisConnection(), prefix: queuePrefix() });
    const job = await q.getJob(payoutId);
    expect(job?.data).toEqual({ payoutId });
    await job?.remove();
    await q.close();

    const pp = fakePayPal();
    expect(await runFreelancerPayout(payoutId, pp.api)).toBe("POLL");
    expect(await runFreelancerPayout(payoutId, pp.api)).toBe("DONE");
    expect(pp.count("createPayout")).toBe(1);
    const p = await prisma.freelancerPayout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(p).toMatchObject({ status: "SUCCESS", fee_minor: 25, fee_is_estimate: false });
    const line = (await freelancerLedger(w.f.id))[0]!;
    expect(line.paidOut).toBe(amount + 25);
    expect(line.reserved).toBe(0);
  });
});

describe("webhooks", () => {
  it("funds a milestone from PAYMENT.CAPTURE.COMPLETED when the browser never came back", async () => {
    const w = await world();
    const plan = await proposeMilestonePlan(w.co, { servicePageId: w.page.id, tier: "BASIC" }, [{ title: "All", amount: null }]);
    const started = await startMilestoneFunding(w.co, plan.contract_id, clientAudit(w.c.id), { paypal: fakePayPal().api });
    const event = {
      id: `WH-${randomUUID()}`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource_type: "capture",
      resource: {
        id: "CAP-WH-1",
        status: "COMPLETED",
        amount: { currency_code: "EUR", value: "120.00" },
        seller_receivable_breakdown: { gross_amount: { currency_code: "EUR", value: "120.00" }, paypal_fee: { currency_code: "EUR", value: "4.58" }, net_amount: { currency_code: "EUR", value: "115.42" } },
        supplementary_data: { related_ids: { order_id: started.paypal_order_id } },
      },
    };
    expect(await storeWebhookEvent(event)).toBe(true);
    expect(await processWebhookEvent(event.id)).toMatchObject({ status: "PROCESSED" });
    const pay = await prisma.milestonePayment.findFirstOrThrow({ where: { paypal_order_id: started.paypal_order_id } });
    expect(pay).toMatchObject({ status: "COMPLETED", capture_id: "CAP-WH-1", paypal_fee_minor: 458, fee_is_estimate: false });
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: started.milestone_id } })).state).toBe("FUNDED");

    // A refund made directly in PayPal is recorded against the milestone, from holding.
    const refund = {
      id: `WH-${randomUUID()}`,
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource_type: "refund",
      resource: {
        id: "REF-WH-1",
        status: "COMPLETED",
        amount: { currency_code: "EUR", value: "120.00" },
        links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP-WH-1", method: "GET" }],
      },
    };
    await storeWebhookEvent(refund);
    expect(await processWebhookEvent(refund.id)).toMatchObject({ status: "PROCESSED" });
    expect(await prisma.milestoneRefund.findFirstOrThrow({ where: { paypal_refund_id: "REF-WH-1" } })).toMatchObject({ from_holding: true, freelancer_debit_minor: 0 });
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: started.milestone_id } })).state).toBe("REFUNDED");
  });
});
