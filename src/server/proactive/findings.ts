import type { Finding, Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { asJson } from "../services/audit";
import { type Detection, fingerprintOf } from "./detectors";
import { templateFinding } from "./templates";

export type ReconcileResult = { created: Finding[]; refreshed: number; resolved: number };

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/**
 * Brings the findings table in line with what the detectors report now:
 *  - new fingerprint  -> NEW row (template text; the agent step may rewrite it);
 *  - open fingerprint -> refreshed evidence; an expired snooze comes back as NEW;
 *  - DISMISSED/SNOOZED stay hidden while the detector keeps firing;
 *  - open rows whose detector stopped firing -> RESOLVED.
 */
export async function reconcileFindings(sellerId: string, detections: Detection[], now = new Date()): Promise<ReconcileResult> {
  const open = await prisma.finding.findMany({ where: { seller_id: sellerId, status: { not: "RESOLVED" } } });
  const byFp = new Map(open.map((f) => [f.fingerprint, f]));
  const seen = new Set<string>();
  const result: ReconcileResult = { created: [], refreshed: 0, resolved: 0 };

  for (const d of detections) {
    const fp = fingerprintOf(d);
    if (seen.has(fp)) continue;
    seen.add(fp);
    const existing = byFp.get(fp);
    if (existing) {
      const resurfaced = existing.status === "SNOOZED" && existing.snoozed_until !== null && existing.snoozed_until <= now;
      await prisma.finding.update({
        where: { id: existing.id },
        data: { last_seen_at: now, evidence: asJson(d.evidence), severity: d.severity, ...(resurfaced ? { status: "NEW", snoozed_until: null } : {}) },
      });
      result.refreshed += 1;
      continue;
    }
    const t = templateFinding(d);
    try {
      result.created.push(
        await prisma.finding.create({
          data: {
            seller_id: sellerId,
            agent: d.agent,
            type: d.type,
            fingerprint: fp,
            severity: d.severity,
            title: t.title,
            body: t.body,
            evidence: asJson(d.evidence),
            first_seen_at: now,
            last_seen_at: now,
          },
        }),
      );
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // a concurrent run created it first
    }
  }

  for (const f of open) {
    if (seen.has(f.fingerprint)) continue;
    await prisma.finding.update({ where: { id: f.id }, data: { status: "RESOLVED", last_seen_at: now } });
    result.resolved += 1;
  }
  return result;
}

const SEVERITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

/** Visible findings for the feed: not resolved, not dismissed, not currently snoozed. */
export async function listFindings(sellerId: string, opts: { agent?: "TREASURY" | "OPERATIONS"; now?: Date } = {}): Promise<Finding[]> {
  const now = opts.now ?? new Date();
  const where: Prisma.FindingWhereInput = {
    seller_id: sellerId,
    ...(opts.agent ? { agent: opts.agent } : {}),
    OR: [{ status: { in: ["NEW", "SEEN", "ACTED"] } }, { status: "SNOOZED", snoozed_until: { lte: now } }],
  };
  const rows = await prisma.finding.findMany({ where, orderBy: { last_seen_at: "desc" }, take: 50 });
  return rows.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.last_seen_at.getTime() - a.last_seen_at.getTime());
}

export async function countNewFindings(sellerId: string): Promise<number> {
  return prisma.finding.count({ where: { seller_id: sellerId, status: "NEW" } });
}

/** New (unseen) findings per agent, for the nav badges. */
export async function newFindingCounts(sellerId: string): Promise<{ TREASURY: number; OPERATIONS: number }> {
  const rows = await prisma.finding.groupBy({ by: ["agent"], where: { seller_id: sellerId, status: "NEW" }, _count: true });
  const n = (a: string) => rows.find((r) => r.agent === a)?._count ?? 0;
  return { TREASURY: n("TREASURY"), OPERATIONS: n("OPERATIONS") };
}

/** Another seller's id is indistinguishable from a missing one. */
async function owned(id: string, sellerId: string): Promise<Finding | null> {
  return prisma.finding.findFirst({ where: { id, seller_id: sellerId } });
}

async function setStatus(id: string, sellerId: string, data: Prisma.FindingUpdateInput): Promise<Finding | null> {
  if (!(await owned(id, sellerId))) return null;
  return prisma.finding.update({ where: { id }, data });
}

export const markSeen = (id: string, sellerId: string) => setStatus(id, sellerId, { status: "SEEN" });
export const dismissFinding = (id: string, sellerId: string) => setStatus(id, sellerId, { status: "DISMISSED" });
export const markActed = (id: string, sellerId: string) => setStatus(id, sellerId, { status: "ACTED" });
export function snoozeFinding(id: string, sellerId: string, days: number, now = new Date()) {
  return setStatus(id, sellerId, { status: "SNOOZED", snoozed_until: new Date(now.getTime() + days * 86_400_000) });
}

/** Counts per fingerprint of how often the seller dismissed it; feeds the agent's context. */
export async function dismissedTypes(sellerId: string): Promise<Record<string, number>> {
  const rows = await prisma.finding.groupBy({ by: ["fingerprint"], where: { seller_id: sellerId, status: "DISMISSED" }, _count: true });
  return Object.fromEntries(rows.map((r) => [r.fingerprint, r._count]));
}
