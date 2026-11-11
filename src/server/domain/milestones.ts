import type { MilestoneState } from "@/generated/prisma/enums";

/**
 * The milestone state machine, as a pure function. Services call
 * `transition()` before every state change and write the result with a
 * guarded update (`WHERE state = from`), so a stale request cannot apply.
 *
 *   AWAITING_FUNDING --FUND--> FUNDED --START--> IN_PROGRESS --DELIVER--> DELIVERED --ACCEPT / AUTO_RELEASE--> ACCEPTED
 *                                                         ^                    |
 *                                                         +-- DELIVER -- REVISION_REQUESTED <-- REQUEST_REVISION
 *   FUNDED / IN_PROGRESS / DELIVERED / REVISION_REQUESTED --OPEN_DISPUTE--> DISPUTED
 *   DISPUTED --ACCEPT (client withdraws) / RESOLVE_RELEASE (partial refund done)--> ACCEPTED
 *   held states --REFUND (full refund done)--> REFUNDED;  ACCEPTED --REFUND (full)--> REFUNDED
 *   AWAITING_FUNDING --CANCEL--> CANCELLED
 *
 * Who may do what:
 *   CLIENT      accepts, requests a revision, opens a dispute, cancels an unfunded milestone.
 *   FREELANCER  starts and delivers work, cancels an unfunded milestone.
 *   SYSTEM      code acting on an outside fact: a PayPal capture (FUND), a completed
 *               refund (REFUND, RESOLVE_RELEASE) or the auto-release timer (AUTO_RELEASE).
 * No agent tool reaches any of these: agents only read state and propose refunds.
 */

export const MILESTONE_STATES = [
  "AWAITING_FUNDING",
  "FUNDED",
  "IN_PROGRESS",
  "DELIVERED",
  "REVISION_REQUESTED",
  "ACCEPTED",
  "DISPUTED",
  "REFUNDED",
  "CANCELLED",
] as const satisfies readonly MilestoneState[];

export const MILESTONE_EVENTS = [
  "FUND",
  "START",
  "DELIVER",
  "REQUEST_REVISION",
  "ACCEPT",
  "AUTO_RELEASE",
  "OPEN_DISPUTE",
  "RESOLVE_RELEASE",
  "REFUND",
  "CANCEL",
] as const;
export type MilestoneEventName = (typeof MILESTONE_EVENTS)[number];

export type TransitionActor = "CLIENT" | "FREELANCER" | "SYSTEM";

/** Facts some transitions depend on. */
export type TransitionContext = {
  actor: TransitionActor;
  now?: Date;
  /** Required for AUTO_RELEASE: the milestone's auto_release_at. */
  autoReleaseAt?: Date | null;
  /** Required for REQUEST_REVISION. */
  revisionCount?: number;
  revisionsAllowed?: number;
};

export type TransitionResult =
  | { ok: true; from: MilestoneState; to: MilestoneState; event: MilestoneEventName }
  | { ok: false; from: MilestoneState; event: MilestoneEventName; code: "INVALID_TRANSITION" | "FORBIDDEN" | "NOT_YET" | "LIMIT_REACHED"; reason: string };

type Rule = { to: MilestoneState; actors: readonly TransitionActor[] };

const HELD_BEFORE_DELIVERY = ["FUNDED", "IN_PROGRESS"] as const;

/** The whole table. Anything not listed is an invalid transition. */
const RULES: Record<MilestoneState, Partial<Record<MilestoneEventName, Rule>>> = {
  AWAITING_FUNDING: {
    FUND: { to: "FUNDED", actors: ["SYSTEM"] },
    CANCEL: { to: "CANCELLED", actors: ["CLIENT", "FREELANCER"] },
  },
  FUNDED: {
    START: { to: "IN_PROGRESS", actors: ["FREELANCER"] },
    DELIVER: { to: "DELIVERED", actors: ["FREELANCER"] },
    OPEN_DISPUTE: { to: "DISPUTED", actors: ["CLIENT"] },
    REFUND: { to: "REFUNDED", actors: ["SYSTEM"] },
  },
  IN_PROGRESS: {
    DELIVER: { to: "DELIVERED", actors: ["FREELANCER"] },
    OPEN_DISPUTE: { to: "DISPUTED", actors: ["CLIENT"] },
    REFUND: { to: "REFUNDED", actors: ["SYSTEM"] },
  },
  DELIVERED: {
    ACCEPT: { to: "ACCEPTED", actors: ["CLIENT"] },
    AUTO_RELEASE: { to: "ACCEPTED", actors: ["SYSTEM"] },
    REQUEST_REVISION: { to: "REVISION_REQUESTED", actors: ["CLIENT"] },
    OPEN_DISPUTE: { to: "DISPUTED", actors: ["CLIENT"] },
    REFUND: { to: "REFUNDED", actors: ["SYSTEM"] },
  },
  REVISION_REQUESTED: {
    DELIVER: { to: "DELIVERED", actors: ["FREELANCER"] },
    OPEN_DISPUTE: { to: "DISPUTED", actors: ["CLIENT"] },
    REFUND: { to: "REFUNDED", actors: ["SYSTEM"] },
  },
  DISPUTED: {
    ACCEPT: { to: "ACCEPTED", actors: ["CLIENT"] },
    RESOLVE_RELEASE: { to: "ACCEPTED", actors: ["SYSTEM"] },
    REFUND: { to: "REFUNDED", actors: ["SYSTEM"] },
  },
  ACCEPTED: {
    REFUND: { to: "REFUNDED", actors: ["SYSTEM"] },
  },
  REFUNDED: {},
  CANCELLED: {},
};

export function transition(from: MilestoneState, event: MilestoneEventName, ctx: TransitionContext): TransitionResult {
  const rule = RULES[from][event];
  const fail = (code: Extract<TransitionResult, { ok: false }>["code"], reason: string): TransitionResult => ({ ok: false, from, event, code, reason });
  if (!rule) return fail("INVALID_TRANSITION", `A milestone that is ${describeState(from)} cannot be ${EVENT_VERB[event]}.`);
  if (!rule.actors.includes(ctx.actor)) {
    return fail("FORBIDDEN", `Only ${rule.actors.map((a) => ACTOR_NAME[a]).join(" or ")} can ${EVENT_INFINITIVE[event]} this milestone.`);
  }
  if (event === "AUTO_RELEASE") {
    if (!ctx.autoReleaseAt) return fail("NOT_YET", "This milestone has no auto-release date.");
    if ((ctx.now ?? new Date()).getTime() < ctx.autoReleaseAt.getTime()) {
      return fail("NOT_YET", `This milestone auto-releases on ${ctx.autoReleaseAt.toISOString()}.`);
    }
  }
  if (event === "REQUEST_REVISION") {
    const used = ctx.revisionCount ?? 0;
    const allowed = ctx.revisionsAllowed ?? 0;
    if (used >= allowed) {
      return fail("LIMIT_REACHED", `All ${allowed} revision${allowed === 1 ? "" : "s"} in this contract have been used. Accept the delivery or open a dispute.`);
    }
  }
  return { ok: true, from, to: rule.to, event };
}

/** Events this actor could fire from this state (for buttons). Guards on time and revision limits are not applied. */
export function availableEvents(state: MilestoneState, actor: TransitionActor): MilestoneEventName[] {
  return MILESTONE_EVENTS.filter((e) => RULES[state][e]?.actors.includes(actor));
}

/** Client money sits with the platform: funded but not released. */
export function isInHolding(state: MilestoneState): boolean {
  return state === "FUNDED" || state === "IN_PROGRESS" || state === "DELIVERED" || state === "REVISION_REQUESTED" || state === "DISPUTED";
}

/** Released: counts toward the freelancer's available balance. */
export function isReleased(state: MilestoneState): boolean {
  return state === "ACCEPTED";
}

export function isTerminal(state: MilestoneState): boolean {
  return Object.keys(RULES[state]).length === 0;
}

/** Work has not been handed over yet (used by "due soon, nothing delivered"). */
export function isAwaitingDelivery(state: MilestoneState): boolean {
  return (HELD_BEFORE_DELIVERY as readonly string[]).includes(state) || state === "REVISION_REQUESTED";
}

const DAY_MS = 86_400_000;

/** When an unanswered delivery releases itself. */
export function autoReleaseAt(deliveredAt: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1) throw new Error(`Auto-release days must be a positive integer, got ${days}`);
  return new Date(deliveredAt.getTime() + days * DAY_MS);
}

// --- Milestone plans ----------------------------------------------------------

export const MAX_MILESTONES = 10;

export type PlanIssue = { code: "EMPTY" | "TOO_MANY" | "NOT_POSITIVE" | "NOT_INTEGER" | "TOTAL_MISMATCH"; message: string; index?: number };

/**
 * A milestone plan is valid when it has 1..MAX_MILESTONES milestones, each a
 * positive integer amount in minor units, adding up exactly to the total.
 */
export function checkMilestonePlan(totalMinor: number, amountsMinor: readonly number[]): { ok: true; sum: number } | { ok: false; sum: number; issues: PlanIssue[] } {
  const issues: PlanIssue[] = [];
  if (amountsMinor.length === 0) issues.push({ code: "EMPTY", message: "A plan needs at least one milestone." });
  if (amountsMinor.length > MAX_MILESTONES) issues.push({ code: "TOO_MANY", message: `A plan has at most ${MAX_MILESTONES} milestones.` });
  amountsMinor.forEach((a, index) => {
    if (!Number.isSafeInteger(a)) issues.push({ code: "NOT_INTEGER", message: `Milestone ${index + 1} is not a whole number of minor units.`, index });
    else if (a <= 0) issues.push({ code: "NOT_POSITIVE", message: `Milestone ${index + 1} must be more than zero.`, index });
  });
  const sum = amountsMinor.reduce((s, a) => s + a, 0);
  if (amountsMinor.length > 0 && sum !== totalMinor) {
    issues.push({ code: "TOTAL_MISMATCH", message: `The milestones add up to ${sum}, but the total is ${totalMinor} (minor units).` });
  }
  return issues.length ? { ok: false, sum, issues } : { ok: true, sum };
}

/**
 * Splits a total by percentage weights (basis points summing to 10 000).
 * Each share is rounded down; the remainder goes to the last milestone, so
 * the parts always add up to the total exactly.
 */
export function splitByWeights(totalMinor: number, weightsBps: readonly number[]): number[] {
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) throw new Error(`Total must be a positive integer, got ${totalMinor}`);
  if (weightsBps.length === 0 || weightsBps.length > MAX_MILESTONES) throw new Error(`Between 1 and ${MAX_MILESTONES} weights are needed.`);
  if (weightsBps.some((w) => !Number.isInteger(w) || w <= 0)) throw new Error("Weights must be positive integers (basis points).");
  const sum = weightsBps.reduce((s, w) => s + w, 0);
  if (sum !== 10_000) throw new Error(`Weights must add up to 10000 bps, got ${sum}`);
  const parts = weightsBps.map((w) => Math.floor((totalMinor * w) / 10_000));
  parts[parts.length - 1]! += totalMinor - parts.reduce((s, p) => s + p, 0);
  if (parts.some((p) => p <= 0)) throw new Error("The total is too small to split this way.");
  return parts;
}

/** Equal parts (remainder on the last one). */
export function splitEvenly(totalMinor: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_MILESTONES) throw new Error(`Between 1 and ${MAX_MILESTONES} milestones are needed.`);
  if (!Number.isSafeInteger(totalMinor) || totalMinor < count) throw new Error("The total is too small to split this way.");
  const base = Math.floor(totalMinor / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? totalMinor - base * (count - 1) : base));
}

// --- Wording ----------------------------------------------------------------

const ACTOR_NAME: Record<TransitionActor, string> = { CLIENT: "the client", FREELANCER: "the freelancer", SYSTEM: "GlobalGig" };

const EVENT_VERB: Record<MilestoneEventName, string> = {
  FUND: "funded",
  START: "started",
  DELIVER: "delivered",
  REQUEST_REVISION: "sent back for revision",
  ACCEPT: "accepted",
  AUTO_RELEASE: "auto-released",
  OPEN_DISPUTE: "disputed",
  RESOLVE_RELEASE: "released after a dispute",
  REFUND: "refunded",
  CANCEL: "cancelled",
};

const EVENT_INFINITIVE: Record<MilestoneEventName, string> = {
  FUND: "fund",
  START: "start",
  DELIVER: "deliver",
  REQUEST_REVISION: "request a revision on",
  ACCEPT: "accept",
  AUTO_RELEASE: "auto-release",
  OPEN_DISPUTE: "open a dispute on",
  RESOLVE_RELEASE: "release after a dispute",
  REFUND: "refund",
  CANCEL: "cancel",
};

export function describeState(state: MilestoneState): string {
  return state.toLowerCase().replace(/_/g, " ");
}
