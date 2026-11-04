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
  /**
   * Кто именно дал километры: имя точки входа маршрутизатора из списка
   * (`osrm-own`, `osrm-public`, …). null — километры не измерены.
   *
   * Зачем хранить имя, а не только «osrm»: у источников разные лицензии и
   * лимиты, и при разборе спорного маршрута нужно знать, чей это ответ.
   */
  provider?: string | null
  /** Когда километры измерены (ISO). null — не измерялись. */
  measuredAt?: string | null
  /** true — значение взято из постоянного кэша, а не запрошено сейчас */
  fromCache?: boolean
}

/** Точка входа маршрутизатора: имя для отчёта + адрес. */
export interface RouterEndpoint {
  /** `osrm-own` — свой сервер, `osrm-public` — публичный, и т. д. */
  name: string
  url: string
}

/**
 * Постоянный кэш расстояний — хранилище между расчётами.
 *
 * Зачем: километры между двумя городами не меняются от расчёта к расчёту, а
 * запрос к публичному серверу стоит времени и чужого трафика. Плюс ТЗ требует
 * ХРАНИТЬ источник и статус достоверности — значит им нужно место, а не только
 * память процесса.
 *
 * Реализация (Prisma) лежит в service.ts: ядро не знает базы.
 */
export interface DistanceCacheStore {
  load(keys: Array<{ from: string; to: string; mode: "loaded" | "deadhead" }>): Promise<
    Array<{
      from: string
      to: string
      mode: string
      km: number
      source: string
      provider: string | null
      measuredAt: Date | string | null
    }>
  >
  save(
    rows: Array<{
      from: string
      to: string
      mode: string
      km: number
      source: string
      provider: string | null
      measuredAt: Date
    }>,
  ): Promise<void>
}

export interface DistanceEngineOptions {
  /** Адрес своего OSRM (например, http://osrm:5000). Пусто — только оценка. */
  osrmUrl?: string | null
  /**
   * Запасные точки входа, БЕСПЛАТНЫЕ. Используются, только если своя не
   * ответила. Платные сервисы сюда не подставляются автоматически (ТЗ).
   */
  fallbackEndpoints?: RouterEndpoint[]
  /** Постоянный кэш между расчётами; пусто — только память процесса */
  store?: DistanceCacheStore | null
  regions: RegionParams[]
  fetchImpl?: typeof fetch
  /** Сколько запросов держать в кеше */
  cacheLimit?: number
  /** Таймаут одного запроса к OSRM, мс */
  timeoutMs?: number
  /** Предел сетевых запросов на один расчёт (вежливость к публичным серверам) */
  requestBudget?: number
}

/**
 * Ниже этого числа городов таблица не нужна: прямые запросы дешевле и
 * понятнее в отладке.
 */
/** Предел запоминания оценочных плеч: защита памяти на больших пулах. */
const ESTIMATE_MISS_LIMIT = 20_000

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

  /**
   * Плечи, которые ПОНАДОБИЛИСЬ поиску, но были посчитаны оценкой.
   *
   * Зачем: поиск сравнивает варианты между собой, и если один вариант считает
   * плечо дорогой, а другой — оценкой, сравнение перестаёт быть честным.
   * На приёмке это стоило реальных денег: поиск выбрал маршрут через Москву,
   * потому что плечо Тверь → Москва было оценено в 194 км, а настоящее —
   * 179 км; независимый перебор с настоящими километрами находил порядок на
   * 582 ₽ выгоднее. Поэтому все «оценочные» плечи, встреченные поиском,
   * запоминаются, измеряются, и расчёт повторяется.
   */
  private readonly estimateMisses = new Map<number, { a: Place; b: Place; mode: "loaded" | "deadhead" }>()

  /** Забрать накопленные оценочные плечи (и очистить список). */
  takeEstimateMisses(): Array<{ a: Place; b: Place; mode: "loaded" | "deadhead" }> {
    const list = [...this.estimateMisses.values()]
    this.estimateMisses.clear()
    return list
  }

  /** Сколько плеч посчитано оценкой за время расчёта. */
  get estimateMissCount(): number {
    return this.estimateMisses.size
  }
  private readonly ids = new Map<string, number>()
  private readonly regions = new Map<string, RegionParams>()
  /**
   * Точки входа маршрутизатора по порядку: сначала свой, потом бесплатные
   * запасные. Платные сюда не попадают сами — их подставляет вызывающий, если
   * владелец это разрешил.
   */
  private readonly endpoints: RouterEndpoint[]
  private readonly store: DistanceCacheStore | null
  private readonly fetchImpl: typeof fetch | null
  private readonly cacheLimit: number
  calls = 0
  hits = 0
  /** Сколько запросов к маршрутизатору сделано (для отчёта о качестве) */
  osrmRequests = 0
  /** Сколько из них — матричные `/table` */
  tableRequests = 0
  /** Сколько участков пришло из постоянного кэша, а не из сети */
  storeHits = 0
  /** Имя точки входа, которая ответила последней (для отчёта) */
  lastProvider: string | null = null
  /** Учёт по точкам входа: кто сколько запросов принял и сколько раз упал */
  readonly routerStats: Array<{ name: string; requests: number; failures: number; totalMs: number }> = []
  private readonly timeoutMs: number
  private budgetLeft: number

  constructor(options: DistanceEngineOptions) {
    for (const region of options.regions) this.regions.set(regionKey(region.key), region)

    this.endpoints = []
    if (options.osrmUrl && options.osrmUrl.trim()) {
      this.endpoints.push({ name: "osrm-own", url: options.osrmUrl.trim().replace(/\/$/, "") })
    }
    for (const endpoint of options.fallbackEndpoints ?? []) {
      if (!endpoint?.url) continue
      this.endpoints.push({ name: endpoint.name, url: endpoint.url.replace(/\/$/, "") })
    }
    for (const endpoint of this.endpoints) {
      this.routerStats.push({ name: endpoint.name, requests: 0, failures: 0, totalMs: 0 })
    }

    this.store = options.store ?? null
    this.fetchImpl = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null)
    this.cacheLimit = options.cacheLimit ?? 200_000
    this.timeoutMs = options.timeoutMs ?? 8000
    // Предел сетевых запросов на один расчёт: публичные серверы не резиновые,
    // а планировщик не должен превращаться в генератор нагрузки.
    this.budgetLeft = options.requestBudget ?? 200
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
   *
   * Чего стоит такая оценка — измерено, а не предположено
   * (scripts/router-compare.mjs, 10 пар): «прямая × 1,2» ошибается от −30 %
   * (Краснодар → Сочи, горный серпантин) до +13 % (Ярославль → Москва). Поэтому
   * она помечается `estimated` и НЕ выдаётся за измерение.
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
      provider: null,
      measuredAt: null,
    }
  }

  /** Есть ли хоть одна точка входа маршрутизатора. */
  get osrmAvailable(): boolean {
    return this.endpoints.length > 0 && Boolean(this.fetchImpl)
  }

  /** Какие источники подключены — для экрана «откуда километры». */
  get providerNames(): string[] {
    return this.endpoints.map((endpoint) => endpoint.name)
  }

  /**
   * Наполнить кеш по всем нужным парам заранее.
   *
   * Порядок важен:
   *   1. постоянный кэш (база) — измеренные ранее участки не запрашиваются
   *      снова: километры между двумя городами не меняются;
   *   2. сеть — свой сервер, затем бесплатные запасные;
   *   3. запись измеренного в постоянный кэш вместе с источником и датой.
   *
   * Ошибки сети не пробрасываются: недоступный маршрутизатор не должен ронять
   * планирование, он понижает точность до оценки (и это видно в допущениях).
   *
   * Форма запросов. Пул из 120 грузов — это до 14 000 пар; по одному запросу на
   * пару это минуты ожидания. Поэтому берём таблицу OSRM (`/table`): один
   * запрос отдаёт матрицу «каждый-с-каждым» для группы городов.
   */
  async prefetch(
    pairs: Array<{ a: Place; b: Place; mode: "loaded" | "deadhead" }>,
    options: { refreshEstimates?: boolean } = {},
  ): Promise<number> {
    if (pairs.length === 0) return 0
    const missing = pairs.filter((pair) => {
      const cached = this.cache.get(this.key(pair.a, pair.b, pair.mode))
      if (!cached) return true
      // «Оценка» — не измерение. Первый проход поиска мог посчитать плечо по
      // прямой (груза не было в предзагрузке), и в кеше лежит догадка. Если
      // вызывающий просит освежить оценки, а маршрутизатор жив — пробуем
      // измерить по-настоящему, вместо того чтобы считать догадку окончательной.
      return options.refreshEstimates === true && cached.source === "estimate" && this.osrmAvailable
    })
    if (missing.length === 0) return 0
    const measuredBefore = this.measuredCount

    // 1. Постоянный кэш: то, что уже измерено, не меряем заново.
    const rest = await this.loadFromStore(missing)
    if (rest.length === 0) return this.measuredCount - measuredBefore

    // 2. Сеть — только если она вообще есть.
    if (!this.osrmAvailable) return this.measuredCount - measuredBefore

    const places = new Map<string, Place>()
    for (const pair of rest) {
      if (pair.a.point) places.set(pair.a.id, pair.a)
      if (pair.b.point) places.set(pair.b.id, pair.b)
    }
    const list = [...places.values()]

    // Небольшие наборы считаем поштучно: таблица на 4 точки дороже, чем 6
    // прямых запросов, и по ней труднее понять, что именно упало.
    if (list.length <= TABLE_MIN_PLACES || list.length > TABLE_MAX_PLACES) {
      for (const pair of rest) {
        if (this.budgetLeft <= 0) break
        const info = await this.route(pair.a, pair.b, pair.mode)
        if (info) this.store2(pair.a, pair.b, pair.mode, info)
      }
      await this.flushStore()
      return this.measuredCount - measuredBefore
    }

    const index = new Map(list.map((place, position) => [place.id, position]))
    const size = TABLE_CHUNK
    for (let start = 0; start < list.length; start += size) {
      if (this.budgetLeft <= 0) break
      const chunk = list.slice(start, start + size)
      const matrix = await this.table(chunk)
      if (!matrix) continue
      this.tableRequests += 1
      for (const pair of rest) {
        const from = index.get(pair.a.id)
        const to = index.get(pair.b.id)
        if (from === undefined || to === undefined) continue
        const row = from - start
        const column = to - start
        if (row < 0 || row >= chunk.length || column < 0 || column >= chunk.length) continue
        const km = matrix.distances?.[row]?.[column]
        const seconds = matrix.durations?.[row]?.[column]
        if (typeof km !== "number" || !Number.isFinite(km) || km <= 0) continue
        this.store2(
          pair.a,
          pair.b,
          pair.mode,
          this.osrmInfo(km / 1000, seconds, pair.a, pair.b, pair.mode, matrix.provider),
        )
      }
    }
    await this.flushStore()
    return this.measuredCount - measuredBefore
  }

  /**
   * Сколько участков в кеше действительно ИЗМЕРЕНО (а не оценено).
   * Нужен вызывающему, чтобы понять, дал ли уточняющий проход что-то новое.
   */
  get measuredCount(): number {
    let count = 0
    for (const info of this.cache.values()) {
      if (info.source !== "estimate") count += 1
    }
    return count
  }

  /** Прочитать измеренное из постоянного кэша; вернуть то, чего там нет. */
  private async loadFromStore(
    pairs: Array<{ a: Place; b: Place; mode: "loaded" | "deadhead" }>,
  ): Promise<Array<{ a: Place; b: Place; mode: "loaded" | "deadhead" }>> {
    if (!this.store) return pairs
    try {
      const rows = await this.store.load(
        pairs.map((pair) => ({ from: pair.a.id, to: pair.b.id, mode: pair.mode })),
      )
      if (rows.length === 0) return pairs
      const byKey = new Map(rows.map((row) => [`${row.from}|${row.to}|${row.mode}`, row]))
      const rest: Array<{ a: Place; b: Place; mode: "loaded" | "deadhead" }> = []
      for (const pair of pairs) {
        const row = byKey.get(`${pair.a.id}|${pair.b.id}|${pair.mode}`)
        if (!row) {
          rest.push(pair)
          continue
        }
        const region = this.region(pair.a, pair.b)
        const speed = pair.mode === "loaded" ? region.speedLoadedKmh : region.speedEmptyKmh
        this.store2(pair.a, pair.b, pair.mode, {
          km: row.km,
          hours: speed > 0 ? row.km / speed : 0,
          osrmHours: null,
          source: row.source === "exchange" ? "exchange" : "osrm",
          confidence: "measured",
          tollsRub: null,
          provider: row.provider,
          measuredAt: row.measuredAt ? new Date(row.measuredAt).toISOString() : null,
          fromCache: true,
        })
        this.storeHits += 1
      }
      return rest
    } catch {
      return pairs
    }
  }

  /** Записывать измеренное в постоянный кэш пачкой, в конце предзагрузки. */
  private readonly pendingStore: Array<{
    from: string
    to: string
    mode: string
    km: number
    source: string
    provider: string | null
    measuredAt: Date
  }> = []

  private async flushStore(): Promise<void> {
    if (!this.store || this.pendingStore.length === 0) return
    const rows = [...this.pendingStore]
    this.pendingStore.length = 0
    try {
      await this.store.save(rows)
    } catch {
      // Кэш не критичен: расстояния уже посчитаны в памяти этого расчёта.
    }
  }

  /**
   * Матрица маршрутизатора для группы точек.
   *
   * Перебираются точки входа по порядку: своя, затем бесплатные запасные.
   * Не ответила ни одна — null, и участки останутся оценкой (честно помеченной).
   */
  private async table(
    places: Place[],
  ): Promise<{ distances?: number[][]; durations?: number[][]; provider: string } | null> {
    if (!this.fetchImpl) return null
    const coords = places.map((place) => `${place.point.lng},${place.point.lat}`).join(";")
    const query = `/table/v1/driving/${coords}?annotations=distance,duration`
    for (const endpoint of this.endpoints) {
      if (this.budgetLeft <= 0) return null
      this.budgetLeft -= 1
      const stats = this.routerStats.find((item) => item.name === endpoint.name)
      const started = Date.now()
      try {
        if (stats) stats.requests += 1
        this.osrmRequests += 1
        const response = await this.fetchImpl(`${endpoint.url}${query}`, {
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        if (!response.ok) {
          if (stats) stats.failures += 1
          continue
        }
        const data = (await response.json()) as {
          code?: string
          distances?: number[][]
          durations?: number[][]
        }
        if (data.code && data.code !== "Ok") {
          if (stats) stats.failures += 1
          continue
        }
        if (stats) stats.totalMs += Date.now() - started
        this.lastProvider = endpoint.name
        return { distances: data.distances, durations: data.durations, provider: endpoint.name }
      } catch {
        if (stats) stats.failures += 1
        continue
      }
    }
    return null
  }

  /** Один запрос маршрутизатору (или null, если не получилось ни у кого). */
  private async route(
    a: Place,
    b: Place,
    mode: "loaded" | "deadhead",
  ): Promise<SegmentInfo | null> {
    if (!this.fetchImpl || !a.point || !b.point) return null
    const query = `/route/v1/driving/${a.point.lng},${a.point.lat};${b.point.lng},${b.point.lat}?overview=false`
    for (const endpoint of this.endpoints) {
      if (this.budgetLeft <= 0) return null
      this.budgetLeft -= 1
      const stats = this.routerStats.find((item) => item.name === endpoint.name)
      const started = Date.now()
      try {
        if (stats) stats.requests += 1
        this.osrmRequests += 1
        const response = await this.fetchImpl(`${endpoint.url}${query}`, {
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        if (!response.ok) {
          if (stats) stats.failures += 1
          continue
        }
        const data = (await response.json()) as {
          routes?: Array<{ distance?: number; duration?: number }>
        }
        const route = data.routes?.[0]
        if (!route || typeof route.distance !== "number") {
          if (stats) stats.failures += 1
          continue
        }
        if (stats) stats.totalMs += Date.now() - started
        this.lastProvider = endpoint.name
        return this.osrmInfo(route.distance / 1000, route.duration, a, b, mode, endpoint.name)
      } catch {
        if (stats) stats.failures += 1
        continue
      }
    }
    return null
  }

  /**
   * Участок по данным маршрутизатора: километры измеренные, время — по модели
   * региона (см. комментарий к `SegmentInfo.hours`).
   *
   * Время маршрутизатора сохраняется отдельно (`osrmHours`): это легковой
   * профиль, и подставлять его в календарь фуры нельзя, но для сверки он нужен.
   */
  private osrmInfo(
    kmRaw: number,
    seconds: number | undefined,
    a: Place,
    b: Place,
    mode: "loaded" | "deadhead",
    provider: string,
  ): SegmentInfo {
    const km = Math.round(kmRaw * 10) / 10
    const region = this.region(a, b)
    const speed = mode === "loaded" ? region.speedLoadedKmh : region.speedEmptyKmh
    return {
      km,
      hours: speed > 0 ? km / speed : 0,
      osrmHours:
        typeof seconds === "number" && seconds > 0 ? Math.round((seconds / 3600) * 100) / 100 : null,
      source: "osrm",
      confidence: "measured",
      tollsRub: null,
      provider,
      measuredAt: new Date().toISOString(),
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

  /** Положить участок в память и (для измеренных) — в очередь на запись в базу. */
  private store2(a: Place, b: Place, mode: string, info: SegmentInfo): void {
    if (this.cache.size > this.cacheLimit) this.cache.clear()
    this.cache.set(this.key(a, b, mode), info)
    if (info.source === "osrm" && info.measuredAt) {
      this.pendingStore.push({
        from: a.id,
        to: b.id,
        mode,
        km: info.km,
        source: info.source,
        provider: info.provider ?? null,
        measuredAt: new Date(info.measuredAt),
      })
    }
  }

  /**
   * Участок маршрута. Синхронно: всё, что не успели получить из маршрутизатора
   * или из постоянного кэша, считается оценкой региона.
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
      // Оценка, понадобившаяся поиску, — кандидат на настоящее измерение.
      if (cached.source === "estimate" && this.estimateMisses.size < ESTIMATE_MISS_LIMIT) {
        this.estimateMisses.set(this.key(a, b, mode), { a, b, mode })
      }
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
        provider: "exchange",
        measuredAt: null,
      }
      this.store2(a, b, mode, info)
      return info
    }
    const info = this.estimate(a, b, mode)
    this.store2(a, b, mode, info)
    if (this.estimateMisses.size < ESTIMATE_MISS_LIMIT) {
      this.estimateMisses.set(this.key(a, b, mode), { a, b, mode })
    }
    return info
  }
}
