import { PROJECTS_DETECTORS } from "./projects";
import { TREASURY_DETECTORS } from "./treasury";
import type { Detection } from "./types";

export * from "./types";

/** Runs every detector for one freelancer; one failing detector must not hide the others. */
export async function runDetectors(freelancerId: string, now = new Date()): Promise<Detection[]> {
  const all = await Promise.allSettled([...PROJECTS_DETECTORS, ...TREASURY_DETECTORS].map((d) => d(freelancerId, now)));
  const out: Detection[] = [];
  for (const r of all) {
    if (r.status === "fulfilled") out.push(...r.value);
    else console.error("[proactive] detector failed:", r.reason);
  }
  return out;
}
