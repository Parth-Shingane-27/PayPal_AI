import type { Finding } from "@/generated/prisma/client";
import { buildContext } from "../agents/context";
import type { ModelApi } from "../agents/model";
import { type RunResult, runAgent } from "../agents/runtime";
import { prisma } from "../db";
import { getMarket } from "../domain/markets";
import { dismissedTypes } from "./findings";
import { proactiveSpec } from "./specs";
import { MAX_PROACTIVE_RUNS_PER_DAY } from "./thresholds";

export type InvestigateDeps = { model?: ModelApi; modelId?: string; /** Wait before the one retry after a model error such as a rate limit. */ retryDelayMs?: number };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Ids mean nothing to a freelancer; drop a parenthetical that holds one, then any bare id. */
export function stripIds(text: string): string {
  // Models sometimes write ids with non-breaking or typographic hyphens (U+2010 to U+2015, U+2212).
  return text
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(new RegExp(`\\s*\\([^()]*${UUID}[^()]*\\)`, "gi"), "")
    .replace(new RegExp(`\\s*(?:order|listing|payout|payment|contract|milestone|quote|invoice)?\\s*#?${UUID}`, "gi"), "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1");
}

/** Splits the agent's reply into the headline and the body; null if it is unusable. */
export function parseFinding(reply: string): { title: string; body: string } | null {
  const lines = stripIds(reply).trim().split("\n");
  const title = (lines.shift() ?? "").replace(/^[#*\s]+|[*\s]+$/g, "").slice(0, 120);
  const body = lines.join("\n").trim();
  if (!title || !body) return null;
  return { title, body };
}

/** Agent runs a freelancer has already had today (UTC); capped to keep cost predictable. */
export async function runsToday(freelancerId: string, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return prisma.agentSession.count({ where: { freelancer_id: freelancerId, actor: "SYSTEM", created_at: { gte: start } } });
}

/**
 * Asks the matching agent to verify and explain one new finding. Any failure
 * leaves the template text in place; the finding is never lost.
 * Returns true when the agent wrote the text.
 */
export async function investigate(finding: Finding, deps: InvestigateDeps = {}, now = new Date()): Promise<boolean> {
  if (finding.agent !== "TREASURY" && finding.agent !== "PROJECTS") return false;
  if (!finding.freelancer_id) return false;
  if ((await runsToday(finding.freelancer_id, now)) >= MAX_PROACTIVE_RUNS_PER_DAY) return false;

  const freelancer = await prisma.freelancer.findUniqueOrThrow({ where: { id: finding.freelancer_id } });
  const spec = proactiveSpec(finding.agent, { autoPayoutProposals: freelancer.auto_payout_proposals });
  const session = await prisma.agentSession.create({
    data: { agent: finding.agent, actor: "SYSTEM", freelancer_id: freelancer.id, locale: freelancer.locale },
  });
  await prisma.finding.update({ where: { id: finding.id }, data: { session_id: session.id } });

  const dismissed = await dismissedTypes(freelancer.id);
  const lines = [
    "[automatic check]",
    `Rule: ${finding.type} (subject ${finding.fingerprint.split(":").slice(1).join(":")}). Severity: ${finding.severity.toLowerCase()}.`,
    `Evidence from the rule: ${JSON.stringify(finding.evidence)}`,
    finding.agent === "TREASURY" ? `Payout proposals are ${freelancer.auto_payout_proposals && finding.type === "payout_ready" ? "enabled" : "not enabled"} for this check.` : "",
    Object.keys(dismissed).length ? `The freelancer has dismissed these before: ${Object.keys(dismissed).join(", ")}.` : "",
    "Verify with your tools, then write the finding.",
  ].filter(Boolean);

  let run: RunResult;
  try {
    const owner = { type: "FREELANCER", freelancerId: freelancer.id } as const;
    const attempt = async () =>
      runAgent({
        sessionId: session.id,
        owner,
        actor: owner,
        market: getMarket(freelancer.locale),
        spec,
        userText: lines.join("\n"),
        context: await buildContext(owner, getMarket(freelancer.locale), { today: now }),
        handoffAllowed: false,
        model: deps.model,
        modelId: deps.modelId,
      });
    run = await attempt();
    // A rate limit clears within a minute; one patient retry beats a template.
    if (run.outcome === "model_error") {
      await new Promise((r) => setTimeout(r, deps.retryDelayMs ?? 25_000));
      run = await attempt();
    }
  } catch (err) {
    console.error(`[proactive] ${finding.fingerprint}: agent run failed`, err);
    return false;
  }

  const proposal = run.pendingApprovals.find((p): p is { approval_id: string } => typeof (p as { approval_id?: unknown })?.approval_id === "string");
  const parsed = run.outcome === "completed" ? parseFinding(run.reply) : null;
  await prisma.finding.update({
    where: { id: finding.id },
    data: {
      ...(parsed ?? {}),
      ...(proposal ? { action_id: proposal.approval_id, status: "ACTED" } : {}),
    },
  });
  return parsed !== null;
}
