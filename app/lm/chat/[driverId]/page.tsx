// app/lm/chat/[driverId]/page.tsx — переписка с конкретным водителем.
//
// Сообщения приходят по водителю (GET /api/chat?driverId=). Отправка — POST
// с recipientId: отправитель берётся сервером из сессии, подписаться чужим
// именем нельзя.
//
// Пункты 1.5, 1.6, 1.7 чек-листа: непрочитанные считаются и гаснут при
// открытии, отправленное сообщение видно сразу, поле ввода стоит вплотную
// к клавиатуре (нижнее меню на этом экране скрыто оболочкой).

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Phone, Send } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { PullToRefresh } from "@/components/logist-mobile/pull-to-refresh"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { formatDateTime, plural, telHref } from "@/lib/logist-mobile/format"
import type { MobileChatMessage, MobileDriver } from "@/lib/logist-mobile/types"

/** Как часто подтягивать новые сообщения, пока экран открыт */
const POLL_MS = 5000
/** Считаем, что человек «внизу ленты», если до конца меньше этого */
const NEAR_BOTTOM_PX = 150

export default function LogistChatThreadPage() {
  const params = useParams<{ driverId: string }>()
  const driverId = typeof params?.driverId === "string" ? params.driverId : null
  const { user } = useStaffSession()

  const { data, error, loading, reload } = useJsonApi<{ messages: MobileChatMessage[] }>(
    driverId ? `/api/chat?driverId=${encodeURIComponent(driverId)}&limit=100` : null,
  )
  const drivers = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)

  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  /** Отправленные сообщения до следующего ответа сервера — чтобы не ждать опрос */
  const [pending, setPending] = useState<MobileChatMessage[]>([])

  const endRef = useRef<HTMLDivElement | null>(null)
  const nearBottomRef = useRef(true)
  const lastMessageIdRef = useRef<string | null>(null)
  const firstRenderRef = useRef(true)
  const markedReadRef = useRef<Set<string>>(new Set())

  const driver = (drivers.data?.drivers ?? []).find((item) => item.id === driverId) ?? null
  const messages = useMemo(
    () => [...(data?.messages ?? []), ...pending],
    [data, pending],
  )
  const pendingIds = useMemo(() => new Set(pending.map((message) => message.id)), [pending])
  const tel = telHref(driver?.phone ?? null)

  const unread = useMemo(
    () => messages.filter((message) => message.senderId === driverId && !message.isRead).length,
    [messages, driverId],
  )

  // Следим, у конца ли ленты человек: если он читает историю выше, ленту
  // дёргать нельзя (пункт 1.2 — «не прыгает»).
  useEffect(() => {
    const onScroll = () => {
      const distance =
        document.documentElement.scrollHeight - window.scrollY - window.innerHeight
      nearBottomRef.current = distance < NEAR_BOTTOM_PX
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // Прокрутка только на первое появление и на действительно новое сообщение.
  useEffect(() => {
    const last = messages.length > 0 ? messages[messages.length - 1] : null
    const lastId = last?.id ?? null
    const changed = lastId !== lastMessageIdRef.current
    lastMessageIdRef.current = lastId
    if (!changed) return

    if (firstRenderRef.current || nearBottomRef.current) {
      const instant = firstRenderRef.current
      firstRenderRef.current = false
      requestAnimationFrame(() =>
        endRef.current?.scrollIntoView({ block: "end", behavior: instant ? "auto" : "smooth" }),
      )
    }
  }, [messages])

  // Отметка «прочитано»: открыл переписку — у водителя гаснет непрочитанное,
  // и в списке чатов тоже.
  useEffect(() => {
    const ids = messages
      .filter(
        (message) =>
          message.senderId === driverId &&
          !message.isRead &&
          !markedReadRef.current.has(message.id),
      )
      .map((message) => message.id)
    if (ids.length === 0) return

    for (const id of ids) markedReadRef.current.add(id)
    void apiSend("/api/chat", "PATCH", { messageIds: ids }).then((result) => {
      if (result.ok) reload()
    })
  }, [messages, driverId, reload])

  // Новые сообщения приходят сами: опрос только когда экран на виду.
  useEffect(() => {
    if (!driverId) return
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return
      reload()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [driverId, reload])

  // Ответ сервера пришёл — временные сообщения больше не нужны.
  useEffect(() => {
    setPending([])
  }, [data])

  const send = useCallback(async () => {
    const content = text.trim()
    if (!content || !driverId || sending) return
    setSending(true)
    const result = await apiSend<{ message: MobileChatMessage }>("/api/chat", "POST", {
      content,
      recipientId: driverId,
      type: "text",
    })
    setSending(false)
    if (!result.ok) {
      toast.error(result.error || "Сообщение не отправилось")
      return
    }
    // Сообщение показываем сразу, не дожидаясь следующего опроса (пункт 1.6)
    if (result.data?.message) {
      setPending((prev) => [...prev, result.data!.message])
    }
    setText("")
    nearBottomRef.current = true
  }, [text, driverId, sending])

  const unreplied = unread > 0

  return (
    <>
      <LogistHeader
        title={driver?.name ?? "Переписка"}
        subtitle={
          unreplied
            ? `${unread} ${plural(unread, ["новое сообщение", "новых сообщения", "новых сообщений"])}`
            : (driver?.vehiclePlate ?? undefined)
        }
        back
        userName={user?.name}
      />

      <div className="px-4 pt-3">
        {tel ? (
          <a
            href={tel}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500/15 text-[13.5px] font-medium text-emerald-200 active:bg-emerald-500/25"
          >
            <Phone className="h-4 w-4" /> Позвонить {driver?.phone ? `· ${driver.phone}` : ""}
          </a>
        ) : null}

        <PullToRefresh onRefresh={reload}>
          {/* Снизу отступ под поле ввода, чтобы последнее сообщение не пряталось за ним */}
          <div className="mt-3 space-y-2.5 pb-24">
            {error ? (
              <ErrorState message={error} onRetry={reload} />
            ) : loading && messages.length === 0 ? (
              <ListSkeleton rows={4} />
            ) : messages.length === 0 ? (
              <EmptyState
                icon={<Send className="h-6 w-6" />}
                title="Переписки ещё нет"
                description="Напишите первое сообщение — водитель увидит его в приложении"
              />
            ) : (
              messages.map((message) => {
                const mine = message.senderId === user?.id
                const body = message.content ?? message.text ?? message.message ?? ""
                const stamp = formatDateTime(message.createdAt)
                return (
                  <div
                    key={message.id}
                    className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                        mine ? "bg-orange-500/20 text-white" : "bg-white/[0.06] text-zinc-200"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words text-[14px]">{body}</p>
                      <p className="mt-1 text-right text-[10.5px] text-zinc-400/80">{stamp}</p>
                    </div>
                    {mine && pendingIds.has(message.id) ? (
                      <span className="mt-0.5 text-[10.5px] text-zinc-500">Отправляется…</span>
                    ) : null}
                  </div>
                )
              })
            )}
            <div ref={endRef} />
          </div>
        </PullToRefresh>
      </div>

      {/* Поле ввода прижато к низу: только безопасная зона, без полосы под меню */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/8 bg-[#0b0b0e]/95 backdrop-blur"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      >
        <div className="mx-auto flex max-w-md items-end gap-2 px-4 pt-2.5">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            rows={1}
            placeholder="Сообщение водителю"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-white/8 bg-white/[0.04] px-3.5 py-3 text-[15px] text-white placeholder:text-zinc-500 focus:border-orange-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !text.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white active:bg-orange-600 disabled:opacity-40"
            aria-label="Отправить"
          >
            {sending ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Send className="h-4.5 w-4.5" />}
          </button>
        </div>
      </div>
    </>
  )
}
