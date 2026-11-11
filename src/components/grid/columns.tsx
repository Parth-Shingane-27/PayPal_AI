"use client";

import type { ColDef, ValueFormatterParams, ValueGetterParams } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import Link from "next/link";
import { compareMoney, formatBps, formatCount, formatDate, type MoneyLike } from "@/lib/format";
import type { Translate } from "@/lib/i18n/core";
import type { MessageKey } from "@/lib/i18n/messages";
import { IconMessages } from "../icons";
import { CountryStamp, FeeBar, MarketStamp, Money, Sparkline, StatusStamp } from "../ui";

/**
 * Column builders shared by the grids. Money cells keep the
 * Money object as the value (exact minor units for sorting and CSV) and show
 * the server-formatted display string.
 */

type Row = Record<string, unknown>;

export function moneyCol<T extends Row>(field: keyof T & string, headerName: string, opts: Partial<ColDef<T>> & { tone?: "net" | "fee" | "muted"; estimateField?: keyof T & string } = {}): ColDef<T> {
  const { tone, estimateField, ...rest } = opts;
  return {
    field: field as ColDef<T>["field"],
    headerName,
    type: "rightAligned",
    width: 130,
    comparator: (a: MoneyLike | null, b: MoneyLike | null) => compareMoney(a, b),
    valueFormatter: (p: ValueFormatterParams<T, MoneyLike>) => p.value?.display ?? "",
    getQuickFilterText: (p) => (p.value as MoneyLike | undefined)?.display ?? "",
    filter: "agNumberColumnFilter",
    filterValueGetter: (p: ValueGetterParams<T>) => {
      const m = p.data?.[field] as MoneyLike | undefined;
      if (!m) return null;
      return m.amount_minor / 10 ** (m.currency === "JPY" ? 0 : 2);
    },
    cellRenderer: (p: CustomCellRendererProps<T, MoneyLike>) => (
      <Money value={p.value} tone={tone} estimate={estimateField ? Boolean(p.data?.[estimateField]) && !p.node.rowPinned : false} />
    ),
    ...rest,
  };
}

export function dateCol<T extends Row>(field: keyof T & string, headerName: string, opts: Partial<ColDef<T>> & { locale?: string } = {}): ColDef<T> {
  const { locale = "en-GB", ...rest } = opts;
  return {
    field: field as ColDef<T>["field"],
    headerName,
    width: 156,
    filter: "agDateColumnFilter",
    filterValueGetter: (p: ValueGetterParams<T>) => {
      const v = p.data?.[field];
      if (typeof v !== "string") return null;
      const d = new Date(v);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    },
    valueFormatter: (p: ValueFormatterParams<T, string>) => formatDate(p.value, locale),
    getQuickFilterText: (p) => formatDate(p.value as string, locale),
    cellClass: "num",
    ...rest,
  };
}

export function marketCol<T extends Row>(field: keyof T & string, headerName = "Market", opts: Partial<ColDef<T>> = {}): ColDef<T> {
  return {
    field: field as ColDef<T>["field"],
    headerName,
    width: 150,
    cellRenderer: (p: CustomCellRendererProps<T, string>) => (p.value ? <MarketStamp locale={p.value} /> : null),
    ...opts,
  };
}

export function countryCol<T extends Row>(field: keyof T & string, headerName = "Country", opts: Partial<ColDef<T>> = {}): ColDef<T> {
  return {
    field: field as ColDef<T>["field"],
    headerName,
    width: 110,
    cellRenderer: (p: CustomCellRendererProps<T, string>) => (p.value ? <CountryStamp country={p.value} /> : null),
    ...opts,
  };
}

export function statusCol<T extends Row>(field: keyof T & string, t: Translate, opts: Partial<ColDef<T>> = {}): ColDef<T> {
  const label = (v: string | undefined) => (v ? t(`status.${v}` as MessageKey) : "");
  return {
    field: field as ColDef<T>["field"],
    headerName: t("col.status"),
    width: 160,
    valueFormatter: (p: ValueFormatterParams<T, string>) => label(p.value ?? undefined),
    getQuickFilterText: (p) => label(p.value as string),
    cellRenderer: (p: CustomCellRendererProps<T, string>) => (p.value ? <StatusStamp status={p.value} /> : null),
    ...opts,
  };
}

export function countCol<T extends Row>(field: keyof T & string, headerName: string, opts: Partial<ColDef<T>> = {}): ColDef<T> {
  return {
    field: field as ColDef<T>["field"],
    headerName,
    type: "rightAligned",
    width: 104,
    filter: "agNumberColumnFilter",
    valueFormatter: (p: ValueFormatterParams<T, number>) => (typeof p.value === "number" ? formatCount(p.value) : ""),
    cellClass: ["num", "ag-right-aligned-cell"],
    ...opts,
  };
}

export function bpsCol<T extends Row>(field: keyof T & string, headerName: string, opts: Partial<ColDef<T>> & { digits?: number } = {}): ColDef<T> {
  const { digits = 1, ...rest } = opts;
  return {
    field: field as ColDef<T>["field"],
    headerName,
    type: "rightAligned",
    width: 116,
    filter: "agNumberColumnFilter",
    filterValueGetter: (p: ValueGetterParams<T>) => {
      const v = p.data?.[field];
      return typeof v === "number" ? v / 100 : null;
    },
    valueFormatter: (p: ValueFormatterParams<T, number>) => (typeof p.value === "number" ? formatBps(p.value, digits) : ""),
    cellClass: ["num", "ag-right-aligned-cell"],
    ...rest,
  };
}

export function sparkCol<T extends Row>(field: keyof T & string, headerName: string, label: (row: T) => string): ColDef<T> {
  return {
    field: field as ColDef<T>["field"],
    headerName,
    width: 150,
    sortable: false,
    filter: false,
    valueFormatter: (p: ValueFormatterParams<T, number[]>) => (Array.isArray(p.value) ? p.value.join(" ") : ""),
    cellClass: "cell-overflow",
    cellRenderer: (p: CustomCellRendererProps<T, number[]>) =>
      p.value && p.data && !p.node.rowPinned ? (
        <span className="flex h-full items-center">
          <Sparkline values={p.value} label={label(p.data)} width={90} height={26} />
        </span>
      ) : null,
  };
}

/** Mini fee anatomy for one sale. */
export function feeBarCol<T extends Row>(get: (row: T) => { gross: number; net: number; paypal: number; platform: number; fx: number; refund: number } | null, t: Translate): ColDef<T> {
  return {
    colId: "anatomy",
    headerName: t("col.whereWent"),
    width: 170,
    sortable: false,
    filter: false,
    headerTooltip: t("cell.whereWentTip"),
    cellRenderer: (p: CustomCellRendererProps<T>) => {
      const v = p.data && !p.node.rowPinned ? get(p.data) : null;
      if (!v) return null;
      return (
        <span className="flex h-full items-center">
          <FeeBar gross={v.gross} parts={v} />
        </span>
      );
    },
  };
}

export function threadCol<T extends Row>(field: keyof T & string, href: (id: string) => string, t: Translate): ColDef<T> {
  return {
    field: field as ColDef<T>["field"],
    headerName: t("col.thread"),
    width: 96,
    sortable: false,
    filter: false,
    cellRenderer: (p: CustomCellRendererProps<T, string | null>) =>
      p.value ? (
        <Link href={href(p.value)} className="inline-flex min-h-8 items-center gap-1 text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
          <IconMessages className="h-4 w-4" />
          <span>{t("cell.open")}</span>
        </Link>
      ) : null,
  };
}
