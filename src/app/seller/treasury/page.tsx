"use client";

import { useEffect, useState } from "react";
import { api, type Money } from "@/components/api";
import { AskAi } from "@/components/AskAi";
import { ChatPanel } from "@/components/ChatPanel";

type Balance = { currency: string; earned: Money; refunded: Money; paid_out: Money; reserved_for_scheduled_payouts: Money; available: Money };
type MarketRow = { market: string; currency: string; orders: number; gross_sales: Money; paypal_fees: Money; platform_fees: Money; fx_costs: Money; net_earnings: Money; refund_debits: Money; net_after_refunds: Money };
const PERIODS = ["this_month", "last_month", "last_7_days", "last_30_days", "last_90_days", "year_to_date", "all_time"];

export default function TreasuryPage() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [period, setPeriod] = useState("last_30_days");
  const [earnings, setEarnings] = useState<{ period: { label: string }; markets: MarketRow[] } | null>(null);
  const [tick, setTick] = useState(0);
  const [paying, setPaying] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function payOut(b: Balance) {
    if (!window.confirm(`Send ${b.available.display} (minus the PayPal payout fee) to your PayPal account now?`)) return;
    setPaying(b.currency);
    setNotice(null);
    try {
      const r = await api<{ status: string; error?: string | null }>("/api/payouts", { body: { currency: b.currency } });
      setNotice(
        r.status === "EXECUTED"
          ? { tone: "ok", text: `Payout of ${b.currency} started. It shows as paid out once PayPal confirms it, usually within a minute.` }
          : { tone: "error", text: r.error ?? `The payout could not be started (${r.status}).` },
      );
      setTick((t) => t + 1);
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "The payout could not be started." });
    } finally {
      setPaying(null);
    }
  }

  useEffect(() => {
    void api<{ balances: Balance[] }>("/api/balances").then((r) => setBalances(r.balances));
  }, [tick]);
  useEffect(() => {
    void api<{ period: { label: string }; markets: MarketRow[] }>(`/api/earnings?period=${period}`).then(setEarnings);
  }, [period, tick]);

  const cell = "p-2 text-right";
  return (
    <div className="space-y-6">
      <section>
        <h1 className="mb-2 text-xl font-semibold">Balances</h1>
        {notice && <p className={`mb-2 rounded p-2 text-sm ${notice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{notice.text}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {balances.length === 0 && <p className="text-sm text-slate-500">No captured sales yet.</p>}
          {balances.map((b) => (
            <div key={b.currency} className="rounded-lg bg-white p-4 text-sm shadow-sm">
              <p className="text-xs text-slate-500">{b.currency} available</p>
              <p className="text-2xl font-semibold">{b.available.display}</p>
              <p className="mt-2 text-slate-600">
                Earned {b.earned.display} · refunded {b.refunded.display} · paid out {b.paid_out.display} · reserved {b.reserved_for_scheduled_payouts.display}
              </p>
              <button
                className="mt-3 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                disabled={paying !== null || b.available.amount_minor <= 0}
                onClick={() => payOut(b)}
              >
                {paying === b.currency ? "Sending…" : "Pay out now"}
              </button>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-semibold">Earnings by market</h2>
          <select className="rounded border border-slate-300 px-2 py-1 text-sm" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">{earnings?.period.label}</span>
        </div>
        <table className="w-full rounded-lg bg-white text-sm shadow-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="p-2 text-left">Market</th>
              <th className={cell}>Orders</th>
              <th className={cell}>Gross</th>
              <th className={cell}>PayPal fees</th>
              <th className={cell}>Platform fees</th>
              <th className={cell}>FX</th>
              <th className={cell}>Net</th>
              <th className={cell}>Refunds</th>
              <th className={cell}>Net after refunds</th>
            </tr>
          </thead>
          <tbody>
            {earnings?.markets.map((m) => (
              <tr key={`${m.market}-${m.currency}`} className="border-t border-slate-100">
                <td className="p-2">{m.market}</td>
                <td className={cell}>{m.orders}</td>
                <td className={cell}>{m.gross_sales.display}</td>
                <td className={cell}>{m.paypal_fees.display}</td>
                <td className={cell}>{m.platform_fees.display}</td>
                <td className={cell}>{m.fx_costs.display}</td>
                <td className={cell}>{m.net_earnings.display}</td>
                <td className={cell}>{m.refund_debits.display}</td>
                <td className={`${cell} font-semibold`}>{m.net_after_refunds.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <AskAi label="Ask the money assistant" hint="For advice, e.g. when to take a payout, a forecast, or fees compared with selling direct.">
        <ChatPanel
          title="Treasury Agent"
          agent="TREASURY"
          placeholder='Try: "When should I take a payout?" or "Compare GlobalCart with selling direct for my Japanese listing."'
          onResult={() => setTick((t) => t + 1)}
        />
      </AskAi>
    </div>
  );
}
