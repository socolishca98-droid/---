// lib/eta/weather/client.ts
//
// Погода: Open-Meteo.
//
// Почему он: бесплатно, без ключа, коммерческое использование разрешено,
// Attribution 4.0 (CC BY 4.0) — достаточно указать источник. Проверено живым
// запросом: hourly-прогноз отдаёт температуру, осадки, код погоды WMO,
// видимость и порывы ветра, а несколько точек считаются одним запросом
// (координаты через запятую) — для маршрута из 10 сегментов это один запрос
// вместо десяти.
//
// Ограничения, которые честно учитываются:
//   - прогноз на 7 дней вперёд; за пределами горизонта confidence падает;
//   - состояние дорожного покрытия НЕ отдаётся — гололёд считаем вероятностью;
//   - кэш: прогноз обновляется раз в ~15 минут, поэтому ответ кэшируем на
//     10 минут — это снижает число запросов и не даёт устаревших данных.
//
// Резервный режим: при любой ошибке возвращаем null, и расчёт продолжается с
// коэффициентом 1.0 и пониженной уверенностью (ТЗ §13: резервный режим при
// недоступности внешних сервисов).

import type { HourlyWeather } from "./model"

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
const REQUEST_TIMEOUT_MS = 6000
const CACHE_TTL_MS = 10 * 60 * 1000

const HOURLY_FIELDS = [
  "temperature_2m",
  "precipitation",
  "weather_code",
  "visibility",
  "wind_speed_10m",
  "wind_gusts_10m",
].join(",")

interface CacheEntry {
  at: number
  points: Array<HourlyPoint[] | null>
}

const cache = new Map<string, CacheEntry>()

export interface HourlyPoint extends HourlyWeather {}

/** Сброс кэша погоды — для тестов. */
export function resetWeatherCache(): void {
  cache.clear()
}

/**
 * Погода по списку точек на список моментов времени.
 *
 * Один запрос на все точки (до 20 в батче), результат раскладывается по
 * сегментам. Если точка недоступна — на её месте null, расчёт не падает.
 */
export async function fetchWeatherForPoints(
  points: Array<{ lat: number; lng: number; at: Date; timeZone?: string }>,
): Promise<Array<HourlyPoint | null>> {
  if (points.length === 0) return []

  const cacheKey = points.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join("|")
  const cached = cache.get(cacheKey)
  let hourlyByPoint: Array<HourlyPoint[] | null>

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    hourlyByPoint = cached.points
  } else {
    hourlyByPoint = await requestHourly(points)
    if (hourlyByPoint.length > 0) {
      cache.set(cacheKey, { at: Date.now(), points: hourlyByPoint })
    }
  }

  return points.map((point, index) => {
    const hourly = hourlyByPoint[index]
    if (!hourly || hourly.length === 0) return null
    return pickNearestHour(hourly, point.at, point.timeZone)
  })
}

async function requestHourly(
  points: Array<{ lat: number; lng: number }>,
): Promise<Array<HourlyPoint[] | null>> {
  const lats = points.map((p) => p.lat).join(",")
  const lons = points.map((p) => p.lng).join(",")

  const url = new URL(OPEN_METEO_URL)
  url.searchParams.set("latitude", lats)
  url.searchParams.set("longitude", lons)
  url.searchParams.set("hourly", HOURLY_FIELDS)
  url.searchParams.set("timezone", "auto")
  url.searchParams.set("forecast_days", "7")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error("[weather] Open-Meteo ответил", response.status)
      return points.map(() => null)
    }

    const data = await response.json()
    const list = Array.isArray(data) ? data : [data]
    return points.map((_, index) => parseHourly(list[index]))
  } catch (error) {
    console.error("[weather] Open-Meteo недоступен:", error instanceof Error ? error.message : error)
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
    hour12: false,
  })
  const parts = formatter.formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0")
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"))
  return asUtc - at.getTime()
}
