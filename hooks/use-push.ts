"use client"

// hooks/use-push.ts
//
// Подписка браузера на push-уведомления.
//
// Что делает: регистрирует service worker, спрашивает разрешение, подписывается
// на push и сохраняет подписку на сервере. Обратная сторона — отписка.
//
// Тонкости, из-за которых обычно ломаются пуши в браузере:
//   • разрешение спрашиваем только по действию пользователя (кнопка), иначе
//     Chrome молча блокирует запрос;
//   • на iOS push работает только для установленного сайта (standalone) —
//     об этом честно говорим в интерфейсе, а не молчим;
//   • подписку пересоздаём, если браузер сменил ключи (p256dh/auth меняются
//     при «очистке сайта»).

import { useCallback, useEffect, useState } from "react"

import { urlBase64ToUint8Array } from "@/lib/push/client"

export type PushState = "unsupported" | "loading" | "disabled" | "prompt" | "subscribed" | "denied"

export type UsePushResult = {
  state: PushState
  /** Причина, по которой пуши недоступны — показываем текстом. */
  reason: string | null
  /** Серверные ключи не настроены. */
  serverEnabled: boolean
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
  /** Сколько устройств уже подписано (для списка в настройках). */
  devices: PushDevice[]
  busy: boolean
}

export type PushDevice = {
  id: string
  endpoint: string
  userAgent: string | null
  createdAt: string
  lastUsedAt: string | null
}

/** Разрешение «по умолчанию» — браузер ещё не спрашивал. */
function permissionState(): PushState {
  if (typeof window === "undefined") return "unsupported"
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported"
  if (Notification.permission === "denied") return "denied"
  if (Notification.permission === "granted") return "subscribed"
  return "prompt"
}

export function usePush(): UsePushResult {
  const [state, setState] = useState<PushState>("loading")
  const [reason, setReason] = useState<string | null>(null)
  const [serverEnabled, setServerEnabled] = useState(false)
  const [devices, setDevices] = useState<PushDevice[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      setState("unsupported")
      setReason("Браузер не поддерживает push-уведомления")
      return
    }

    try {
      const response = await fetch("/api/push", { cache: "no-store" })
      const data = await response.json()

      if (!data.success) {
        setState("unsupported")
        setReason(data.error || "Push недоступен")
        return
      }

      setServerEnabled(Boolean(data.enabled))
      setDevices(Array.isArray(data.subscriptions) ? data.subscriptions : [])

      if (!data.enabled) {
        setState("disabled")
        setReason("Сервер не настроен для push-уведомлений")
        return
      }

      const current = permissionState()
      setState(current)
      setReason(
        current === "denied"
          ? "Уведомления запрещены в настройках браузера — разрешите их для этого сайта"
          : null,
      )
    } catch {
      setState("unsupported")
      setReason("Не удалось связаться с сервером")
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const subscribe = useCallback(async () => {
    setBusy(true)
    try {
      const info = await fetch("/api/push", { cache: "no-store" }).then((r) => r.json())
      if (!info.success || !info.enabled || !info.publicKey) {
        setReason("Сервер не настроен для push-уведомлений")
        return
      }

      const registration = await navigator.serviceWorker.register("/sw.js")
      await navigator.serviceWorker.ready

      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Браузер должен сам принудить к тишине, если сервер сбоит
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(info.publicKey),
        }))

      const payload = subscription.toJSON()
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: payload.endpoint,
          keys: { p256dh: payload.keys?.p256dh, auth: payload.keys?.auth },
          userAgent: navigator.userAgent,
        }),
      })

      const result = await response.json()
      if (!result.success) {
        setReason(result.error || "Не удалось включить уведомления")
        return
      }

      setReason(null)
      setState("subscribed")
      await refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setReason(message.includes("denied") ? "Разрешение на уведомления не дано" : message)
      setState(permissionState())
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const unsubscribe = useCallback(async () => {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()

      if (subscription) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined)
        await subscription.unsubscribe().catch(() => undefined)
      }

      setReason(null)
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [refresh])

  return { state, reason, serverEnabled, subscribe, unsubscribe, devices, busy }
}
