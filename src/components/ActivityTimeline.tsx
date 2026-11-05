"use client";

export type ActivityRow = {
  id: string;
  kind: "TOOL" | "PAYPAL" | "MODEL";
  agent: string | null;
  tool: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  rationale: string | null;
  duration_ms: number | null;
  created_at: string;
  usage: { provider?: string; input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; thinking_tokens?: number; modelCalls?: number } | null;
};

const STATUS_STYLE: Record<string, string> = {
  SUCCEEDED: "bg-emerald-100 text-emerald-800",
  EXECUTED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-red-100 text-red-800",
  EXECUTION_FAILED: "bg-red-100 text-red-800",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  APPROVED: "bg-sky-100 text-sky-800",
  REJECTED: "bg-slate-200 text-slate-700",
};

const KIND_STYLE: Record<ActivityRow["kind"], string> = {
  TOOL: "bg-indigo-100 text-indigo-800",
  PAYPAL: "bg-blue-100 text-blue-800",
  MODEL: "bg-purple-100 text-purple-800",
};

/** Every tool call, PayPal call and model run, newest first, with expandable input/output. */
export function ActivityTimeline({ rows, empty = "No activity yet." }: { rows: ActivityRow[]; empty?: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ol className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded border border-slate-200 bg-white p-2 text-xs">
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 font-medium ${KIND_STYLE[r.kind]}`}>{r.kind}</span>
              <span className="font-mono font-semibold">{r.tool}</span>
              <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[r.status] ?? "bg-slate-100"}`}>{r.status}</span>
              {r.agent && <span className="text-slate-500">{r.agent.toLowerCase()}</span>}
              {r.duration_ms !== null && <span className="text-slate-500">{r.duration_ms} ms</span>}
              {r.usage && (
                <span className="text-slate-500">
                  {r.usage.provider ? `${r.usage.provider}: ` : ""}{r.usage.input_tokens ?? 0} in / {r.usage.cached_input_tokens ?? 0} cached / {r.usage.output_tokens ?? 0} out / {r.usage.thinking_tokens ?? 0} thinking
                  {r.usage.modelCalls ? ` · ${r.usage.modelCalls} calls` : ""}
                </span>
              )}
              <span className="ml-auto text-slate-400">{new Date(r.created_at).toLocaleTimeString()}</span>
            </summary>
            {r.error && <p className="mt-2 text-red-700">{r.error}</p>}
            {r.rationale && <p className="mt-2 text-slate-700">Rationale: {r.rationale}</p>}
            <p className="mt-2 font-semibold">Input</p>
            <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(r.input, null, 2)}</pre>
            <p className="mt-2 font-semibold">Output</p>
            <pre className="max-h-64 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(r.output, null, 2)}</pre>
          </details>
        </li>
      ))}
    </ol>
  );
}
