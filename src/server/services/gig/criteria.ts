import type { AcceptanceCriterion, CriterionSource } from "@/generated/prisma/client";
import { prisma } from "../../db";
import { CRITERIA_MAX, CRITERION_TEXT_MAX, isLocked } from "../../domain/criteria";
import { AppError, notFound } from "../../errors";
import { actorId, type Actor } from "../audit";
import { type GigOwner, ownerWhere } from "./owner";

/**
 * Acceptance criteria for a milestone: written (by either side or drafted by an
 * assistant), signed by both, then judged by the client. Money rules live in
 * domain/criteria.ts and are enforced in milestones.ts; nothing here moves money.
 */

const EDITABLE_STATES = ["AWAITING_FUNDING", "FUNDED"] as const;

export type CriterionView = {
  criterion_id: string;
  position: number;
  text: string;
  source: CriterionSource;
  status: AcceptanceCriterion["status"];
  signed_by_client: boolean;
  signed_by_freelancer: boolean;
  locked: boolean;
  verdict_note: string | null;
};

export function criterionView(c: AcceptanceCriterion): CriterionView {
  return {
    criterion_id: c.id,
    position: c.position,
    text: c.text,
    source: c.source,
    status: c.status,
    signed_by_client: c.client_signed_at !== null,
    signed_by_freelancer: c.freelancer_signed_at !== null,
    locked: isLocked(c),
    verdict_note: c.verdict_note,
  };
}

const actorOfOwner = (o: GigOwner): Actor => (o.type === "FREELANCER" ? { type: "FREELANCER", freelancerId: o.freelancerId } : { type: "CLIENT", clientId: o.clientId });

async function ownedMilestone(o: GigOwner, milestoneId: string) {
  const m = await prisma.milestone.findFirst({ where: { id: milestoneId, ...ownerWhere(o) } });
  if (!m) throw notFound("Milestone");
  return m;
}

function cleanText(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) throw new AppError("INVALID_INPUT", "A criterion cannot be empty.");
  if (t.length > CRITERION_TEXT_MAX) throw new AppError("INVALID_INPUT", `A criterion is limited to ${CRITERION_TEXT_MAX} characters.`);
  return t;
}

export async function listCriteria(o: GigOwner, milestoneId: string): Promise<CriterionView[]> {
  await ownedMilestone(o, milestoneId);
  const rows = await prisma.acceptanceCriterion.findMany({ where: { milestone_id: milestoneId }, orderBy: { position: "asc" } });
  return rows.map(criterionView);
}

/** Adds unsigned criteria. Allowed before work starts. `source` is AI when an assistant drafted them. */
export async function addCriteria(o: GigOwner, milestoneId: string, texts: string[], source?: CriterionSource): Promise<CriterionView[]> {
  const m = await ownedMilestone(o, milestoneId);
  if (!(EDITABLE_STATES as readonly string[]).includes(m.state)) {
    throw new AppError("CONFLICT", "Acceptance criteria can only be added before work starts.");
  }
  const cleaned = texts.map(cleanText);
  if (cleaned.length === 0) throw new AppError("INVALID_INPUT", "Add at least one criterion.");
  const by = source ?? (o.type === "FREELANCER" ? "FREELANCER" : "CLIENT");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.acceptanceCriterion.findMany({ where: { milestone_id: m.id }, select: { position: true } });
    if (existing.length + cleaned.length > CRITERIA_MAX) throw new AppError("INVALID_INPUT", `A milestone can have at most ${CRITERIA_MAX} criteria.`);
    let position = existing.reduce((max, c) => Math.max(max, c.position), 0);
    for (const text of cleaned) {
      position += 1;
      await tx.acceptanceCriterion.create({ data: { milestone_id: m.id, position, text, source: by } });
    }
    await tx.milestoneEvent.create({
      data: { milestone_id: m.id, event: "CRITERIA_ADDED", from_state: m.state, to_state: m.state, actor: actorOfOwner(o).type, actor_id: actorId(actorOfOwner(o)), note: `${cleaned.length} criteria (${by})` },
    });
    return (await tx.acceptanceCriterion.findMany({ where: { milestone_id: m.id }, orderBy: { position: "asc" } })).map(criterionView);
  });
}

/** Removes a criterion nobody has signed yet. */
export async function removeCriterion(o: GigOwner, criterionId: string): Promise<void> {
  const c = await prisma.acceptanceCriterion.findFirst({ where: { id: criterionId, milestone: ownerWhere(o) }, include: { milestone: true } });
  if (!c) throw notFound("Criterion");
  if (c.client_signed_at || c.freelancer_signed_at) throw new AppError("CONFLICT", "A signed criterion cannot be changed.");
  if (!(EDITABLE_STATES as readonly string[]).includes(c.milestone.state)) throw new AppError("CONFLICT", "Criteria can only be changed before work starts.");
  await prisma.acceptanceCriterion.delete({ where: { id: c.id } });
}

/** One signature covers every criterion of the milestone, for the side that clicks. */
export async function signCriteria(o: GigOwner, milestoneId: string, now = new Date()): Promise<CriterionView[]> {
  const m = await ownedMilestone(o, milestoneId);
  if (!(EDITABLE_STATES as readonly string[]).includes(m.state)) throw new AppError("CONFLICT", "The criteria can only be signed before work starts.");
  return prisma.$transaction(async (tx) => {
    const rows = await tx.acceptanceCriterion.findMany({ where: { milestone_id: m.id } });
    if (rows.length === 0) throw new AppError("CONFLICT", "There are no acceptance criteria to sign yet.");
    const field = o.type === "CLIENT" ? "client_signed_at" : "freelancer_signed_at";
    await tx.acceptanceCriterion.updateMany({ where: { milestone_id: m.id, [field]: null }, data: { [field]: now } });
    await tx.milestoneEvent.create({
      data: { milestone_id: m.id, event: "CRITERIA_SIGNED", from_state: m.state, to_state: m.state, actor: actorOfOwner(o).type, actor_id: actorId(actorOfOwner(o)), note: `Signed by the ${o.type.toLowerCase()}`, created_at: now },
    });
    return (await tx.acceptanceCriterion.findMany({ where: { milestone_id: m.id }, orderBy: { position: "asc" } })).map(criterionView);
  });
}

/** The client's verdict on one signed criterion, once the work is delivered. */
export async function decideCriterion(o: GigOwner, criterionId: string, status: "PASSED" | "FAILED", note: string | null, now = new Date()): Promise<CriterionView> {
  if (o.type !== "CLIENT") throw new AppError("FORBIDDEN", "Only the client judges the acceptance criteria.");
  const c = await prisma.acceptanceCriterion.findFirst({ where: { id: criterionId, milestone: { client_id: o.clientId } }, include: { milestone: true } });
  if (!c) throw notFound("Criterion");
  if (!isLocked(c)) throw new AppError("CONFLICT", "This criterion was never signed by both sides.");
  if (c.milestone.state !== "DELIVERED") throw new AppError("CONFLICT", "Criteria are judged after the work is delivered.");
  const text = (note ?? "").trim().slice(0, 500) || null;
  if (status === "FAILED" && !text) throw new AppError("INVALID_INPUT", "Say what is missing so the freelancer can fix it.");
  const updated = await prisma.acceptanceCriterion.update({ where: { id: c.id }, data: { status, verdict_note: text, decided_at: now } });
  await prisma.milestoneEvent.create({
    data: { milestone_id: c.milestone_id, event: `CRITERION_${status}`, from_state: c.milestone.state, to_state: c.milestone.state, actor: "CLIENT", actor_id: o.clientId, note: `#${c.position}: ${text ?? "ok"}`, created_at: now },
  });
  return criterionView(updated);
}
