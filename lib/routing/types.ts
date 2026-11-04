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

/**
 * Достоверность цены. Это НЕ то же самое, что «цена известна/нет»:
 *
 *   · CONFIRMED — цена настоящая: её назвал фрахтователь и её видели в заявке
 *     или подтвердили по телефону. Только такая цена идёт в гарантированную
 *     прибыль;
 *   · ESTIMATED — расчётная. Получена из аналогов или истории, помечена
 *     диапазоном и уровнем уверенности. Ей можно ранжировать варианты, но
 *     нельзя называть доходом «на руки»;
 *   · NEGOTIATION_REQUIRED — цена не указана и её нельзя оценить по данным
 *     (нужен звонок). Не ноль и не бесплатная перевозка;
 *   · UNKNOWN — формат цены непонятен: строка вместо числа, отрицательное
 *     значение, «договорная» без цифр. Разбираться человеком.
 *
 * Зачем отдельными статусами, а не «amount === 0»: на бирже ноль означает
 * «не указана», и раньше это превращалось в доход 0 — маршрут выглядел
 * убыточным по причине, которой не существует.
 */
export type PriceStatus = "CONFIRMED" | "ESTIMATED" | "NEGOTIATION_REQUIRED" | "UNKNOWN"

export type EstimateConfidence = "high" | "medium" | "low"

/**
 * Расчётная цена и всё, что нужно, чтобы ей поверили ровно настолько, насколько
 * она заслуживает: откуда взята, из скольких аналогов, насколько разбросаны
 * данные и когда их смотрели.
 */
export interface RateEstimate {
  /** Средняя расчётная цена, ₽ за рейс */
  amountRub: number
  /** Нижняя граница оценки, ₽ (null — данных мало для границ) */
  lowRub: number | null
  /** Верхняя граница оценки, ₽ */
  highRub: number | null
  /** Расчётная цена за километр, ₽/км (null — километры неизвестны) */
  perKmRub: number | null
  confidence: EstimateConfidence
  /** Сколько сопоставимых перевозок легло в расчёт */
  samples: number
  /** Главный источник: history | ati-same-direction | ati-nearby | cost-model */
  source: string
  /** Все участвовавшие источники — по убыванию веса */
  sources: string[]
  /** Объяснение словами: «7 сопоставимых предложений на этом направлении, разброс 12 %» */
  basis: string
  /** Когда данные получены (ISO) */
  measuredAt: string | null
  /** Валюта расчёта. Пока всегда RUB: в карточке организации валюты нет. */
  currency: string
  /** Ниже этой суммы рейс убыточен по расходам организации (себестоимость) */
  costFloorRub: number | null
}

export interface Rate {
  /** Сумма по заказу. При `basis: "perKm"` это цена за километр */
  amount: number
  /** За рейс (по умолчанию) или за километр */
  basis?: "perTrip" | "perKm"
  vatIncluded?: boolean
  /**
   * Достоверность. Не задана — цена считается подтверждённой только если она
   * положительна (совместимость со старыми вызовами); `amount: 0` без статуса
   * трактуется как «не указана», а не как «бесплатно».
   */
  status?: PriceStatus
  /** Расчётная цена: заполняется, когда status = ESTIMATED */
  estimate?: RateEstimate | null
  /** Исходное значение из источника, как пришло (число, строка, null) */
  raw?: unknown
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
  /**
   * Правило оплаты в организации не задано. Это не «ноль рублей»: экран обязан
   * сказать, что оплата водителя в остатке не учтена, а не показывать прибыль,
   * из которой водителя забыли вычесть.
   */
  | { kind: "unknown" }

/**
 * Статья расходов, которую не удалось посчитать точно.
 *
 * Зачем отдельная форма, а не строка предупреждения: логисту нужно не «есть
 * неизвестность», а «какая статья, почему, сколько это максимум и вошло ли
 * оно в остаток». Из этих четырёх вещей и складывается статус полноты.
 */
export interface CostGap {
  /** Название статьи: «водитель», «платные дороги», «ставка ₽/км» */
  article: string
  /** Почему не посчитано — словами для экрана */
  reason: string
  /**
   * Оценка, если её честно можно дать (например, платные из ₽/км × км).
   * null — оценить нельзя даже сверху.
   */
  estimateRub: number | null
  /** true — оценка уже вычтена в остатке; false — статьи в остатке нет */
  inNet: boolean
}

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
  /**
   * Чего в профиле не хватает. Заполняет адаптер (он знает, что было в
   * настройках, а чего не было); расчёт обязан донести это до результата.
   */
  gaps?: CostGap[]
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
  /** Сумма известных расходов, участвующих в остатке */
  knownCostRub: number
  /** Пробелы расчёта: что именно неизвестно и вошло ли в остаток */
  gaps: CostGap[]
  /**
   * Полнота денежного расчёта.
   * complete     — все статьи известны, netRub можно называть прибылью;
   * preliminary  — есть неизвестное, но с оценкой, и оценка уже в остатке;
   * insufficient — часть расходов в остатке отсутствует: это НЕ прибыль.
   */
  status: "complete" | "preliminary" | "insufficient"
  /**
   * Доход, подтверждённый источником: в заявке стояла цена либо её согласовали
   * с заказчиком. Только эта часть — гарантированные деньги.
   */
  revenueConfirmed: number
  /** Доход из расчёта Loginex. Это не деньги, а ожидание: подтверждения нет. */
  revenueEstimated: number
  /**
   * Состояние дохода:
   *   confirmed        — все заказы рейса с подтверждённой ценой;
   *   partly-estimated — часть дохода расчётная, часть подтверждена;
   *   unconfirmed      — подтверждённого дохода нет вовсе.
   */
  revenueStatus: "confirmed" | "partly-estimated" | "unconfirmed"
  /**
   * true — остаток положителен (или убыток меньше) только за счёт расчётной
   * цены. Такой рейс нельзя объявлять прибыльным.
   */
  profitDependsOnEstimate: boolean
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
  /**
   * Сколько доказано о качестве этого варианта.
   *
   *   proven          — перебор шёл до конца, лучше этого варианта в модели нет;
   *   best-of-checked — вариант исполним и лучше всех ПРОВЕРЕННЫХ, но часть
   *                     пространства не перебиралась (потолок состояний, бюджет,
   *                     короткий список, отсечение границей);
   *   feasible        — вариант исполним, о качестве не утверждается ничего
   *                     (одиночный расчёт для объяснения отказа и подобное).
   *
   * Раньше было одно поле `exact`, и оно означало сразу три разные вещи.
   */
  optimality?: "proven" | "best-of-checked" | "feasible"
  /** Синоним `optimality === "proven"`. Оставлен для совместимости вызовов */
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
  /**
   * Почему перебор НЕ был полным — словами. Пусто — был полным.
   * Нужно, чтобы «доказан» нельзя было объявить молча: у каждой неполноты есть
   * причина, и она называется.
   */
  truncations: string[]
  /**
   * Откуда взялись километры: кто отвечал, сколько раз упал, сколько участков
   * измерено, а сколько оценено. Без этого «маршрут построен» скрывает, что
   * экономика стоит на догадке.
   */
  router?: {
    providers: Array<{ name: string; requests: number; failures: number }>
    storeHits: number
    /** Участки измеренных вариантов: измерено / оценено */
    measuredSegments: number
    estimatedSegments: number
  }
}

export interface PlanResult {
  organisationId: string
  vehicleId: string
  variants: RoutePlan[]
  recommended: RoutePlan | null
  rejected: Rejection[]
  stats: PlanStats
  /**
   * Грузы, которые подходят машине, но не имеют цены и оценки.
   *
   * Они не выбрасываются молча: логист должен их видеть и позвонить, а не
   * гадать, почему груз «исчез». В оптимизацию такие заказы не идут, потому
   * что цена 0 — это не «бесплатно», а «неизвестно», и маршрут с нулевым
   * доходом был бы ложным убытком.
   */
  unpriced: Array<{ orderId: string; status: PriceStatus; reason: string }>
}
