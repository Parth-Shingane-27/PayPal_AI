"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { setDockOpen, setOverlayOpen } from "./dock-store";
import { AGENTS_FOR, chatStorageKey, type DockAgent, defaultAgentFor, productIdFor, type DockRole } from "./route-context";

/** What a page tells the assistant panel about itself. */
export type PageAssistant = {
  agent: DockAgent;
  /** The product this page is about (the Listing agent keeps a conversation per product). */
  productId?: string;
  /** Scopes the remembered conversation, e.g. "new-product" on the Products list. */
  resumeKey?: string;
  /** One line saying what the chat is about ("Quaderno in carta marmorizzata"), shown under the panel title. */
  contextLabel?: string;
  /** Called after each completed reply, so the page can refresh what the assistant may have changed. */
  onResult?: () => void;
};

export type ChatScope = { productId?: string; resumeKey?: string };

type Ctx = {
  role: DockRole;
  paypalClientId: string | null;
  agents: DockAgent[];
  /** The agent the panel is talking to now: the person's choice, else the page's, else the route's default. */
  active: DockAgent;
  choose: (agent: DockAgent) => void;
  scope: ChatScope;
  /** What the current page says the chat is about, when the active agent is the page's own. */
  contextLabel?: string;
  notifyResult: () => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  register: (token: symbol, page: PageAssistant) => void;
  unregister: (token: symbol) => void;
};

const AssistantCtx = createContext<Ctx | null>(null);

export function useAssistant(): Ctx {
  const c = useContext(AssistantCtx);
  if (!c) throw new Error("useAssistant must be used inside <AssistantProvider>");
  return c;
}

export const OPEN_EVENT = "gc:assistant-open";
/** Tells a mounted chat to switch to a given conversation. */
export const RESUME_EVENT = "gc:resume-chat";

type OpenDetail = { agent?: DockAgent; sessionId?: string };

/**
 * Opens the assistant panel from anywhere (a button, a finding), optionally on
 * a given agent and resuming a given conversation.
 */
export function openAssistant(detail: OpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenDetail>(OPEN_EVENT, { detail }));
}

export function AssistantProvider({ role, paypalClientId, market, children }: { role: DockRole; paypalClientId: string | null; /** A buyer's market, which scopes their conversation. */ market?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const agents = AGENTS_FOR[role];
  const [page, setPage] = useState<{ token: symbol; cfg: PageAssistant } | null>(null);
  const [override, setOverride] = useState<{ path: string; agent: DockAgent } | null>(null);
  const [busy, setBusy] = useState(false);

  // A choice made in the panel lasts for the page it was made on; a new page goes back to following the page.
  const chosen = override && override.path === pathname && agents.includes(override.agent) ? override.agent : null;
  const active = chosen ?? (page && agents.includes(page.cfg.agent) ? page.cfg.agent : defaultAgentFor(pathname, role));

  const scopeFor = useCallback(
    (agent: DockAgent): ChatScope => {
      if (page?.cfg.agent === agent) return { productId: page.cfg.productId, resumeKey: page.cfg.resumeKey ?? (agent === "SHOPPING" ? market : undefined) };
      if (agent === "LISTING") return { productId: productIdFor(pathname) };
      if (agent === "SHOPPING") return { resumeKey: market };
      return {};
    },
    [page, pathname, market],
  );
  const scope = useMemo(() => scopeFor(active), [scopeFor, active]);

  const contextLabel = page?.cfg.agent === active ? page.cfg.contextLabel : undefined;

  const register = useCallback((token: symbol, cfg: PageAssistant) => setPage({ token, cfg }), []);
  // Only the page that registered may clear the registration, so a page that mounts before the old one's cleanup is not wiped.
  const unregister = useCallback((token: symbol) => setPage((cur) => (cur?.token === token ? null : cur)), []);
  const choose = useCallback((agent: DockAgent) => setOverride({ path: pathname, agent }), [pathname]);

  const pageRef = useRef(page);
  const scopeForRef = useRef(scopeFor);
  const activeRef = useRef(active);
  useEffect(() => {
    pageRef.current = page;
    scopeForRef.current = scopeFor;
    activeRef.current = active;
  });
  const notifyResult = useCallback(() => pageRef.current?.cfg.onResult?.(), []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<OpenDetail>).detail ?? {};
      const target = d.agent && agents.includes(d.agent) ? d.agent : activeRef.current;
      if (d.agent && agents.includes(d.agent)) setOverride({ path: window.location.pathname, agent: d.agent });
      if (d.sessionId) {
        // Remember it first: if the target chat is not mounted yet it reads this when it mounts; if it is, the event switches it.
        const sc = scopeForRef.current(target);
        try {
          localStorage.setItem(chatStorageKey(target, sc.productId, sc.resumeKey), d.sessionId);
        } catch {
          // Storage blocked: the chat just opens on a fresh conversation.
        }
        window.dispatchEvent(new CustomEvent(RESUME_EVENT, { detail: { agent: target, sessionId: d.sessionId } }));
      }
      setDockOpen(true);
      setOverlayOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [agents]);

  const value = useMemo<Ctx>(
    () => ({ role, paypalClientId, agents, active, choose, scope, contextLabel, notifyResult, busy, setBusy, register, unregister }),
    [role, paypalClientId, agents, active, choose, scope, contextLabel, notifyResult, busy, register, unregister],
  );
  return <AssistantCtx.Provider value={value}>{children}</AssistantCtx.Provider>;
}

/**
 * A page's say in what the assistant panel does: which agent it opens on, which
 * product it is about, and what to refresh after a reply. Call it once per page.
 */
export function usePageAssistant(cfg: PageAssistant): void {
  const { register, unregister } = useAssistant();
  const onResult = useRef(cfg.onResult);
  useEffect(() => {
    onResult.current = cfg.onResult;
  });
  const { agent, productId, resumeKey, contextLabel } = cfg;
  useEffect(() => {
    const token = Symbol("page-assistant");
    register(token, { agent, productId, resumeKey, contextLabel, onResult: () => onResult.current?.() });
    return () => unregister(token);
  }, [register, unregister, agent, productId, resumeKey, contextLabel]);
}
