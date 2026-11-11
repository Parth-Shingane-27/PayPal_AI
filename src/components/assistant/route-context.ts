/**
 * Which assistant a page talks to by default. Pages can say more (the open
 * service, a reload callback) with usePageAssistant; this is what the panel
 * uses when a page says nothing.
 */

export type DockAgent = "ASSISTANT" | "PROFILE" | "HIRING" | "TREASURY" | "PROJECTS";
export type DockRole = "FREELANCER" | "CLIENT";

/** The agents a person can switch between in the panel. Clients only have the hiring assistant. */
export const AGENTS_FOR: Record<DockRole, DockAgent[]> = {
  FREELANCER: ["ASSISTANT", "PROFILE", "TREASURY", "PROJECTS"],
  CLIENT: ["HIRING"],
};

/** `/freelancer/<id>/earnings?period=x` -> "earnings"; `/freelancer/<id>/services/<s>` -> "services/<s>"; the account home -> "". */
export function subPath(pathname: string): string {
  const m = /^\/(?:freelancer|client)\/[^/]+\/?(.*)$/.exec(pathname.split("?")[0] ?? "");
  return (m?.[1] ?? "").replace(/\/+$/, "");
}

export function defaultAgentFor(pathname: string, role: DockRole): DockAgent {
  if (role === "CLIENT") return "HIRING";
  const top = subPath(pathname).split("/")[0];
  if (top === "earnings" || top === "invoices") return "TREASURY";
  if (top === "projects" || top === "quotes") return "PROJECTS";
  if (top === "services") return "PROFILE";
  return "ASSISTANT";
}

/** Service id when the page is a service's editor (`/freelancer/<id>/services/<serviceId>`). */
export function serviceIdFor(pathname: string): string | undefined {
  const parts = subPath(pathname).split("/");
  return parts[0] === "services" && parts[1] ? parts[1] : undefined;
}

/**
 * Where an open conversation is remembered in the browser, so leaving a page and coming back resumes it.
 * One per agent, and per service or scope for the Profile agent (a service's own chat, the "new service" chat),
 * or per market for clients.
 */
export function chatStorageKey(agent: DockAgent, subjectId?: string, resumeKey?: string): string {
  return `globalgig.chat.${agent}.${subjectId ?? "-"}.${resumeKey ?? "-"}`;
}
