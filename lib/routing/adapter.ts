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
  CostProfile,
  LoadOrder,
  PayRule,
  Place,
  RegionParams,
  Settings,
  Vehicle,
} from "./types"
import { CITY_TIMEZONES, timeZoneForRegion } from "./timezones"

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
  loadingType?: string | null
  deadline?: Date | string | null
}

// ---------------------------------------------------------------------------
// Локации
// ---------------------------------------------------------------------------

/** Ключ города: так сравниваются «Домодедово, Московская область» и «Домодедово». */
export function cityKey(city: string): string {
  return String(city ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+(г\.|город|п\.|пос\.|с\.|д\.|пгт)$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

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
  const parts = String(address ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  for (const part of parts) {
    if (/(область|край|республика|автономный округ|ао)$/i.test(part)) return part
  }
  return null
}

/** База организации: адрес, координаты и регион из настроек автопарка. */
export function baseFromSettings(row: FleetSettingsRow | null): Place | null {
  if (!row) return null
  if (typeof row.baseLat !== "number" || typeof row.baseLng !== "number") return null
  const region = row.baseRegion?.trim()
    ? row.baseRegion.trim()
    : regionFromAddress(row.baseAddress)
  const city = (row.baseAddress ?? "").split(",").map((part) => part.trim()).filter(Boolean)
  // «Московская область, Домодедово, улица Логистическая, 12» → город «Домодедово»
  const cityName = city.length >= 2 ? city[1] : (city[0] ?? "База")
  return {
    id: `base:${cityName.toLowerCase()}`,
    city: cityName,
    region,
    point: { lat: row.baseLat, lng: row.baseLng },
    timeZone: timeZoneForRegion(region) ?? CITY_TIMEZONES[cityKey(cityName)] ?? null,
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
  const perKm = vehicle?.operatingCostPerKm ?? settings?.operatingCostPerKm ?? null
  const fuelPricePerL = fuelPriceForRegion(baseRegion)

  if (perKm === null || perKm === undefined) {
    notes.push("ставка ₽/км не задана — километровые расходы считаются нулевыми, остаток завышен")
  }
  notes.push(
    "ставка ₽/км задана одной цифрой (водитель, износ, шины, платные вместе) — " +
      "раздельных статей в настройках нет",
  )

  const payRule: PayRule = { kind: "includedInPerKm" }

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
    },
    notes,
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

export function orderFromAtiRow(
  row: AtiLoadRow,
  places: Map<string, Place>,
): OrderBuildResult {
  const problems: string[] = []
  const pickup = places.get(cityKey(row.routeFrom))
  const delivery = places.get(cityKey(row.routeTo))
  if (!pickup) problems.push(`нет координат точки погрузки «${row.routeFrom}»`)
  if (!delivery) problems.push(`нет координат точки выгрузки «${row.routeTo}»`)
  if (row.price === null || row.price === undefined) problems.push("ставка не указана")
  if (!pickup || !delivery || row.price === null || row.price === undefined) {
    return { order: null, problems }
  }

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
      rate: { amount: row.price, basis: perKm ? "perKm" : "perTrip" },
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
): OrderBuildResult {
  const problems: string[] = []
  const pickup = places.get(cityKey(row.routeFrom))
  const delivery = places.get(cityKey(row.routeTo))
  if (!pickup) problems.push(`нет координат точки погрузки «${row.routeFrom}»`)
  if (!delivery) problems.push(`нет координат точки выгрузки «${row.routeTo}»`)
  const amount = row.agreedPrice ?? row.price ?? null
  if (amount === null) problems.push("ставка не согласована")
  if (!pickup || !delivery || amount === null) return { order: null, problems }

  return {
    order: {
      id: row.id,
      organisationId: organisationOfRow(row) || organisationId,
      pickup,
      delivery,
      weightKg: row.weight ?? null,
      volumeM3: row.volume ?? null,
      bodyRequired: row.loadingType ? [bodyClass(row.loadingType)] : null,
      window: { pickup: {}, delivery: windowFrom(row.deadline) },
      rate: { amount, basis: "perTrip" },
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
  if (input.orders.length === 0) {
    blockers.push(
      input.orderProblems.length > 0
        ? `ни одного груза с координатами и ставкой: ${input.orderProblems.slice(0, 3).join("; ")}`
        : "в пуле нет подходящих грузов",
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
