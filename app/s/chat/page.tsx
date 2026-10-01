"use client";

// app/s/chat/page.tsx
//
// Чат с водителями в мобильном пульте: лента тредов (последнее сообщение,
// счётчик непрочитанных) и диалог с отправкой. Один источник — /api/chat,
// как на десктопе; обновления мягким поллингом.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Send } from "lucide-react";

import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  senderId: string;
  senderRole: string;
  senderName: string;
  recipientId: string | null;
  content: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

interface Thread {
  driverId: string;
  driverName: string;
  last: ChatMessage | null;
  unread: number;
}

const timeFmt = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

export default function StaffMobileChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [openDriver, setOpenDriver] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (Array.isArray(data?.messages)) setMessages(data.messages);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const threads = useMemo<Thread[]>(() => {
    const map = new Map<string, Thread>();
    const sorted = [...messages].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    for (const message of sorted) {
      const fromDriver = message.senderRole === "driver";
      const driverId = fromDriver ? message.senderId : message.recipientId;
      if (!driverId) continue;
      const existing = map.get(driverId);
      map.set(driverId, {
        driverId,
        driverName: fromDriver
          ? message.senderName
          : existing?.driverName || "Водитель",
        last: message,
        unread:
          (existing?.unread ?? 0) + (fromDriver && !message.isRead ? 1 : 0),
      });
    }
    return [...map.values()].sort(
      (a, b) =>
        new Date(b.last?.createdAt ?? 0).getTime() -
        new Date(a.last?.createdAt ?? 0).getTime(),
    );
  }, [messages]);

  const dialog = useMemo(
    () =>
      openDriver
        ? messages
            .filter(
              (message) =>
                (message.senderRole === "driver" &&
                  message.senderId === openDriver) ||
                message.recipientId === openDriver,
            )
            .sort(
              (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
            )
        : [],
    [messages, openDriver],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dialog.length, openDriver]);

  const send = async () => {
    const content = draft.trim();
    if (!content || !openDriver || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, recipientId: openDriver }),
      });
      if (res.ok) {
        setDraft("");
        await load();
      }
    } finally {
      setSending(false);
    }
  };

  const activeName =
    threads.find((t) => t.driverId === openDriver)?.driverName || "Водитель";

  // ---------- диалог ----------
  if (openDriver) {
    return (
      <div className="flex h-dvh flex-col px-4 pt-5">
        <header className="flex items-center gap-3 pb-3">
          <button
            type="button"
            onClick={() => setOpenDriver(null)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-zinc-400"
            aria-label="Назад к тредам"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{activeName}</p>
            <p className="text-[11px] text-zinc-500">чат с водителем</p>
          </div>
        </header>

        <div className="flex-1 space-y-2.5 overflow-y-auto pb-4">
          {dialog.map((message) => {
            const mine = message.senderRole !== "driver";
            return (
              <div
                key={message.id}
                className={cn("flex", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-snug",
                    mine
                      ? "rounded-br-md bg-gradient-to-br from-orange-500 to-orange-600 text-zinc-950 shadow-[0_8px_24px_-10px_rgba(249,115,22,0.6)]"
                      : "rounded-bl-md border border-white/[0.06] bg-white/[0.05] backdrop-blur-xl",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-right text-[10px]",
                      mine ? "text-zinc-900/70" : "text-zinc-500",
                    )}
                  >
                    {timeFmt.format(new Date(message.createdAt))}
                  </p>
                </div>
              </div>
            );
          })}
          {dialog.length === 0 && (
            <p className="pt-10 text-center text-xs text-zinc-500">
              Сообщений пока нет — напишите первым.
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex items-end gap-2 border-t border-white/[0.06] py-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Сообщение водителю…"
            className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm outline-none backdrop-blur-xl placeholder:text-zinc-600 focus:border-orange-500/40"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 text-zinc-950 shadow-[0_8px_24px_-10px_rgba(249,115,22,0.6)] transition-opacity disabled:opacity-40"
            aria-label="Отправить"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // ---------- лента тредов ----------
  return (
    <div className="space-y-4 px-4 pt-6">
      <header>
        <h1 className="text-2xl font-bold">Чат</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Переписка с водителями — тот же источник, что и в десктопе.
        </p>
      </header>

      {loading ? (
        <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 text-center text-xs text-zinc-500">
          Загружаем переписку…
        </p>
      ) : threads.length === 0 ? (
        <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 text-center text-xs text-zinc-500">
          Переписки пока нет. Треды появятся, когда водитель напишет первым (или
          вы ответите ему из карточки рейса).
        </p>
      ) : (
        <div className="space-y-2.5">
          {threads.map((thread) => (
            <button
              key={thread.driverId}
              type="button"
              onClick={() => setOpenDriver(thread.driverId)}
              className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-3.5 text-left backdrop-blur-xl transition-colors hover:bg-white/[0.07]"
            >
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500/25 to-orange-500/5 text-sm font-bold text-orange-300 ring-1 ring-orange-500/20">
                {thread.driverName.trim().charAt(0).toUpperCase() || "В"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">
                    {thread.driverName}
                  </span>
                  {thread.last && (
                    <span className="flex-shrink-0 text-[10px] text-zinc-500">
                      {timeFmt.format(new Date(thread.last.createdAt))}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                  {thread.last?.content || ""}
                </span>
              </span>
              {thread.unread > 0 && (
                <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-zinc-950">
                  {thread.unread}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
