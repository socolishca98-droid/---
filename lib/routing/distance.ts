// lib/routing/distance.ts
//
// Distance Engine: сколько километров и часов между двумя точками и насколько
// этому можно верить.
//
// Три источника, и у каждого своя честная метка:
//   1. `osrm`      — дорожный маршрутизатор (точные километры и время);
//   2. `exchange`  — километраж биржи по конкретному грузу (это дорога, и
//                    именно по нему фрахтователь считает ставку);
//   3. `estimate`  — прямая × коэффициент региона. Используется, когда
//                    маршрутизатора нет или он не ответил; на экране это
//                    помечается, чтобы оценка не выглядела измерением.
//
// Почему не «всегда ×1,2», как было: единый коэффициент на всю страну — это
// подмена данных догадкой. Для европейской части 1,2 близко к правде, для
// Урала и Сибири дорожная сеть разрежена, а для коротких городских подъездов
// коэффициент занижен. Здесь коэффициент — параметр региона, а не константа.

import type { Place, RegionParams, SegmentSource } from "./types"

export interface SegmentInfo {
  km: number
  /**
   * Время в пути по модели региона (скорость с грузом / порожним).
   *
   * Почему не время маршрутизатора: OSRM считает по легковому профилю, где
   * трассы проходятся за 90–110 км/ч. Фура с грузом идёт 55–60, плюс
   * погрузка/выгрузка и режим труда. Подставлять легковое время в календарь
   * рейса — значит обещать доставку на 30 % раньше, чем машина доедет.
   * Поэтому километры берём из дороги, а время — из модели региона.
   */
  hours: number
  /** Время того же участка по маршрутизатору (справочно, для сверки) */
  osrmHours: number | null
  source: SegmentSource
  confidence: "measured" | "estimated"
  tollsRub: number | null
}

export interface DistanceEngineOptions {
  /** Адрес OSRM (например, http://osrm:5000). Пусто — только оценка. */
  osrmUrl?: string | null
  regions: RegionParams[]
  fetchImpl?: typeof fetch
  /** Сколько запросов держать в кеше */
  cacheLimit?: number
  /** Таймаут одного запроса к OSRM, мс */
  timeoutMs?: number
}

/**
 * Ниже этого числа городов таблица не нужна: прямые запросы дешевле и
 * понятнее в отладке.
 */
const TABLE_MIN_PLACES = 4
/** Выше этого числа точек OSRM-таблица упирается в память и длину URL. */
const TABLE_MAX_PLACES = 400
/** Сколько городов в одной матрице (25 × 25 = 625 пар за запрос). */
const TABLE_CHUNK = 25

/** Регион по названию: «Ярославская область» → «ярославская». */
export function regionKey(region: string | null | undefined): string {
  return String(region ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+(область|край|республика|обл\.?|респ\.?|автономный округ|ао)$/i, "")
    .replace(/[^a-zа-я0-9 -]/gi, "")
    .trim()
}

/** Расстояние по прямой, км. */
export function straightKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Движок расстояний с кешем.
 *
 * Работает в два такта: сначала `prefetch` (асинхронно наполняет кеш из OSRM),
 * затем синхронные `segment()` внутри поиска. Так сделано нарочно: поиск
 * маршрута — синхронный и детерминированный, а сеть в него не пускается.
 * Всё, чего нет в кеше, считается оценкой — и это видно в результате.
 */
export class DistanceEngine {
  /**
   * Кеш участков. Ключ — ЧИСЛО, а не строка «город|город|режим».
   *
   * Почему: расчёт на пуле из 12 заказов делает сотни тысяч обращений к
   * участкам. Строковый ключ (склейка + хеш) стоил около микросекунды на
   * обращение — на замере это давало больше половины всего времени расчёта.
   * Числа хешируются без сборки строк.
   */
  private readonly cache = new Map<number, SegmentInfo>()
  private readonly ids = new Map<string, number>()
  private readonly regions = new Map<string, RegionParams>()
  private readonly osrmUrl: string | null
  private readonly fetchImpl: typeof fetch | null
  private readonly cacheLimit: number
  calls = 0
  hits = 0
  /** Сколько запросов к OSRM сделано (для отчёта о качестве и скорости) */
  osrmRequests = 0
  /** Сколько из них — матричные `/table` */
  tableRequests = 0
  private readonly timeoutMs: number

  constructor(options: DistanceEngineOptions) {
    for (const region of options.regions) this.regions.set(regionKey(region.key), region)
    this.osrmUrl = options.osrmUrl ?? null
    this.fetchImpl = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null)
    this.cacheLimit = options.cacheLimit ?? 200_000
    this.timeoutMs = options.timeoutMs ?? 8000
  }

  /**
   * Параметры участка: берётся более строгий из двух регионов.
   *
   * Участок, который пересекает границу регионов, нельзя считать «по лучшему»:
   * дорога из Краснодара в горы не становится трассой от того, что стартовала
   * на равнине. Поэтому коэффициент дороги — максимум, скорость — минимум.
   * Побочный, но важный эффект: расстояние между А и Б равно расстоянию между
   * Б и А, чего при «регионе старта» не было.
   */
  private region(a: Place, b: Place): RegionParams {
    const fallback: RegionParams = {
      key: "default",
      speedLoadedKmh: 55,
      speedEmptyKmh: 60,
      roadFactor: 1.2,
    }
    const keyA = regionKey(a.region)
    const keyB = regionKey(b.region)
    const first = this.regions.get(keyA) ?? this.regions.get(keyB) ?? fallback
    const second = this.regions.get(keyB) ?? this.regions.get(keyA) ?? fallback
    return {
      key: keyA && keyB && keyA !== keyB ? `${first.key}|${second.key}` : first.key,
      roadFactor: Math.max(first.roadFactor, second.roadFactor),
      speedLoadedKmh: Math.min(first.speedLoadedKmh, second.speedLoadedKmh),
      speedEmptyKmh: Math.min(first.speedEmptyKmh, second.speedEmptyKmh),
    }
  }

  /**
   * Оценка без маршрутизатора.
   *
   * `basisKm` — километраж, которому можно верить (биржа), если он есть: тогда
   * «оценка» — это только время, а километры измеренные.
   */
  estimate(a: Place, b: Place, mode: "loaded" | "deadhead", basisKm?: number | null): SegmentInfo {
    const region = this.region(a, b)
    const straight = a.point && b.point ? straightKm(a.point, b.point) : null
    const km =
      basisKm && basisKm > 0
        ? basisKm
        : straight !== null
          ? Math.round(straight * region.roadFactor)
          : 0
    const speed = mode === "loaded" ? region.speedLoadedKmh : region.speedEmptyKmh
    return {
      km,
      hours: speed > 0 ? km / speed : 0,
      osrmHours: null,
      source: basisKm && basisKm > 0 ? "exchange" : "estimate",
      confidence: basisKm && basisKm > 0 ? "measured" : "estimated",
      tollsRub: null,
    }
  }

  get osrmAvailable(): boolean {
    return Boolean(this.osrmUrl && this.fetchImpl)
  }

  /**
   * Наполнить кеш по всем нужным парам заранее.
   *
   * Ошибки сети не пробрасываются: недоступный маршрутизатор не должен ронять
   * планирование, он должен понижать точность до оценки (и это попадёт в
   * `assumptions`).
   *
   * Форма запросов важна. Пул из 120 грузов — это до 14 000 пар; по одному
   * запросу на пару это минуты ожидания и десятки тысяч обращений к серверу.
   * Поэтому берём таблицу OSRM (`/table`): один запрос отдаёт матрицу
   * «каждый-с-каждым» для группы городов. Группа ограничена по числу точек,
   * чтобы адрес запроса не упирался в лимит длины URL.
   */
  async prefetch(pairs: Array<{ a: Place; b: Place; mode: "loaded" | "deadhead" }>): Promise<void> {
    if (!this.osrmAvailable) return
    const todo = pairs.filter((pair) => !this.cache.has(this.key(pair.a, pair.b, pair.mode)))
    if (todo.length === 0) return

    // Города, для которых нужны расстояния (по id, чтобы не дублировать).
    const places = new Map<string, Place>()
    for (const pair of todo) {
      if (pair.a.point) places.set(pair.a.id, pair.a)
      if (pair.b.point) places.set(pair.b.id, pair.b)
    }
    const list = [...places.values()]

    // Небольшие наборы считаем поштучно: таблица на 4 точки дороже, чем 6
    // прямых запросов, и по ней труднее понять, что именно упало.
    if (list.length <= TABLE_MIN_PLACES || list.length > TABLE_MAX_PLACES) {
      for (const pair of todo) {
        const info = await this.route(pair.a, pair.b, pair.mode)
        if (info) this.store(pair.a, pair.b, pair.mode, info)
      }
      return
    }

    const index = new Map(list.map((place, position) => [place.id, position]))
    const size = TABLE_CHUNK
    for (let start = 0; start < list.length; start += size) {
      const chunk = list.slice(start, start + size)
      const matrix = await this.table(chunk)
      this.tableRequests += 1
      if (!matrix) continue
      for (const pair of todo) {
        const from = index.get(pair.a.id)
        const to = index.get(pair.b.id)
        if (from === undefined || to === undefined) continue
        // Строка и столбец внутри этой группы
        const row = from - start
        const column = to - start
        if (row < 0 || row >= chunk.length || column < 0 || column >= chunk.length) continue
        const km = matrix.distances?.[row]?.[column]
        const seconds = matrix.durations?.[row]?.[column]
        if (typeof km !== "number" || !Number.isFinite(km) || km <= 0) continue
        this.store(pair.a, pair.b, pair.mode, this.osrmInfo(km / 1000, seconds, pair.a, pair.b, pair.mode))
      }
    }
  }

  /** Матрица OSRM для группы точек. null — маршрутизатор не ответил. */
  private async table(
    places: Place[],
  ): Promise<{ distances?: number[][]; durations?: number[][] } | null> {
    if (!this.osrmUrl || !this.fetchImpl) return null
    const coords = places.map((place) => `${place.point.lng},${place.point.lat}`).join(";")
    const url = `${this.osrmUrl.replace(/\/$/, "")}/table/v1/driving/${coords}?annotations=distance,duration`
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) })
      if (!response.ok) return null
      const data = (await response.json()) as {
        code?: string
        distances?: number[][]
        durations?: number[][]
      }
      if (data.code && data.code !== "Ok") return null
      return { distances: data.distances, durations: data.durations }
    } catch {
      return null
    }
  }

  /** Один запрос в OSRM (или null, если не получилось). */
  private async route(a: Place, b: Place, mode: "loaded" | "deadhead"): Promise<SegmentInfo | null> {
    if (!this.osrmUrl || !this.fetchImpl || !a.point || !b.point) return null
    const url =
      `${this.osrmUrl.replace(/\/$/, "")}/route/v1/driving/` +
      `${a.point.lng},${a.point.lat};${b.point.lng},${b.point.lat}?overview=false`
    try {
      this.osrmRequests += 1
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) })
      if (!response.ok) return null
      const data = (await response.json()) as {
        routes?: Array<{ distance?: number; duration?: number }>
      }
      const route = data.routes?.[0]
      if (!route || typeof route.distance !== "number") return null
      return this.osrmInfo(route.distance / 1000, route.duration, a, b, mode)
    } catch {
      return null
    }
  }

  /**
   * Участок по данным маршрутизатора: километры измеренные, время — по модели
   * региона (см. комментарий к `SegmentInfo.hours`).
   */
  private osrmInfo(
    kmRaw: number,
    seconds: number | undefined,
    a: Place,
    b: Place,
    mode: "loaded" | "deadhead",
  ): SegmentInfo {
    const km = Math.round(kmRaw * 10) / 10
    const region = this.region(a, b)
    const speed = mode === "loaded" ? region.speedLoadedKmh : region.speedEmptyKmh
    return {
      km,
      hours: speed > 0 ? km / speed : 0,
      osrmHours: typeof seconds === "number" && seconds > 0 ? Math.round((seconds / 3600) * 100) / 100 : null,
      source: "osrm",
      confidence: "measured",
      tollsRub: null,
    }
  }

  /** Числовой ключ участка: (код точки А, код точки Б, режим). */
  private key(a: Place, b: Place, mode: string): number {
    return (this.idOf(a.id) * 1_000_003 + this.idOf(b.id)) * 2 + (mode === "loaded" ? 1 : 0)
  }

  private idOf(id: string): number {
    const known = this.ids.get(id)
    if (known !== undefined) return known
    const next = this.ids.size + 1
    this.ids.set(id, next)
    return next
  }

  private store(a: Place, b: Place, mode: string, info: SegmentInfo): void {
    if (this.cache.size > this.cacheLimit) this.cache.clear()
    this.cache.set(this.key(a, b, mode), info)
  }

  /**
   * Участок маршрута. Синхронно: всё, что не успели получить из OSRM,
   * считается оценкой региона.
   */
  segment(
    a: Place,
    b: Place,
    mode: "loaded" | "deadhead",
    options: { exchangeKm?: number | null } = {},
  ): SegmentInfo {
    this.calls += 1
    const cached = this.cache.get(this.key(a, b, mode))
    if (cached) {
      this.hits += 1
      return cached
    }
    // Километраж биржи главнее маршрутизатора для этого плеча: по нему
    // фрахтователь считает ставку, спорить с ним бессмысленно.
    if (mode === "loaded" && options.exchangeKm && options.exchangeKm > 0) {
      const region = this.region(a, b)
      const info: SegmentInfo = {
        km: options.exchangeKm,
        hours: options.exchangeKm / region.speedLoadedKmh,
        osrmHours: null,
        source: "exchange",
        confidence: "measured",
        tollsRub: null,
      }
      this.store(a, b, mode, info)
      return info
    }
    const info = this.estimate(a, b, mode)
    this.store(a, b, mode, info)
    return info
  }
}
