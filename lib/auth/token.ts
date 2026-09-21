/**
 * Подписанные сессионные токены (формат JWT, alg=HS256) на Web Crypto API.
 *
 * Web Crypto доступен и в edge-окружении middleware, и в Node 18+,
 * поэтому ОДИН и тот же код проверки подписи работает и там, и там —
 * без дублирования логики и без внешних зависимостей.
 *
 * Токен — это только «пропуск» до проверки в БД: окончательно доступ
 * подтверждает lib/auth/session.ts (статус пользователя, отзыв сессии, срок).
 */

import type { UserRole } from "./constants"

export type SessionKind = "staff" | "driver"

export interface SessionTokenPayload {
  /** id пользователя (User.id) */
  sub: string
  /** роль на момент выпуска токена */
  role: UserRole
  /** staff — сотрудник, driver — водитель */
  kind: SessionKind
  /** id строки Session в БД (jti) — по нему сессия отзывается */
  jti: string
  /** выдан (секунды с эпохи) */
  iat: number
  /** истекает (секунды с эпохи) */
  exp: number
  /** id карточки Driver — только для kind = "driver" */
  driverId?: string
  /** отображаемое имя (не секрет, используется для быстрого рендера) */
  name?: string
}

const ALGORITHM = "HS256"
const TOKEN_HEADER = { alg: ALGORITHM, typ: "JWT" } as const

export class AuthSecretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthSecretError"
  }
}

/** Секрет подписи. Падение здесь — намеренное: без секрета авторизация невозможна,
 *  а «тихий» режим означал бы открытую систему. */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.trim().length === 0) {
    throw new AuthSecretError(
      "AUTH_SECRET не задан. Добавьте его в .env (см. .env.example): " +
        'node -e "console.log(require(\'node:crypto\').randomBytes(48).toString(\'hex\'))"',
    )
  }
  if (secret.trim().length < 32) {
    throw new AuthSecretError("AUTH_SECRET слишком короткий: нужно минимум 32 символа")
  }
  return secret.trim()
}

// ---------------------------------------------------------------------------
// base64url: работает и в edge, и в Node (btoa/atob глобальны в Node 16+)
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  // Явный ArrayBuffer: Uint8Array<ArrayBufferLike> не принимается Web Crypto в TS 5.9
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function textToBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text))
}

function base64UrlToText(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value))
}

// ---------------------------------------------------------------------------
// HMAC
// ---------------------------------------------------------------------------

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

async function hmac(key: CryptoKey, data: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))
  return bytesToBase64Url(new Uint8Array(signature))
}

// ---------------------------------------------------------------------------
// Выпуск и проверка
// ---------------------------------------------------------------------------

/** Подписать токен сессии */
export async function signSessionToken(
  payload: SessionTokenPayload,
  secret: string = getAuthSecret(),
): Promise<string> {
  const key = await importKey(secret)
  const headerPart = textToBase64Url(JSON.stringify(TOKEN_HEADER))
  const payloadPart = textToBase64Url(JSON.stringify(payload))
  const signingInput = `${headerPart}.${payloadPart}`
  const signature = await hmac(key, signingInput)
  return `${signingInput}.${signature}`
}

function isPayload(value: unknown): value is SessionTokenPayload {
  if (!value || typeof value !== "object") return false
  const p = value as Record<string, unknown>
  return (
    typeof p.sub === "string" &&
    p.sub.length > 0 &&
    typeof p.jti === "string" &&
    p.jti.length > 0 &&
    typeof p.exp === "number" &&
    typeof p.iat === "number" &&
    (p.role === "admin" || p.role === "logist" || p.role === "driver") &&
    (p.kind === "staff" || p.kind === "driver")
  )
}

/**
 * Проверить подпись и срок действия токена.
 * Возвращает payload либо null — никаких исключений, чтобы middleware
 * не падал на «мусорных» cookie.
 */
export async function verifySessionToken(
  token: string | undefined | null,
  secret: string = getAuthSecret(),
): Promise<SessionTokenPayload | null> {
  if (!token || typeof token !== "string") return null

  const parts = token.split(".")
  if (parts.length !== 3) return null

  const [headerPart, payloadPart, signaturePart] = parts
  if (!headerPart || !payloadPart || !signaturePart) return null

  try {
    const header = JSON.parse(base64UrlToText(headerPart)) as { alg?: string; typ?: string }
    if (header?.alg !== ALGORITHM) return null

    const key = await importKey(secret)
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    )
    if (!valid) return null

    const payload = JSON.parse(base64UrlToText(payloadPart)) as unknown
    if (!isPayload(payload)) return null

    const nowSec = Math.floor(Date.now() / 1000)
    if (payload.exp <= nowSec) return null
    // защита от токенов «из будущего» (сдвиг часов) — 5 минут запаса
    if (payload.iat > nowSec + 300) return null

    return payload
  } catch {
    return null
  }
}

/** Собрать payload токена из данных пользователя */
export function buildTokenPayload(params: {
  userId: string
  role: UserRole
  kind: SessionKind
  sessionId: string
  name?: string
  driverId?: string | null
  ttlMs: number
}): SessionTokenPayload {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    sub: params.userId,
    role: params.role,
    kind: params.kind,
    jti: params.sessionId,
    iat: nowSec,
    exp: nowSec + Math.floor(params.ttlMs / 1000),
    name: params.name,
    ...(params.driverId ? { driverId: params.driverId } : {}),
  }
}

export { bytesToBase64Url, base64UrlToBytes }
