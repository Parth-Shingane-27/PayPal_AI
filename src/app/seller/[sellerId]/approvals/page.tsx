"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Money } from "@/components/api";

type Approval = {
  id: string;
  status: string;
  agent: string | null;
  tool: string;
  rationale: string | null;
  error: string | null;
  created_at: string;
  decided_at: string | null;
  proposal: Record<string, unknown>;
  execution: Record<string, unknown> | null;
  refund: { order_id: string; buyer: string; status: string; reason: string; amount: Money; seller_debit: Money | null; error: string | null } | null;
  payouts: { id: string; status: string; date: string; amount: Money; fee: Money; fee_is_estimate: boolean; error: string | null }[] | null;
};

/** Proposals from the agents. Approving here is the only way money moves for a refund or payout. */
export default function ApprovalsPage() {
  const [items, setItems] = useState<Approval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(() => api<{ approvals: Approval[] }>("/api/approvals").then((r) => setItems(r.approvals)), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id);
    setMessage(null);
    try {
      const d = await api<{ status: string; error?: string | null; already_decided: boolean }>(`/api/approvals/${id}/${action}`, { method: "POST" });
      setMessage(d.already_decided ? `Already decided: ${d.status}.` : d.error ? `${d.status}: ${d.error}` : `${d.status}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
      await load();
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Approvals</h1>
      {message && <p className="rounded bg-slate-100 p-2 text-sm">{message}</p>}
      {items.length === 0 && <p className="text-sm text-slate-500">No proposals yet.</p>}
      {items.map((a) => (
        <article key={a.id} className="rounded-lg bg-white p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{a.refund ? "Refund" : "Payout schedule"}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{a.status}</span>
            <span className="text-xs text-slate-500">proposed by the {a.agent?.toLowerCase()} agent · {new Date(a.created_at).toLocaleString()}</span>
          </div>
          {a.refund && (
            <div className="mt-2">
              <p>
                {a.refund.amount.display} to {a.refund.buyer} for order <span className="font-mono text-xs">{a.refund.order_id}</span>
              </p>
              <p className="text-slate-600">Reason: {a.refund.reason}</p>
              <p className="text-slate-600">Refund status: {a.refund.status}{a.refund.seller_debit ? ` · debited from you ${a.refund.seller_debit.display}` : ""}</p>
            </div>
          )}
          {a.payouts && (
            <table className="mt-2 text-sm">
              <tbody>
                {a.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="pr-4">{p.date}</td>
                    <td className="pr-4">{p.amount.display}</td>
                    <td className="pr-4 text-slate-600">fee {p.fee.display}{p.fee_is_estimate ? " (est.)" : ""}</td>
                    <td className="pr-4">{p.status}</td>
                    <td className="text-red-700">{p.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {a.rationale && <p className="mt-2 text-slate-700">Agent&apos;s rationale: {a.rationale}</p>}
          {a.error && <p className="mt-2 text-red-700">Outcome: {a.error}</p>}
          {a.execution && <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(a.execution, null, 2)}</pre>}
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-slate-500">Full proposal</summary>
            <pre className="overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(a.proposal, null, 2)}</pre>
          </details>
          {a.status === "PENDING_APPROVAL" && (
            <div className="mt-3 flex gap-2">
              <button disabled={busy === a.id} className="rounded bg-accent px-4 py-1.5 text-white disabled:opacity-50" onClick={() => decide(a.id, "approve")}>
                Approve
              </button>
              <button disabled={busy === a.id} className="rounded border px-4 py-1.5 disabled:opacity-50" onClick={() => decide(a.id, "reject")}>
                Reject
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
