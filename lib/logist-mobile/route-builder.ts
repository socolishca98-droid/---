// lib/logist-mobile/route-builder.ts
//
// Сборщик МАРШРУТА из грузов биржи ATI — «сердце» помощника.
//
// Зачем отдельно от route-assistant: помощник сборки заказов решал другую
// задачу — раскладывать СВОИ заказы по направлениям. Здесь логика другая,
// ровно как работает реальный логист на бирже:
//
//   1. есть точка старта — база или город, где стоит машина;
//   2. из неё берём груз (из того же города или «по пути» — в пределах
//      радиуса, если известны координаты) и едем в его город выгрузки;
//   3. оттуда — следующий груз, и так складывается цепочка А → Б → В;
//   4. на каждом плече машина едет гружёной; прибыль = ставка − топливо
//      на гружёный путь и на подъезд к погрузке;
//   5. убыточные плечи не берём — маршрут должен окупаться на каждом шаге;
//   6. в конце цепочки считаем дорогу домой: если обратного груза нет,
//       порожний пробег входит в расходы, и прибыль это учитывает.
//
// Модуль чистый (без Next, Prisma, React) — его проверяет юнит-тест
// tests/logist-mobile-route-builder.test.mjs.

import { estimateFuelL } from "../fleet/fuel"
import { normalizeCityKey, samePlace } from "./city-norm"
import { formatCount, formatDateShort, formatMoney, plural, shortCity } from "./format"

// ---------------------------------------------------------------------------
// Вход
// ---------------------------------------------------------------------------

/** Точка на карте. */
export interface Point {
  lat: number
  lng: number
}

/** Груз биржи, каким его отдаёт /api/ati/loads (строка AtiCache). */
export interface BuilderLoad {
  /** id строки в нашей базе — по нему потом «берём в работу» */
  id: string
  loadId: string
  fromCity: string
  toCity: string
  weightKg: number | null
  volumeM3: number | null
  cargoType: string | null
  /** Ставка фрахтователя, ₽ */
  priceRub: number | null
  /** Ставка с НДС, если включена */
  priceWithNds: number | null
  /** Километры гружёного плеча по данным ATI */
  distanceKm: number | null
  firmName: string | null
  /**
   * Ссылка на «Паспорт фирмы» в ATI — там телефон фрахтователя виден.
   * ATI API контакты не отдаёт (все пути 404) и ругает за их автоматический
   * сбор, поэтому телефон смотрят на самом ATI.
   */
  firmUrl: string | null
  /** Телефон фрахтователя — если логист уже вписал его вручную */
  contactPhone: string | null
  /** Дата загрузки (ISO) — просроченные грузы не берём */
  loadingDate: string | null
  status: string
  /** Координаты города погрузки — если геокодер знает город */
  fromPoint?: Point | null
  /** Координаты города выгрузки */
  toPoint?: Point | null
}

/** Машина автопарка, какая нужна билдеру. */
export interface BuilderVehicle {
  id: string
  plate: string
  type?: string | null
  /** Грузоподъёмность, кг */
  capacity?: number | null
  /** Объём, м³ */
  volume?: number | null
  status?: string | null
  /** Паспортный расход, л/100 км */
  fuelConsumptionPer100?: number | null
  /**
   * Расход не заполнен в карточке машины — стоит оценка по типу кузова.
   * Экран честно пишет об этом: прибыль примерная, точные литры появятся,
   * когда расход заполнят.
   */
  fuelEstimated?: boolean
}

export interface BuildRouteOptions {
  /** Город, где стоит машина (база). Пусто — начнём от самого выгодного груза */
  startCity: string
  /** Грузы биржи */
  loads: BuilderLoad[]
  /** Автопарк */
  vehicles: BuilderVehicle[]
  /** Цена литра топлива для оценки себестоимости; null — нечем считать */
  fuelPriceRubPerL: number | null
  /**
   * Сколько времени максимум длится маршрут, часы. Логист планирует
   * сменами, а не плечами: «рейс на 2 дня» — понятная задача, «4 плеча» —
   * нет. Время плеча = гружёный путь + подъезд + погрузка/выгрузка.
   * По умолчанию 72 часа (3 смены).
   */
  maxHours?: number
  /**
   * Минимальная прибыльность плеча, ₽/км. Ниже — плечо не берём: логист
   * не поедет за копейки. По умолчанию 25 ₽/км.
   */
  minProfitPerKm?: number
  /**
   * Радиус «по пути», км: груз можно взять, если его город погрузки
   * не дальше этого от текущей точки маршрута. Ноль — только точное
   * совпадение города. По умолчанию 150 км.
   */
  detourKm?: number
  /**
   * Радиус поиска ПЕРВОГО груза от базы, км. Порожний выезд за грузом —
   * обычное дело: логист готов проехать 300–500 км, если ставка это
   * покрывает. Поэтому первый груз ищем шире, чем «по пути». Ноль —
   * только точное совпадение города. По умолчанию 300 км.
   */
  startRadiusKm?: number
  /** Координаты города старта — для радиуса «по пути» и возврата домой */
  startPoint?: Point | null
  /**
   * Грузы, которые обязательно оставляем в маршруте: уже согласованы
   * звонком. Пересборка «заменить отказавшего» не должна выкидывать их.
   */
  keepIds?: readonly string[]
  /** Грузы, которые не берём: отказались, уже в работе, скрыты логистом */
  excludeIds?: readonly string[]
  now?: Date
}

// ---------------------------------------------------------------------------
// Выход
// ---------------------------------------------------------------------------

/** Одно плечо маршрута: один груз от текущей точки до города выгрузки. */
export interface RouteLeg {
  load: BuilderLoad
  /** Порожний пробег до погрузки, км (0 — груз из города, где стоим) */
  deadheadKm: number
  /** Гружёное плечо, км */
  loadedKm: number
  /** Время плеча в часах: путь + погрузка/выгрузка */
  hours: number
  /**
   * Сколько часов стоим и ждём даты загрузки: фрахтователь назвал число
   * позже нашего приезда. Это тоже время маршрута — логист планирует
   * «сколько едем», а не «сколько крутим руль».
   */
  waitHours: number
  revenue: number
  fuelLiters: number | null
  fuelCostRub: number | null
  profitRub: number | null
  profitPerKm: number | null
  /** Груз везёт машину домой — обратное плечо уже занято */
  returnsHome: boolean
  /** Груз «по пути»: город погрузки не совпал, но рядом с маршрутом */
  byTheWay: boolean
  /**
   * Когда машина по расчёту доедет до погрузки. Ориентир: выезд сейчас,
   * ~60 км/ч порожним и ~55 км/ч с грузом.
   */
  etaAt: Date
  /** Дата загрузки, которую назвал фрахтователь (если озвучена) */
  loadsAt: Date | null
  /**
   * По расчёту мы приезжаем позже даты загрузки — груз могут отдать другому.
   * Не приговор, а флаг «уточните дату при звонке».
   */
  lateRisk: boolean
}

/** Груз, который не попал в маршрут, и почему. */
export interface ExcludedLoad {
  load: BuilderLoad
  reason: string
}

export interface BuiltRoute {
  /** Стабильный ключ для React и кэша */
  id: string
  startCity: string
  /** Точка базы — с неё начинаем и на карте, и в расчёте возврата */
  startPoint: Point | null
  /** Города по порядку: старт → точки выгрузки */
  path: string[]
  legs: RouteLeg[]
  vehicle: BuilderVehicle | null
  /** Дорога домой в конце маршрута, км. 0 — вернулись с грузом */
  returnDeadheadKm: number
  /** Последнее плечо — домой с грузом */
  returnsHomeWithLoad: boolean
  totalDistanceKm: number
  /** Вся поездка в часах, включая возврат и погрузки/выгрузки */
  totalHours: number
  /** Лимит времени, на который собирали маршрут, часы */
  maxHours: number
  /** Когда машина выезжает по расчёту (сейчас + сборы) */
  departAt: Date
  /** Когда машина дома по расчёту — с учётом ожидания дат загрузки */
  homeAt: Date
  /** Сколько плеч с риском «не успеваем к дате загрузки» */
  lateRiskLegs: number
  totalRevenue: number
  totalFuelCostRub: number | null
  totalProfitRub: number | null
  /** Прибыль на километр всего маршрута */
  profitPerKm: number | null
  /**
   * Прибыль на ЧАС всего маршрута — главный показатель выбора машины.
   *
   * Поездка ограничена временем («сколько едем»), поэтому актив диспетчера —
   * часы машины, а не километры. Живой замер на Новосибирске: помощник
   * выбирал 10-тонную фуру с одним плечом 317 км и прибылью 18 872 ₽
   * (59 ₽/км) вместо 20-тонной с двумя плечами 3118 км и 152 888 ₽
   * (49 ₽/км). По деньгам за час — 1 054 против ~3 000 ₽/ч: выбор был
   * заведомо худшим, просто «₽/км» сравнивает короткий и длинный рейс
   * как равные.
   */
  profitPerHour: number | null
  /** Прибыль нечем посчитать: у машины не заполнен расход топлива */
  needsFuelSetup: boolean
  /** Маршрут в убыток — отправлять только осознанно */
  unprofitable: boolean
  /** Не влезло/не подошло — с причинами, ничего не пропадает молча */
  excluded: ExcludedLoad[]
  /**
   * Что осталось на бирже — честный подсчёт.
   *
   * Зачем: счётчик «осталось 99» поверх 185 грузов — полуправда: почти все
   * из них без ставки или с прошедшей датой. Логисту важно другое —
   * сколько грузов реально могли бы взять, но не взяли.
   */
  leftover: LeftoverCounts
  /** Почему собрали именно так — для экрана */
  reasons: string[]
  /** Что изменить, чтобы маршрут стал длиннее (иначе null) */
  growthHint: string | null
  /** На сколько часов поднять лимит, чтобы вchain встал следующий груз */
  growthHours: number | null
}

/** Разбор «что осталось на бирже» по причинам — без двойного счёта. */
export interface LeftoverCounts {
  /** Подходят под машину и дату, но в маршрут не попали */
  usable: number
  /** Ставка не озвучена — нечем мерить выгоду */
  noRate: number
  /** Дата загрузки уже прошла */
  pastDate: number
  /** Не влезает в выбранную машину */
  notFit: number
  /** Уже не в бирже / исключены вами / маршрут неизвестен */
  other: number
}

// ---------------------------------------------------------------------------
// Помощники
// ---------------------------------------------------------------------------

/** Цена груза: с НДС важнее без. */
export function loadPrice(load: BuilderLoad): number {
  return Math.max(0, load.priceWithNds ?? load.priceRub ?? 0)
}

/** Груз ещё актуален: дата загрузки не в прошлом (сегодня — ещё можно). */
function isFresh(load: BuilderLoad, now: Date): boolean {
  if (!load.loadingDate) return true
  const date = new Date(load.loadingDate)
  if (Number.isNaN(date.getTime())) return true
  return date.getTime() > now.getTime() - 12 * 60 * 60 * 1000
}

/** Машины, которые вообще можно ставить (не на ТО). */
function usableVehicles(vehicles: BuilderVehicle[]): BuilderVehicle[] {
  return vehicles.filter((vehicle) => vehicle.status !== "maintenance")
}

/** Влезает ли груз в машину по весу и объёму. */
export function loadFitsVehicle(load: BuilderLoad, vehicle: BuilderVehicle): boolean {
  if (load.weightKg != null) {
    const capacity = vehicle.capacity ?? 0
    if (capacity > 0 && load.weightKg > capacity) return false
  }
  if (load.volumeM3 != null) {
    const volume = vehicle.volume ?? 0
    if (volume > 0 && load.volumeM3 > volume) return false
  }
  return true
}

/** Ставка за километр гружёного плеча — быстрая оценка выгоды. */
export function loadRatePerKm(load: BuilderLoad): number | null {
  if (!load.distanceKm || load.distanceKm <= 0) return null
  const price = loadPrice(load)
  if (price <= 0) return null
  return price / load.distanceKm
}

/**
 * Расстояние между двумя точками по дуге, км (формула гаверсинуса).
 * Точность на сотнях километров — с ошибкой меньше километра, для
 * решения «взять или нет» этого хватает.
 */
export function haversineKm(a: Point, b: Point): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

/**
 * Оценка времени плеча: гружёный путь ~55 км/ч, подъезд ~60 км/ч,
 * погрузка + выгрузка ~4 часа. Ориентир для планирования смен — не
 * обещание: точное время известен после согласования с фрахтователем.
 */
export const AVG_LOADED_KMH = 55
export const AVG_DEADHEAD_KMH = 60
export const LOAD_UNLOAD_HOURS = 4

/** Полночь даты в UTC — сравниваем календарные дни, а не часы. */
function dayStart(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Дата загрузки груза, если она озвучена и её можно прочитать. */
function loadDate(load: BuilderLoad): Date | null {
  if (!load.loadingDate) return null
  const date = new Date(load.loadingDate)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Дата загрузки как момент времени; груз без даты — «уже готов». */
function loadMoment(load: BuilderLoad): Date {
  return loadDate(load) ?? new Date(0)
}

/**
 * Когда машина реально выедет: сборы и документы — пара часов. Если уже
 * вечер, логист утром: узлы в пути лучше не планировать.
 */
export function departTime(now: Date): Date {
  if (now.getHours() >= 18) {
    const morning = new Date(now)
    morning.setDate(morning.getDate() + 1)
    morning.setHours(8, 0, 0, 0)
    return morning
  }
  return new Date(now.getTime() + 2 * 3600000)
}

/** Часы между двумя датами. */
function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3600000
}

/** Часы плеча: подъезд + гружёный путь + погрузка/выгрузка. */
export function legHours(deadheadKm: number, loadedKm: number): number {
  const hours = deadheadKm / AVG_DEADHEAD_KMH + loadedKm / AVG_LOADED_KMH + LOAD_UNLOAD_HOURS
  // Точность до десятой часа: логист планирует смены, а не минуты
  return Math.round(hours * 10) / 10
}

/** Деньги плеча: выручка минус топливо на пробег. */
function legMoney(
  load: BuilderLoad,
  distanceKm: number,
  vehicle: BuilderVehicle,
  fuelPrice: number | null,
): { revenue: number; fuelLiters: number | null; fuelCostRub: number | null; profitRub: number | null } {
  const revenue = loadPrice(load)
  const fuelLiters = distanceKm > 0 ? estimateFuelL(vehicle, distanceKm, load.weightKg ?? 0) : null
  const fuelCostRub =
    fuelLiters !== null && fuelPrice !== null && fuelPrice > 0
      ? Math.round(fuelLiters * fuelPrice)
      : null
  const profitRub = fuelCostRub !== null ? revenue - fuelCostRub : null
  return { revenue, fuelLiters, fuelCostRub, profitRub }
}

/**
 * Обратный груз домой — последнее плечо цепочки.
 *
 * Зачем: логист не возит пустую машину. Если на бирже есть груз из
 * конечного города маршрута на базу (или в её округ), он и закрывает
 * выезд — и прибыль выше на весь порожний возврат. Без обратки маршрут
 * честно платит за возврат, но логист должен видеть, что обратка была
 * возможна.
 *
 * Условия те же, что у любого плеча: влезает в машину, ставка озвучена,
 * окупает пробег и укладывается в лимит времени. Возврат дома при этом
 * нулевой — плечо заканчивается на базе.
 */
function findBackHomeLeg(input: {
  legs: RouteLeg[]
  pool: BuilderLoad[]
  vehicle: BuilderVehicle
  fuelPrice: number | null
  /** База маршрута — цель обратки */
  startCity: string
  /** Город, где стоит машина сейчас — оттуда ищем обратку */
  currentCity: string
  currentPoint: Point | null
  maxHours: number
  minProfitPerKm: number
  detourKm: number
  keepIds: readonly string[]
  /** Часы, уже занятые цепочкой */
  clock: number
  departAt: Date
}): RouteLeg | null {
  const {
    legs,
    pool,
    vehicle,
    fuelPrice,
    startCity,
    currentCity,
    currentPoint,
    maxHours,
    minProfitPerKm,
    detourKm,
    keepIds,
    clock,
    departAt,
  } = input
  if (legs.length === 0) return null

  const currentKey = normalizeCityKey(currentCity)
  const used = new Set(legs.map((leg) => leg.load.id))
  const usedFrom = new Set(legs.map((leg) => normalizeCityKey(leg.load.fromCity)))

  const candidates = pool.filter((load) => {
    if (used.has(load.id)) return false
    if (!loadFitsVehicle(load, vehicle)) return false
    if (loadPrice(load) <= 0) return false
    if (usedFrom.has(normalizeCityKey(load.fromCity))) return false
    // Обратка = груз, который везёт на базу (в её городской округ)
    if (!samePlace(load.toCity, startCity)) return false
    // Забираем там, где стоим: тот же город или рядом
    if (normalizeCityKey(load.fromCity) === currentKey) return true
    if (detourKm > 0 && currentPoint && load.fromPoint) {
      return haversineKm(currentPoint, load.fromPoint) <= detourKm
    }
    return false
  })

  // Сначала согласованные, потом готовые к нашей дате, потом выгодные
  const ordered = [...candidates].sort((a, b) => {
    const aKeep = keepIds.includes(a.id) ? 0 : 1
    const bKeep = keepIds.includes(b.id) ? 0 : 1
    if (aKeep !== bKeep) return aKeep - bKeep
    const aRate = loadRatePerKm(a) ?? -1
    const bRate = loadRatePerKm(b) ?? -1
    return bRate - aRate
  })

  const last = legs[legs.length - 1]
  const lastPoint = last.load.toPoint ?? null

  for (const load of ordered.slice(0, CANDIDATE_SCAN)) {
    const sameCity = normalizeCityKey(load.fromCity) === currentKey
    const deadheadKm =
      sameCity || !currentPoint || !lastPoint || !load.fromPoint
        ? 0
        : haversineKm(currentPoint, load.fromPoint)
    const loadedKm = Math.max(0, load.distanceKm ?? 0)
    const totalKm = deadheadKm + loadedKm
    if (totalKm <= 0) continue
    const hours = legHours(deadheadKm, loadedKm)
    // Обратка заканчивается дома — возврата нет, бюджет шага нулевой
    if (clock + hours > maxHours) continue
    const money = legMoney(load, totalKm, vehicle, fuelPrice)
    if (money.revenue <= 0) continue
    if (money.profitRub !== null && money.profitRub <= 0) continue
    const perKm = (money.profitRub ?? money.revenue) / totalKm
    if (perKm < minProfitPerKm) continue

    const arriveHours = clock + deadheadKm / AVG_DEADHEAD_KMH
    const etaAt = new Date(departAt.getTime() + arriveHours * 3600000)
    const loadsAt = loadDate(load)
    const lateRisk = loadsAt ? dayStart(etaAt) > dayStart(loadsAt) : false
    // Ждать дату загрузки обратки — такое же время маршрута
    const waitHours = loadsAt
      ? Math.max(0, hoursBetween(etaAt, loadsAt))
      : 0
    if (clock + waitHours + hours > maxHours) continue

    return {
      load,
      deadheadKm,
      loadedKm,
      profitPerKm: perKm,
      byTheWay: !sameCity,
      hours,
      waitHours,
      loadsAt,
      etaAt,
      lateRisk,
      fuelLiters: money.fuelLiters,
      fuelCostRub: money.fuelCostRub,
      revenue: money.revenue,
      profitRub: money.profitRub,
      returnsHome: true,
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Почему цепочка остановилась
// ---------------------------------------------------------------------------

/**
 * Точная причина, почему цепочка перестала расти.
 *
 * Зачем: экран «Почему собрал так» обязан говорить правду. Фраза «дальше
 * грузы были, но маршрут не влезал в лимит времени» при маршруте на 11 ч
 * из 48 ч — ложь: по ней логист не поймёт, что менять. Поэтому причина
 * собирается по факту — не хватило часов, груз готов позже срока, ставка
 * не окупает пробег, рядом ничего нет или из этих городов уже брали.
 */
export type ChainStopKind =
  /** Не хватило часов лимита: дорога или ожидание даты загрузки */
  | "hours"
  /** Ставка не покрывает пробег и топливо */
  | "profit"
  /** Рядом грузы есть, но только из городов, где мы уже брали */
  | "used-city"
  /** В радиусе «по пути» грузов нет */
  | "none"
  /** Упёрлись в предел плеч на один выезд */
  | "legs"

export interface ChainStop {
  kind: ChainStopKind
  /** Груз, из-за которого встали — если он был */
  load: BuilderLoad | null
  /** Часы ожидания даты загрузки у этого груза */
  waitHours: number
  /** Часы дороги: подъезд к погрузке + само плечо */
  hours: number
}

const EMPTY_STOP: ChainStop = { kind: "none", load: null, waitHours: 0, hours: 0 }

/** Сколько кандидатов перебираем на шаг: биржа большая, хвост не важен. */
const CANDIDATE_SCAN = 60

/**
 * Цепочка под конкретную машину.
 *
 * Жадный обход: из текущего города берём самый выгодный груз — из того же
 * города или «по пути» (если точка погрузки в пределах радиуса), переезжаем
 * в его город выгрузки, повторяем. Убыточные плечи не берём. Грузы из
 * keepIds (уже согласованы звонком) имеют приоритет на своём шаге.
 */
function buildChain(
  startCity: string,
  startPoint: Point | null,
  pool: BuilderLoad[],
  vehicle: BuilderVehicle,
  fuelPrice: number | null,
  maxLegs: number,
  minProfitPerKm: number,
  detourKm: number,
  startRadiusKm: number,
  maxHours: number,
  keepIds: readonly string[],
  departAt: Date,
): { legs: RouteLeg[]; stop: ChainStop } {
  const legs: RouteLeg[] = []
  const used = new Set<string>()
  // Города, с которых уже забирали: машина не может трижды ездить «из точки
  // А в точку Б» — это три отдельные поездки, а не один маршрут. Поэтому
  // с одной погрузочной точки берём один груз.
  const usedFromKeys = new Set<string>()
  const startKey = normalizeCityKey(startCity)
  let currentKey = startKey
  let currentPoint: Point | null = startPoint
  // Часы с момента выезда — по ним считаем, когда доедем до погрузки
  let clock = 0

  for (let step = 0; step < maxLegs; step += 1) {
    // Первый груз ищем шире: порожний выезд за ним — норма, если ставка
    // покрывает пробег. Дальше по цепочке — уже «по пути».
    //
    // Радиус считаем ВНУТРИ цикла. Пока он считался один раз до цикла, в
    // legs.length === 0 условие срабатывало всегда: живой замер для базы
    // «Ярославль» дал цепочку из шести плеч, где второе начиналось в 292 км
    // от точки выгрузки первого, четвёртое — в 252 км, пятое — в 271 км.
    // «По пути» на экране значило 300 км, хотя логист выставил 150.
    const radius = legs.length === 0 ? startRadiusKm : detourKm

    // Рядом: город совпал ИЛИ груз в радиусе (если есть координаты)
    const nearby = pool.filter((load) => {
      if (used.has(load.id)) return false
      if (!loadFitsVehicle(load, vehicle)) return false
      if (normalizeCityKey(load.fromCity) === currentKey) return true
      if (radius > 0 && currentPoint && load.fromPoint) {
        return haversineKm(currentPoint, load.fromPoint) <= radius
      }
      return false
    })
    // Из городов, где уже забирали, не берём: это другая поездка, не цепочка
    const candidates = nearby.filter(
      (load) => !usedFromKeys.has(normalizeCityKey(load.fromCity)),
    )

    // Порядок выбора — ровно как логист смотрит биржу, стоя в городе:
    //  1. согласованные звонком грузы — они в приоритете;
    //  2. НЕ обратка на базу: груз, который везёт домой, первым плечом
    //     бессмысленен — машина уедет из дома и вернётся, а потом опять
    //     уедет. Обратка имеет смысл в КОНЦЕ маршрута, и её добирает
    //     отдельный шаг. Поэтому на старте такой груз идёт в конец списка;
    //  3. грузы, к дате загрузки которых успеваем: уехавший груз не купить
    //     никакой ставкой;
    //  4. тот, кто готов раньше: простаивающая машина — потерянные деньги,
    //     поэтому маршрут двигается по календарю, а не прыгает по датам;
    //  5. при равной готовности — самая высокая ставка за километр.
    const firstLeg = legs.length === 0
    const ordered = [...candidates].sort((a, b) => {
      const aKeep = keepIds.includes(a.id) ? 0 : 1
      const bKeep = keepIds.includes(b.id) ? 0 : 1
      if (aKeep !== bKeep) return aKeep - bKeep
      if (firstLeg) {
        const aHome = samePlace(a.toCity, startCity) ? 1 : 0
        const bHome = samePlace(b.toCity, startCity) ? 1 : 0
        if (aHome !== bHome) return aHome - bHome
      }
      const aLate = isLate(a) ? 1 : 0
      const bLate = isLate(b) ? 1 : 0
      if (aLate !== bLate) return aLate - bLate
      const aWait = waitDays(a)
      const bWait = waitDays(b)
      if (aWait !== bWait) return aWait - bWait
      const ra = loadRatePerKm(a) ?? -1
      const rb = loadRatePerKm(b) ?? -1
      return rb - ra
    })

    /** Приедем ли мы к дате загрузки: сравниваем календарные дни. */
    function isLate(load: BuilderLoad): boolean {
      const date = loadDate(load)
      if (!date) return false
      return dayStart(arriveAt(clock)) > dayStart(date)
    }

    /** Сколько суток ждать загрузки от нашего приезда. 0 — груз готов. */
    function waitDays(load: BuilderLoad): number {
      const date = loadDate(load)
      if (!date) return 0
      const diff = Math.round((dayStart(date) - dayStart(arriveAt(clock))) / 86400000)
      return diff > 0 ? diff : 0
    }

    /** Момент приезда к текущей точке, если ехать прямо сейчас. */
    function arriveAt(clockHours: number): Date {
      return new Date(departAt.getTime() + clockHours * 3600000)
    }

    /**
     * Дорога домой из города выгрузки кандидата, часы.
     *
     * Зачем в бюджете шага: маршрут обещан на N часов — значит, машина
     * должна успеть вернуться на базу. Без этого проверка пропускала
     * цепочку на 49 ч при лимите 48, а «уложились в лимит» становилось
     * неправдой: хвост потом снимали вслепую.
     */
    function backHomeHours(load: BuilderLoad): number {
      if (samePlace(load.toCity, startCity)) return 0
      if (!startPoint || !load.toPoint) return 0
      return legHours(haversineKm(startPoint, load.toPoint), 0)
    }

    let best: {
      load: BuilderLoad
      money: ReturnType<typeof legMoney>
      deadheadKm: number
      loadedKm: number
      profitPerKm: number
      byTheWay: boolean
      hours: number
      waitHours: number
    } | null = null
    // Причина остановки на этом шаге — по факту, а не на глазок.
    // Часы важнее ставки: «не хватило срока» логист исправит лимитом,
    // а «низкая ставка» — только звонком фрахтователю.
    let byHours: ChainStop | null = null
    let byProfit: ChainStop | null = null
    const noStop: ChainStop | null =
      candidates.length === 0
        ? { ...EMPTY_STOP, kind: nearby.length > 0 ? "used-city" : "none" }
        : null
    let scanned = 0
    for (const load of ordered) {
      if (scanned >= CANDIDATE_SCAN) break
      scanned += 1
      const sameCity = normalizeCityKey(load.fromCity) === currentKey
      const deadheadKm =
        sameCity || !currentPoint || !load.fromPoint
          ? 0
          : haversineKm(currentPoint, load.fromPoint)
      const loadedKm = Math.max(0, load.distanceKm ?? 0)
      const totalKm = deadheadKm + loadedKm
      const hours = legHours(deadheadKm, loadedKm)
      // Ожидание даты загрузки — тоже время маршрута: логист договорился
      // «еду трое суток», и пять суток простоя это нарушение.
      // Считаем ФАКТИЧЕСКИЕ часы от приезда до даты груза — и в проверке
      // бюджета, и в итоге маршрута. Раньше проверка брала сутки «с
      // запасом», а итог — факт: маршрут вылезал за лимит (72.6 ч при
      // лимите 72), а «дома ≈» врало на сутки.
      const waitHours = Math.max(
        0,
        hoursBetween(arriveAt(clock + deadheadKm / AVG_DEADHEAD_KMH), loadMoment(load)),
      )
      // Маршрут планируется по времени. Плечо не влезло — это ещё не конец:
      // следующий кандидат может быть короче или готов раньше, поэтому
      // запоминаем причину и пробуем дальше по списку.
      const backHours = backHomeHours(load)
      if (clock + waitHours + hours + backHours > maxHours) {
        // Запоминаем самого «дешёвого по часам» непрошедшего: объяснять
        // будем именно ему — ближайший груз, который не влез в срок
        if (byHours === null || waitHours + hours < byHours.waitHours + byHours.hours) {
          byHours = { kind: "hours", load, waitHours, hours }
        }
        continue
      }
      const money = legMoney(load, totalKm, vehicle, fuelPrice)
      const perKm =
        totalKm > 0 ? (money.profitRub ?? money.revenue) / totalKm : money.revenue
      const unprofitable =
        money.revenue <= 0 ||
        (money.profitRub !== null && money.profitRub <= 0) ||
        (totalKm > 0 && perKm < minProfitPerKm)
      if (unprofitable) {
        byProfit ??= { kind: "profit", load, waitHours, hours }
        continue
      }
      best = {
        load,
        money,
        deadheadKm,
        loadedKm,
        profitPerKm: perKm,
        byTheWay: !sameCity,
        hours,
        waitHours,
      }
      break
    }

    if (!best) {
      if (legs.length >= maxLegs) {
        return { legs, stop: { ...EMPTY_STOP, kind: "legs" } }
      }
      return { legs, stop: byHours ?? byProfit ?? noStop ?? EMPTY_STOP }
    }

    // ЕТА погрузки: выезд + часы в пути. Если фрахтователь назвал дату
    // загрузки позже — стоим и ждём, часы ожидания тоже идут в маршрут.
    const deadheadHours = best.deadheadKm / AVG_DEADHEAD_KMH
    const arriveHours = clock + deadheadHours
    const etaAt = new Date(departAt.getTime() + arriveHours * 3600000)
    const loadsAt = loadDate(best.load)
    const lateRisk = loadsAt ? dayStart(etaAt) > dayStart(loadsAt) : false
    const startHours =
      loadsAt && !lateRisk && hoursBetween(departAt, loadsAt) > arriveHours
        ? hoursBetween(departAt, loadsAt)
        : arriveHours
    clock = startHours + best.loadedKm / AVG_LOADED_KMH + LOAD_UNLOAD_HOURS

    used.add(best.load.id)
    usedFromKeys.add(normalizeCityKey(best.load.fromCity))
    legs.push({
      load: best.load,
      deadheadKm: best.deadheadKm,
      loadedKm: Math.max(0, best.load.distanceKm ?? 0),
      hours: best.hours,
      revenue: best.money.revenue,
      fuelLiters: best.money.fuelLiters === null ? null : Math.round(best.money.fuelLiters),
      fuelCostRub: best.money.fuelCostRub,
      profitRub: best.money.profitRub,
      profitPerKm: Math.round(best.profitPerKm),
      returnsHome: normalizeCityKey(best.load.toCity) === startKey,
      byTheWay: best.byTheWay,
      etaAt,
      loadsAt,
      lateRisk,
      waitHours: best.waitHours,
    })
    currentKey = normalizeCityKey(best.load.toCity)
    // Точку выгрузки геокодер не знает — где машина после плеча, мы не знаем.
    // Держать прежнюю точку нельзя: живой замер помощника для базы «Нижний
    // Новгород» дал плечо «Дзержинск -> Азов» без точки выгрузки, и следующее
    // плечо считало пробег ОТ САРАНСКА (253 км), хотя машина стоит в Азове
    // (~600 км). «По пути» на экране становилось ложью, а бюджет часа —
    // занижением. Поэтому позиция обнуляется: точное совпадение города ещё
    // работает (машина в том городе, куда привезли), а радиус «по пути»
    // честно выключается, пока координаты неизвестны.
    currentPoint = best.load.toPoint ?? null
  }

  // Перебрали все плеча — больше на один выезд не берём
  return { legs, stop: { ...EMPTY_STOP, kind: "legs" } }
}

// ---------------------------------------------------------------------------
// Сборка маршрута
// ---------------------------------------------------------------------------

/**
 * Собрать маршрут из грузов биржи.
 *
 * Перебираем автопарк: для каждой машины строим цепочку и оставляем вариант
 * с лучшей прибылью на километр. Так «маленькая машина рядом» не съедает
 * выгодный длинный маршрут на фуре, и наоборот.
 */
/** Сборы перед выездом, часы — из них считаем ЕТА первой погрузки. */
const DEPART_DELAY_HOURS = 2

export function buildRoute(options: BuildRouteOptions): BuiltRoute | null {
  return buildRouteFor(options, options.maxHours)
}

// ---------------------------------------------------------------------------
// Карта маршрута
// ---------------------------------------------------------------------------

/** Точка на карте цепочки: база, погрузка или выгрузка. */
export interface RouteMapPoint {
  lat: number
  lng: number
  /** Подпись точки: город и что на ней происходит */
  label: string
  /** Номер плеча — рисуем в кружке. У базы номера нет. */
  index?: number
  /** Домашняя точка — другим цветом */
  home?: boolean
}

/**
 * Точки для карты: база → погрузка → выгрузка → …
 *
 * Дубли убираем: соседние точки ближе 5 км — это один и тот же город, второй
 * маркер только шумит на экране. Чистая функция — её проверяют тесты, а
 * экран просто рисует.
 */
export function routeMapPoints(route: BuiltRoute): RouteMapPoint[] {
  const points: RouteMapPoint[] = []
  const push = (
    point: Point | null | undefined,
    label: string,
    index?: number,
    home?: boolean,
  ) => {
    if (!point) return
    const last = points[points.length - 1]
    if (last && haversineKm(last, point) < 5) return
    points.push({ lat: point.lat, lng: point.lng, label, index, home })
  }

  push(route.startPoint, `База: ${route.path[0]}`, undefined, true)
  route.legs.forEach((leg, index) => {
    push(leg.load.fromPoint, `${index + 1}. Погрузка: ${shortCity(leg.load.fromCity)}`, index + 1)
    push(leg.load.toPoint, `${index + 1}. Выгрузка: ${shortCity(leg.load.toCity)}`, index + 1)
  })
  return points
}

// ---------------------------------------------------------------------------
// Варианты маршрута: выбор за логистом, а не за программой
// ---------------------------------------------------------------------------

/** Шаги лимита времени: сутки → двое → трое → пятеро → неделя. */
export const HOURS_STEPS = [24, 48, 72, 120, 168]

/** «72» → «3 дня». Для подписей вариантов и кнопок. */
export function hoursLabel(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24
    if (days === 1) return "1 день"
    if (days < 5) return `${days} дня`
    return `${days} дней`
  }
  return `${hours} ч`
}

/**
 * Часы словами, как их планирует логист: «11 ч», «2 дня 5 ч».
 *
 * Зачем: на экране рядом стоят «занял» и «осталось» — их надо читать
 * одинаково, иначе сравнение не работает.
 */
export function hoursSpan(hours: number): string {
  const rounded = Math.round(hours)
  if (rounded <= 0) return "0 ч"
  if (rounded < 24) return `${rounded} ч`
  const days = Math.floor(rounded / 24)
  const rest = rounded % 24
  if (rest === 0) return hoursLabel(rounded)
  return `${days} ${plural(days, ["день", "дня", "дней"])} ${rest} ч`
}

/**
 * Расстояния считаем по прямой между точками грузов — реальный пробег
 * больше. Это оценка, и на экране она должна быть помечена как оценка.
 */
export const DISTANCE_NOTE =
  "Километры — по прямой между точками грузов: реальный пробег обычно на 15–20% больше"

/**
 * Почему цепочка перестала расти — по одному-двум предложениями на причину.
 *
 * Правило простое: каждая строка должна быть проверяемой. «Дальше грузы
 * были, но маршрут не влезал в лимит времени» — непроверяемая и часто
 * ложная, поэтому вместо неё — какой груз, когда готов и сколько ждать.
 */
function stopReasons(stop: ChainStop, maxHours: number, detourKm: number, legs: number): string[] {
  const limitText = `лимит ${maxHours} ч`
  switch (stop.kind) {
    case "hours": {
      const load = stop.load
      const where = load
        ? `Ближайший груз по пути — ${shortCity(load.fromCity)} → ${shortCity(load.toCity)}`
        : "Дальше по пути грузы были"
      const date = load?.loadingDate ? formatDateShort(load.loadingDate) : null
      if (stop.waitHours >= 12) {
        const ready = date ? `, готов к загрузке ${date}` : ""
        return [
          `${where}${ready}: ждать ${hoursSpan(stop.waitHours)} — с ним выезд вышел бы за ${limitText}`,
        ]
      }
      return [
        `${where}, но плечо ${hoursSpan(stop.hours)} плюс дорога домой — в ${limitText} уже не влезало`,
      ]
    }
    case "profit":
      return ["Дальше по пути были грузы, но ставка не покрывала пробег и топливо"]
    case "used-city":
      return [
        "Дальше грузы были только из городов, где мы уже забирали: с одной точки берём один груз",
      ]
    case "legs":
      return [`Маршрут уже ${legs} ${pluralLegs(legs)} — столько хватает на один выезд`]
    case "none":
    default:
      return [`Дальше в радиусе ${detourKm} км грузов «по пути» не нашлось`]
  }
}

/** Следующий шаг лимита времени: 24 → 48 → 72 → 120 → 168. */
export function nextHoursStep(current: number): number {
  return HOURS_STEPS.find((value) => value > current) ?? current
}

/** Предыдущий шаг лимита времени: 168 → 120 → 72 → 48 → 24. */
export function prevHoursStep(current: number): number {
  const lower = HOURS_STEPS.filter((value) => value < current)
  return lower.length > 0 ? lower[lower.length - 1] : current
}

/** Чем отличаются варианты маршрута. */
export type RouteVariantKind = "chosen" | "money" | "fast"

export interface RouteVariant {
  kind: RouteVariantKind
  /** Короткая подпись для переключателя: «Больше денег» */
  label: string
  /** Чем этот вариант отличается: «5 дней в пути» */
  hint: string
  /** Лимит часов этого варианта — им и пересобираем при выборе */
  hours: number
  route: BuiltRoute
}

/**
 * Несколько вариантов одного и того же выезда.
 *
 * Логист на бирже никогда не строит «единственно правильный» маршрут: он
 * смотрит, что дадут сутки, что дадут трое, и выбирает по обстоятельствам —
 * машина нужна завтра или можно подольше поработать. Поэтому помощник
 * предлагает три плана с одним выездом и одной базой:
 *
 *  • «Как выбрано» — ровно тот лимит часов, который задал логист;
 *  • «Больше денег» — на шаг дольше: цепочка длиннее, выручка выше;
 *  • «Быстрее домой» — на шаг короче: меньше плеч, машина свободна раньше.
 *
 * Одинаковые маршруты не дублируем: если длиннее не набирается ничего
 * нового, варианта просто нет.
 */
export function buildRouteVariants(options: BuildRouteOptions): RouteVariant[] {
  const base = options.maxHours && options.maxHours > 0 ? options.maxHours : 72
  const plans: Array<{ kind: RouteVariantKind; label: string; hours: number }> = [
    { kind: "chosen", label: "Как выбрано", hours: base },
    { kind: "money", label: "Больше денег", hours: nextHoursStep(base) },
    { kind: "fast", label: "Быстрее домой", hours: prevHoursStep(base) },
  ]

  const variants: RouteVariant[] = []
  const seen = new Set<string>()
  for (const plan of plans) {
    const route = buildRouteFor(options, plan.hours)
    if (!route) continue
    if (seen.has(route.id)) continue
    seen.add(route.id)
    variants.push({
      kind: plan.kind,
      label: plan.label,
      // Подпись — про ФАКТИЧЕСКОЕ время маршрута, а не про лимит: «3 дня в
      // пути» над маршрутом на 20 ч — такая же ложь, как «в лимит уложились»
      hint: `${hoursSpan(route.totalHours)} в пути`,
      hours: plan.hours,
      route,
    })
  }
  return variants
}

/**
 * Собрать маршрут с заданным лимитом часов. Внутренняя: варианты маршрута
 * («как выбрано», «больше денег», «быстрее домой») отличаются только им.
 */
function buildRouteFor(options: BuildRouteOptions, maxHoursOption?: number): BuiltRoute | null {
  const now = options.now ?? new Date()
  const departAt = departTime(now)
  // Жёсткий предел плеч — страховка от бесконечной цепочки; реальный
  // лимит задаёт время (maxHours)
  const maxLegs = 8
  const maxHours =
    maxHoursOption && maxHoursOption > 0
      ? maxHoursOption
      : options.maxHours && options.maxHours > 0
        ? options.maxHours
        : 72
  const minProfitPerKm = options.minProfitPerKm ?? 25
  const detourKm = options.detourKm ?? 150
  const startRadiusKm = options.startRadiusKm ?? 300
  const fuelPrice = options.fuelPriceRubPerL
  const excludeIds = new Set(options.excludeIds ?? [])
  const keepIds = options.keepIds ?? []

  const preExcluded: ExcludedLoad[] = []
  const pool: BuilderLoad[] = []

  for (const load of options.loads) {
    if (load.status !== "new") {
      preExcluded.push({ load, reason: "груз уже не в бирже" })
      continue
    }
    if (excludeIds.has(load.id)) {
      preExcluded.push({ load, reason: "исключён вами" })
      continue
    }
    if (!normalizeCityKey(load.fromCity) || !normalizeCityKey(load.toCity)) {
      preExcluded.push({ load, reason: "маршрут неизвестен" })
      continue
    }
    if (loadPrice(load) <= 0) {
      preExcluded.push({ load, reason: "ставка не озвучена" })
      continue
    }
    if (!isFresh(load, now)) {
      preExcluded.push({ load, reason: "дата загрузки прошла" })
      continue
    }
    pool.push(load)
  }

  if (pool.length === 0) return null

  // Точка старта: база машины, иначе город самого выгодного груза
  const startCity = options.startCity.trim()
  const startFromCity = startCity.length > 0
  const effectiveStart = startFromCity ? startCity : shortCity(pool[0].fromCity)

  const vehicles = usableVehicles(options.vehicles)
  if (vehicles.length === 0) return null

  // Перебор машин: маленькие сначала — дешевле рейс
  const vehicleOrder = [...vehicles].sort((a, b) => {
    const byStatus = Number(a.status !== "available") - Number(b.status !== "available")
    if (byStatus !== 0) return byStatus
    return (a.capacity ?? Number.MAX_SAFE_INTEGER) - (b.capacity ?? Number.MAX_SAFE_INTEGER)
  })

  let bestRoute: BuiltRoute | null = null

  for (const vehicle of vehicleOrder) {
    // Грузы, которые влезают в эту машину
    const fitting = pool.filter((load) => loadFitsVehicle(load, vehicle))
    if (fitting.length === 0) continue

    const chain = buildChain(
      effectiveStart,
      options.startPoint ?? null,
      fitting,
      vehicle,
      fuelPrice,
      maxLegs,
      minProfitPerKm,
      detourKm,
      startRadiusKm,
      maxHours,
      keepIds,
      departAt,
    )
    const legs = chain.legs
    if (legs.length === 0) continue
    const stop = chain.stop
    let trimmedByHours = false

    // Маршрут обещан на N часов — считаем с дорогой домой. Если цепочка
    // вместе с порожним возвратом не влезает в срок, снимаем последние плечи:
    // лучше короче ехать, чем нарушить обещанные сутки. Согласованные
    // звонком грузы не трогаем — логист уже договорился.
    while (legs.length > 1) {
      const last = legs[legs.length - 1]
      // Домой = тот же город или тот же городской округ: «Константиново с.
    // (г.о. Домодедово)» при базе «Домодедово» — это уже дом
    const backHome = samePlace(last.load.toCity, effectiveStart)
      const back =
        backHome || !options.startPoint || !last.load.toPoint
          ? 0
          : haversineKm(options.startPoint, last.load.toPoint)
      const withReturn =
        legs.reduce((sum, leg) => sum + leg.hours, 0) + (back > 0 ? legHours(back, 0) : 0)
      if (withReturn <= maxHours) break
      if (keepIds.includes(last.load.id)) break
      legs.pop()
      trimmedByHours = true
    }

    // Обратный груз домой: машина не едет порожняком, если на бирже есть
    // груз из конечного города на базу. Часы цепочки = сумма плеч с
    // ожиданием — тем же счётчиком, что проверял бюджет.
    const backLeg = findBackHomeLeg({
      legs,
      pool,
      vehicle,
      fuelPrice,
      startCity: effectiveStart,
      currentCity: legs[legs.length - 1].load.toCity,
      currentPoint: legs[legs.length - 1].load.toPoint ?? null,
      maxHours,
      minProfitPerKm,
      detourKm,
      keepIds,
      clock: legs.reduce((sum, leg) => sum + leg.hours + leg.waitHours, 0),
      departAt,
    })
    if (backLeg) {
      legs.push(backLeg)
      // Обратка закрыла выезд — хвост снимать больше не нужно
      trimmedByHours = false
    }

    const totalRevenue = legs.reduce((sum, leg) => sum + leg.revenue, 0)
    const totalLoaded = legs.reduce((sum, leg) => sum + leg.loadedKm, 0)
    const totalDeadhead = legs.reduce((sum, leg) => sum + leg.deadheadKm, 0)
    const lastLeg = legs[legs.length - 1]
    const lastCity = shortCity(lastLeg.load.toCity)
    const atHome = samePlace(lastLeg.load.toCity, effectiveStart)

    const route = finalize({
      legs,
      vehicle,
      effectiveStart,
      startFromCity,
      startPoint: options.startPoint ?? null,
      pool,
      preExcluded,
      excludeIds,
      keepIds,
      fuelPrice,
      totalRevenue,
      totalLoaded,
      totalDeadhead,
      lastCity,
      atHome,
      now,
      departAt,
      minProfitPerKm,
      detourKm,
      maxHours,
      stop,
      trimmedByHours,
    })
    if (!route) continue

    // Лучший маршрут — тот, который больше зарабатывает за час времени
    // машины: поездка ограничена сроком, а не километражем. Раньше выбор шёл
    // по «₽/км», и короткий рейс побеждал длинный: на Новосибирске
    // помощник брал 317 км на 18 872 ₽ вместо 3118 км на 152 888 ₽.
    // При равной часовой ставке — больше денег всего, затем плотнее км.
    const score = (item: BuiltRoute): number =>
      item.profitPerHour ?? item.profitPerKm ?? -1
    if (
      bestRoute === null ||
      score(route) > score(bestRoute) ||
      (score(route) === score(bestRoute) &&
        (route.totalRevenue > bestRoute.totalRevenue ||
          (route.totalRevenue === bestRoute.totalRevenue &&
            (route.profitPerKm ?? -1) > (bestRoute.profitPerKm ?? -1))))
    ) {
      bestRoute = route
    }
  }

  return bestRoute
}

interface FinalizeInput {
  legs: RouteLeg[]
  vehicle: BuilderVehicle
  effectiveStart: string
  startFromCity: boolean
  startPoint: Point | null
  pool: BuilderLoad[]
  /** Грузы, отсеянные ещё до цепочки: не в бирже, исключены вами, без ставки… */
  preExcluded: ExcludedLoad[]
  excludeIds: Set<string>
  keepIds: readonly string[]
  fuelPrice: number | null
  totalRevenue: number
  totalLoaded: number
  totalDeadhead: number
  lastCity: string
  atHome: boolean
  now: Date
  /** Когда машина выезжает — от этого считаем ЕТА и дату дома */
  departAt: Date
  minProfitPerKm: number
  detourKm: number
  maxHours: number
  /** Почему цепочка перестала расти — точная причина, а не «грузы были» */
  stop: ChainStop
  /** Хвост цепочки сняли: с дорогой домой маршрут не влезал в лимит */
  trimmedByHours: boolean
}

/** Считать итоги маршрута и собрать объяснения — один раз на вариант. */
function finalize(input: FinalizeInput): BuiltRoute | null {
  const {
    legs,
    vehicle,
    effectiveStart,
    startFromCity,
    startPoint,
    pool,
    preExcluded,
    excludeIds,
    keepIds,
    fuelPrice,
    totalRevenue,
    totalLoaded,
    totalDeadhead,
    lastCity,
    atHome,
    maxHours,
    departAt,
  } = input

  // Дорога домой: если последнее плечо не привело на базу, считаем порожний
  // возврат — иначе прибыль маршрута была бы завышена на весь обратный путь.
  const lastPoint = legs[legs.length - 1].load.toPoint ?? null
  const returnDeadheadKm = atHome || !startPoint || !lastPoint ? 0 : haversineKm(startPoint, lastPoint)
  const returnFuelLiters =
    returnDeadheadKm > 0 ? estimateFuelL(vehicle, returnDeadheadKm, 0) : null
  const returnFuelCostRub =
    returnFuelLiters !== null && fuelPrice !== null && fuelPrice > 0
      ? Math.round(returnFuelLiters * fuelPrice)
      : null

  const returnsHomeWithLoad = atHome || legs.some((leg) => leg.returnsHome)

  const totalDistanceKm = totalLoaded + totalDeadhead + returnDeadheadKm
  // Время: плечи + дорога домой (если возврат не гружёный)
  // Время поездки = дорога + погрузки/выгрузки + ожидание дат загрузки +
  // дорога домой. Логист планирует «сколько едем» целиком: простой под дату
  // загрузки — такое же время маршрута, как километры.
  const legsHours = legs.reduce((sum, leg) => sum + leg.hours + leg.waitHours, 0)
  const waitHoursTotal = legs.reduce((sum, leg) => sum + leg.waitHours, 0)
  const returnHours = returnDeadheadKm > 0 ? legHours(returnDeadheadKm, 0) : 0
  const totalHours = Math.round((legsHours + returnHours) * 10) / 10
  // Домой — конец того же таймлайна: выезд + все часы маршрута
  const homeAt = new Date(departAt.getTime() + totalHours * 3600000)
  const lateRiskLegs = legs.filter((leg) => leg.lateRisk).length
  const hasFuel =
    legs.every((leg) => leg.fuelCostRub !== null) &&
    (returnDeadheadKm === 0 || returnFuelCostRub !== null)
  const legsFuel = legs.reduce((sum, leg) => sum + (leg.fuelCostRub ?? 0), 0)
  const totalFuelCostRub = hasFuel ? legsFuel + (returnFuelCostRub ?? 0) : null
  const totalProfitRub = totalFuelCostRub !== null ? totalRevenue - totalFuelCostRub : null
  const profitPerKm =
    totalProfitRub !== null && totalDistanceKm > 0 ? Math.round(totalProfitRub / totalDistanceKm) : null
  const profitPerHour =
    totalProfitRub !== null && totalHours > 0 ? Math.round(totalProfitRub / totalHours) : null
  const needsFuelSetup = vehicle.fuelConsumptionPer100 == null || vehicle.fuelConsumptionPer100 <= 0

  // Что осталось за бортом — с причинами. Сначала отсеянные до цепочки
  // (их причина известна точно), потом непопавшие грузы из общего пула.
  const usedIds = new Set(legs.map((leg) => leg.load.id))
  const excluded: ExcludedLoad[] = [...preExcluded]
  for (const load of pool) {
    if (usedIds.has(load.id)) continue
    if (excluded.some((item) => item.load.id === load.id)) continue
    let reason = "другое направление"
    if (excludeIds.has(load.id)) reason = "исключён вами"
    else if (loadPrice(load) <= 0) reason = "ставка не озвучена"
    else if (!loadFitsVehicle(load, vehicle)) reason = "не влезает в выбранную машину"
    else if (legs.some((leg) => normalizeCityKey(leg.load.toCity) === normalizeCityKey(load.fromCity))) {
      const km = Math.max(0, load.distanceKm ?? 0)
      const money = legMoney(load, km, vehicle, fuelPrice)
      if (money.profitRub !== null && money.profitRub <= 0) reason = "плечо в убыток"
      else if (km > 0 && (money.profitRub ?? money.revenue) / km < input.minProfitPerKm) {
        reason = "слишком низкая ставка"
      }
    }
    excluded.push({ load, reason })
  }

  // Остаток биржи — по причинам, без двойного счёта: excluded = отсеянные
  // до цепочки + грузы пула, которые не взяли. Поэтому «пригодные» считаем
  // из пула, а причины — из финального списка.
  const notUsed = pool.filter((load) => !usedIds.has(load.id))
  const usable = notUsed.filter((load) => loadFitsVehicle(load, vehicle)).length
  const countReason = (pattern: RegExp) =>
    excluded.filter((item) => pattern.test(item.reason)).length
  const leftover: LeftoverCounts = {
    usable,
    noRate: countReason(/ставка не озвучена/),
    pastDate: countReason(/дата загрузки прошла/),
    notFit: notUsed.length - usable,
    other:
      excluded.length - usable - (notUsed.length - usable) - countReason(/ставка не озвучена/) - countReason(/дата загрузки прошла/),
  }

  const reasons: string[] = []
  if (!startFromCity) {
    reasons.push(`Город старта не указан — начали от самого выгодного груза в ${shortCity(effectiveStart)}`)
  }
  if (legs.length > 1) {
    reasons.push(
      `Цепочка из ${legs.length} плеч: ${shortCity(effectiveStart)} → ${lastCity}`,
    )
  }
  if (legs.length > 1 && legs.some((leg) => leg.loadsAt)) {
    reasons.push("Грузы набирались по датам загрузки: ближайший к нашему приезду — первым")
  }
  const firstLeg = legs[0]
  if (firstLeg && firstLeg.byTheWay && firstLeg.deadheadKm > 0) {
    reasons.push(
      `Первый груз в ${firstLeg.deadheadKm} км от базы — порожний выезд учтён в прибыли`,
    )
  }
  const byTheWay = legs.filter((leg) => leg.byTheWay).length
  if (byTheWay > 0) {
    reasons.push(
      `${formatCount(byTheWay, ["груз", "груза", "грузов"])} ${
        byTheWay === 1 ? "взят" : "взяты"
      } «по пути» — в пределах ${input.detourKm} км от маршрута`,
    )
  }
  if (totalDeadhead > 0) {
    reasons.push(`Подъезды к погрузке: ${totalDeadhead} км порожними — учтены в прибыли`)
  }
  if (returnsHomeWithLoad) {
    reasons.push("Возврат домой с грузом — машина не поедет пустой")
  } else if (returnDeadheadKm > 0) {
    reasons.push(
      `Обратно в ${shortCity(effectiveStart)}: ${returnDeadheadKm} км порожнем — учтено в прибыли`,
    )
  } else if (!atHome) {
    reasons.push(
      `Обратно в ${shortCity(effectiveStart)} — порожним пробегом; точное расстояние посчитает навигатор`,
    )
  }
  // Время — честно: сколько заняли и сколько осталось. «В лимит уложились»
  // на маршруте из 11 ч при лимите 48 ч звучит как насмешка над логистом.
  const restHours = Math.round((maxHours - totalHours) * 10) / 10
  const busyText = hoursSpan(totalHours)
  const limitText = `лимит ${maxHours} ч`
  if (input.trimmedByHours) {
    reasons.push(`Маршрут занял ${busyText} при ${limitText}: лимит исчерпан, хвост сняли`)
  } else if (restHours > 0) {
    reasons.push(
      `Маршрут занял ${busyText} при ${limitText} — осталось ${hoursSpan(restHours)}`,
    )
  } else {
    reasons.push(`Маршрут занял ${busyText} при ${limitText} — лимит выбран полностью`)
  }
  // Дисклеймер по расстояниям: точки грузов соединяем по прямой, а не по
  // дорогам. Молчать об этом — значит врать про километры и прибыль.
  if (totalDistanceKm > 0) {
    reasons.push(DISTANCE_NOTE)
  }
  if (waitHoursTotal >= 12) {
    reasons.push(
      `Ожидание дат загрузки: ${Math.round(waitHoursTotal)} ч — грузы готовы к разным числам`,
    )
  }
  if (lateRiskLegs > 0) {
    reasons.push(
      `По датам: ${formatCount(lateRiskLegs, ["плечо", "плеча", "плеч"])} с риском не успеть к загрузке — уточните дату при звонке`,
    )
  }
  if (input.trimmedByHours) {
    reasons.push("Последние плечи сняли: с дорогой домой маршрут не влезал в лимит времени")
  }
  // Почему цепочка встала — словами по факту, а не «грузы были»
  reasons.push(...stopReasons(input.stop, maxHours, input.detourKm, legs.length))
  if (needsFuelSetup) {
    reasons.push("У машины не заполнен расход топлива — прибыль не посчитана")
  } else if (vehicle.fuelEstimated) {
    reasons.push("Расход топлива — оценка по типу кузова: уточните его в карточке машины для точной прибыли")
  }
  if (keepIds.length > 0) {
    const kept = legs.filter((leg) => keepIds.includes(leg.load.id)).length
    if (kept > 0) reasons.push(`Согласованные грузы сохранены: ${kept}`)
  }

  const path = [shortCity(effectiveStart)]
  for (const leg of legs) path.push(shortCity(leg.load.toCity))

  // Подсказка «как ехать длиннее» — только когда она правда поможет.
  // Маршрут встал на дате загрузки → поднять лимит; встал на пустоте →
  // расширить радиус. Всё остальное — не наша забота.
  let growthHint: string | null = null
  let growthHours: number | null = null
  const stopLoad = input.stop.load
  if (input.stop.kind === "hours" && stopLoad) {
    const longer = nextHoursStep(maxHours)
    if (longer > maxHours) {
      growthHours = longer
      const date = stopLoad.loadingDate ? formatDateShort(stopLoad.loadingDate) : null
      const ready = date ? ` (готов ${date})` : ""
      growthHint =
        `Следующий груз${ready}: ${shortCity(stopLoad.fromCity)} → ${shortCity(stopLoad.toCity)}. ` +
        `Чтобы взять его, поставьте срок ${hoursLabel(longer)} (${longer} ч) — помощник доберёт его в цепочку.`
    }
  } else if (input.stop.kind === "none" && legs.length > 0) {
    growthHint =
      `В радиусе ${input.detourKm} км от маршрута грузов не нашлось. ` +
      "Увеличьте радиус «грузы по пути» в тонкой настройке — цепочка станет длиннее."
  }

  return {
    id: `route:${legs.map((leg) => leg.load.id).join("-")}`,
    startCity: shortCity(effectiveStart),
    startPoint,
    path,
    legs,
    vehicle,
    returnDeadheadKm,
    returnsHomeWithLoad,
    totalDistanceKm,
    totalHours,
    maxHours,
    departAt,
    homeAt,
    lateRiskLegs,
    totalRevenue,
    totalFuelCostRub,
    totalProfitRub,
    profitPerKm,
    profitPerHour,
    needsFuelSetup,
    unprofitable: totalProfitRub !== null && totalProfitRub < 0,
    excluded,
    leftover,
    reasons,
    growthHint,
    growthHours,
  }
}

// ---------------------------------------------------------------------------
// Почему маршрут не собрался
// ---------------------------------------------------------------------------

/**
 * Разбор причины: из этого города грузов нет, они не влезают в машины,
 * ставка не озвучена, дата прошла или плечо убыточное.
 *
 * Зачем: помощник обязан объяснять провал словами и показывать, откуда
 * можно строить. Молчаливое «не собралось» — это тупик для логиста.
 */
export interface FailureReason {
  /** Город, из которого пробовали строить */
  city: string
  /** Сколько грузов биржи выходят из этого города */
  loadsFromCity: number
  /**
   * Грузы «рядом» — в радиусе поиска от базы, а не только из этого города.
   *
   * Зачем: база «Москва», а грузы стоят в Ступино, Раменском, Денисово.
   * Объяснять «грузов из Москвы нет» — тупик: помощник строит из радиуса,
   * значит и провал должен считаться по тому же радиусу.
   */
  loadsNearby: number
  /** Из них со озвученной ставкой — реальные кандидаты */
  loadsNearbyPriced: number
  /** Без озвученной ставки — нечем мерить выгоду */
  noPrice: number
  /** Не влезают ни в одну машину парка */
  tooHeavy: number
  /** Дата загрузки уже прошла */
  overdue: number
  /** Ставка ниже себестоимости или ниже порога ₽/км */
  unprofitable: number
  /** Плечо дольше выбранного лимита времени маршрута */
  tooLong: number
  /** Главная причина одной строкой — для экрана */
  headline: string
}

/** Разбор провала по городу старта. null — город пустой. */
export function explainFailure(options: {
  startCity: string
  loads: BuilderLoad[]
  vehicles: BuilderVehicle[]
  fuelPriceRubPerL: number | null
  minProfitPerKm?: number
  /** Лимит времени маршрута, часы — чтобы объяснить «дольше, чем выбрано» */
  maxHours?: number
  /** Радиус поиска первого груза от базы, км — считаем «рядом» как сборщик */
  startRadiusKm?: number
  /** Точка базы: без неё «рядом» считаем только по городу */
  startPoint?: Point | null
  now?: Date
}): FailureReason | null {
  const city = options.startCity.trim()
  if (!city) return null
  const now = options.now ?? new Date()
  const minPerKm = options.minProfitPerKm ?? 25
  const maxHours = options.maxHours && options.maxHours > 0 ? options.maxHours : 72
  const vehicles = usableVehicles(options.vehicles)

  const key = normalizeCityKey(city)
  const fromCity = options.loads.filter((load) => normalizeCityKey(load.fromCity) === key)
  // «Рядом» — ровно как считает сборщик: тот же город ИЛИ точка погрузки в
  // радиусе поиска от базы. Иначе провал в Москве объясняется «грузов нет»,
  // хотя в радиусе 300 км их больше сотни.
  const radiusKm = options.startRadiusKm ?? 300
  const nearby =
    options.startPoint && radiusKm > 0
      ? options.loads.filter(
          (load) =>
            load.status === "new" &&
            load.fromPoint &&
            haversineKm(options.startPoint as Point, load.fromPoint) <= radiusKm,
        )
      : []
  const nearbyPriced = nearby.filter((load) => loadPrice(load) > 0).length
  const fitsSomeVehicle = (load: BuilderLoad) =>
    vehicles.length > 0 && vehicles.some((vehicle) => loadFitsVehicle(load, vehicle))

  const noPrice = fromCity.filter((load) => loadPrice(load) <= 0).length
  const overdue = fromCity.filter((load) => !isFresh(load, now)).length
  const tooHeavy = fromCity.filter(
    (load) => loadPrice(load) > 0 && isFresh(load, now) && !fitsSomeVehicle(load),
  ).length

  let unprofitable = 0
  let tooLong = 0
  for (const load of fromCity) {
    if (loadPrice(load) <= 0 || !isFresh(load, now)) continue
    if (!fitsSomeVehicle(load)) continue
    const km = Math.max(0, load.distanceKm ?? 0)
    if (km === 0) continue
    // Плечо дольше выбранного срока — логист не поедет, даже если выгодно
    if (legHours(0, km) > maxHours) {
      tooLong += 1
      continue
    }
    // Считаем по лучшей машине, в которую груз влезает
    const vehicle = vehicles.find((item) => loadFitsVehicle(load, item))
    if (!vehicle) continue
    const money = legMoney(load, km, vehicle, options.fuelPriceRubPerL)
    if (money.profitRub !== null && money.profitRub <= 0) {
      // Топливо дороже ставки — плечо в чистый убыток
      unprofitable += 1
      continue
    }
    const perKm = money.profitRub !== null ? money.profitRub / km : loadPrice(load) / km
    if (perKm < minPerKm) unprofitable += 1
  }

  let headline: string
  if (fromCity.length === 0) {
    headline =
      nearbyPriced > 0
        ? `Из «${shortCity(city)}» прямо сейчас грузов нет, но рядом в радиусе ${radiusKm} км — ${nearbyPriced} со ставкой: постройте маршрут от ближайшего`
        : `Из «${shortCity(city)}» и рядом (${radiusKm} км) грузов на бирже сейчас нет`
  } else if (noPrice === fromCity.length) {
    headline = `Из «${shortCity(city)}» есть грузы, но ставка нигде не озвучена`
  } else if (tooHeavy > 0 && tooHeavy + noPrice + overdue >= fromCity.length) {
    headline = `Грузы из «${shortCity(city)}» не влезают в ваши машины — нужна большегрузная`
  } else if (unprofitable > 0 && unprofitable + noPrice + overdue + tooHeavy >= fromCity.length) {
    headline = `Плеча из «${shortCity(city)}» не окупаются — ставка ниже расходов на топливо`
  } else if (tooLong > 0 && tooLong + noPrice + tooHeavy + unprofitable >= fromCity.length) {
    headline = `Грузы из «${shortCity(city)}» есть, но ехать дольше выбранного срока — увеличьте время маршрута`
  } else if (overdue > 0 && overdue + noPrice + tooHeavy + unprofitable >= fromCity.length) {
    headline = `Даты загрузки из «${shortCity(city)}» уже прошли`
  } else {
    headline = `Из «${shortCity(city)}» ничего не сложилось в окупаемую цепочку`
  }

  return {
    city: shortCity(city),
    loadsFromCity: fromCity.length,
    loadsNearby: nearby.length,
    loadsNearbyPriced: nearbyPriced,
    noPrice,
    tooHeavy,
    overdue,
    unprofitable,
    tooLong,
    headline,
  }
}

/** Строка-итог маршрута для карточек и шапок. */
export function routeSummaryLine(route: BuiltRoute): string {
  const parts = [
    `${route.legs.length} ${pluralLegs(route.legs.length)}`,
    route.totalDistanceKm > 0 ? `${route.totalDistanceKm} км` : null,
    route.totalRevenue > 0 ? formatMoney(route.totalRevenue) : null,
    route.totalProfitRub !== null
      ? route.totalProfitRub < 0
        ? `убыток ${formatMoney(Math.abs(route.totalProfitRub))}`
        : `прибыль ${formatMoney(route.totalProfitRub)}`
      : null,
  ]
  return parts.filter(Boolean).join(" · ")
}

export function pluralLegs(count: number): string {
  const n = Math.abs(count) % 100
  const tail = n % 10
  if (n > 10 && n < 20) return "плеч"
  if (tail > 1 && tail < 5) return "плеча"
  if (tail === 1) return "плечо"
  return "плеч"
}
