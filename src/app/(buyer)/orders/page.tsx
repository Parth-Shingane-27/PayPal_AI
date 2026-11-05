"use client";

import { useEffect, useState } from "react";
import { api, type Money } from "@/components/api";

type Order = { order_id: string; created_at: string; status: string; seller: string; items: { title: string; quantity: number }[]; total: Money; refunded: Money };

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    void api<{ orders: Order[] }>("/api/orders").then((r) => setOrders(r.orders));
  }, []);
  return (
    <div>
      <h1 className="mb-3 text-xl font-semibold">Your orders</h1>
      {orders.length === 0 && <p className="text-sm text-slate-500">No orders yet.</p>}
      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.order_id} className="rounded-lg bg-white p-3 text-sm shadow-sm">
            <div className="flex gap-2">
              <span className="font-medium">{o.seller}</span>
              <span className="rounded bg-slate-100 px-1.5 text-xs">{o.status}</span>
              <span className="ml-auto font-semibold">{o.total.display}</span>
            </div>
            <p className="text-slate-600">{o.items.map((i) => `${i.quantity} × ${i.title}`).join(", ")}</p>
            <p className="text-xs text-slate-500">
              {new Date(o.created_at).toLocaleString()}
              {o.refunded.amount_minor > 0 && ` · refunded ${o.refunded.display}`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
