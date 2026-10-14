// lib/traffic/service.ts
//
// Провайдеры пробок (TRAFFIC_PROVIDER) и сколько они стоят:
//
//   estimate — без внешнего сервиса, время по времени суток. Бесплатно.
//   2gis     — 2ГИС Routing API, реальные пробки по России. Демо-ключ бесплатно
//              (1 000 запросов, 1 месяц), далее от 6 701 ₽ за 10 000 запросов.
//   yandex   — Яндекс.Маршрутизация, лучшие пробки, но минимальный платёж
//              120 000 ₽/год (матрица расстояний, 1 000 запросов/сутки);
//              оптимизация маршрутов — 4 791 470 ₽/год. Пробный период 14 дней.
//   mock     — демо-генератор, только для показа интерфейса.
//
// Почему не TomTom: в его таблице покрытия Traffic API России нет — маршрут
// считает, а пробки не отдаёт. HERE для России после 2022 года не гарантирует
// данные. Поэтому для реальных пробок остаются Яндекс и 2ГИС.
//
// Любой провайдер при ошибке деградирует до оценки по времени суток: оба
// потребителя (оптимизатор и /api/traffic/batch) ловят исключение и честно
// подписывают источник как «оценка», а не «измерение».

import type { LatLng, TrafficSegment, TrafficIncidentType } from "@/lib/traffic/types"

export type { LatLng, TrafficSegment, TrafficIncidentType }

export type TrafficRouteResult = {
  routeId: string
  provider: string
  generatedAtMs: number
  expiresAtMs: number
  segments: TrafficSegment[]
  /**
   * Сводка по маршруту целиком.
   * Есть только там, где провайдер действительно умеет считать пробки
   * (Яндекс.Маршрутизация): «сколько всего минут добавила дорога».
   * У демо-провайдера сводки нет — иначе демо-данные выглядели бы измерением.
   */
  summary?: { delayMin: number; ratio: number }
  /** true — данные сгенерированы для демонстрации, а не получены от сервиса пробок. */
  mock?: boolean
}

const DEFAULT_TTL_MS = 120_000
const YANDEX_TIMEOUT_MS = 8_000
const TWOGIS_TIMEOUT_MS = 10_000

declare global {
  // eslint-disable-next-line no-var
  var __tmsTrafficCacheV1: Map<string, TrafficRouteResult> | undefined
}

function getCache(): Map<string, TrafficRouteResult> {
  if (!globalThis.__tmsTrafficCacheV1) {
    globalThis.__tmsTrafficCacheV1 = new Map<string, TrafficRouteResult>()
  }
  return globalThis.__tmsTrafficCacheV1
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function stableHash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

function seededRand(seed: number): () => number {
  let x = seed || 123456789
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return ((x >>> 0) % 1_000_000) / 1_000_000
  }
}

function buildMockTrafficSegments(routeId: string, nowMs: number): TrafficSegment[] {
  const timeBucket = Math.floor(nowMs / (5 * 60_000))
  const seed = stableHash(`${routeId}|${timeBucket}`)
  const rnd = seededRand(seed)

  // 1-2 критических участка на маршруте (только сильные пробки, ДТП или перекрытия)
  const segmentCount = 1 + Math.floor(rnd() * 2)
  const segments: TrafficSegment[] = []

  const roadNames = [
    "Трасса М-10 «Россия» (Тверская обл.)",
    "Трасса М-7 «Волга» (Владимирская обл.)",
    "Трасса М-4 «Дон» (Тульская обл.)",
    "Трасса М-8 «Холмогоры» (Ярославская обл.)",
    "ЦКАД (Московская обл.)",
    "Трасса М-11 «Нева» (Новгородская обл.)",
    "Трасса М-5 «Урал» (Рязанская обл.)",
  ]

  for (let i = 0; i < segmentCount; i++) {
    const startT = clamp(0.12 + (i * 0.4) + rnd() * 0.15, 0.08, 0.78)
    const len = clamp(0.06 + rnd() * 0.1, 0.04, 0.16)
    const endT = clamp(startT + len, 0.12, 0.94)

    const eventRoll = rnd()
    let type: "jam" | "accident" | "closure" = "jam"
    let severity = 0.75 + rnd() * 0.2
    let delayMin = Math.round(10 + rnd() * 15)
    let description = "Плотный затор, скорость потока < 15 км/ч"

    if (eventRoll > 0.65) {
      type = "accident"
      severity = 0.88
      delayMin = Math.round(14 + rnd() * 18)
      description = "ДТП с перекрытием 2 правых полос"
    } else if (eventRoll < 0.22) {
      type = "closure"
      severity = 1.0
      delayMin = Math.round(20 + rnd() * 25)
      description = "Дорожные работы: участок перекрыт, ограничение движения"
    }

    const roadName = roadNames[Math.floor(rnd() * roadNames.length)]

    segments.push({
      startT,
      endT,
      severity,
      delayMin,
      type,
      description,
      roadName,
    })
  }

  return segments.sort((a, b) => a.startT - b.startT)
}

function pickWaypoints(coords: LatLng[], count: number): LatLng[] {
  if (coords.length <= count) return coords
  const res: LatLng[] = []
  const last = coords.length - 1
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / (count - 1)) * last)
    res.push(coords[idx])
  }
  return res.filter((p, i) => i === 0 || p[0] !== res[i - 1][0] || p[1] !== res[i - 1][1])
}

function toLonLat(points: LatLng[], sep: string): string {
  // сервис ожидает lon,lat
  return points.map(([lat, lng]) => `${lng},${lat}`).join(sep)
}

function tryExtractDurationSeconds(payload: any): number | null {
  const candidates: any[] = []
  if (payload && typeof payload === "object") candidates.push(payload)
  if (payload?.route) candidates.push(payload.route)
  if (Array.isArray(payload?.routes) && payload.routes[0]) candidates.push(payload.routes[0])
  if (payload?.result?.routes?.[0]) candidates.push(payload.result.routes[0])

  const pickNum = (obj: any, keys: string[]): number | null => {
    for (const k of keys) {
      const v = obj?.[k]
      if (typeof v === "number" && Number.isFinite(v)) return v
    }
    return null
  }

  const keys = ["duration", "time", "travelTime", "duration_sec", "time_sec"]

  for (const obj of candidates) {
    const direct = pickNum(obj, keys)
    const nested = typeof obj?.duration?.value === "number" ? obj.duration.value : null
    const sec = direct ?? nested
    if (typeof sec === "number" && Number.isFinite(sec)) {
      return sec > 10_000_000 ? Math.round(sec / 1000) : sec
    }
  }

  return null
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
  } finally {
    clearTimeout(t)
  }
}

/**
 * До какого момента ключ внешнего сервиса пробок считается отклонённым.
 *
 * Зачем: если ключ выдан не тому сервису (у Яндекса ключи отдельные на каждый
 * сервис — ключ геокодера Маршрутизацию не открывает; у 2ГИС демо-ключ живёт
 * месяц), каждый вызов оптимизатора отправлял бы два заведомо неудачных
 * запроса и ждал таймаута. Плюс в логах — лавина одинаковых ошибок. Поэтому
 * первый отказ по ключу запоминается на 15 минут: за это время владелец
 * успеет заменить ключ, а система честно считает по времени суток.
 */
let routingKeyRejectedUntilMs = 0
const ROUTING_KEY_COOLDOWN_MS = 15 * 60 * 1000

/** Сброс кэша отказа — для тестов и после смены ключа. */
export function resetRoutingKeyRejection(): void {
  routingKeyRejectedUntilMs = 0
}

/**
 * Признак «ключ отклонён сервисом», а не «сеть отвалилась».
 *
 * Форматы отказов, с которыми реально сталкивались:
 *   Яндекс:  403 {"errors":["Invalid key"]}
 *  2ГИС:    403 {"type":"forbidden","message":"invalid_key"}
 */
function isKeyRejection(status: number, body: string): boolean {
  if (status !== 401 && status !== 403) return false
  return /invalid[ _]?key|key[ _]?(is )?(not found|invalid|expired|blocked)|unauthorized|forbidden|access denied/i.test(
    body,
  )
}

async function fetchYandexDurationSeconds(params: {
  waypoints: LatLng[]
  trafficDisabled?: boolean
}): Promise<number> {
  const apiKey = process.env.YANDEX_ROUTING_API_KEY
  const apiUrlRaw = process.env.YANDEX_ROUTING_API_URL || "https://api.routing.yandex.net/v2/route"

  if (!apiKey) throw new Error("YANDEX_ROUTING_API_KEY is not set")

  if (Date.now() < routingKeyRejectedUntilMs) {
    throw new Error(
      "Ключ Яндекс.Маршрутизации отклонён (проверьте, что ключ выдан для сервиса «Маршрутизация», а не для геокодера)",
    )
  }

  const tryOne = async (sep: string): Promise<number> => {
    const url = new URL(apiUrlRaw)
    url.searchParams.set("apikey", apiKey)
    url.searchParams.set("mode", "driving")
    url.searchParams.set("lang", "ru_RU")

    // ВАЖНО: пробки учитываются по умолчанию. traffic=true нельзя.
    // Чтобы отключить пробки — traffic=disabled. Иначе параметр не передаём.
    if (params.trafficDisabled) url.searchParams.set("traffic", "disabled")
    else url.searchParams.delete("traffic")

    url.searchParams.set("waypoints", toLonLat(params.waypoints, sep))

    const res = await fetchJsonWithTimeout(url.toString(), YANDEX_TIMEOUT_MS)
    const text = await res.text().catch(() => "")

    if (!res.ok) {
      // Ключ выдан другому сервису — это не «сеть отвалилась», а неверная
      // настройка: дальше пытаться бессмысленно до смены ключа.
      if (isKeyRejection(res.status, text)) {
        routingKeyRejectedUntilMs = Date.now() + ROUTING_KEY_COOLDOWN_MS
        throw new Error(
          "Ключ Яндекс.Маршрутизации отклонён: проверьте, что ключ выдан для сервиса «Маршрутизация»",
        )
      }
      throw new Error(`Yandex routing HTTP ${res.status}: ${text.slice(0, 250)}`)
    }

    const data = text ? JSON.parse(text) : null
    const durationSec = tryExtractDurationSeconds(data)
    if (durationSec == null) {
      throw new Error("Yandex routing: duration not found in response")
    }

    return Math.max(1, Math.round(durationSec))
  }

  // Сначала стандартный разделитель '|', если Яндекс ругнётся на waypoints — пробуем '~'
  try {
    return await tryOne("|")
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg.includes("waypoints")) {
      return await tryOne("~")
    }
    throw e
  }
}

/**
 * 2ГИС Routing API — единственная доступная альтернатива Яндексу с реальными
 * российскими пробками.
 *
 * Почему не TomTom/HERE: у TomTom в таблице покрытия Traffic API России нет
 * (расчёт маршрута есть, пробок — нет), HERE после 2022 года для России не
 * гарантирует данные. 2ГИС считает маршрут «с учётом пробок» (traffic_mode:
 * "jam") и умеет базовый вариант по статистике (traffic_mode: "stat").
 *
 * Документация: https://docs.2gis.com/en/api/navigation/routing/start
 * Ключ: platform.2gis.ru → демо-ключ (1 000 запросов, 1 месяц, маршрут до
 * 50 км — междугородние рейсы демо-ключом не считаются) или подписка
 * (от 6 701 ₽ за 10 000 запросов).
 */
async function fetch2GisDurationSeconds(params: {
  waypoints: LatLng[]
  trafficDisabled?: boolean
}): Promise<number> {
  const apiKey = process.env.TWOGIS_API_KEY
  const apiUrlRaw =
    process.env.TWOGIS_ROUTING_API_URL || "https://routing.api.2gis.com/routing/7.0.0/global"

  if (!apiKey) throw new Error("TWOGIS_API_KEY is not set")

  if (Date.now() < routingKeyRejectedUntilMs) {
    throw new Error(
      "Ключ 2ГИС отклонён (проверьте TWOGIS_API_KEY: демо-ключ живёт месяц и ограничен 1 000 запросов)",
    )
  }

  const url = new URL(apiUrlRaw)
  url.searchParams.set("key", apiKey)

  const body = {
    points: params.waypoints.map(([lat, lng]) => ({ type: "stop", lon: lng, lat })),
    transport: "driving",
    route_mode: "fastest",
    // "jam" — текущие пробки, "stat" — статистика (без live-пробок)
    traffic_mode: params.trafficDisabled ? "stat" : "jam",
    locale: "ru",
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TWOGIS_TIMEOUT_MS)

  let res: Response
  let text: string
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    })
    text = await res.text().catch(() => "")
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    if (isKeyRejection(res.status, text)) {
      routingKeyRejectedUntilMs = Date.now() + ROUTING_KEY_COOLDOWN_MS
      throw new Error(
        "Ключ 2ГИС отклонён: проверьте, что TWOGIS_API_KEY выдан для Routing API и не истёк",
      )
    }
    throw new Error(`2GIS routing HTTP ${res.status}: ${text.slice(0, 250)}`)
  }

  const data = text ? JSON.parse(text) : null

  // 2ГИС отвечает либо набором маршрутов, либо объектом с ошибкой
  if (data?.type === "error" || data?.status === "FAIL") {
    throw new Error(`2GIS routing: ${String(data?.message || data?.status || "ошибка расчёта")}`)
  }

  const durationSec = tryExtract2GisDurationSeconds(data)
  if (durationSec == null) {
    throw new Error("2GIS routing: duration not found in response")
  }

  return Math.max(1, Math.round(durationSec))
}

/** Достаёт total_duration (секунды) из ответа 2ГИС Routing API. */
function tryExtract2GisDurationSeconds(payload: any): number | null {
  const options = payload?.result
  if (!Array.isArray(options) || options.length === 0) return null

  const pick = (obj: any): number | null => {
    const v = obj?.total_duration
    return typeof v === "number" && Number.isFinite(v) ? v : null
  }

  // Первый вариант — рекомендованный; ищем первый, у которого есть время
  for (const option of options) {
    const sec = pick(option)
    if (sec != null) return sec
  }
  return null
}

function buildSegmentsFromDelay(routeId: string, nowMs: number, severityBase: number, delayMin: number): TrafficSegment[] {
  const seed = stableHash(`${routeId}|${Math.floor(nowMs / (3 * 60_000))}`)
  const rnd = seededRand(seed)

  const n = 10
  const segments: TrafficSegment[] = []
  for (let i = 0; i < n; i++) {
    const startT = i / n
    const endT = (i + 1) / n

    const noise = (rnd() - 0.5) * 0.18
    const severity = clamp(severityBase + noise, 0, 1)

    segments.push({
      startT,
      endT,
      severity,
      delayMin: delayMin > 0 ? Math.max(0, Math.round(delayMin * severity)) : 0,
    })
  }

  return segments
}

export async function getRouteTraffic(params: {
  routeId: string
  coordinates: LatLng[]
  ttlMs?: number
}): Promise<TrafficRouteResult> {
  const nowMs = Date.now()
  const ttlMs = typeof params.ttlMs === "number" ? params.ttlMs : DEFAULT_TTL_MS
  const routeId = params.routeId

  const cache = getCache()
  const cached = cache.get(routeId)
  if (cached && cached.expiresAtMs > nowMs) return cached

  const provider = (process.env.TRAFFIC_PROVIDER || "mock").toLowerCase()
  let segments: TrafficSegment[] = []
  let summary: { delayMin: number; ratio: number } | undefined
  const isMock = provider === "mock"

  if (provider === "mock") {
    segments = buildMockTrafficSegments(routeId, nowMs)
  } else if (provider === "yandex") {
    const waypoints = pickWaypoints(params.coordinates, 10)

    // Параллельно: “с пробками” и “без пробок”
    const [trafficRes, baseRes] = await Promise.allSettled([
      fetchYandexDurationSeconds({ waypoints, trafficDisabled: false }),
      fetchYandexDurationSeconds({ waypoints, trafficDisabled: true }),
    ])

    if (trafficRes.status !== "fulfilled") {
      // Важно: если “с пробками” не удалось — считаем, что трафика нет (пусть batch в debug покажет причину)
      throw trafficRes.reason
    }

    const trafficSec = trafficRes.value
    const baseSec = baseRes.status === "fulfilled" ? baseRes.value : trafficSec

    const ratio = trafficSec / Math.max(1, baseSec)
    const delayMin = Math.max(0, Math.round((trafficSec - baseSec) / 60))
    const severityBase = clamp((ratio - 1) / 0.8, 0, 1)

    segments = buildSegmentsFromDelay(routeId, nowMs, severityBase, delayMin)
    summary = { delayMin, ratio: Number(ratio.toFixed(3)) }
  } else if (provider === "estimate") {
    // Внешний сервис пробок не подключён намеренно: потребители (оптимизатор,
    // /api/traffic/batch) ловят эту ошибку и считают время по времени суток.
    // Отдельная ветка — чтобы в debug-выводе было понятно, что это не сбой.
    throw new Error(
      "Внешний сервис пробок не настроен (TRAFFIC_PROVIDER=estimate): время считаем по времени суток",
    )
  } else if (provider === "2gis") {
    const waypoints = pickWaypoints(params.coordinates, 10)

    // Параллельно: «с пробками» и «по статистике» — разница и есть пробки
    const [trafficRes, baseRes] = await Promise.allSettled([
      fetch2GisDurationSeconds({ waypoints, trafficDisabled: false }),
      fetch2GisDurationSeconds({ waypoints, trafficDisabled: true }),
    ])

    if (trafficRes.status !== "fulfilled") {
      throw trafficRes.reason
    }

    const trafficSec = trafficRes.value
    const baseSec = baseRes.status === "fulfilled" ? baseRes.value : trafficSec

    const ratio = trafficSec / Math.max(1, baseSec)
    const delayMin = Math.max(0, Math.round((trafficSec - baseSec) / 60))
    const severityBase = clamp((ratio - 1) / 0.8, 0, 1)

    segments = buildSegmentsFromDelay(routeId, nowMs, severityBase, delayMin)
    summary = { delayMin, ratio: Number(ratio.toFixed(3)) }
  } else {
    throw new Error(`Traffic provider '${provider}' is not configured`)
  }

  const result: TrafficRouteResult = {
    routeId,
    provider,
    generatedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    segments,
    ...(summary ? { summary } : {}),
    ...(isMock ? { mock: true } : {}),
  }

  cache.set(routeId, result)
  return result
}