import { describe, expect, it } from "vitest";
import { AGENTS_FOR, chatStorageKey, defaultAgentFor, serviceIdFor, subPath } from "@/components/assistant/route-context";

const F = "01a1b236-510d-736c-a260-e22beec1e533";
const S = "f61d6857-5e73-436b-a4a3-868ee894fdcf";

describe("subPath", () => {
  it("returns what follows the account id", () => {
    expect(subPath(`/freelancer/${F}`)).toBe("");
    expect(subPath(`/freelancer/${F}/`)).toBe("");
    expect(subPath(`/freelancer/${F}/earnings?period=last_30_days`)).toBe("earnings");
    expect(subPath(`/freelancer/${F}/services/${S}`)).toBe(`services/${S}`);
    expect(subPath(`/client/${F}/find`)).toBe("find");
    expect(subPath("/login")).toBe("");
  });
});

describe("defaultAgentFor", () => {
  it("follows the freelancer's page", () => {
    expect(defaultAgentFor(`/freelancer/${F}/earnings`, "FREELANCER")).toBe("TREASURY");
    expect(defaultAgentFor(`/freelancer/${F}/invoices`, "FREELANCER")).toBe("TREASURY");
    expect(defaultAgentFor(`/freelancer/${F}/projects`, "FREELANCER")).toBe("PROJECTS");
    expect(defaultAgentFor(`/freelancer/${F}/quotes`, "FREELANCER")).toBe("PROJECTS");
    expect(defaultAgentFor(`/freelancer/${F}/services`, "FREELANCER")).toBe("PROFILE");
    expect(defaultAgentFor(`/freelancer/${F}/services/${S}`, "FREELANCER")).toBe("PROFILE");
  });
  it("falls back to the routing assistant on the other freelancer pages", () => {
    for (const sub of ["", "messages", "approvals", "activity", "assistant"]) {
      expect(defaultAgentFor(`/freelancer/${F}/${sub}`, "FREELANCER"), sub).toBe("ASSISTANT");
    }
  });
  it("gives clients the hiring assistant everywhere", () => {
    for (const sub of ["", "find", "briefs", "quotes", "projects", "messages"]) expect(defaultAgentFor(`/client/${F}/${sub}`, "CLIENT"), sub).toBe("HIRING");
  });
  it("only ever picks an agent that role may use", () => {
    for (const sub of ["", "earnings", "projects", "services", "messages"]) {
      expect(AGENTS_FOR.FREELANCER).toContain(defaultAgentFor(`/freelancer/${F}/${sub}`, "FREELANCER"));
      expect(AGENTS_FOR.CLIENT).toContain(defaultAgentFor(`/client/${F}/${sub}`, "CLIENT"));
    }
  });
});

describe("serviceIdFor", () => {
  it("finds the service on its editor page only", () => {
    expect(serviceIdFor(`/freelancer/${F}/services/${S}`)).toBe(S);
    expect(serviceIdFor(`/freelancer/${F}/services`)).toBeUndefined();
    expect(serviceIdFor(`/freelancer/${F}/earnings`)).toBeUndefined();
  });
});

describe("chatStorageKey", () => {
  it("keeps one conversation per agent, and per service or scope", () => {
    expect(chatStorageKey("TREASURY")).toBe("globalgig.chat.TREASURY.-.-");
    expect(chatStorageKey("ASSISTANT")).toBe("globalgig.chat.ASSISTANT.-.-");
    expect(chatStorageKey("PROFILE", S)).toBe(`globalgig.chat.PROFILE.${S}.-`);
    expect(chatStorageKey("PROFILE", undefined, "new-service")).toBe("globalgig.chat.PROFILE.-.new-service");
    expect(chatStorageKey("HIRING", undefined, "hi-IN")).toBe("globalgig.chat.HIRING.-.hi-IN");
  });
});
