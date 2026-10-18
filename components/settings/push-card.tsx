"use client"

// components/settings/push-card.tsx
//
// Карточка «Уведомления на устройства» в настройках.
//
// Зачем в интерфейсе, а не «тихо включено»: пользователь должен видеть, какие
// устройства получают пуши, и уметь отписать потерянный телефон. Плюс честные
// подсказки: разрешение браузера, iOS-установка, сервер без ключей.

import { BellRing, BellOff, Loader2, Smartphone, Trash2 } from "lucide-react"

import { describeDevice } from "@/lib/push/client"
import { usePush } from "@/hooks/use-push"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function PushCard() {
  const { state, reason, serverEnabled, subscribe, unsubscribe, devices, busy } = usePush()

  const enabled = state === "subscribed"
  const unsupported = state === "unsupported"
  const denied = state === "denied"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled ? <BellRing className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
          Уведомления на устройства
        </CardTitle>
        <CardDescription>
          Пуши приходят, когда приложение закрыто: назначенный рейс, СОС, сообщения
          чата и отметки простоев.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Пока идёт первый запрос, не утверждаем, что пуши не настроены:
            серверный рендер не знает ответа, а если сказать «не настроены» и
            потом включить — выглядит как поломка. */}
        {!serverEnabled && state !== "loading" && (
          <p className="text-sm text-muted-foreground">
            Push-уведомления не настроены на сервере: не заданы VAPID-ключи.
          </p>
        )}

        {denied && (
          <p className="text-sm text-amber-600">
            Браузер запретил уведомления для этого сайта. Разрешите их в настройках
            сайта (значок слева от адресной строки) и обновите страницу.
          </p>
        )}

        {unsupported && (
          <p className="text-sm text-muted-foreground">
            Этот браузер не поддерживает push-уведомления.
          </p>
        )}

        {reason && !denied && !unsupported && (
          <p className="text-sm text-muted-foreground">{reason}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={enabled ? "outline" : "default"}
            disabled={busy || !serverEnabled || unsupported || denied}
            onClick={() => (enabled ? void unsubscribe() : void subscribe())}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {enabled ? "Отключить на этом устройстве" : "Включить уведомления"}
          </Button>
          <span
            className={cn(
              "text-sm",
              enabled ? "text-emerald-600" : "text-muted-foreground",
            )}
          >
            {enabled ? "Уведомления включены" : "Уведомления выключены"}
          </span>
        </div>

        {devices.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Подписанные устройства</p>
            <ul className="space-y-1">
              {devices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2 truncate">
                    <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{describeDevice(device.userAgent)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {device.lastUsedAt
                      ? `последний пуш ${new Date(device.lastUsedAt).toLocaleString("ru-RU")}`
                      : "ожидает первого пуша"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          На iPhone и iPad уведомления работают, только если сайт установлен на
          домашний экран («Поделиться» → «На экран Домой»).
        </p>
      </CardContent>
    </Card>
  )
}
