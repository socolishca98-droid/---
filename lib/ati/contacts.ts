// lib/ati/contacts.ts
//
// Контакты фрахтователя — ТОЛЬКО по нажатию кнопки.
//
// Почему так, а не автоматически:
//
// Пользовательское соглашение ATI.SU, п. 3.2.1.7: «Не осуществлять никаких
// действий, включая накопление, сбор, обработку, запись и тому подобные
// действия, в отношении адресов электронной почты или любой иной контактной
// информации Участников ATI.SU, ставшей известной Участнику ATI.SU в процессе
// использования Сайта, АВТОМАТИЗИРОВАННЫМИ способами».
//
// П. 3.2.1.8: «Не использовать автоматизированные скрипты (программы) для
// сбора информации или взаимодействия с Сайтом или предоставляемыми Сайтом
// сервисами, КРОМЕ сервисов, созданных Администрацией специально для таких
// случаев».
//
// Мы идём ровно по разрешённому пути:
//   * контакт берётся официальным документированным методом API ATI
//     (GET /v1.0/firms/{atiId}/contacts/summary) — это и есть сервис,
//     созданный Администрацией для такой задачи;
//   * запрос уходит ТОЛЬКО когда диспетчер нажал кнопку «Показать контакты»,
//     ровно как он сам нажимает «показать» на сайте ATI;
//   * результат показывается и остаётся у него в заказе — мы не копим базу
//     чужих контактов и не пересылаем их дальше.
//
// Лимит ATI на реквизиты других фирм — 1000 запросов в сутки. Мы держим свой
// лимит ниже (50 на организацию в сутки): запас нужен, чтобы исчерпание
// дневного лимита ATI не превратилось в отказ по всей бирже.

import { atiFetch, atiHeaders } from "./http"

export type FirmContacts = {
  phone: string | null
  mobile: string | null
  email: string | null
  name: string | null
  city: string | null
  firmName: string | null
  /** Результат показа — чтобы не врать «контактов нет», когда их просто скрыли */
  shown: boolean
}

/** Свой дневной лимит на организацию — с запасом до лимита ATI (1000/сутки). */
export const CONTACTS_DAILY_LIMIT = 50

/**
 * Контакты фрахтователя по коду фирмы в ATI.
 *
 * atiId — код фирмы (firm.id из груза биржи), не id записи в нашей базе.
 */
export async function fetchFirmContacts(
  atiId: string,
  token: string | null,
  organizationId: string,
): Promise<FirmContacts> {
  const empty: FirmContacts = {
    phone: null,
    mobile: null,
    email: null,
    name: null,
    city: null,
    firmName: null,
    shown: false,
  }
  if (!token || !atiId) return empty

  const res = await atiFetch(
    `https://api.ati.su/v1.0/firms/${encodeURIComponent(atiId)}/contacts/summary`,
    { headers: atiHeaders(token), signal: AbortSignal.timeout(20_000) },
    organizationId,
  )
  if (!res.ok) return empty

  const rows: any = await res.json().catch(() => null)
  const list = Array.isArray(rows) ? rows : []
  // Первый ВИДИМЫЙ контакт: в ответе бывают скрытые — их телефон приходит пустым
  const contact =
    list.find((row) => row?.phone || row?.mobile_phone || row?.email) ?? list[0] ?? null
  if (!contact) return empty

  return {
    phone: str(contact.phone),
    mobile: str(contact.mobile_phone),
    email: str(contact.email),
    name: str(contact.name),
    city: str(contact.city ?? contact.contact_city),
    firmName: str(contact.firm_name),
    shown: Boolean(contact.phone || contact.mobile_phone || contact.email),
  }
}

function str(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return text || null
}
