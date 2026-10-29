"use client"

// components/driver-mobile/push-card.tsx
//
// Включение пушей в приложении водителя.
//
// Зачем отдельной карточкой на /m: водитель работает с телефона и почти не
// заходит в «Настройки» (там пуши тоже есть — для штаба). А пуш ему нужнее
// всех: назначенный рейс и догруз приходят, когда приложение свёрнуто.
// Поэтому кнопка живёт рядом с пультом смены.

import { BellRing, BellOff, Loader2 } from "lucide-react"

import { usePush } from "@/hooks/use-push"
import { cn } from "@/lib/utils"

export function PushCard() {
  const { state, reason, serverEnabled, subscribe, unsubscribe, busy } = usePush()

  const enabled = state === "subscribed"
  const blocked = !serverEnabled || state === "unsupported" || state === "denied"

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-gray-200">
            {enabled ? (
              <BellRing className="h-4 w-4 text-emerald-400" />
            ) : (
              <BellOff className="h-4 w-4 text-gray-500" />
            )}
            Уведомления на телефон
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            Назначенный рейс, догруз и ответы логиста — даже если приложение закрыто
          </p>
        </div>
        <button
          type="button"
          disabled={busy || blocked}
          onClick={() => (enabled ? void unsubscribe() : void subscribe())}
          className={cn(
            "flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-medium active:opacity-70 disabled:opacity-50",
            enabled
              ? "border border-gray-700 bg-gray-800 text-gray-300"
              : "bg-sky-500 text-white",
          )}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {enabled ? "Выключить" : "Включить"}
        </button>
      </div>

      {reason && <p className="mt-2 text-xs text-amber-400/90">{reason}</p>}

      {/* Водителю незачем знать про VAPID-ключи: это причина для разработчика,
          а не действие для него. Говорим, что уведомления сейчас не придут и
          что делать вместо них. */}
      {!serverEnabled && state !== "loading" && (
        <p className="mt-2 text-xs text-gray-500">
          Уведомления пока не подключены — задания и сообщения придут, когда откроете приложение
        </p>
      )}

      <p className="mt-2 text-[11px] leading-snug text-gray-600">
        На iPhone уведомления работают, только если сайт установлен на домашний экран
      </p>
    </div>
  )
}
