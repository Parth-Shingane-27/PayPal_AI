"use client";

import {
  AllCommunityModule,
  type ColDef,
  type ColumnState,
  type GetRowIdParams,
  type GridApi,
  type GridReadyEvent,
  ModuleRegistry,
  type RowClickedEvent,
  themeQuartz,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { clearGridState, loadGridState, saveGridState } from "@/lib/grid-state";
import { useI18n, useT } from "../i18n/I18nProvider";
import { IconColumns, IconDownload, IconSearch } from "../icons";

/** AG Grid's own pagination and filter words, per interface language. */
const AG_LOCALE: Record<string, Record<string, string>> = {
  hi: { page: "पेज", of: "में से", to: "से", pageSizeSelectorLabel: "पेज आकार:", noRowsToShow: "कोई पंक्ति नहीं", loadingOoo: "लोड हो रहा है…", filterOoo: "छाँटें…", contains: "शामिल", equals: "बराबर", applyFilter: "लागू करें", resetFilter: "रीसेट" },
  ja: { page: "ページ", of: "/", to: "〜", pageSizeSelectorLabel: "表示件数:", noRowsToShow: "表示する行がありません", loadingOoo: "読み込み中…", filterOoo: "絞り込み…", contains: "含む", equals: "等しい", applyFilter: "適用", resetFilter: "リセット" },
  de: { page: "Seite", of: "von", to: "bis", pageSizeSelectorLabel: "Zeilen pro Seite:", noRowsToShow: "Keine Zeilen", loadingOoo: "Wird geladen…", filterOoo: "Filtern…", contains: "Enthält", equals: "Gleich", applyFilter: "Anwenden", resetFilter: "Zurücksetzen" },
  fr: { page: "Page", of: "sur", to: "à", pageSizeSelectorLabel: "Lignes par page :", noRowsToShow: "Aucune ligne", loadingOoo: "Chargement…", filterOoo: "Filtrer…", contains: "Contient", equals: "Égal à", applyFilter: "Appliquer", resetFilter: "Réinitialiser" },
  es: { page: "Página", of: "de", to: "a", pageSizeSelectorLabel: "Filas por página:", noRowsToShow: "Sin filas", loadingOoo: "Cargando…", filterOoo: "Filtrar…", contains: "Contiene", equals: "Igual a", applyFilter: "Aplicar", resetFilter: "Restablecer" },
  it: { page: "Pagina", of: "di", to: "a", pageSizeSelectorLabel: "Righe per pagina:", noRowsToShow: "Nessuna riga", loadingOoo: "Caricamento…", filterOoo: "Filtra…", contains: "Contiene", equals: "Uguale a", applyFilter: "Applica", resetFilter: "Reimposta" },
};

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * The grid theme reads the same CSS tokens as the rest of the app, so it
 * follows light/dark switches with no JavaScript.
 */
const gridTheme = themeQuartz.withParams({
  backgroundColor: "var(--sheet)",
  foregroundColor: "var(--ink)",
  textColor: "var(--ink)",
  subtleTextColor: "var(--ink-3)",
  borderColor: "var(--rule)",
  chromeBackgroundColor: "var(--sheet-2)",
  headerBackgroundColor: "var(--sheet-2)",
  headerTextColor: "var(--ink-2)",
  accentColor: "var(--accent)",
  rowHoverColor: "var(--accent-soft)",
  selectedRowBackgroundColor: "var(--accent-soft)",
  oddRowBackgroundColor: "var(--sheet)",
  fontFamily: "var(--font-sans)",
  headerFontFamily: "var(--font-sans)",
  fontSize: 14,
  headerFontSize: 13,
  headerFontWeight: 600,
  spacing: 7,
  wrapperBorderRadius: 10,
  borderRadius: 2,
  rowBorder: { color: "var(--rule)" },
  columnBorder: false,
  headerColumnBorder: false,
  headerColumnResizeHandleColor: "var(--rule-strong)",
  browserColorScheme: "inherit",
  focusShadow: { radius: 0, spread: 2, color: "var(--focus)" },
  inputFocusBorder: { color: "var(--focus)", width: 2 },
  menuBackgroundColor: "var(--sheet)",
  menuTextColor: "var(--ink)",
});

export type DataGridProps<T> = {
  /** localStorage key for the saved layout. Bump when columns change shape. */
  storageKey: string;
  rowData: T[] | null;
  columnDefs: ColDef<T>[];
  getRowId: (row: T) => string;
  onRowClicked?: (row: T) => void;
  /** Rows summarised in a pinned footer, recomputed from the filtered rows. */
  totals?: (rows: T[]) => Partial<T> | null;
  exportName: string;
  /** Words for the quick filter placeholder, e.g. "buyer, product, market". */
  searchHint: string;
  emptyMessage: string;
  pageSize?: number;
  rowHeight?: number;
  toolbar?: React.ReactNode;
  /** Accessible name for the grid region. */
  label: string;
  /** Extra filter driven by controls outside the grid (e.g. status chips). */
  externalFilter?: ((row: T) => boolean) | null;
};

function ColumnChooser<T>({ api }: { api: GridApi<T> | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const cols = api?.getColumns()?.filter((c) => c.getColDef().headerName) ?? [];
  return (
    <div className="relative" ref={ref}>
      <button type="button" className={toolButton} aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={!api}>
        <IconColumns />
        <span>{t("grid.columns")}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-80 w-60 overflow-y-auto rounded-[10px] border border-rule bg-sheet p-2 shadow-[var(--shadow-overlay)]">
          {cols.map((c) => (
            <label key={c.getColId()} className="flex min-h-10 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-sheet-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={c.isVisible()}
                disabled={c.getColDef().lockVisible}
                onChange={(e) => {
                  api?.setColumnsVisible([c.getColId()], e.target.checked);
                  force((n) => n + 1);
                }}
              />
              {c.getColDef().headerName}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const toolButton =
  "inline-flex min-h-10 items-center gap-1.5 rounded-md border border-rule bg-sheet px-3 text-sm font-medium text-ink-2 hover:border-rule-strong hover:text-ink disabled:opacity-50";

export default function DataGrid<T>(props: DataGridProps<T>) {
  const { t, lang } = useI18n();
  const { storageKey, rowData, columnDefs, totals, exportName } = props;
  const [api, setApi] = useState<GridApi<T> | null>(null);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<number | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const searchId = useId();
  const externalRef = useRef(props.externalFilter ?? null);

  useEffect(() => {
    externalRef.current = props.externalFilter ?? null;
    api?.onFilterChanged();
  }, [api, props.externalFilter]);

  const defaultColDef = useMemo<ColDef<T>>(() => ({ sortable: true, resizable: true, filter: true, suppressHeaderMenuButton: false, minWidth: 90 }), []);

  const refreshFooter = useCallback(
    (gridApi: GridApi<T>) => {
      const rows: T[] = [];
      gridApi.forEachNodeAfterFilter((n) => {
        if (n.data) rows.push(n.data);
      });
      setShown(rows.length);
      if (totals) {
        const t = totals(rows);
        gridApi.setGridOption("pinnedBottomRowData", t ? [t as T] : []);
      }
    },
    [totals],
  );

  const onGridReady = useCallback(
    (e: GridReadyEvent<T>) => {
      setApi(e.api);
      refreshFooter(e.api);
      const saved = loadGridState<ColumnState[]>(storageKey);
      if (saved) e.api.applyColumnState({ state: saved, applyOrder: true });
    },
    [storageKey, refreshFooter],
  );

  const persist = useCallback(() => {
    if (!api) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveGridState(storageKey, api.getColumnState()), 300);
  }, [api, storageKey]);

  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <section aria-label={props.label} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={searchId} className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">{t("grid.filterRows")}</span>
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-3">
            <IconSearch className="h-4 w-4" />
          </span>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("grid.filterBy", { hint: props.searchHint })}
            className="min-h-10 w-full rounded-md border border-rule bg-sheet pr-3 pl-9 text-sm text-ink placeholder:text-ink-3 focus:border-accent"
          />
        </label>
        {props.toolbar}
        <ColumnChooser api={api} />
        <button
          type="button"
          className={toolButton}
          disabled={!api}
          onClick={() =>
            api?.exportDataAsCsv({
              fileName: `${exportName}.csv`,
              processCellCallback: (p) => {
                const v = p.value as unknown;
                if (v && typeof v === "object" && "amount_minor" in v && "currency" in v) {
                  const m = v as { amount_minor: number; currency: string };
                  const exp = m.currency === "JPY" ? 0 : 2;
                  return `${(m.amount_minor / 10 ** exp).toFixed(exp)} ${m.currency}`;
                }
                if (Array.isArray(v)) return v.join(" ");
                return p.formatValue ? String(p.formatValue(v) ?? "") : String(v ?? "");
              },
            })
          }
        >
          <IconDownload />
          <span>{t("grid.export")}</span>
        </button>
        <button
          type="button"
          className="min-h-10 rounded-md px-2 text-sm text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          onClick={() => {
            clearGridState(storageKey);
            api?.resetColumnState();
            api?.setFilterModel(null);
            setQuery("");
          }}
        >
          {t("grid.reset")}
        </button>
      </div>

      <div className="min-w-0">
        <AgGridReact<T>
          key={lang}
          localeText={AG_LOCALE[lang]}
          theme={gridTheme}
          rowData={rowData ?? undefined}
          loading={rowData === null}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(p: GetRowIdParams<T>) => props.getRowId(p.data)}
          quickFilterText={query}
          domLayout="autoHeight"
          pagination
          paginationPageSize={props.pageSize ?? 20}
          paginationPageSizeSelector={[10, 20, 50, 100]}
          rowHeight={props.rowHeight ?? 48}
          headerHeight={42}
          animateRows={!reduceMotion}
          ensureDomOrder
          enableCellTextSelection
          suppressDragLeaveHidesColumns
          overlayNoRowsTemplate={`<span class="text-sm">${props.emptyMessage.replace(/</g, "&lt;")}</span>`}
          isExternalFilterPresent={() => externalRef.current !== null}
          doesExternalFilterPass={(node) => (node.data && externalRef.current ? externalRef.current(node.data) : true)}
          onGridReady={onGridReady}
          onFilterChanged={(e) => refreshFooter(e.api)}
          onRowDataUpdated={(e) => refreshFooter(e.api)}
          onColumnMoved={persist}
          onColumnResized={(e) => e.finished && persist()}
          onColumnVisible={persist}
          onColumnPinned={persist}
          onSortChanged={persist}
          onRowClicked={(e: RowClickedEvent<T>) => {
            if (e.data && !e.node.rowPinned && props.onRowClicked) props.onRowClicked(e.data);
          }}
          rowClass={props.onRowClicked ? "cursor-pointer" : undefined}
        />
      </div>
      {shown !== null && rowData && (
        <p className="text-xs text-ink-3" aria-live="polite">
          {shown === rowData.length ? t("grid.rows", { n: rowData.length }) : t("grid.rowsMatch", { shown, total: rowData.length })}
        </p>
      )}
    </section>
  );
}
