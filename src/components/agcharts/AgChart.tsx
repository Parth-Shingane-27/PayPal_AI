"use client";

import { type AgChartOptions, type AgChartTheme, AllCommunityModule, ModuleRegistry } from "ag-charts-community";
import { AgCharts } from "ag-charts-react";
import { useMemo } from "react";
import { useTheme } from "../shell/ThemeToggle";

ModuleRegistry.registerModules([AllCommunityModule]);

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * AG Charts draws to canvas, so it cannot read CSS variables itself: this
 * builds its theme from the current token values and rebuilds on theme switch.
 * The palette is the validated chart slots (--series-1..5) in fixed order.
 */
export function useChartTheme(): AgChartTheme {
  const mode = useTheme();
  return useMemo<AgChartTheme>(() => {
    const series = [1, 2, 3, 4, 5].map((i) => token(`--series-${i}`));
    const ink = token("--ink");
    const ink2 = token("--ink-2");
    const ink3 = token("--ink-3");
    const rule = token("--rule");
    const sheet = token("--sheet");
    const fontFamily = getComputedStyle(document.body).fontFamily;
    return {
      baseTheme: mode === "dark" ? "ag-default-dark" : "ag-default",
      palette: { fills: series, strokes: series },
      params: { fontFamily, foregroundColor: ink, backgroundColor: sheet },
      overrides: {
        common: {
          background: { fill: "transparent" },
          padding: { top: 8, right: 8, bottom: 4, left: 4 },
          legend: {
            position: "bottom",
            spacing: 18,
            item: { label: { color: ink2, fontSize: 13, fontFamily }, marker: { shape: "square", size: 11 }, paddingX: 18 },
          },
          axes: {
            number: { label: { color: ink3, fontSize: 12, fontFamily }, gridLine: { style: [{ stroke: rule, lineDash: [3, 4] }] }, line: { width: 0 } },
            category: { label: { color: ink3, fontSize: 12, fontFamily }, line: { stroke: rule }, gridLine: { enabled: false } },
          },
        },
        bar: { series: { cornerRadius: 3, strokeWidth: 0, highlightStyle: { item: { fillOpacity: 1, strokeWidth: 0 } } } },
      },
    } as AgChartTheme;
  }, [mode]);
}

export default function AgChart({ options, height = 300, label }: { options: AgChartOptions; height?: number; label: string }) {
  const theme = useChartTheme();
  const full = useMemo(() => ({ ...options, theme }) as AgChartOptions, [options, theme]);
  return (
    <div role="figure" aria-label={label} style={{ height }} className="w-full">
      <AgCharts options={full} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
