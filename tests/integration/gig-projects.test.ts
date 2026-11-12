import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getOpenBrief, listOpenBriefs, publishBrief, saveBrief } from "@/server/services/gig/briefs";
import { proposeMilestonePlan } from "@/server/services/gig/contracts";
import { markFunded } from "@/server/services/gig/milestones";
import { closeQuote, compareProposals, listProposals, sendProposal } from "@/server/services/gig/quotes";
import { suggestRate } from "@/server/services/gig/rates";
import { makeBrief, makeClient, makeFreelancer, makeProposal, resetDb } from "../helpers/db";
import { fakeFx } from "../helpers/fakes";

beforeEach(resetDb);

const asF = (id: string, locale = "en-US") => ({ type: "FREELANCER" as const, freelancerId: id, locale });
const asC = (id: string, locale = "en-US") => ({ type: "CLIENT" as const, clientId: id, locale });
const proposal = { total: "600", delivery_days: 14, revisions: 2, scope: "Three concepts, one round of changes and final files.", message: null };

describe("the project board", () => {
  it("shows only OPEN projects, best skill match first, without client contact details", async () => {
    const f = await makeFreelancer({ skills: ["logo design", "branding"] });
    const c = await makeClient({ name: "Lena Bauer", company_name: "Bauer Bakery" });
    const draft = await makeBrief(c.id, { title: "Draft only", status: "DRAFT" });
    const closed = await makeBrief(c.id, { title: "Closed one", status: "CLOSED" });
    const weak = await makeBrief(c.id, { title: "Translate a menu", skills: ["translation"] });
    const strong = await makeBrief(c.id, { title: "Brand identity", skills: ["logo design", "branding"] });
    const board = await listOpenBriefs(asF(f.id));
    expect(board.map((b) => b.brief_id)).toEqual([strong.id, weak.id]);
    expect(board[0]).toMatchObject({ client: "Bauer Bakery", matching_skills: ["logo design", "branding"], proposals: 0, my_proposal: null });
    expect(JSON.stringify(board)).not.toContain("@test.local");
    expect(board.map((b) => b.brief_id)).not.toContain(draft.id);
    expect(board.map((b) => b.brief_id)).not.toContain(closed.id);
    await expect(getOpenBrief(asF(f.id), draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is for freelancers only, and a client publishes only their own draft", async () => {
    const c = await makeClient();
    const other = await makeClient();
    await expect(listOpenBriefs(asC(c.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const draft = await saveBrief(asC(c.id), { title: "Landing page copy", description: "Short copy for a landing page, in German.", skills: ["copywriting"], budget: "400", deadline: null });
    expect(draft.status).toBe("DRAFT");
    await expect(publishBrief(asC(other.id), draft.brief_id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await publishBrief(asC(c.id), draft.brief_id)).status).toBe("OPEN");
  });
});

describe("proposals", () => {
  it("sends straight to SENT in the project's currency, and revises instead of duplicating", async () => {
    const f = await makeFreelancer();
    const c = await makeClient();
    const brief = await makeBrief(c.id);
    const first = await sendProposal(asF(f.id), brief.id, proposal);
    expect(first).toMatchObject({ status: "SENT", revised: false, total: { amount_minor: 60_000, currency: "USD" } });
    const second = await sendProposal(asF(f.id), brief.id, { ...proposal, total: "550" });
    expect(second).toMatchObject({ revised: true, quote_id: first.quote_id, total: { amount_minor: 55_000 } });
    expect(await prisma.quote.count({ where: { brief_id: brief.id } })).toBe(1);
    expect((await getOpenBrief(asF(f.id), brief.id)).my_proposal).toMatchObject({ quote_id: first.quote_id, status: "SENT" });
  });

  it("is refused on a draft or closed project, by a client, and when the price is zero", async () => {
    const f = await makeFreelancer();
    const c = await makeClient();
    const draft = await makeBrief(c.id, { status: "DRAFT" });
    const closed = await makeBrief(c.id, { status: "CLOSED" });
    const open = await makeBrief(c.id);
    await expect(sendProposal(asF(f.id), draft.id, proposal)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(sendProposal(asF(f.id), closed.id, proposal)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(sendProposal(asC(c.id), open.id, proposal)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sendProposal(asF(f.id), open.id, { ...proposal, total: "0" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("lets the client see and compare only proposals on their own project", async () => {
    const [f1, f2] = [await makeFreelancer({ name: "Priya" }), await makeFreelancer({ name: "Tom" })];
    const c = await makeClient();
    const other = await makeClient();
    const brief = await makeBrief(c.id);
    const p1 = await makeProposal(f1.id, brief, { total_minor: 60_000 });
    const p2 = await makeProposal(f2.id, brief, { total_minor: 45_000, delivery_days: 21 });
    const list = await listProposals(asC(c.id), brief.id);
    expect(list.map((p) => p.quote_id).sort()).toEqual([p1.id, p2.id].sort());
    expect(list[0]!.freelancer).toHaveProperty("skills");
    await expect(listProposals(asC(other.id), brief.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listProposals(asF(f1.id), brief.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const cmp = await compareProposals(asC(c.id), [p1.id, p2.id]);
    expect(cmp).toHaveLength(2);
    expect(cmp.every((p) => typeof p.freelancer.milestones_accepted === "number")).toBe(true);
    await expect(compareProposals(asC(other.id), [p1.id, p2.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a freelancer can withdraw and a client can decline", async () => {
    const f = await makeFreelancer();
    const c = await makeClient();
    const brief = await makeBrief(c.id);
    const a = await makeProposal(f.id, brief);
    expect((await closeQuote(asF(f.id), a.id)).status).toBe("WITHDRAWN");
    const f2 = await makeFreelancer();
    const b = await makeProposal(f2.id, brief);
    expect((await closeQuote(asC(c.id), b.id)).status).toBe("DECLINED");
  });

  it("choosing one: the milestone plan splits its price exactly, and funding closes the project and declines the rest", async () => {
    const [f1, f2] = [await makeFreelancer(), await makeFreelancer()];
    const c = await makeClient();
    const brief = await makeBrief(c.id);
    const win = await makeProposal(f1.id, brief, { total_minor: 60_001 });
    const lose = await makeProposal(f2.id, brief, { total_minor: 40_000 });
    const plan = await proposeMilestonePlan(asC(c.id), { quoteId: win.id }, [
      { title: "Concepts", amount: null },
      { title: "Final files", amount: null },
    ]);
    expect(plan).toMatchObject({ adds_up: true, total: { amount_minor: 60_001 } });
    await expect(proposeMilestonePlan(asC(c.id), { quoteId: win.id }, [{ title: "A", amount: "100" }, { title: "B", amount: "100" }])).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const first = await prisma.milestone.findFirstOrThrow({ where: { contract_id: plan.contract_id, position: 1 } });
    await prisma.$transaction((tx) => markFunded(tx, first.id));
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: win.id } })).status).toBe("ACCEPTED");
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: lose.id } })).status).toBe("DECLINED");
    expect((await prisma.brief.findUniqueOrThrow({ where: { id: brief.id } })).status).toBe("CLOSED");
    // The project has left the board.
    expect(await listOpenBriefs(asF(f2.id))).toEqual([]);
  });

  it("another client cannot plan on a proposal that is not theirs", async () => {
    const f = await makeFreelancer();
    const c = await makeClient();
    const intruder = await makeClient();
    const p = await makeProposal(f.id, await makeBrief(c.id));
    await expect(proposeMilestonePlan(asC(intruder.id), { quoteId: p.id }, [{ title: "A", amount: null }])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("rate help", () => {
  it("never goes below the floor and compares with the client's budget", async () => {
    const f = await makeFreelancer({ hourly_floor_minor: 4_000 }); // US$40/h
    const c = await makeClient();
    const cheap = await makeBrief(c.id, { budget_minor: 20_000 });
    const roomy = await makeBrief(c.id, { budget_minor: 900_000 });
    const none = await makeBrief(c.id, { budget_minor: null });
    const fx = fakeFx();
    const tight = await suggestRate(f.id, { briefId: cheap.id, hours: 10 }, fx);
    expect(tight.suggested_price.amount_minor).toBeGreaterThanOrEqual(tight.floor_price.amount_minor);
    expect(tight.floor_price.amount_minor).toBeGreaterThanOrEqual(40_000);
    expect(tight.within_budget).toBe(false);
    expect(tight.warnings.map((w) => w.code)).toContain("FLOOR_ABOVE_BUDGET");
    const ok = await suggestRate(f.id, { briefId: roomy.id, hours: 10 }, fx);
    expect(ok).toMatchObject({ within_budget: true, warnings: [] });
    const low = await suggestRate(f.id, { briefId: roomy.id, hours: 10, targetPrice: "100" }, fx);
    expect(low.suggested_price.amount_minor).toBe(low.floor_price.amount_minor);
    expect(low.warnings.map((w) => w.code)).toContain("TARGET_BELOW_FLOOR");
    expect((await suggestRate(f.id, { briefId: none.id, hours: 10 }, fx)).warnings.map((w) => w.code)).toContain("NO_BUDGET");
    await expect(suggestRate(f.id, { briefId: cheap.id, hours: 0 }, fx)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
