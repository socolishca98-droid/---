// lib/ati/contacts.ts
//
// Контакты фирмы из ATI.su. Модуль намеренно без Prisma и без Next.js:
//   * живой запрос к ATI выполняется ТОЛЬКО по явному действию пользователя
//     (флаг fetchContacts), а не при каждом поиске или скане;
//   * без токена функция молча возвращает пустые контакты — приложение
//     работает и без доступа к ATI;
//   * модуль можно импортировать из API-роутов, не подключая клиент базы.

import { atiHeaders, ATI_API_BASE } from "./http"

export type FirmContacts = {
  phone: string | null
  name: string | null
  email: string | null
}

const EMPTY: FirmContacts = { phone: null, name: null, email: null }

/**
 * Контакты фирмы по её идентификатору в ATI. Только по явному запросу и
 * только с токеном ОРГАНИЗАЦИИ (каждый запрос идёт в её аккаунт и тратит её
 * лимиты). Без токена — пустые контакты: приложение работает и без ATI.
 */
export async function fetchFirmContacts(
  firmId: string | number,
  token: string | null,
): Promise<FirmContacts> {
  if (!token) return { ...EMPTY }

  try {
    const res = await fetch(`${ATI_API_BASE}/v1.0/firms/${firmId}`, {
      headers: atiHeaders(token),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return { ...EMPTY }

    const firmData = await res.json()
    let phone: string | null = null
    let name: string | null = null
    let email: string | null = null

    if (Array.isArray(firmData.contacts) && firmData.contacts.length > 0) {
      const contact = firmData.contacts[0]
      if (contact?.name) name = contact.name

      if (Array.isArray(contact?.phones)) {
        const phones = contact.phones
          .map((p: any) => p.number || p.phone)
          .filter(Boolean)
        if (phones.length > 0) phone = phones.join(", ")
      }

      if (Array.isArray(contact?.emails)) {
        email = contact.emails[0]?.email || null
      }
    }

    if (!phone && firmData.phone) phone = firmData.phone
    if (!name && firmData.contact_name) name = firmData.contact_name

    return { phone, name, email }
  } catch (error) {
    console.error("[fetchFirmContacts] Error:", error)
    return { ...EMPTY }
  }
}
