import { proactiveEnabled } from "../config";
import { prisma } from "../db";
import { runDetectors } from "./detectors";
import { reconcileFindings } from "./findings";
import { investigate, type InvestigateDeps, runsToday } from "./investigate";
import { MAX_PROACTIVE_RUNS_PER_DAY } from "./thresholds";

/** One at a time: a run is a few thousand tokens and the Groq on-demand tier allows 8,000 tokens a minute. */
const INVESTIGATE_CONCURRENCY = 1;

export type WatchResult = { created: number; refreshed: number; resolved: number; explained: number };

/**
 * One pass for one freelancer: run the rules, update the findings, and ask the
 * agents to explain each new one. Safe to run repeatedly; the same facts never
 * create a second finding.
 */
export async function runWatch(freelancerId: string, deps: InvestigateDeps & { now?: Date } = {}): Promise<WatchResult> {
  if (!proactiveEnabled()) return { created: 0, refreshed: 0, resolved: 0, explained: 0 };
  const now = deps.now ?? new Date();
  const detections = await runDetectors(freelancerId, now);
  const { created, refreshed, resolved } = await reconcileFindings(freelancerId, detections, now);
  // Highest severity first, so the daily run cap is spent on what matters most. Findings beyond the cap keep the rule's own sentence.
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  const room = Math.max(0, MAX_PROACTIVE_RUNS_PER_DAY - (await runsToday(freelancerId, now)));
  const todo = [...created].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, room);
  let explained = 0;
  for (let i = 0; i < todo.length; i += INVESTIGATE_CONCURRENCY) {
    const done = await Promise.all(todo.slice(i, i + INVESTIGATE_CONCURRENCY).map((f) => investigate(f, deps, now)));
    explained += done.filter(Boolean).length;
  }
  return { created: created.length, refreshed, resolved, explained };
}

/** Every freelancer; used by the daily scheduler. */
export async function freelancerIds(): Promise<string[]> {
  return (await prisma.freelancer.findMany({ select: { id: true } })).map((f) => f.id);
}
