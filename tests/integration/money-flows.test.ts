import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PayPalApiError } from "@/server/clients/paypal";
import { prisma } from "@/server/db";
import { estimatePayoutFee } from "@/server/domain/fees";
import { closeQueues, QUEUE_NAMES, queuePrefix, redisConnection } from "@/server/queue";
import { approveAction, rejectAction } from "@/server/services/approvals";
import { ledger } from "@/server/services/ledger";
import { proposePayoutSchedule, runPayout } from "@/server/services/payouts";
import { proposeRefund } from "@/server/services/refunds";
import { makeBuyer, makeListing, makePaidOrder, makeProduct, makeSeller, resetDb, sellerAudit } from "../helpers/db";
import { fakePayPal } from "../helpers/fakes";

beforeEach(resetDb);
afterAll(closeQueues);

const action = (tool: string, input: unknown = {}) => ({ id: randomUUID(), tool, input });

async function world() {
  const seller = await makeSeller();
  const buyer = await makeBuyer();
  const product = await makeProduct(seller.id);
  const listing = await makeListing(seller.id, product.id, { price_minor: 10000 });
  return { seller, buyer, listing };
}

describe("ledger", () => {
  it("applies earned - refunded - paidOut - reserved", async () => {
    const w = await world();
    const a = await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 }); // net 9100
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 }); // net 9100
    await prisma.refund.createMany({
      data: [
        { payment_id: a.payment.id, order_id: a.order.id, seller_id: w.seller.id, currency: "USD", amount_minor: 2000, reason: "r", status: "COMPLETED", seller_debit_minor: 1900 },
        { payment_id: a.payment.id, order_id: a.order.id, seller_id: w.seller.id, currency: "USD", amount_minor: 1000, reason: "r", status: "PENDING", seller_debit_minor: 950 },
        { payment_id: a.payment.id, order_id: a.order.id, seller_id: w.seller.id, currency: "USD", amount_minor: 5000, reason: "r", status: "PROPOSED" },
        { payment_id: a.payment.id, order_id: a.order.id, seller_id: w.seller.id, currency: "USD", amount_minor: 5000, reason: "r", status: "FAILED" },
      ],
    });
    const schedule = await prisma.payoutSchedule.create({ data: { seller_id: w.seller.id, currency: "USD", status: "APPROVED" } });
    const payout = (status: "SCHEDULED" | "PROCESSING" | "SUCCESS" | "FAILED" | "PROPOSED", amount: number, fee: number) =>
      prisma.payout.create({
        data: { schedule_id: schedule.id, seller_id: w.seller.id, currency: "USD", amount_minor: amount, fee_minor: fee, receiver_email: "x@y", scheduled_for: new Date(), status, sender_batch_id: randomUUID() },
      });
    await payout("SUCCESS", 3000, 60);
    await payout("PROCESSING", 1000, 20);
    await payout("SCHEDULED", 2000, 40);
    await payout("FAILED", 9000, 180);
    await payout("PROPOSED", 9000, 180);

    const [usd] = await ledger(w.seller.id);
    expect(usd).toEqual({ currency: "USD", earned: 18200, refunded: 2850, paidOut: 4080, reserved: 2040, available: 18200 - 2850 - 4080 - 2040 });
  });

  it("keeps currencies and sellers apart", async () => {
    const w = await world();
    const other = await makeSeller();
    await makePaidOrder(other.id, w.buyer.id, { ...w.listing, id: (await makeListing(other.id, (await makeProduct(other.id)).id)).id });
    const jp = await makeListing(w.seller.id, (await makeProduct(w.seller.id)).id, { locale: "ja-JP", price_minor: 7980 });
    await makePaidOrder(w.seller.id, w.buyer.id, jp, { paypalFee: 300, platformFee: 399 });
    const lines = await ledger(w.seller.id);
    expect(lines.map((l) => [l.currency, l.available])).toEqual([["JPY", 7980 - 300 - 399]]);
  });
});

describe("refund proposals and approval", () => {
  it("creates the refund and a PENDING_APPROVAL action together, and moves no money", async () => {
    const w = await world();
    const { order } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    const a = action("propose_refund", { order_id: order.id });
    const out = await proposeRefund(w.seller.id, { orderId: order.id, amount: "25.00", reason: "Damaged", rationale: "Buyer sent photos" }, sellerAudit(w.seller.id), a);
    expect(out).toMatchObject({ approval_id: a.id, status: "PENDING_APPROVAL", amount: { amount_minor: 2500 } });
    const row = await prisma.agentAction.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ status: "PENDING_APPROVAL", rationale: "Buyer sent photos", refund_id: out.refund_id, seller_id: w.seller.id });
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: out.refund_id } })).status).toBe("PROPOSED");
    expect((await ledger(w.seller.id))[0]!.refunded).toBe(0);
  });

  it("refuses more than is still refundable, counting other proposals", async () => {
    const w = await world();
    const { order } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    await proposeRefund(w.seller.id, { orderId: order.id, amount: "60.00", reason: "r", rationale: "r" }, sellerAudit(w.seller.id), action("propose_refund"));
    await expect(
      proposeRefund(w.seller.id, { orderId: order.id, amount: "50.00", reason: "r", rationale: "r" }, sellerAudit(w.seller.id), action("propose_refund")),
    ).rejects.toMatchObject({ code: "NOT_REFUNDABLE", message: expect.stringContaining("$40.00") });
    // The failed proposal left nothing behind.
    expect(await prisma.refund.count()).toBe(1);
    expect(await prisma.agentAction.count()).toBe(1);
  });

  it("explains an order that is already fully refunded", async () => {
    const w = await world();
    const { order, payment } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    await prisma.refund.create({
      data: { payment_id: payment.id, order_id: order.id, seller_id: w.seller.id, currency: "USD", amount_minor: 10000, reason: "r", status: "COMPLETED", seller_debit_minor: 9500 },
    });
    await expect(
      proposeRefund(w.seller.id, { orderId: order.id, reason: "again", rationale: "r" }, sellerAudit(w.seller.id), action("propose_refund")),
    ).rejects.toMatchObject({ code: "NOT_REFUNDABLE", message: expect.stringContaining("already been fully refunded") });
  });

  it("returns not found for another seller's order", async () => {
    const w = await world();
    const mallory = await makeSeller();
    const { order } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    await expect(
      proposeRefund(mallory.id, { orderId: order.id, reason: "r", rationale: "r" }, sellerAudit(mallory.id), action("propose_refund")),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Order not found." });
  });

  it("executes on approval with the refund maths, and a second approval is harmless", async () => {
    const w = await world();
    const { order } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 });
    const pp = fakePayPal({
      refundCapture: async () => ({ refundId: "R-1", status: "COMPLETED", paypalFeeReturnedMinor: 100 }),
    });
    const a = action("propose_refund");
    const proposal = await proposeRefund(w.seller.id, { orderId: order.id, amount: "40.00", reason: "Late", rationale: "r" }, sellerAudit(w.seller.id), a);

    const first = await approveAction(a.id, w.seller.id, { paypal: pp.api });
    expect(first).toMatchObject({ status: "EXECUTED", already_decided: false });
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: proposal.refund_id } });
    // platform_fee_returned = round(500 * 4000 / 10000) = 200; debit = 4000 - 100 - 200
    expect(refund).toMatchObject({ status: "COMPLETED", paypal_fee_returned_minor: 100, platform_fee_returned_minor: 200, seller_debit_minor: 3700 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PARTIALLY_REFUNDED");

    const second = await approveAction(a.id, w.seller.id, { paypal: pp.api });
    expect(second).toMatchObject({ status: "EXECUTED", already_decided: true });
    const [both] = await Promise.all([approveAction(a.id, w.seller.id, { paypal: pp.api }), approveAction(a.id, w.seller.id, { paypal: pp.api })]);
    expect(both.already_decided).toBe(true);
    expect(pp.count("refundCapture")).toBe(1);
  });

  it("runs only one execution when two approvals race", async () => {
    const w = await world();
    const { order } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    const pp = fakePayPal();
    const a = action("propose_refund");
    await proposeRefund(w.seller.id, { orderId: order.id, reason: "r", rationale: "r" }, sellerAudit(w.seller.id), a);
    const results = await Promise.all([approveAction(a.id, w.seller.id, { paypal: pp.api }), approveAction(a.id, w.seller.id, { paypal: pp.api })]);
    expect(results.filter((r) => !r.already_decided)).toHaveLength(1);
    expect(pp.count("refundCapture")).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("REFUNDED");
  });

  it("records EXECUTION_FAILED when PayPal rejects the refund", async () => {
    const w = await world();
    const { order } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    const pp = fakePayPal({
      refundCapture: async () => {
        throw new PayPalApiError(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "REFUND_AMOUNT_EXCEEDED" }] });
      },
    });
    const a = action("propose_refund");
    const p = await proposeRefund(w.seller.id, { orderId: order.id, reason: "r", rationale: "r" }, sellerAudit(w.seller.id), a);
    const d = await approveAction(a.id, w.seller.id, { paypal: pp.api });
    expect(d.status).toBe("EXECUTION_FAILED");
    expect(d.error).toMatch(/REFUND_AMOUNT_EXCEEDED/);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: p.refund_id } })).status).toBe("FAILED");
  });

  it("rejects, and an approval after rejection is refused", async () => {
    const w = await world();
    const { order } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    const a = action("propose_refund");
    const p = await proposeRefund(w.seller.id, { orderId: order.id, reason: "r", rationale: "r" }, sellerAudit(w.seller.id), a);
    expect((await rejectAction(a.id, w.seller.id)).status).toBe("REJECTED");
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: p.refund_id } })).status).toBe("REJECTED");
    await expect(approveAction(a.id, w.seller.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("hides other sellers' approvals", async () => {
    const w = await world();
    const mallory = await makeSeller();
    const { order } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing);
    const a = action("propose_refund");
    await proposeRefund(w.seller.id, { orderId: order.id, reason: "r", rationale: "r" }, sellerAudit(w.seller.id), a);
    await expect(approveAction(a.id, mallory.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(rejectAction(a.id, mallory.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await prisma.agentAction.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("PENDING_APPROVAL");
  });
});

describe("payout schedules", () => {
  it("checks the balance when proposed", async () => {
    const w = await world();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 }); // 91.00 available
    await expect(
      proposePayoutSchedule(w.seller.id, { currency: "USD", payouts: [{ amount: "95.00", date: "2026-11-10" }], rationale: "r" }, sellerAudit(w.seller.id), action("propose_payout_schedule"), new Date("2026-11-04T10:00:00Z")),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
  });

  it("pays out everything available net of the fee", async () => {
    const w = await world();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 });
    const out = await proposePayoutSchedule(
      w.seller.id, { currency: "USD", payouts: [{ amount: "ALL_AVAILABLE", date: "2026-11-04" }], rationale: "r" }, sellerAudit(w.seller.id), action("propose_payout_schedule"), new Date("2026-11-04T10:00:00Z"),
    );
    const amount = out.payouts[0]!.amount.amount_minor;
    expect(amount + estimatePayoutFee(amount, "USD")).toBeLessThanOrEqual(9100);
    expect(out.available_after.amount_minor).toBeGreaterThanOrEqual(0);
  });

  it("re-checks at approval and schedules delayed jobs keyed by payout id", async () => {
    const w = await world();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 });
    const a = action("propose_payout_schedule");
    const now = new Date();
    const date = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const out = await proposePayoutSchedule(w.seller.id, { currency: "USD", payouts: [{ amount: "50.00", date }], rationale: "batch weekly" }, sellerAudit(w.seller.id), a);
    const d = await approveAction(a.id, w.seller.id);
    expect(d.status).toBe("EXECUTED");
    const payoutId = out.payouts[0]!.payout_id;
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } })).status).toBe("SCHEDULED");
    const [line] = await ledger(w.seller.id);
    expect(line!.reserved).toBe(5000 + estimatePayoutFee(5000, "USD"));

    const q = new Queue(QUEUE_NAMES.payouts, { connection: redisConnection(), prefix: queuePrefix() });
    const job = await q.getJob(payoutId);
    expect(job?.data).toEqual({ payoutId });
    expect(await job?.isDelayed()).toBe(true);
    await job?.remove();
    await q.close();
  });

  it("fails the approval if the balance dropped since the proposal", async () => {
    const w = await world();
    const { order, payment } = await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 });
    const a = action("propose_payout_schedule");
    const out = await proposePayoutSchedule(
      w.seller.id, { currency: "USD", payouts: [{ amount: "80.00", date: new Date().toISOString().slice(0, 10) }], rationale: "r" }, sellerAudit(w.seller.id), a,
    );
    await prisma.refund.create({
      data: { payment_id: payment.id, order_id: order.id, seller_id: w.seller.id, currency: "USD", amount_minor: 5000, reason: "r", status: "COMPLETED", seller_debit_minor: 4750 },
    });
    const d = await approveAction(a.id, w.seller.id);
    expect(d).toMatchObject({ status: "EXECUTION_FAILED", error: expect.stringContaining("available balance") });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: out.payouts[0]!.payout_id } })).status).toBe("CANCELLED");
  });

  it("sends, polls, and records PayPal's actual fee", async () => {
    const w = await world();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 });
    const a = action("propose_payout_schedule");
    const out = await proposePayoutSchedule(w.seller.id, { currency: "USD", payouts: [{ amount: "50.00", date: new Date().toISOString().slice(0, 10) }], rationale: "r" }, sellerAudit(w.seller.id), a);
    await approveAction(a.id, w.seller.id);
    const id = out.payouts[0]!.payout_id;
    const pp = fakePayPal();

    expect(await runPayout(id, pp.api)).toBe("POLL");
    const sent = await prisma.payout.findUniqueOrThrow({ where: { id } });
    expect(sent.status).toBe("PROCESSING");
    expect((pp.calls[0]!.args[1] as { senderBatchId: string }).senderBatchId).toBe(sent.sender_batch_id);
    expect((await ledger(w.seller.id))[0]!.paidOut).toBe(5000 + 100);

    expect(await runPayout(id, pp.api)).toBe("DONE");
    const done = await prisma.payout.findUniqueOrThrow({ where: { id } });
    expect(done).toMatchObject({ status: "SUCCESS", fee_minor: 25, fee_is_estimate: false });
    expect((await ledger(w.seller.id))[0]!.paidOut).toBe(5025);
    expect(await runPayout(id, pp.api)).toBe("DONE");
    expect(pp.count("createPayout")).toBe(1);
  });

  it("marks a payout FAILED on a permanent PayPal error and frees the balance", async () => {
    const w = await world();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 });
    const a = action("propose_payout_schedule");
    const out = await proposePayoutSchedule(w.seller.id, { currency: "USD", payouts: [{ amount: "50.00", date: new Date().toISOString().slice(0, 10) }], rationale: "r" }, sellerAudit(w.seller.id), a);
    await approveAction(a.id, w.seller.id);
    const pp = fakePayPal({
      createPayout: async () => {
        throw new PayPalApiError(422, { name: "RECEIVER_UNREGISTERED" });
      },
    });
    expect(await runPayout(out.payouts[0]!.payout_id, pp.api)).toBe("DONE");
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: out.payouts[0]!.payout_id } })).status).toBe("FAILED");
    expect((await ledger(w.seller.id))[0]!.available).toBe(9100);
  });

  it("lets transient PayPal errors retry", async () => {
    const w = await world();
    await makePaidOrder(w.seller.id, w.buyer.id, w.listing, { paypalFee: 400, platformFee: 500 });
    const a = action("propose_payout_schedule");
    const out = await proposePayoutSchedule(w.seller.id, { currency: "USD", payouts: [{ amount: "10.00", date: new Date().toISOString().slice(0, 10) }], rationale: "r" }, sellerAudit(w.seller.id), a);
    await approveAction(a.id, w.seller.id);
    const pp = fakePayPal({
      createPayout: async () => {
        throw new PayPalApiError(503, {});
      },
    });
    await expect(runPayout(out.payouts[0]!.payout_id, pp.api)).rejects.toBeInstanceOf(PayPalApiError);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: out.payouts[0]!.payout_id } })).status).toBe("PROCESSING");
  });
});
