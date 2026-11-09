"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBase } from "@/lib/use-base";
import { api, type Money } from "./api";
import { type CaptureOutcome, PayPalButtons } from "./PayPalButtons";

type AgentName = "LISTING" | "SHOPPING" | "TREASURY" | "OPERATIONS";
type ToolCall = { id: string; name: string; ok: boolean; output?: unknown; error?: string; durationMs: number };
type Turn = {
  agent: AgentName;
  reply: string;
  outcome: string;
  toolCalls: ToolCall[];
  pendingApprovals: { approval_id: string; message?: string; amount?: Money; total_including_fees?: Money }[];
  checkoutLinks: { order_id: string; paypal_order_id: string; approve_url: string; total: Money }[];
  usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; thinking_tokens: number; modelCalls: number };
};
type ChatResult = { sessionId: string; agent: AgentName; routed: { agent: AgentName; reason: string } | null; turns: Turn[]; handoff: { from: AgentName; to: AgentName } | null };
type Step = { id: string; name: string; state: "running" | "ok" | "error" };
type Product = { listing_id: string; title: string; summary?: string; description?: string; price: Money; seller: string | { name: string } };

type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; agent?: AgentName; turn?: Turn }
  | { kind: "notice"; text: string; tone: "info" | "error" };

export const RESUME_EVENT = "gc:resume-chat";

const AGENT_LABEL: Record<AgentName, string> = { LISTING: "Listing", SHOPPING: "Shopping", TREASURY: "Money", OPERATIONS: "Operations" };

/** What each tool does, in plain words, for the progress list while the assistant works. */
const STEP_LABEL: Record<string, string> = {
  get_product: "Reading the product",
  preview_product: "Checking the product details",
  create_product: "Creating the product",
  list_markets: "Checking the markets",
  get_fx_rate: "Checking today's exchange rate",
  suggest_price: "Working out a local price",
  save_listing_draft: "Saving the draft listing",
  search_products: "Searching products",
  compare_products: "Comparing products",
  add_to_cart: "Adding to your cart",
  update_cart: "Updating your cart",
  view_cart: "Looking at your cart",
  create_paypal_order: "Preparing PayPal checkout",
  get_balances: "Checking your balance",
  estimate_fees: "Estimating fees",
  forecast_earnings: "Forecasting earnings",
  compare_selling_direct: "Comparing with selling direct",
  propose_payout_schedule: "Preparing a payout for your approval",
  query_orders: "Looking up orders",
  get_order_details: "Reading the order",
  get_payment_status: "Checking the payment",
  earnings_by_market: "Adding up earnings by country",
  detect_anomalies: "Checking for anything unusual",
  propose_refund: "Preparing a refund for your approval",
  handoff: "Passing you to the right assistant",
};

function productsOf(turn: Turn): Product[] {
  const out: Product[] = [];
  for (const c of turn.toolCalls) {
    if (!c.ok || !c.output) continue;
    const o = c.output as { results?: Product[]; listings?: Product[] };
    if (c.name === "search_products" && o.results) out.push(...o.results);
    if (c.name === "compare_products" && o.listings) out.push(...o.listings);
  }
  return [...new Map(out.map((p) => [p.listing_id, p])).values()];
}

/** localStorage can be unavailable (private mode, blocked storage); the chat then just starts fresh. */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Not remembering the conversation is acceptable.
  }
}

/** Parses a text/event-stream body into (event, data) pairs as they arrive. */
async function* sse(res: Response): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1];
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) };
    }
  }
}

export function ChatPanel(props: {
  title: string;
  placeholder: string;
  /** Seller screen agent; null routes through the Assistant classifier; omitted for buyers. */
  agent?: "LISTING" | "TREASURY" | "OPERATIONS" | null;
  productId?: string;
  /** Buyer chats: PayPal client id for checkout buttons. */
  paypalClientId?: string | null;
  /** Called after each completed reply (e.g. to refresh listings). */
  onResult?: () => void;
  /** Extra scope for remembering the open conversation (e.g. the buyer's market). */
  resumeKey?: string;
}) {
  const base = useBase();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [past, setPast] = useState<{ id: string; agent: AgentName; updated_at: string }[]>([]);
  const [paid, setPaid] = useState<Record<string, CaptureOutcome>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const isBuyer = props.agent === undefined;
  const { onResult } = props;
  // The open conversation is remembered per chat, so leaving the page and coming back resumes it.
  const storageKey = `globalcart.chat.${isBuyer ? "SHOPPING" : (props.agent ?? "ASSISTANT")}.${props.productId ?? "-"}.${props.resumeKey ?? "-"}`;

  const listQuery = props.agent ? `?agent=${props.agent}` : isBuyer ? "?agent=SHOPPING" : "";
  const loadPast = useCallback(async () => {
    const res = await api<{ sessions: { id: string; agent: AgentName; updated_at: string }[] }>(`/api/chat/sessions${listQuery}`);
    setPast(res.sessions);
  }, [listQuery]);

  const loadSession = useCallback(async (id: string, replaceTranscript: boolean) => {
    const res = await api<{ transcript: ({ role: "user" | "assistant"; text: string } | { role: "tool"; name: string })[] }>(`/api/chat/sessions/${id}`);
    if (replaceTranscript) {
      setEntries(res.transcript.flatMap((t): Entry[] => (t.role === "tool" ? [] : [{ kind: t.role, text: t.text }])));
    }
  }, []);

  useEffect(() => {
    void loadPast().catch(() => undefined);
  }, [loadPast]);

  useEffect(() => {
    const saved = readStored(storageKey);
    if (!saved) return;
    setSessionId(saved);
    // A conversation that no longer loads (deleted, or another user's) is forgotten.
    loadSession(saved, true).catch(() => {
      writeStored(storageKey, null);
      setSessionId(null);
      setEntries([]);
    });
  }, [storageKey, loadSession]);

  // "Discuss" on a finding: continue the conversation that wrote it.
  const agentProp = props.agent;
  useEffect(() => {
    const onResume = (e: Event) => {
      const d = (e as CustomEvent<{ agent: string; sessionId: string }>).detail;
      if (!d || d.agent !== agentProp) return;
      setSessionId(d.sessionId);
      writeStored(storageKey, d.sessionId);
      loadSession(d.sessionId, true).catch(() => undefined);
    };
    window.addEventListener(RESUME_EVENT, onResume);
    return () => window.removeEventListener(RESUME_EVENT, onResume);
  }, [agentProp, storageKey, loadSession]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [entries, steps]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setSteps([]);
    setEntries((e) => [...e, { kind: "user", text }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, session_id: sessionId, agent: props.agent ?? null, product_id: props.productId ?? null }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        throw new Error(err?.error?.message ?? `Request failed (${res.status})`);
      }
      for await (const { event, data } of sse(res)) {
        const d = data as Record<string, unknown>;
        if (event === "tool_started") setSteps((s) => [...s, { id: String(d.id), name: String(d.name), state: "running" }]);
        else if (event === "tool_finished")
          setSteps((s) => s.map((x) => (x.id === d.id ? { ...x, state: d.ok ? "ok" : "error" } : x)));
        else if (event === "routed") setEntries((e) => [...e, { kind: "notice", tone: "info", text: `Passed to the ${AGENT_LABEL[d.agent as AgentName]} assistant.` }]);
        else if (event === "handoff") setEntries((e) => [...e, { kind: "notice", tone: "info", text: `Passed to the ${AGENT_LABEL[d.to as AgentName]} assistant.` }]);
        else if (event === "error") setEntries((e) => [...e, { kind: "notice", tone: "error", text: String(d.message) }]);
        else if (event === "result") {
          const r = data as ChatResult;
          setEntries((e) => [...e, ...r.turns.map((t): Entry => ({ kind: "assistant", text: t.reply, agent: t.agent, turn: t }))]);
          setSessionId(r.sessionId);
          writeStored(storageKey, r.sessionId);
          await loadSession(r.sessionId, false);
          await loadPast();
          onResult?.();
        }
      }
    } catch (err) {
      setEntries((e) => [...e, { kind: "notice", tone: "error", text: err instanceof Error ? err.message : "Something went wrong." }]);
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    writeStored(storageKey, null);
    setSessionId(null);
    setEntries([]);
    setSteps([]);
  }

  return (
    <section className="flex min-h-[32rem] flex-col rounded-lg border border-slate-200 bg-white">
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
          <h2 className="font-semibold">{props.title}</h2>
          <select
            className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs"
            value={sessionId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return newChat();
              setSessionId(id);
              writeStored(storageKey, id);
              void loadSession(id, true);
            }}
          >
            <option value="">New conversation</option>
            {past.map((s) => (
              <option key={s.id} value={s.id}>
                {AGENT_LABEL[s.agent]} · {new Date(s.updated_at).toLocaleString()}
              </option>
            ))}
          </select>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {entries.length === 0 && <p className="text-sm text-slate-500">{props.placeholder}</p>}
          {entries.map((e, i) => {
            if (e.kind === "user") return <p key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">{e.text}</p>;
            if (e.kind === "notice")
              return (
                <p key={i} className={`rounded px-3 py-1.5 text-xs ${e.tone === "error" ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-600"}`}>
                  {e.text}
                </p>
              );
            const t = e.turn;
            const products = t ? productsOf(t) : [];
            return (
              <div key={i} className="max-w-[95%] space-y-2">
                {e.agent && <p className="text-xs font-medium text-slate-500">{AGENT_LABEL[e.agent]} assistant</p>}
                <div className="whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 text-sm">{e.text}</div>
                {products.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {products.map((p) => (
                      <div key={p.listing_id} className="rounded border border-slate-200 p-2 text-sm">
                        <p className="font-medium">{p.title}</p>
                        <p className="text-slate-600">{typeof p.seller === "string" ? p.seller : p.seller.name}</p>
                        <p className="font-semibold">{p.price.display}</p>
                        <p className="line-clamp-3 text-xs text-slate-500">{p.summary ?? p.description}</p>
                      </div>
                    ))}
                  </div>
                )}
                {t?.pendingApprovals.map((a) => (
                  <div key={a.approval_id} className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
                    Waiting for your approval{a.amount ? `: ${a.amount.display}` : a.total_including_fees ? `: ${a.total_including_fees.display}` : ""}.{" "}
                    <Link className="text-blue-700 underline" href={`${base}/approvals`}>
                      Review on the Approvals page
                    </Link>
                  </div>
                ))}
                {t?.checkoutLinks.map((c) =>
                  paid[c.order_id] ? (
                    <p key={c.paypal_order_id} className="rounded bg-positive-soft p-2 text-sm text-positive-ink">
                      Paid: {paid[c.order_id]!.total.display}. Order status {paid[c.order_id]!.order_status}.
                    </p>
                  ) : (
                    <div key={c.paypal_order_id} className="rounded border border-blue-200 bg-blue-50 p-3 text-sm">
                      <p className="mb-2">Approve {c.total.display} in PayPal. Nothing is charged until you do.</p>
                      <PayPalButtons
                        clientId={props.paypalClientId ?? null}
                        currency={c.total.currency}
                        cartId={c.order_id}
                        paypalOrderId={c.paypal_order_id}
                        approveUrl={c.approve_url}
                        onPaid={(o) => setPaid((p) => ({ ...p, [c.order_id]: o }))}
                      />
                    </div>
                  ),
                )}
              </div>
            );
          })}
          {busy && (
            <ul className="space-y-1 text-xs text-slate-600">
              <li>Thinking…</li>
              {steps.map((s) => (
                <li key={s.id}>
                  {s.state === "running" ? "⏳" : "✓"} {STEP_LABEL[s.name] ?? "Working on it"}
                  {s.state === "running" ? "…" : ""}
                </li>
              ))}
            </ul>
          )}
          <div ref={bottom} />
        </div>

        <form
          className="flex gap-2 border-t border-slate-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            className="min-h-[2.5rem] flex-1 resize-y rounded border border-slate-300 px-3 py-2 text-sm"
            maxLength={4000}
            rows={2}
            value={input}
            placeholder="Type a message…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="rounded bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
    </section>
  );
}
