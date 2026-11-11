import Groq from "groq-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { runDetectors } from "@/server/proactive/detectors";
import { dismissFinding, listFindings, newFindingCounts, reconcileFindings, snoozeFinding } from "@/server/proactive/findings";
import { parseFinding, stripIds } from "@/server/proactive/investigate";
import { proactiveSpec } from "@/server/proactive/specs";
import { MAX_PROACTIVE_RUNS_PER_DAY } from "@/server/proactive/thresholds";
import { runWatch } from "@/server/proactive/watcher";
import { freelancerLedger } from "@/server/services/gig/ledger";
import { makeClient, makeContract, makeFreelancer, resetDb } from "../helpers/db";
import { call, reply, scriptedModel, text } from "../helpers/fake-model";

beforeEach(resetDb);
const DAY = 86_400_000;
const HOUR = 3_600_000;
const model = (m: ReturnType<typeof scriptedModel>["model"]) => ({ model: m, modelId: "openai/gpt-oss-120b", retryDelayMs: 0 });

/** One disputed milestone: exactly one finding (open_dispute). */
async function disputed() {
  const f = await makeFreelancer();
  const c = await makeClient({ name: "Katrin Weber", company_name: "Nordlicht GmbH" });
  const { milestones } = await makeContract(f.id, c.id, [{ amount_minor: 40_000, state: "DISPUTED" }], { title: "Brand identity" });
  return { f, c, milestone: milestones[0]!.milestone };
}

/** A released milestone large enough that one payout reaches the fee cap: exactly one finding (payout_ready). */
async function rich(auto: boolean) {
  const f = await makeFreelancer();
  await prisma.freelancer.update({ where: { id: f.id }, data: { auto_payout_proposals: auto } });
  const c = await makeClient();
  await makeContract(f.id, c.id, [{ amount_minor: 200_000, state: "ACCEPTED" }]);
  return f;
}

describe("detectors", () => {
  it("each Projects rule fires on its own facts", async () => {
    const f = await makeFreelancer();
    const c = await makeClient({ name: "Kenji Watanabe", company_name: "Sakura Robotics K.K." });
    const now = new Date();
    const { milestones } = await makeContract(
      f.id,
      c.id,
      [
        { amount_minor: 10_000, state: "IN_PROGRESS" },
        { amount_minor: 10_000, state: "IN_PROGRESS" },
        { amount_minor: 10_000, state: "DELIVERED" },
        { amount_minor: 10_000, state: "REVISION_REQUESTED" },
        { amount_minor: 10_000, state: "DISPUTED" },
      ],
      { revisions_allowed: 4 },
    );
    const [dueSoon, overdue, delivered, loop, dispute] = milestones.map((m) => m.milestone);
    await prisma.milestone.update({ where: { id: dueSoon!.id }, data: { due_date: new Date(now.getTime() + 20 * HOUR) } });
    await prisma.milestone.update({ where: { id: overdue!.id }, data: { due_date: new Date(now.getTime() - 3 * DAY) } });
    await prisma.milestone.update({ where: { id: delivered!.id }, data: { auto_release_at: new Date(now.getTime() + 30 * HOUR) } });
    await prisma.milestone.update({ where: { id: loop!.id }, data: { revision_count: 3 } });
    await prisma.quote.create({ data: { client_id: c.id, freelancer_id: f.id, locale: "ja-JP", currency: "JPY", status: "REQUESTED", request_message: "Price?", requested_at: new Date(now.getTime() - 30 * HOUR) } });
    await prisma.quote.create({ data: { client_id: c.id, freelancer_id: f.id, locale: "ja-JP", currency: "JPY", status: "REQUESTED", request_message: "Fresh", requested_at: new Date(now.getTime() - 2 * HOUR) } });
    await prisma.agentAction.create({ data: { kind: "TOOL", tool: "propose_refund", input: {}, status: "PENDING_APPROVAL", actor: "FREELANCER", freelancer_id: f.id, created_at: new Date(now.getTime() - 4 * DAY) } });

    const found = await runDetectors(f.id, now);
    const by = (type: string) => found.filter((d) => d.type === type);
    expect(by("milestone_due_soon").map((d) => [d.subject, d.severity]).sort()).toEqual([[dueSoon!.id, "MEDIUM"], [overdue!.id, "HIGH"]].sort());
    expect(by("awaiting_acceptance")).toMatchObject([{ agent: "PROJECTS", subject: delivered!.id, severity: "LOW", evidence: { hours_left: 30, client: "Sakura Robotics K.K." } }]);
    expect(by("revision_loop")).toMatchObject([{ subject: loop!.id, evidence: { revisions: 3 } }]);
    expect(by("open_dispute")).toMatchObject([{ subject: dispute!.id, severity: "HIGH" }]);
    expect(by("quote_requests_unanswered")).toMatchObject([{ subject: "all", evidence: { count: 1 } }]);
    expect(by("approval_aging")).toMatchObject([{ evidence: { count: 1 } }]);

    const clean = await makeFreelancer();
    expect(await runDetectors(clean.id, now)).toEqual([]);
  });

  it("flags a refund-rate spike", async () => {
    const f = await makeFreelancer();
    const c = await makeClient();
    const { milestones } = await makeContract(f.id, c.id, [
      { amount_minor: 5_000, state: "REFUNDED" },
      { amount_minor: 5_000, state: "REFUNDED" },
      { amount_minor: 5_000, state: "ACCEPTED" },
    ]);
    for (const m of milestones.slice(0, 2)) {
      await prisma.milestoneRefund.create({
        data: { payment_id: m.payment!.id, milestone_id: m.milestone.id, contract_id: m.milestone.contract_id, freelancer_id: f.id, currency: "USD", amount_minor: 5_000, reason: "Cancelled", from_holding: true, status: "COMPLETED", freelancer_debit_minor: 0 },
      });
    }
    expect((await runDetectors(f.id, new Date(Date.now() + 60_000))).find((d) => d.type === "refund_rate_spike")).toMatchObject({ agent: "PROJECTS", evidence: { refunds_last_30_days: 2, milestones_funded_last_30_days: 3 } });
  });

  it("flags released money big enough to reach the payout fee cap", async () => {
    const f = await rich(false);
    const found = await runDetectors(f.id);
    expect(found.map((d) => d.type)).toEqual(["payout_ready"]);
    expect(found[0]).toMatchObject({ agent: "TREASURY", subject: "USD" });
  });

  it("never treats money in holding as ready to pay out, and flags a large inflow into holding", async () => {
    const f = await makeFreelancer();
    const c = await makeClient();
    const { milestones } = await makeContract(f.id, c.id, [
      { amount_minor: 10_000, state: "ACCEPTED" },
      { amount_minor: 10_000, state: "ACCEPTED" },
      { amount_minor: 10_000, state: "ACCEPTED" },
      { amount_minor: 500_000, state: "FUNDED" },
    ]);
    for (const m of milestones.slice(0, 3)) await prisma.milestone.update({ where: { id: m.milestone.id }, data: { funded_at: new Date(Date.now() - 30 * DAY) } });
    const found = await runDetectors(f.id);
    expect(found.find((d) => d.type === "payout_ready")).toBeUndefined();
    expect(found.find((d) => d.type === "large_holding_inflow")).toMatchObject({ agent: "TREASURY", subject: "USD", evidence: { funded_this_week: { amount_minor: 500_000 }, milestones: 1 } });
    expect((await freelancerLedger(f.id))[0]!.inHolding).toBe(500_000);
  });
});

describe("findings lifecycle", () => {
  it("creates once, keeps a dismissal while the rule fires, and resolves when it stops", async () => {
    const { f, milestone } = await disputed();
    const det = await runDetectors(f.id);
    const first = await reconcileFindings(f.id, det);
    expect(first.created).toHaveLength(1);
    expect(first.created[0]).toMatchObject({ freelancer_id: f.id, agent: "PROJECTS", fingerprint: `open_dispute:${milestone.id}` });
    expect((await reconcileFindings(f.id, det)).created).toHaveLength(0);
    expect(await prisma.finding.count({ where: { freelancer_id: f.id } })).toBe(1);
    expect(await newFindingCounts(f.id)).toEqual({ TREASURY: 0, PROJECTS: 1 });

    const found = first.created[0]!;
    expect(await dismissFinding(found.id, f.id)).not.toBeNull();
    await reconcileFindings(f.id, det);
    expect(await listFindings(f.id)).toEqual([]);
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: found.id } })).status).toBe("DISMISSED");

    await prisma.milestone.update({ where: { id: milestone.id }, data: { state: "REFUNDED" } });
    const resolved = await reconcileFindings(f.id, await runDetectors(f.id));
    expect(resolved.resolved).toBe(1);
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: found.id } })).status).toBe("RESOLVED");
  });

  it("brings a snoozed finding back once the snooze ends, and scopes by freelancer", async () => {
    const { f } = await disputed();
    const other = await makeFreelancer();
    const det = await runDetectors(f.id);
    const found = (await reconcileFindings(f.id, det)).created[0]!;
    expect(await snoozeFinding(found.id, other.id, 7)).toBeNull();
    expect(await dismissFinding(found.id, other.id)).toBeNull();
    expect(await listFindings(other.id)).toEqual([]);

    await snoozeFinding(found.id, f.id, 7);
    expect((await listFindings(f.id)).some((x) => x.id === found.id)).toBe(false);
    await reconcileFindings(f.id, det, new Date(Date.now() + 8 * DAY));
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: found.id } })).status).toBe("NEW");
  });
});

describe("parseFinding", () => {
  it("splits a headline from the body and rejects unusable replies", () => {
    expect(parseFinding("**A client opened a dispute**\n\nNordlicht disputed the logo milestone. Reply in the thread.")).toEqual({
      title: "A client opened a dispute",
      body: "Nordlicht disputed the logo milestone. Reply in the thread.",
    });
    expect(parseFinding("only one line")).toBeNull();
    expect(parseFinding("")).toBeNull();
  });
});

describe("stripIds", () => {
  it("removes ids the freelancer would never recognise", () => {
    const id = "75e466f5-cce4-427e-bbb7-59196f55bd45";
    expect(stripIds(`A delivery waits (milestone ${id} delivered Monday). Check milestone ${id}.`)).toBe("A delivery waits. Check.");
    const fancy = id.replaceAll("-", "‑");
    expect(stripIds(`Contract ${fancy} is late, see (milestone ${fancy}).`).trim()).toBe("is late, see.");
    expect(parseFinding(`Dispute opened ${id}\n\nSee ${id} for details.`)).toEqual({ title: "Dispute opened", body: "See for details." });
  });
});

describe("watcher", () => {
  it("lets the agent write the finding, in a SYSTEM session the freelancer can continue", async () => {
    const { f } = await disputed();
    const scripted = scriptedModel([
      reply([text("Nordlicht disputed your brand identity milestone\n\nThe money stays in holding until it is resolved. Reply in the project thread and agree on a fix or a partial refund.")]),
    ]);
    const result = await runWatch(f.id, model(scripted.model));
    expect(result).toMatchObject({ created: 1, explained: 1 });
    const finding = await prisma.finding.findFirstOrThrow({ where: { freelancer_id: f.id, type: "open_dispute" } });
    expect(finding.title).toBe("Nordlicht disputed your brand identity milestone");
    const session = await prisma.agentSession.findUniqueOrThrow({ where: { id: finding.session_id! } });
    expect(session).toMatchObject({ actor: "SYSTEM", agent: "PROJECTS", freelancer_id: f.id });
    // The automatic check cannot propose refunds.
    const tools = (scripted.requests[0]!.tools ?? []).map((t) => (t as { function: { name: string } }).function.name);
    expect(tools).not.toContain("propose_refund");
    expect(tools).not.toContain("handoff");

    const before = scripted.requests.length;
    expect((await runWatch(f.id, model(scripted.model))).created).toBe(0);
    expect(scripted.requests.length).toBe(before);
  });

  it("retries once after a rate limit and then writes the finding", async () => {
    const { f } = await disputed();
    const rateLimited = new Groq.RateLimitError(429, { error: { message: "rate" } }, "rate", new Headers());
    const scripted = scriptedModel([rateLimited, reply([text("A client opened a dispute\n\nThe money stays in holding.")])]);
    const result = await runWatch(f.id, model(scripted.model));
    expect(result.explained).toBe(1);
    expect((await prisma.finding.findFirstOrThrow({ where: { freelancer_id: f.id } })).title).toBe("A client opened a dispute");
  });

  it("keeps the rule's own sentence when the model fails (degraded mode)", async () => {
    const { f } = await disputed();
    const result = await runWatch(f.id, model(scriptedModel([new Error("boom"), new Error("boom")]).model));
    expect(result).toMatchObject({ created: 1, explained: 0 });
    const finding = await prisma.finding.findFirstOrThrow({ where: { freelancer_id: f.id } });
    expect(finding).toMatchObject({ status: "NEW", title: "A client opened a dispute" });
    expect(finding.body).toContain("Nordlicht GmbH disputed");
  });

  it("stops spending agent runs after the daily cap", async () => {
    const { f } = await disputed();
    for (let i = 0; i < MAX_PROACTIVE_RUNS_PER_DAY; i++) {
      await prisma.agentSession.create({ data: { agent: "PROJECTS", actor: "SYSTEM", freelancer_id: f.id, locale: f.locale } });
    }
    const scripted = scriptedModel([]);
    const result = await runWatch(f.id, model(scripted.model));
    expect(result).toMatchObject({ created: 1, explained: 0 });
    expect(scripted.requests).toHaveLength(0);
  });

  it("does nothing when switched off", async () => {
    const { f } = await disputed();
    process.env.PROACTIVE_AGENTS = "off";
    try {
      expect(await runWatch(f.id, model(scriptedModel([]).model))).toEqual({ created: 0, refreshed: 0, resolved: 0, explained: 0 });
    } finally {
      delete process.env.PROACTIVE_AGENTS;
    }
  });
});

describe("what the proactive agents may do", () => {
  it("never gives Projects propose_refund, and gives Treasury a payout proposal only on opt-in", () => {
    const names = (a: "TREASURY" | "PROJECTS", auto: boolean) => proactiveSpec(a, { autoPayoutProposals: auto }).tools.map((t) => t.name);
    expect(names("PROJECTS", true)).not.toContain("propose_refund");
    expect(names("PROJECTS", true)).not.toContain("handoff");
    expect(names("TREASURY", false)).not.toContain("propose_payout_schedule");
    expect(names("TREASURY", true)).toContain("propose_payout_schedule");
  });

  it("drafts a payout proposal when opted in, and moves no money", async () => {
    const f = await rich(true);
    const before = (await freelancerLedger(f.id))[0]!;
    const date = new Date().toISOString().slice(0, 10);
    const scripted = scriptedModel([
      reply([call("c1", "propose_payout_schedule", { currency: "USD", payouts: [{ amount: "ALL_AVAILABLE", date }], rationale: "Balance reached the fee cap." })]),
      reply([text("A payout is ready\n\nYour released balance reached the fee cap. A payout waits for your approval; nothing has been sent.")]),
    ]);
    await runWatch(f.id, model(scripted.model));
    const finding = await prisma.finding.findFirstOrThrow({ where: { freelancer_id: f.id, type: "payout_ready" } });
    expect(finding.status).toBe("ACTED");
    const action = await prisma.agentAction.findUniqueOrThrow({ where: { id: finding.action_id! } });
    expect(action.status).toBe("PENDING_APPROVAL");
    expect((await prisma.freelancerPayout.findMany({ where: { freelancer_id: f.id } })).map((p) => p.status)).toEqual(["PROPOSED"]);
    expect((await freelancerLedger(f.id))[0]!.paidOut).toBe(before.paidOut);
  });

  it("only recommends when not opted in", async () => {
    const f = await rich(false);
    const scripted = scriptedModel([reply([text("A payout is worth taking\n\nYour balance reached the fee cap. Consider one payout.")])]);
    await runWatch(f.id, model(scripted.model));
    expect(await prisma.freelancerPayoutSchedule.count({ where: { freelancer_id: f.id } })).toBe(0);
    const toolNames = (scripted.requests[0]!.tools ?? []).map((t) => (t as { function: { name: string } }).function.name);
    expect(toolNames).not.toContain("propose_payout_schedule");
  });
});
