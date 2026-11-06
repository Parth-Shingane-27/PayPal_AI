"use client";

import dynamic from "next/dynamic";
import type { DataGridProps } from "./DataGrid";

function GridSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading table">
      <div className="h-10 rounded-md bg-sheet-2" />
      <div className="h-[420px] rounded-[10px] border border-rule bg-sheet" />
    </div>
  );
}

/**
 * AG Grid only runs in the browser: loaded with ssr:false from this client
 * module (Next 16 rejects ssr:false in Server Components).
 */
const Dynamic = dynamic(() => import("./DataGrid"), { ssr: false, loading: GridSkeleton });

export function Grid<T>(props: DataGridProps<T>) {
  const Component = Dynamic as unknown as (p: DataGridProps<T>) => React.ReactElement;
  return <Component {...props} />;
}
