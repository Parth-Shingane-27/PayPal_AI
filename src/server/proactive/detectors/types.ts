import type { AgentName, Severity } from "@/generated/prisma/client";

/** What a detector reports. The fingerprint is `${type}:${subject}` and is stable across runs. */
export type Detection = {
  agent: Extract<AgentName, "TREASURY" | "OPERATIONS">;
  type: string;
  subject: string;
  severity: Severity;
  /** Plain-language fallback sentence (English); also seeds the agent's investigation. */
  summary: string;
  evidence: Record<string, unknown>;
};

export const fingerprintOf = (d: Pick<Detection, "type" | "subject">) => `${d.type}:${d.subject}`;

export type Detector = (sellerId: string, now: Date) => Promise<Detection[]>;
