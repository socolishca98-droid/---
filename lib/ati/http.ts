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
export function atiHttpError(status: number, context: string): string {
  if (status === 429) {
    return `${context}: ATI.SU ограничил частоту запросов (429). Лимиты считаются на аккаунт организации — повторите позже.`
  }
  if (status === 401 || status === 403) {
    return `${context}: ATI.SU не принял токен (${status}). Переподключите аккаунт в разделе «Организация».`
  }
  return `${context}: ATI.SU ответил ${status}`
}
