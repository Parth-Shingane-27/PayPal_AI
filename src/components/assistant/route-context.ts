/**
 * Which assistant a page talks to by default. Pages can say more (the open
 * product, a reload callback) with usePageAssistant; this is what the panel
 * uses when a page says nothing.
 */

export type DockAgent = "ASSISTANT" | "LISTING" | "TREASURY" | "OPERATIONS" | "SHOPPING";
export type DockRole = "SELLER" | "BUYER";

/** The agents a person can switch between in the panel. Buyers only have the shopping assistant. */
export const AGENTS_FOR: Record<DockRole, DockAgent[]> = {
  SELLER: ["ASSISTANT", "LISTING", "TREASURY", "OPERATIONS"],
  BUYER: ["SHOPPING"],
};

/** `/seller/<id>/treasury?period=x` -> "treasury"; `/seller/<id>/products/<p>` -> "products/<p>"; the account home -> "". */
export function subPath(pathname: string): string {
  const m = /^\/(?:seller|buyer)\/[^/]+\/?(.*)$/.exec(pathname.split("?")[0] ?? "");
  return (m?.[1] ?? "").replace(/\/+$/, "");
}

export function defaultAgentFor(pathname: string, role: DockRole): DockAgent {
  if (role === "BUYER") return "SHOPPING";
  const first = subPath(pathname).split("/")[0];
  if (first === "treasury") return "TREASURY";
  if (first === "operations") return "OPERATIONS";
  if (first === "products") return "LISTING";
  return "ASSISTANT";
}

/** Product id when the page is a product's editor (`/seller/<id>/products/<productId>`). */
export function productIdFor(pathname: string): string | undefined {
  const parts = subPath(pathname).split("/");
  return parts[0] === "products" && parts[1] ? parts[1] : undefined;
}

/**
 * Where an open conversation is remembered in the browser, so leaving a page and coming back resumes it.
 * One per agent, and per product or scope for the Listing agent (a product's own chat, the "new product" chat),
 * or per market for buyers.
 */
export function chatStorageKey(agent: DockAgent, productId?: string, resumeKey?: string): string {
  return `globalcart.chat.${agent}.${productId ?? "-"}.${resumeKey ?? "-"}`;
}
