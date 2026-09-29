// lib/ati/connection.ts
//
// Подключение организации к ATI.SU: у каждой организации СВОЙ аккаунт ATI,
// свой токен, свои площадки и своя подписка. Общий токен из .env больше не
// используется — он смешивал данные и лимиты всех организаций в одни.
//
// Как это работает по официальной документации ATI.SU
// (https://ati.su/developers/):
//
//  1. Продукт (мы) как интегратор получает в ATI client_id (и client_secret
//     для OAuth) — один на всё ПО, заявкой в поддержку ATI.
//  2. Каждая организация получает доступ одним из двух способов:
//     a) OAuth 2.0 (рекомендуемый): кнопка «Подключить через ATI.SU» ведёт
//        пользователя на https://id.ati.su/oauth2/, после согласия мы
//        обмениваем code на access_token (2 часа) + refresh_token и храним
//        их зашифрованными, автоматически обновляя;
//     b) Постоянный токен: пользователь сам создаёт токен в разделе
//        «Мои токены» (https://ati.su/developers/tokens/) по нашему
//        client_id и вставляет его в настройках организации.
//  3. Все запросы к api.ati.su идут с токеном организации и обязательными
//     заголовками (User-Agent: ati_integrator_<код>, Accept, Content-Type,
//     Accept-Encoding: gzip) — их требует раздел «Требования и ограничения».
//  4. Лимиты ATI считаются НА КОНТАКТ организации: 10 запросов/сек,
//     создание грузов 500/сутки на контакт. Свои лимиты каждая организация
//     расходует сама — чужие не занимаем.

import { prisma } from "@/lib/prisma"
import { scopedWhere } from "@/lib/org"
import { decryptSecret, encryptSecret } from "@/lib/ati/secrets"
import {
  atiHeaders,
  atiHttpError,
  ATI_API_BASE,
  ATI_OAUTH_AUTHORIZE_URL,
  ATI_OAUTH_TOKEN_URL,
} from "@/lib/ati/http"

export { atiHeaders, atiIntegratorCode, ATI_API_BASE } from "@/lib/ati/http"

/** OAuth доступен, когда продукту выданы client_id и client_secret. */
export function oauthAvailable(): boolean {
  return Boolean(process.env.ATI_CLIENT_ID && process.env.ATI_CLIENT_SECRET)
}

export type AtiTokenResult =
  | { ok: true; token: string; connectionId: string }
  | { ok: false; code: "ati_not_connected" | "invalid"; error: string }

const NOT_CONNECTED: AtiTokenResult & { ok: false } = {
  ok: false,
  code: "ati_not_connected",
  error:
    "Организация не подключена к ATI.SU. Подключите свой аккаунт в разделе «Организация»: у каждой организации собственный токен, площадки и подписка ATI.",
}

const INVALID: AtiTokenResult & { ok: false } = {
  ok: false,
  code: "invalid",
  error: "Токен ATI.SU недействителен. Переподключите аккаунт в разделе «Организация».",
}

/**
 * Рабочий access_token организации. Для OAuth-подключения автоматически
 * обновляет токен по refresh_token, когда срок действия (2 часа) истекает.
 */
export async function getActiveAtiToken(organizationId: string): Promise<AtiTokenResult> {
  const connection = await prisma.atiConnection.findFirst({
    where: scopedWhere(organizationId, {}),
  })
  if (!connection) return NOT_CONNECTED
  if (connection.status === "invalid") return INVALID

  let token = decryptSecret(connection.tokenEncrypted)
  if (!token) return INVALID

  // OAuth: access_token живёт 2 часа — обновляем заранее по refresh_token
  const expiresSoon =
    connection.expiresAt !== null &&
    connection.expiresAt.getTime() - Date.now() < 5 * 60 * 1000
  if (connection.kind === "oauth" && expiresSoon) {
    const refreshed = await refreshOAuthToken(connection.id, organizationId)
    if (!refreshed.ok) return refreshed
    token = refreshed.token
  }

  return { ok: true, token, connectionId: connection.id }
}

/** Обмен refresh_token на новую пару токенов. */
async function refreshOAuthToken(
  connectionId: string,
  organizationId: string,
): Promise<AtiTokenResult> {
  const connection = await prisma.atiConnection.findFirst({
    where: scopedWhere(organizationId, { id: connectionId }),
  })
  if (!connection?.refreshTokenEncrypted) return INVALID
  const refreshToken = decryptSecret(connection.refreshTokenEncrypted)
  if (!refreshToken) return INVALID
  if (!oauthAvailable()) {
    await prisma.atiConnection.update({
      where: { id: connectionId },
      data: {
        status: "invalid",
        lastError: "OAuth-обновление недоступно: на сервере не заданы ATI_CLIENT_ID/ATI_CLIENT_SECRET",
        lastCheckAt: new Date(),
      },
    })
    return INVALID
  }

  try {
    const response = await fetch(ATI_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.ATI_CLIENT_ID,
        client_secret: process.env.ATI_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`ATI ответил ${response.status}`)
    const data: any = await response.json()
    if (!data?.access_token) throw new Error("ATI не вернул access_token")

    await prisma.atiConnection.update({
      where: { id: connectionId },
      data: {
        tokenEncrypted: encryptSecret(String(data.access_token)),
        refreshTokenEncrypted: data.refresh_token
          ? encryptSecret(String(data.refresh_token))
          : connection.refreshTokenEncrypted,
        expiresAt: data.expire_time ? new Date(data.expire_time) : null,
        firmId: data.firm_id != null ? String(data.firm_id) : connection.firmId,
        contactId: data.contact_id != null ? String(data.contact_id) : connection.contactId,
        status: "active",
        lastError: null,
        lastCheckAt: new Date(),
      },
    })
    return { ok: true, token: String(data.access_token), connectionId }
  } catch (error: any) {
    await prisma.atiConnection.update({
      where: { id: connectionId },
      data: {
        status: "invalid",
        lastError: `Не удалось обновить токен: ${error?.message ?? "ошибка"}`,
        lastCheckAt: new Date(),
      },
    })
    return INVALID
  }
}

/** Сохранить постоянный токен, введённый пользователем вручную. */
export async function saveManualToken(organizationId: string, token: string) {
  const clean = token.trim()
  if (!clean) throw new Error("Пустой токен")
  const data = {
    tokenEncrypted: encryptSecret(clean),
    kind: "token",
    refreshTokenEncrypted: null,
    expiresAt: null,
    // статус сбрасываем: токен новый, его надо проверить
    status: "unverified",
    lastError: null,
  }
  const existing = await prisma.atiConnection.findFirst({
    where: scopedWhere(organizationId, {}),
    select: { id: true },
  })
  if (existing) {
    await prisma.atiConnection.update({ where: { id: existing.id }, data })
    return existing.id
  }
  const created = await prisma.atiConnection.create({
    data: { ...data, organizationId },
  })
  return created.id
}

/**
 * Живая проверка токена: GET /v1.0/firms/my — фирма, на которую выдан токен.
 * Заодно заполняет firmId/firmName: их видно в настройках организации.
 */
export async function verifyConnection(organizationId: string) {
  const connection = await prisma.atiConnection.findFirst({
    where: scopedWhere(organizationId, {}),
  })
  if (!connection) return NOT_CONNECTED
  const token = decryptSecret(connection.tokenEncrypted)
  if (!token) return INVALID

  try {
    const response = await fetch(`${ATI_API_BASE}/v1.0/firms/my`, {
      headers: atiHeaders(token),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    })
    if (!response.ok) {
      const message = atiHttpError(response.status, "Проверка подключения")
      await prisma.atiConnection.update({
        where: { id: connection.id },
        data: { status: "invalid", lastError: message, lastCheckAt: new Date() },
      })
      return { ok: false as const, code: "invalid" as const, error: message }
    }

    const firm: any = await response.json()
    const firmId = firm?.id != null ? String(firm.id) : null
    const firmName = firm?.name ?? firm?.firm?.name ?? null
    await prisma.atiConnection.update({
      where: { id: connection.id },
      data: {
        status: "active",
        firmId,
        firmName,
        lastError: null,
        lastCheckAt: new Date(),
      },
    })
    return { ok: true as const, firmId, firmName }
  } catch (error: any) {
    const message = `Нет связи с ATI.SU: ${error?.message ?? "ошибка сети"}`
    await prisma.atiConnection.update({
      where: { id: connection.id },
      data: { lastError: message, lastCheckAt: new Date() },
    })
    return { ok: false as const, code: "network" as const, error: message }
  }
}

/** Отключить организацию от ATI.SU (токен удаляется безвозвратно). */
export async function disconnectAti(organizationId: string) {
  await prisma.atiConnection.deleteMany({ where: scopedWhere(organizationId, {}) })
}

/** Состояние подключения для UI — БЕЗ токена, только метаданные. */
export async function connectionStatus(organizationId: string) {
  const connection = await prisma.atiConnection.findFirst({
    where: scopedWhere(organizationId, {}),
    select: {
      id: true,
      kind: true,
      status: true,
      firmId: true,
      firmName: true,
      contactId: true,
      expiresAt: true,
      lastCheckAt: true,
      lastError: true,
    },
  })
  return {
    connected: Boolean(connection),
    oauthAvailable: oauthAvailable(),
    connection: connection
      ? {
          ...connection,
          expiresAt: connection.expiresAt?.toISOString() ?? null,
          lastCheckAt: connection.lastCheckAt?.toISOString() ?? null,
        }
      : null,
  }
}

/** Шаг 3 OAuth: ссылка на согласие ATI.SU (redirect_uri — наш callback). */
export function buildOAuthStartUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.ATI_CLIENT_ID || "",
    scope: "impact_scope",
    redirect_uri: redirectUri,
    response_type: "code",
  })
  return `${ATI_OAUTH_AUTHORIZE_URL}?${params.toString()}`
}

/** Шаг 5 OAuth: обмен code на токены и сохранение подключения организации. */
export async function exchangeOAuthCode(organizationId: string, code: string, redirectUri: string) {
  if (!oauthAvailable()) {
    return {
      ok: false as const,
      error: "OAuth не настроен на сервере: задайте ATI_CLIENT_ID и ATI_CLIENT_SECRET в .env",
    }
  }
  try {
    const response = await fetch(ATI_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.ATI_CLIENT_ID,
        client_secret: process.env.ATI_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data: any = await response.json().catch(() => ({}))
    if (!response.ok || !data?.access_token) {
      const reason = data?.reason || data?.error || `ATI ответил ${response.status}`
      return { ok: false as const, error: `Не удалось обменять код на токен: ${reason}` }
    }

    const values = {
      tokenEncrypted: encryptSecret(String(data.access_token)),
      refreshTokenEncrypted: data.refresh_token ? encryptSecret(String(data.refresh_token)) : null,
      kind: "oauth",
      expiresAt: data.expire_time ? new Date(data.expire_time) : null,
      firmId: data.firm_id != null ? String(data.firm_id) : null,
      contactId: data.contact_id != null ? String(data.contact_id) : null,
      status: "active",
      lastError: null,
      lastCheckAt: new Date(),
    }
    const existing = await prisma.atiConnection.findFirst({
      where: scopedWhere(organizationId, {}),
      select: { id: true },
    })
    if (existing) {
      await prisma.atiConnection.update({ where: { id: existing.id }, data: values })
    } else {
      await prisma.atiConnection.create({ data: { ...values, organizationId } })
    }
    return { ok: true as const, firmId: values.firmId }
  } catch (error: any) {
    return { ok: false as const, error: `Нет связи с ATI.SU: ${error?.message ?? "ошибка"}` }
  }
}
