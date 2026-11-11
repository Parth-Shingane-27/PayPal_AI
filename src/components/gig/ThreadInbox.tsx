"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatAge } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n/messages";
import { api, ApiError } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { IconBack, IconSend } from "../icons";
import { CountryStamp } from "../ui";
import { useGigBase } from "./use-gig-base";

/**
 * Project message threads between a freelancer and a client.
 *
 *   <ThreadInbox role="FREELANCER" />        full inbox: list + selected thread (?c=<threadId>)
 *   <ThreadPanel threadId={id} role="CLIENT" compact />   one thread, for a project page
 *
 * Reads GET /api/threads and GET /api/threads/<id> (which also marks the thread
 * read), sends with POST /api/threads/<id> { body, attachment_ids }, uploads with
 * POST /api/threads/<id>/attachments. Polls every 10 s while the tab is visible
 * and fires "gc:unread-changed" so the shell's unread badge refreshes. The other
 * party's messages show the original text and, when present, a translation.
 *
 * Must render inside a <Suspense> boundary on a page (it reads useSearchParams).
 */

export type GigRole = "FREELANCER" | "CLIENT";

type Party = { name: string; country: string; locale: string };
type ContractRef = { id: string; title: string; status: string } | null;

type ThreadSummary = {
  id: string;
  subject: string;
  status: "OPEN" | "CLOSED";
  counterpart: Party;
  contract: ContractRef;
  unread: number;
  last_message: { preview: string; from_me: boolean; at: string } | null;
  last_message_at: string;
};

type Attachment = { id: string; file_name: string; content_type: string; size_bytes: number; url: string };
type Message = {
  id: string;
  from_me: boolean;
  sender: GigRole;
  body: string;
  body_locale: string;
  translation: string | null;
  attachments?: Attachment[];
  at: string;
};
type Thread = {
  id: string;
  subject: string;
  status: "OPEN" | "CLOSED";
  viewer: GigRole;
  freelancer: Party;
  client: Party;
  contract: ContractRef;
  messages: Message[];
};

type Uploaded = { attachment_id: string; file_name: string; content_type: string; size_bytes: number; url: string };

const MAX = 4000;
/** Same limit as the server (MAX_ATTACHMENT_BYTES); checked here so a big file fails before it uploads. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const POLL_MS = 10_000;
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

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function fileSize(bytes: number, locale: string): string {
  const nf = (v: number, d: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(v);
  if (bytes < 1024) return `${nf(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${nf(bytes / 1024, 0)} KB`;
  return `${nf(bytes / 1024 / 1024, 1)} MB`;
}

/** Multipart upload of one file to a thread. */
async function uploadFile(threadId: string, file: File): Promise<Uploaded> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/threads/${threadId}/attachments`, { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as Uploaded & { error?: { code: string; message: string } };
  if (!res.ok) {
    const e = data.error ?? { code: "HTTP_ERROR", message: `Request failed (${res.status})` };
    throw new ApiError(e.message, e.code, res.status);
  }
  return data;
}

/** Loads one thread (marking it read), and re-loads it every 10 s while the tab is visible. */
function useThread(threadId: string | null) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thread = loaded && loaded.id === threadId ? loaded : null;

  const load = useCallback(
    async (id: string) => {
      try {
        const th = await api<Thread>(`/api/threads/${id}`);
        setLoaded(th);
        setError(null);
        notifyUnreadChanged();
      } catch (e) {
        setError(errText(e, t("ops.error")));
      }
    },
    [t],
  );

  useEffect(() => {
    if (!threadId) return;
    const first = window.setTimeout(() => void load(threadId), 0);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(threadId);
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [threadId, load]);

  const appendMessage = useCallback((m: Message) => setLoaded((th) => (th ? { ...th, messages: [...th.messages, m] } : th)), []);
  return { thread, error, appendMessage };
}

/** The full inbox: thread list on the left, the selected thread (?c=<id>) on the right; one column on phones. */
export function ThreadInbox({ role }: { role: GigRole }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("c");
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const { thread, error: threadError, appendMessage } = useThread(selectedId);

  const loadList = useCallback(async () => {
    try {
      const r = await api<{ threads: ThreadSummary[] }>("/api/threads");
      setThreads(r.threads);
      setError(null);
    } catch (e) {
      setError(errText(e, t("ops.error")));
    }
  }, [t]);

  useEffect(() => {
    const first = window.setTimeout(() => void loadList(), 0);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadList();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [loadList]);

  // Opening a thread marks it read on the server; mirror that in the list at once.
  useEffect(() => {
    if (!thread) return;
    const id = window.setTimeout(() => setThreads((ts) => ts?.map((x) => (x.id === thread.id && x.unread ? { ...x, unread: 0 } : x)) ?? ts), 0);
    return () => window.clearTimeout(id);
  }, [thread]);

  const select = (id: string | null) => router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false });

  const shown = (threads ?? []).filter((th) => filter === "all" || th.unread > 0);
  const unreadTotal = (threads ?? []).reduce((s, th) => s + th.unread, 0);
  const shownError = error ?? threadError;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[2rem] leading-tight font-bold tracking-[-0.025em]">{t("msg.title")}</h1>
          <p className="mt-1 text-ink-3">{role === "FREELANCER" ? t("shared.th.introFreelancer") : t("shared.th.introClient")}</p>
        </div>
      </header>

      {shownError && (
        <p role="alert" className="rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {shownError}
        </p>
      )}

      <div className="grid min-h-[34rem] overflow-hidden rounded-[10px] border border-rule bg-sheet @min-[600px]:grid-cols-[21rem_minmax(0,1fr)]">
        {/* Thread list */}
        <section aria-label={t("msg.conversations")} className={`flex min-h-0 flex-col border-rule @min-[600px]:border-r ${selectedId ? "hidden @min-[600px]:flex" : "flex"}`}>
          <div className="flex items-center gap-1 border-b border-rule p-2" role="group" aria-label={t("msg.show")}>
            {(["all", "unread"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`min-h-10 rounded-md px-3 text-sm ${filter === f ? "bg-ink font-semibold text-sheet" : "text-ink-2 hover:bg-sheet-2"}`}
              >
                {f === "all" ? t("msg.all") : `${t("msg.newReplies")}${unreadTotal ? ` (${unreadTotal})` : ""}`}
              </button>
            ))}
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-rule overflow-y-auto @min-[600px]:max-h-[40rem]">
            {threads === null && <li className="p-4 text-sm text-ink-3">{t("msg.loading")}</li>}
            {threads !== null && shown.length === 0 && (
              <li className="p-4 text-sm text-ink-3">{filter === "unread" ? t("msg.noNew") : role === "CLIENT" ? t("shared.th.emptyClient") : t("shared.th.emptyFreelancer")}</li>
            )}
            {shown.map((th) => {
              const active = th.id === selectedId;
              return (
                <li key={th.id}>
                  <button
                    type="button"
                    onClick={() => select(th.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full flex-col gap-0.5 px-3 py-3 text-left ${active ? "bg-accent-soft" : "hover:bg-sheet-2"}`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`truncate ${th.unread > 0 ? "font-semibold text-ink" : "text-ink-2"}`}>{th.counterpart.name}</span>
                        <CountryStamp country={th.counterpart.country} />
                      </span>
                      <span className="num shrink-0 text-xs text-ink-3">{now ? formatAge(th.last_message_at, now) : ""}</span>
                    </span>
                    <span className="block truncate text-sm text-ink-2">{th.subject}</span>
                    {th.contract && <span className="block truncate text-xs text-ink-3">{t("shared.th.project", { title: th.contract.title })}</span>}
                    <span className="flex items-center gap-2">
                      <span className="block min-w-0 flex-1 truncate text-sm text-ink-3">
                        {th.last_message?.from_me ? t("msg.youPrefix") : ""}
                        {th.last_message?.preview}
                      </span>
                      {th.unread > 0 && (
                        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-alert px-1.5 text-xs leading-5 font-semibold text-sheet">
                          {th.unread}
                          <span className="sr-only"> {t("shell.unread")}</span>
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Conversation */}
        <section aria-label={t("msg.conversation")} className={`min-h-0 flex-col ${selectedId ? "flex" : "hidden @min-[600px]:flex"}`}>
          {!selectedId && (
            <div className="m-auto max-w-sm p-8 text-center text-ink-3">
              <p className="font-display text-lg text-ink">{t("msg.pick")}</p>
              <p className="mt-1 text-sm">{role === "FREELANCER" ? t("shared.th.pickFreelancer") : t("shared.th.pickClient")}</p>
            </div>
          )}
          {selectedId && !thread && <p className="p-6 text-sm text-ink-3">{t("msg.loading")}</p>}
          {thread && (
            <ThreadView
              thread={thread}
              now={now}
              onBack={() => select(null)}
              onSent={(m) => {
                appendMessage(m);
                void loadList();
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * One thread on its own (messages, composer and file upload), for embedding on
 * a project page. `compact` drops the header and project strip and keeps the
 * message list shorter. `role` is the signed-in side (the API also says so).
 */
export function ThreadPanel({ threadId, role, compact = false }: { threadId: string; role: GigRole; compact?: boolean }) {
  const { t } = useI18n();
  const now = useNow();
  const { thread, error, appendMessage } = useThread(threadId);
  return (
    <section aria-label={t("msg.conversation")} data-role={role} className="flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-rule bg-sheet">
      {error && (
        <p role="alert" className="m-3 rounded-md bg-alert-soft p-3 text-sm text-alert-ink">
          {error}
        </p>
      )}
      {!thread && !error && <p className="p-6 text-sm text-ink-3">{t("msg.loading")}</p>}
      {thread && <ThreadView thread={thread} now={now} compact={compact} onSent={appendMessage} />}
    </section>
  );
}

function ThreadView({ thread, now, onBack, onSent, compact = false }: { thread: Thread; now: number | null; onBack?: () => void; onSent: (m: Message) => void; compact?: boolean }) {
  const { t, locale } = useI18n();
  const base = useGigBase();
  const other = thread.viewer === "FREELANCER" ? thread.client : thread.freelancer;
  const me = thread.viewer === "FREELANCER" ? thread.freelancer : thread.client;
  const endRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = endRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.messages.length]);

  return (
    <>
      {!compact && (
        <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3">
          {onBack && (
            <button type="button" onClick={onBack} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-sheet-2 @min-[600px]:hidden">
              <IconBack />
              <span className="sr-only">{t("msg.back")}</span>
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              <span className="truncate">{other.name}</span>
              <CountryStamp country={other.country} />
              <span className="text-sm font-normal text-ink-3">{t("msg.writesIn", { lang: t(`langname.${other.locale.slice(0, 2)}` as MessageKey) })}</span>
            </p>
            <p className="truncate text-sm text-ink-3">{thread.subject}</p>
          </div>
          {thread.status === "CLOSED" && <span className="rounded-[3px] bg-sheet-2 px-2 py-0.5 text-xs text-ink-2">{t("msg.resolved")}</span>}
        </header>
      )}

      {!compact && thread.contract && (
        <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-sheet-2 px-4 py-2.5 text-sm">
          <span className="text-ink-3">{t("shared.th.projectLabel")}</span>
          <Link href={`${base}/projects/${thread.contract.id}`} className="min-w-0 truncate font-medium text-ink hover:text-accent">
            {thread.contract.title}
          </Link>
        </div>
      )}

      <ol
        ref={endRef}
        className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-5 ${compact ? "max-h-[22rem]" : "@min-[600px]:max-h-[30rem]"}`}
        aria-label={t("msg.with", { name: other.name })}
      >
        {thread.messages.length === 0 && <li className="text-sm text-ink-3">{t("shared.th.noMessages")}</li>}
        {thread.messages.map((m) => (
          <li key={m.id} className={`flex flex-col ${m.from_me ? "items-end" : "items-start"}`}>
            <div className={`max-w-[min(34rem,88%)] rounded-[10px] px-3.5 py-2.5 ${m.from_me ? "rounded-br-[3px] bg-accent text-sheet" : "rounded-bl-[3px] border border-rule bg-paper text-ink"}`}>
              {m.body && (
                <p lang={m.body_locale} className="whitespace-pre-wrap">
                  {m.body}
                </p>
              )}
              {m.translation && (
                <p lang={me.locale} className="mt-2 border-t border-dashed border-rule-strong pt-2 text-[0.92rem] text-ink-2">
                  <span className="mb-0.5 block text-xs text-ink-3">{t("msg.translatedFrom", { lang: t(`langname.${m.body_locale.slice(0, 2)}` as MessageKey) })}</span>
                  {m.translation}
                </p>
              )}
              {m.attachments && m.attachments.length > 0 && (
                <ul className={`flex flex-col gap-1 ${m.body ? "mt-2" : ""}`} aria-label={t("shared.th.attachments")}>
                  {m.attachments.map((a) => (
                    <li key={a.id}>
                      <a
                        href={a.url}
                        download={a.file_name}
                        className={`inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-sm underline-offset-2 hover:underline ${m.from_me ? "bg-sheet/15 text-sheet" : "bg-sheet-2 text-ink"}`}
                      >
                        <PaperclipIcon />
                        <span className="truncate">{a.file_name}</span>
                        <span className={`num shrink-0 text-xs ${m.from_me ? "text-sheet/80" : "text-ink-3"}`}>{fileSize(a.size_bytes, locale)}</span>
                        <span className="sr-only">{t("shared.th.download")}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <span className="num mt-1 text-xs text-ink-3">
              {m.from_me ? t("msg.you") : other.name.split(" ")[0]}, {now ? formatAge(m.at, now) : ""}
            </span>
          </li>
        ))}
      </ol>

      <Composer threadId={thread.id} to={other.name} onSent={onSent} />
    </>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.5 9.5 9.6 14.4a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3l-5.5 5.5a1 1 0 0 1-1.5-1.4l4.9-4.9" />
    </svg>
  );
}

type Pending = { key: string; file: File; uploaded: Uploaded | null };

function Composer({ threadId, to, onSent }: { threadId: string; to: string; onSent: (m: Message) => void }) {
  const { t, locale } = useI18n();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<"idle" | "uploading" | "sending">("idle");
  const [status, setStatus] = useState<string | null>(null);
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: Pending[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE_BYTES) {
        setStatus(t("shared.th.tooLarge", { name: f.name }));
        continue;
      }
      next.push({ key: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`, file: f, uploaded: null });
    }
    setFiles((cur) => [...cur, ...next].slice(0, 20));
  }

  async function send() {
    const text = body.trim();
    if ((!text && files.length === 0) || busy !== "idle") return;
    setStatus(null);
    // Upload first (keeping what already went up, so a retry does not upload twice), then send with the ids.
    const done: Pending[] = [...files];
    try {
      setBusy("uploading");
      for (let i = 0; i < done.length; i++) {
        const p = done[i]!;
        if (!p.uploaded) {
          done[i] = { ...p, uploaded: await uploadFile(threadId, p.file) };
          setFiles([...done]);
        }
      }
      setBusy("sending");
      const uploaded = done.map((p) => p.uploaded!);
      const m = await api<Message>(`/api/threads/${threadId}`, { body: { body: text, attachment_ids: uploaded.map((u) => u.attachment_id) } });
      setBody("");
      setFiles([]);
      onSent({
        ...m,
        attachments: m.attachments ?? uploaded.map((u) => ({ id: u.attachment_id, file_name: u.file_name, content_type: u.content_type, size_bytes: u.size_bytes, url: u.url })),
      });
      setStatus(t("msg.sent"));
    } catch (e) {
      setStatus(errText(e, t("msg.failed")));
    } finally {
      setBusy("idle");
    }
  }

  const canSend = busy === "idle" && (body.trim().length > 0 || files.length > 0);

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
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={t("shared.th.attachments")}>
          {files.map((p) => (
            <li key={p.key} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-rule bg-sheet-2 py-0.5 pr-1 pl-2 text-sm">
              <PaperclipIcon />
              <span className="truncate">{p.file.name}</span>
              <span className="num text-xs text-ink-3">{fileSize(p.file.size, locale)}</span>
              <button
                type="button"
                disabled={busy !== "idle"}
                onClick={() => setFiles((cur) => cur.filter((x) => x.key !== p.key))}
                className="inline-flex min-h-8 min-w-8 items-center justify-center rounded text-ink-3 hover:bg-sheet hover:text-ink"
              >
                <span aria-hidden>×</span>
                <span className="sr-only">{t("shared.th.removeFile", { name: p.file.name })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }} />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy !== "idle"}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-rule-strong text-ink-2 hover:bg-sheet-2 hover:text-ink disabled:opacity-50"
        >
          <PaperclipIcon />
          <span className="sr-only">{t("shared.th.attach")}</span>
        </button>
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
          className="min-h-11 min-w-0 flex-1 resize-y rounded-md border border-rule-strong bg-sheet px-3 py-2 text-ink placeholder:text-ink-3 focus:border-accent"
        />
        <button type="submit" disabled={!canSend} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-sheet disabled:opacity-50">
          <IconSend className="h-4 w-4" />
          {busy === "uploading" ? t("shared.th.uploading") : busy === "sending" ? t("msg.sending") : t("msg.send")}
        </button>
      </div>
      <p className="mt-1 flex justify-between gap-3 text-xs text-ink-3" aria-live="polite">
        <span>{status ?? t("msg.hint")}</span>
        <span className="num shrink-0">
          {body.length}/{MAX}
        </span>
      </p>
    </form>
  );
}
