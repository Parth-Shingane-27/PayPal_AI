"use client";

import type { ColDef } from "ag-grid-community";
import { useEffect, useMemo, useState } from "react";
import { api, type Money as MoneyT } from "../api";
import { Grid } from "../grid/Grid";
import { bpsCol, countryCol, dateCol, marketCol, moneyCol, productCol, statusCol, threadCol } from "../grid/columns";

export type PurchaseRow = {
  order_id: string;
  date: string;
  status: string;
  seller: string;
  seller_id: string;
  seller_country: string;
  market: string;
  items: string;
  image_url: string | null;
  units: number;
  total: MoneyT;
  refunded: MoneyT;
  fees: MoneyT;
  reached_maker: MoneyT;
  reached_maker_bps: number;
  conversation_id: string | null;
};

/** Every purchase, with how much of the price reached the maker after fees. */
export function PurchasesGrid({ pageSize = 20 }: { pageSize?: number }) {
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<{ rows: PurchaseRow[] }>("/api/analytics/buyer/purchases").then(
      (r) => setRows(r.rows),
      (e: unknown) => setError(e instanceof Error ? e.message : "Your orders could not be loaded."),
    );
  }, []);

  const cols = useMemo<ColDef<PurchaseRow>[]>(
    () => [
      productCol<PurchaseRow>("items", "image_url", (r) => `${r.seller}`, { headerName: "Purchase" }),
      dateCol<PurchaseRow>("date", "Date", { sort: "desc" }),
      statusCol<PurchaseRow>("status"),
      { field: "seller", headerName: "Maker", width: 190 },
      countryCol<PurchaseRow>("seller_country", "Ships from"),
      marketCol<PurchaseRow>("market", "Bought in"),
      moneyCol<PurchaseRow>("total", "You paid"),
      moneyCol<PurchaseRow>("refunded", "Refunded to you", { width: 150 }),
      moneyCol<PurchaseRow>("fees", "Fees and conversion", { tone: "muted", width: 170 }),
      moneyCol<PurchaseRow>("reached_maker", "Reached the maker", { tone: "net", width: 170 }),
      bpsCol<PurchaseRow>("reached_maker_bps", "Share to maker", { digits: 0, width: 130 }),
      threadCol<PurchaseRow>("conversation_id", (id) => `/buyer/messages?c=${id}`),
    ],
    [],
  );

  return (
    <>
      {error && (
        <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}
      <Grid<PurchaseRow>
        label="Your purchases"
        storageKey="buyer-purchases-v1"
        rowData={rows}
        columnDefs={cols}
        getRowId={(r) => r.order_id}
        exportName="my-purchases"
        searchHint="maker, product or country"
        emptyMessage="No purchases yet. Find something in the shop."
        rowHeight={52}
        pageSize={pageSize}
      />
    </>
  );
}
