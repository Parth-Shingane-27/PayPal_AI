import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as demoPOST } from "@/app/api/auth/demo/route";
import { GET as approvalsGET } from "@/app/api/freelancer/approvals/route";
import { POST as marketPOST } from "@/app/api/client/market/route";
import { POST as chatPOST } from "@/app/api/chat/route";
import { POST as fundPOST } from "@/app/api/contracts/[id]/fund/route";
import { POST as capturePOST } from "@/app/api/milestone-checkout/capture/route";
import { POST as briefsPOST } from "@/app/api/briefs/route";
import { POST as publishPOST } from "@/app/api/briefs/[id]/publish/route";
import { POST as proposalsPOST } from "@/app/api/briefs/[id]/proposals/route";
import { GET as boardGET } from "@/app/api/projects/open/route";
import { SESSION_COOKIE, signSession, verifySession } from "@/server/auth";
import { paypal } from "@/server/services/audit";
import { makeBrief, makeClient, makeContract, makeFreelancer, resetDb } from "../helpers/db";

// The chat route uses the live model client; replace it with a scripted one.
const script = vi.hoisted(() => ({ steps: [] as unknown[], requests: [] as unknown[] }));
vi.mock("@/server/agents/model", async (orig) => {
  const actual = await orig<typeof import("@/server/agents/model")>();
  return {
    ...actual,
    liveModel: {
      async chat(params: unknown) {
        script.requests.push(params);
        const step = script.steps.shift();
        if (!step) throw new Error("no scripted step");
        return step;
      },
    },
  };
});
vi.mock("@/server/config", async (orig) => {
  const actual = await orig<typeof import("@/server/config")>();
  return {
    ...actual,
    groqConfig: () => ({
      GROQ_API_KEY: "test",
      GROQ_MODEL: "openai/gpt-oss-20b",
      GROQ_REASONING_EFFORT: "low" as const,
      GROQ_AGENT_MODEL: "openai/gpt-oss-120b",
      GROQ_AGENT_REASONING_EFFORT: "medium" as const,
    }),
  };
});

beforeEach(async () => {
  await resetDb();
  script.steps.length = 0;
  script.requests.length = 0;
  vi.restoreAllMocks();
});

const BASE = "http://localhost:3000";
const cookie = (role: "FREELANCER" | "CLIENT", id: string, market: string | null = null) => `${SESSION_COOKIE}=${signSession({ role, id, market })}`;

function req(method: string, path: string, opts: { cookie?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.origin) headers.origin = opts.origin;
  return new Request(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("auth", () => {
  it("signs and verifies sessions, rejecting tampering and expiry", () => {
    const id = "0190c0de-0000-7000-8000-000000000001";
    const token = signSession({ role: "FREELANCER", id, market: null });
    expect(verifySession(token)).toMatchObject({ role: "FREELANCER", id });
    const [data, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ role: "CLIENT", id, market: null, exp: 9e9 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`)).toBeNull();
    expect(verifySession(`${data}.${sig}x`)).toBeNull();
    expect(verifySession(token, Date.now() + 8 * 24 * 3600 * 1000)).toBeNull();
  });

  it("demo login sets a signed cookie, and is off in production unless enabled", async () => {
    const freelancer = await makeFreelancer();
    const res = await demoPOST(req("POST", "/api/auth/demo", { body: { role: "FREELANCER", id: freelancer.id } }), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_LOGIN", "false");
    expect((await demoPOST(req("POST", "/api/auth/demo", { body: { role: "FREELANCER", id: freelancer.id } }), undefined)).status).toBe(403);
    vi.unstubAllEnvs();
  });

  it("returns 401 without a session and 403 for the wrong role", async () => {
    const client = await makeClient();
    expect((await approvalsGET(req("GET", "/api/freelancer/approvals"), undefined)).status).toBe(401);
    expect((await approvalsGET(req("GET", "/api/freelancer/approvals", { cookie: cookie("CLIENT", client.id) }), undefined)).status).toBe(403);
  });

  it("refuses sessions from the old GlobalCart roles", async () => {
    const f = await makeFreelancer();
    const old = `${SESSION_COOKIE}=${Buffer.from(JSON.stringify({ role: "SELLER", id: f.id, market: null, exp: 9e9 })).toString("base64url")}.x`;
    expect((await approvalsGET(req("GET", "/api/freelancer/approvals", { cookie: old }), undefined)).status).toBe(401);
  });

  it("refuses cross-site mutations", async () => {
    const f = await makeFreelancer();
    const res = await briefsPOST(req("POST", "/api/briefs", { cookie: cookie("CLIENT", f.id), body: {}, origin: "https://evil.example" }), undefined);
    expect(res.status).toBe(403);
  });

  it("lets a client switch market through the signed cookie", async () => {
    const client = await makeClient();
    const res = await marketPOST(req("POST", "/api/client/market", { cookie: cookie("CLIENT", client.id), body: { locale: "ja-JP" } }), undefined);
    const set = res.headers.get("set-cookie")!;
    const token = decodeURIComponent(new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(set)![1]!);
    expect(verifySession(token)).toMatchObject({ role: "CLIENT", market: "ja-JP" });
  });
});

describe("project routes", () => {
  it("shows the board to freelancers only, and only OPEN projects", async () => {
    const f = await makeFreelancer();
    const client = await makeClient();
    const open = await makeBrief(client.id, { title: "Open one" });
    await makeBrief(client.id, { title: "Draft one", status: "DRAFT" });
    const res = await boardGET(req("GET", "/api/projects/open", { cookie: cookie("FREELANCER", f.id) }), undefined);
    expect(res.status).toBe(200);
    expect((await res.json()).projects.map((p: { brief_id: string }) => p.brief_id)).toEqual([open.id]);
    expect((await boardGET(req("GET", "/api/projects/open", { cookie: cookie("CLIENT", client.id) }), undefined)).status).toBe(403);
    expect((await boardGET(req("GET", "/api/projects/open"), undefined)).status).toBe(401);
  });

  it("publishes a draft project (the client's click), and a freelancer cannot", async () => {
    const f = await makeFreelancer();
    const client = await makeClient();
    const other = await makeClient();
    const draft = await makeBrief(client.id, { status: "DRAFT" });
    expect((await publishPOST(req("POST", `/api/briefs/${draft.id}/publish`, { cookie: cookie("FREELANCER", f.id) }), params(draft.id))).status).toBe(403);
    expect((await publishPOST(req("POST", `/api/briefs/${draft.id}/publish`, { cookie: cookie("CLIENT", other.id) }), params(draft.id))).status).toBe(404);
    const res = await publishPOST(req("POST", `/api/briefs/${draft.id}/publish`, { cookie: cookie("CLIENT", client.id) }), params(draft.id));
    expect(await res.json()).toMatchObject({ brief_id: draft.id, status: "OPEN" });
  });

  it("takes a proposal from a freelancer on an open project, and not from a client", async () => {
    const f = await makeFreelancer();
    const client = await makeClient();
    const brief = await makeBrief(client.id);
    const body = { total: "600", delivery_days: 14, revisions: 2, scope: "Three concepts and final files." };
    expect((await proposalsPOST(req("POST", `/api/briefs/${brief.id}/proposals`, { cookie: cookie("CLIENT", client.id), body }), params(brief.id))).status).toBe(403);
    const res = await proposalsPOST(req("POST", `/api/briefs/${brief.id}/proposals`, { cookie: cookie("FREELANCER", f.id), body }), params(brief.id));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "SENT", total: { amount_minor: 60_000 } });
  });
});

describe("client funding routes", () => {
  it("creates the PayPal order for the next milestone, places the hold after approval, and hides it from other clients", async () => {
    const f = await makeFreelancer();
    const c = await makeClient({ locale: "en-US", country: "US" });
    const { contract } = await makeContract(f.id, c.id, [{ amount_minor: 12_000, state: "AWAITING_FUNDING" }], { status: "DRAFT", currency: "USD", locale: "en-US" });
    vi.spyOn(paypal, "createOrder").mockResolvedValue({ id: "PP-R1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://sandbox/approve" });
    vi.spyOn(paypal, "authorizeOrder").mockResolvedValue({ paypalOrderId: "PP-R1", authorizationId: "AUTH-R1", status: "CREATED", currency: "USD", amountMinor: 12_000, expiresAt: null });

    const started = await fundPOST(req("POST", `/api/contracts/${contract.id}/fund`, { cookie: cookie("CLIENT", c.id) }), params(contract.id));
    expect(await started.json()).toMatchObject({ paypal_order_id: "PP-R1", approve_url: "https://sandbox/approve" });
    const captured = await capturePOST(req("POST", "/api/milestone-checkout/capture", { cookie: cookie("CLIENT", c.id), body: { paypal_order_id: "PP-R1" } }), undefined);
    expect(await captured.json()).toMatchObject({ milestone_state: "FUNDED", payment_status: "AUTHORIZED" });

    const mallory = await makeClient();
    expect((await capturePOST(req("POST", "/api/milestone-checkout/capture", { cookie: cookie("CLIENT", mallory.id), body: { paypal_order_id: "PP-R1" } }), undefined)).status).toBe(404);
    // A freelancer has no funding button at all.
    expect((await fundPOST(req("POST", `/api/contracts/${contract.id}/fund`, { cookie: cookie("FREELANCER", f.id) }), params(contract.id))).status).toBe(403);
  });

  it("reports a declined instrument so the UI restarts PayPal", async () => {
    const f = await makeFreelancer();
    const c = await makeClient({ locale: "en-US", country: "US" });
    const { contract } = await makeContract(f.id, c.id, [{ amount_minor: 12_000, state: "AWAITING_FUNDING" }], { status: "DRAFT", currency: "USD", locale: "en-US" });
    vi.spyOn(paypal, "createOrder").mockResolvedValue({ id: "PP-D", status: "PAYER_ACTION_REQUIRED", approveUrl: "u" });
    const { AppError } = await import("@/server/errors");
    vi.spyOn(paypal, "authorizeOrder").mockRejectedValue(new AppError("PAYMENT_DECLINED", "declined", { restart: true }));
    await fundPOST(req("POST", `/api/contracts/${contract.id}/fund`, { cookie: cookie("CLIENT", c.id) }), params(contract.id));
    const res = await capturePOST(req("POST", "/api/milestone-checkout/capture", { cookie: cookie("CLIENT", c.id), body: { paypal_order_id: "PP-D" } }), undefined);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: { code: "PAYMENT_DECLINED", details: { restart: true } } });
  });
});

describe("chat over SSE", () => {
  it("requires a session and validates input before streaming", async () => {
    const f = await makeFreelancer();
    expect((await chatPOST(req("POST", "/api/chat", { body: { text: "hi" } }))).status).toBe(401);
    const res = await chatPOST(req("POST", "/api/chat", { cookie: cookie("FREELANCER", f.id), body: { text: "x".repeat(4001) } }));
    expect(res.status).toBe(400);
    expect(script.requests).toHaveLength(0);
  });
});
