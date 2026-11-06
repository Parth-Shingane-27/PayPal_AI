"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../api";
import {
  IconBag,
  IconBox,
  IconCart,
  IconCheck,
  IconClose,
  IconCoins,
  IconJournal,
  IconLedger,
  IconMenu,
  IconMessages,
  IconOverview,
  IconPulse,
  IconReceipt,
  IconSpark,
  IconTruck,
} from "../icons";
import { LogoutButton } from "../LogoutButton";
import { ThemeToggle } from "./ThemeToggle";

const ICONS = {
  overview: IconOverview,
  ledger: IconLedger,
  messages: IconMessages,
  products: IconBox,
  treasury: IconCoins,
  operations: IconTruck,
  approvals: IconCheck,
  activity: IconPulse,
  assistant: IconSpark,
  journal: IconJournal,
  shop: IconBag,
  cart: IconCart,
  orders: IconReceipt,
};
export type IconKey = keyof typeof ICONS;
export type NavLink = { href: string; label: string; icon: IconKey; exact?: boolean; badge?: "unread" };

function isActive(pathname: string, l: NavLink) {
  return l.exact ? pathname === l.href : pathname === l.href || pathname.startsWith(`${l.href}/`);
}

/** Polls the unread count so the badge moves when the other side replies. */
function useUnread(initial: number) {
  const [unread, setUnread] = useState(initial);
  const pathname = usePathname();
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void api<{ unread: number }>("/api/messages/unread")
        .then((r) => alive && setUnread(r.unread))
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 20_000);
    window.addEventListener("gc:unread-changed", tick);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener("gc:unread-changed", tick);
    };
  }, [pathname]);
  return unread;
}

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-alert px-1.5 text-xs font-semibold leading-5 text-sheet">
      {n}
      <span className="sr-only"> unread</span>
    </span>
  );
}

function Brand({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-md" aria-label="GlobalCart, switch account">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <circle cx="16" cy="16" r="15" fill="#c99a2e" />
        <circle cx="16" cy="16" r="11" fill="none" stroke="#1a1514" strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="2 2.2" />
        <path d="M9 16h14M16 9c2.4 2 3.5 4.3 3.5 7s-1.1 5-3.5 7c-2.4-2-3.5-4.3-3.5-7s1.1-5 3.5-7z" fill="none" stroke="#1a1514" strokeWidth="1.8" />
      </svg>
      <span className="font-display text-[1.35rem] font-bold leading-none tracking-[-0.02em] text-ink">GlobalCart</span>
    </Link>
  );
}

function LinkList({ links, unread, onNavigate, dense }: { links: NavLink[]; unread: number; onNavigate?: () => void; dense?: boolean }) {
  const pathname = usePathname();
  return (
    <ul className={dense ? "flex items-center gap-0.5" : "flex flex-col gap-0.5"}>
      {links.map((l) => {
        const Icon = ICONS[l.icon];
        const active = isActive(pathname, l);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={[
                `relative flex min-h-11 items-center rounded-md text-[0.94rem] whitespace-nowrap transition-colors ${dense ? "gap-2 px-2.5" : "gap-3 px-3"}`,
                active ? "bg-accent font-semibold text-sheet shadow-[0_1px_0_rgb(0_0_0/0.08)]" : "text-ink-2 hover:bg-sheet-2 hover:text-ink",
              ].join(" ")}
            >
              {active && !dense && <span className="absolute inset-y-1.5 -left-3 w-1 rounded-r bg-accent" aria-hidden />}
              <Icon />
              <span>{l.label}</span>
              {l.badge === "unread" && <Badge n={unread} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Who({ name, sub }: { name: string; sub: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-ink">{name}</p>
      <p className="truncate text-xs text-ink-3">{sub}</p>
    </div>
  );
}

/**
 * App frame. Sellers get a left rail (dense back office); buyers get a top bar.
 * Below md both collapse to a top bar with a drawer.
 */
export function Shell({
  variant,
  links,
  who,
  sub,
  initialUnread,
  tools,
  children,
}: {
  variant: "rail" | "bar";
  links: NavLink[];
  who: string;
  sub: string;
  initialUnread: number;
  tools?: React.ReactNode;
  children: React.ReactNode;
}) {
  const unread = useUnread(initialUnread);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const mobileBar = (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-rule bg-sheet/95 px-4 py-2 backdrop-blur md:hidden">
      <Brand href="/login" />
      <span className="ml-auto">
        <ThemeToggle compact />
      </span>
      <button
        type="button"
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md text-ink"
        aria-expanded={open}
        aria-controls="nav-drawer"
        onClick={() => setOpen(true)}
      >
        <IconMenu />
        <span className="sr-only">Open menu</span>
        {unread > 0 && <span className="h-2 w-2 rounded-full bg-alert" aria-hidden />}
      </button>
    </header>
  );

  const drawer = open && (
    <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu" id="nav-drawer">
      <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close menu" onClick={() => setOpen(false)} />
      <nav className="absolute inset-y-0 right-0 flex w-[min(20rem,86vw)] flex-col gap-4 overflow-y-auto bg-sheet p-4 shadow-[var(--shadow-overlay)]">
        <div className="flex items-center justify-between">
          <Who name={who} sub={sub} />
          <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md" onClick={() => setOpen(false)} autoFocus>
            <IconClose />
            <span className="sr-only">Close menu</span>
          </button>
        </div>
        {tools}
        <LinkList links={links} unread={unread} onNavigate={() => setOpen(false)} />
        <div className="mt-auto flex items-center justify-end border-t border-rule pt-3">
          <LogoutButton />
        </div>
      </nav>
    </div>
  );

  if (variant === "rail") {
    return (
      <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
        {mobileBar}
        {drawer}
        <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-rule bg-sheet px-3 py-5 md:flex">
          <div className="flex items-center justify-between gap-2 pl-2">
            <Brand href="/login" />
            <ThemeToggle compact />
          </div>
          <nav aria-label="Seller" className="flex-1 overflow-y-auto">
            <LinkList links={links} unread={unread} />
          </nav>
          <div className="flex flex-col gap-1 border-t border-rule px-2 pt-3">
            <Who name={who} sub={sub} />
            <div className="flex items-center justify-end">
              <LogoutButton />
            </div>
          </div>
        </aside>
        <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      {mobileBar}
      {drawer}
      <header className="sticky top-0 z-30 hidden border-b border-rule bg-sheet/95 backdrop-blur md:block">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-2">
          <Brand href="/login" />
          <nav aria-label="Buyer" className="min-w-0 flex-1">
            <LinkList links={links} unread={unread} dense />
          </nav>
          {tools}
          <div className="flex items-center gap-2">
            <span className="hidden xl:block">
              <Who name={who} sub={sub} />
            </span>
            <ThemeToggle compact />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">{children}</main>
    </div>
  );
}
