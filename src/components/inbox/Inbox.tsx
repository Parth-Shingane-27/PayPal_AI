"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatAge, formatDate } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n/messages";
import { api, type Money as MoneyT } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { IconBack, IconSend } from "../icons";
import { CountryStamp, ProductThumb, StatusStamp } from "../ui";

type ThreadSummary = {
  id: string;
  subject: string;
  status: "OPEN" | "CLOSED";
  counterpart: { name: string; country: string; locale: string };
  product: { id: string; title: string; image_url: string | null } | null;
  order_id: string | null;
  unread: number;
  last_message: { preview: string; from_me: boolean; at: string } | null;
  last_message_at: string;
};

type Message = { id: string; from_me: boolean; sender: string; body: string; body_locale: string; translation: string | null; at: string };
type Thread = {
  id: string;
  subject: string;
  status: string;
  viewer: "SELLER" | "BUYER";
  seller: { name: string; country: string; locale: string };
  buyer: { name: string; country: string; locale: string };
  product: { id: string; title: string; image_url: string | null; price: MoneyT | null } | null;
  order: { id: string; status: string; paid_at: string | null; total: MoneyT } | null;
  messages: Message[];
};

const MAX = 2000;
type Filter = "all" | "unread";

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

function notifyUnreadChanged() {
  window.dispatchEvent(new Event("gc:unread-changed"));
}

export function Inbox({ role }: { role: "SELLER" | "BUYER" }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("c");
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [loaded, setLoaded] = useState<Thread | null>(null);
  const thread = loaded && loaded.id === selectedId ? loaded : null;
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  const loadList = useCallback(async () => {
    try {
      const r = await api<{ conversations: ThreadSummary[] }>("/api/messages");
      setThreads(r.conversations);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ops.error"));
    }
  }, [t]);

  const loadThread = useCallback(async (id: string, markRead: boolean) => {
    try {
      const t = await api<Thread>(`/api/messages/${id}`);
      setLoaded(t);
      if (markRead) {
        await api(`/api/messages/${id}/read`, { method: "POST" });
        setThreads((ts) => ts?.map((x) => (x.id === id ? { ...x, unread: 0 } : x)) ?? ts);
        notifyUnreadChanged();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ops.error"));
    }
  }, [t]);

  useEffect(() => {
    api<{ conversations: ThreadSummary[] }>("/api/messages").then(
      (r) => setThreads(r.conversations),
      (e: unknown) => setError(e instanceof Error ? e.message : t("ops.error")),
    );
  }, [t]);

  useEffect(() => {
    if (!selectedId) return;
    const t = window.setTimeout(() => void loadThread(selectedId, true), 0);
    return () => window.clearTimeout(t);
  }, [selectedId, loadThread]);

  // Poll while the tab is visible so the other side's replies show up.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadList();
      if (selectedId) void loadThread(selectedId, true);
    }, 10_000);
    return () => window.clearInterval(id);
  }, [loadList, loadThread, selectedId]);

  const select = (id: string | null) => router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false });

  const shown = (threads ?? []).filter((t) => filter === "all" || t.unread > 0);
  const unreadTotal = (threads ?? []).reduce((s, t) => s + t.unread, 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{t("msg.title")}</h1>
          <p className="mt-1 text-ink-3">
            {role === "SELLER" ? t("msg.introSeller") : t("msg.introBuyer")}
          </p>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}

      <div className="grid min-h-[34rem] overflow-hidden rounded-[10px] border border-rule bg-sheet md:grid-cols-[21rem_minmax(0,1fr)]">
        {/* Thread list */}
        <section aria-label={t("msg.conversations")} className={`flex min-h-0 flex-col border-rule md:border-r ${selectedId ? "hidden md:flex" : "flex"}`}>
          <div className="flex items-center gap-1 border-b border-rule p-2" role="group" aria-label={t("msg.show")}>
            {(["all", "unread"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`min-h-10 rounded-md px-3 text-sm ${filter === f ? "bg-ink font-semibold text-sheet" : "text-ink-2 hover:bg-sheet-2"}`}
              >
                {f === "all" ? t("msg.all") : `${role === "SELLER" ? t("msg.waiting") : t("msg.newReplies")}${unreadTotal ? ` (${unreadTotal})` : ""}`}
              </button>
            ))}
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-rule overflow-y-auto md:max-h-[40rem]">
            {threads === null && <li className="p-4 text-sm text-ink-3">{t("msg.loading")}</li>}
            {threads !== null && shown.length === 0 && (
              <li className="p-4 text-sm text-ink-3">
                {filter === "unread" ? (role === "SELLER" ? t("msg.nothingWaiting") : t("msg.noNew")) : role === "BUYER" ? t("msg.emptyBuyer") : t("msg.empty")}
              </li>
            )}
            {shown.map((th) => {
              const active = th.id === selectedId;
              return (
                <li key={th.id}>
                  <button
                    type="button"
                    onClick={() => select(th.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full gap-3 px-3 py-3 text-left ${active ? "bg-accent-soft" : "hover:bg-sheet-2"}`}
                  >
                    <ProductThumb src={th.product?.image_url} alt="" size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate ${th.unread > 0 ? "font-semibold text-ink" : "text-ink-2"}`}>{th.counterpart.name}</span>
                        <span className="num shrink-0 text-xs text-ink-3">{now ? formatAge(th.last_message_at, now) : ""}</span>
                      </span>
                      <span className="block truncate text-sm text-ink-2">{th.subject}</span>
                      <span className="flex items-center gap-2">
                        <span className="block min-w-0 flex-1 truncate text-sm text-ink-3">
                          {th.last_message?.from_me ? t("msg.youPrefix") : ""}
                          {th.last_message?.preview}
                        </span>
                        {th.unread > 0 && (
                          <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-alert px-1.5 text-xs leading-5 font-semibold text-sheet">
                            {th.unread}
                            <span className="sr-only"> unread</span>
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Conversation */}
        <section aria-label={t("msg.conversation")} className={`min-h-0 flex-col ${selectedId ? "flex" : "hidden md:flex"}`}>
          {!selectedId && (
            <div className="m-auto max-w-sm p-8 text-center text-ink-3">
              <p className="font-display text-lg text-ink">{t("msg.pick")}</p>
              <p className="mt-1 text-sm">{role === "SELLER" ? t("msg.pickSeller") : t("msg.pickBuyer")}</p>
            </div>
          )}
          {selectedId && !thread && <p className="p-6 text-sm text-ink-3">{t("msg.loading")}</p>}
          {thread && <ThreadView thread={thread} now={now} onBack={() => select(null)} onSent={(m) => {
            setLoaded((t) => (t ? { ...t, messages: [...t.messages, m] } : t));
            void loadList();
          }} />}
        </section>
      </div>
    </div>
  );
}

function ThreadView({ thread, now, onBack, onSent }: { thread: Thread; now: number | null; onBack: () => void; onSent: (m: Message) => void }) {
  const { t, locale } = useI18n();
  const other = thread.viewer === "SELLER" ? thread.buyer : thread.seller;
  const me = thread.viewer === "SELLER" ? thread.seller : thread.buyer;
  const endRef = useRef<HTMLDivElement>(null);
  const productHref = thread.product ? (thread.viewer === "SELLER" ? `/seller/products/${thread.product.id}` : "/shop") : null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.messages.length]);

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3">
        <button type="button" onClick={onBack} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-sheet-2 md:hidden">
          <IconBack />
          <span className="sr-only">{t("msg.back")}</span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold">
            <span className="truncate">{other.name}</span>
            <CountryStamp country={other.country} />
            <span className="text-sm font-normal text-ink-3">{t("msg.writesIn", { lang: t(`langname.${other.locale.slice(0, 2)}` as MessageKey) })}</span>
          </p>
          <p className="truncate text-sm text-ink-3">{thread.subject}</p>
        </div>
        {thread.status === "CLOSED" && <span className="rounded-[3px] bg-sheet-2 px-2 py-0.5 text-xs text-ink-2">{t("msg.resolved")}</span>}
      </header>

      {(thread.product || thread.order) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-sheet-2 px-4 py-2.5 text-sm">
          {thread.product && (
            <span className="flex min-w-0 items-center gap-2">
              <ProductThumb src={thread.product.image_url} alt="" size={30} />
              {productHref ? (
                <Link href={productHref} className="truncate font-medium text-ink hover:text-accent">
                  {thread.product.title}
                </Link>
              ) : (
                <span className="truncate">{thread.product.title}</span>
              )}
              {thread.product.price && <span className="num text-ink-3">{thread.product.price.display}</span>}
            </span>
          )}
          {thread.order && (
            <span className="flex items-center gap-2">
              <StatusStamp status={thread.order.status} />
              <span className="num text-ink-3">
                {thread.order.total.display}, {formatDate(thread.order.paid_at, locale)}
              </span>
            </span>
          )}
        </div>
      )}

      <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-5 md:max-h-[30rem]" aria-label={t("msg.with", { name: other.name })}>
        {thread.messages.map((m) => (
          <li key={m.id} className={`flex flex-col ${m.from_me ? "items-end" : "items-start"}`}>
            <div className={`max-w-[min(34rem,88%)] rounded-[10px] px-3.5 py-2.5 ${m.from_me ? "rounded-br-[3px] bg-accent text-sheet" : "rounded-bl-[3px] border border-rule bg-paper text-ink"}`}>
              <p lang={m.body_locale} className="whitespace-pre-wrap">
                {m.body}
              </p>
              {m.translation && (
                <p lang={me.locale} className="mt-2 border-t border-dashed border-rule-strong pt-2 text-[0.92rem] text-ink-2">
                  <span className="mb-0.5 block text-xs text-ink-3">{t("msg.translatedFrom", { lang: t(`langname.${m.body_locale.slice(0, 2)}` as MessageKey) })}</span>
                  {m.translation}
                </p>
              )}
            </div>
            <span className="num mt-1 text-xs text-ink-3">
              {m.from_me ? t("msg.you") : other.name.split(" ")[0]}, {now ? formatAge(m.at, now) : ""}
            </span>
          </li>
        ))}
        <div ref={endRef} />
      </ol>

      <Composer threadId={thread.id} to={other.name} onSent={onSent} />
    </>
  );
}

function Composer({ threadId, to, onSent }: { threadId: string; to: string; onSent: (m: Message) => void }) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const id = useId();

  async function send() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const m = await api<Message>(`/api/messages/${threadId}`, { body: { body: text } });
      setBody("");
      onSent(m);
      setStatus(t("msg.sent"));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t("msg.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="border-t border-rule p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {t("msg.replyTo", { name: to })}
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={id}
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder={t("msg.replyTo", { name: to })}
          className="min-h-11 flex-1 resize-y rounded-md border border-rule-strong bg-sheet px-3 py-2 text-ink placeholder:text-ink-3 focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !body.trim()}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-sheet disabled:opacity-50"
        >
          <IconSend className="h-4 w-4" />
          {busy ? t("msg.sending") : t("msg.send")}
        </button>
      </div>
      <p className="mt-1 flex justify-between text-xs text-ink-3" aria-live="polite">
        <span>{status ?? t("msg.hint")}</span>
        <span className="num">
          {body.length}/{MAX}
        </span>
      </p>
    </form>
  );
}
