// lib/eta/orchestrator.ts
//
// Сборка посегментного прогноза из внешних данных.
//
// Здесь и только здесь происходит обращение к сети: OSRM (геометрия, шаги,
// базовое время) и Open-Meteo (погода). Сам движок forecastSegments — чистая
// функция, его можно тестировать без интернета, и он не знает, откуда взялись
// данные. Разделение нужно и по другой причине: если источник сменится
// (например, появятся платные пробки), переписывать придётся только этот файл.
//
// Двухпроходность. Погода нужна на МОМЕНТ ПРОХОЖДЕНИЯ сегмента, а момент
// прохождения зависит от задержек на предыдущих сегментах, то есть от того же
// прогноза. Поэтому:
//   проход 1 — прогноз без погоды, получаем примерное время прибытия в сегмент;
//   проход 2 — погода по этим моментам, прогноз заново уже с погодой.
// Два чистых расчёта бесплатны, а лишний запрос к погоде экономится: точки
// собираются в ОДИН батч (Open-Meteo принимает список координат).
//
// Лимиты Vercel: 10 с на Hobby, 60 с на Pro. OSRM — один запрос, погода — один
// запрос, таймаут погоды 6 с, кэш 10 минут. При любой ошибке расчёт не падает:
// возвращаем прогноз без погоды и пониженной уверенностью (резервный режим).

import {
  fetchOSRMRoute,
  validateCoordinates,
  haversineDistance,
  decodePolyline,
} from "./osrm-client"
import { buildSegmentsFromSteps, mergeShortSegments, segmentMidpoint, type RouteSegment } from "./segments"
import { forecastSegments, type ForecastOptions, type ForecastResult } from "./forecast"
import { fetchWeatherForPoints, isWeatherEnabled, resetWeatherCache } from "./weather/client"
import type { HourlyWeather } from "./weather/model"
import type { Coordinates } from "./types"
import type { StopRequest } from "./stops"
import type { RoadEvent } from "./events"
import type { RouteRestriction, VehicleInput } from "./vehicle-profile"
import type { RestRules } from "./driver-rest"

export interface SegmentEtaRequest {
  origin: Coordinates
  destination: Coordinates
  waypoints?: Coordinates[]
  departure?: Date
  timeZone?: string
  vehicle?: VehicleInput
  restrictions?: RouteRestriction[]
  stops?: Array<StopRequest & { afterSegmentIndex?: number }>
  restRules?: Partial<RestRules>
  priorDrivingMinutes?: number
  events?: RoadEvent[]
  /** Исторические коэффициенты по сегментам (калибровка) */
  historicalBySegment?: Array<{ trafficFactor: number; source: string } | null>
  /**
   * Адреса, которые не удалось геокодировать. Если они есть, маршрут построен
   * короче реального, и прогноз нельзя выдавать как достоверный: оставшиеся
   * точки дают более короткий и правдоподобный результат с нулём нарушений.
   */
  unlocatedAddresses?: readonly string[]
  useSeasonalFallback?: boolean
  /** Пропустить запрос погоды (тесты, или когда погода уже есть) */
  skipWeather?: boolean
  weatherBySegment?: Array<HourlyWeather | null>
}

export interface SegmentEtaResult {
  ok: boolean
  forecast?: ForecastResult
  segments: RouteSegment[]
  /** Доступна ли была погода по каждому сегменту */
  weatherAvailable: boolean
  /** Откуда данные: osrm | fallback */
  source: "osrm" | "fallback"
  /** Погода не запрашивалась, потому что отключена настройкой */
  weatherSkipped?: boolean
  /** Что именно не получилось — для показа человеку, не для логов */
  error?: string
}

/** Минимальная длина сегмента, км: короче — геометрия не строится. */
const MIN_ROUTE_KM = 0.05

/**
 * Считает посегментный прогноз с реальными данными.
 *
 * Никогда не бросает исключение: при любой внешней ошибке возвращает результат
 * с source="fallback" и честной уверенностью. Вызывающий код обязан смотреть
 * на source, а не предполагать успех.
 */
export async function calculateSegmentEta(
  request: SegmentEtaRequest,
): Promise<SegmentEtaResult> {
  if (!validateCoordinates(request.origin) || !validateCoordinates(request.destination)) {
    return {
      ok: false,
      segments: [],
      weatherAvailable: false,
      source: "fallback",
      error: "Некорректные координаты маршрута",
    }
  }

  const departure = request.departure || new Date()
  const waypoints = request.waypoints || []

  let segments: RouteSegment[]
  let source: SegmentEtaResult["source"] = "osrm"

  try {
    const osrm = await fetchOSRMRoute(request.origin, request.destination, waypoints, {
      steps: true,
      overview: "full",
    })

    const route = osrm.routes?.[0]
    const steps = route?.legs?.flatMap((leg: { steps?: unknown[] }) => leg.steps ?? []) ?? []
    const geometry = route?.geometry ? decodePolyline(route.geometry) : []

    segments = buildSegmentsFromSteps(steps as never, geometry)
  } catch (error) {
    // Маршрутизатор недоступен: строим один сегмент по прямой. Это прикидка,
    // и в результате так и написано — иначе «точный» ETA оказался бы догадкой.
    console.error(
      "[ETA] OSRM недоступен, резервный расчёт по прямой:",
      error instanceof Error ? error.message : error,
    )
    source = "fallback"
    segments = buildFallbackSegments(request.origin, request.destination, waypoints)
  }

  if (segments.length === 0) {
    return {
      ok: false,
      segments: [],
      weatherAvailable: false,
      source,
      error: "Маршрут не построен: нет данных о сегментах",
    }
  }

  const options: ForecastOptions = {
    departure,
    timeZone: request.timeZone,
    vehicle: request.vehicle,
    restrictions: request.restrictions,
    stops: request.stops,
    restRules: request.restRules,
    priorDrivingMinutes: request.priorDrivingMinutes,
    events: request.events,
    historicalBySegment: request.historicalBySegment,
    useSeasonalFallback: request.useSeasonalFallback,
    unlocatedAddresses: request.unlocatedAddresses,
  }

  // ── Проход 1: без погоды — узнаем, когда машина будет в каждом сегменте ──
  const tentative = forecastSegments(segments, { ...options, weatherBySegment: undefined })

  // ── Погода по моментам прохождения ──
  let weatherBySegment: Array<HourlyWeather | null>
  let weatherAvailable = false

  if (request.weatherBySegment) {
    // Погода передана снаруже (например, посчитана заранее или в тесте)
    weatherBySegment = request.weatherBySegment
    weatherAvailable = weatherBySegment.some((sample) => sample !== null)
  } else if (request.skipWeather || !isWeatherEnabled()) {
    // Погода выключена (по умолчанию): бесплатный тариф Open-Meteo не разрешает
    // коммерческое использование. Расчёт продолжается — без погодных поправок
    // и с честно пониженной уверенностью.
    weatherBySegment = segments.map(() => null)
  } else {
    const points = segments.map((segment, index) => ({
      lat: segmentMidpoint(segment).lat,
      lng: segmentMidpoint(segment).lng,
      at: tentative.segments[index]?.departureAt ?? departure,
      timeZone: request.timeZone,
    }))
    weatherBySegment = await fetchWeatherForPoints(points)
    weatherAvailable = weatherBySegment.some((sample) => sample !== null)
  }

  // ── Проход 2: тот же расчёт, но с погодой по времени прохождения ──
  const forecast = forecastSegments(segments, { ...options, weatherBySegment })

  return {
    ok: true,
    forecast,
    segments,
    weatherAvailable,
    source,
    weatherSkipped: !weatherAvailable && !isWeatherEnabled(),
  }
}

/**
 * Резервные сегменты по прямой, когда маршрутизатор не ответил.
 *
 * Не делаем вид, что это маршрут: класс дороги unknown (скорость берём из
 * средней по классу «неизвестно»), уверенность низкая, а в sources попадает
 * "fallback". Расстояние — прямое, умноженное на дорожный коэффициент 1.3,
 * как и раньше: по прямой машина не ездит.
 */
export function buildFallbackSegments(
  origin: Coordinates,
  destination: Coordinates,
  waypoints: Coordinates[] = [],
): RouteSegment[] {
  const points = [origin, ...waypoints, destination]
  const roadFactor = 1.3
  // Средняя скорость грузовика по смеси дорог — оценка, не норматив
  const averageSpeedKmh = 55

  return points.slice(0, -1).map((from, index) => {
    const to = points[index + 1]
    const directKm = haversineDistance(from, to)
    const distanceKm = Math.max(0, directKm * roadFactor)
    const distanceM = Math.round(distanceKm * 1000)
    const baseDurationSec = Math.round((distanceKm / averageSpeedKmh) * 3600)

    return {
      index,
      from,
      to,
      distanceM,
      baseDurationSec,
      roadClass: {
        class: "unknown" as const,
        label: "класс не определён",
        confidence: 0.2,
        reason: "маршрутизатор недоступен, класс дорог неизвестен",
      },
      baseSpeedKmh: averageSpeedKmh,
      speedSource: "osrm" as const,
      osrmSpeedKmh: averageSpeedKmh,
      freeFlowSec: baseDurationSec,
      roadName: undefined,
    }
  })
}

/** Сброс кэша погоды — для тестов и принудительного обновления. */
export { resetWeatherCache }
export { mergeShortSegments }
