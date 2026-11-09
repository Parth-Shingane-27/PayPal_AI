import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT as LISTING } from "@/server/agents/listing/system-prompt";
import { PROACTIVE_PROMPT as OPERATIONS_PROACTIVE } from "@/server/agents/operations/proactive-prompt";
import { SYSTEM_PROMPT as OPERATIONS } from "@/server/agents/operations/system-prompt";
import { AGENTS } from "@/server/agents/registry";
import { COMMON_RULES, FINDING_FORMAT } from "@/server/agents/shared-rules";
import { SYSTEM_PROMPT as SHOPPING } from "@/server/agents/shopping/system-prompt";
import { PROACTIVE_PROMPT as TREASURY_PROACTIVE } from "@/server/agents/treasury/proactive-prompt";
import { SYSTEM_PROMPT as TREASURY } from "@/server/agents/treasury/system-prompt";

/**
 * The rule: src/server/agents/ holds exactly one folder per agent, and every
 * agent folder has its own system-prompt.ts. Shared engine files stay flat at
 * the root of agents/.
 */
const ROOT = join(process.cwd(), "src/server/agents");
const FOLDERS = ["listing", "operations", "shopping", "treasury"] as const;

const PROMPTS = { LISTING, SHOPPING, TREASURY, OPERATIONS } as const;
const FOLDER_OF = { LISTING: "listing", SHOPPING: "shopping", TREASURY: "treasury", OPERATIONS: "operations" } as const;

describe("agent folder layout", () => {
  it("has exactly the four agent folders (no stray prompts/ or tools/)", () => {
    const dirs = readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual([...FOLDERS]);
  });

  it.each(FOLDERS)("%s has system-prompt.ts, tools.ts and index.ts", (folder) => {
    for (const file of ["system-prompt.ts", "tools.ts", "index.ts"]) {
      expect(existsSync(join(ROOT, folder, file)), `${folder}/${file}`).toBe(true);
    }
  });

  it("gives Treasury and Operations a proactive-prompt.ts for automatic checks", () => {
    for (const folder of ["treasury", "operations"]) expect(existsSync(join(ROOT, folder, "proactive-prompt.ts"))).toBe(true);
  });
});

describe("system prompts", () => {
  it.each(Object.keys(PROMPTS) as (keyof typeof PROMPTS)[])("%s runs on its own folder's SYSTEM_PROMPT, with the shared rules", (name) => {
    expect(PROMPTS[name].trim().length).toBeGreaterThan(200);
    expect(AGENTS[name].system).toBe(PROMPTS[name]);
    expect(AGENTS[name].system).toContain(COMMON_RULES);
    expect(FOLDER_OF[name]).toBe(name.toLowerCase());
  });

  it("builds the automatic-check prompts on top of each agent's own prompt", () => {
    expect(TREASURY_PROACTIVE.startsWith(TREASURY)).toBe(true);
    expect(OPERATIONS_PROACTIVE.startsWith(OPERATIONS)).toBe(true);
    for (const p of [TREASURY_PROACTIVE, OPERATIONS_PROACTIVE]) expect(p).toContain(FINDING_FORMAT);
  });
});
