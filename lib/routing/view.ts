// lib/routing/view.ts
//
// Мост между серверным планом и экраном помощника.
//
// Новый сборщик считает на сервере (lib/routing/service.ts) и отвечает JSON.
// Экран помощника привык к форме BuiltRoute (lib/logist-mobile/route-builder):
// плечи, путь для карты, «что осталось на бирже», причины. Переписывать 3,5
// тысячи строк интерфейса ради другой формы объекта — значит потерять карту,
// обзвон и всю отладку, которая в нём уже нажита. Поэтому здесь лежит ровно
// один перевод: серверный план → знакомый экрану вид.
//
// Правило перевода: НИЧЕГО НЕ ДОДУМЫВАТЬ. Если сервер чего-то не знает —
// в поле остаётся null, а не ноль: «прибыль 0 ₽» и «прибыль неизвестна» на
// экране должны выглядеть по-разному.

import type { BuilderLoad, BuiltRoute, ExcludedLoad, LeftoverCounts, RouteLeg, RouteVariant } from "../logist-mobile/route-builder"
import { loadPrice } from "../logist-mobile/route-builder"

// ---------------------------------------------------------------------------
// Форма ответа API (даты приходят строками)
// ---------------------------------------------------------------------------

export interface ServerStop {
  kind: "load" | "unload" | "return"
  orderId: string | null
  place: { city: string; region: string | null; point: { lat: number; lng: number } }
  arriveAt: string
  startAt: string
  endAt: string
  waitingHours: number
  handlingHours: number
}

export interface ServerSegment {
  from: { city: string }
  to: { city: string }
  kind: "deadhead" | "loaded"
  orderId: string | null
  km: number
  hours: number
  source: "osrm" | "exchange" | "estimate"
  /** Кто дал километры: osrm-own, osrm-public, exchange…; null — оценка */
  provider?: string | null
}

export interface ServerPlan {
  id: string
  vehicleId: string
  model: "sequential" | "consolidated"
  orderIds: string[]
  stops: ServerStop[]
  segments: ServerSegment[]
  schedule: { startAt: string; endAt: string; shifts: number }
  economics: {
    revenue: number
    fuelRub: number
    driverRub: number
    maintenanceRub: number
    tiresRub: number
    tollsRub: number | null
    otherRub: number
    netRub: number
    netCommittedRub: number
    netPerKm: number | null
    netPerHour: number | null
    totalKm: number
    loadedKm: number
    emptyKm: number
    emptyShare: number
    unknown: string[]
    /** Сумма известных расходов — то, что реально вычтено */
    knownCostRub: number
    /** Чего не хватает в расчёте: статья, причина, оценка сверху, вошло ли в остаток */
    gaps: Array<{ article: string; reason: string; estimateRub: number | null; inNet: boolean }>
    /** Полнота расчёта: complete | preliminary | insufficient */
    status: "complete" | "preliminary" | "insufficient"
    /** Подтверждённая часть дохода, ₽ — деньги */
    revenueConfirmed: number
    /** Расчётная часть дохода, ₽ — ожидание, не деньги */
    revenueEstimated: number
    revenueStatus: "confirmed" | "partly-estimated" | "unconfirmed"
    profitDependsOnEstimate: boolean
  }
  returned: { kind: "loaded" | "empty" | "none"; deadheadKm: number; costRub: number; satisfiesMode: boolean }
  exact: boolean
  confidence: "measured" | "estimated" | "assumed"
  assumptions: string[]
  warnings: string[]
  reasons: string[]
}

export interface ServerVehiclePlan {
  vehicleId: string
  organisationId: string
  recommended: ServerPlan | null
  variants: ServerPlan[]
  /**
   * Сколько вариантов нашлось всего. Сервер отдаёт экрану не больше трёх,
   * и без этого числа «показали три» читается как «нашли три».
   */
  variantsTotal?: number
  rejected: Array<{ orderId: string; reason: string }>
  /** Независимая проверка ядра: нарушения правил, если есть */
  validations?: Array<{ planId: string; ok: boolean; issues: string[] }>
}

// ---------------------------------------------------------------------------
// Плечи
// ---------------------------------------------------------------------------

const MS_HOUR = 3600000

/**
 * Плечи из плана.
 *
 * Идём по участкам в том порядке, в каком их посчитал сервер: порожние
 * копятся до ближайшего гружёного, гружёный закрывает плечо. Хвост порожних —
 * это дорога домой, она не плечо, а возврат.
 */
function legsFromPlan(plan: ServerPlan, loadsById: Map<string, BuilderLoad>): { legs: RouteLeg[]; returnKm: number } {
  const legs: RouteLeg[] = []
  let pendingDeadhead = 0
  let previousEnd: Date | null = plan.schedule.startAt ? new Date(plan.schedule.startAt) : null

  for (const segment of plan.segments) {
    if (segment.kind === "deadhead") {
      pendingDeadhead += segment.km
      continue
    }
    const orderId = segment.orderId
    if (!orderId) continue
    const load = loadsById.get(orderId) ?? null
    const loadStop = plan.stops.find((stop) => stop.kind === "load" && stop.orderId === orderId) ?? null
    const unloadStop = plan.stops.find((stop) => stop.kind === "unload" && stop.orderId === orderId) ?? null
    const legStart = loadStop ? new Date(loadStop.arriveAt) : previousEnd
    const legEnd = unloadStop ? new Date(unloadStop.endAt) : null
    const hours = legStart && legEnd ? Math.max(0, (legEnd.getTime() - legStart.getTime()) / MS_HOUR) : 0
    const revenue = load ? loadPrice(load) : 0

    legs.push({
      load:
        load ??
        // Сервер знает заказ, а экран — нет (например, заказ взяли в работу и он
        // ушёл из накопительной базы). Показываем хотя бы города и ставку.
        ({
          id: orderId,
          loadId: orderId,
          fromCity: segment.from.city,
          toCity: segment.to.city,
          weightKg: null,
          volumeM3: null,
          cargoType: null,
          priceRub: Math.round(revenue),
          priceWithNds: null,
          distanceKm: Math.round(segment.km),
          firmName: null,
          firmUrl: null,
          contactPhone: null,
          loadingDate: null,
          status: "new",
          fromPoint: null,
          toPoint: null,
        } as BuilderLoad),
      deadheadKm: Math.round(pendingDeadhead),
      loadedKm: Math.round(segment.km),
      hours: Math.round(hours * 10) / 10,
      waitHours: loadStop ? Math.round(loadStop.waitingHours * 10) / 10 : 0,
      revenue,
      fuelLiters: null,
      fuelCostRub: null,
      profitRub: null,
      profitPerKm: null,
      returnsHome: false,
      byTheWay: pendingDeadhead > 0,
      etaAt: loadStop ? new Date(loadStop.arriveAt) : new Date(plan.schedule.startAt),
      loadsAt: load?.loadingDate ? new Date(load.loadingDate) : null,
      lateRisk: false,
    })
    pendingDeadhead = 0
    if (legEnd) previousEnd = legEnd
  }

  const returnKm = Math.round(pendingDeadhead)
  const last = legs[legs.length - 1]
  if (last && plan.returned.kind === "loaded") {
    last.returnsHome = true
    last.homeLeg = true
  }
  return { legs, returnKm }
}

// ---------------------------------------------------------------------------
// «Что осталось на бирже»
// ---------------------------------------------------------------------------

/**
 * Остаток считается по причинам отказа сервера — без двойного счёта.
 * Формулировки ядра («не вошёл в лучшие цепочки…», «масса 20 000 кг больше…»)
 * разбираются здесь, а не на экране: экран не должен знать слов ядра.
 */
function leftoverFromRejections(rejections: Array<{ reason: string }>): LeftoverCounts {
  const counts: LeftoverCounts = { usable: 0, noRate: 0, pastDate: 0, notFit: 0, other: 0 }
  for (const rejection of rejections) {
    const reason = rejection.reason.toLowerCase()
    if (/не вошёл|не вошла|не встал|не окупа/.test(reason)) counts.usable += 1
    else if (/ставк|цена не|нечем мерить/.test(reason)) counts.noRate += 1
    else if (/дат|окно|просроч/.test(reason)) counts.pastDate += 1
    else if (/масс|вес|объём|объем|кузов|вмест|тоннаж/.test(reason)) counts.notFit += 1
    else counts.other += 1
  }
  return counts
}

// ---------------------------------------------------------------------------
// План → знакомый экрану вид
// ---------------------------------------------------------------------------

function toBuiltRoute(
  plan: ServerPlan,
  params: {
    loadsById: Map<string, BuilderLoad>
    vehicle: BuiltRoute["vehicle"]
    startCity: string
    startPoint: { lat: number; lng: number } | null
    maxHours: number
    rejections: Array<{ orderId: string; reason: string }>
  },
): BuiltRoute {
  const { legs, returnKm } = legsFromPlan(plan, params.loadsById)
  const departAt = new Date(plan.schedule.startAt)
  const homeAt = new Date(plan.schedule.endAt)
  const hours = Math.max(0, (homeAt.getTime() - departAt.getTime()) / MS_HOUR)

  // Путь для карты: база → города остановок по порядку.
  const path: string[] = [params.startCity]
  for (const stop of plan.stops) {
    const city = stop.place.city
    if (path[path.length - 1] !== city) path.push(city)
  }

  const excluded: ExcludedLoad[] = []
  for (const rejection of params.rejections) {
    const load = params.loadsById.get(rejection.orderId)
    if (load) excluded.push({ load, reason: rejection.reason })
  }

  // Причины — словами ядра. Дополняем тем, что относится к доверию к числу:
  // «расход оценён», «километры оценочные» — это то, что логист обязан знать.
  const reasons = [...plan.reasons]
  for (const assumption of plan.assumptions) if (!reasons.includes(assumption)) reasons.push(assumption)
  // Прибыль, которая держится на расчётной цене, — не прибыль. Говорим это
  // в причинах варианта, чтобы число не читалось как заработанное.
  if (plan.economics.revenueEstimated > 0) {
    const confirmed = Math.round(plan.economics.revenueConfirmed)
    const estimated = Math.round(plan.economics.revenueEstimated)
    reasons.push(
      plan.economics.profitDependsOnEstimate
        ? `прибыль зависит от расчётной цены: подтверждено ${confirmed} ₽, расчёт ${estimated} ₽ — нужен звонок перевозчику`
        : `доход по рейсу расчётный: подтверждено ${confirmed} ₽, расчёт ${estimated} ₽ — это не гарантированные деньги`,
    )
  }

  if (plan.confidence !== "measured") {
    reasons.push(
      plan.confidence === "estimated"
        ? "часть данных оценена (расход топлива или километры) — цифры приблизительные"
        : "данные предположительные — перед рейсом уточните",
    )
  }

  return {
    id: plan.id,
    startCity: params.startCity,
    startPoint: params.startPoint,
    path,
    legs,
    vehicle: params.vehicle,
    returnDeadheadKm: plan.returned.kind === "empty" ? Math.round(plan.returned.deadheadKm) : returnKm,
    returnsHomeWithLoad: plan.returned.kind === "loaded",
    totalDistanceKm: Math.round(plan.economics.totalKm),
    /**
     * Сколько километров маршрута измерено дорогой, а сколько оценено.
     * Без этого «маршрут построен» скрывает, что экономика стоит на догадке:
     * замер этапа 6 показал ошибку оценки до −32 % (Краснодар → Сочи).
     */
    measuredKm: Math.round(
      plan.segments.filter((segment) => segment.source !== "estimate").reduce((sum, segment) => sum + segment.km, 0),
    ),
    estimatedKm: Math.round(
      plan.segments.filter((segment) => segment.source === "estimate").reduce((sum, segment) => sum + segment.km, 0),
    ),
    distanceProviders: [...new Set(plan.segments.map((segment) => segment.provider).filter(Boolean))] as string[],
    totalHours: Math.round(hours),
    maxHours: params.maxHours,
    departAt,
    homeAt,
    lateRiskLegs: 0,
    totalRevenue: Math.round(plan.economics.revenue),
    totalFuelCostRub: Math.round(plan.economics.fuelRub),
    // «Остаток по рейсу» — выручка минус известные статьи: топливо, водитель,
    // износ, шины, платные, прочее.
    totalProfitRub: Math.round(plan.economics.netRub),
    profitPerKm: plan.economics.netPerKm === null ? null : Math.round(plan.economics.netPerKm),
    profitPerHour: plan.economics.netPerHour === null ? null : Math.round(plan.economics.netPerHour),
    // Работа машины — всё, что не топливо: водитель, износ, шины, платные
    // дороги, прочее. Сумма статей, а не «разница с выручкой»: платные дороги
    // могут быть неизвестны (null), и тогда честнее не показывать ноль.
    operatingCostRub: plan.economics.tollsRub === null ? null : Math.round(operatingRub(plan)),
    operatingCostPerKm:
      plan.economics.totalKm > 0 && plan.economics.tollsRub !== null
        ? Math.round((operatingRub(plan) / plan.economics.totalKm) * 10) / 10
        : 0,
    // «Прибыль» на экране — то же число, по которому выбрана рекомендация:
    // остаток с учётом обязательства вернуться на базу (netCommittedRub).
    // Раньше здесь стоял netRub, и маршрут без возврата выглядел прибыльнее
    // ровно на цену возврата.
    netProfitRub: Math.round(plan.economics.netCommittedRub),
    netProfitPerKm: plan.economics.netPerKm === null ? null : Math.round(plan.economics.netPerKm),
    netProfitPerHour: plan.economics.netPerHour === null ? null : Math.round(plan.economics.netPerHour),
    // Доход раздельно: подтверждённый — деньги, расчётный — ожидание.
    // Раньше они складывались в одно число «выручка», и маршрут с расчётной
    // ценой выглядел так же надёжно, как с подписанной ставкой.
    revenueConfirmed: Math.round(plan.economics.revenueConfirmed),
    revenueEstimated: Math.round(plan.economics.revenueEstimated),
    revenueStatus: plan.economics.revenueStatus,
    profitDependsOnEstimate: plan.economics.profitDependsOnEstimate,
    oneWay: plan.returned.kind === "none" || plan.returned.kind === "empty",
    emptyReturnKm: plan.returned.kind === "empty" ? Math.round(plan.returned.deadheadKm) : returnKm,
    needsFuelSetup: false,
    unprofitable: plan.economics.netCommittedRub < 0,
    // Полнота денежного расчёта. insufficient — часть расходов неизвестна, и
    // цифра прибыли не прибыль, а «пока столько».
    profitStatus: plan.economics.status,
    profitGaps: plan.economics.gaps.map((gap) => ({
      article: gap.article,
      reason: gap.reason,
      estimateRub: gap.estimateRub,
      inNet: gap.inNet,
    })),
    excluded,
    leftover: leftoverFromRejections(params.rejections),
    reasons,
    growthHint: null,
    growthHours: null,
    growthLoadId: null,
  }
}

/**
 * Работа машины за рейс: водитель, износ, шины, платные дороги, прочее.
 * Постоянные расходы сюда НЕ входят — они не вычитаются из рейса, а покрываются
 * им (в ядре это отдельная статья `fixedContributionRub`).
 */
function operatingRub(plan: ServerPlan): number {
  const economics = plan.economics
  return (
    economics.driverRub +
    economics.maintenanceRub +
    economics.tiresRub +
    (economics.tollsRub ?? 0) +
    economics.otherRub
  )
}

/**
 * Индекс грузов для стыковки с планом.
 *
 * Ядро называет заказ биржевым номером (`test-1`), а экран — строкой нашей
 * базы (cuid из AtiCache). Это два разных идентификатора одного груза, и
 * стыковать их нужно здесь, иначе плечо получит пустую подпись: без города,
 * без ставки, без телефона фрахтователя. Поэтому индексируем по обоим.
 */
function indexLoads(loads: BuilderLoad[]): Map<string, BuilderLoad> {
  const out = new Map<string, BuilderLoad>()
  for (const load of loads) {
    if (load.id) out.set(load.id, load)
    if (load.loadId && !out.has(load.loadId)) out.set(load.loadId, load)
  }
  return out
}

/**
 * Лучшая машина из ответа сервера.
 *
 * Логика простая и проверяемая: сначала та, у кого есть рекомендация, между
 * собой — по остатку на километр. Машина без рекомендации (всё убыточно) в
 * приоритет не попадает никогда: рекомендации нет — значит и предлагать нечего.
 */
function pickVehiclePlan(perVehicle: ServerVehiclePlan[]): ServerVehiclePlan | null {
  const withRecommendation = perVehicle.filter((item) => item.recommended)
  const pool = withRecommendation.length > 0 ? withRecommendation : perVehicle
  let best: ServerVehiclePlan | null = null
  for (const item of pool) {
    if (!best) {
      best = item
      continue
    }
    const a = item.recommended?.economics.netPerKm ?? -Infinity
    const b = best.recommended?.economics.netPerKm ?? -Infinity
    if (a > b) best = item
  }
  return best
}

/**
 * Варианты для экрана помощника из ответа сервера.
 *
 * Первым идёт рекомендация сервера, дальше — остальные варианты по деньгам.
 * Подписи честные: «Рекомендация», «Сборная перевозка», «Другой порядок» —
 * логист должен понимать, чем варианты отличаются, а не гадать по цифрам.
 */
export function variantsFromServer(response: {
  perVehicle: ServerVehiclePlan[]
  ok?: boolean
}, params: {
  loads: BuilderLoad[]
  vehicles: Array<BuiltRoute["vehicle"]>
  startCity: string
  startPoint: { lat: number; lng: number } | null
  maxHours: number
}): RouteVariant[] {
  const loadsById = indexLoads(params.loads)
  const entry = pickVehiclePlan(response.perVehicle ?? [])
  if (!entry) return []

  const vehicle = params.vehicles.find((item) => item?.id === entry.vehicleId) ?? null
  const ordered = entry.recommended
    ? [entry.recommended, ...entry.variants.filter((plan) => plan.id !== entry.recommended!.id)]
    : [...entry.variants].sort((a, b) => b.economics.netRub - a.economics.netRub)

  const variants: RouteVariant[] = []
  for (let index = 0; index < ordered.length && variants.length < 3; index += 1) {
    const plan = ordered[index]
    const route = toBuiltRoute(plan, {
      loadsById,
      vehicle,
      startCity: params.startCity,
      startPoint: params.startPoint,
      maxHours: params.maxHours,
      rejections: entry.rejected,
    })
    variants.push({
      kind: index === 0 && entry.recommended ? "chosen" : index === 1 ? "money" : "fast",
      label: index === 0 && entry.recommended ? "Рекомендация" : plan.model === "consolidated" ? "Сборная перевозка" : "Другой порядок",
      hint:
        `${route.legs.length} плеч, ${route.totalDistanceKm} км, ${Math.round(route.totalHours / 24 * 10) / 10} сут` +
        (plan.exact ? " · оптимум доказан" : " · эвристика") +
        // Честность о полноте: экран показывает три варианта из найденных, и
        // логист должен видеть, что поиск был шире, а не «всего три».
        (typeof entry.variantsTotal === "number" && entry.variantsTotal > ordered.length
          ? ` · найдено ${entry.variantsTotal}`
          : ""),
      hours: route.totalHours,
      route,
    })
  }
  return variants
}

/** Расшифровка, почему сервер ничего не предложил (для экрана отказа). */
export function serverFailureReason(perVehicle: ServerVehiclePlan[]): string | null {
  if (perVehicle.length === 0) return null
  const reasons = new Map<string, number>()
  for (const item of perVehicle) {
    for (const rejection of item.rejected) {
      reasons.set(rejection.reason, (reasons.get(rejection.reason) ?? 0) + 1)
    }
  }
  let top: string | null = null
  let topCount = 0
  for (const [reason, count] of reasons) {
    if (count > topCount) {
      top = reason
      topCount = count
    }
  }
  return top
}
