import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { makeClient, makeContract, makeFreelancer, makeService, resetDb } from "../helpers/db";

/** The GlobalGig tables exist with the constraints the services will rely on. */

beforeEach(resetDb);

describe("GlobalGig schema", () => {
  it("stores a service with three packages and a contract with milestones and payments", async () => {
    const f = await makeFreelancer({ country: "IN", currency: "USD", locale: "hi-IN", timezone: "Asia/Kolkata" });
    const c = await makeClient({ locale: "de-DE", country: "DE", company_name: "Nordlicht GmbH", tax_id: "DE123456789" });
    const svc = await makeService(f.id);
    expect(svc.packages.map((p) => p.tier).sort()).toEqual(["BASIC", "PREMIUM", "STANDARD"]);

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

  it("keeps vector columns for service pages and freelancer skills", async () => {
    const cols = await prisma.$queryRaw<{ table_name: string; udt_name: string }[]>`
      SELECT table_name, udt_name FROM information_schema.columns
      WHERE column_name = 'embedding' AND table_name IN ('service_pages', 'freelancers') ORDER BY table_name`;
    expect(cols).toEqual([
      { table_name: "freelancers", udt_name: "vector" },
      { table_name: "service_pages", udt_name: "vector" },
    ]);
  });
});
