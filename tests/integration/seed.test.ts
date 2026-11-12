import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { MILESTONE_STATES, isInHolding, transition } from "@/server/domain/milestones";
import { freelancerLedger } from "@/server/services/gig/ledger";
import { runSeed } from "../../prisma/seed";

/**
 * The demo seed must obey the same money rules as the services: every
 * milestone history replays through the state machine, plans add up, every
 * release has a net and an invoice, invoice numbers have no gaps, and no
 * balance goes negative.
 */
describe("db:seed", () => {
  it("writes ~120 contracts and ~300 milestones in every state, all consistent", { timeout: 120_000 }, async () => {
    const r = await runSeed({ log: false });
    expect(r).toMatchObject({ freelancers: 10, clients: 10 });
    expect(r.contracts).toBe(120);
    expect(r.milestones).toBeGreaterThanOrEqual(270);
    expect(r.milestones).toBeLessThanOrEqual(420);
    for (const s of MILESTONE_STATES) expect(r.states[s], s).toBeGreaterThan(0);
    expect(r.invoices).toBe(r.states.ACCEPTED);

    const problems: string[] = [];
    const now = new Date();
    const ms = await prisma.milestone.findMany({
      include: { events: { orderBy: [{ created_at: "asc" }, { id: "asc" }] }, payments: true, invoice: true },
    });
    for (const m of ms) {
      let state: (typeof m)["state"] = "AWAITING_FUNDING";
      for (const e of m.events) {
        const t = transition(state, e.event as never, { actor: e.actor as never, now: e.created_at, autoReleaseAt: new Date(0), revisionCount: 0, revisionsAllowed: 99 });
        if (!t.ok || t.to !== e.to_state || e.from_state !== state) problems.push(`${m.id}: ${state} ${e.event} by ${e.actor}`);
        state = e.to_state;
      }
      if (state !== m.state) problems.push(`${m.id}: history ends in ${state}, row says ${m.state}`);
      const paid = m.payments.find((p) => p.status === "COMPLETED");
      if ((isInHolding(m.state) || m.state === "ACCEPTED" || m.state === "REFUNDED") && !paid) problems.push(`${m.id}: ${m.state} without a captured payment`);
      if (m.state === "ACCEPTED" && (!paid?.released_at || paid.net_to_freelancer_minor === null || !m.invoice)) problems.push(`${m.id}: released without net or invoice`);
      if (m.state === "DELIVERED" && !(m.auto_release_at && m.auto_release_at > now)) problems.push(`${m.id}: delivered without a future auto-release`);
      if (m.state !== "DELIVERED" && m.auto_release_at) problems.push(`${m.id}: ${m.state} with an auto-release date`);
    }
    for (const c of await prisma.contract.findMany({ include: { milestones: true } })) {
      if (c.milestones.reduce((s, m) => s + m.amount_minor, 0) !== c.total_minor) problems.push(`${c.id}: milestones do not add up`);
    }
    for (const f of await prisma.freelancer.findMany({ include: { invoices: { orderBy: { seq: "asc" } } } })) {
      f.invoices.forEach((inv, i) => inv.seq !== i + 1 && problems.push(`${f.name}: invoice gap at ${inv.seq}`));
      if (f.invoice_seq !== f.invoices.length) problems.push(`${f.name}: invoice_seq out of step`);
      for (const l of await freelancerLedger(f.id)) if (l.available < 0 || l.inHolding < 0) problems.push(`${f.name} ${l.currency}: negative balance`);
    }
    expect(problems).toEqual([]);

    // Demo fixtures the agents and detectors rely on.
    // The project board: open projects with proposals waiting, plus drafts the client has not posted.
    expect(await prisma.brief.count({ where: { status: "OPEN" } })).toBeGreaterThanOrEqual(5);
    expect(await prisma.brief.count({ where: { status: "DRAFT" } })).toBeGreaterThan(0);
    expect(await prisma.quote.count({ where: { status: "SENT", brief: { status: "OPEN" } } })).toBeGreaterThan(0);
    // A project closes when its proposal is accepted, and every contract comes from an accepted or sent proposal.
    expect(await prisma.contract.count({ where: { quote_id: null } })).toBe(0);
    expect(await prisma.milestone.count({ where: { state: "DELIVERED", auto_release_at: { lt: new Date(Date.now() + 24 * 3_600_000) } } })).toBeGreaterThan(0);
    expect(await prisma.milestone.count({ where: { revision_count: { gte: 3 } } })).toBeGreaterThan(0);
    expect(await prisma.agentAction.count({ where: { status: "PENDING_APPROVAL", milestone_refund_id: { not: null } } })).toBe(1);
    expect(await prisma.threadMessage.count({ where: { translation: { not: null } } })).toBeGreaterThan(50);
    expect(await prisma.freelancerPayout.count({ where: { status: "SUCCESS" } })).toBeGreaterThan(0);
  });
});
