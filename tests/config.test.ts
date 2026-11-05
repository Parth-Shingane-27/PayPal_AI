import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, coreConfig, demoLoginEnabled, groqConfig, paypalConfig } from "@/server/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config", () => {
  it("parses core settings with defaults", () => {
    const cfg = coreConfig();
    expect(cfg.PLATFORM_FEE_BPS).toBeTypeOf("number");
    expect(cfg.DATABASE_URL).toContain("globalcart_test");
  });

  it("rejects a short session secret", () => {
    vi.stubEnv("SESSION_SECRET", "short");
    expect(() => coreConfig()).toThrow(ConfigError);
  });

  it("checks integration keys only when asked", () => {
    vi.stubEnv("PAYPAL_CLIENT_ID", undefined);
    expect(() => coreConfig()).not.toThrow();
    expect(() => paypalConfig()).toThrow(/PAYPAL_CLIENT_ID/);
  });

  it("defaults the Groq models", () => {
    vi.stubEnv("GROQ_API_KEY", "q-key");
    for (const k of ["GROQ_MODEL", "GROQ_REASONING_EFFORT", "GROQ_AGENT_MODEL", "GROQ_AGENT_REASONING_EFFORT"]) vi.stubEnv(k, undefined);
    expect(groqConfig()).toMatchObject({
      GROQ_MODEL: "openai/gpt-oss-20b",
      GROQ_REASONING_EFFORT: "low",
      GROQ_AGENT_MODEL: "openai/gpt-oss-120b",
      GROQ_AGENT_REASONING_EFFORT: "medium",
    });
  });

  it("rejects an unknown reasoning effort", () => {
    vi.stubEnv("GROQ_API_KEY", "q-key");
    vi.stubEnv("GROQ_AGENT_REASONING_EFFORT", "extreme");
    expect(() => groqConfig()).toThrow(ConfigError);
  });

  it("disables demo login in production unless DEMO_LOGIN=true", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_LOGIN", "false");
    expect(demoLoginEnabled()).toBe(false);
    vi.stubEnv("DEMO_LOGIN", "true");
    expect(demoLoginEnabled()).toBe(true);
  });

  it("selects the sandbox base URL", () => {
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_ENV", "sandbox");
    expect(paypalConfig().baseUrl).toBe("https://api-m.sandbox.paypal.com");
  });
});
