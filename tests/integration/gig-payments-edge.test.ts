import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PayPalApiError, PayPalClient } from "@/server/clients/paypal";
import { prisma } from "@/server/db";
import { closeQueues } from "@/server/queue";
import { recordPayPalCall } from "@/server/services/audit";
import { approveFreelancerAction } from "@/server/services/gig/approvals";
import { freelancerLedger } from "@/server/services/gig/ledger";
import { proposeFreelancerPayoutSchedule, runFreelancerPayout } from "@/server/services/gig/payouts";
import { processWebhookEvent, storeWebhookEvent } from "@/server/services/webhooks";
import { freelancerAudit, makeClient, makeContract, makeFreelancer, resetDb } from "../helpers/db";
import { fakePayPal } from "../helpers/fakes";

beforeEach(resetDb);
afterAll(closeQueues);

const action = (tool: string, input: unknown = {}) => ({ id: randomUUID(), tool, input });
const today = () => new Date().toISOString().slice(0, 10);

/** A freelancer with 100.00 EUR already released (accepted) and nothing paid out. */
async function withReleasedMoney() {
  const f = await makeFreelancer({ currency: "EUR", country: "DE", locale: "de-DE" });
  const c = await makeClient();
  await makeContract(f.id, c.id, [{ amount_minor: 10_000, state: "ACCEPTED" }], { currency: "EUR" });
  const available = (await freelancerLedger(f.id))[0]!.available;
  return { f, available };
}

async function approvedPayout(freelancerId: string, amount: string) {
  const a = action("propose_payout_schedule");
  const out = await proposeFreelancerPayoutSchedule(freelancerId, { currency: "EUR", payouts: [{ amount, date: today() }], rationale: "r" }, freelancerAudit(freelancerId), a);
  await approveFreelancerAction(a.id, freelancerId);
  return out.payouts[0]!.payout_id;
}

describe("payout failures", () => {
  it("marks a payout FAILED on a permanent PayPal error and frees the balance", async () => {
    const { f, available } = await withReleasedMoney();
    const id = await approvedPayout(f.id, "50.00");
    expect((await freelancerLedger(f.id))[0]!.available).toBeLessThan(available);
    const pp = fakePayPal({
      createPayout: async () => {
        throw new PayPalApiError(422, { name: "RECEIVER_UNREGISTERED" });
      },
    });
    expect(await runFreelancerPayout(id, pp.api)).toBe("DONE");
    expect((await prisma.freelancerPayout.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
    expect((await freelancerLedger(f.id))[0]).toMatchObject({ available, reserved: 0, paidOut: 0 });
  });

  it("lets transient PayPal errors retry without freeing the balance", async () => {
    const { f, available } = await withReleasedMoney();
    const id = await approvedPayout(f.id, "10.00");
    const pp = fakePayPal({
      createPayout: async () => {
        throw new PayPalApiError(503, {});
      },
    });
    await expect(runFreelancerPayout(id, pp.api)).rejects.toBeInstanceOf(PayPalApiError);
    expect((await prisma.freelancerPayout.findUniqueOrThrow({ where: { id } })).status).not.toBe("FAILED");
    const line = (await freelancerLedger(f.id))[0]!;
    expect(line.reserved + line.paidOut).toBeGreaterThan(0);
    expect(line.available).toBeLessThan(available);
  });

  it("sends the batch once even if the job runs again", async () => {
    const { f } = await withReleasedMoney();
    const id = await approvedPayout(f.id, "20.00");
    const pp = fakePayPal();
    expect(await runFreelancerPayout(id, pp.api)).toBe("POLL");
    expect(await runFreelancerPayout(id, pp.api)).toBe("DONE");
    expect(await runFreelancerPayout(id, pp.api)).toBe("DONE");
    expect(pp.count("createPayout")).toBe(1);
  });
});

describe("webhook delivery", () => {
  it("stores each event once, processes it once, and ignores types and captures it does not know", async () => {
    const unknownCapture = {
      id: "WH-CAP",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAP-NOBODY", status: "COMPLETED", amount: { currency_code: "EUR", value: "1.00" } },
    };
    expect(await storeWebhookEvent(unknownCapture)).toBe(true);
    expect(await storeWebhookEvent(unknownCapture)).toBe(false);
    expect(await processWebhookEvent("WH-CAP")).toMatchObject({ status: "IGNORED" });
    expect(await processWebhookEvent("WH-CAP")).toEqual({ status: "SKIPPED" });

    await storeWebhookEvent({ id: "WH-X", event_type: "CHECKOUT.ORDER.APPROVED", resource: {} });
    expect(await processWebhookEvent("WH-X")).toMatchObject({ status: "IGNORED", note: expect.stringContaining("Unhandled") });
  });

  it("records a failure for a retry and rethrows", async () => {
    await storeWebhookEvent({ id: "WH-BAD", event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { nonsense: true } });
    await expect(processWebhookEvent("WH-BAD")).rejects.toThrow();
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: "WH-BAD" } })).status).toBe("FAILED");
  });
});

describe("audit", () => {
  it("writes an agent_actions row for every PayPal call, owned by the freelancer", async () => {
    const f = await makeFreelancer();
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/token")
        ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }))
        : new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND" }), { status: 404 }),
    );
    const client = new PayPalClient({
      fetch: fetch as unknown as typeof globalThis.fetch,
      record: recordPayPalCall,
      config: () => ({ PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b", PAYPAL_BRAND_NAME: "GG", baseUrl: "https://x.test" }),
    });
    await expect(client.getOrder({ actor: "FREELANCER", actorId: f.id, freelancerId: f.id }, "NOPE")).rejects.toThrow();
    const rows = await prisma.agentAction.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "PAYPAL", tool: "paypal.orders.get", status: "FAILED", freelancer_id: f.id });
    expect(rows[0]!.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
