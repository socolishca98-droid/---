// lib/push/vapid.ts
//
// VAPID (RFC 8292): подпись запроса к push-сервису браузера.
//
// Зачем: push-сервис должен убедиться, что пуши рассылает тот сайт, которому
// браузер выдал разрешение. Для этого каждый запрос подписывается нашим
// приватным VAPID-ключом (ES256), а браузер знает наш публичный ключ.
//
// Ключи приходят из окружения (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY), здесь
// только сборка и подпись — без них модуль остаётся проверяемым в тестах:
// подписывающая функция передаётся снаружи.

/** base64url без паддинга — так пуши требуют ключи и JWT. */
export function toBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Обратное преобразование: base64url → байты. */
export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Адрес push-сервиса → origin (audience) для JWT.
 * https://fcm.googleapis.com/fcm/send/abc → https://fcm.googleapis.com
 */
export function vapidAudience(endpoint: string): string {
  try {
    return new URL(endpoint).origin
  } catch {
    throw new Error(`Некорректный адрес push-сервиса: ${endpoint}`)
  }
}

/** Подписывает строку «header.payload» по ES256. Синхронная: Node-овый crypto.sign синхронен. */
export type VapidSigner = (input: string) => string

export type VapidHeaderParams = {
  /** Полный адрес push-сервиса конкретной подписки. */
  endpoint: string
  /** mailto: или контакт отправителя — пуши без него отклоняются. */
  subject: string
  /** Публичный VAPID-ключ в base64url. */
  publicKey: string
  /** Приватный VAPID-ключ в base64url (для ES256). */
  privateKey: string
  /** Подписывает входные данные JWT (header.payload) по ES256. */
  sign: VapidSigner
  /** Время жизни токена: часовые пояса не важны, важно «сейчас + срок». */
  expirationMinutes?: number
  /** Момент подписи — для тестов. */
  now?: Date
}

export type VapidHeaders = Record<string, string>

/**
 * Заголовки авторизации для одного push-запроса:
 *   Authorization: vapid t=<jwt>, k=<публичный ключ>
 *   (k нужен только при отсутствии сообщения — с payload его знает сервис)
 */
export function buildVapidHeaders(params: VapidHeaderParams): VapidHeaders {
  const {
    endpoint,
    subject,
    publicKey,
    privateKey,
    sign,
    expirationMinutes = 12 * 60, // сутки: дольше сервисы не принимают
    now = new Date(),
  } = params

  if (!endpoint) throw new Error("Не задан адрес push-сервиса")
  if (!publicKey || !privateKey) throw new Error("Не заданы VAPID-ключи")

  const audience = vapidAudience(endpoint)
  const expiresAt = Math.floor(now.getTime() / 1000) + expirationMinutes * 60

  const header = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  )
  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        exp: expiresAt,
        sub: subject.startsWith("mailto:") || subject.startsWith("https:")
          ? subject
          : `mailto:${subject}`,
      }),
    ),
  )

  // Подпись считается по строке «header.payload» — как в любом JWT.
  const signature = sign(`${header}.${payload}`)
  if (!signature) throw new Error("VAPID-подпись не получена")

  return {
    Authorization: `vapid t=${header}.${payload}.${signature}, k=${publicKey}`,
    "Crypto-Key": `p256ecdsa=${publicKey}`,
  }
}

/**
 * Настроены ли VAPID-ключи в окружении (без них пуши просто выключены).
 * Тип нарочно широкий: сюда передают и process.env, и объект из тестов.
 */
export function hasVapidKeys(env: {
  VAPID_PUBLIC_KEY?: string | undefined
  VAPID_PRIVATE_KEY?: string | undefined
  [key: string]: string | undefined
}): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim())
}
