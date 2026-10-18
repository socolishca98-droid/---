// lib/eta/forecast.ts
//
// Движок прогноза: посегментный расчёт со сценариями.
//
// Ключевые правила, которые тут реализованы и проверены тестами:
//
//   1. Время считается ПО СЕГМЕНТАМ, и момент прохождения каждого сегмента
//      зависит от задержек предыдущих. Выезд утром ≠ час пик на всей трассе.
//   2. Нет двойного учёта: если погода дала свой коэффициент, сезонная поправка
//      на скорость НЕ добавляется поверх (она остаётся только как резерв).
//      Фактическая скорость (когда появится) заменяет модель пробок целиком.
//   3. Остановки отделены от времени движения и считаются отдельными строками.
//   4. Ограничения маршрута проверяются ДО расчёта и не компенсируются
//      коэффициентом.
//   5. Три сценария: оптимистичный, базовый, консервативный. Уверенность
//      считается из полноты данных, а не из количества коэффициентов.
//   6. Все применённые поправки видны в объяснении — для диагностики.

import { estimateTraffic, trafficUncertainty, type TrafficEstimate } from "./traffic-model"
import { assessWeather, weatherUncertainty, type HourlyWeather } from "./weather/model"
import { localHour } from "./time"
import type { RoadClass } from "./road-class"
import { buildVehicleProfile, checkRouteRestrictions, type RouteRestriction, type VehicleInput } from "./vehicle-profile"
import { createRestTracker, type RestBreak, type RestPlan, type RestRules } from "./driver-rest"
import { resolveStop, totalStopMinutes, type ResolvedStop, type StopRequest } from "./stops"
import { activeEvents, assessEvent, eventsForSegment, type RoadEvent } from "./events"
import type { RouteSegment } from "./segments"
import type { Coordinates } from "./types"

export const ETA_MODEL_VERSION = "2.0.0-segments"

export type Scenario = "optimistic" | "base" | "conservative"

/** Применённая поправка — для объяснения и диагностики. */
export interface Correction {
  kind: "traffic" | "weather" | "vehicle" | "season" | "event"
  factor: number
  reason: string
  /** Источник данных: модель, прогноз, карточка ТС, история */
  source: "model" | "forecast" | "vehicle" | "history"
}

export interface SegmentForecast {
  index: number
  distanceM: number
  roadClass: RoadClass
  roadClassLabel: string
  roadClassConfidence: number
  roadClassReason: string
  roadName?: string
  from: Coordinates
  to: Coordinates
  /** Момент прибытия в начало сегмента */
  arrivalAt: Date
  /** Момент выхода из сегмента */
  departureAt: Date
  baseSpeedKmh: number
  osrmSpeedKmh: number
  freeFlowSec: number
  baseDurationSec: number
  corrections: Correction[]
  drivingSec: number
  /** Суммарный множитель поправок */
  totalFactor: number
  /** Сегмент непроходим (полное перекрытие) */
  blocked?: boolean
  weather?: {
    condition: string
    label: string
    factor: number
    reason: string
    available: boolean
    iceRisk: number
  }
  traffic: TrafficEstimate
}

export interface ForecastResult {
  modelVersion: string
  departureAt: Date
  segments: SegmentForecast[]
  /** Остановки (погрузка, выгрузка, документы, ожидание) */
  stops: ResolvedStop[]
  /** Паузы водителя */
  rest: RestPlan
  /** Нарушения допустимости маршрута; не пусто → прогноз недействителен */
  violations: RouteRestriction[]
  /**
   * Можно ли показывать этот ETA как ориентир.
   * false — маршрут непроходим (полное перекрытие), маршрута нет вовсе или
   * не все точки геокодировались и расчёт построен по неполному маршруту.
   * В этом случае честнее сказать «ETA неизвестен», чем умножать время.
   */
  reliable: boolean
  /** Причина, если прогноз ненадёжен */
  reliabilityNote?: string
  /** Сколько точек не удалось геокодировать (0 = маршрут полный) */
  unlocatedCount: number
  /** Действующие дорожные события */
  events: RoadEvent[]
  scenarios: Record<
    Scenario,
    {
      drivingSec: number
      stopsSec: number
      restSec: number
      totalSec: number
      arrivalAt: Date
    }
  >
  /** Диапазон прибытия: от оптимистичного до консервативного */
  arrivalWindow: { from: Date; to: Date }
  confidence: {
    level: "high" | "medium" | "low"
    score: number
    reasons: string[]
  }
  /** Сводное объяснение: что и насколько повлияло */
  explanation: Array<{ kind: string; label: string; factor: number; detail: string }>
  /** Часовой пояс расчёта */
  timeZone: string
}

export interface ForecastOptions {
  departure: Date
  timeZone?: string
  vehicle?: VehicleInput
  restrictions?: readonly RouteRestriction[]
  /** Остановки с привязкой к сегменту (после какого сегмента вставлять) */
  stops?: Array<StopRequest & { afterSegmentIndex?: number }>
  restRules?: Partial<RestRules>
  /** Минуты управления до выезда — для норм труда */
  priorDrivingMinutes?: number
  /** Погода по сегментам: null = данных нет */
  weatherBySegment?: Array<HourlyWeather | null>
  /** Исторические коэффициенты по сегментам (калибровка) */
  historicalBySegment?: Array<{ trafficFactor: number; source: string } | null>
  /** Разрешить сезонную поправку на скорость, когда погоды нет */
  useSeasonalFallback?: boolean
  /** Дорожные события (ДТП, ремонт, перекрытие) */
  events?: readonly RoadEvent[]
  /**
   * Точки, которые не удалось геокодировать (адреса для показа человеку).
   * Непустой список = маршрут построен короче реального: недоступные точки
   * выпали из расчёта. Такой прогноз НЕ надёжен, сколько бы нарушений ни
   * оказалось ноль.
   */
  unlocatedAddresses?: readonly string[]
}

/**
 * Считает прогноз по сегментам.
 *
 * Чистая функция: все внешние данные (погода, история) переданы параметрами,
 * сетевых запросов здесь нет. Оркестрация с внешними источниками — в
 * lib/eta/service.ts.
 */
export function forecastSegments(
  segments: readonly RouteSegment[],
  options: ForecastOptions,
): ForecastResult {
  const timeZone = options.timeZone || process.env.ETA_TIMEZONE || "Europe/Moscow"
  const departure = options.departure

  const vehicleProfile = buildVehicleProfile(options.vehicle)
  const violations = checkRouteRestrictions(options.vehicle, options.restrictions || [])

  const stops = (options.stops || []).map(resolveStop)

  // События, действующие на момент начала рейса: устаревшие не учитываем
  const events = activeEvents(options.events || [], departure)

  // ── Проход по сегментам: базовый сценарий ──────────────────────────────
  const walk = (scenario: Scenario): { segments: SegmentForecast[]; drivingSec: number; restSec: number; rest: RestPlan } => {
    const forecastSegmentsOut: SegmentForecast[] = []
    let clock = new Date(departure.getTime())
    let drivingSec = 0

    // Перерывы водителя вставляются В ЧАСЫ рейса по ходу прохода: пауза после
    // N-го сегмента сдвигает момент прибытия во все последующие сегменты,
    // поэтому час пик, сезон и погода для них берутся уже сдвинутые.
    // Раньше план перерывов считался ПОСЛЕ цикла и прибавлялся к итогу одной
    // суммой — сегменты после перерыва считались без него.
    const restTracker = createRestTracker(options.restRules, options.priorDrivingMinutes)
    const restBreaks: RestBreak[] = []

    const stopAfter = new Map<number, ResolvedStop[]>()
    for (let i = 0; i < stops.length; i += 1) {
      const after = options.stops?.[i]?.afterSegmentIndex ?? segments.length - 1
      const list = stopAfter.get(after) || []
      list.push(stops[i])
      stopAfter.set(after, list)
    }

    for (const segment of segments) {
      const arrivalAt = new Date(clock.getTime())
      const traffic = estimateTraffic({ when: arrivalAt, roadClass: segment.roadClass.class, timeZone })

      const weatherSample = options.weatherBySegment?.[segment.index] ?? null
      const weather = assessWeather(weatherSample, segment.roadClass.class)

      // Исторические данные по сегменту заменяют модель пробок целиком
      const historical = options.historicalBySegment?.[segment.index] ?? null
      const trafficFactor = historical ? historical.trafficFactor : traffic.factor

      // Сезон на скорость — ТОЛЬКО когда погоды нет, иначе двойной учёт
      const seasonalFallback =
        options.useSeasonalFallback && !weather.available ? seasonalSpeedFactor(arrivalAt, timeZone) : 1

      // Сценарий: множим «избыток над единицей» на коэффициент сценария
      const trafficSpread = trafficUncertainty(traffic)
      const trafficScenario =
        scenario === "optimistic"
          ? trafficSpread.optimistic
          : scenario === "conservative"
            ? trafficSpread.conservative
            : 1

      const hoursAhead = Math.max(0, (arrivalAt.getTime() - Date.now()) / 3_600_000)
      const weatherSpread = weatherUncertainty(hoursAhead)
      const weatherScenario =
        scenario === "optimistic"
          ? weatherSpread.optimistic
          : scenario === "conservative"
            ? weatherSpread.conservative
            : 1

      const trafficPart = historical
        ? trafficFactor
        : 1 + (trafficFactor - 1) * trafficScenario
      const weatherPart = 1 + (weather.factor - 1) * weatherScenario

      const corrections: Correction[] = []
      corrections.push({
        kind: "traffic",
        factor: round3(trafficPart),
        reason: historical
          ? `история по сегменту ×${round3(historical.trafficFactor)} (${historical.source})`
          : `${traffic.reason}${scenario === "base" ? "" : ` · сценарий ${scenario}`}`,
        source: historical ? "history" : "model",
      })

      if (weather.available) {
        corrections.push({
          kind: "weather",
          factor: round3(weatherPart),
          reason: weather.reason,
          source: "forecast",
        })
      }

      if (seasonalFallback !== 1) {
        corrections.push({
          kind: "season",
          factor: round3(seasonalFallback),
          reason: "сезонная поправка (погоды по сегменту нет)",
          source: "model",
        })
      }

      // Дорожное событие на сегменте
      const segmentEvents = eventsForSegment(events, segment.index)
      const eventPart = segmentEvents.reduce((factor, event) => {
        const assessment = assessEvent(event, segment.roadClass.class)
        corrections.push({
          kind: "event",
          factor: assessment.blocked ? Number.POSITIVE_INFINITY : round3(assessment.factor),
          reason: assessment.reason,
          source: "model",
        })
        return factor * (assessment.blocked ? 0 : assessment.factor)
      }, 1)

      const vehiclePart = vehicleProfile.speedFactor
      corrections.push({
        kind: "vehicle",
        factor: vehiclePart,
        reason: `${vehicleProfile.label}${vehicleProfile.missing.length ? ` (нет данных: ${vehicleProfile.missing.join(", ")})` : ""}`,
        source: "vehicle",
      })

      const totalFactor = trafficPart * weatherPart * seasonalFallback * eventPart * vehiclePart

      // Полное перекрытие: время НЕ раздуваем искусственным максимумом — вместо
      // этого фиксируем непроходимость, а прогноз помечаем ненадёжным.
      // Дальше часы не двигаем: ETA до точки перекрытия — это честное число.
      if (eventPart === 0) {
        forecastSegmentsOut.push({
          index: segment.index,
          distanceM: segment.distanceM,
          roadClass: segment.roadClass.class,
          roadClassLabel: segment.roadClass.label,
          roadClassConfidence: segment.roadClass.confidence,
          roadClassReason: segment.roadClass.reason,
          roadName: segment.roadName,
          from: segment.from,
          to: segment.to,
          arrivalAt,
          departureAt: arrivalAt,
          baseSpeedKmh: segment.baseSpeedKmh,
          osrmSpeedKmh: segment.osrmSpeedKmh,
          freeFlowSec: segment.freeFlowSec,
          baseDurationSec: segment.baseDurationSec,
          corrections,
          drivingSec: 0,
          totalFactor: Number.POSITIVE_INFINITY,
          blocked: true,
          weather: undefined,
          traffic,
        })
        break
      }

      // Время сегмента: базовое OSRM × поправки, но не быстрее свободного потока
      const drivingSecSegment = Math.max(
        segment.freeFlowSec,
        Math.round(segment.baseDurationSec * totalFactor),
      )

      drivingSec += drivingSecSegment

      const departureAt = new Date(arrivalAt.getTime() + drivingSecSegment * 1000)

      forecastSegmentsOut.push({
        index: segment.index,
        distanceM: segment.distanceM,
        roadClass: segment.roadClass.class,
        roadClassLabel: segment.roadClass.label,
        roadClassConfidence: segment.roadClass.confidence,
        roadClassReason: segment.roadClass.reason,
        roadName: segment.roadName,
        from: segment.from,
        to: segment.to,
        arrivalAt,
        departureAt,
        baseSpeedKmh: segment.baseSpeedKmh,
        osrmSpeedKmh: segment.osrmSpeedKmh,
        freeFlowSec: segment.freeFlowSec,
        baseDurationSec: segment.baseDurationSec,
        corrections,
        drivingSec: drivingSecSegment,
        totalFactor: round3(totalFactor),
        weather: weather.available
          ? {
              condition: weather.condition,
              label: weather.label,
              factor: weather.factor,
              reason: weather.reason,
              available: true,
              iceRisk: weather.iceRisk,
            }
          : undefined,
        traffic,
      })

      clock = departureAt

      // Остановки после этого сегмента
      const stopList = stopAfter.get(segment.index)
      if (stopList) {
        const minutes = stopList.reduce((sum, stop) => {
          const value =
            scenario === "optimistic"
              ? stop.optimisticMinutes
              : scenario === "conservative"
                ? stop.conservativeMinutes
                : stop.minutes
          return sum + value
        }, 0)
        clock = new Date(clock.getTime() + minutes * 60_000)
      }

      // Перерыв водителя: вставляется в часы, следующие сегменты уезжают позже.
      // Для ПОСЛЕДНЕГО плеча перерыв не «после точки», а ВНУТРИ плеча: одно
      // плечо на 600 км движения длиннее лимита непрерывного управления, и
      // водителю нужен перерыв ещё до конечной точки. Поэтому для последнего
      // сегмента перерыв считается отдельно, уже после цикла.
      const isLastSegment = segment.index >= segments.length - 1
      if (!isLastSegment) {
        const restBreak = restTracker.afterSegment(segment.index, drivingSecSegment / 60)
        if (restBreak) {
          restBreaks.push(restBreak)
          clock = new Date(clock.getTime() + restBreak.minutes * 60_000)
        }
      }
    }

    // Перерыв внутри последнего плеча: он задерживает прибытие в конечную
    // точку, поэтому сдвигается departureAt последнего сегмента. Без этого
    // рейс из одного длинного плеча показывал бы прибытие без обязательной паузы.
    const lastSegment = forecastSegmentsOut[forecastSegmentsOut.length - 1]
    if (lastSegment) {
      const restBreak = restTracker.afterSegment(lastSegment.index, lastSegment.drivingSec / 60)
      if (restBreak) {
        restBreaks.push(restBreak)
        lastSegment.departureAt = new Date(lastSegment.departureAt.getTime() + restBreak.minutes * 60_000)
        clock = new Date(clock.getTime() + restBreak.minutes * 60_000)
      }
    }

    // План перерывов: он уже собран по ходу прохода и УЖЕ учтён в часах
    // сегментов. В общее время он входит через drivingSec+stopsSec+restSec,
    // поэтому arrivalAt базового сценария совпадает с моментом выхода из
    // последнего сегмента — расхождений между цепочкой сегментов и итогом нет.
    const rest: RestPlan = {
      breaks: restBreaks,
      totalMinutes: restTracker.totalMinutes(),
      rules: restTracker.rules(),
      priorDrivingUnknown: restTracker.priorDrivingUnknown(),
      warning: restTracker.priorDrivingUnknown()
        ? "Данных о времени управления до выезда нет: соответствие нормам труда и отдыха не доказано"
        : undefined,
    }

    // Оптимистичный сценарий перерывов не включает: это обязательные паузы,
    // а не «запас». Часы сегментов при этом тоже без них.
    const restSec = scenario === "optimistic" ? 0 : rest.totalMinutes * 60

    return { segments: forecastSegmentsOut, drivingSec, restSec, rest }
  }

  const base = walk("base")
  const optimistic = walk("optimistic")
  const conservative = walk("conservative")

  const stopsSecBase = totalStopMinutes(stops, "base") * 60
  const stopsSecOptimistic = totalStopMinutes(stops, "optimistic") * 60
  const stopsSecConservative = totalStopMinutes(stops, "conservative") * 60

  const scenarios = {
    optimistic: {
      drivingSec: optimistic.drivingSec,
      stopsSec: stopsSecOptimistic,
      restSec: optimistic.restSec,
      totalSec: optimistic.drivingSec + stopsSecOptimistic + optimistic.restSec,
      arrivalAt: new Date(departure.getTime() + (optimistic.drivingSec + stopsSecOptimistic + optimistic.restSec) * 1000),
    },
    base: {
      drivingSec: base.drivingSec,
      stopsSec: stopsSecBase,
      restSec: base.restSec,
      totalSec: base.drivingSec + stopsSecBase + base.restSec,
      arrivalAt: new Date(departure.getTime() + (base.drivingSec + stopsSecBase + base.restSec) * 1000),
    },
    conservative: {
      drivingSec: conservative.drivingSec,
      stopsSec: stopsSecConservative,
      restSec: conservative.restSec,
      totalSec: conservative.drivingSec + stopsSecConservative + conservative.restSec,
      arrivalAt: new Date(departure.getTime() + (conservative.drivingSec + stopsSecConservative + conservative.restSec) * 1000),
    },
  }

  const hasBlocking = base.segments.some((segment) => segment.blocked)

  const confidence = assessConfidence({
    segments: base.segments,
    weatherAvailable: (options.weatherBySegment || []).some((sample) => sample !== null),
    hoursAhead: Math.max(0, (scenarios.base.arrivalAt.getTime() - Date.now()) / 3_600_000),
    vehicleConfidence: vehicleProfile.confidence,
    stopsFromDefaults: stops.filter((stop) => stop.source === "default").length,
    stopsTotal: stops.length,
    violations,
    historicalUsed: (options.historicalBySegment || []).some((item) => item !== null),
    segmentsCount: segments.length,
    blockingEvent: events.some((event) => assessEvent(event, "unknown").blocked),
  })

  return {
    modelVersion: ETA_MODEL_VERSION,
    departureAt: departure,
    segments: base.segments,
    stops,
    rest: base.rest,
    violations,
    // Надёжность = прогноз допустим И построен по ПОЛНОМУ набору точек.
    // Было: reliable не смотрел на геокодирование. Если геокодер молча
    // отбрасывал часть адресов, оставшиеся точки складывались в более
    // короткий и правдоподобный маршрут с нулём нарушений — и диспетчер
    // получал reliable: true на неполном расчёте.
    unlocatedCount: options.unlocatedAddresses?.length ?? 0,
    reliable:
      violations.length === 0 &&
      segments.length > 0 &&
      !hasBlocking &&
      (options.unlocatedAddresses?.length ?? 0) === 0,
    reliabilityNote:
      violations.length > 0
        ? `маршрут недопустим: ${violations.map((v) => v.message).join("; ")}`
        : (options.unlocatedAddresses?.length ?? 0) > 0
          ? `прогноз неполный: не определены координаты ${options.unlocatedAddresses!.length} точек (${options.unlocatedAddresses!.slice(0, 5).join("; ")}${options.unlocatedAddresses!.length > 5 ? ` и ещё ${options.unlocatedAddresses!.length - 5}` : ""}), они не учтены в расчёте`
          : hasBlocking
          ? "на маршруте полное перекрытие — ETA определён только до точки перекрытия, нужен альтернативный маршрут"
          : segments.length === 0
            ? "маршрут не построен"
            : undefined,
    events,
    scenarios,
    arrivalWindow: { from: scenarios.optimistic.arrivalAt, to: scenarios.conservative.arrivalAt },
    confidence,
    explanation: buildExplanation(base.segments, stops, base.rest, vehicleProfile, scenarios, timeZone),
    timeZone,
  }
}

/**
 * Сезонная поправка на СКОРОСТЬ (ТЗ §6).
 *
 * Применяется только как резерв, когда по сегменту нет погоды: иначе получается
 * двойной учёт (зима + снег). Диапазоны из ТЗ.
 */
function seasonalSpeedFactor(when: Date, timeZone: string): number {
  const month = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, month: "2-digit" }).format(when),
  )
  const city = [1.03, 1.05, 1.02, 1.02][seasonIndex(month)]
  const rural = [1.08, 1.05, 1.0, 1.06][seasonIndex(month)]
  // Резервная поправка усреднена по типу дороги: точного класса здесь нет
  return Math.round(((city + rural) / 2) * 1000) / 1000
}

function seasonIndex(month: number): number {
  if (month <= 2 || month === 12) return 0 // зима
  if (month <= 5) return 1 // весна
  if (month <= 8) return 2 // лето
  return 3 // осень
}

/**
 * Уверенность прогноза.
 *
 * Считается из ПОЛНОТЫ и АКТУАЛЬНОСТИ данных, а не из числа коэффициентов:
 * много поправок не делают прогноз точным. Погода вне горизонта прогноза,
 * неизвестный класс дороги, отсутствие карточки ТС и оценки по умолчанию для
 * остановок — всё это снижает уверенность и видно в причинах.
 */
function assessConfidence(input: {
  segments: SegmentForecast[]
  weatherAvailable: boolean
  hoursAhead: number
  vehicleConfidence: number
  stopsFromDefaults: number
  stopsTotal: number
  violations: RouteRestriction[]
  historicalUsed: boolean
  segmentsCount: number
  blockingEvent: boolean
}): { level: "high" | "medium" | "low"; score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 1

  if (input.segmentsCount === 0) {
    return {
      level: "low",
      score: 0,
      reasons: ["маршрут не построен: нет данных о сегментах"],
    }
  }

  if (input.blockingEvent) {
    return {
      level: "low",
      score: 0.05,
      reasons: ["на маршруте полное перекрытие — ETA без альтернативы неизвестен"],
    }
  }

  const roadClassConfidence =
    input.segments.reduce((sum, segment) => sum + segment.roadClassConfidence, 0) /
    Math.max(1, input.segments.length)
  score *= roadClassConfidence
  if (roadClassConfidence < 0.6) {
    reasons.push(`класс дороги определён неточно (уверенность ${round2(roadClassConfidence)})`)
  }

  if (!input.weatherAvailable) {
    score *= 0.8
    reasons.push("прогноз погоды недоступен — погодные поправки не применены")
  } else if (input.hoursAhead > 120) {
    score *= 0.7
    reasons.push("прогноз погоды дальше 5 дней — надёжность падает")
  }

  if (input.hoursAhead > 48) {
    reasons.push("выйная дата более чем через 2 дня — обстановка может измениться")
  }

  score *= input.vehicleConfidence
  if (input.vehicleConfidence < 0.7) {
    reasons.push("данные о транспортном средстве неполные")
  }

  if (input.stopsTotal > 0 && input.stopsFromDefaults === input.stopsTotal) {
    score *= 0.9
    reasons.push("время операций взято из диапазонов по умолчанию, не из истории")
  }

  if (input.violations.length > 0) {
    score *= 0.3
    reasons.push("маршрут имеет недопустимые ограничения — прогноз недействителен")
  }

  if (input.historicalUsed) {
    score = Math.min(1, score * 1.15)
    reasons.push("использованы исторические данные по сегментам")
  }

  const clamped = Math.max(0.05, Math.min(1, score))
  const level = clamped >= 0.7 ? "high" : clamped >= 0.45 ? "medium" : "low"

  return { level, score: round2(clamped), reasons }
}

/** Сводное объяснение: что и насколько повлияло. */
function buildExplanation(
  segments: SegmentForecast[],
  stops: ResolvedStop[],
  rest: RestPlan,
  vehicleProfile: { label: string; speedFactor: number },
  scenarios: Record<Scenario, { totalSec: number }>,
  timeZone: string,
): Array<{ kind: string; label: string; factor: number; detail: string }> {
  const items: Array<{ kind: string; label: string; factor: number; detail: string }> = []

  const trafficFactors = segments.map((s) => s.corrections.find((c) => c.kind === "traffic")?.factor ?? 1)
  const trafficAvg = average(trafficFactors)
  items.push({
    kind: "traffic",
    label: "Дорожная обстановка",
    factor: round3(trafficAvg),
    detail: segments
      .filter((s) => s.traffic.factor > 1.02)
      .slice(0, 3)
      .map((s) => `${s.roadClassLabel} в ${localHour(s.arrivalAt, timeZone).toFixed(0)}:00 ×${round2(s.traffic.factor)}`)
      .join("; ") || "заметных заторов модель не предсказывает",
  })

  const weatherFactors = segments
    .map((s) => s.weather?.factor)
    .filter((value): value is number => typeof value === "number")
  if (weatherFactors.length > 0) {
    const labels = new Set(segments.map((s) => s.weather?.label).filter(Boolean))
    items.push({
      kind: "weather",
      label: "Погода",
      factor: round3(average(weatherFactors)),
      detail: [...labels].join(", "),
    })
  }

  items.push({
    kind: "vehicle",
    label: "Транспортное средство",
    factor: vehicleProfile.speedFactor,
    detail: vehicleProfile.label,
  })

  if (stops.length > 0) {
    items.push({
      kind: "stops",
      label: "Остановки",
      factor: 1,
      detail: stops
        .map((stop) => `${stop.label} ${stop.minutes} мин (${stopSourceLabel(stop.source)})`)
        .join(", "),
    })
  }

  if (rest.breaks.length > 0) {
    items.push({
      kind: "rest",
      label: "Паузы водителя",
      factor: 1,
      detail: rest.breaks.map((b) => `${b.minutes} мин после сегмента ${b.afterSegmentIndex + 1}`).join(", "),
    })
  }

  const spreadSec = scenarios.conservative.totalSec - scenarios.optimistic.totalSec
  items.push({
    kind: "window",
    label: "Диапазон прибытия",
    factor: 1,
    detail: `разброс сценариев ${Math.round(spreadSec / 60)} мин`,
  })

  return items
}

function stopSourceLabel(source: ResolvedStop["source"]): string {
  if (source === "actual") return "факт клиента"
  if (source === "history") return "история"
  return "оценка"
}

function average(values: number[]): number {
  if (values.length === 0) return 1
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
