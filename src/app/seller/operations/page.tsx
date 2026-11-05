"use client";

import { useEffect, useState } from "react";
import { api, decimalOf, type Money } from "@/components/api";
import { AskAi } from "@/components/AskAi";
import { ChatPanel } from "@/components/ChatPanel";

type OrderRow = { order_id: string; created_at: string; status: string; market: string; buyer: string; items: string[]; total: Money };
type Details = {
  order_id: string;
  status: string;
  payments: { status: string; gross: Money; paypal_fee: Money | null; paypal_fee_is_estimate: boolean; platform_fee: Money | null; fx_cost: Money | null; net_to_seller: Money | null; failure_reason: string | null }[];
  refunds: { refund_id: string; status: string; reason: string; amount: Money; seller_debit: Money | null }[];
  payment_status: { still_refundable: Money };
};

/** Refund with one click: the amount defaults to everything still refundable. */
function RefundForm({ details, onDone }: { details: Details; onDone: () => void }) {
  const refundable = details.payment_status.still_refundable;
  const [amount, setAmount] = useState(decimalOf(refundable));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (refundable.amount_minor <= 0) return null;

  async function refund(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm(`Refund ${amount} ${refundable.currency} to the buyer through PayPal now?`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await api<{ status: string; error?: string | null }>(`/api/orders/${details.order_id}/refund`, { body: { amount, reason } });
      setNotice(r.status === "EXECUTED" ? { tone: "ok", text: "Refund sent to PayPal." } : { tone: "error", text: r.error ?? `The refund did not go through (${r.status}).` });
      onDone();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "The refund did not go through." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-3 space-y-2 rounded border border-slate-200 p-2" onSubmit={refund}>
      <p className="font-semibold">Refund this order</p>
      <label className="flex items-center gap-2 text-xs">
        Amount ({refundable.currency})
        <input className="w-28 rounded border border-slate-300 px-2 py-1 text-sm" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </label>
      <input className="w-full rounded border border-slate-300 px-2 py-1 text-sm" placeholder="Reason, e.g. arrived damaged" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} />
      <button className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !reason.trim()}>
        {busy ? "Refunding…" : "Refund"}
      </button>
      {notice && <p className={`rounded p-2 text-xs ${notice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{notice.text}</p>}
    </form>
  );
}

export default function OperationsPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [selected, setSelected] = useState<Details | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    void api<{ orders: OrderRow[] }>("/api/orders").then((r) => setOrders(r.orders));
  }, [tick]);
  const open = (orderId: string) => void api<Details>(`/api/orders/${orderId}`).then(setSelected);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <section>
          <h1 className="mb-2 text-xl font-semibold">Orders</h1>
          <table className="w-full rounded-lg bg-white text-sm shadow-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Market</th>
                <th className="p-2">Buyer</th>
                <th className="p-2">Items</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.order_id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-blue-50"
                  onClick={() => open(o.order_id)}
                >
                  <td className="p-2">{new Date(o.created_at).toLocaleDateString()}</td>
                  <td className="p-2">{o.market}</td>
                  <td className="p-2">{o.buyer}</td>
                  <td className="p-2">{o.items.join(", ")}</td>
                  <td className="p-2">{o.status}</td>
                  <td className="p-2 text-right">{o.total.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="rounded-lg bg-white p-3 text-sm shadow-sm">
          {selected ? (
            <>
              <p className="font-mono text-xs">{selected.order_id}</p>
              <p className="font-semibold">{selected.status}</p>
              <h3 className="mt-2 font-semibold">Payments</h3>
              {selected.payments.map((p, i) => (
                <p key={i} className="text-slate-700">
                  {p.status}: {p.gross.display}
                  {p.net_to_seller && ` → net ${p.net_to_seller.display} (PayPal ${p.paypal_fee?.display}${p.paypal_fee_is_estimate ? " est." : ""}, platform ${p.platform_fee?.display}, FX ${p.fx_cost?.display})`}
                  {p.failure_reason && ` · ${p.failure_reason}`}
                </p>
              ))}
              <h3 className="mt-2 font-semibold">Refunds</h3>
              {selected.refunds.length === 0 && <p className="text-slate-500">None</p>}
              {selected.refunds.map((r) => (
                <p key={r.refund_id} className="text-slate-700">
                  {r.status}: {r.amount.display} — {r.reason}
                </p>
              ))}
              <p className="mt-2">Still refundable: {selected.payment_status.still_refundable.display}</p>
              <RefundForm
                key={`${selected.order_id}-${selected.payment_status.still_refundable.amount_minor}`}
                details={selected}
                onDone={() => {
                  open(selected.order_id);
                  setTick((t) => t + 1);
                }}
              />
            </>
          ) : (
            <p className="text-slate-500">Click an order to see its payments and refunds.</p>
          )}
        </section>
      </div>
      <AskAi label="Ask the operations assistant" hint="For questions, e.g. what you earned in Germany last month, or whether anything looks unusual.">
        <ChatPanel
          title="Operations Agent"
          agent="OPERATIONS"
          placeholder='Try: "What did I earn in Germany last month?", "Why was my last Japanese order refunded?" or "Anything unusual?"'
          onResult={() => setTick((t) => t + 1)}
        />
      </AskAi>
    </div>
  );
}
