// components/dashboard/map/html.ts
//
// Маркеры и попапы Leaflet собираются как HTML-строки. Данные в них приходят
// с сервера (имена водителей, адреса клиентов, названия рейсов), поэтому всё
// пользовательское экранируется: иначе адрес вроде
// «<img src=x onerror=alert(1)>» выполнялся бы прямо на дашборде.

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
}

/** Безопасная вставка значения в HTML-строку маркера или попапа. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).replace(/[&<>"'`]/g, (char) => ESCAPE_MAP[char] ?? char)
}

/** То же, но с запасным текстом для пустых значений («—»). */
export function escapeOrDash(value: unknown, fallback = "—"): string {
  const text = escapeHtml(value).trim()
  return text.length > 0 ? text : fallback
}
