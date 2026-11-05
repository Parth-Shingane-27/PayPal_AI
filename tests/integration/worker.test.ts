import { randomUUID } from "node:crypto";
import { DelayedError, type Job, Queue } from "bullmq";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { closeQueues, type PayoutJob, QUEUE_NAMES, queuePrefix, redisConnection, schedulePayoutJob } from "@/server/queue";
import { paypal } from "@/server/services/audit";
import { storeWebhookEvent } from "@/server/services/webhooks";
import { payoutProcessor, reconcilePayouts, startWorkers, webhookProcessor } from "../../worker/jobs";
import { buildServer } from "../../worker/server";
import { makeBuyer, makeListing, makePaidOrder, makeProduct, makeSeller, resetDb } from "../helpers/db";

const queues: Queue[] = [];
function queue(name: string) {
  const q = new Queue(name, { connection: redisConnection(), prefix: queuePrefix() });
  queues.push(q);
  return q;
}

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
  for (const name of Object.values(QUEUE_NAMES)) await queue(name).obliterate({ force: true });
});
afterAll(async () => {
  await Promise.all(queues.map((q) => q.close()));
  await closeQueues();
});

const headers = {
  "content-type": "application/json",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
  "paypal-transmission-id": "t-1",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-11-05T00:00:00Z",
};
const event = { id: "WH-EVT-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource_type: "capture", resource: { id: "CAP-X" } };

describe("webhook route", () => {
  it("verifies the raw event, stores it, queues it and answers 200", async () => {
    const deps = { verify: vi.fn(async () => true), store: vi.fn(async () => true), enqueue: vi.fn(async () => {}) };
    const app = buildServer(deps);
    const res = await app.inject({ method: "POST", url: "/webhooks/paypal", headers, payload: JSON.stringify(event) });
    expect(res.statusCode).toBe(200);
    expect(deps.verify).toHaveBeenCalledWith(
      { authAlgo: "SHA256withRSA", certUrl: headers["paypal-cert-url"], transmissionId: "t-1", transmissionSig: "sig", transmissionTime: headers["paypal-transmission-time"] },
      event,
    );
    expect(deps.store).toHaveBeenCalledWith(expect.objectContaining({ id: "WH-EVT-1" }));
    expect(deps.enqueue).toHaveBeenCalledWith("WH-EVT-1");
    await app.close();
  });

  it("rejects bad signatures and missing headers without storing", async () => {
    const deps = { verify: vi.fn(async () => false), store: vi.fn(async () => true), enqueue: vi.fn(async () => {}) };
    const app = buildServer(deps);
    expect((await app.inject({ method: "POST", url: "/webhooks/paypal", headers, payload: JSON.stringify(event) })).statusCode).toBe(400);
    const { "paypal-transmission-sig": _sig, ...partial } = headers;
    expect((await app.inject({ method: "POST", url: "/webhooks/paypal", headers: partial, payload: JSON.stringify(event) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/webhooks/paypal", headers, payload: "{not json" })).statusCode).toBe(400);
    expect(deps.store).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 500 when PayPal verification is unreachable, so PayPal redelivers", async () => {
    const app = buildServer({ verify: async () => { throw new Error("network down"); }, store: vi.fn(), enqueue: vi.fn() });
    expect((await app.inject({ method: "POST", url: "/webhooks/paypal", headers, payload: JSON.stringify(event) })).statusCode).toBe(500);
    await app.close();
  });

  it("stores a redelivered event once and queues it once", async () => {
    vi.spyOn(paypal, "verifyWebhookSignature").mockResolvedValue(true);
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "WH-ID");
    const app = buildServer();
    const first = await app.inject({ method: "POST", url: "/webhooks/paypal", headers, payload: JSON.stringify(event) });
    const again = await app.inject({ method: "POST", url: "/webhooks/paypal", headers, payload: JSON.stringify(event) });
    expect(first.json()).toEqual({ ok: true, duplicate: false });
    expect(again.json()).toEqual({ ok: true, duplicate: true });
    expect(await prisma.webhookEvent.count()).toBe(1);
    expect(await queue(QUEUE_NAMES.webhooks).getJobCounts("wait", "waiting", "delayed", "active")).toMatchObject({ wait: 1 });
    vi.unstubAllEnvs();
    await app.close();
  });
});

describe("jobs", () => {
  it("processes a stored webhook event", async () => {
    await storeWebhookEvent({ id: "WH-IGN", event_type: "BILLING.SUBSCRIPTION.CREATED", resource: {} });
    expect(await webhookProcessor({ data: { eventId: "WH-IGN" } } as Job)).toMatchObject({ status: "IGNORED" });
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: "WH-IGN" } })).status).toBe("IGNORED");
  });

  async function scheduledPayout() {
    const seller = await makeSeller();
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { price_minor: 10000 });
    await makePaidOrder(seller.id, buyer.id, l, { paypalFee: 400, platformFee: 500 });
    const schedule = await prisma.payoutSchedule.create({ data: { seller_id: seller.id, currency: "USD", status: "APPROVED" } });
    return prisma.payout.create({
      data: { schedule_id: schedule.id, seller_id: seller.id, currency: "USD", amount_minor: 5000, fee_minor: 100, receiver_email: "s@x.test", scheduled_for: new Date(), status: "SCHEDULED", sender_batch_id: `gc-payout-${randomUUID()}` },
    });
  }

  it("sends a payout, re-delays the same job while PayPal processes, then finishes", async () => {
    const payout = await scheduledPayout();
    const create = vi.spyOn(paypal, "createPayout").mockResolvedValue({ batchId: "B-1", status: "PENDING", feeMinor: null });
    vi.spyOn(paypal, "getPayoutBatch").mockResolvedValue({ batchId: "B-1", status: "SUCCESS", feeMinor: 30, itemStatus: "SUCCESS" });
    const moveToDelayed = vi.fn(async () => {});
    const job = { id: payout.id, data: { payoutId: payout.id }, moveToDelayed } as unknown as Job<PayoutJob>;

    await expect(payoutProcessor(job, "tok")).rejects.toBeInstanceOf(DelayedError);
    expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "tok");
    expect(create.mock.calls[0]![1]).toMatchObject({ senderBatchId: payout.sender_batch_id });
    expect(await payoutProcessor(job, "tok")).toBe("DONE");
    expect(await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({ status: "SUCCESS", fee_minor: 30, paypal_batch_id: "B-1" });
  });

  it("reconciles a SCHEDULED payout that has no job", async () => {
    const payout = await scheduledPayout();
    const q = queue(QUEUE_NAMES.payouts);
    expect(await q.getJob(payout.id)).toBeUndefined();
    expect(await reconcilePayouts(q)).toBe(1);
    expect((await q.getJob(payout.id))?.data).toEqual({ payoutId: payout.id });
    expect(await reconcilePayouts(q)).toBe(0);
  });

  it("runs real BullMQ workers end to end", async () => {
    const payout = await scheduledPayout();
    vi.spyOn(paypal, "createPayout").mockResolvedValue({ batchId: "B-E2E", status: "SUCCESS", feeMinor: 20, itemStatus: "SUCCESS" });
    const stop = startWorkers();
    await schedulePayoutJob(payout.id, new Date());
    const deadline = Date.now() + 10_000;
    let status = "SCHEDULED";
    while (Date.now() < deadline && status !== "SUCCESS") {
      await new Promise((r) => setTimeout(r, 100));
      status = (await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status;
    }
    await stop();
    expect(status).toBe("SUCCESS");
  });
});
