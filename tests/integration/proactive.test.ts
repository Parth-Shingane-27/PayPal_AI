import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { runDetectors } from "@/server/proactive/detectors";
import { dismissFinding, listFindings, reconcileFindings, snoozeFinding } from "@/server/proactive/findings";
import Groq from "groq-sdk";
import { parseFinding, stripIds } from "@/server/proactive/investigate";
import { proactiveSpec } from "@/server/proactive/specs";
import { MAX_PROACTIVE_RUNS_PER_DAY } from "@/server/proactive/thresholds";
import { runWatch } from "@/server/proactive/watcher";
import { ledger } from "@/server/services/ledger";
import { makeBuyer, makeListing, makePaidOrder, makeProduct, makeSeller, resetDb } from "../helpers/db";
import { call, reply, scriptedModel, text } from "../helpers/fake-model";

beforeEach(resetDb);
const DAY = 86_400_000;
const model = (m: ReturnType<typeof scriptedModel>["model"]) => ({ model: m, modelId: "openai/gpt-oss-120b", retryDelayMs: 0 });

/** Three German orders this week, two of them refunded: a refund-rate spike. */
async function germanRefundSpike() {
  const seller = await makeSeller();
  const buyer = await makeBuyer({ locale: "de-DE", country: "DE" });
  const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { locale: "de-DE", price_minor: 5000 });
  const at = new Date(Date.now() - 2 * DAY);
  const orders = [];
  for (let i = 0; i < 3; i++) orders.push(await makePaidOrder(seller.id, buyer.id, l, { capturedAt: at }));
  for (const o of orders.slice(0, 2)) {
    await prisma.refund.create({
      data: { payment_id: o.payment.id, order_id: o.order.id, seller_id: seller.id, currency: "EUR", amount_minor: 5000, reason: "damaged", status: "COMPLETED", seller_debit_minor: 4500, created_at: at },
    });
  }
  return { seller, orders };
}

describe("detectors", () => {
  it("flags a refund-rate spike in one market and stays quiet on a clean seller", async () => {
    const { seller } = await germanRefundSpike();
    const found = await runDetectors(seller.id);
    expect(found.filter((d) => d.type === "refund_rate_spike")).toMatchObject([{ agent: "OPERATIONS", subject: "de-DE", evidence: { refunds_this_week: 2, orders_this_week: 3 } }]);

    const clean = await makeSeller();
    expect(await runDetectors(clean.id)).toEqual([]);
  });

  it("flags a balance big enough to reach the payout fee cap", async () => {
    const seller = await makeSeller();
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { price_minor: 200_000 });
    await makePaidOrder(seller.id, buyer.id, l, { capturedAt: new Date() });
    const found = await runDetectors(seller.id);
    expect(found.find((d) => d.type === "payout_ready")).toMatchObject({ agent: "TREASURY", subject: "USD" });
  });
});

describe("findings lifecycle", () => {
  it("creates once, keeps a dismissal while the rule fires, and resolves when it stops", async () => {
    const { seller, orders } = await germanRefundSpike();
    const det = await runDetectors(seller.id);

    const first = await reconcileFindings(seller.id, det);
    expect(first.created.length).toBeGreaterThan(0);
    const again = await reconcileFindings(seller.id, det);
    expect(again.created).toHaveLength(0);
    expect(await prisma.finding.count({ where: { seller_id: seller.id, fingerprint: "refund_rate_spike:de-DE" } })).toBe(1);

    const f = first.created.find((x) => x.type === "refund_rate_spike")!;
    expect(await dismissFinding(f.id, seller.id)).not.toBeNull();
    await reconcileFindings(seller.id, det);
    expect((await listFindings(seller.id)).find((x) => x.id === f.id)).toBeUndefined();
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("DISMISSED");

    await prisma.refund.deleteMany({ where: { order_id: { in: orders.map((o) => o.order.id) } } });
    const resolved = await reconcileFindings(seller.id, await runDetectors(seller.id));
    expect(resolved.resolved).toBeGreaterThan(0);
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("RESOLVED");
  });

  it("brings a snoozed finding back once the snooze ends, and scopes by seller", async () => {
    const { seller } = await germanRefundSpike();
    const other = await makeSeller();
    const det = await runDetectors(seller.id);
    const f = (await reconcileFindings(seller.id, det)).created[0]!;

    expect(await snoozeFinding(f.id, other.id, 7)).toBeNull();
    expect(await dismissFinding(f.id, other.id)).toBeNull();

    await snoozeFinding(f.id, seller.id, 7);
    expect((await listFindings(seller.id)).some((x) => x.id === f.id)).toBe(false);
    const later = new Date(Date.now() + 8 * DAY);
    await reconcileFindings(seller.id, det, later);
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("NEW");
  });
});

describe("parseFinding", () => {
  it("splits a headline from the body and rejects unusable replies", () => {
    expect(parseFinding("**Refunds are up in Germany**\n\nTwo of three orders were refunded. Check the product.")).toEqual({
      title: "Refunds are up in Germany",
      body: "Two of three orders were refunded. Check the product.",
    });
    expect(parseFinding("only one line")).toBeNull();
    expect(parseFinding("")).toBeNull();
  });
});

describe("stripIds", () => {
  it("removes ids the seller would never recognise", () => {
    const id = "75e466f5-cce4-427e-bbb7-59196f55bd45";
    expect(stripIds(`Nine payments failed (order ${id} shows three attempts). Check order ${id}.`)).toBe("Nine payments failed. Check.");
    const fancy = id.replaceAll("-", "\u2011");
    expect(stripIds(`Order ${fancy} failed, see (listing ${fancy}).`).trim()).toBe("failed, see.");
    expect(parseFinding(`Orders failed ${id}\n\nSee ${id} for details.`)).toEqual({ title: "Orders failed", body: "See for details." });
  });
});

describe("watcher", () => {
  it("retries once after a rate limit and then writes the finding", async () => {
    const { seller } = await germanRefundSpike();
    const rateLimited = new Groq.RateLimitError(429, { error: { message: "rate" } }, "rate", new Headers());
    const good = reply([text("Refunds are up in Germany\n\nTwo of three German orders were refunded this week.")]);
    // each finding: one rate limit, then a good reply
    const scripted = scriptedModel(Array.from({ length: 6 }, (_, i) => (i % 2 === 0 ? rateLimited : good)));
    const result = await runWatch(seller.id, model(scripted.model));
    expect(result.explained).toBe(result.created);
    expect((await prisma.finding.findFirstOrThrow({ where: { seller_id: seller.id, type: "refund_rate_spike" } })).title).toBe("Refunds are up in Germany");
  });

  it("lets the agent write the finding, in a SYSTEM session that the seller can continue", async () => {
    const { seller } = await germanRefundSpike();
    // more than one rule may fire; give every run the same reply
    const steps = Array.from({ length: 6 }, () => reply([text("Refunds are up in Germany\n\nTwo of three German orders were refunded this week. Open the orders to see why.")]));
    const scripted = scriptedModel(steps);
    const result = await runWatch(seller.id, model(scripted.model));
    expect(result.created).toBeGreaterThan(0);
    expect(result.explained).toBe(result.created);

    const f = await prisma.finding.findFirstOrThrow({ where: { seller_id: seller.id, type: "refund_rate_spike" } });
    expect(f.title).toBe("Refunds are up in Germany");
    expect(f.session_id).not.toBeNull();
    const session = await prisma.agentSession.findUniqueOrThrow({ where: { id: f.session_id! } });
    expect(session).toMatchObject({ actor: "SYSTEM", agent: "OPERATIONS", seller_id: seller.id });

    // Re-running creates nothing new and spends no further agent runs.
    const before = scripted.requests.length;
    expect((await runWatch(seller.id, model(scripted.model))).created).toBe(0);
    expect(scripted.requests.length).toBe(before);
  });

  it("keeps the rule's own sentence when the model fails", async () => {
    const { seller } = await germanRefundSpike();
    const steps = Array.from({ length: 6 }, () => new Error("boom"));
    const result = await runWatch(seller.id, model(scriptedModel(steps).model));
    expect(result.explained).toBe(0);
    const f = await prisma.finding.findFirstOrThrow({ where: { seller_id: seller.id, type: "refund_rate_spike" } });
    expect(f.status).toBe("NEW");
    expect(f.body).toContain("Refunds in de-DE");
  });

  it("stops spending agent runs after the daily cap", async () => {
    const { seller } = await germanRefundSpike();
    for (let i = 0; i < MAX_PROACTIVE_RUNS_PER_DAY; i++) {
      await prisma.agentSession.create({ data: { agent: "OPERATIONS", actor: "SYSTEM", seller_id: seller.id, locale: seller.locale } });
    }
    const scripted = scriptedModel([]);
    const result = await runWatch(seller.id, model(scripted.model));
    expect(result.created).toBeGreaterThan(0);
    expect(result.explained).toBe(0);
    expect(scripted.requests).toHaveLength(0);
  });

  it("does nothing when switched off", async () => {
    const { seller } = await germanRefundSpike();
    process.env.PROACTIVE_AGENTS = "off";
    try {
      expect(await runWatch(seller.id, model(scriptedModel([]).model))).toEqual({ created: 0, refreshed: 0, resolved: 0, explained: 0 });
    } finally {
      delete process.env.PROACTIVE_AGENTS;
    }
  });
});

describe("what the proactive agents may do", () => {
  it("never gives Operations propose_refund, and gives Treasury a payout proposal only on opt-in", () => {
    const names = (a: "TREASURY" | "OPERATIONS", auto: boolean) => proactiveSpec(a, { autoPayoutProposals: auto }).tools.map((t) => t.name);
    expect(names("OPERATIONS", true)).not.toContain("propose_refund");
    expect(names("OPERATIONS", true)).not.toContain("handoff");
    expect(names("TREASURY", false)).not.toContain("propose_payout_schedule");
    expect(names("TREASURY", true)).toContain("propose_payout_schedule");
  });

  async function richSeller(auto: boolean) {
    const seller = await makeSeller();
    await prisma.seller.update({ where: { id: seller.id }, data: { auto_payout_proposals: auto } });
    const buyer = await makeBuyer();
    const l = await makeListing(seller.id, (await makeProduct(seller.id)).id, { price_minor: 200_000 });
    await makePaidOrder(seller.id, buyer.id, l, { capturedAt: new Date() });
    return seller;
  }

  it("drafts a payout proposal when opted in, and moves no money", async () => {
    const seller = await richSeller(true);
    const before = (await ledger(seller.id))[0]!;
    const date = new Date().toISOString().slice(0, 10);
    const scripted = scriptedModel([
      reply([call("c1", "propose_payout_schedule", { currency: "USD", payouts: [{ amount: "ALL_AVAILABLE", date }], rationale: "Balance reached the fee cap." })]),
      reply([text("A payout is ready\n\nYour balance reached the point where the payout fee is capped. A payout is waiting for your approval; nothing has been sent.")]),
      reply([text("Currency note\n\nNothing else.")]),
    ]);
    await runWatch(seller.id, model(scripted.model));

    const f = await prisma.finding.findFirstOrThrow({ where: { seller_id: seller.id, type: "payout_ready" } });
    expect(f.status).toBe("ACTED");
    expect(f.action_id).not.toBeNull();
    const action = await prisma.agentAction.findUniqueOrThrow({ where: { id: f.action_id! } });
    expect(action.status).toBe("PENDING_APPROVAL");
    expect((await prisma.payout.findMany({ where: { seller_id: seller.id } })).map((p) => p.status)).toEqual(["PROPOSED"]);
    const after = (await ledger(seller.id))[0]!;
    expect(after.paidOut).toBe(before.paidOut);
  });

  it("only recommends when not opted in", async () => {
    const seller = await richSeller(false);
    const scripted = scriptedModel([reply([text("A payout is worth taking\n\nYour balance reached the fee cap. Consider one payout.")])]);
    await runWatch(seller.id, model(scripted.model));
    expect(await prisma.payoutSchedule.count({ where: { seller_id: seller.id } })).toBe(0);
    const toolNames = (scripted.requests[0]!.tools ?? []).map((t) => (t as { function: { name: string } }).function.name);
    expect(toolNames).not.toContain("propose_payout_schedule");
  });
});
