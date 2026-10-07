// app/lm/chat/[driverId]/page.tsx — переписка с конкретным водителем.
//
// Сообщения приходят по водителю (GET /api/chat?driverId=). Отправка — POST
// с recipientId: отправитель берётся сервером из сессии, подписаться чужим
// именем нельзя.

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Phone, RefreshCw, Send } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import type { MobileChatMessage, MobileDriver } from "@/lib/logist-mobile/types"
import { formatDateTime, telHref } from "@/lib/logist-mobile/format"

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
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const driver = (drivers.data?.drivers ?? []).find((item) => item.id === driverId) ?? null
  const messages = data?.messages ?? []
  const tel = telHref(driver?.phone ?? null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages.length])

  // Переписка должна обновляться сама: водитель пишет с телефона, а ответ ждут
  useEffect(() => {
    if (!driverId) return
    const timer = setInterval(reload, 15000)
    return () => clearInterval(timer)
  }, [driverId, reload])

  const send = useCallback(async () => {
    const content = text.trim()
    if (!content || !driverId) return
    setSending(true)
    const result = await apiSend("/api/chat", "POST", { content, recipientId: driverId, type: "text" })
    setSending(false)
    if (!result.ok) {
      toast.error(result.error || "Сообщение не отправилось")
      return
    }
    setText("")
    reload()
  }, [text, driverId, reload])

  return (
    <>
      <LogistHeader
        title={driver?.name ?? "Переписка"}
        subtitle={driver?.vehiclePlate ?? undefined}
        back
        userName={user?.name}
      />

      <div className="px-4 pt-3">
        <div className="flex items-center gap-2.5">
          {tel ? (
            <a
              href={tel}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500/15 text-[13.5px] font-medium text-emerald-200 active:bg-emerald-500/25"
            >
              <Phone className="h-4 w-4" /> Позвонить
            </a>
          ) : null}
          <button
            type="button"
            onClick={reload}
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white/8 px-4 text-[13.5px] font-medium text-white active:bg-white/12"
          >
            <RefreshCw className="h-4 w-4" /> Обновить
          </button>
        </div>

        {/* Список сообщений: снизу отступ под поле ввода, чтобы последнее
            сообщение не пряталось за ним */}
        <div className="mt-3 space-y-2.5 pb-28">
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
              return (
                <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                      mine ? "bg-orange-500/20 text-white" : "bg-white/[0.06] text-zinc-200"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words text-[14px]">{body}</p>
                    <p className="mt-1 text-[10.5px] text-zinc-400/80">{formatDateTime(message.createdAt)}</p>
                  </div>
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Поле ввода прижато к низу над навигацией и учитывает safe-area */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/8 bg-[#0b0b0e]/95 backdrop-blur"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 72px)" }}
      >
        <div className="mx-auto flex max-w-md items-end gap-2 px-4 py-2.5">
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
