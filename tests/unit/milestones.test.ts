import { describe, expect, it } from "vitest";
import {
  autoReleaseAt,
  availableEvents,
  checkMilestonePlan,
  isAwaitingDelivery,
  isInHolding,
  isReleased,
  isTerminal,
  MAX_MILESTONES,
  MILESTONE_EVENTS,
  MILESTONE_STATES,
  type MilestoneEventName,
  splitByWeights,
  splitEvenly,
  type TransitionActor,
  transition,
} from "@/server/domain/milestones";

const ACTORS: TransitionActor[] = ["CLIENT", "FREELANCER", "SYSTEM"];

/**
 * The expected table, written out independently of the implementation:
 * "STATE EVENT ACTOR -> NEXT". Every triple not listed must be rejected.
 */
const ALLOWED = `
AWAITING_FUNDING FUND SYSTEM -> FUNDED
AWAITING_FUNDING CANCEL CLIENT -> CANCELLED
AWAITING_FUNDING CANCEL FREELANCER -> CANCELLED
FUNDED START FREELANCER -> IN_PROGRESS
FUNDED DELIVER FREELANCER -> DELIVERED
FUNDED OPEN_DISPUTE CLIENT -> DISPUTED
FUNDED REFUND SYSTEM -> REFUNDED
IN_PROGRESS DELIVER FREELANCER -> DELIVERED
IN_PROGRESS OPEN_DISPUTE CLIENT -> DISPUTED
IN_PROGRESS REFUND SYSTEM -> REFUNDED
DELIVERED ACCEPT CLIENT -> ACCEPTED
DELIVERED AUTO_RELEASE SYSTEM -> ACCEPTED
DELIVERED REQUEST_REVISION CLIENT -> REVISION_REQUESTED
DELIVERED OPEN_DISPUTE CLIENT -> DISPUTED
DELIVERED REFUND SYSTEM -> REFUNDED
REVISION_REQUESTED DELIVER FREELANCER -> DELIVERED
REVISION_REQUESTED OPEN_DISPUTE CLIENT -> DISPUTED
REVISION_REQUESTED REFUND SYSTEM -> REFUNDED
DISPUTED ACCEPT CLIENT -> ACCEPTED
DISPUTED RESOLVE_RELEASE SYSTEM -> ACCEPTED
DISPUTED REFUND SYSTEM -> REFUNDED
ACCEPTED REFUND SYSTEM -> REFUNDED
`
  .trim()
  .split("\n")
  .map((l) => {
    const [state, event, actor, , next] = l.trim().split(/\s+/);
    return { state: state!, event: event!, actor: actor!, next: next! };
  });

const key = (s: string, e: string, a: string) => `${s} ${e} ${a}`;
const expected = new Map(ALLOWED.map((r) => [key(r.state, r.event, r.actor), r.next]));

const now = new Date("2026-11-10T12:00:00Z");
const past = new Date("2026-11-01T00:00:00Z");
/** Context that satisfies every guard, so only the table decides. */
const permissive = (actor: TransitionActor) => ({ actor, now, autoReleaseAt: past, revisionCount: 0, revisionsAllowed: 3 });

describe("milestone state machine: the full table", () => {
  const cases = MILESTONE_STATES.flatMap((s) => MILESTONE_EVENTS.flatMap((e) => ACTORS.map((a) => [s, e, a] as const)));

  it(`covers all ${MILESTONE_STATES.length} x ${MILESTONE_EVENTS.length} x ${ACTORS.length} combinations`, () => {
    expect(cases).toHaveLength(9 * 10 * 3);
  });

  it.each(cases)("%s + %s by %s", (state, event, actor) => {
    const res = transition(state, event, permissive(actor));
    const next = expected.get(key(state, event, actor));
    if (next) {
      expect(res).toEqual({ ok: true, from: state, to: next, event });
    } else {
      expect(res.ok).toBe(false);
      if (!res.ok) {
        // Wrong actor on a real edge is FORBIDDEN; a missing edge is INVALID_TRANSITION.
        const edgeExists = ACTORS.some((a) => expected.has(key(state, event, a)));
        expect(res.code).toBe(edgeExists ? "FORBIDDEN" : "INVALID_TRANSITION");
        expect(res.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it("availableEvents agrees with the table", () => {
    for (const s of MILESTONE_STATES) {
      for (const a of ACTORS) {
        const want = MILESTONE_EVENTS.filter((e) => expected.has(key(s, e, a)));
        expect(availableEvents(s, a), `${s} ${a}`).toEqual(want);
      }
    }
  });

  it("no agent-only path: every money-moving event needs SYSTEM, CLIENT or a person", () => {
    // FUND and REFUND follow a PayPal fact; release needs the client or the timer.
    for (const s of MILESTONE_STATES) {
      for (const e of ["FUND", "REFUND", "AUTO_RELEASE", "RESOLVE_RELEASE"] as MilestoneEventName[]) {
        expect(transition(s, e, permissive("FREELANCER")).ok, `${s} ${e}`).toBe(false);
        expect(transition(s, e, permissive("CLIENT")).ok, `${s} ${e}`).toBe(false);
      }
      expect(transition(s, "ACCEPT", permissive("FREELANCER")).ok).toBe(false);
    }
  });
});

describe("milestone guards", () => {
  it("auto-release waits for its date", () => {
    const at = new Date("2026-11-17T12:00:00Z");
    expect(transition("DELIVERED", "AUTO_RELEASE", { actor: "SYSTEM", now, autoReleaseAt: at })).toMatchObject({ ok: false, code: "NOT_YET" });
    expect(transition("DELIVERED", "AUTO_RELEASE", { actor: "SYSTEM", now: at, autoReleaseAt: at })).toMatchObject({ ok: true, to: "ACCEPTED" });
    expect(transition("DELIVERED", "AUTO_RELEASE", { actor: "SYSTEM", now, autoReleaseAt: null })).toMatchObject({ ok: false, code: "NOT_YET" });
  });

  it("revisions stop at the contract's limit", () => {
    expect(transition("DELIVERED", "REQUEST_REVISION", { actor: "CLIENT", revisionCount: 1, revisionsAllowed: 2 })).toMatchObject({ ok: true });
    expect(transition("DELIVERED", "REQUEST_REVISION", { actor: "CLIENT", revisionCount: 2, revisionsAllowed: 2 })).toMatchObject({
      ok: false,
      code: "LIMIT_REACHED",
    });
    expect(transition("DELIVERED", "REQUEST_REVISION", { actor: "CLIENT", revisionCount: 0, revisionsAllowed: 0 })).toMatchObject({
      ok: false,
      code: "LIMIT_REACHED",
    });
  });

  it("classifies states for holding, release and terminal", () => {
    const holding = MILESTONE_STATES.filter(isInHolding);
    expect(holding).toEqual(["FUNDED", "IN_PROGRESS", "DELIVERED", "REVISION_REQUESTED", "DISPUTED"]);
    expect(MILESTONE_STATES.filter(isReleased)).toEqual(["ACCEPTED"]);
    expect(MILESTONE_STATES.filter(isTerminal)).toEqual(["REFUNDED", "CANCELLED"]);
    expect(MILESTONE_STATES.filter(isAwaitingDelivery)).toEqual(["FUNDED", "IN_PROGRESS", "REVISION_REQUESTED"]);
    // Holding and released never overlap.
    for (const s of MILESTONE_STATES) expect(isInHolding(s) && isReleased(s)).toBe(false);
  });

  it("computes the auto-release date", () => {
    expect(autoReleaseAt(new Date("2026-11-01T09:30:00Z"), 7).toISOString()).toBe("2026-11-08T09:30:00.000Z");
    expect(() => autoReleaseAt(now, 0)).toThrow();
    expect(() => autoReleaseAt(now, 1.5)).toThrow();
  });
});

describe("milestone plans", () => {
  it("accepts a plan that adds up to the total", () => {
    expect(checkMilestonePlan(100_000, [30_000, 30_000, 40_000])).toEqual({ ok: true, sum: 100_000 });
  });

  it("rejects mismatched, empty, oversized and non-integer plans", () => {
    expect(checkMilestonePlan(100_000, [30_000, 30_000])).toMatchObject({ ok: false, sum: 60_000, issues: [{ code: "TOTAL_MISMATCH" }] });
    expect(checkMilestonePlan(100, [])).toMatchObject({ ok: false, issues: [{ code: "EMPTY" }] });
    expect(checkMilestonePlan(MAX_MILESTONES + 1, Array(MAX_MILESTONES + 1).fill(1))).toMatchObject({ ok: false, issues: [{ code: "TOO_MANY" }] });
    expect(checkMilestonePlan(100, [100.5, -0.5])).toMatchObject({ ok: false, issues: [{ code: "NOT_INTEGER" }, { code: "NOT_INTEGER" }] });
    expect(checkMilestonePlan(100, [150, -50])).toMatchObject({ ok: false, issues: [{ code: "NOT_POSITIVE", index: 1 }] });
    expect(checkMilestonePlan(100, [100, 0])).toMatchObject({ ok: false, issues: [{ code: "NOT_POSITIVE" }] });
  });

  it("splits by weights with the remainder on the last milestone", () => {
    expect(splitByWeights(100_001, [3000, 3000, 4000])).toEqual([30_000, 30_000, 40_001]);
    expect(splitByWeights(999, [5000, 5000])).toEqual([499, 500]);
    expect(checkMilestonePlan(12_345, splitByWeights(12_345, [2500, 2500, 2500, 2500])).ok).toBe(true);
    expect(() => splitByWeights(100, [5000, 4000])).toThrow(/10000/);
    expect(() => splitByWeights(1, [5000, 5000])).toThrow(/too small/);
    expect(() => splitByWeights(0, [10_000])).toThrow();
  });

  it("splits evenly", () => {
    expect(splitEvenly(10_000, 3)).toEqual([3333, 3333, 3334]);
    expect(splitEvenly(7, 1)).toEqual([7]);
    expect(() => splitEvenly(2, 3)).toThrow();
    expect(() => splitEvenly(100, 0)).toThrow();
    expect(() => splitEvenly(100, MAX_MILESTONES + 1)).toThrow();
  });
});
