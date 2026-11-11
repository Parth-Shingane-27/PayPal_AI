import { describe, expect, it } from "vitest";
import { canAccept, canAutoRelease, canStart, isLocked, type CriterionFacts } from "@/server/domain/criteria";

const d = new Date();
const c = (over: Partial<CriterionFacts> = {}): CriterionFacts => ({ status: "PENDING", client_signed_at: d, freelancer_signed_at: d, ...over });

describe("pay-on-proof rules", () => {
  it("locks a criterion only when both sides signed", () => {
    expect(isLocked(c())).toBe(true);
    expect(isLocked(c({ client_signed_at: null }))).toBe(false);
    expect(isLocked(c({ freelancer_signed_at: null }))).toBe(false);
  });

  it("lets work start only with at least one criterion, all signed by both", () => {
    expect(canStart([]).ok).toBe(false);
    expect(canStart([c(), c({ freelancer_signed_at: null })]).ok).toBe(false);
    expect(canStart([c(), c()]).ok).toBe(true);
  });

  it("accepts only when every criterion passed", () => {
    expect(canAccept([]).ok).toBe(true);
    expect(canAccept([c({ status: "PASSED" }), c({ status: "PENDING" })]).ok).toBe(false);
    expect(canAccept([c({ status: "PASSED" }), c({ status: "FAILED" })]).ok).toBe(false);
    expect(canAccept([c({ status: "PASSED" }), c({ status: "PASSED" })]).ok).toBe(true);
  });

  it("closes the objection window into a release only if nothing failed", () => {
    expect(canAutoRelease([c(), c({ status: "PASSED" })]).ok).toBe(true);
    expect(canAutoRelease([c(), c({ status: "FAILED" })]).ok).toBe(false);
  });
});
