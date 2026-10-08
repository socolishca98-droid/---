// app/lm/chat/page.tsx — переписки с водителями.
//
// Отдельного «списка чатов» в API не было: экран показывал просто список
// экипажа, поэтому по нему нельзя было понять, кто ответил и есть ли новые
// сообщения (пункт 1.4). Теперь последнее сообщение, время и счётчик
// непрочитанных берутся из /api/lm/chat-threads, а карточки водителей —
// из /api/drivers (статус, машина).

"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ChevronRight, MessageSquare, Search, X } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { PullToRefresh } from "@/components/logist-mobile/pull-to-refresh"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { formatRelative, plural } from "@/lib/logist-mobile/format"
import {
  DRIVER_STATUS_META,
  type MobileChatThread,
  type MobileDriver,
} from "@/lib/logist-mobile/types"

export default function LogistChatPage() {
  const { user } = useStaffSession()
  const drivers = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)
  const threads = useJsonApi<{ threads: MobileChatThread[] }>(
    user ? "/api/lm/chat-threads" : null,
  )
  const [query, setQuery] = useState("")

  const threadByDriver = useMemo(() => {
    const map = new Map<string, MobileChatThread>()
    for (const thread of threads.data?.threads ?? []) map.set(thread.driverId, thread)
    return map
  }, [threads.data])

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = (drivers.data?.drivers ?? []).map((driver) => ({
      driver,
      thread: threadByDriver.get(driver.id) ?? null,
    }))

    // Свежие переписки наверх, остальной экипаж — по алфавиту ниже.
    rows.sort((a, b) => {
      const aTime = a.thread?.lastMessage.createdAt ?? ""
      const bTime = b.thread?.lastMessage.createdAt ?? ""
      if (aTime && bTime) return bTime.localeCompare(aTime)
      if (aTime) return -1
      if (bTime) return 1
      return a.driver.name.localeCompare(b.driver.name, "ru")
    })

    if (!needle) return rows
    return rows.filter(({ driver, thread }) =>
      [driver.name, driver.phone, driver.vehiclePlate, thread?.lastMessage.content]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
  }, [drivers.data, threadByDriver, query])

  const unreadTotal = useMemo(
    () => (threads.data?.threads ?? []).reduce((sum, thread) => sum + thread.unreadCount, 0),
    [threads.data],
  )

  const error = drivers.error || threads.error
  const loading = drivers.loading || threads.loading

  const refresh = () => {
    drivers.reload()
    threads.reload()
  }

  return (
    <>
      <LogistHeader
        title="Чат"
        subtitle={
          unreadTotal > 0
            ? `${unreadTotal} ${plural(unreadTotal, ["новое сообщение", "новых сообщения", "новых сообщений"])}`
            : "Переписка с водителями"
        }
        userName={user?.name}
      />

      <div className="sticky top-[calc(57px+env(safe-area-inset-top))] z-20 border-b border-border surface-glass px-4 py-3 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            inputMode="search"
            placeholder="Имя или машина"
            className="h-11 w-full rounded-xl border border-border bg-secondary pl-9 pr-9 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <PullToRefresh onRefresh={refresh} className="px-4 pt-3.5">
        <div className="space-y-2.5">
          {error ? (
            <ErrorState message={error} onRetry={refresh} />
          ) : loading && list.length === 0 ? (
            <ListSkeleton rows={4} />
          ) : list.length === 0 ? (
            <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="Водителей не найдено" />
          ) : (
            list.map(({ driver, thread }) => {
              const meta = DRIVER_STATUS_META[driver.status] ?? DRIVER_STATUS_META.offline
              const unread = thread?.unreadCount ?? 0
              const preview = thread
                ? `${thread.lastMessage.fromDriver ? "" : "Вы: "}${thread.lastMessage.content}`
                : null

              return (
                <Link
                  key={driver.id}
                  href={`/lm/chat/${driver.id}`}
                  className={`flex items-center gap-3 rounded-xl border p-4 active:opacity-70 ${
                    unread > 0
                      ? "border-primary/40 bg-primary/[0.08]"
                      : "border-border bg-card shadow-sm"
                  }`}
                >
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-[15px] font-semibold text-foreground">
                    {driver.name
                      .trim()
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase())
                      .join("")}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={`min-w-0 flex-1 truncate text-[15px] ${
                          unread > 0 ? "font-semibold text-foreground" : "font-medium text-foreground"
                        }`}
                      >
                        {driver.name}
                      </span>
                      {thread ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatRelative(thread.lastMessage.createdAt)}
                        </span>
                      ) : null}
                    </span>

                    {preview ? (
                      <span
                        className={`mt-0.5 block truncate text-[13px] ${
                          unread > 0 ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {preview}
                      </span>
                    ) : (
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px]">
                        <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
                        <span className={meta.text}>{meta.label}</span>
                        {driver.vehiclePlate ? (
                          <span className="text-muted-foreground/80">· {driver.vehiclePlate}</span>
                        ) : null}
                      </span>
                    )}
                  </span>

                  {unread > 0 ? (
                    <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/80" />
                  )}
                </Link>
              )
            })
          )}
        </div>
      </PullToRefresh>
    </>
  )
}
