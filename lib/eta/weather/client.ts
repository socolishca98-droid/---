// lib/eta/weather/client.ts
//
// Погода: Open-Meteo.
//
// ⚠️ ВАЖНО ПРО ЛИЦЕНЗИЮ (проверено по open-meteo.com/en/terms 14.10.2026):
// бесплатный тариф разрешён ТОЛЬКО для некоммерческого использования.
// Loginex — коммерческий продукт, поэтому по умолчанию погода ВЫКЛЮЧЕНА
// (ETA_WEATHER != "on"). Чтобы включить, нужна подписка API Standard
// ($29/мес, 1 млн запросов, коммерческая лицензия, ключ и отдельный домен
// customer-api.open-meteo.com) — и решение владельца продукта.
//
// Почему именно он, когда лицензия позволит: без ключа, hourly-прогноз отдаёт
// температуру, осадки, код погоды WMO, видимость и порывы ветра, а несколько
// точек считаются одним запросом (координаты через запятую). Attribution 4.0
// (CC BY 4.0) — при использовании нужно указать источник.
//
// Ограничения, которые честно учитываются:
//   - прогноз на 7 дней вперёд; за пределами горизонта уверенность падает;
//   - состояние дорожного покрытия НЕ отдаётся — гололёд считаем вероятностью;
//   - кэш: прогноз обновляется раз в ~15 минут, поэтому ответ кэшируем на
//     10 минут — это снижает число запросов и не даёт устаревших данных.
//
// Резервный режим: при любой ошибке возвращаем null, и расчёт продолжается с
// коэффициентом 1.0 и пониженной уверенностью (ТЗ §13: резервный режим при
// недоступности внешних сервисов).

import type { HourlyWeather } from "./model"

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
/** Платный конечный домен: тот же синтаксис, но с ключом и коммерческой лицензией */
const OPEN_METEO_CUSTOMER_URL = "https://customer-api.open-meteo.com/v1/forecast"
const CACHE_TTL_MS = 10 * 60 * 1000

/**
 * Таймаут одного запроса, секунды → мс.
 *
 * Замерено вживую 14.10.2026: 37 точек с шестью переменными — 2.5 с, но при
 * нагрузке на сервер один и тот же запрос занимал 6-25 с (полностью линейно
 * от числа точек). Таймаут 9 с выбран потому, что лимит функции Vercel на
 * Hobby — 10 с, а погода это один из двух сетевых запросов в расчёте.
 * Увеличивать таймаут «на всякий случай» нельзя: на Hobby функция умрёт по
 * лимиту, и погода не придёт ВООБЩЕ — лучше вернуть null и понизить
 * уверенность, чем уронить весь расчёт.
 */
const REQUEST_TIMEOUT_MS = 9000

/**
 * Сколько точек просить за один запрос.
 *
 * Ограничение защитное, а не жёсткое: ответ весит ~8 КБ на точку, и маршрут
 * из 37 сегментов даёт 316 КБ JSON, который ещё надо разобрать. Плюс при
 * нагрузке время ответа росло линейно от числа точек. После дедупликации
 * маршрут обычно даёт 5-8 уникальных точек; если больше — берём равномерную
 * выборку, а для остальных сегментов берём погоду ближайшей выбранной точки:
 * погода меняется медленнее, чем расстояние.
 */
const MAX_BATCH_POINTS = 6

const HOURLY_FIELDS = [
  "temperature_2m",
  "precipitation",
  "weather_code",
  "visibility",
  "wind_speed_10m",
  "wind_gusts_10m",
].join(",")

export interface HourlyPoint extends HourlyWeather {}

interface CacheEntry {
  at: number
  points: Array<HourlyPoint[] | null>
}

const cache = new Map<string, CacheEntry>()

/**
 * Включена ли погода.
 *
 * По умолчанию ВЫКЛЮЧЕНА: бесплатный тариф Open-Meteo не разрешает
 * коммерческое использование, а подписка — это траты, на которые должно быть
 * явное согласие владельца (ограничение пользователя: «пока что бесплатно»).
 * Включение: ETA_WEATHER="on". С ключом платного тарифа: + OPEN_METEO_API_KEY.
 */
export function isWeatherEnabled(): boolean {
  return process.env.ETA_WEATHER === "on"
}

/** Сброс кэша погоды — для тестов. */
export function resetWeatherCache(): void {
  cache.clear()
}

export interface WeatherPointRequest {
  lat: number
  lng: number
  at: Date
  timeZone?: string
}

/**
 * Погода по списку точек на список моментов времени.
 *
 * Один запрос на все точки (до MAX_BATCH_POINTS после дедупликации), результат
 * раскладывается по сегментам. Если точка недоступна — на её месте null,
 * расчёт не падает.
 */
export async function fetchWeatherForPoints(
  points: readonly WeatherPointRequest[],
): Promise<Array<HourlyPoint | null>> {
  if (points.length === 0) return []
  if (!isWeatherEnabled()) return points.map(() => null)

  // Дедупликация: соседние сегменты часто имеют одну и ту же середину
  // (например, дорога идёт прямо). Замерено: маршрут из 37 сегментов даёт
  // 37 точек, из них уникальных — 6.
  const unique: WeatherPointRequest[] = []
  const indexByKey = new Map<string, number>()
  const pointIndexes: number[] = []

  for (const point of points) {
    const key = `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`
    const existing = indexByKey.get(key)
    if (existing !== undefined) {
      pointIndexes.push(existing)
      continue
    }
    indexByKey.set(key, unique.length)
    pointIndexes.push(unique.length)
    unique.push(point)
  }

  const sampledIndexes = sampleEvenlyIndexes(unique.length, MAX_BATCH_POINTS)
  const sampled = sampledIndexes.map((index) => unique[index])
  const cacheKey = sampled.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join("|")

  let hourlyByPoint: Array<HourlyPoint[] | null>
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    hourlyByPoint = cached.points
  } else {
    hourlyByPoint = await requestHourly(sampled)
    if (hourlyByPoint.length > 0) {
      cache.set(cacheKey, { at: Date.now(), points: hourlyByPoint })
    }
  }

  return points.map((point, index) => {
    // Точка могла не попасть в выборку: берём погоду ближайшей выбранной —
    // погода меняется медленнее, чем расстояние, поэтому для рейса это честнее,
    // чем отдать null и потерять поправку совсем.
    const nearest = nearestSampled(pointIndexes[index], sampledIndexes)
    const hourly = nearest >= 0 ? hourlyByPoint[nearest] : null
    if (!hourly || hourly.length === 0) return null
    return pickNearestHour(hourly, point.at, point.timeZone)
  })
}

/** Равномерная выборка индексов, включая первую и последнюю точку. */
function sampleEvenlyIndexes(count: number, limit: number): number[] {
  if (count <= limit) return Array.from({ length: count }, (_, i) => i)
  const result: number[] = []
  for (let i = 0; i < limit; i += 1) {
    const index = Math.round((i * (count - 1)) / (limit - 1))
    if (!result.includes(index)) result.push(index)
  }
  return result
}

/** Ближайшая по позиции выбранная точка. */
function nearestSampled(originalIndex: number, sampledIndexes: readonly number[]): number {
  if (sampledIndexes.length === 0) return -1
  let bestPosition = 0
  let bestDelta = Number.POSITIVE_INFINITY
  for (let position = 0; position < sampledIndexes.length; position += 1) {
    const delta = Math.abs(sampledIndexes[position] - originalIndex)
    if (delta < bestDelta) {
      bestDelta = delta
      bestPosition = position
    }
  }
  return bestPosition
}

async function requestHourly(
  points: readonly WeatherPointRequest[],
): Promise<Array<HourlyPoint[] | null>> {
  const lats = points.map((p) => p.lat).join(",")
  const lons = points.map((p) => p.lng).join(",")

  const baseUrl = process.env.OPEN_METEO_BASE_URL
    || (process.env.OPEN_METEO_API_KEY ? OPEN_METEO_CUSTOMER_URL : OPEN_METEO_URL)

  const url = new URL(baseUrl)
  url.searchParams.set("latitude", lats)
  url.searchParams.set("longitude", lons)
  url.searchParams.set("hourly", HOURLY_FIELDS)
  url.searchParams.set("timezone", "auto")
  url.searchParams.set("forecast_days", "7")
  if (process.env.OPEN_METEO_API_KEY) {
    url.searchParams.set("apikey", process.env.OPEN_METEO_API_KEY)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      // Погода не персонализирована: кэшируем ответ у CDN провайдера,
      // чтобы не считать один и тот же прогноз для всей организации заново
      next: { revalidate: 600 },
    } as RequestInit)
    if (!response.ok) {
      console.error("[weather] Open-Meteo ответил", response.status)
      return points.map(() => null)
    }

    const data = await response.json()
    const list = Array.isArray(data) ? data : [data]
    return points.map((_, index) => parseHourly(list[index]))
  } catch (error) {
    // Таймаут по числу точек — самая частая причина: см. REQUEST_TIMEOUT_MS
    console.error(
      "[weather] Open-Meteo недоступен:",
      error instanceof Error ? error.message : error,
    )
    return points.map(() => null)
  } finally {
    clearTimeout(timer)
  }
}

function parseHourly(payload: any): HourlyPoint[] | null {
  const hourly = payload?.hourly
  if (!hourly || !Array.isArray(hourly.time)) return null

  const points: HourlyPoint[] = []
  for (let i = 0; i < hourly.time.length; i += 1) {
    const temperatureC = num(hourly.temperature_2m?.[i])
    if (temperatureC === null) continue

    points.push({
      time: hourly.time[i],
      temperatureC,
      precipitationMm: num(hourly.precipitation?.[i]) ?? 0,
      weatherCode: num(hourly.weather_code?.[i]) ?? undefined,
      visibilityM: num(hourly.visibility?.[i]) ?? undefined,
      windSpeedKmh: num(hourly.wind_speed_10m?.[i]) ?? 0,
      windGustsKmh: num(hourly.wind_gusts_10m?.[i]) ?? undefined,
    })
  }

  return points.length > 0 ? points : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * Ближайший по времени час прогноза.
 *
 * Время в ответе Open-Meteo — местное для точки (timezone=auto), поэтому
 * сравниваем по смещению от запрошенного момента, а не по строке: если сегмент
 * проходится между часами, берём ближайший из двух.
 */
function pickNearestHour(hourly: HourlyPoint[], at: Date, timeZone?: string): HourlyPoint {
  let best = hourly[0]
  let bestDelta = Number.POSITIVE_INFINITY

  for (const point of hourly) {
    const parsed = parseLocalTime(point.time, timeZone)
    if (parsed === null) continue
    const delta = Math.abs(parsed.getTime() - at.getTime())
    if (delta < bestDelta) {
      bestDelta = delta
      best = point
    }
  }

  return best
}

/**
 * Разбирает местное время точки из прогноза.
 *
 * Open-Meteo отдаёт строки вида "2026-10-14T15:00" в местном времени точки.
 * Чтобы сравнить с моментом прохождения, интерпретируем строку как время в
 * часовом поясе маршрута.
 */
function parseLocalTime(value: string, timeZone?: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return null

  const [, y, mo, d, h, mi] = match
  const zone = timeZone || process.env.ETA_TIMEZONE || "Europe/Moscow"

  // Ищем момент, чьё местное время в зоне равно разобранному
  const asUtc = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)))
  const offset = zoneOffsetMs(zone, asUtc)
  return new Date(asUtc.getTime() - offset)
}

/** Смещение зоны (мс) на интересующий момент. */
function zoneOffsetMs(timeZone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })

  const parts = formatter.formatToParts(at)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0")

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  )

  return asUtc - at.getTime()
}
