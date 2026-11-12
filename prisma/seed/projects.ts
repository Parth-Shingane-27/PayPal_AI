import { randomUUID } from "node:crypto";
import type { MilestoneState, Prisma, ReleaseKind } from "../../src/generated/prisma/client";
import { prisma } from "../../src/server/db";
import { netOnRelease, refundSplit } from "../../src/server/domain/balances";
import { estimatePayoutFee, estimateSaleFees } from "../../src/server/domain/fees";
import { invoiceLines, invoiceNumber } from "../../src/server/domain/invoices";
import { getMarket } from "../../src/server/domain/markets";
import { splitByWeights } from "../../src/server/domain/milestones";
import { applyBps } from "../../src/server/domain/money";
import { roundUpToPricePoint } from "../../src/server/domain/markets";
import { convertAtReference } from "../../src/server/domain/reference-rates";
import { langOf, type SeedClientSpec, type SeedFreelancerSpec } from "./people";
import type { Rng } from "./prng";
import { BRIEFS, fill, type Scenario, SCRIPTS, SUBJECTS } from "./scripts";

/**
 * Six months of freelance work: projects clients posted, the proposals
 * freelancers sent, ~120 contracts and ~300 milestones, simulated along a
 * timeline. Each milestone walks
 * fund -> start -> deliver -> (revision) -> accept / auto-release / dispute,
 * and every step dated after "now" is simply not taken, so the data covers
 * every state with consistent dates, money, history and invoices.
 *
 * Money follows the real rules: fees are estimates at capture, net is
 * recorded at release, refunds from holding cost the freelancer nothing,
 * payouts never exceed the released balance. Captures are "SEED-" ids
 * (not refundable through PayPal).
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const HISTORY_DAYS = 182;
export const AUTO_RELEASE_DAYS = 7;
const CONTRACTS = 102; // plus the "current work" contracts below: 120 in all

/** Which project categories each freelancer answers (matches their skills). */
const CATEGORIES_OF: Record<string, string[]> = {
  priya: ["Design"],
  camille: ["Design"],
  jonas: ["Translation"],
  sofia: ["Translation"],
  lucas: ["Development"],
  maria: ["Video"],
  emily: ["Writing"],
  haruka: ["3D"],
  giulia: ["Illustration"],
  oliver: ["Data"],
};
/** Skills a project of each category asks for (they match freelancers' skills on the project board). */
const CATEGORY_SKILLS: Record<string, string[]> = {
  Design: ["logo design", "brand identity", "ux design"],
  Translation: ["translation", "localization"],
  Development: ["react", "typescript"],
  Video: ["video editing"],
  Writing: ["copywriting", "seo"],
  "3D": ["3d modeling", "blender"],
  Illustration: ["illustration"],
  Data: ["python", "sql"],
};
/** Estimated hours of work for a project, by category. */
const HOURS: [number, number] = [8, 50];
const PROPOSAL_MARKUP = 1.35;

export type SeedFreelancer = SeedFreelancerSpec & { id: string; invoice_prefix: string; paypal_email: string };
export type SeedClient = SeedClientSpec & { id: string };

type Ev = { at: number; event: string; from: MilestoneState; to: MilestoneState; actor: "CLIENT" | "FREELANCER" | "SYSTEM"; note?: string };

type SimMilestone = {
  id: string;
  position: number;
  title: string;
  amount: number;
  due: number;
  state: MilestoneState;
  revision_count: number;
  funded_at?: number;
  started_at?: number;
  delivered_at?: number;
  auto_release_at?: number;
  released_at?: number;
  release_kind?: ReleaseKind;
  disputed_at?: number;
  dispute_reason?: string;
  events: Ev[];
  payment?: { id: string; gross: number; paypalFee: number; platformFee: number; fx: number; capturedAt: number; declinedBefore: boolean };
  refunds: { id: string; amount: number; fromHolding: boolean; at: number; reason: string; status: "COMPLETED" | "PROPOSED" }[];
};

const DISPUTE_REASONS = [
  "The delivery does not match the agreed scope.",
  "Only part of the work was delivered before the deadline.",
  "The files delivered are not the formats we agreed on.",
];
const REFUND_REASONS = [
  "Partial delivery agreed after the dispute.",
  "Project cancelled by mutual agreement.",
  "Goodwill refund for a late delivery.",
];
const MILESTONE_TITLES: Record<number, string[]> = {
  1: ["Complete delivery"],
  2: ["First draft", "Final delivery"],
  3: ["Discovery and concepts", "First draft", "Final files"],
  4: ["Discovery", "First draft", "Revisions", "Final handover"],
};
const WEIGHTS: Record<number, number[]> = { 1: [10_000], 2: [4_000, 6_000], 3: [3_000, 3_000, 4_000], 4: [2_500, 2_500, 2_500, 2_500] };

export async function seedProjects(opts: { rng: Rng; now: number; freelancers: SeedFreelancer[]; clients: SeedClient[]; platformBps: number }) {
  const { rng, now, freelancers, clients, platformBps } = opts;
  const fById = new Map(freelancers.map((f) => [f.id, f]));
  const first = (name: string) => name.split(" ")[0]!;
  const d = (t: number) => new Date(t);
  const answering = (category: string) => freelancers.filter((f) => CATEGORIES_OF[f.slug]?.includes(category));
  /** A proposal price in the project's currency: hours x the freelancer's floor, converted, with a margin. */
  const priceFor = (f: SeedFreelancer, currency: string, rounding: ReturnType<typeof getMarket>["rounding"], hours: number) =>
    roundUpToPricePoint(Math.round(convertAtReference(hours * f.hourly_floor_minor, f.currency, currency) * PROPOSAL_MARKUP), rounding, currency);

  // --- Briefs ---------------------------------------------------------------
  const briefRows: Prisma.BriefCreateManyInput[] = [];
  const briefsByClient = new Map<string, { id: string; category: string; at: number }[]>();
  const categories = Object.keys(BRIEFS);
  for (const c of clients) {
    const n = rng.int(1, 4);
    for (let i = 0; i < n; i++) {
      const category = rng.pick(categories);
      const at = now - rng.int(1, HISTORY_DAYS - 10) * DAY;
      const text = BRIEFS[category]![langOf(c.locale)];
      const currency = getMarket(c.locale).currency;
      const budgetUsd = rng.pick([500, 800, 1200, 2000, 3500]);
      const id = randomUUID();
      briefRows.push({
        id,
        client_id: c.id,
        title: text.title,
        description: text.description,
        locale: c.locale,
        skills: CATEGORY_SKILLS[category]!,
        budget_minor: rng.chance(0.6) ? roundUpToPricePoint(convertAtReference(budgetUsd * 100, "USD", currency), "tens", currency) : null,
        budget_currency: currency,
        deadline: rng.chance(0.5) ? d(at + rng.int(20, 60) * DAY) : null,
        status: "OPEN",
        created_at: d(at),
        updated_at: d(at),
      });
      const list = briefsByClient.get(c.id) ?? [];
      list.push({ id, category, at });
      briefsByClient.set(c.id, list);
    }
  }
  // A couple of drafts the client has not posted yet.
  for (const b of briefRows.slice(0, 3)) b.status = "DRAFT";
  // Fix budget_currency on briefs without a budget.
  for (const b of briefRows) if (b.budget_minor === null) b.budget_currency = null;

  // --- Contracts ------------------------------------------------------------
  const quoteRows: Prisma.QuoteCreateManyInput[] = [];
  const contractRows: Prisma.ContractCreateManyInput[] = [];
  const sims: { contractId: string; freelancer: SeedFreelancer; client: SeedClient; currency: string; locale: string; title: string; ms: SimMilestone[]; createdAt: number; quoteId: string | null }[] = [];

  /**
   * "Current work": contracts whose first milestone is placed in a given state
   * relative to now, so every active state (and every Projects detector) has
   * examples: due within 48h, auto-release countdown, revision loop, disputes.
   */
  type Forced = "AWAITING_FUNDING" | "FUNDED" | "IN_PROGRESS" | "DUE_SOON" | "DELIVERED" | "AUTO_RELEASE_SOON" | "REVISION_REQUESTED" | "REVISION_LOOP" | "DISPUTED";
  const FORCED: Forced[] = [
    "AWAITING_FUNDING", "AWAITING_FUNDING", "FUNDED", "FUNDED", "IN_PROGRESS", "IN_PROGRESS", "DUE_SOON", "DUE_SOON",
    "DELIVERED", "DELIVERED", "AUTO_RELEASE_SOON", "REVISION_REQUESTED", "REVISION_REQUESTED", "REVISION_LOOP", "DISPUTED", "DISPUTED", "DISPUTED", "FUNDED",
  ];
  for (let i = 0; i < CONTRACTS + FORCED.length; i++) {
    const forced: Forced | null = i >= CONTRACTS ? FORCED[i - CONTRACTS]! : null;
    const client = rng.weighted(clients, (c) => c.demand);
    const category = rng.pick(Object.keys(BRIEFS).filter((c) => answering(c).length > 0));
    const freelancer = rng.weighted(answering(category), (f) => f.demand);
    const m = getMarket(client.locale);
    // Older work is more often finished; skew creation toward recent months.
    const age = forced ? rng.int(4, 12) : Math.floor(Math.pow(rng.next(), 1.25) * (HISTORY_DAYS - 2)) + 1;
    const createdAt = now - age * DAY - rng.int(0, 20) * HOUR;

    // The client's project post and the freelancer's proposal that won it.
    const hours = rng.int(HOURS[0], HOURS[1]);
    const total = priceFor(freelancer, m.currency, m.rounding, hours);
    let revisions = rng.int(1, 3);
    const days = rng.int(7, 35);
    const n = rng.int(2, 4);
    if (forced === "REVISION_LOOP") revisions = Math.max(revisions, 4);
    const amounts = splitByWeights(total, WEIGHTS[n]!);
    const text = BRIEFS[category]![langOf(client.locale)];
    const title = text.title;

    const contractId = randomUUID();
    const projectId = randomUUID();
    const postedAt = createdAt - rng.int(4, 12) * DAY;
    briefRows.push({
      id: projectId,
      client_id: client.id,
      title: text.title,
      description: text.description,
      locale: client.locale,
      skills: CATEGORY_SKILLS[category]!,
      budget_minor: rng.chance(0.6) ? Math.round(total * (1 + rng.next() * 0.5)) : null,
      budget_currency: null,
      status: "CLOSED",
      created_at: d(postedAt),
      updated_at: d(createdAt),
    });
    const budgeted = briefRows.at(-1)!;
    budgeted.budget_currency = budgeted.budget_minor === null ? null : m.currency;
    const quoteId = randomUUID();
    const sentAt = postedAt + rng.int(3, 60) * HOUR;
    quoteRows.push({
      id: quoteId,
      client_id: client.id,
      freelancer_id: freelancer.id,
      brief_id: projectId,
      locale: client.locale,
      currency: m.currency,
      status: "SENT", // set to ACCEPTED below once milestone 1 is funded
      request_message: text.title,
      total_minor: total,
      delivery_days: days,
      revisions,
      scope: "Scope as described in the project, with the deliverables agreed in the thread.",
      message: "Happy to help. The price covers everything in the scope above.",
      requested_at: d(postedAt),
      sent_at: d(sentAt),
      expires_at: d(sentAt + 16 * DAY),
      created_at: d(sentAt),
      updated_at: d(createdAt),
    });

    // Simulate the milestones in order.
    const ms: SimMilestone[] = [];
    const per = Math.max(2, Math.ceil(days / n));
    let t = createdAt + rng.int(1, 30) * HOUR;
    const abandoned = forced ? forced === "AWAITING_FUNDING" : age < 20 ? rng.chance(0.12) : rng.chance(0.04);
    const makePayment = (at: number, gross: number) => {
      const est = estimateSaleFees(gross, { currency: m.currency, marketCountry: m.country, freelancerCountry: freelancer.country, freelancerCurrency: freelancer.currency, platformBps });
      return { id: randomUUID(), gross, paypalFee: est.paypal_fee + est.international_fee, platformFee: applyBps(gross, platformBps), fx: 0, capturedAt: at, declinedBefore: rng.chance(0.04) };
    };
    let stopped = false;
    for (let k = 0; k < n; k++) {
      const sm: SimMilestone = {
        id: randomUUID(),
        position: k + 1,
        title: MILESTONE_TITLES[n]![k]!,
        amount: amounts[k]!,
        due: createdAt + per * (k + 1) * DAY,
        state: "AWAITING_FUNDING",
        revision_count: 0,
        events: [],
        refunds: [],
      };
      ms.push(sm);
      if (stopped || (k === 0 && abandoned)) continue;
      const step = (at: number, event: string, to: MilestoneState, actor: Ev["actor"], note?: string) => {
        if (at > now) return false;
        sm.events.push({ at, event, from: sm.state, to, actor, note });
        sm.state = to;
        return true;
      };

      if (k === 0 && forced) {
        const ago = (h: number) => now - h * HOUR;
        const fund = (at: number) => {
          step(at, "FUND", "FUNDED", "SYSTEM");
          sm.funded_at = at;
          sm.payment = makePayment(at, sm.amount);
        };
        const work = (fundH: number, startH: number) => {
          fund(ago(fundH));
          step(ago(startH), "START", "IN_PROGRESS", "FREELANCER");
          sm.started_at = ago(startH);
        };
        const deliver = (h: number, note = "Delivery attached in the project thread.") => {
          step(ago(h), "DELIVER", "DELIVERED", "FREELANCER", note);
          sm.delivered_at = ago(h);
          sm.auto_release_at = ago(h) + AUTO_RELEASE_DAYS * DAY;
        };
        switch (forced) {
          case "FUNDED":
            fund(ago(rng.int(2, 20)));
            break;
          case "IN_PROGRESS":
            work(96, 80);
            break;
          case "DUE_SOON":
            work(120, 110);
            sm.due = now + rng.int(10, 40) * HOUR; // due within 48h, nothing delivered
            break;
          case "DELIVERED":
            work(140, 130);
            deliver(rng.int(10, 60));
            break;
          case "AUTO_RELEASE_SOON":
            work(240, 230);
            deliver(AUTO_RELEASE_DAYS * 24 - rng.int(6, 12)); // auto-releases within half a day
            break;
          case "REVISION_REQUESTED":
          case "REVISION_LOOP": {
            work(260, 250);
            const rounds = forced === "REVISION_LOOP" ? 3 : 1;
            let h = 200;
            for (let r = 0; r < rounds; r++) {
              deliver(h, r === 0 ? undefined : "Revised version attached.");
              h -= 30;
              step(ago(h), "REQUEST_REVISION", "REVISION_REQUESTED", "CLIENT", "Please adjust the draft as discussed in the thread.");
              sm.revision_count++;
              sm.auto_release_at = undefined;
              h -= 20;
            }
            break;
          }
          case "DISPUTED": {
            work(300, 290);
            deliver(150);
            const reason = rng.pick(DISPUTE_REASONS);
            step(ago(100), "OPEN_DISPUTE", "DISPUTED", "CLIENT", reason);
            sm.disputed_at = ago(100);
            sm.dispute_reason = reason;
            sm.auto_release_at = undefined;
            break;
          }
          case "AWAITING_FUNDING":
            break;
        }
        stopped = true;
        continue;
      }
      // FUND (the client's PayPal approval and capture).
      const fundAt = t;
      if (!step(fundAt, "FUND", "FUNDED", "SYSTEM")) {
        stopped = true;
        continue;
      }
      sm.funded_at = fundAt;
      const gross = sm.amount;
      sm.payment = makePayment(fundAt, gross);

      const startAt = fundAt + rng.int(2, 30) * HOUR;
      if (!step(startAt, "START", "IN_PROGRESS", "FREELANCER")) {
        stopped = true;
        continue;
      }
      sm.started_at = startAt;
      let deliverAt = startAt + Math.round(per * (0.6 + rng.next() * 0.6) * DAY);
      if (!step(deliverAt, "DELIVER", "DELIVERED", "FREELANCER", "Delivery attached in the project thread.")) {
        stopped = true;
        continue;
      }
      sm.delivered_at = deliverAt;

      // Revisions (bounded by the contract's allowance).
      let revisionLoop = false;
      while (sm.revision_count < revisions && rng.chance(sm.revision_count === 0 ? 0.28 : 0.3)) {
        const reqAt = deliverAt + rng.int(4, 60) * HOUR;
        if (!step(reqAt, "REQUEST_REVISION", "REVISION_REQUESTED", "CLIENT", "Please adjust the draft as discussed in the thread.")) break;
        sm.revision_count++;
        revisionLoop = true;
        const reAt = reqAt + rng.int(12, 72) * HOUR;
        if (!step(reAt, "DELIVER", "DELIVERED", "FREELANCER", "Revised version attached.")) break;
        deliverAt = reAt;
        sm.delivered_at = reAt;
      }
      if (sm.state === "REVISION_REQUESTED" || sm.events.at(-1)!.at > now) {
        stopped = true;
        continue;
      }
      sm.auto_release_at = deliverAt + AUTO_RELEASE_DAYS * DAY;

      // The client's answer: accept, dispute, or silence (auto-release).
      const r = rng.next();
      if (r < 0.06) {
        const disputeAt = deliverAt + rng.int(6, 70) * HOUR;
        const reason = rng.pick(DISPUTE_REASONS);
        if (!step(disputeAt, "OPEN_DISPUTE", "DISPUTED", "CLIENT", reason)) {
          stopped = true;
          continue;
        }
        sm.disputed_at = disputeAt;
        sm.dispute_reason = reason;
        sm.auto_release_at = undefined;
        const outcome = rng.next();
        const resolveAt = disputeAt + rng.int(2, 7) * DAY;
        if (resolveAt > now) {
          stopped = true;
          continue;
        }
        if (outcome < 0.45) {
          const amount = Math.round(gross * (0.3 + rng.next() * 0.3));
          sm.refunds.push({ id: randomUUID(), amount, fromHolding: true, at: resolveAt, reason: REFUND_REASONS[0]!, status: "COMPLETED" });
          step(resolveAt, "RESOLVE_RELEASE", "ACCEPTED", "SYSTEM", "Partial refund completed; the rest was released.");
          sm.released_at = resolveAt;
          sm.release_kind = "DISPUTE_RESOLVED";
        } else if (outcome < 0.8) {
          sm.refunds.push({ id: randomUUID(), amount: gross, fromHolding: true, at: resolveAt, reason: REFUND_REASONS[1]!, status: "COMPLETED" });
          step(resolveAt, "REFUND", "REFUNDED", "SYSTEM", "Full refund completed.");
          stopped = true; // the client walked away: later milestones are cancelled
          continue;
        } else {
          step(resolveAt, "ACCEPT", "ACCEPTED", "CLIENT", "Dispute withdrawn.");
          sm.released_at = resolveAt;
          sm.release_kind = "DISPUTE_RESOLVED";
        }
      } else if (r < 0.14 && !revisionLoop) {
        const at = sm.auto_release_at;
        if (!step(at, "AUTO_RELEASE", "ACCEPTED", "SYSTEM", `No response within ${AUTO_RELEASE_DAYS} days of delivery.`)) {
          stopped = true;
          continue;
        }
        sm.released_at = at;
        sm.release_kind = "AUTO_RELEASED";
      } else {
        const at = deliverAt + rng.int(2, 96) * HOUR;
        if (!step(at, "ACCEPT", "ACCEPTED", "CLIENT")) {
          stopped = true;
          continue;
        }
        sm.released_at = at;
        sm.release_kind = "CLIENT_ACCEPTED";
      }
      sm.auto_release_at = undefined;
      // An occasional goodwill refund after release, debited from the freelancer.
      if (rng.chance(0.03)) {
        const at = sm.released_at! + rng.int(2, 12) * DAY;
        if (at <= now) sm.refunds.push({ id: randomUUID(), amount: Math.round(gross * 0.2), fromHolding: false, at, reason: REFUND_REASONS[2]!, status: "COMPLETED" });
      }
      t = sm.released_at! + rng.int(2, 40) * HOUR;
    }
    // A full refund ends the contract; an old abandoned draft is cancelled.
    const ended = ms.some((x) => x.state === "REFUNDED");
    const staleDraft = abandoned && age > 14;
    for (const x of ms) {
      if (x.state === "AWAITING_FUNDING" && (ended || staleDraft)) {
        const at = Math.min(now, (ended ? Math.max(...ms.flatMap((y) => y.events.map((e) => e.at))) : createdAt + 14 * DAY) + HOUR);
        x.events.push({ at, event: "CANCEL", from: "AWAITING_FUNDING", to: "CANCELLED", actor: "CLIENT" });
        x.state = "CANCELLED";
      }
    }

    sims.push({ contractId, freelancer, client, currency: m.currency, locale: client.locale, title: title.slice(0, 140), ms, createdAt, quoteId });
    const funded = ms.filter((x) => x.funded_at !== undefined);
    const settled = ms.every((x) => x.state === "ACCEPTED" || x.state === "REFUNDED" || x.state === "CANCELLED");
    const allCancelled = ms.every((x) => x.state === "CANCELLED");
    const lastAt = Math.max(createdAt, ...ms.flatMap((x) => x.events.map((e) => e.at)));
    contractRows.push({
      id: contractId,
      client_id: client.id,
      freelancer_id: freelancer.id,
      source: "QUOTE",
      quote_id: quoteId,
      title: title.slice(0, 140),
      scope: "Scope as agreed in the proposal.",
      locale: client.locale,
      currency: m.currency,
      total_minor: total,
      revisions_allowed: revisions,
      status: allCancelled ? "CANCELLED" : settled && funded.length ? "COMPLETED" : funded.length ? "ACTIVE" : "DRAFT",
      activated_at: funded.length ? d(funded[0]!.funded_at!) : null,
      completed_at: settled && funded.length ? d(lastAt) : null,
      created_at: d(createdAt),
      updated_at: d(lastAt),
    });
    {
      const q = quoteRows.find((x) => x.id === quoteId)!;
      if (funded.length) Object.assign(q, { status: "ACCEPTED", decided_at: d(funded[0]!.funded_at!) });
      else if (allCancelled) Object.assign(q, { status: "DECLINED", decided_at: d(lastAt) });
    }
  }

  // Proposals on the open projects (the board): waiting for the client, and some that ended without a contract.
  type Outcome = { status: "SENT" | "DECLINED" | "EXPIRED" | "WITHDRAWN"; ageHours: [number, number] };
  const outcomes: Outcome[] = [
    ...Array.from({ length: 14 }, () => ({ status: "SENT" as const, ageHours: [4, 200] as [number, number] })),
    ...Array.from({ length: 4 }, () => ({ status: "DECLINED" as const, ageHours: [300, 3000] as [number, number] })),
    ...Array.from({ length: 3 }, () => ({ status: "EXPIRED" as const, ageHours: [800, 3500] as [number, number] })),
    ...Array.from({ length: 2 }, () => ({ status: "WITHDRAWN" as const, ageHours: [200, 2000] as [number, number] })),
  ];
  const board = briefRows.filter((b) => b.status === "OPEN");
  const sentBy = new Set<string>();
  for (const o of outcomes) {
    const brief = rng.pick(board);
    const category = Object.entries(CATEGORY_SKILLS).find(([, skills]) => skills.join() === (brief.skills as string[]).join())![0];
    const options = answering(category).filter((f) => !sentBy.has(`${brief.id}|${f.id}`));
    if (options.length === 0) continue;
    const freelancer = rng.pick(options);
    sentBy.add(`${brief.id}|${freelancer.id}`);
    const m = getMarket(brief.locale as string);
    const sentAt = now - rng.int(o.ageHours[0], o.ageHours[1]) * HOUR;
    const total = priceFor(freelancer, m.currency, m.rounding, rng.int(HOURS[0], HOURS[1]));
    quoteRows.push({
      id: randomUUID(),
      client_id: brief.client_id as string,
      freelancer_id: freelancer.id,
      brief_id: brief.id as string,
      locale: brief.locale as string,
      currency: m.currency,
      status: o.status === "EXPIRED" ? "SENT" : o.status, // expiry is computed from expires_at
      request_message: brief.title as string,
      total_minor: total,
      delivery_days: rng.int(5, 30),
      revisions: rng.int(1, 3),
      scope: "Scope as described in the project, with the deliverables listed in the proposal.",
      message: "Here is my price for the scope you described.",
      requested_at: d(sentAt),
      sent_at: d(sentAt),
      expires_at: d(o.status === "EXPIRED" ? sentAt + 14 * DAY : Math.max(now + 3 * DAY, sentAt + 14 * DAY)),
      decided_at: o.status === "DECLINED" || o.status === "WITHDRAWN" ? d(sentAt + rng.int(30, 120) * HOUR) : null,
      created_at: d(sentAt),
      updated_at: d(sentAt),
    });
  }

  // --- Money: payments, refunds, invoices -----------------------------------
  const milestoneRows: Prisma.MilestoneCreateManyInput[] = [];
  const eventRows: Prisma.MilestoneEventCreateManyInput[] = [];
  const actionRows: Prisma.AgentActionCreateManyInput[] = [];
  const paymentRows: Prisma.MilestonePaymentCreateManyInput[] = [];
  const refundRows: Prisma.MilestoneRefundCreateManyInput[] = [];
  const releases: { freelancer: SeedFreelancer; client: SeedClient; contractId: string; contractTitle: string; locale: string; currency: string; sm: SimMilestone; net: number }[] = [];
  /** Per freelancer+currency, dated money movements for the payout simulation. */
  const flows = new Map<string, { at: number; delta: number }[]>();
  const flow = (fid: string, currency: string, at: number, delta: number) => {
    const k = `${fid}|${currency}`;
    flows.set(k, [...(flows.get(k) ?? []), { at, delta }]);
  };

  for (const s of sims) {
    for (const sm of s.ms) {
      milestoneRows.push({
        id: sm.id,
        contract_id: s.contractId,
        freelancer_id: s.freelancer.id,
        client_id: s.client.id,
        position: sm.position,
        title: sm.title,
        description: "",
        currency: s.currency,
        amount_minor: sm.amount,
        due_date: d(Date.UTC(new Date(sm.due).getUTCFullYear(), new Date(sm.due).getUTCMonth(), new Date(sm.due).getUTCDate())),
        state: sm.state,
        revision_count: sm.revision_count,
        funded_at: sm.funded_at ? d(sm.funded_at) : null,
        started_at: sm.started_at ? d(sm.started_at) : null,
        delivered_at: sm.delivered_at ? d(sm.delivered_at) : null,
        auto_release_at: sm.state === "DELIVERED" && sm.auto_release_at ? d(sm.auto_release_at) : null,
        released_at: sm.released_at ? d(sm.released_at) : null,
        release_kind: sm.release_kind ?? null,
        disputed_at: sm.disputed_at ? d(sm.disputed_at) : null,
        dispute_reason: sm.dispute_reason ?? null,
        created_at: d(s.createdAt),
        updated_at: d(Math.max(s.createdAt, ...sm.events.map((e) => e.at))),
      });
      for (const e of sm.events) {
        const actorId = e.actor === "CLIENT" ? s.client.id : e.actor === "FREELANCER" ? s.freelancer.id : null;
        eventRows.push({ milestone_id: sm.id, event: e.event, from_state: e.from, to_state: e.to, actor: e.actor, actor_id: actorId, note: e.note ?? null, created_at: d(e.at) });
        actionRows.push({
          kind: "TOOL",
          tool: `milestone.${e.event.toLowerCase()}`,
          input: { milestone_id: sm.id, contract_id: s.contractId, note: e.note ?? null },
          output: { from: e.from, to: e.to },
          status: "SUCCEEDED",
          actor: e.actor,
          actor_id: actorId,
          freelancer_id: s.freelancer.id,
          created_at: d(e.at),
        });
      }
      const p = sm.payment;
      if (!p) continue;
      if (p.declinedBefore) {
        paymentRows.push({
          milestone_id: sm.id,
          contract_id: s.contractId,
          freelancer_id: s.freelancer.id,
          client_id: s.client.id,
          paypal_order_id: `SEED-ORDER-${randomUUID()}`,
          paypal_invoice_id: `${sm.id}-${randomUUID()}`,
          status: "DECLINED",
          currency: s.currency,
          gross_minor: p.gross,
          failure_reason: "INSTRUMENT_DECLINED",
          created_at: d(p.capturedAt - 20 * 60_000),
          updated_at: d(p.capturedAt - 20 * 60_000),
        });
      }
      const holdingRefunds = sm.refunds.filter((r) => r.fromHolding && r.status === "COMPLETED");
      const released = sm.released_at !== undefined;
      const refundFees = holdingRefunds.map((r) => ({ amountMinor: r.amount, paypalFeeReturnedMinor: 0, platformFeeReturnedMinor: Math.round((p.platformFee * r.amount) / p.gross) }));
      const net = released ? netOnRelease({ grossMinor: p.gross, paypalFeeMinor: p.paypalFee, platformFeeMinor: p.platformFee, fxCostMinor: p.fx }, refundFees) : null;
      paymentRows.push({
        id: p.id,
        milestone_id: sm.id,
        contract_id: s.contractId,
        freelancer_id: s.freelancer.id,
        client_id: s.client.id,
        paypal_order_id: `SEED-ORDER-${randomUUID()}`,
        paypal_invoice_id: `${sm.id}-${randomUUID()}`,
        status: "COMPLETED",
        currency: s.currency,
        gross_minor: p.gross,
        paypal_fee_minor: p.paypalFee,
        fee_is_estimate: true,
        platform_fee_minor: p.platformFee,
        fx_cost_minor: p.fx,
        net_to_freelancer_minor: net,
        capture_id: `SEED-CAPTURE-${randomUUID()}`,
        captured_at: d(p.capturedAt),
        released_at: released ? d(sm.released_at!) : null,
        created_at: d(p.capturedAt - 5 * 60_000),
        updated_at: d(sm.released_at ?? p.capturedAt),
      });
      for (const r of sm.refunds) {
        const split = refundSplit({ amountMinor: r.amount, grossMinor: p.gross, platformFeeMinor: p.platformFee, paypalFeeReturnedMinor: 0, fromHolding: r.fromHolding });
        refundRows.push({
          id: r.id,
          payment_id: p.id,
          milestone_id: sm.id,
          contract_id: s.contractId,
          freelancer_id: s.freelancer.id,
          currency: s.currency,
          amount_minor: r.amount,
          reason: r.reason,
          from_holding: r.fromHolding,
          status: r.status,
          paypal_refund_id: `SEED-REFUND-${randomUUID()}`,
          paypal_fee_returned_minor: 0,
          platform_fee_returned_minor: split.platformFeeReturnedMinor,
          freelancer_debit_minor: split.freelancerDebitMinor,
          created_at: d(r.at - DAY),
          completed_at: d(r.at),
        });
        if (!r.fromHolding) flow(s.freelancer.id, s.currency, r.at, -split.freelancerDebitMinor);
      }
      if (released) {
        flow(s.freelancer.id, s.currency, sm.released_at!, net!);
        releases.push({ freelancer: s.freelancer, client: s.client, contractId: s.contractId, contractTitle: s.title, locale: s.locale, currency: s.currency, sm, net: net! });
      }
    }
  }

  // Invoices: gap-free per freelancer, in release order.
  const invoiceRows: Prisma.InvoiceCreateManyInput[] = [];
  const lastSeq = new Map<string, number>();
  for (const r of releases.sort((a, b) => a.sm.released_at! - b.sm.released_at!)) {
    const seq = (lastSeq.get(r.freelancer.id) ?? 0) + 1;
    lastSeq.set(r.freelancer.id, seq);
    const draft = invoiceLines({
      contractTitle: r.contractTitle,
      milestoneTitle: r.sm.title,
      position: r.sm.position,
      grossMinor: r.sm.payment!.gross,
      refundsMinor: r.sm.refunds.filter((x) => x.fromHolding).map((x) => x.amount),
    });
    invoiceRows.push({
      freelancer_id: r.freelancer.id,
      client_id: r.client.id,
      contract_id: r.contractId,
      milestone_id: r.sm.id,
      seq,
      number: invoiceNumber(r.freelancer.invoice_prefix, seq),
      locale: r.locale,
      currency: r.currency,
      lines: draft.lines,
      total_minor: draft.total_minor,
      freelancer_name: r.freelancer.name,
      freelancer_country: r.freelancer.country,
      client_name: r.client.name,
      client_company: r.client.company_name,
      client_tax_id: r.client.tax_id,
      issued_at: d(r.sm.released_at!),
    });
  }

  // --- Payouts: on the 1st of each month, most of what was available then ---
  const scheduleRows: Prisma.FreelancerPayoutScheduleCreateManyInput[] = [];
  const payoutRows: Prisma.FreelancerPayoutCreateManyInput[] = [];
  for (const [key, moves] of flows) {
    const [fid, currency] = key.split("|") as [string, string];
    const f = fById.get(fid)!;
    let paid = 0;
    const start = new Date(now - HISTORY_DAYS * DAY);
    for (let mth = 1; mth <= 6; mth++) {
      const at = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + mth, 1, 9);
      if (at > now - 3 * DAY) break;
      const available = moves.filter((x) => x.at <= at).reduce((s, x) => s + x.delta, 0) - paid;
      const amount = Math.floor(available * 0.85);
      const fee = estimatePayoutFee(amount, currency);
      if (amount <= 0 || amount + fee > available || amount < 5_000) continue;
      const scheduleId = randomUUID();
      scheduleRows.push({ id: scheduleId, freelancer_id: fid, currency, status: "APPROVED", created_at: d(at - DAY) });
      payoutRows.push({
        schedule_id: scheduleId,
        freelancer_id: fid,
        currency,
        amount_minor: amount,
        fee_minor: fee,
        fee_is_estimate: false,
        receiver_email: f.paypal_email,
        scheduled_for: d(at),
        status: "SUCCESS",
        sender_batch_id: `gg-seed-${randomUUID()}`,
        paypal_batch_id: `SEED-BATCH-${randomUUID()}`,
        completed_at: d(at + 6 * HOUR),
        created_at: d(at - DAY),
        updated_at: d(at + 6 * HOUR),
      });
      paid += amount + fee;
    }
  }

  // --- Threads with translations ----------------------------------------------
  const threadRows: Prisma.ThreadCreateManyInput[] = [];
  const messageRows: Prisma.ThreadMessageCreateManyInput[] = [];
  const addThread = (o: { freelancer: SeedFreelancer; client: SeedClient; serviceTitle: string; contractId: string | null; quoteId: string | null; scenarios: { s: Scenario; at: number }[] }) => {
    const id = randomUUID();
    const cl = langOf(o.client.locale);
    const fl = langOf(o.freelancer.locale);
    const vars = { service: o.serviceTitle, client: first(o.client.name), freelancer: first(o.freelancer.name) };
    let last = 0;
    let lastSender: "CLIENT" | "FREELANCER" = "CLIENT";
    for (const { s, at } of o.scenarios) {
      for (const [i, line] of SCRIPTS[s].entries()) {
        // Kickoff and delivery open with a specific party; others start with the client.
        const firstSender = s === "delivery" ? "FREELANCER" : "CLIENT";
        const sender = i % 2 === 0 ? firstSender : firstSender === "CLIENT" ? "FREELANCER" : "CLIENT";
        const own = sender === "CLIENT" ? cl : fl;
        const other = sender === "CLIENT" ? fl : cl;
        const when = at + i * rng.int(1, 8) * HOUR;
        messageRows.push({
          thread_id: id,
          sender,
          body: fill(line[own], vars),
          body_locale: sender === "CLIENT" ? o.client.locale : o.freelancer.locale,
          translation: own === other ? null : fill(line[other], vars),
          created_at: d(Math.min(when, now)),
        });
        last = Math.max(last, Math.min(when, now));
        lastSender = sender;
      }
    }
    const recent = now - last < 7 * DAY;
    threadRows.push({
      id,
      freelancer_id: o.freelancer.id,
      client_id: o.client.id,
      contract_id: o.contractId,
      quote_id: o.quoteId,
      subject: (o.contractId ? o.serviceTitle : SUBJECTS[o.scenarios[0]!.s][cl]).slice(0, 140),
      last_message_at: d(last),
      freelancer_unread: recent && lastSender === "CLIENT" ? 1 : 0,
      client_unread: recent && lastSender === "FREELANCER" ? 1 : 0,
      created_at: d(o.scenarios[0]!.at),
      updated_at: d(last),
    });
  };
  for (const s of sims) {
    if (!rng.chance(0.5)) continue;
    const m1 = s.ms[0]!;
    const scenarios: { s: Scenario; at: number }[] = [];
    if (m1.funded_at) scenarios.push({ s: "kickoff", at: m1.funded_at + HOUR });
    if (m1.delivered_at) scenarios.push({ s: "delivery", at: m1.delivered_at });
    if (m1.revision_count > 0 && m1.delivered_at) scenarios.push({ s: "revision", at: m1.delivered_at + 2 * HOUR });
    const lastReleased = s.ms.filter((x) => x.released_at).at(-1);
    if (lastReleased && s.ms.every((x) => x.state === "ACCEPTED")) scenarios.push({ s: "thanks", at: lastReleased.released_at! + HOUR });
    if (!scenarios.length) scenarios.push({ s: "question", at: s.createdAt - DAY });
    addThread({ freelancer: s.freelancer, client: s.client, serviceTitle: s.title, contractId: s.contractId, quoteId: s.quoteId, scenarios: scenarios.sort((a, b) => a.at - b.at) });
  }
  for (let i = 0; i < 12; i++) {
    const brief = rng.pick(board);
    const client = clients.find((c) => c.id === brief.client_id)!;
    const category = Object.entries(CATEGORY_SKILLS).find(([, skills]) => skills.join() === (brief.skills as string[]).join())![0];
    const freelancer = rng.pick(answering(category));
    addThread({ freelancer, client, serviceTitle: brief.title as string, contractId: null, quoteId: null, scenarios: [{ s: "question", at: now - rng.int(1, 120) * DAY - rng.int(0, 20) * HOUR }] });
  }

  // --- One refund proposal waiting for approval (Approvals page demo) ---------
  const openDispute = sims.flatMap((s) => s.ms.map((sm) => ({ s, sm }))).find((x) => x.sm.state === "DISPUTED" && x.sm.payment);
  if (openDispute) {
    const { s, sm } = openDispute;
    const refundId = randomUUID();
    const amount = Math.round(sm.payment!.gross / 2);
    refundRows.push({
      id: refundId,
      payment_id: sm.payment!.id,
      milestone_id: sm.id,
      contract_id: s.contractId,
      freelancer_id: s.freelancer.id,
      currency: s.currency,
      amount_minor: amount,
      reason: "Half refund proposed to settle the dispute.",
      from_holding: true,
      status: "PROPOSED",
      created_at: d(Math.min(now, sm.disputed_at! + DAY)),
    });
    actionRows.push({
      kind: "TOOL",
      agent: "PROFILE",
      tool: "propose_refund",
      input: { milestone_id: sm.id, amount: null, reason: "Half refund proposed to settle the dispute." },
      output: { status: "PENDING_APPROVAL", refund_id: refundId, from_holding: true, message: "Refund proposed. It is only sent after the freelancer approves it on the Approvals page." },
      status: "PENDING_APPROVAL",
      rationale: "The client disputed the delivery; half the work was accepted in the thread.",
      actor: "FREELANCER",
      actor_id: s.freelancer.id,
      freelancer_id: s.freelancer.id,
      milestone_refund_id: refundId,
      created_at: d(Math.min(now, sm.disputed_at! + DAY)),
    });
  }

  // --- Insert ---------------------------------------------------------------------
  const many = async <T>(rows: T[], insert: (batch: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += 1000) await insert(rows.slice(i, i + 1000));
  };
  await many(briefRows, (data) => prisma.brief.createMany({ data }));
  await many(quoteRows, (data) => prisma.quote.createMany({ data }));
  await many(contractRows, (data) => prisma.contract.createMany({ data }));
  await many(milestoneRows, (data) => prisma.milestone.createMany({ data }));
  await many(eventRows, (data) => prisma.milestoneEvent.createMany({ data }));
  await many(paymentRows, (data) => prisma.milestonePayment.createMany({ data }));
  await many(refundRows, (data) => prisma.milestoneRefund.createMany({ data }));
  await many(invoiceRows, (data) => prisma.invoice.createMany({ data }));
  await many(actionRows, (data) => prisma.agentAction.createMany({ data }));
  await many(scheduleRows, (data) => prisma.freelancerPayoutSchedule.createMany({ data }));
  await many(payoutRows, (data) => prisma.freelancerPayout.createMany({ data }));
  await many(threadRows, (data) => prisma.thread.createMany({ data }));
  await many(messageRows, (data) => prisma.threadMessage.createMany({ data }));
  for (const [fid, seq] of lastSeq) await prisma.freelancer.update({ where: { id: fid }, data: { invoice_seq: seq } });

  const states = new Map<string, number>();
  for (const r of milestoneRows) states.set(r.state!, (states.get(r.state!) ?? 0) + 1);
  return {
    briefs: briefRows.length,
    quotes: quoteRows.length,
    contracts: contractRows.length,
    milestones: milestoneRows.length,
    states: Object.fromEntries([...states.entries()].sort()),
    invoices: invoiceRows.length,
    refunds: refundRows.length,
    payouts: payoutRows.length,
    threads: threadRows.length,
    messages: messageRows.length,
  };
}

