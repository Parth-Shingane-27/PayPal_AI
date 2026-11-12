/**
 * Which assistant a page talks to. Each role has exactly one: freelancers the
 * Freelancer Agent (PROFILE), clients the Client Agent (HIRING). Pages can say
 * more (the open project, a reload callback) with usePageAssistant.
 */

export type DockAgent = "PROFILE" | "HIRING";
export type DockRole = "FREELANCER" | "CLIENT";

/** The agents a person can talk to in the panel: one per role, so there is nothing to switch. */
export const AGENTS_FOR: Record<DockRole, DockAgent[]> = {
  FREELANCER: ["PROFILE"],
  CLIENT: ["HIRING"],
};

/** `/freelancer/<id>/earnings?period=x` -> "earnings"; `/freelancer/<id>/board/<p>` -> "board/<p>"; the account home -> "". */
export function subPath(pathname: string): string {
  const m = /^\/(?:freelancer|client)\/[^/]+\/?(.*)$/.exec(pathname.split("?")[0] ?? "");
  return (m?.[1] ?? "").replace(/\/+$/, "");
}

export function defaultAgentFor(_pathname: string, role: DockRole): DockAgent {
  return role === "CLIENT" ? "HIRING" : "PROFILE";
}

/** Project id when a freelancer is looking at one project (`/freelancer/<id>/board/<projectId>`). */
export function projectIdFor(pathname: string): string | undefined {
  const parts = subPath(pathname).split("/");
  return parts[0] === "board" && parts[1] ? parts[1] : undefined;
}

/**
 * Where an open conversation is remembered in the browser, so leaving a page and coming back resumes it.
 * One per agent, and per project for the Freelancer Agent (a project's own chat), or per market for clients.
 */
export function chatStorageKey(agent: DockAgent, subjectId?: string, resumeKey?: string): string {
  return `globalgig.chat.${agent}.${subjectId ?? "-"}.${resumeKey ?? "-"}`;
}
