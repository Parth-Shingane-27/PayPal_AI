import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { makeClient, makeContract, makeFreelancer, resetDb } from "../helpers/db";

/** The GlobalGig tables exist with the constraints the services will rely on. */

beforeEach(resetDb);

describe("GlobalGig schema", () => {
  it("stores a contract with milestones and payments", async () => {
    const f = await makeFreelancer({ country: "IN", currency: "USD", locale: "hi-IN", timezone: "Asia/Kolkata" });
    const c = await makeClient({ locale: "de-DE", country: "DE", company_name: "Nordlicht GmbH", tax_id: "DE123456789" });
    const { contract, milestones } = await makeContract(f.id, c.id, [
      { amount_minor: 20_000, state: "ACCEPTED" },
      { amount_minor: 30_000, state: "DELIVERED" },
      { amount_minor: 50_000 },
    ], { currency: "EUR", locale: "de-DE" });
    expect(contract.total_minor).toBe(100_000);
    expect(milestones.map((m) => m.milestone.state)).toEqual(["ACCEPTED", "DELIVERED", "AWAITING_FUNDING"]);
    expect(milestones[0]!.payment?.net_to_freelancer_minor).toBeGreaterThan(0);
    expect(milestones[1]!.payment?.net_to_freelancer_minor).toBeNull();
    expect(milestones[2]!.payment).toBeNull();
  });

  it("enforces one milestone per position and one invoice number per freelancer", async () => {
    const f = await makeFreelancer();
    const c = await makeClient();
    const { contract, milestones } = await makeContract(f.id, c.id, [{ amount_minor: 1_000, state: "ACCEPTED" }, { amount_minor: 1_000, state: "ACCEPTED" }]);
    await expect(
      prisma.milestone.create({
        data: { contract_id: contract.id, freelancer_id: f.id, client_id: c.id, position: 1, title: "dup", currency: "USD", amount_minor: 1 },
      }),
    ).rejects.toThrow();

    const invoice = (milestoneId: string, seq: number) =>
      prisma.invoice.create({
        data: {
          freelancer_id: f.id,
          client_id: c.id,
          contract_id: contract.id,
          milestone_id: milestoneId,
          seq,
          number: `GG-${f.invoice_prefix}-${seq}`,
          locale: "en-US",
          currency: "USD",
          lines: [],
          total_minor: 1_000,
          freelancer_name: f.name,
          freelancer_country: f.country,
          client_name: c.name,
        },
      });
    await invoice(milestones[0]!.milestone.id, 1);
    await expect(invoice(milestones[1]!.milestone.id, 1)).rejects.toThrow();
    await expect(invoice(milestones[0]!.milestone.id, 2)).rejects.toThrow(); // one invoice per milestone
    await invoice(milestones[1]!.milestone.id, 2);
  });

  it("has no listing tables or embedding columns left", async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const names = tables.map((t) => t.tablename);
    for (const gone of ["services", "service_packages", "service_pages", "service_page_prices", "market_rate_research", "service_page_daily_stats"]) expect(names, gone).not.toContain(gone);
    const cols = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.columns WHERE column_name = 'embedding' AND table_schema = 'public'`;
    expect(cols).toEqual([]);
  });
});
