// lib/push/send.ts
//
// Отправка одного push-сообщения в браузер.
//
// Что здесь происходит: подписываем запрос VAPID-ключом, шифруем содержимое
// ключом браузера и отправляем на его push-сервис. Ответы сервиса различаем:
// 201 — доставлено, 404/410 — подписка мертва (её надо удалить), 401/403 —
// ключи не те, 429 — сервис просит тише. Молча проглотить ошибку нельзя:
// «пуши вроде включены, но не приходят» — худший режим отладки.

import { prisma } from "@/lib/prisma"
import { encryptPushPayload } from "./encrypt"
import { createVapidSigner, type VapidKeyPair } from "./keys"
import { buildVapidHeaders, hasVapidKeys } from "./vapid"

/** Сколько ждём ответ push-сервиса. Дольше — смысла нет: сервисы отвечают быстро. */
const PUSH_TIMEOUT_MS = 10_000

/** Стандартный TTL: сутки. Дольше сервисы хранить не будут. */
const PUSH_TTL_SECONDS = 24 * 60 * 60

export type PushSubscriptionInput = {
  endpoint: string
  p256dh: string
  auth: string
}

export type PushMessage = {
  title: string
  body?: string
  /** Куда ведёт клик по уведомлению. */
  url?: string
  /** Группировка: уведомления с одним tag заменяют друг друга в браузере. */
  tag?: string
  /** Иконка — пути от корня сайта. */
  icon?: string
  /** Срочность: high показывать сразу (SOS), normal — обычная. */
  urgency?: "high" | "normal" | "low"
  /** Произвольные данные для service worker. */
  data?: Record<string, unknown>
}

export type PushSendResult =
  | { status: "sent"; httpStatus: number }
  | { status: "gone"; httpStatus: number }
  | { status: "failed"; httpStatus?: number; error: string }

/** Ключи и контакт из окружения. Пусто → пуши выключены. */
export function pushConfigFromEnv(env: NodeJS.ProcessEnv = process.env): {
  keys: VapidKeyPair | null
  subject: string
} {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() || ""
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() || ""
  return {
    keys: hasVapidKeys(env) ? { publicKey, privateKey } : null,
    subject: env.VAPID_SUBJECT?.trim() || "mailto:admin@loginex.local",
  }
}

/**
 * Отправка одного сообщения одной подписке.
 * Не бросает исключений: результат возвращается полем status, чтобы доставка
 * на десять устройств не падала из-за одного мёртвого.
 */
export async function sendPush(
  subscription: PushSubscriptionInput,
  message: PushMessage,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PushSendResult> {
  const { keys, subject } = pushConfigFromEnv(env)
  if (!keys) {
    return { status: "failed", error: "VAPID-ключи не заданы: пуши выключены" }
  }

  let signer: (input: string) => string
  try {
    signer = createVapidSigner(keys)
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "VAPID-ключи не работают",
    }
  }

  let body: Buffer
  try {
    const encrypted = encryptPushPayload({
      payload: JSON.stringify(message),
      clientPublicKey: subscription.p256dh,
      clientAuth: subscription.auth,
    })
    body = encrypted.body
  } catch (error) {
    // Битая подписка — не повод ронять всю доставку, но и молчать нельзя
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Не удалось зашифровать сообщение",
    }
  }

  try {
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        ...buildVapidHeaders({
          endpoint: subscription.endpoint,
          subject,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          sign: signer,
        }),
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "Content-Length": String(body.length),
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: message.urgency ?? "normal",
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    })

    if (response.status === 201 || response.status === 200) {
      return { status: "sent", httpStatus: response.status }
    }
    // 404/410 — браузер отозвал подписку: она больше не нужна
    if (response.status === 404 || response.status === 410) {
      return { status: "gone", httpStatus: response.status }
    }
    const detail = (await response.text().catch(() => "")).slice(0, 200)
    return {
      status: "failed",
      httpStatus: response.status,
      error: `push-сервис ответил ${response.status}${detail ? `: ${detail}` : ""}`,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { status: "failed", error: `Сеть: ${reason}` }
  }
}

export type DeliverSummary = {
  sent: number
  gone: number
  failed: number
  errors: string[]
}

/**
 * Доставка уведомления всем устройствам пользователя.
 * Мёртвые подписки удаляем сразу — иначе таблица растёт вечно, а каждый запрос
 * тратит время на заведомо неудачную отправку.
 */
export async function deliverPushToUser(
  userId: string,
  message: PushMessage,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeliverSummary> {
  const summary: DeliverSummary = { sent: 0, gone: 0, failed: 0, errors: [] }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  })

  if (subscriptions.length === 0) return summary

  for (const subscription of subscriptions) {
    const result = await sendPush(
      { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
      message,
      env,
    )

    if (result.status === "sent") {
      summary.sent += 1
      await prisma.pushSubscription
        .update({ where: { id: subscription.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined)
    } else if (result.status === "gone") {
      summary.gone += 1
      await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined)
    } else {
      summary.failed += 1
      summary.errors.push(`${result.error}`)
    }
  }

  return summary
}

/**
 * Пуши не должны ломать основное действие: если уведомление создано, а пуш не
 * ушёл — это не повод возвращать пользователю ошибку. Поэтому обёртка всегда
 * успешна, а провалы остаются в логе.
 */
export async function deliverPushSafely(
  userId: string,
  message: PushMessage,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeliverSummary | null> {
  try {
    return await deliverPushToUser(userId, message, env)
  } catch (error) {
    console.error(
      "[push] доставка не удалась:",
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}
