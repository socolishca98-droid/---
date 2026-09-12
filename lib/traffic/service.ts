// lib/traffic/service.ts

export type LatLng = [number, number]

export type TrafficSegment = {
  startT: number
  endT: number
  severity: number
  delayMin?: number
}

export type TrafficRouteResult = {
  routeId: string
  provider: string
  generatedAtMs: number
  expiresAtMs: number
  segments: TrafficSegment[]
}

const DEFAULT_TTL_MS = 120_000
const YANDEX_TIMEOUT_MS = 8_000

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

  const segmentCount = 4 + Math.floor(rnd() * 4)
  const segments: TrafficSegment[] = []

  for (let i = 0; i < segmentCount; i++) {
    const startT = clamp(rnd() * 0.88, 0.02, 0.95)
    const len = clamp(0.05 + rnd() * 0.12, 0.05, 0.22)
    const endT = clamp(startT + len, 0.05, 0.98)

    const raw = rnd()
    const severity =
      raw < 0.55 ? rnd() * 0.35 : raw < 0.85 ? 0.35 + rnd() * 0.35 : 0.7 + rnd() * 0.3

    const delayMin = Math.round(2 + severity * (6 + rnd() * 10))
    segments.push({ startT, endT, severity: clamp(severity, 0, 1), delayMin })
  }

  return segments
    .map((s) => ({
      ...s,
      startT: clamp(Math.min(s.startT, s.endT), 0, 1),
      endT: clamp(Math.max(s.startT, s.endT), 0, 1),
    }))
    .filter((s) => s.endT - s.startT >= 0.02)
    .sort((a, b) => a.startT - b.startT)
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

async function fetchYandexDurationSeconds(params: {
  waypoints: LatLng[]
  trafficDisabled?: boolean
}): Promise<number> {
  const apiKey = process.env.YANDEX_ROUTING_API_KEY
  const apiUrlRaw = process.env.YANDEX_ROUTING_API_URL || "https://api.routing.yandex.net/v2/route"

  if (!apiKey) throw new Error("YANDEX_ROUTING_API_KEY is not set")

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
  } else {
    throw new Error(`Traffic provider '${provider}' is not configured`)
  }

  const result: TrafficRouteResult = {
    routeId,
    provider,
    generatedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    segments,
  }

  cache.set(routeId, result)
  return result
}