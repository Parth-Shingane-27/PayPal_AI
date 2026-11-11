"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBase } from "@/lib/use-base";
import type { MessageKey } from "@/lib/i18n/messages";
import { type DockAgent, chatStorageKey } from "./assistant/route-context";
import { RESUME_EVENT } from "./assistant/AssistantContext";
import { Markdown } from "./Markdown";
import { api, type Money } from "./api";
import { useI18n } from "./i18n/I18nProvider";
import { IconCheck } from "./icons";
import { PayPalButtons } from "./PayPalButtons";

type AgentName = "PROFILE" | "HIRING" | "TREASURY" | "PROJECTS";
type ToolCall = { id: string; name: string; ok: boolean; output?: unknown; error?: string; durationMs: number };
type Turn = {
  agent: AgentName;
  reply: string;
  outcome: string;
  toolCalls: ToolCall[];
  pendingApprovals: { approval_id: string; message?: string; amount?: Money; total_including_fees?: Money }[];
  /** A milestone the client can fund in PayPal. */
  checkoutLinks: { contract_id: string; milestone_id: string; paypal_order_id: string; approve_url: string; amount: Money }[];
  usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; thinking_tokens: number; modelCalls: number };
};
type ChatResult = { sessionId: string; agent: AgentName; routed: { agent: AgentName; reason: string } | null; turns: Turn[]; handoff: { from: AgentName; to: AgentName } | null };
type Step = { id: string; name: string; state: "running" | "ok" | "error" };

type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; agent?: AgentName; turn?: Turn }
  | { kind: "notice"; text: string; tone: "info" | "error" };

/** Tools that have a plain-words progress label (chat.step.<tool>); anything else shows a generic one. */
const STEP_TOOLS = [
  "list_markets",
  "get_fx_rate",
  "get_balances",
  "estimate_fees",
  "forecast_earnings",
  "propose_payout_schedule",
  "earnings_by_market",
  "detect_anomalies",
  "propose_refund",
  "handoff",
];

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

const field =
  "rounded-md border border-rule-strong bg-sheet text-ink placeholder:text-ink-3 focus:border-accent";

/**
 * The conversation inside the assistant panel: history, messages (rendered
 * markdown, streamed as they are written), progress while tools run, and the
 * composer. It has no title or frame of its own; the panel provides those.
 * Which agent it talks to, and which service or market it is scoped to, come
 * from the panel.
 */
export function ChatPanel(props: {
  agent: DockAgent;
  subjectId?: string;
  /** Extra scope for remembering the open conversation (the "new service" chat, a client's market). */
  resumeKey?: string;
  /** Client chats: PayPal client id for checkout buttons. */
  paypalClientId?: string | null;
  /** Called after each completed reply (e.g. to refresh service pages). */
  onResult?: () => void;
  /** Reports whether a reply is being written, so the panel can hold off switching agent. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const base = useBase();
  const { agent, onResult, onBusyChange } = props;
  const isClient = agent === "HIRING";
  // The freelancer's routing assistant sends no agent; clients never choose one.
  const apiAgent = agent === "ASSISTANT" || isClient ? null : agent;
  const agentLabel = (a: AgentName) => t(`dock.agent.${a}` as MessageKey);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  // The reply as it is being written. Text arrives in many small pieces; they are batched per frame.
  const [live, setLive] = useState("");
  const pending = useRef("");
  const frame = useRef<number | null>(null);
  const [past, setPast] = useState<{ id: string; agent: AgentName; updated_at: string }[]>([]);
  const [paid, setPaid] = useState<Record<string, { amount: string; status: string }>>({});
  const bottom = useRef<HTMLDivElement>(null);
  // The open conversation is remembered per chat, so leaving the page and coming back resumes it.
  const storageKey = chatStorageKey(agent, props.subjectId, props.resumeKey);
  const listQuery = isClient ? `?agent=${agent}` : apiAgent ? `?agent=${apiAgent}` : "";

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  const dropLive = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = "";
    setLive("");
  }, []);
  const pushDelta = useCallback((text: string) => {
    pending.current += text;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const chunk = pending.current;
      pending.current = "";
      setLive((cur) => cur + chunk);
    });
  }, []);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const loadPast = useCallback(async () => {
    const res = await api<{ sessions: { id: string; agent: AgentName; updated_at: string }[] }>(`/api/chat/sessions${listQuery}`);
    setPast(res.sessions);
  }, [listQuery]);

  const loadSession = useCallback(async (id: string, replaceTranscript: boolean) => {
    const res = await api<{ transcript: ({ role: "user" | "assistant"; text: string } | { role: "tool"; name: string })[] }>(`/api/chat/sessions/${id}`);
    if (replaceTranscript) {
      setEntries(res.transcript.flatMap((tr): Entry[] => (tr.role === "tool" ? [] : [{ kind: tr.role, text: tr.text }])));
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
  useEffect(() => {
    const onResume = (e: Event) => {
      const d = (e as CustomEvent<{ agent: string; sessionId: string }>).detail;
      if (!d || d.agent !== agent) return;
      setSessionId(d.sessionId);
      writeStored(storageKey, d.sessionId);
      loadSession(d.sessionId, true).catch(() => undefined);
    };
    window.addEventListener(RESUME_EVENT, onResume);
    return () => window.removeEventListener(RESUME_EVENT, onResume);
  }, [agent, storageKey, loadSession]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: live ? "auto" : "smooth", block: "nearest" });
  }, [entries, steps, live]);

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
        body: JSON.stringify({
          text,
          session_id: sessionId,
          agent: apiAgent,
          ...(agent === "PROFILE" ? { service_id: props.subjectId ?? null } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        throw new Error(err?.error?.message ?? t("chat.requestFailed", { status: res.status }));
      }
      for await (const { event, data } of sse(res)) {
        const d = data as Record<string, unknown>;
        // A new model turn starts: whatever was streaming belonged to the previous turn (e.g. text before a tool call).
        if (event === "model_call") dropLive();
        else if (event === "text_delta") pushDelta(String(d.text ?? ""));
        else if (event === "tool_started") setSteps((s) => [...s, { id: String(d.id), name: String(d.name), state: "running" }]);
        else if (event === "tool_finished") setSteps((s) => s.map((x) => (x.id === d.id ? { ...x, state: d.ok ? "ok" : "error" } : x)));
        else if (event === "routed") setEntries((e) => [...e, { kind: "notice", tone: "info", text: t("chat.passedTo", { agent: agentLabel(d.agent as AgentName) }) }]);
        else if (event === "handoff") setEntries((e) => [...e, { kind: "notice", tone: "info", text: t("chat.passedTo", { agent: agentLabel(d.to as AgentName) }) }]);
        else if (event === "error") setEntries((e) => [...e, { kind: "notice", tone: "error", text: String(d.message) }]);
        else if (event === "result") {
          const r = data as ChatResult;
          dropLive();
          setEntries((e) => [...e, ...r.turns.map((tn): Entry => ({ kind: "assistant", text: tn.reply, agent: tn.agent, turn: tn }))]);
          setSessionId(r.sessionId);
          writeStored(storageKey, r.sessionId);
          await loadSession(r.sessionId, false);
          await loadPast();
          onResult?.();
        }
      }
    } catch (err) {
      setEntries((e) => [...e, { kind: "notice", tone: "error", text: err instanceof Error ? err.message : t("chat.failed") }]);
    } finally {
      dropLive();
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
    <section aria-label={t("dock.chat")} className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
        <select
          aria-label={t("chat.history")}
          className={`${field} min-h-10 min-w-0 flex-1 px-2 text-sm`}
          value={sessionId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return newChat();
            setSessionId(id);
            writeStored(storageKey, id);
            void loadSession(id, true);
          }}
        >
          <option value="">{t("chat.new")}</option>
          {past.map((s) => (
            <option key={s.id} value={s.id}>
              {agentLabel(s.agent)} · {new Date(s.updated_at).toLocaleString()}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={newChat}
          disabled={busy || (entries.length === 0 && !sessionId)}
          className="inline-flex min-h-10 shrink-0 cursor-pointer items-center rounded-md border border-rule-strong px-3 text-sm font-medium text-ink-2 hover:bg-sheet-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("chat.newShort")}
        </button>
      </div>

      <div className="@container min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {entries.length === 0 && !busy && <p className="max-w-[44ch] text-sm leading-relaxed text-ink-3">{t(`dock.hint.${agent}` as MessageKey)}</p>}
        <div role="log" aria-live="polite" aria-relevant="additions" className="space-y-3">
          {entries.map((e, i) => {
            if (e.kind === "user")
              return (
                <p key={i} className="ml-auto max-w-[88%] rounded-lg bg-ink px-3 py-2 text-sm whitespace-pre-wrap text-sheet">
                  {e.text}
                </p>
              );
            if (e.kind === "notice")
              return (
                <p key={i} className={`rounded-md px-3 py-1.5 text-xs ${e.tone === "error" ? "bg-alert-soft text-alert-ink" : "bg-sheet-2 text-ink-2"}`}>
                  {e.text}
                </p>
              );
            const tn = e.turn;
            return (
              <div key={i} className="space-y-2">
                {e.agent && <p className="text-xs font-medium text-ink-3">{t("chat.assistantOf", { agent: agentLabel(e.agent) })}</p>}
                <Markdown text={e.text} className="rounded-lg bg-sheet-2 px-3 py-2 text-sm text-ink" />
                {tn?.pendingApprovals.map((a) => {
                  const amount = a.amount?.display ?? a.total_including_fees?.display;
                  return (
                    <div key={a.approval_id} className="rounded-md bg-gold-soft px-3 py-2 text-sm text-gold-ink">
                      {amount ? t("chat.approvalAmount", { amount }) : t("chat.approval")}{" "}
                      <Link className="font-semibold underline" href={`${base}/approvals`}>
                        {t("chat.reviewApprovals")}
                      </Link>
                    </div>
                  );
                })}
                {tn?.checkoutLinks.map((c) => {
                  const key = c.milestone_id;
                  const amount = c.amount;
                  const done = paid[key];
                  return done ? (
                    <p key={c.paypal_order_id} className="rounded-md bg-positive-soft px-3 py-2 text-sm text-positive-ink">
                      {t("chat.funded", { amount: done.amount, status: done.status })}
                    </p>
                  ) : (
                    <div key={c.paypal_order_id} className="rounded-md border border-rule bg-sheet p-3 text-sm">
                      <p className="mb-2 text-ink-2">{t("chat.approveMilestone", { amount: amount.display })}</p>
                      <PayPalButtons
                        clientId={props.paypalClientId ?? null}
                        currency={amount.currency}
                        contractId={c.contract_id}
                        paypalOrderId={c.paypal_order_id}
                        approveUrl={c.approve_url}
                        onPaid={(o) =>
                          setPaid((p) => ({
                            ...p,
                            [key]: { amount: o.amount.display, status: o.milestone_state },
                          }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {busy && (
          <ul className="space-y-1 text-xs text-ink-3" aria-label={t("chat.progress")}>
            {!live && (
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-ink-3 motion-reduce:animate-none" aria-hidden />
                {t("chat.thinking")}
              </li>
            )}
            {steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                {s.state === "ok" ? <IconCheck className="h-3.5 w-3.5 text-positive-ink" /> : <span className={`h-2 w-2 rounded-full ${s.state === "error" ? "bg-alert" : "animate-pulse bg-ink-3 motion-reduce:animate-none"}`} aria-hidden />}
                {t((STEP_TOOLS.includes(s.name) ? `chat.step.${s.name}` : "chat.step.default") as MessageKey)}
                {s.state === "running" ? "…" : ""}
              </li>
            ))}
          </ul>
        )}
        {busy && live && (
          // Hidden from screen readers while it grows; the finished reply is announced once, when it is added to the log.
          <div aria-hidden="true">
            <Markdown text={`${live} ▍`} className="rounded-lg bg-sheet-2 px-3 py-2 text-sm text-ink" />
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-rule p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className={`${field} max-h-40 min-h-11 flex-1 resize-none px-3 py-2.5 text-sm`}
          maxLength={4000}
          rows={2}
          value={input}
          aria-label={t("chat.input")}
          placeholder={t("chat.input")}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-md bg-accent px-4 text-sm font-semibold text-sheet hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || !input.trim()}>
          {t("chat.send")}
        </button>
      </form>
    </section>
  );
}
