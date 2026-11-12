import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT as HIRING } from "@/server/agents/hiring/system-prompt";
import { PROACTIVE_PROMPT as PROFILE_PROACTIVE } from "@/server/agents/profile/proactive-prompt";
import { SYSTEM_PROMPT as PROFILE } from "@/server/agents/profile/system-prompt";
import { AGENTS, agentForRole } from "@/server/agents/registry";
import { COMMON_RULES, FINDING_FORMAT } from "@/server/agents/shared-rules";

/**
 * The rule: src/server/agents/ holds exactly one folder per agent, and every
 * agent folder has its own system-prompt.ts. Shared engine files stay flat at
 * the root of agents/. GlobalGig has two agents: the Client Agent (hiring/)
 * and the Freelancer Agent (profile/).
 */
const ROOT = join(process.cwd(), "src/server/agents");
const FOLDERS = ["hiring", "profile"] as const;

const PROMPTS = { PROFILE, HIRING } as const;
const FOLDER_OF = { PROFILE: "profile", HIRING: "hiring" } as const;

describe("agent folder layout", () => {
  it("has exactly the two agent folders (no stray prompts/ or tools/)", () => {
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

  it("gives the Freelancer Agent a proactive-prompt.ts for automatic checks", () => {
    expect(existsSync(join(ROOT, "profile", "proactive-prompt.ts"))).toBe(true);
  });

  it("registers exactly the two GlobalGig agents, one per role", () => {
    expect(Object.keys(AGENTS).sort()).toEqual(["HIRING", "PROFILE"]);
    expect(agentForRole("CLIENT")).toBe("HIRING");
    expect(agentForRole("FREELANCER")).toBe("PROFILE");
  });
});

describe("system prompts", () => {
  it.each(Object.keys(PROMPTS) as (keyof typeof PROMPTS)[])("%s runs on its own folder's SYSTEM_PROMPT, with the shared rules", (name) => {
    expect(PROMPTS[name].trim().length).toBeGreaterThan(200);
    expect(AGENTS[name].system).toBe(PROMPTS[name]);
    expect(AGENTS[name].system).toContain(COMMON_RULES);
    expect(FOLDER_OF[name]).toBe(name.toLowerCase());
  });

  it("builds the automatic-check prompt on top of the Freelancer Agent's own prompt", () => {
    expect(PROFILE_PROACTIVE.startsWith(PROFILE)).toBe(true);
    expect(PROFILE_PROACTIVE).toContain(FINDING_FORMAT);
  });

  it("names no GlobalCart or removed-listing concepts", () => {
    for (const p of [...Object.values(PROMPTS), PROFILE_PROACTIVE]) {
      expect(p).not.toMatch(/GlobalCart|\bseller\b|\bbuyer\b|\bcart\b|\bproduct\b|service page|\bpackage\b/i);
    }
  });
});

describe("agent tools", () => {
  const names = (a: keyof typeof AGENTS) => AGENTS[a].tools.map((t) => t.name);

  it("gives each agent a short, role-specific tool list", () => {
    expect(names("HIRING")).toEqual(["draft_project", "list_proposals", "compare_proposals", "propose_milestone_plan", "create_milestone_payment"]);
    expect(names("PROFILE")).toEqual(["find_open_projects", "get_project", "suggest_rate", "draft_proposal", "get_balances", "estimate_fees", "propose_payout_schedule"]);
  });

  it("has no tool that funds, releases, refunds or pays out", () => {
    for (const a of Object.keys(AGENTS) as (keyof typeof AGENTS)[]) {
      for (const n of names(a)) expect(n, `${a}.${n}`).not.toMatch(/^(fund|release|refund|payout|pay_out|accept|send_proposal|publish)/);
    }
    // The only tool that touches money-moving paths is a proposal that waits for a person.
    const proposals = Object.values(AGENTS).flatMap((s) => s.tools.filter((t) => t.kind === "proposal").map((t) => t.name));
    expect(proposals).toEqual(["propose_payout_schedule"]);
  });

  it("never takes an identity as input", () => {
    for (const s of Object.values(AGENTS)) {
      for (const t of s.tools) {
        const keys = Object.keys((t.input as unknown as { shape: Record<string, unknown> }).shape);
        for (const k of keys) expect(k, `${s.name}.${t.name}`).not.toMatch(/^(freelancer_id|client_id|locale|actor)$/);
      }
    }
  });
});
