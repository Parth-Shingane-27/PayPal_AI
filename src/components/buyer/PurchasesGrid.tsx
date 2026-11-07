"use client";

import type { ColDef } from "ag-grid-community";
import { useEffect, useMemo, useState } from "react";
import { api, type Money as MoneyT } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { useBase } from "@/lib/use-base";
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
  const { t, locale } = useI18n();
  const base = useBase();
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<{ rows: PurchaseRow[] }>("/api/analytics/buyer/purchases").then(
      (r) => setRows(r.rows),
      (e: unknown) => setError(e instanceof Error ? e.message : t("purch.error")),
    );
  }, [t]);

  const cols = useMemo<ColDef<PurchaseRow>[]>(
    () => [
      productCol<PurchaseRow>("items", "image_url", (r) => `${r.seller}`, { headerName: t("col.purchase") }),
      dateCol<PurchaseRow>("date", t("col.date"), { sort: "desc", locale }),
      statusCol<PurchaseRow>("status", t),
      { field: "seller", headerName: t("col.maker"), width: 190 },
      countryCol<PurchaseRow>("seller_country", t("col.shipsFrom")),
      marketCol<PurchaseRow>("market", t("col.boughtIn")),
      moneyCol<PurchaseRow>("total", t("col.youPaid")),
      moneyCol<PurchaseRow>("refunded", t("col.refundedToYou"), { width: 150 }),
      moneyCol<PurchaseRow>("fees", t("col.feesConversion"), { tone: "muted", width: 170 }),
      moneyCol<PurchaseRow>("reached_maker", t("col.reachedMaker"), { tone: "net", width: 170 }),
      bpsCol<PurchaseRow>("reached_maker_bps", t("col.shareToMaker"), { digits: 0, width: 130 }),
      threadCol<PurchaseRow>("conversation_id", (id) => `${base}/messages?c=${id}`, t),
    ],
    [t, locale, base],
  );

  return (
    <>
      {error && (
        <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}
      <Grid<PurchaseRow>
        label={t("purch.label")}
        storageKey="buyer-purchases-v1"
        rowData={rows}
        columnDefs={cols}
        getRowId={(r) => r.order_id}
        exportName="my-purchases"
        searchHint={t("purch.search")}
        emptyMessage={t("purch.empty")}
        rowHeight={52}
        pageSize={pageSize}
      />
    </>
  );
}
