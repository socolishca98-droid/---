// lib/logist-mobile/route-assistant.ts
//
// Помощник сборки рейсов: сам собирает подходящие заказы и предлагает рейс
// на согласование логисту.
//
// Логика простая и объяснимая — ровно то, что логист делает руками:
//   1. берём заказы, которые уже согласованы и ещё не в рейсе;
//   2. складываем их по направлению: один город погрузки или один город выгрузки;
//   3. проверяем, что всё влезает в машину, и подбираем самую маленькую подходящую;
//   4. считаем вес, объём, километры и деньги, объясняем словами, почему собрали.
//
// Ничего не сохраняем: помощник только предлагает. Рейс создаётся, когда логист
// нажимает «Предложить рейс» — тогда вызывается POST /api/routes.
//
// Модуль чистый (без Next, без Prisma, без React) — его проверяют юнит-тесты
// tests/logist-mobile-route-assistant.test.mjs.

import { normalizeOrderStatus } from "../orders/stages"
import { estimateFuelL } from "../fleet/fuel"
import { formatDateShort, formatMoney, shortCity } from "./format"

// ---------------------------------------------------------------------------
// Вход и выход
// ---------------------------------------------------------------------------

/**
 * Цена литра топлива для оценки себестоимости рейса.
 *
 * Своих чеков у предложения ещё нет (рейс только планируется), поэтому
 * берём последнюю известную цену организации, а если чеков не было —
 * константу-ориентир. Это оценка для решения «взять или отказаться», а не
 * бухгалтерия: точные литры и рубли появятся, когда водитель сдаст чеки.
 */
export const DEFAULT_FUEL_PRICE_RUB_PER_L = 62

/** Заказ, каким его видит помощник (лишние поля не нужны). */
export interface AssistantOrder {
  id: string
  status: string
  routeFrom: string
  routeTo: string
  distance?: number | null
  weight?: number | null
  volume?: number | null
  price?: number | null
  agreedPrice?: number | null
  deadline?: string | null
  clientName?: string | null
  clientContact?: string | null
  /** Телефон клиента для кнопки «позвонить и согласовать груз» */
  clientPhone?: string | null
  routeId?: string | null
}

/** Машина автопарка. */
export interface AssistantVehicle {
  id: string
  plate: string
  type?: string | null
  /** Грузоподъёмность, кг */
  capacity?: number | null
  /** Объём кузова, м³ */
  volume?: number | null
  status?: string | null
  /** Паспортный расход, л/100 км — из него считается себестоимость рейса */
  fuelConsumptionPer100?: number | null
}

/**
 * Водитель, каким его видит помощник.
 *
 * `vehicleId` — машина, закреплённая за водителем: в базе машина живёт
 * в одном экземпляре, поэтому сервер не даст поставить на неё другого
 * водителя. Помощник знает это заранее и не предлагает неверных связок.
 */
export interface AssistantDriver {
  id: string
  name: string
  status?: string | null
  vehicleId?: string | null
  vehiclePlate?: string | null
}

export interface RouteProposal {
  /** Ключ предложения: города, из которых оно собрано */
  id: string
  /** Название будущего рейса: «Москва → Калуга» */
  name: string
  orders: AssistantOrder[]
  vehicle: AssistantVehicle | null
  weightKg: number
  volumeM3: number
  distanceKm: number
  revenue: number
  pricePerKm: number | null
  capacityLeftKg: number | null
  // ── Себестоимость и прибыль ──
  /** Оценка топлива на рейс, литры; null — неизвестен расход машины */
  fuelLiters: number | null
  /** Оценка стоимости топлива, ₽; null — нет ни расхода, ни цены */
  fuelCostRub: number | null
  /** Прибыль = выручка − топливо; null — нечем считать */
  profitRub: number | null
  /** Прибыль на километр, ₽ */
  profitPerKm: number | null
  /** На чём посчитано: оценка по паспортному расходу машины */
  costBasis: "estimate" | null
  /**
   * Машина подобрана, но у неё не заполнен расход топлива — прибыль не
   * посчитать. Экран по этому полю показывает подсказку, куда пойти и что
   * заполнить, вместо молчаливого отсутствия цифр.
   */
  needsFuelSetup: boolean
  /** Себестоимость выше выручки — рейс в убыток */
  unprofitable: boolean
  /** Срок ближайшего заказа словами: «сегодня», «8 окт» */
  deadlineText: string
  /** Среди заказов есть просроченный или со сроком сегодня */
  urgent: boolean
  /**
   * Обратная загрузка: грузы, которые можно взять на обратном плече.
   * Без неё машина возвращается пустой — самая дорогая ошибка логиста.
   */
  backload: BackloadSuggestion | null
  /** Почему собрали именно так — короткие объяснения для экрана */
  reasons: string[]
}

/** Груз на обратном плече: что можно подцепить, чтобы машина не ехала пустой. */
export interface BackloadSuggestion {
  /** Заказы на обратное плечо */
  orders: AssistantOrder[]
  /** Сколько добавят денег */
  revenue: number
  /** Сколько добавят веса, кг */
  weightKg: number
  /** Город, где забирать обратный груз */
  fromCity: string
  /**
   * Груз идёт в город отправления рейса — машина возвращается домой
   * загруженной, а не пустой. Это самый выгодный случай.
   */
  returnsHome: boolean
  /** Куда повесить груз: город назначения */
  toCity: string
  /** Влезает ли в уже выбранную машину вместе с основным грузом */
  fitsVehicle: boolean
}

// ---------------------------------------------------------------------------
// Отбор заказов
// ---------------------------------------------------------------------------

/** Заказ можно предложить в рейс: он согласован и ещё никуда не включён. */
export function isRouteableForAssistant(order: AssistantOrder): boolean {
  if (order.routeId) return false
  return normalizeOrderStatus(order.status) === "agreed"
}

/** Город для сравнения: значение до запятой, без «г.», в нижнем регистре, ё → е. */
export function cityKey(value?: string | null): string {
  const city = shortCity(value)
  if (!city || city === "—") return ""
  return city
    .toLowerCase()
    .replace(/^г\.?\s*/, "")
    .replace(/ё/g, "е")
    .trim()
}

/** Сумма денег по заказам: договорная цена важнее «прайсовой». */
export function orderRevenue(order: AssistantOrder): number {
  return Math.max(0, order.agreedPrice ?? order.price ?? 0)
}

function daysLeft(deadline?: string | null, now: Date = new Date()): number | null {
  if (!deadline) return null
  const date = new Date(deadline)
  if (Number.isNaN(date.getTime())) return null
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

// ---------------------------------------------------------------------------
// Подбор машины
// ---------------------------------------------------------------------------

/** Машины, которые вообще можно ставить в рейс (на ТО не берём). */
function usableVehicles<V extends AssistantVehicle>(vehicles: V[]): V[] {
  return vehicles.filter((vehicle) => vehicle.status !== "maintenance")
}

/**
 * Самая маленькая подходящая машина: сначала свободные, потом уже занятые
 * (для занятой покажем это словом — логист решит сам).
 */
export function pickVehicle(
  weightKg: number,
  volumeM3: number,
  vehicles: AssistantVehicle[],
): AssistantVehicle | null {
  const fits = usableVehicles(vehicles).filter((vehicle) => {
    const capacity = vehicle.capacity ?? 0
    if (capacity > 0 && weightKg > capacity) return false
    const volume = vehicle.volume ?? 0
    if (volume > 0 && volumeM3 > volume) return false
    return true
  })
  if (fits.length === 0) return null

  const free = fits.filter((vehicle) => vehicle.status === "available")
  const pool = free.length > 0 ? free : fits
  // «Маленькая» = минимальная грузоподъёмность; при равной — минимальный объём
  return [...pool].sort((a, b) => {
    const byCapacity = (a.capacity ?? Number.MAX_SAFE_INTEGER) - (b.capacity ?? Number.MAX_SAFE_INTEGER)
    if (byCapacity !== 0) return byCapacity
    return (a.volume ?? Number.MAX_SAFE_INTEGER) - (b.volume ?? Number.MAX_SAFE_INTEGER)
  })[0]
}

// ---------------------------------------------------------------------------
// Экипаж: машина вместе с водителем
// ---------------------------------------------------------------------------

/** Влезает ли груз в машину. */
function fitsVehicle(vehicle: AssistantVehicle, weightKg: number, volumeM3: number): boolean {
  const capacity = vehicle.capacity ?? 0
  if (capacity > 0 && weightKg > capacity) return false
  const volume = vehicle.volume ?? 0
  if (volume > 0 && volumeM3 > volume) return false
  return true
}

/**
 * Подходящие машины для груза: сначала свободные, внутри группы — от самой
 * маленькой к большой (меньше машина — дешевле рейс). Машины на ТО не берём.
 */
export function vehiclesForCargo<V extends AssistantVehicle>(
  weightKg: number,
  volumeM3: number,
  vehicles: V[],
): V[] {
  return usableVehicles(vehicles)
    .filter((vehicle) => fitsVehicle(vehicle, weightKg, volumeM3))
    .sort((a, b) => {
      const byStatus = Number(a.status !== "available") - Number(b.status !== "available")
      if (byStatus !== 0) return byStatus
      const byCapacity = (a.capacity ?? Number.MAX_SAFE_INTEGER) - (b.capacity ?? Number.MAX_SAFE_INTEGER)
      if (byCapacity !== 0) return byCapacity
      return (a.volume ?? Number.MAX_SAFE_INTEGER) - (b.volume ?? Number.MAX_SAFE_INTEGER)
    })
}

/** Водитель, за которым закреплена машина (или null). */
export function driverOfVehicle<D extends AssistantDriver>(
  vehicleId: string | null | undefined,
  drivers: readonly D[],
): D | null {
  if (!vehicleId) return null
  return drivers.find((driver) => driver.vehicleId === vehicleId) ?? null
}

/**
 * Кого можно поставить на этот груз без ошибок на сервере: свободные водители
 * без своей машины и свободные водители, чья машина сама подходит под груз.
 */
export function assignableDrivers<D extends AssistantDriver>(
  weightKg: number,
  volumeM3: number,
  vehicles: AssistantVehicle[],
  drivers: readonly D[],
): D[] {
  const fitting = vehiclesForCargo(weightKg, volumeM3, vehicles)
  const allowed = drivers.filter((driver) => {
    if (driver.status !== "available") return false
    if (!driver.vehicleId) return true
    const own = fitting.find((vehicle) => vehicle.id === driver.vehicleId)
    return Boolean(own && own.status === "available")
  })
  // Водитель со своей подходящей машиной готов сразу — он выше остальных
  return sortDriversForAssignment(allowed).sort(
    (a, b) => Number(!a.vehicleId) - Number(!b.vehicleId),
  )
}

/**
 * Кого можно передать уже созданный рейс: если машина закреплена за водителем —
 * только его; если у машины хозяина нет — любого свободного; без машины — любого.
 */
export function assignableDriversForVehicle<D extends AssistantDriver>(
  vehicle: AssistantVehicle | null,
  drivers: readonly D[],
): D[] {
  const owner = driverOfVehicle(vehicle?.id, drivers)
  if (owner) return sortDriversForAssignment(drivers.filter((driver) => driver.id === owner.id))
  return sortDriversForAssignment(drivers)
}

/**
 * Экипаж по умолчанию — то, что помощник подставляет сам:
 *   1. свободная подходящая машина, водитель которой тоже свободен —
 *      один тап, и рейс уже с экипажем;
 *   2. иначе просто самая маленькая свободная подходящая машина
 *      (водителя назначит логист в карточке рейса);
 *   3. свободных подходящих машин нет — рейс без машины, логист решит сам.
 */
export function pickCrew<V extends AssistantVehicle, D extends AssistantDriver>(
  weightKg: number,
  volumeM3: number,
  vehicles: V[],
  drivers: readonly D[],
): { vehicle: V | null; driver: D | null } {
  const free = vehiclesForCargo(weightKg, volumeM3, vehicles).filter((item) => item.status === "available")

  for (const vehicle of free) {
    const driver = driverOfVehicle(vehicle.id, drivers)
    if (driver && driver.status === "available") return { vehicle, driver }
  }

  if (free.length > 0) return { vehicle: free[0], driver: null }

  return { vehicle: null, driver: null }
}

// ---------------------------------------------------------------------------
// Сборка предложений
// ---------------------------------------------------------------------------

interface Cluster {
  orders: AssistantOrder[]
  from: string
  to: string
}

/** Одна группа = заказы одного направления «откуда → куда». */
function buildCorridors(orders: AssistantOrder[]): Cluster[] {
  const byCorridor = new Map<string, AssistantOrder[]>()

  for (const order of orders) {
    const from = cityKey(order.routeFrom)
    const to = cityKey(order.routeTo)
    if (!from || !to) continue
    const key = `${from}→${to}`
    const list = byCorridor.get(key) ?? []
    list.push(order)
    byCorridor.set(key, list)
  }

  const corridors: Cluster[] = []
  for (const [key, list] of byCorridor) {
    const [from, to] = key.split("→")
    corridors.push({ orders: list, from, to })
  }
  // Стабильный порядок: сначала дорогие направления — их и собираем первыми
  return corridors.sort(
    (a, b) => sumRevenue(b.orders) - sumRevenue(a.orders) || b.orders.length - a.orders.length,
  )
}

function sumRevenue(orders: AssistantOrder[]): number {
  return orders.reduce((sum, order) => sum + orderRevenue(order), 0)
}

function sumWeight(orders: AssistantOrder[]): number {
  return orders.reduce((sum, order) => sum + Math.max(0, order.weight ?? 0), 0)
}

function sumVolume(orders: AssistantOrder[]): number {
  return orders.reduce((sum, order) => sum + Math.max(0, order.volume ?? 0), 0)
}

/**
 * Склеиваем направления, у которых общий город погрузки (сборный рейс из одного
 * склада) или общий город выгрузки (сборка в один город) — пока всё влезает
 * в самую большую машину автопарка.
 *
 * Из двух вариантов склейки берём тот, где рейсов получается меньше: логисту
 * нужно меньше пустых машин, а не больше.
 */
function mergeClusters(corridors: Cluster[], vehicles: AssistantVehicle[]): Cluster[] {
  const capacities = usableVehicles(vehicles)
    .map((vehicle) => vehicle.capacity ?? 0)
    .filter((value) => value > 0)
  const limit = capacities.length > 0 ? Math.max(...capacities) : Number.MAX_SAFE_INTEGER

  const byKey = (clusters: Cluster[], pick: (cluster: Cluster) => string): Cluster[] => {
    const groups = new Map<string, Cluster[]>()
    for (const cluster of clusters) {
      const key = pick(cluster)
      const list = groups.get(key) ?? []
      list.push(cluster)
      groups.set(key, list)
    }

    const merged: Cluster[] = []
    for (const [key, list] of groups) {
      if (list.length === 1) {
        merged.push(list[0])
        continue
      }
      // Внутри города — по убыванию веса: тяжёлое собираем первым
      const sorted = [...list].sort((a, b) => sumWeight(b.orders) - sumWeight(a.orders))
      let current: Cluster | null = null

      for (const cluster of sorted) {
        if (!current) {
          current = { ...cluster, orders: [...cluster.orders] }
          continue
        }
        const combinedWeight = sumWeight(current.orders) + sumWeight(cluster.orders)
        const combinedVolume = sumVolume(current.orders) + sumVolume(cluster.orders)
        const candidate = pickVehicle(combinedWeight, combinedVolume, vehicles)
        if (combinedWeight <= limit && candidate) {
          current.orders = [...current.orders, ...cluster.orders]
          current.to = current.to === cluster.to ? current.to : `${current.to} и ${cluster.to}`
        } else {
          merged.push(current)
          current = { ...cluster, orders: [...cluster.orders] }
        }
      }
      if (current) merged.push(current)
      void key
    }
    return merged
  }

  const byFrom = byKey(corridors, (cluster) => cluster.from)
  const byTo = byKey(corridors, (cluster) => cluster.to)
  return byTo.length < byFrom.length ? byTo : byFrom
}

/**
 * Порядок водителей для назначения на рейс: сначала свободные, затем занятые,
 * и только в конце те, кто не на связи или на ТО — их выбирают реже всего.
 */
export function driverAssignmentRank(status: string | null | undefined): number {
  if (status === "available") return 0
  if (status === "busy" || status === "on_route" || status === "in_route" || status === "active") return 1
  // не на связи, на ТО и любые непонятные значения — в конец списка
  return 2
}

/** Водители в порядке удобства выбора; внутри группы — по имени. */
export function sortDriversForAssignment<T extends { status?: string | null; name?: string | null }>(
  drivers: readonly T[],
): T[] {
  return [...drivers].sort((a, b) => {
    const byRank = driverAssignmentRank(a.status) - driverAssignmentRank(b.status)
    if (byRank !== 0) return byRank
    return (a.name ?? "").localeCompare(b.name ?? "", "ru")
  })
}

/** Предложение из группы заказов: цифры, машина и объяснения. */
function toProposal(
  cluster: Cluster,
  vehicles: AssistantVehicle[],
  now: Date,
  fuelPriceRubPerL: number | null,
): RouteProposal {
  const orders = [...cluster.orders].sort((a, b) => {
    const aDays = daysLeft(a.deadline, now) ?? Number.MAX_SAFE_INTEGER
    const bDays = daysLeft(b.deadline, now) ?? Number.MAX_SAFE_INTEGER
    return aDays - bDays
  })

  const weightKg = sumWeight(orders)
  const volumeM3 = sumVolume(orders)
  const revenue = sumRevenue(orders)
  const distanceKm = Math.max(0, ...orders.map((order) => order.distance ?? 0))
  const vehicle = pickVehicle(weightKg, volumeM3, vehicles)

  // Себестоимость рейса: топливо по паспортному расходу выбранной машины.
  // Без расхода или цены честно отдаём null — не выдумываем прибыль.
  const fuelLiters =
    vehicle && distanceKm > 0 ? estimateFuelL(vehicle, distanceKm, weightKg) : null
  const fuelCostRub =
    fuelLiters !== null && fuelPriceRubPerL !== null && fuelPriceRubPerL > 0
      ? Math.round(fuelLiters * fuelPriceRubPerL)
      : null
  const profitRub = fuelCostRub !== null ? revenue - fuelCostRub : null
  const profitPerKm =
    profitRub !== null && distanceKm > 0 ? Math.round(profitRub / distanceKm) : null
  // Подсказку показываем только когда машина есть, но её расход неизвестен:
  // «вообще ничего не известно» — это не повод что-то советовать
  const needsFuelSetup = vehicle !== null && distanceKm > 0 && fuelCostRub === null

  const days = orders.map((order) => daysLeft(order.deadline, now)).filter((value): value is number => value !== null)
  const nearest = days.length > 0 ? Math.min(...days) : null
  const urgent = nearest !== null && nearest <= 0

  const cities = [...new Set(orders.map((order) => shortCity(order.routeTo)))]
  const name = `${shortCity(orders[0]?.routeFrom)} → ${cities.join(", ")}`

  const reasons: string[] = []
  const sameFrom = new Set(orders.map((order) => cityKey(order.routeFrom))).size === 1
  const sameTo = new Set(orders.map((order) => cityKey(order.routeTo))).size === 1

  if (sameFrom && orders.length > 1) reasons.push(`Все грузы из одного города: ${shortCity(orders[0].routeFrom)}`)
  else if (sameTo && orders.length > 1) reasons.push(`Все грузы в один город: ${shortCity(orders[0].routeTo)}`)
  else if (orders.length > 1) reasons.push(`${orders.length} заказа по одному направлению`)

  if (urgent && nearest !== null) {
    reasons.push(nearest < 0 ? `Просрочен на ${Math.abs(nearest)} дн. — везти первым` : "Срок сегодня — везти первым")
  } else if (nearest !== null && nearest <= 3) {
    const date = orders.find((order) => (daysLeft(order.deadline, now) ?? 99) === nearest)?.deadline
    reasons.push(`Ближайший срок: ${formatDateShort(date)}`)
  }

  if (vehicle) {
    const free = vehicle.status === "available"
    reasons.push(
      `Влезает: ${(weightKg / 1000).toFixed(1)} т из ${((vehicle.capacity ?? 0) / 1000).toFixed(1)} т — ${vehicle.plate}${free ? " (свободна)" : " (сейчас занята)"}`,
    )
  } else {
    reasons.push(`Под ${(weightKg / 1000).toFixed(1)} т свободной машины нет — нужна догрузка или фура`)
  }

  if (distanceKm > 0) {
    const perKm = Math.round(revenue / distanceKm)
    if (perKm >= 60) reasons.push(`Выгодно: ${perKm} ₽/км`)
  }

  // Деньги словами — главный вопрос логиста «этот рейс окупится?».
  // Убыточный рейс показываем первым пунктом, чтобы его было видно сразу.
  // Случай «нечем считать» здесь НЕ дублируем: экран показывает его
  // отдельным блоком с подсказкой, куда пойти и что заполнить.
  if (profitRub !== null && fuelCostRub !== null) {
    if (profitRub < 0) {
      reasons.unshift(`Убыток: топливо ${formatMoney(fuelCostRub)} дороже выручки ${formatMoney(revenue)}`)
    } else {
      reasons.push(`Прибыль ≈ ${formatMoney(profitRub)} (выручка ${formatMoney(revenue)} − топливо ${formatMoney(fuelCostRub)})`)
    }
  }

  return {
    id: `${cluster.from}→${cluster.to}`,
    name,
    orders,
    vehicle,
    weightKg,
    volumeM3,
    distanceKm,
    revenue,
    pricePerKm: distanceKm > 0 ? Math.round(revenue / distanceKm) : null,
    capacityLeftKg: vehicle?.capacity ? Math.max(0, vehicle.capacity - weightKg) : null,
    fuelLiters: fuelLiters === null ? null : Math.round(fuelLiters),
    fuelCostRub,
    profitRub,
    profitPerKm,
    costBasis: fuelCostRub !== null ? "estimate" : null,
    needsFuelSetup,
    unprofitable: profitRub !== null && profitRub < 0,
    deadlineText: nearest === null ? "срок не указан" : nearest < 0 ? `просрочен на ${Math.abs(nearest)} дн.` : nearest === 0 ? "сегодня" : nearest === 1 ? "завтра" : formatDateShort(
      orders.find((order) => (daysLeft(order.deadline, now) ?? 99) === nearest)?.deadline,
    ),
    urgent,
    // Обратная загрузка считается отдельным шагом: нужен список всех заказов,
    // а не только подобранных в это предложение.
    backload: null,
    reasons,
  }
}

/**
 * Собрать предложения рейсов. Сначала горящие, потом крупные по выручке:
 * логист разбирает список сверху вниз и ничего важного не теряет.
 *
 * `fuelPriceRubPerL` — цена литра для оценки себестоимости. Без неё прибыль
 * не считается (null), и экран честно пишет «прибыль не считаем».
 */
export function buildRouteProposals(
  orders: AssistantOrder[],
  vehicles: AssistantVehicle[],
  now: Date = new Date(),
  fuelPriceRubPerL: number | null = DEFAULT_FUEL_PRICE_RUB_PER_L,
): RouteProposal[] {
  const ready = orders.filter(isRouteableForAssistant)
  if (ready.length === 0) return []

  const corridors = buildCorridors(ready)
  const clusters = mergeClusters(corridors, vehicles)
  const proposals = clusters.map((cluster) => toProposal(cluster, vehicles, now, fuelPriceRubPerL))

  for (const proposal of proposals) {
    proposal.backload = findBackload(proposal, ready)
    if (proposal.backload) {
      const { revenue, returnsHome, fromCity } = proposal.backload
      proposal.reasons.push(
        returnsHome
          ? `Возврат с грузом: +${formatMoney(revenue)} из ${fromCity} — машина не поедет пустой`
          : `На обратном плече есть груз из ${fromCity} на ${formatMoney(revenue)}`,
      )
    }
  }

  return proposals.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1
    if (b.orders.length !== a.orders.length) return b.orders.length - a.orders.length
    return b.revenue - a.revenue
  })
}

/**
 * Обратная загрузка: чем занять машину на обратном плече.
 *
 * Логист собирает рейс «А → Б», машина доезжает, выгружается — и дальше
 * либо едет пустой (чистый убыток на топливо), либо берёт груз обратно.
 * Помощник ищет среди согласованных и ещё не распределённых заказов те,
 * которые забирают там, куда рейс приезжает:
 *
 *   1. сначала — груз в город отправления (полный возврат домой с грузом);
 *   2. потом — любой груз из города выгрузки (машина хотя бы не пустая).
 *
 * Проверяем вместимость: если вместе с основным грузом не влезает — честно
 * помечаем `fitsVehicle: false`, логист решит сам (догрузка, вторая машина).
 */
export function findBackload(
  proposal: RouteProposal,
  allOrders: readonly AssistantOrder[],
): BackloadSuggestion | null {
  if (proposal.orders.length === 0) return null

  const ownIds = new Set(proposal.orders.map((order) => order.id))
  // Город, куда рейс приезжает выгружаться — там и забираем обратный груз
  const farCity = cityKey(proposal.orders[proposal.orders.length - 1].routeTo)
  // Город отправления рейса — идеальная точка возврата
  const homeCity = cityKey(proposal.orders[0].routeFrom)
  if (!farCity) return null

  const candidates = allOrders.filter((order) => {
    if (ownIds.has(order.id)) return false
    if (!isRouteableForAssistant(order)) return false
    return cityKey(order.routeFrom) === farCity
  })
  if (candidates.length === 0) return null

  // Сначала грузы, которые везут домой: они и деньги дают, и порожний пробег
  // закрывают полностью.
  const sorted = [...candidates].sort((a, b) => {
    const aHome = cityKey(a.routeTo) === homeCity ? 0 : 1
    const bHome = cityKey(b.routeTo) === homeCity ? 0 : 1
    if (aHome !== bHome) return aHome - bHome
    return orderRevenue(b) - orderRevenue(a)
  })

  const capacity = proposal.vehicle?.capacity ?? null
  let weight = proposal.weightKg
  let revenue = 0
  const picked: AssistantOrder[] = []
  for (const order of sorted) {
    const addWeight = Math.max(0, order.weight ?? 0)
    if (capacity !== null && capacity > 0 && weight + addWeight > capacity) continue
    weight += addWeight
    revenue += orderRevenue(order)
    picked.push(order)
  }

  // Ничего не влезло — всё равно показываем самый дорогой груз, но честно
  // помечаем, что в эту машину он уже не войдёт. Спрятать возможность
  // нельзя: логист может взять вторую машину или отправить часть заказов
  // другим рейсом — а если не показать, он про этот груз просто не узнает.
  if (picked.length === 0) {
    const best = sorted[0]
    const addWeight = Math.max(0, best.weight ?? 0)
    return {
      orders: [best],
      revenue: orderRevenue(best),
      weightKg: addWeight,
      fromCity: shortCity(best.routeFrom),
      toCity: shortCity(best.routeTo),
      returnsHome: cityKey(best.routeTo) === homeCity,
      fitsVehicle: false,
    }
  }

  const first = picked[0]
  return {
    orders: picked,
    revenue,
    weightKg: Math.max(0, weight - proposal.weightKg),
    fromCity: shortCity(first.routeFrom),
    toCity: shortCity(first.routeTo),
    returnsHome: cityKey(first.routeTo) === homeCity,
    fitsVehicle: capacity === null || capacity <= 0 || weight <= capacity,
  }
}

/** Итог для шапки экрана: сколько рейсов, сколько заказов, сколько денег. */
export function proposalSummary(
  proposals: RouteProposal[],
  readyOrdersCount: number,
): { routes: number; orders: number; revenue: number; unplaced: number; profitRub: number | null } {
  const orders = proposals.reduce((sum, proposal) => sum + proposal.orders.length, 0)
  const revenue = proposals.reduce((sum, proposal) => sum + proposal.revenue, 0)
  // Прибыль считаем только там, где она посчитана: если хотя бы у одного
  // рейса нет данных по топливу — итог честно unknown, а не «среднее по тем,
  // у кого есть».
  const withProfit = proposals.filter((proposal) => proposal.profitRub !== null)
  const profit =
    withProfit.length === proposals.length && proposals.length > 0
      ? withProfit.reduce((sum, proposal) => sum + (proposal.profitRub as number), 0)
      : null
  return {
    routes: proposals.length,
    orders,
    revenue,
    unplaced: Math.max(0, readyOrdersCount - orders),
    profitRub: profit,
  }
}

/** Подпись итогов предложения одной строкой — для карточки в списке. */
export function proposalLine(proposal: RouteProposal): string {
  const parts = [
    `${proposal.orders.length} ${pluralOrders(proposal.orders.length)}`,
    `${(proposal.weightKg / 1000).toFixed(1).replace(".0", "").replace(".", ",")} т`,
    proposal.distanceKm > 0 ? `${proposal.distanceKm} км` : null,
    proposal.revenue > 0 ? formatMoney(proposal.revenue) : null,
    // Прибыль — главное число для решения. Убыток показываем явно.
    proposal.profitRub !== null
      ? proposal.profitRub < 0
        ? `убыток ${formatMoney(Math.abs(proposal.profitRub))}`
        : `прибыль ${formatMoney(proposal.profitRub)}`
      : null,
  ]
  return parts.filter(Boolean).join(" · ")
}

function pluralOrders(count: number): string {
  const n = Math.abs(count) % 100
  const tail = n % 10
  if (n > 10 && n < 20) return "заказов"
  if (tail > 1 && tail < 5) return "заказа"
  if (tail === 1) return "заказ"
  return "заказов"
}
