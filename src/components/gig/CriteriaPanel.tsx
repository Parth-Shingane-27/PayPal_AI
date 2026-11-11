"use client";

import { useEffect, useState } from "react";
import { api } from "../api";

type Criterion = {
  criterion_id: string;
  position: number;
  text: string;
  source: "AI" | "FREELANCER" | "CLIENT";
  status: "PENDING" | "PASSED" | "FAILED";
  signed_by_client: boolean;
  signed_by_freelancer: boolean;
  locked: boolean;
  verdict_note: string | null;
};

const SOURCE: Record<Criterion["source"], string> = { AI: "drafted by the assistant", FREELANCER: "added by the freelancer", CLIENT: "added by the client" };

/**
 * Pay on proof: the acceptance criteria of one milestone. Both sides sign them
 * before work starts; after delivery the client marks each one passed or failed.
 * The payment is captured only when every criterion has passed (or the
 * objection window closes with none failed). Nothing typed here is an
 * instruction to anyone: it is data the rules read.
 */
export function CriteriaPanel({ milestoneId, role, state, hasHold }: { milestoneId: string; role: "CLIENT" | "FREELANCER"; state: string; hasHold: boolean }) {
  const [items, setItems] = useState<Criterion[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ criteria: Criterion[] }>(`/api/milestones/${milestoneId}/criteria`)
      .then((r) => {
        if (!cancelled) setItems(r.criteria);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the criteria.");
      });
    return () => {
      cancelled = true;
    };
  }, [milestoneId, version]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const editable = state === "AWAITING_FUNDING" || state === "FUNDED";
  const judging = role === "CLIENT" && state === "DELIVERED";
  if (items === null) return null;
  if (items.length === 0 && !editable) return null;
  const mine = (c: Criterion) => (role === "CLIENT" ? c.signed_by_client : c.signed_by_freelancer);
  const needsMySignature = items.length > 0 && items.some((c) => !mine(c));

  return (
    <section className="mt-4 rounded-md border border-rule p-3" aria-label="Acceptance criteria">
      <h3 className="font-semibold">Acceptance criteria</h3>
      <p className="text-sm text-ink-3">
        {hasHold ? "The payment is on hold at PayPal and is not charged." : "Agree on how the work will be judged."} It is captured only when every criterion has passed, or the objection window closes with none failed.
      </p>
      {error && <p className="mt-2 rounded-md bg-alert-soft p-2 text-sm text-alert-ink">{error}</p>}
      {items.length > 0 && (
        <ol className="mt-3 space-y-2">
          {items.map((c) => (
            <li key={c.criterion_id} className="rounded-md bg-sheet-2 p-2 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span>
                  <span className="num text-ink-3">{c.position}.</span> {c.text}
                  <span className="block text-xs text-ink-3">
                    {SOURCE[c.source]} · client {c.signed_by_client ? "signed" : "not signed"} · freelancer {c.signed_by_freelancer ? "signed" : "not signed"}
                  </span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.status === "PASSED" ? "bg-positive-soft text-positive-ink" : c.status === "FAILED" ? "bg-alert-soft text-alert-ink" : "bg-sheet text-ink-3"}`}>
                  {c.status === "PASSED" ? "Passed" : c.status === "FAILED" ? "Failed" : "Pending"}
                </span>
              </div>
              {c.verdict_note && <p className="mt-1 text-xs text-ink-3">Client note: {c.verdict_note}</p>}
              {judging && c.locked && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={note[c.criterion_id] ?? ""}
                    onChange={(e) => setNote((n) => ({ ...n, [c.criterion_id]: e.target.value }))}
                    placeholder="What is missing? (needed to fail)"
                    maxLength={500}
                    className="min-h-9 flex-1 rounded-md border border-rule-strong bg-sheet px-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => api(`/api/criteria/${c.criterion_id}/verdict`, { body: { status: "PASSED", note: note[c.criterion_id] ?? null } }))}
                    className="min-h-9 rounded-md bg-positive px-3 text-sm font-semibold text-sheet disabled:opacity-50"
                  >
                    Pass
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => api(`/api/criteria/${c.criterion_id}/verdict`, { body: { status: "FAILED", note: note[c.criterion_id] ?? null } }))}
                    className="min-h-9 rounded-md border border-alert px-3 text-sm font-semibold text-alert-ink disabled:opacity-50"
                  >
                    Fail
                  </button>
                </div>
              )}
              {editable && !c.signed_by_client && !c.signed_by_freelancer && (
                <button type="button" disabled={busy} onClick={() => run(() => api(`/api/criteria/${c.criterion_id}`, { method: "DELETE" }))} className="mt-1 text-xs text-ink-3 underline">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="A checkable criterion, e.g. the signup form rejects an invalid email"
            maxLength={300}
            className="min-h-10 min-w-0 flex-1 rounded-md border border-rule-strong bg-sheet px-3 text-sm"
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() =>
              run(async () => {
                await api(`/api/milestones/${milestoneId}/criteria`, { body: { texts: [draft] } });
                setDraft("");
              })
            }
            className="min-h-10 rounded-md border border-rule-strong px-3 text-sm font-medium disabled:opacity-50"
          >
            Add criterion
          </button>
          {needsMySignature && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => api(`/api/milestones/${milestoneId}/criteria/sign`, { body: {} }))}
              className="min-h-10 rounded-md bg-accent px-3 text-sm font-semibold text-sheet disabled:opacity-50"
            >
              Sign the criteria
            </button>
          )}
        </div>
      )}
    </section>
  );
}
