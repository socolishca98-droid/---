// lib/ati/http.ts
//
// Общая точка HTTP-соглашений ATI.SU: базовый адрес и обязательные заголовки
// из раздела документации «Требования и ограничения»
// (https://ati.su/developers/documentation/rules/):
//
//   * Authorization: Bearer <access_token организации>
//   * User-Agent: ati_integrator_<код в ATI.SU> — код выдаёт ATI интегратору
//   * Accept / Content-Type: application/json
//   * Accept-Encoding: gzip, deflate, br
//   * только https (TLS 1.2/1.3), редиректы 301/302 выполняются автоматически
//
// Модуль намеренно без Prisma и без Next.js: его можно импортировать из любых
// слоёв (lib/ati/contacts.ts, lib/ati-client.ts, lib/ati/connection.ts).

export const ATI_API_BASE = "https://api.ati.su"
export const ATI_OAUTH_AUTHORIZE_URL = "https://id.ati.su/oauth2/"
export const ATI_OAUTH_TOKEN_URL = `${ATI_API_BASE}/oauth2/token`

/** Код интегратора для User-Agent: выдаётся ATI на продукт (client_id). */
export function atiIntegratorCode(): string {
  return process.env.ATI_INTEGRATOR_CODE || process.env.ATI_CLIENT_ID || "unknown"
}

/** Обязательные заголовки запроса к ATI.SU с токеном конкретной организации. */
export function atiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": `ati_integrator_${atiIntegratorCode()}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Accept-Encoding": "gzip, deflate, br",
  }
}

/**
 * Текст ошибки по статусу ответа ATI — с подсказками из документации:
 * 429 — лимит запросов (10 rps на контакт; создание грузов — 500/сутки),
 * 401/403 — токен не принят, нужна переподключение.
 */
// =============================================================================
// ЧАСТОТА ЗАПРОСОВ
// =============================================================================
//
// Правила ATI.SU: не более 10 запросов/сек на контакт, при 429 —
// экспоненциальная задержка, начиная со 100 мс. Ниже — общий врапер:
//   * минимальный интервал между запросами одного ключа (организации) —
//     120 мс, то есть ~8 rps, с запасом под потолок ATI;
//   * на 429 — автоматический повтор 100 → 200 → 400 → 800 мс (до 4 раз),
//     а если ATI прислал Retry-After — выдерживаем его.
// Ключ — organizationId: лимиты ATI считаются на аккаунт организации,
// поэтому организации не мешают друг другу.

const MIN_INTERVAL_MS = 120
const MAX_429_RETRIES = 4
const nextSlotAt = new Map<string, number>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Выдерживает минимальный интервал между запросами одного ключа. */
async function pace(gateKey: string): Promise<void> {
  const now = Date.now()
  const slot = Math.max(now, nextSlotAt.get(gateKey) ?? 0)
  nextSlotAt.set(gateKey, slot + MIN_INTERVAL_MS)
  if (slot > now) await sleep(slot - now)
}

/**
 * fetch к ATI.SU с соблюдением лимитов: темп ~8 rps на организацию и
 * экспоненциальный ретрай на 429. Возвращает обычный Response — вызывающий
 * сам разбирает !ok через atiHttpError.
 */
export async function atiFetch(
  url: string,
  init: RequestInit = {},
  gateKey = "default",
): Promise<Response> {
  await pace(gateKey)
  let response = await fetch(url, init)
  for (let attempt = 0; response.status === 429 && attempt < MAX_429_RETRIES; attempt += 1) {
    const retryAfter = Number(response.headers.get("retry-after"))
    const backoff =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 100 * 2 ** attempt
    await sleep(backoff)
    await pace(gateKey)
    response = await fetch(url, init)
  }
  return response
}

export function atiHttpError(status: number, context: string): string {
  if (status === 429) {
    return `${context}: ATI.SU ограничил частоту запросов (429). Лимиты считаются на аккаунт организации — повторите позже.`
  }
  if (status === 401 || status === 403) {
    return `${context}: ATI.SU не принял токен (${status}). Переподключите аккаунт в разделе «Настройки».`
  }
  return `${context}: ATI.SU ответил ${status}`
}
