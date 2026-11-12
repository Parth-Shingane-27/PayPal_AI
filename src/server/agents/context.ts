import { coreConfig } from "../config";
import { prisma } from "../db";
import type { Market } from "../domain/markets";
import { AppError, notFound } from "../errors";
import type { SessionOwner } from "./sessions";

/**
 * The session_context block sent as the first text block of a conversation's
 * first user turn. It carries the per-conversation facts that must stay out
 * of the cached system prompt. It comes from the session, never from the user.
 */
export async function buildContext(
  owner: SessionOwner,
  market: Market,
  opts: { projectId?: string | null; today?: Date } = {},
): Promise<string> {
  const today = (opts.today ?? new Date()).toISOString().slice(0, 10);
  const lines = [`Today (UTC): ${today}`];

  if (owner.type === "FREELANCER") {
    const f = await prisma.freelancer.findUnique({ where: { id: owner.freelancerId } });
    if (!f) throw notFound("Freelancer");
    lines.push(
      `User: freelancer "${f.name}" (based in ${f.country}, home currency ${f.currency}, time zone ${f.timezone})`,
      `Freelancer locale: ${market.locale}; reply language: ${market.language}`,
      `Milestones the client does not answer auto-release ${coreConfig().AUTO_RELEASE_DAYS} days after delivery.`,
    );
    if (opts.projectId) {
      const b = await prisma.brief.findFirst({ where: { id: opts.projectId, OR: [{ status: "OPEN" }, { quotes: { some: { freelancer_id: f.id } } }] }, select: { id: true, title: true } });
      if (b) lines.push(`The freelancer opened this chat from the project ${b.id} ("${b.title}").`);
    }
  } else if (owner.type === "CLIENT") {
    const c = await prisma.client.findUnique({ where: { id: owner.clientId } });
    if (!c) throw notFound("Client");
    lines.push(
      `User: a client${c.company_name ? ` hiring for a company` : ""} (based in ${c.country})`,
      `Client market: ${market.locale} (${market.country}); prices are in ${market.currency}; reply language: ${market.language}`,
    );
    if (opts.projectId) {
      const b = await prisma.brief.findFirst({ where: { id: opts.projectId, client_id: c.id }, select: { id: true, title: true } });
      if (b) lines.push(`The client opened this chat from their project ${b.id} ("${b.title}").`);
    }
  } else {
    throw new AppError("FORBIDDEN", "This assistant has moved to GlobalGig. Sign in as a freelancer or a client.");
  }
  return `<session_context>\nWritten by GlobalGig, not by the user.\n${lines.join("\n")}\n</session_context>`;
}
