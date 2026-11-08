// lib/cargomart/client.ts
//
// Разъём Cargomart: транспорт к api/v2/order. Отдан под флаг
// CARGOMART_ENABLED (по умолчанию выключен — из продукта не вызывается
// ничего), реальная сеть — только при явном токене в env. Без токена
// разъём отвечает локальным моком: сборка конвейера проверяется без
// аккаунта и без единого запроса в чужой сервис.
//
// Контакты грузовладельцев не запрашиваются ВООБЩЕ: эндпоинт контактов
// не вызывается (правило продукта: контакты — осознанное действие).

export type { CargomartLoadRaw, CargomartDictionaries, CargomartMappedLoad } from "./mapping"
import { mapCargomartLoad, type CargomartLoadRaw, type CargomartDictionaries, type CargomartMappedLoad } from "./mapping"

/** База api/v2 Cargomart. */
const CARGOMART_API_BASE = "https://cargomart.ru"

/** Потолок страниц одного скана: биржу не дёргаем сверх разумного. */
const MAX_PAGES = 5

/** Разъём включён? Флаг выключен — из продукта не вызывается ничего. */
export function cargomartEnabled(): boolean {
  return (process.env.CARGOMART_ENABLED ?? "").toLowerCase() === "on"
}

/** Токен есть? Без токена транспорт всегда мок. */
export function cargomartToken(): string | null {
  const token = (process.env.CARGOMART_TOKEN ?? "").trim()
  return token.length > 0 ? token : null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Мок-ответ «списка грузов» в структуре api/v2/order: data.order[] + словари.
 * Города — с регионами (как требует внутренняя модель), вес в килограммах.
 *
 * Идентификаторы — с серией cm2: накопленная база не переписывает уже
 * записанные грузы (логист мог взять их в работу), поэтому при смене
 * мок-данных меняется и серия id — новая серия пишется новыми строками,
 * а старые живут до своего TTL.
 */
export function cargomartMockPage(): {
  data: { order: CargomartLoadRaw[] } & CargomartDictionaries
} {
  const day = (shift: number) =>
    new Date(Date.now() + shift * 24 * 60 * 60 * 1000).toISOString()
  return {
    data: {
      order: [
        {
          id: "mock-cm2-001",
          current_price: "55000",
          vat_rate: 20,
          is_consignor_vat: true,
          weight: 12000,
          capacity: 60,
          kind: 1,
          truck_type_id: 1,
          consignor_id: "hash-consignor-11",
          loading: { code: "6900000100000", date: day(1) },
          unloading: { code: "7600000100000", date: day(2) },
        },
        {
          id: "mock-cm2-002",
          current_price: "47500",
          vat_rate: null,
          is_consignor_vat: false,
          weight: 9000,
          capacity: 45,
          kind: 1,
          truck_type_id: 2,
          consignor_id: "hash-consignor-22",
          loading: { code: "7600000100000", date: day(1) },
          unloading: { code: "5200000100000", date: day(2) },
        },
        {
          id: "mock-cm2-003",
          current_price: "126000",
          vat_rate: 20,
          is_consignor_vat: true,
          weight: 20000,
          capacity: 92,
          kind: 1,
          truck_type_id: 1,
          consignor_id: "hash-consignor-33",
          loading: { code: "7800000200000", date: day(2) },
          unloading: { code: "5200000100000", date: day(3) },
        },
      ],
      locality: {
        "6900000100000": { name: "Тверь", region: "Тверская область" },
        "7600000100000": { name: "Ярославль", region: "Ярославская область" },
        "5200000100000": { name: "Нижний Новгород", region: "Нижегородская область" },
        "7800000200000": { name: "Санкт-Петербург", region: "Санкт-Петербург" },
      },
      company: {
        "hash-consignor-11": { short_name: 'ООО "Мок-Отправитель №1"' },
        "hash-consignor-22": { short_name: 'ООО "Мок-Отправитель №2"' },
        "hash-consignor-33": { short_name: 'ООО "Мок-Отправитель №3"' },
      },
      truck_type: { "1": { name: "Тент" }, "2": { name: "Фургон" } },
    },
  }
}

export type CargomartSearchParams = {
  /** Код КЛАДР пункта отправления (фильтр биржи) */
  departureCode?: string | null
  /** Радиус отправления, км */
  departureRadiusKm?: number | null
  /** Вес от/до, кг */
  weightFromKg?: number | null
  weightToKg?: number | null
  /** Сколько страниц обойти (по умолчанию потолок разъёма) */
  maxPages?: number
}

export type CargomartSearchResult = {
  loads: CargomartMappedLoad[]
  /** Мок это или живой ответ площадки */
  mock: boolean
  /** Сколько страниц прочитано */
  pages: number
  /** Ошибка транспорта — сборка не удалась целиком */
  error: string | null
}

/**
 * Поиск грузов Cargomart. Фильтры — параметры GET /api/v2/order
 * (filter_departure, filter_departure_radius, filter_weight_from/to, …).
 *
 * Внутренний пэйджинг ответа (data.pagination) пока не размётан в спеке
 * клиента — обходим страницы по per_page/page, потолок MAX_PAGES.
 */
export async function searchCargomartLoads(
  params: CargomartSearchParams = {},
): Promise<CargomartSearchResult> {
  const token = cargomartToken()
  const maxPages = Math.min(params.maxPages ?? MAX_PAGES, MAX_PAGES)
  const loads: CargomartMappedLoad[] = []
  let pages = 0

  if (!token) {
    // Мок-транспорт: одна страница, никаких запросов в сеть
    const page = cargomartMockPage()
    for (const raw of page.data.order) {
      const mapped = mapCargomartLoad(raw, {
        locality: page.data.locality,
        company: page.data.company,
        truck_type: page.data.truck_type,
      })
      if (mapped) loads.push(mapped)
    }
    return { loads, mock: true, pages: 1, error: null }
  }

  // Живой транспорт: авторизация заголовком Authorization: <token>.
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const query = new URLSearchParams()
      query.set("page", String(page))
      query.set("per_page", "50")
      if (params.departureCode) query.set("filter_departure", params.departureCode)
      if (params.departureRadiusKm) query.set("filter_departure_radius", String(params.departureRadiusKm))
      if (params.weightFromKg) query.set("filter_weight_from", String(params.weightFromKg))
      if (params.weightToKg) query.set("filter_weight_to", String(params.weightToKg))

      const response = await fetch(`${CARGOMART_API_BASE}/api/v2/order?${query.toString()}`, {
        headers: {
          // Cargomart v2: заголовок Authorization без префикса Bearer
          Authorization: token,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) {
        return {
          loads: [],
          mock: false,
          pages,
          error: `Cargomart ответил ${response.status}`,
        }
      }
      const body = (await response.json()) as {
        data?: { order?: CargomartLoadRaw[] } & CargomartDictionaries
      }
      const orders = body.data?.order ?? []
      pages = page
      for (const raw of orders) {
        const mapped = mapCargomartLoad(raw, {
          locality: body.data?.locality,
          company: body.data?.company,
          truck_type: body.data?.truck_type,
        })
        if (mapped) loads.push(mapped)
      }
      if (orders.length === 0) break
      // Пауза между страницами: без документов о лимитах ведём себя скромно.
      if (page < maxPages) await sleep(500)
    }
    return { loads, mock: false, pages, error: null }
  } catch (error) {
    return {
      loads: [],
      mock: false,
      pages,
      error: error instanceof Error ? error.message : "Cargomart: транспорт недоступен",
    }
  }
}
