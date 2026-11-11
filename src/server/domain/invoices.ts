/**
 * Invoice maths, pure. One invoice per released milestone, in the client's
 * currency. It shows what the client paid for the milestone, any refund as a
 * credit line, and the client's tax ID exactly as they entered it.
 *
 * No tax is calculated, added, validated or implied here: GlobalGig does not
 * give tax advice. Changing that needs a product decision, not a code change.
 */

export type InvoiceLine = {
  kind: "milestone" | "refund";
  description: string;
  /** Negative for credits. */
  amount_minor: number;
};

export type InvoiceDraft = {
  lines: InvoiceLine[];
  total_minor: number;
};

/** "GG-PRK-000042": prefix per freelancer, six-digit sequence, no gaps. */
export function invoiceNumber(prefix: string, seq: number): string {
  if (!/^[A-Z0-9]{2,8}$/.test(prefix)) throw new Error(`Invoice prefix must be 2-8 capital letters or digits, got "${prefix}"`);
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(`Invoice sequence must be a positive integer, got ${seq}`);
  return `GG-${prefix}-${String(seq).padStart(6, "0")}`;
}

/** The number to issue next; the caller holds the freelancer row lock. */
export function nextInvoiceSeq(lastIssued: number): number {
  if (!Number.isSafeInteger(lastIssued) || lastIssued < 0) throw new Error(`Invalid last invoice sequence ${lastIssued}`);
  return lastIssued + 1;
}

/**
 * A prefix from a name: initials of the first three words, or the first
 * three letters of a one-word name, A-Z only. The caller makes it unique.
 */
export function invoicePrefixFor(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[^A-Za-z\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const raw = words.length >= 2 ? words.slice(0, 3).map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 3);
  const prefix = raw.toUpperCase();
  return prefix.length >= 2 ? prefix : "GG";
}

export function invoiceLines(input: {
  contractTitle: string;
  milestoneTitle: string;
  position: number;
  grossMinor: number;
  refundsMinor: readonly number[];
}): InvoiceDraft {
  const lines: InvoiceLine[] = [
    { kind: "milestone", description: `${input.contractTitle}: milestone ${input.position}, ${input.milestoneTitle}`, amount_minor: input.grossMinor },
  ];
  for (const r of input.refundsMinor) {
    if (!Number.isSafeInteger(r) || r <= 0) throw new Error(`Refund amounts must be positive integers, got ${r}`);
    lines.push({ kind: "refund", description: "Refund", amount_minor: -r });
  }
  const total_minor = lines.reduce((s, l) => s + l.amount_minor, 0);
  if (total_minor < 0) throw new Error("Refunds exceed the milestone amount.");
  return { lines, total_minor };
}
