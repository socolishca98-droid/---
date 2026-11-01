// lib/routing/types.ts
//
// Контракты расчётного ядра сборки маршрутов.
//
// Правило этого файла: ни одного импорта. Здесь только формы данных, которые
// приходят снаружи (из базы, из биржи, из настроек организации) и уходят
// наружу (в API и на экран логиста). Ядро не знает ни Prisma, ни Next, ни
// браузера — поэтому один и тот же вход всегда даёт один и тот же результат.

// ---------------------------------------------------------------------------
// География
// ---------------------------------------------------------------------------

export interface Point {
  lat: number
  lng: number
}

/** Точка маршрута: город, его регион, координаты и часовой пояс. */
export interface Place {
  /** Стабильный идентификатор точки (id города из справочника) */
  id: string
  city: string
  /** «Ярославская область». null — регион неизвестен, параметры будут нейтральные */
  region: string | null
  point: Point
  /** IANA-пояс («Asia/Yekaterinburg»). null — пояс не определён */
  timeZone: string | null
}

/** Параметры региона: скорость и коэффициент дорожной сети. */
export interface RegionParams {
  key: string
  /** Средняя скорость с грузом, км/ч */
  speedLoadedKmh: number
  /** Средняя скорость порожним, км/ч */
  speedEmptyKmh: number
  /** Во сколько раз дорога длиннее прямой (1,2 — «европейская часть») */
  roadFactor: number
}

/** Откуда взялись километры участка. */
export type SegmentSource = "osrm" | "exchange" | "estimate"

// ---------------------------------------------------------------------------
// Заказ
// ---------------------------------------------------------------------------

export interface TimeWindow {
  /** Не раньше (ISO-строка), null/пусто — ограничения нет */
  from?: string | null
  /** Не позже (ISO-строка), null/пусто — ограничения нет */
  to?: string | null
}

export interface Rate {
  /** Сумма по заказу. При `basis: "perKm"` это цена за километр */
  amount: number
  /** За рейс (по умолчанию) или за километр */
  basis?: "perTrip" | "perKm"
  vatIncluded?: boolean
}

export interface LoadOrder {
  id: string
  organisationId: string
  pickup: Place
  delivery: Place
  /** Масса, кг. null — неизвестна (это не отказ, а незнание) */
  weightKg: number | null
  volumeM3: number | null
  /** Требуемый тип кузова: tent | reefer | isotherm | flatbed | tanker | any */
  bodyRequired: string[] | null
  window: { pickup: TimeWindow; delivery: TimeWindow }
  rate: Rate
  /**
   * Километраж, который заявляет биржа. Для гружёного плеча он главнее
   * маршрутизатора: по нему фрахтователь считает ставку.
   */
  exchangeKm: number | null
}

// ---------------------------------------------------------------------------
// Машина и деньги
// ---------------------------------------------------------------------------

/** Как организация платит водителю. Ровно одно правило на организацию. */
export type PayRule =
  | { kind: "perShift"; perShift: number }
  | { kind: "perKm"; perKm: number }
  | { kind: "perHour"; perHour: number }
  | { kind: "perTrip"; perTrip: number }
  | { kind: "mixed"; basePerShift: number; perKm: number }
  /**
   * Организация не разделяет водителя и работу машины: есть одна ставка ₽/км.
   * Тогда вся она попадает в одну статью и водитель отдельно НЕ начисляется —
   * иначе он был бы посчитан дважды.
   */
  | { kind: "includedInPerKm" }

export interface CostProfile {
  /** Цена литра, ₽ */
  fuelPricePerL: number
  driverPay: PayRule
  /** Износ и ТО, ₽/км */
  maintenancePerKm: number
  /** Шины, ₽/км */
  tiresPerKm: number
  /** Платные участки, ₽/км (если размечены) */
  tollsPerKm: number
  /** Прочие километровые расходы (стоянки, мойка), ₽/км */
  otherPerKm: number
  /** Постоянные расходы организации, ₽/сутки. Показываются, но НЕ вычитаются */
  fixedPerDay: number
}

export interface Vehicle {
  id: string
  organisationId: string
  plate: string
  /** Домашняя база машины: с неё начинается и на неё возвращается маршрут */
  homeBase: Place
  capacityKg: number
  capacityM3: number
  /** Типы кузова, которыми машина располагает */
  body: string[]
  /** Паспортный расход, л/100 км. null — неизвестен, берётся оценка */
  consumptionLPer100: number | null
  /** true — расход оценён, а не измерен; попадёт в assumptions */
  consumptionEstimated: boolean
  cost: CostProfile
  status: "available" | "in_use" | "maintenance"
}

// ---------------------------------------------------------------------------
// Настройки организации
// ---------------------------------------------------------------------------

/** Режим возврата на базу — участвует ВНУТРИ построения, а не после него. */
export type ReturnMode = "required" | "preferred" | "free"

export type RankingCriterion =
  | "profit"
  | "profitPerKm"
  | "emptyShare"
  | "duration"
  | "returnRequired"

export interface Settings {
  returnMode: ReturnMode
  /** Предел календарной длительности рейса, часы */
  maxRouteHours: number
  /** Сколько плеч максимум брать в одну цепочку */
  maxLegs: number
  /** Норма вождения между отдыхами, часы */
  drivingLimitHours: number
  /** Обязательный отдых, часы */
  restHours: number
  /** Отклонение ради следующего груза, км (справочно, не фильтр) */
  detourBaseKm: number
  detourShare: number
  /** Нижняя граница остатка на километр, ₽ (0 — не фильтровать) */
  minContributionPerKm: number
  /** Подготовка машины перед выездом, часы */
  preparationHours: number
  /** Радиус поиска ПЕРВОГО груза от базы, км */
  startRadiusKm: number
  /** Часы погрузки/выгрузки на тонну */
  handlingHoursPerTon: number
  /** Минимум часов на операцию (оформление, ожидание подъезда) */
  minHandlingHours: number
  /** Час открытия склада по местному времени точки */
  openingHour: number
  consolidationEnabled: boolean
  /** Сколько грузов одновременно в кузове максимум */
  maxConcurrentOrders: number
  ranking: RankingCriterion
}

// ---------------------------------------------------------------------------
// Результат расчёта
// ---------------------------------------------------------------------------

export interface PlannedStop {
  kind: "load" | "unload" | "return"
  /** У возврата на базу заказа нет */
  orderId: string | null
  place: Place
  /** Прибытие (UTC) */
  arriveAt: Date
  /** Начало операции после ожидания окна */
  startAt: Date
  /** Конец операции */
  endAt: Date
  waitingHours: number
  handlingHours: number
}

export interface PlannedSegment {
  from: Place
  to: Place
  /** deadhead — едем порожним, loaded — с грузом */
  kind: "deadhead" | "loaded"
  orderId: string | null
  km: number
  hours: number
  source: SegmentSource
  tollsRub: number | null
}

export interface Schedule {
  events: Array<{
    at: Date
    kind: "depart" | "arrive" | "wait" | "load" | "unload" | "rest" | "return" | "arriveBase"
    label: string
    place?: Place
    timeZone?: string | null
  }>
  startAt: Date
  endAt: Date
  drivingHours: number
  restHours: number
  waitingHours: number
  handlingHours: number
  shifts: number
  /** Переходы часовых поясов по ходу рейса */
  timeZoneBreaks: string[]
}

export interface CapacityUse {
  index: number
  kg: number
  m3: number
  items: string[]
}

export interface Economics {
  revenue: number
  fuelRub: number
  driverRub: number
  maintenanceRub: number
  tiresRub: number
  tollsRub: number | null
  otherRub: number
  /** Сколько постоянных расходов рейс покрывает (не вычитается) */
  fixedContributionRub: number
  netRub: number
  /**
   * Остаток при обязательстве вернуть машину на базу: для маршрута без возврата
   * из него вычтена стоимость возврата. Так сравнение вариантов честное — иначе
   * «уехать и не вернуться» всегда выглядит прибыльнее на цену возврата.
   */
  netCommittedRub: number
  netPerKm: number | null
  netPerHour: number | null
  totalKm: number
  loadedKm: number
  emptyKm: number
  emptyShare: number
  /** Статьи, которые не удалось посчитать точно */
  unknown: string[]
}

export interface ReturnOption {
  kind: "loaded" | "empty" | "none"
  deadheadKm: number
  costRub: number
  satisfiesMode: boolean
}

export interface RoutePlan {
  id: string
  organisationId: string
  vehicleId: string
  model: "sequential" | "consolidated"
  orderIds: string[]
  stops: PlannedStop[]
  segments: PlannedSegment[]
  schedule: Schedule
  capacity: CapacityUse[]
  economics: Economics
  returned: ReturnOption
  /** Точный оптимум или эвристика */
  exact: boolean
  confidence: "measured" | "estimated" | "assumed"
  assumptions: string[]
  warnings: string[]
  reasons: string[]
}

export interface Rejection {
  orderId: string
  reason: string
}

export interface PlanStats {
  consideredStates: number
  prunedStates: number
  /** Сколько наборов заказов проверено в сборной модели (для отчёта о скорости) */
  consideredGroups?: number
  distanceCalls: number
  distanceCacheHits: number
  elapsedMs: number
  /**
   * Доказан ли оптимум для РЕКОМЕНДАЦИИ. Не «движок вообще точный»: модель А
   * может быть точной, а сборная — эвристикой, и тогда честная пометка обязана
   * относиться к тому варианту, который логист видит первым.
   */
  exact: boolean
  exactSequential: boolean
  exactConsolidated: boolean
  /** Верхняя граница, до которой перебор считался точным */
  exactLimit: number
}

export interface PlanResult {
  organisationId: string
  vehicleId: string
  variants: RoutePlan[]
  recommended: RoutePlan | null
  rejected: Rejection[]
  stats: PlanStats
}
