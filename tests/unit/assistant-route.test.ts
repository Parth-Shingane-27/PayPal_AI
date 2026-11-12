import { describe, expect, it } from "vitest";
import { AGENTS_FOR, chatStorageKey, defaultAgentFor, projectIdFor, subPath } from "@/components/assistant/route-context";

const F = "01a1b236-510d-736c-a260-e22beec1e533";
const P = "f61d6857-5e73-436b-a4a3-868ee894fdcf";

describe("subPath", () => {
  it("returns what follows the account id", () => {
    expect(subPath(`/freelancer/${F}`)).toBe("");
    expect(subPath(`/freelancer/${F}/`)).toBe("");
    expect(subPath(`/freelancer/${F}/earnings?period=last_30_days`)).toBe("earnings");
    expect(subPath(`/freelancer/${F}/board/${P}`)).toBe(`board/${P}`);
    expect(subPath(`/client/${F}/briefs`)).toBe("briefs");
    expect(subPath("/login")).toBe("");
  });
});

describe("defaultAgentFor", () => {
  it("gives each role its one assistant, on every page", () => {
    for (const page of ["", "earnings", "board", `board/${P}`, "projects", "messages"]) {
      expect(defaultAgentFor(`/freelancer/${F}/${page}`, "FREELANCER")).toBe("PROFILE");
      expect(defaultAgentFor(`/client/${F}/${page}`, "CLIENT")).toBe("HIRING");
    }
  });

  it("offers one agent per role, so the panel has nothing to switch", () => {
    expect(AGENTS_FOR.FREELANCER).toEqual(["PROFILE"]);
    expect(AGENTS_FOR.CLIENT).toEqual(["HIRING"]);
  });
});

describe("projectIdFor", () => {
  it("finds the project on a project page and nowhere else", () => {
    expect(projectIdFor(`/freelancer/${F}/board/${P}`)).toBe(P);
    expect(projectIdFor(`/freelancer/${F}/board`)).toBeUndefined();
    expect(projectIdFor(`/freelancer/${F}/projects/${P}`)).toBeUndefined();
  });
});

describe("chatStorageKey", () => {
  it("is one conversation per agent, project and scope", () => {
    expect(chatStorageKey("PROFILE")).toBe("globalgig.chat.PROFILE.-.-");
    expect(chatStorageKey("PROFILE", P)).toBe(`globalgig.chat.PROFILE.${P}.-`);
    expect(chatStorageKey("HIRING", undefined, "de-DE")).toBe("globalgig.chat.HIRING.-.de-DE");
  });
});
