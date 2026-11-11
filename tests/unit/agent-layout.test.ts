import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT as HIRING } from "@/server/agents/hiring/system-prompt";
import { SYSTEM_PROMPT as PROFILE } from "@/server/agents/profile/system-prompt";
import { PROACTIVE_PROMPT as PROJECTS_PROACTIVE } from "@/server/agents/projects/proactive-prompt";
import { SYSTEM_PROMPT as PROJECTS } from "@/server/agents/projects/system-prompt";
import { AGENTS } from "@/server/agents/registry";
import { COMMON_RULES, FINDING_FORMAT } from "@/server/agents/shared-rules";
import { PROACTIVE_PROMPT as TREASURY_PROACTIVE } from "@/server/agents/treasury/proactive-prompt";
import { SYSTEM_PROMPT as TREASURY } from "@/server/agents/treasury/system-prompt";

/**
 * The rule: src/server/agents/ holds exactly one folder per agent, and every
 * agent folder has its own system-prompt.ts. Shared engine files stay flat at
 * the root of agents/.
 */
const ROOT = join(process.cwd(), "src/server/agents");
const FOLDERS = ["hiring", "profile", "projects", "treasury"] as const;

const PROMPTS = { PROFILE, HIRING, TREASURY, PROJECTS } as const;
const FOLDER_OF = { PROFILE: "profile", HIRING: "hiring", TREASURY: "treasury", PROJECTS: "projects" } as const;

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

  it("gives Treasury and Projects a proactive-prompt.ts for automatic checks", () => {
    for (const folder of ["treasury", "projects"]) expect(existsSync(join(ROOT, folder, "proactive-prompt.ts"))).toBe(true);
  });

  it("registers exactly the four GlobalGig agents", () => {
    expect(Object.keys(AGENTS).sort()).toEqual(["HIRING", "PROFILE", "PROJECTS", "TREASURY"]);
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
    expect(PROJECTS_PROACTIVE.startsWith(PROJECTS)).toBe(true);
    for (const p of [TREASURY_PROACTIVE, PROJECTS_PROACTIVE]) expect(p).toContain(FINDING_FORMAT);
  });

  it("names no GlobalCart concepts", () => {
    for (const p of [...Object.values(PROMPTS), TREASURY_PROACTIVE, PROJECTS_PROACTIVE]) {
      expect(p).not.toMatch(/GlobalCart|\bseller\b|\bbuyer\b|\bcart\b|\bproduct\b/i);
    }
  });
});
