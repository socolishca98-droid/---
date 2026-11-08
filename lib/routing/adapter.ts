// lib/routing/adapter.ts
//
// Адаптер: данные Loginex → контракты расчётного ядра.
//
// Зачем отдельным слоем: ядро (`lib/routing/*`) не знает ни Prisma, ни полей
// базы. Всё «переводческое» собрано здесь, поэтому:
//   · ядро можно тестировать без базы;
//   · если в базе появится поле (например, раздельные статьи расходов), меняется
//     только этот файл;
//   · всё, чего в данных нет, превращается в честное «неизвестно», а не в ноль.
//
// Правило: функция не выдумывает данные. Нет координат — вернёт `null` и
// проблему в `readiness`, чтобы экран сказал «не могу построить, потому что…».

import { bodyClass } from "./compatibility"
import { fuelPriceForRegion } from "../fleet/fuel-price"
import type {
  CostGap,
  CostProfile,
  LoadOrder,
  PayRule,
  Place,
  RegionParams,
  Settings,
  Vehicle,
} from "./types"
import { CITY_TIMEZONES, timeZoneForRegion } from "./timezones"
import { cityKey, cityLookupKey, parseAddress } from "./geo/address"
import { parseAtiRate, rateStatus } from "../pricing/status"

// ---------------------------------------------------------------------------
// Формы входа: ровно те поля, которые нужны, без зависимости от Prisma
// ---------------------------------------------------------------------------

export interface CityRow {
  city: string
  /** «Ярославская область». Может быть пустым */
  region?: string | null
  lat?: number | null
  lng?: number | null
}

export interface FleetSettingsRow {
  baseAddress?: string | null
  baseLat?: number | null
  baseLng?: number | null
  /** Работа машины по умолчанию, ₽/км (водитель + износ + шины + платные) */
  operatingCostPerKm?: number | null
  /** Норма вождения между отдыхами, минуты */
  restDriveLimitMin?: number | null
  /** Обязательный перерыв, минуты */
  restMinBreakMin?: number | null
  /** Регион базы, если он сохранён в настройках */
  baseRegion?: string | null
  // ── Правило оплаты водителя организации (решение 94: у каждой своё).
  //    Не задано — историческая ставка ₽/км, в которой водитель уже внутри.
  driverPayKind?: string | null
  driverPayPerShift?: number | null
  driverPayPerKm?: number | null
  driverPayPerHour?: number | null
  driverPayPerTrip?: number | null
  driverPayBasePerShift?: number | null
  /** true — ставка ₽/км считается вместе с водителем (историческая конвенция) */
  operatingCostIncludesDriver?: boolean | null
}

export interface VehicleRow {
  id: string
  organisationId: string
  plate: string
  /** Свободный текст типа: «Фура», «Рефрижератор», «Тент», «Газель» */
  type: string
  capacity: number
  volume?: number | null
  fuelConsumptionPer100?: number | null
  /** Своя ставка ₽/км; пусто — берётся ставка организации */
  operatingCostPerKm?: number | null
  status?: string | null
}

export interface AtiLoadRow {
  atiLoadId: string
  organisationId: string
  routeFrom: string
  routeTo: string
  distance?: number | null
  weight?: number | null
  volume?: number | null
  truckType?: string | null
  price?: number | null
  priceType?: string | null
  /** Статус цены, если посчитан при разборе выгрузки */
  priceStatus?: string | null
  /** Исходное значение цены, как пришло из ATI: число, строка, null */
  priceRaw?: unknown
  loadingDate?: Date | string | null
  unloadingDate?: Date | string | null
}

export interface OrderRow {
  id: string
  organisationId: string | null
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  volume?: number | null
  price?: number | null
  agreedPrice?: number | null
  priceStatus?: string | null
  loadingType?: string | null
  deadline?: Date | string | null
}

// ---------------------------------------------------------------------------
// Локации
// ---------------------------------------------------------------------------

/**
 * Ключ города: так сравниваются «Домодедово, Московская область» и «Домодедово».
 *
 * Сама функция переехала в `geo/address.ts` (там же разбор адреса); здесь —
 * реэкспорт, чтобы существующие вызовы и сохранённые ключи не менялись.
 */
export { cityKey }

/**
 * Точка маршрута из строки справочника.
 * Возвращает null, если координат нет: ядро без координат считает «ноль км» и
 * молча занижает расход — лучше явно отказаться.
 */
export function placeFromCity(row: CityRow): Place | null {
  if (typeof row.lat !== "number" || typeof row.lng !== "number") return null
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null
  const region = row.region?.trim() ? row.region.trim() : null
  return {
    id: cityKey(row.city),
    city: row.city,
    region,
    point: { lat: row.lat, lng: row.lng },
    timeZone: timeZoneForRegion(region) ?? CITY_TIMEZONES[cityKey(row.city)] ?? null,
  }
}

/**
 * Регион из адреса. «Московская область, Домодедово, ул. Логистическая, 12» →
 * «Московская область». Отдельного поля региона в настройках нет, а без
 * региона не определить часовой пояс и цену топлива.
 */
export function regionFromAddress(address: string | null | undefined): string | null {
  return parseAddress(address).region
}

/**
 * База организации: адрес, координаты и регион из настроек автопарка.
 *
 * Город берётся из разбора адреса, а не из «второй части после запятой»:
 * адрес «Ярославль. Ул. Докучалова 12» давал город «Ярославль. Ул. Докучалова
 * 12», «Ярославль, ул. Докучалова 12» — город «ул. Докучалова 12». Регион и
 * часовой пояс при этом терялись, и все ожидания окон считались без сдвига.
 *
 * `hints` — то, что знает сервер: регион из карточки организации или из
 * справочника ATI по названию города. Адаптер остаётся синхронным: в базу он не
 * ходит, недостающее принимает готовым.
 */
export function baseFromSettings(
  row: FleetSettingsRow | null,
  hints?: { region?: string | null; timeZone?: string | null },
): Place | null {
  if (!row) return null
  if (typeof row.baseLat !== "number" || typeof row.baseLng !== "number") return null
  const parsed = parseAddress(row.baseAddress)
  const region =
    (row.baseRegion?.trim() ? row.baseRegion.trim() : null) ??
    hints?.region?.trim() ??
    parsed.region ??
    null
  const cityName = parsed.city ?? (row.baseAddress?.trim() ? row.baseAddress.trim() : "База")
  return {
    id: `base:${cityLookupKey(cityName)}`,
    city: cityName,
    region,
    point: { lat: row.baseLat, lng: row.baseLng },
    timeZone:
      hints?.timeZone ??
      timeZoneForRegion(region) ??
      CITY_TIMEZONES[cityLookupKey(cityName)] ??
      CITY_TIMEZONES[cityKey(cityName)] ??
      null,
  }
}

// ---------------------------------------------------------------------------
// Деньги и настройки
// ---------------------------------------------------------------------------

/**
 * Профиль расходов организации.
 *
 * В FleetSettings расходы заданы ОДНОЙ ставкой ₽/км — «водитель, износ, ТО,
 * шины, платные дороги, стоянки». Разложить её по статьям без данных нельзя,
 * поэтому:
 *   · ставка попадает в километровые расходы целиком;
 *   · водитель отдельно НЕ начисляется (`includedInPerKm`) — иначе он был бы
 *     посчитан дважды;
 *   · в `unknown` появляется строка, что разбивки нет.
 * Цена топлива берётся по региону базы (Росстат, срез с датой), а не из головы.
 */
export function costFromSettings(
  settings: FleetSettingsRow | null,
  vehicle: VehicleRow | null,
  baseRegion: string | null,
): { cost: CostProfile; notes: string[] } {
  const notes: string[] = []
  const gaps: CostGap[] = []
  const perKm = vehicle?.operatingCostPerKm ?? settings?.operatingCostPerKm ?? null
  const fuelPricePerL = fuelPriceForRegion(baseRegion)

  if (perKm === null || perKm === undefined) {
    // Не «ноль рублей», а «неизвестно»: эта статья обязана доехать до экрана
    // как пробел расчёта, иначе остаток выдаётся за прибыль.
    notes.push("ставка ₽/км не задана — километровые расходы считаются нулевыми, остаток завышен")
    gaps.push({
      article: "ставка ₽/км",
      reason: "ставка работы машины не задана — износ, шины и платные в остатке отсутствуют",
      estimateRub: null,
      inNet: false,
    })
  }

  /**
   * Правило оплаты водителя.
   *
   * Историческая конвенция FleetSettings: в одной ставке ₽/км лежат «водитель,
   * износ, ТО, шины, платные». Пока организация не задала своё правило, водитель
   * считается включённым в ставку — так же, как считалось до появления этих
   * полей. Как только правило задано, водитель становится отдельной статьёй.
   *
   * Двойной учёт проверяется явно: если правило задано, а флаг
   * `operatingCostIncludesDriver` не снят, одна и та же оплата попала бы и в
   * ₽/км, и в статью «водитель». Молча считать дважды нельзя — это пробел.
   */
  const kind = settings?.driverPayKind ?? null
  const includesDriver = settings?.operatingCostIncludesDriver ?? true
  const positive = (value: number | null | undefined): number | null =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null

  let payRule: PayRule = { kind: "includedInPerKm" }
  if (kind && kind !== "includedInPerKm") {
    const perShift = positive(settings?.driverPayPerShift)
    const ratePerKm = positive(settings?.driverPayPerKm)
    const perHour = positive(settings?.driverPayPerHour)
    const perTrip = positive(settings?.driverPayPerTrip)
    const basePerShift = positive(settings?.driverPayBasePerShift)
    const built = payRuleFromKind(kind, { perShift, ratePerKm, perHour, perTrip, basePerShift })
    if (!built) {
      notes.push(`правило оплаты водителя «${kind}» задано не полностью — водитель не начислен`)
      gaps.push({
        article: "водитель",
        reason: `правило оплаты «${kind}» задано не полностью — водитель в остатке отсутствует`,
        estimateRub: null,
        inNet: false,
      })
      payRule = { kind: "unknown" }
    } else {
      payRule = built
      notes.push(`оплата водителя: своё правило организации «${kind}»`)
      if (includesDriver && perKm !== null && perKm !== undefined) {
        notes.push(
          "ставка ₽/км помечена как «включает водителя», а оплата задана отдельным правилом — " +
            "возможен двойной учёт, снимите флаг «ставка включает водителя»",
        )
        gaps.push({
          article: "водитель",
          reason:
            "оплата задана отдельным правилом, но ставка ₽/км тоже включает водителя — " +
            "возможен двойной учёт",
          estimateRub: null,
          inNet: false,
        })
      }
    }
  } else if (kind === "includedInPerKm" || kind === null) {
    notes.push(
      "ставка ₽/км задана одной цифрой (водитель, износ, шины, платные вместе) — " +
        "раздельных статей в настройках нет",
    )
  }

  return {
    cost: {
      fuelPricePerL,
      driverPay: payRule,
      // Вся ставка — в «износ и ТО»: это самая крупная из километровых статей,
      // а раздельные строки покажут ноль, о чём сказано в notes.
      maintenancePerKm: perKm ?? 0,
      tiresPerKm: 0,
      tollsPerKm: 0,
      otherPerKm: 0,
      // Постоянные расходы организации в базе не ведутся: не выдумываем.
      fixedPerDay: 0,
      gaps,
    },
    notes,
  }
}

/**
 * Правило оплаты из полей настроек.
 *
 * Возвращает null, если для выбранного вида не задана хотя бы одна нужная
 * ставка: «оплата по км» без ставки ₽/км — это не ноль рублей, а незаполненное
 * правило, и оно обязано стать пробелом, а не тишиной.
 */
export function payRuleFromKind(
  kind: string,
  values: {
    perShift: number | null
    ratePerKm: number | null
    perHour: number | null
    perTrip: number | null
    basePerShift: number | null
  },
): PayRule | null {
  switch (kind) {
    case "perShift":
      return values.perShift === null ? null : { kind: "perShift", perShift: values.perShift }
    case "perKm":
      return values.ratePerKm === null ? null : { kind: "perKm", perKm: values.ratePerKm }
    case "perHour":
      return values.perHour === null ? null : { kind: "perHour", perHour: values.perHour }
    case "perTrip":
      return values.perTrip === null ? null : { kind: "perTrip", perTrip: values.perTrip }
    case "mixed":
      return values.basePerShift === null || values.ratePerKm === null
        ? null
        : { kind: "mixed", basePerShift: values.basePerShift, perKm: values.ratePerKm }
    case "includedInPerKm":
      return { kind: "includedInPerKm" }
    default:
      return null
  }
}

/**
 * Нормы вождения и отдыха для ПЛАНИРОВАНИЯ рейса.
 *
 * Важно не перепутать две разные вещи:
 *   · `restDriveLimitMin` / `restMinBreakMin` в FleetSettings — это напоминание
 *     В ПРИЛОЖЕНИИ ВОДИТЕЛЯ: «после 4,5 ч движения — перерыв 45 минут». Это
 *     внутрисменный перерыв, а не суточная норма;
 *   · календарь рейса на несколько дней считается по суточной норме.
 *
 * Пока в настройках нет отдельного поля для суточной нормы, планировщик берёт
 * 9 ч вождения и 11 ч отдыха, а перерыв из настроек остаётся в приложении
 * водителя. Если организация задала настоящую суточную норму (≥ 6 ч вождения),
 * берётся она: значит, человек понимает, что настраивает.
 */
export function planningNorms(settings: FleetSettingsRow | null): {
  drivingLimitHours: number
  restHours: number
  source: "organization" | "standard"
} {
  const driveMin = settings?.restDriveLimitMin ?? null
  const breakMin = settings?.restMinBreakMin ?? null
  const looksLikeDailyNorm = driveMin !== null && driveMin >= 360
  if (looksLikeDailyNorm) {
    return {
      drivingLimitHours: driveMin / 60,
      restHours: Math.max(0, (breakMin ?? 660) / 60),
      source: "organization",
    }
  }
  return { drivingLimitHours: 9, restHours: 11, source: "standard" }
}

/** Настройки расчёта: нормы из организации (см. `planningNorms`). */
export function settingsFromOrg(settings: FleetSettingsRow | null): Settings {
  const norms = planningNorms(settings)
  return {
    returnMode: "preferred",
    maxRouteHours: 72,
    maxLegs: 8,
    drivingLimitHours: norms.drivingLimitHours,
    restHours: norms.restHours,
    detourBaseKm: 150,
    detourShare: 0.15,
    minContributionPerKm: 0,
    preparationHours: 2,
    startRadiusKm: 300,
    // Норма погрузки/выгрузки: ≈9 минут на тонну. Прежние 0,6 ч/т давали
    // 10,8 ч на 18 тонн — то есть половину суток на одну операцию, и календарь
    // рейса раздувался вдвое. Значение настраивается организацией.
    handlingHoursPerTon: 0.15,
    minHandlingHours: 1.5,
    openingHour: 8,
    consolidationEnabled: true,
    maxConcurrentOrders: 3,
    ranking: "profit",
  }
}

/** Параметры регионов: база + все регионы, которые встречаются в пуле. */
export function regionsFromRows(regions: Array<string | null | undefined>): RegionParams[] {
  const keys = new Set<string>()
  for (const region of regions) {
    const text = region?.trim()
    if (text) keys.add(text)
  }
  return [...keys].map((regionKey) => ({
    key: regionKey,
    // Средние скорости для грузовика на междугородних трассах. Это оценка, а не
    // измерение: когда появится OSRM, время придёт от него, а коэффициент
    // останется только для порожних оценок.
    speedLoadedKmh: 55,
    speedEmptyKmh: 60,
    roadFactor: 1.2,
  }))
}

// ---------------------------------------------------------------------------
// Машины
// ---------------------------------------------------------------------------

/**
 * Оценка расхода, когда в карточке машины его нет.
 *
 * Почему оценка, а не ноль: ноль — это не «неизвестно», это «топливо
 * бесплатное». На рейсе 1000 км разница между 0 и 30 л/100 км — около 25 000 ₽
 * остатка, и логист увидел бы прибыльный рейс, который на деле убыточен.
 * Оценка помечается (`consumptionEstimated`), попадает в допущения расчёта и
 * показывается на экране — это честнее и полезнее нуля.
 */
export function estimatedConsumption(capacityKg: number): number {
  if (capacityKg >= 15000) return 30
  if (capacityKg >= 8000) return 22
  if (capacityKg >= 4000) return 17
  if (capacityKg >= 2000) return 14
  return 11
}

export function vehicleFromRow(
  row: VehicleRow,
  base: Place,
  settings: FleetSettingsRow | null,
  baseRegion: string | null,
): Vehicle {
  const { cost } = costFromSettings(settings, row, baseRegion)
  const status =
    row.status === "maintenance" || row.status === "in_use" || row.status === "available"
      ? row.status
      : "available"
  return {
    id: row.id,
    organisationId: row.organisationId,
    plate: row.plate,
    homeBase: base,
    capacityKg: row.capacity,
    capacityM3: row.volume ?? 0,
    body: [bodyClass(row.type)],
    consumptionLPer100: row.fuelConsumptionPer100 ?? estimatedConsumption(row.capacity),
    consumptionEstimated: !row.fuelConsumptionPer100,
    cost,
    status,
  }
}

// ---------------------------------------------------------------------------
// Заказы
// ---------------------------------------------------------------------------

/** Окно из одной даты: «не раньше даты» — это всё, что известно из биржи. */
function windowFrom(date: Date | string | null | undefined) {
  if (!date) return {}
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return {}
  return { from: value.toISOString() }
}

/**
 * Окно «не позже даты»: дедлайн заказа — крайний срок, а не дата начала.
 * Раньше дедлайн попадал в windowFrom, расписание честно ждало его
 * (созданный заказ живёт с дедлайном +7 дней) — и заказ выпадал из
 * горизонта плана, хотя везти его можно хоть завтра.
 */
function windowTo(date: Date | string | null | undefined) {
  if (!date) return {}
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return {}
  return { to: value.toISOString() }
}

export interface OrderBuildResult {
  order: LoadOrder | null
  /** Что помешало или чего не хватает */
  problems: string[]
}

/**
 * Заказ из строки накопленной базы ATI.
 *
 * `distance` биржи — это гружёное плечо, и оно главнее маршрутизатора: по нему
 * фрахтователь считает ставку. Поэтому оно идёт в `exchangeKm`.
 */
/** Организация строки: сервис передаёт `organisationId`, Prisma отдаёт `organizationId`. */
function organisationOfRow(row: { organisationId?: string | null; organizationId?: string | null }) {
  return row.organisationId ?? row.organizationId ?? ""
}

/**
 * Статусы резолва городов пула (geo/places): по ним формулируется причина
 * пропуска груза. «Нет координат» и «город неоднозначен» — разные проблемы
 * с разными решениями: первое лечится геокодером, второе — областью в адресе.
 */
export type PlaceStatuses = Map<string, { status: string; note: string | null }>

/** Причина пропуска города: неоднозначность — не «нет координат». */
function placeProblem(
  raw: string,
  statuses?: PlaceStatuses,
  kind: "погрузки" | "выгрузки" = "погрузки",
): string {
  const status = statuses?.get(raw)
  if (status?.status === "ambiguous") {
    return `имя города «${raw}» неоднозначно — укажите область`
  }
  return `нет координат точки ${kind} «${raw}»`
}

export function orderFromAtiRow(
  row: AtiLoadRow,
  places: Map<string, Place>,
  statuses?: PlaceStatuses,
): OrderBuildResult {
  const problems: string[] = []
  const pickup = places.get(cityKey(row.routeFrom))
  const delivery = places.get(cityKey(row.routeTo))
  if (!pickup) problems.push(placeProblem(row.routeFrom, statuses, "погрузки"))
  if (!delivery) problems.push(placeProblem(row.routeTo, statuses, "выгрузки"))
  // Координаты — единственное, без чего заказ построить нельзя: без них нет
  // ни расстояния, ни экономики. Цена же может отсутствовать: это повод для
  // оценки и звонка, а не причина выбросить заявку. Раньше такая заявка
  // отбрасывалась целиком с причиной «ставка не указана», и логист её вообще
  // не видел — при том, что именно по ней и надо было звонить.
  if (!pickup || !delivery) return { order: null, problems }

  // Цена: три поля ATI в правильном порядке (с НДС → без НДС → общее) и
  // исходное значение в rate.raw. Ноль и пустое — «не указана».
  // Исходное значение сохраняется ДОСЛОВНО, включая ноль и пустую строку:
  // иначе «0» в выгрузке превращается в null и пропадает след того, что ATI
  // прислала именно ноль, а не отсутствие поля.
  const rawPrice = row.priceRaw !== undefined && row.priceRaw !== null ? row.priceRaw : row.price
  const parsed = parseAtiRate({ price: rawPrice })
  const status = row.priceStatus
    ? rateStatus({ amount: parsed.amountRub, status: row.priceStatus as never })
    : parsed.status
  if (status !== "CONFIRMED") problems.push(parsed.note)

  const perKm = row.priceType === "perKm"
  return {
    order: {
      id: row.atiLoadId,
      organisationId: organisationOfRow(row),
      pickup,
      delivery,
      weightKg: row.weight ?? null,
      volumeM3: row.volume ?? null,
      bodyRequired: row.truckType ? [bodyClass(row.truckType)] : null,
      window: {
        pickup: windowFrom(row.loadingDate),
        delivery: windowFrom(row.unloadingDate),
      },
      rate: {
        // Сумма остаётся честной: при неизвестной цене это 0, а не «бесплатно»,
        // и статус говорит, что деньги неизвестны.
        amount: parsed.amountRub,
        basis: perKm ? "perKm" : "perTrip",
        status,
        raw: parsed.raw,
      },
      exchangeKm: row.distance && row.distance > 0 ? row.distance : null,
    },
    problems,
  }
}

/** Заказ из рабочей таблицы Order (взятый в работу). */
export function orderFromOrderRow(
  row: OrderRow,
  places: Map<string, Place>,
  organisationId: string,
  statuses?: PlaceStatuses,
): OrderBuildResult {
  const problems: string[] = []
  const pickup = places.get(cityKey(row.routeFrom))
  const delivery = places.get(cityKey(row.routeTo))
  if (!pickup) problems.push(placeProblem(row.routeFrom, statuses, "погрузки"))
  if (!delivery) problems.push(placeProblem(row.routeTo, statuses, "выгрузки"))
  // Согласованная цена главнее: это деньги, о которых договорились.
  const agreed = row.agreedPrice !== null && row.agreedPrice !== undefined && row.agreedPrice > 0
  const amount = agreed ? row.agreedPrice! : row.price ?? null
  if (!pickup || !delivery) return { order: null, problems }
  const status = agreed
    ? "CONFIRMED"
    : rateStatus({ amount: amount ?? null, status: (row.priceStatus as never) ?? null })
  if (!agreed && status !== "CONFIRMED") problems.push("ставка не согласована — нужна оценка или звонок")

  return {
    order: {
      id: row.id,
      organisationId: organisationOfRow(row) || organisationId,
      pickup,
      delivery,
      weightKg: row.weight ?? null,
      volumeM3: row.volume ?? null,
      bodyRequired: row.loadingType ? [bodyClass(row.loadingType)] : null,
      window: { pickup: {}, delivery: windowTo(row.deadline) },
      rate: { amount: agreed ? amount! : amount ?? 0, basis: "perTrip", status, raw: row.price ?? null },
      exchangeKm: row.distance && row.distance > 0 ? row.distance : null,
    },
    problems,
  }
}

// ---------------------------------------------------------------------------
// Готовность к расчёту
// ---------------------------------------------------------------------------

export interface Readiness {
  ok: boolean
  /** Всё, что мешает строить маршрут вообще */
  blockers: string[]
  /** Что построить можно, но результат будет грубее — и об этом надо сказать */
  warnings: string[]
}

/**
 * Проверка перед расчётом.
 *
 * Логист должен получить «не могу: нет базы» с кнопкой «куда идти», а не пустой
 * экран или выдуманный маршрут из нулевой точки.
 */
export function readiness(input: {
  base: Place | null
  vehicles: Vehicle[]
  orders: LoadOrder[]
  orderProblems: string[]
}): Readiness {
  const blockers: string[] = []
  const warnings: string[] = []

  if (!input.base) {
    blockers.push(
      "у организации не задан адрес базы и её координаты — маршрут не от чего строить " +
        "(Настройки → Автопарк → адрес базы)",
    )
  }
  if (input.vehicles.length === 0) {
    blockers.push("нет доступных машин: автопарк пуст или все машины в ремонте")
  }
  for (const vehicle of input.vehicles) {
    if (vehicle.consumptionEstimated) {
      warnings.push(
        `у машины ${vehicle.plate} не указан расход топлива — взята оценка ` +
          `${vehicle.consumptionLPer100} л/100 км (укажите в карточке машины)`,
      )
    }
    if (!vehicle.capacityM3) {
      warnings.push(`у машины ${vehicle.plate} не указан объём кузова — объём не проверяется`)
    }
    if (!vehicle.homeBase.timeZone) {
      warnings.push(
        `у базы не определён часовой пояс — ожидание окон считается без сдвига пояса`,
      )
    }
  }
  // Грузы без подтверждённой цены. Их не «нет» — они есть, просто денег по
  // ним пока не знает никто. Раньше такие заявки отбрасывались на входе с
  // причиной «ставка не указана», и логист видел пустой экран вместо списка
  // грузов, по которым надо звонить.
  const unpriced = input.orders.filter((order) => rateStatus(order.rate) !== "CONFIRMED")
  const estimated = unpriced.filter((order) => rateStatus(order.rate) === "ESTIMATED")
  if (estimated.length > 0) {
    warnings.push(
      `${estimated.length} гр. с расчётной стоимостью — доход по ним не подтверждён, ` +
        `рейс с такой ценой не считается прибыльным до звонка перевозчику`,
    )
  }
  const unknown = unpriced.length - estimated.length
  if (unknown > 0) {
    warnings.push(
      `${unknown} гр. без стоимости и без расчёта — по ним нужен звонок перевозчику, ` +
        `в экономику они не подставлены (0 ₽ — не бесплатная перевозка)`,
    )
  }

  if (input.orders.length === 0) {
    blockers.push(
      input.orderProblems.length > 0
        ? `ни одного груза с координатами и ставкой: ${input.orderProblems.slice(0, 3).join("; ")}`
        : "в пуле нет подходящих грузов — на этом направлении предложений нет. " +
          "Стоимость можно оценить по аналогам: расчёт покажет диапазон и уверенность, " +
          "а если аналогов нет — честно скажет, что данных недостаточно",
    )
  }
  if (input.orderProblems.length > 0 && input.orders.length > 0) {
    warnings.push(
      `часть грузов пропущена: ${input.orderProblems.slice(0, 3).join("; ")}` +
        (input.orderProblems.length > 3 ? ` и ещё ${input.orderProblems.length - 3}` : ""),
    )
  }

  // Одинаковые предупреждения не повторяются: «у базы не определён пояс» —
  // это одно сообщение, а не по одному на каждую машину.
  return { ok: blockers.length === 0, blockers, warnings: [...new Set(warnings)] }
}
