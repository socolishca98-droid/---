// lib/ati/exchange-client.ts
// Клиент ОБЩЕЙ биржи ATI: поиск грузов по всей России.
//
// Зачем: официальный API ATI.SU отдаёт грузы ТОЛЬКО с площадок организации
// (метод /v1.0/loads/search/byboards; общая площадка в API исключена —
// «Искать можно только по площадкам, доступным вашей фирме»). Перевозчику,
// которого не пустили на площадки из-за низкого рейтинга, официальный API
// выдаёт ноль грузов, хотя на бирже их тысячи.
//
// Этот модуль обращается к тому же поиску, который использует сам сайт
// loads.ati.su в браузере, — с токеном и организацией самого пользователя.
// Проверено на бою: «Ярославль, радиус 300» → 2 963 груза (официальный API
// давал 0), без фильтра городов → 180 072 груза со всей России.
//
// Важно про аккуратность: лимит ATI — 10 запросов в секунду на контакт
// (правила API). Между страницами держим паузу, количество страниц за один
// сбор ограничено, поэтому мы не превращаемся в нагрузку на биржу.
//
// Модуль намеренно отдельный: официальный источник (lib/ati-client.ts,
// byboards) и общая биржа работают независимо и не мешают друг другу.

import { atiFetch } from "./http"
import {
  EXCHANGE_ITEMS_PER_PAGE,
  EXCHANGE_MAX_PAGES,
  EXCHANGE_SEARCH_URL,
  buildExchangeFilter,
  mapExchangeLoad,
  type ExchangeMappedLoad,
} from "./exchange-mapping"

/** Пауза между страницами, мс: правила ATI — не чаще 10 запросов в секунду. */
const PAUSE_BETWEEN_PAGES_MS = 350

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type ExchangeSearchParams = {
  /** id города ATI «откуда»; 0 — без фильтра */
  fromCityId?: number | null
  toCityId?: number | null
  fromRadiusKm?: number
  toRadiusKm?: number
  /** Сколько страниц обойти (по умолчанию — ограничение модуля) */
  maxPages?: number
  /** С какой страницы начать: обход «Собрать регион» уходит глубже с каждым нажатием */
  pageStart?: number
}

export type ExchangeSearchResult = {
  loads: ExchangeMappedLoad[]
  /** Сколько грузов биржа обещает по этому фильтру */
  totalItems: number
  /** Сколько грузов принадлежит «корневым» публикациям (без дублей) */
  rootCount: number
  pages: number
  requests: number
  /** Признаки, которые сайт возвращает вместе с выдачей */
  flags: {
    loadBoardsNotAvailable?: unknown
    auctionsNotAvailable?: unknown
    isUserNotFullyRegistered?: boolean
  }
}

/**
 * Поиск по общей бирже: страницы → грузы во внутреннем формате.
 *
 * Ошибки сети не бросаем наружу исключением без нужды: экран должен сказать
 * словами, что не получилось, а не упасть.
 */
export async function searchExchange(
  token: string,
  organizationId: string,
  params: ExchangeSearchParams,
): Promise<ExchangeSearchResult> {
  const filter = buildExchangeFilter({
    fromCityId: params.fromCityId,
    toCityId: params.toCityId,
    fromRadiusKm: params.fromRadiusKm,
    toRadiusKm: params.toRadiusKm,
  })

  const maxPages = Math.max(1, Math.min(Number(params.maxPages) || EXCHANGE_MAX_PAGES, EXCHANGE_MAX_PAGES))
  const loads: ExchangeMappedLoad[] = []
  const seen = new Set<string>()
  let totalItems = 0
  let rootCount = 0
  let pages = 0
  let requests = 0
  const flags: ExchangeSearchResult["flags"] = {}

  const pageStart = Math.max(1, Number(params.pageStart) || 1)
  for (let page = pageStart; page < pageStart + maxPages; page += 1) {
    // Заголовки — как у браузера на loads.ati.su: токен и в Authorization, и
    // в cookie sid (сайт присылает оба). Темп запросов держит atiFetch:
    // ~8 rps на организацию с ретраем на 429 — потолок ATI 10 rps.
    const res = await atiFetch(
      EXCHANGE_SEARCH_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: `sid=${token};`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
          Referer: "https://loads.ati.su/",
          Origin: "https://loads.ati.su",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          exclude_geo_dicts: true,
          page,
          items_per_page: EXCHANGE_ITEMS_PER_PAGE,
          filter,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      },
      organizationId,
    )
    requests += 1

    if (!res.ok) {
      // Конец выборки, а не сбой: когда запрошена страница за последней,
      // ATI отвечает 404 (а не пустым списком). Раньше это бросало ошибку и
      // весь поиск обнулялся — диспетчер видел «0 грузов» при 85 реальных.
      // Поэтому на глубине просто заканчиваем обход и отдаём собранное.
      if (page > pageStart) break
      const reason = await res.text().catch(() => "")
      throw new Error(
        `Биржа ATI ответила ${res.status}${reason ? `: ${reason.slice(0, 160)}` : ""}`,
      )
    }

    const data: any = await res.json().catch(() => null)
    if (!data) break

    // Счётчики читаем с первой ПОЛУЧЕННОЙ страницы, а не с page === 1:
    // при продолжении обхода (pageStart) первая страница другая, и без этого
    // «всего по фильтру» показывалось бы нулём.
    if (pages === 0) {
      totalItems = Number(data.totalItems) || 0
      rootCount = Number(data.rootCount) || 0
      flags.loadBoardsNotAvailable = data.loadBoardsNotAvailable
      flags.auctionsNotAvailable = data.auctionsNotAvailable
      flags.isUserNotFullyRegistered = Boolean(data.isUserNotFullyRegistered)
    }

    const rows: any[] = Array.isArray(data.loads) ? data.loads : []
    pages += 1
    for (const row of rows) {
      const mapped = mapExchangeLoad(row)
      if (!mapped.id || seen.has(mapped.id)) continue
      seen.add(mapped.id)
      loads.push(mapped)
    }

    // Тариф ATI отдаёт около 10–12 грузов на страницу независимо от
    // items_per_page, поэтому «неполная страница» ещё не значит «конец»:
    // идём дальше, пока страница не окажется пустой.
    if (rows.length === 0) break
    if (page < pageStart + maxPages - 1) await sleep(PAUSE_BETWEEN_PAGES_MS)
  }

  return { loads, totalItems, rootCount, pages, requests, flags }
}
