/** Client-side fetch helper: JSON in, JSON out, API error messages surfaced. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: Record<string, unknown> } };
  if (!res.ok) {
    const e = data.error ?? { code: "HTTP_ERROR", message: `Request failed (${res.status})` };
    throw new ApiError(e.message, e.code, res.status, e.details);
  }
  return data as T;
}

export type Money = { amount_minor: number; currency: string; display: string };

/** Minor units back to the plain decimal the server parses ("44.99", "7980"). */
export function decimalOf(m: Money): string {
  if (m.currency === "JPY") return String(m.amount_minor);
  const abs = Math.abs(m.amount_minor);
  return `${m.amount_minor < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
