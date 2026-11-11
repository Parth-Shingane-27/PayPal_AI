import { prisma, type Tx } from "../../db";
import { type InvoiceLine, invoiceLines, invoiceNumber, nextInvoiceSeq } from "../../domain/invoices";
import { money } from "../../domain/money";
import { notFound } from "../../errors";
import { type GigOwner, lockFreelancer, ownerWhere } from "./owner";

/**
 * One invoice per released milestone, issued by code in the release
 * transaction. Numbers are sequential per freelancer with no gaps: the
 * counter on the freelancer row is bumped under its row lock, in the same
 * transaction as the release, so a rollback gives the number back.
 *
 * Invoices show amounts and the client's tax ID as entered. No tax is
 * calculated: GlobalGig does not give tax advice.
 */
export async function issueInvoice(tx: Tx, milestoneId: string, now = new Date()) {
  const existing = await tx.invoice.findUnique({ where: { milestone_id: milestoneId } });
  if (existing) return existing;
  const m = await tx.milestone.findUniqueOrThrow({
    where: { id: milestoneId },
    include: {
      contract: { include: { client: true, freelancer: true } },
      payments: { where: { status: "COMPLETED" }, include: { refunds: { where: { from_holding: true, status: "COMPLETED" } } } },
    },
  });
  const payment = m.payments[0];
  if (!payment) throw new Error(`Milestone ${m.id} has no captured payment to invoice`);
  await lockFreelancer(tx, m.freelancer_id);
  const f = await tx.freelancer.findUniqueOrThrow({ where: { id: m.freelancer_id } });
  const seq = nextInvoiceSeq(f.invoice_seq);
  const draft = invoiceLines({
    contractTitle: m.contract.title,
    milestoneTitle: m.title,
    position: m.position,
    grossMinor: payment.gross_minor,
    refundsMinor: payment.refunds.map((r) => r.amount_minor),
  });
  await tx.freelancer.update({ where: { id: f.id }, data: { invoice_seq: seq } });
  const c = m.contract.client;
  return tx.invoice.create({
    data: {
      freelancer_id: f.id,
      client_id: c.id,
      contract_id: m.contract_id,
      milestone_id: m.id,
      seq,
      number: invoiceNumber(f.invoice_prefix, seq),
      // The client's market: their language and the currency they paid in.
      locale: m.contract.locale,
      currency: payment.currency,
      lines: draft.lines,
      total_minor: draft.total_minor,
      freelancer_name: f.name,
      freelancer_country: f.country,
      client_name: c.name,
      client_company: c.company_name,
      client_tax_id: c.tax_id,
      issued_at: now,
    },
  });
}

type InvoiceRow = Awaited<ReturnType<typeof issueInvoice>>;

export function invoiceView(inv: InvoiceRow) {
  const m = (minor: number) => money(minor, inv.currency, inv.locale);
  return {
    invoice_id: inv.id,
    number: inv.number,
    issued_at: inv.issued_at.toISOString(),
    locale: inv.locale,
    currency: inv.currency,
    contract_id: inv.contract_id,
    milestone_id: inv.milestone_id,
    from: { name: inv.freelancer_name, country: inv.freelancer_country },
    to: { name: inv.client_name, company: inv.client_company, tax_id: inv.client_tax_id },
    lines: (inv.lines as InvoiceLine[]).map((l) => ({ kind: l.kind, description: l.description, amount: m(l.amount_minor) })),
    total: m(inv.total_minor),
    note: "Amounts as paid through GlobalGig. No tax has been calculated or added; the tax ID is shown as the client entered it.",
  };
}

export async function getInvoice(o: GigOwner, invoiceId: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, ...ownerWhere(o) } });
  if (!inv) throw notFound("Invoice");
  return invoiceView(inv);
}

/** By invoice number ("GG-PRK-000042"), for get_invoice. */
export async function getInvoiceByNumber(o: GigOwner, number: string) {
  const inv = await prisma.invoice.findFirst({ where: { number: number.trim().toUpperCase(), ...ownerWhere(o) } });
  if (!inv) throw notFound("Invoice");
  return invoiceView(inv);
}

export async function getInvoiceForMilestone(o: GigOwner, milestoneId: string) {
  const inv = await prisma.invoice.findFirst({ where: { milestone_id: milestoneId, ...ownerWhere(o) } });
  if (!inv) throw notFound("Invoice");
  return invoiceView(inv);
}

export async function listInvoices(o: GigOwner, opts: { limit?: number } = {}) {
  const rows = await prisma.invoice.findMany({ where: ownerWhere(o), orderBy: { issued_at: "desc" }, take: Math.min(opts.limit ?? 100, 500) });
  return rows.map((inv) => ({
    invoice_id: inv.id,
    number: inv.number,
    issued_at: inv.issued_at.toISOString(),
    counterpart: o.type === "FREELANCER" ? (inv.client_company ?? inv.client_name) : inv.freelancer_name,
    total: money(inv.total_minor, inv.currency, o.locale),
  }));
}
