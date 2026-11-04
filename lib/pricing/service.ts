// lib/pricing/service.ts
//
// Серверная часть оценки цены: сбор данных организации, расчёт, история.
//
// Всё, что читается из базы, ограничено организацией. Это не «дополнительный
// фильтр», а граница арендатора: чужие цены не должны ни попадать в расчёт,
// ни влиять на него. Поэтому where всегда содержит organizationId, а не
// полагается на то, что вызывающий передал «правильные» id.

import { prisma } from "../prisma"
import type { RateEstimate } from "../routing/types"
import { parseRawPrice, type ParsedPrice } from "./status"
import type { CallOutcome } from "./call-outcomes"
import { estimateFromCandidates, type CandidateSample } from "./samples"
import type { EstimateOutcome, PriceSample } from "./estimate"

const DAY_MS = 24 * 3600 * 1000
/** Горизонт истории: более старые цены рынком уже не являются. */
const HISTORY_DAYS = 365
/** Сколько строк читать максимум (защита от гигантских выборок). */
const MAX_ROWS = 600

export interface QuoteRequest {
  organizationId: string
  refKind: "ati" | "order" | "direction"
  refId: string
  fromCity: string
  toCity: string
  km: number | null
  weightKg: number | null
  volumeM3: number | null
  /** Тип кузова как в ATI: «Тент», «Рефрижератор», … */
  bodyType: string | null
  /** Нужен ли температурный режим */
  temperature: boolean | null
  /** Дата перевозки */
  date: Date | null
  /** Сохранить оценку в историю (по умолчанию да) */
  persist?: boolean
  now?: Date
}

export type QuoteResult =
  | {
      ok: true
      estimate: RateEstimate
      used: Array<{ id: string; origin: string; amountRub: number; adjustedRub: number; relation: string }>
      belowCost: boolean
      rejected: Array<{ id: string; reason: string }>
    }
  | { ok: false; reason: string; costFloorRub: number | null; rejected: Array<{ id: string; reason: string }> }

function isTemperatureType(bodyType: string | null): boolean {
  const text = String(bodyType ?? "").toLowerCase()
  return text.includes("реф") || text.includes("изотерм") || text.includes("термо")
}

/**
 * Себестоимость рейса по настройкам организации.
 *
 * Это НЕ рыночная цена: ниже себестоимости везти убыточно, выше — ещё не
 * значит «столько заплатят». Используется как нижняя граница и как последний
 * источник, когда аналогов нет вовсе.
 */
async function costFloor(organizationId: string, km: number | null): Promise<number | null> {
  if (!km || km <= 0) return null
  try {
    const settings = await prisma.fleetSettings.findFirst({ where: { organizationId } })
    const perKm = settings?.operatingCostPerKm
    if (typeof perKm !== "number" || !(perKm > 0)) return null
    return Math.round(perKm * km)
  } catch {
    return null
  }
}

/** Кандидаты из накопленной базы ATI этой организации. */
async function atiCandidates(organizationId: string, now: Date): Promise<CandidateSample[]> {
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS)
  try {
    const rows = await prisma.atiCache.findMany({
      where: {
        organizationId,
        price: { gt: 0 },
        OR: [{ loadingDate: null }, { loadingDate: { gte: since } }],
      },
      select: {
        id: true,
        routeFrom: true,
        routeTo: true,
        distance: true,
        weight: true,
        volume: true,
        truckType: true,
        price: true,
        loadingDate: true,
        organizationId: true,
      },
      orderBy: { loadingDate: "desc" },
      take: MAX_ROWS,
    })
    return rows.map((row) => ({
      id: `ati:${row.id}`,
      origin: "board" as const,
      amountRub: row.price ?? 0,
      fromCity: row.routeFrom,
      toCity: row.routeTo,
      km: row.distance && row.distance > 0 ? row.distance : null,
      weightKg: row.weight ?? null,
      volumeM3: row.volume ?? null,
      body: row.truckType ? [row.truckType] : null,
      temperature: row.truckType ? isTemperatureType(row.truckType) : null,
      at: row.loadingDate ?? null,
      organizationId: row.organizationId,
    }))
  } catch {
    return []
  }
}

/**
 * Кандидаты из собственной истории организации: заказы, по которым цена
 * известна. Именно они — самый сильный сигнал: это деньги, которые реально
 * были (или согласованы).
 */
async function historyCandidates(organizationId: string, now: Date): Promise<CandidateSample[]> {
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS)
  try {
    const rows = await prisma.order.findMany({
      where: {
        organizationId,
        createdAt: { gte: since },
        OR: [{ agreedPrice: { gt: 0 } }, { price: { gt: 0 } }],
      },
      select: {
        id: true,
        routeFrom: true,
        routeTo: true,
        distance: true,
        weight: true,
        volume: true,
        loadingType: true,
        price: true,
        agreedPrice: true,
        createdAt: true,
        organizationId: true,
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    })
    return rows.map((row) => ({
      id: `order:${row.id}`,
      origin: "history" as const,
      amountRub: row.agreedPrice && row.agreedPrice > 0 ? row.agreedPrice : row.price ?? 0,
      fromCity: row.routeFrom,
      toCity: row.routeTo,
      km: row.distance && row.distance > 0 ? row.distance : null,
      weightKg: row.weight ?? null,
      volumeM3: row.volume ?? null,
      body: row.loadingType && row.loadingType !== "other" ? [row.loadingType] : null,
      temperature: null,
      at: row.createdAt ?? null,
      organizationId: row.organizationId,
    }))
  } catch {
    return []
  }
}

/** Все сопоставимые данные организации — одним списком. */
export async function collectCandidates(organizationId: string, now = new Date()): Promise<CandidateSample[]> {
  const [board, history] = await Promise.all([
    atiCandidates(organizationId, now),
    historyCandidates(organizationId, now),
  ])
  return [...history, ...board]
}

/**
 * Оценить стоимость перевозки.
 *
 * Возвращает либо расчёт с обоснованием, либо отказ с причиной — БЕЗ выдуманной
 * цены. Оценка сохраняется в историю: если цену потом подтвердят звонком,
 * расчёт останется, и будет видно, насколько он расходился с рынком.
 */
export async function quotePrice(request: QuoteRequest): Promise<QuoteResult> {
  const now = request.now ?? new Date()
  const floor = await costFloor(request.organizationId, request.km)
  const candidates = await collectCandidates(request.organizationId, now)
  const result = quoteWith(request, candidates, floor, now)
  // История пишется ДО ответа: оценка, которую показали логисту, должна
  // остаться в базе, даже если он сразу закроет экран.
  if (request.persist !== false) await saveEstimate(request, result, now)
  return result
}

/**
 * Оценить сразу много заявок, прочитав базу ОДИН раз.
 *
 * Нужно списку биржи: там до трёхсот грузов без цены, и отдельный запрос на
 * каждый превратил бы открытие экрана в триста запросов к базе.
 */
export async function quoteMany(
  organizationId: string,
  requests: Array<Omit<QuoteRequest, "organizationId">>,
  options: { persist?: boolean } = {},
): Promise<Map<string, QuoteResult>> {
  const now = new Date()
  const result = new Map<string, QuoteResult>()
  if (requests.length === 0) return result
  const candidates = await collectCandidates(organizationId, now)
  // Себестоимость километров считается по одной настройке организации —
  // читаем её один раз и переиспользуем по километражу.
  const settings = await prisma.fleetSettings.findFirst({ where: { organizationId } }).catch(() => null)
  const perKm = settings?.operatingCostPerKm
  const toPersist: QuoteRequest[] = []
  const outcomes: Array<{ request: QuoteRequest; result: QuoteResult }> = []
  for (const item of requests) {
    const request: QuoteRequest = { ...item, organizationId }
    const floor = perKm && item.km && item.km > 0 ? Math.round(perKm * item.km) : null
    const outcome = quoteWith(request, candidates, floor, now, false)
    result.set(item.refId, outcome)
    outcomes.push({ request, result: outcome })
    if (outcome.ok) toPersist.push(request)
  }
  // При сборке маршрута историю не пишем: один и тот же пул, оценённый при
  // каждом пересчёте, забил бы таблицу одинаковыми строками.
  if (options.persist !== false) await saveManyEstimate(outcomes, now)
  return result
}

/** Общий расчёт: одинаковые правила для одиночной оценки и для списка. */
function quoteWith(
  request: QuoteRequest,
  candidates: CandidateSample[],
  floor: number | null,
  now: Date,
  persist = true,
): QuoteResult {
  const outcome: EstimateOutcome = estimateFromCandidates({
    organizationId: request.organizationId,
    candidates,
    request: {
      fromCity: request.fromCity,
      toCity: request.toCity,
      km: request.km,
      weightKg: request.weightKg,
      volumeM3: request.volumeM3,
      body: request.bodyType ? [request.bodyType] : null,
      temperature: request.temperature ?? (request.bodyType ? isTemperatureType(request.bodyType) : null),
      at: request.date,
      costFloorRub: floor,
      currency: "RUB",
      now,
    },
  })

  const result: QuoteResult = outcome.ok
    ? {
        ok: true,
        estimate: outcome.estimate,
        used: outcome.used.map((item) => ({
          id: item.id,
          origin: item.origin,
          amountRub: item.amountRub,
          adjustedRub: item.adjustedRub,
          relation: item.relation,
        })),
        belowCost: outcome.belowCost,
        rejected: outcome.rejected.slice(0, 20),
      }
    : {
        ok: false,
        reason: outcome.reason,
        costFloorRub: outcome.costFloorRub,
        rejected: outcome.rejected.slice(0, 20),
      }

  void persist
  return result
}

/** Сохранить пачку расчётов одним запросом. Ошибка записи не ломает показ. */
async function saveManyEstimate(
  outcomes: Array<{ request: QuoteRequest; result: QuoteResult }>,
  now: Date,
): Promise<void> {
  const rows = outcomes
    .filter((item) => item.result.ok)
    .map((item) => {
      const estimate = (item.result as Extract<QuoteResult, { ok: true }>).estimate
      return {
        organizationId: item.request.organizationId,
        refKind: item.request.refKind,
        refId: item.request.refId,
        fromCity: item.request.fromCity,
        toCity: item.request.toCity,
        km: item.request.km,
        amountRub: estimate.amountRub,
        lowRub: estimate.lowRub,
        highRub: estimate.highRub,
        perKmRub: estimate.perKmRub,
        confidence: estimate.confidence,
        samples: estimate.samples,
        sources: estimate.sources.join(","),
        basis: estimate.basis,
        costFloorRub: estimate.costFloorRub,
      }
    })
  if (rows.length === 0) return
  try {
    await prisma.priceEstimate.createMany({ data: rows })
  } catch {
    // Пакетная запись недоступна (бывает на SQLite) — пишем по одной.
    // Историю не теряем: она нужна, чтобы потом сравнить расчёт с фактом.
    for (const row of rows) {
      try {
        await prisma.priceEstimate.create({ data: row })
      } catch {
        // База без новых таблиц — не повод ломать показ цены.
      }
    }
  }
  void now
}

/** Сохранить расчёт в историю. Ошибки записи не должны ронять показ цены. */
async function saveEstimate(request: QuoteRequest, result: QuoteResult, now: Date): Promise<void> {
  if (!result.ok) return
  try {
    await prisma.priceEstimate.create({
      data: {
        organizationId: request.organizationId,
        refKind: request.refKind,
        refId: request.refId,
        fromCity: request.fromCity,
        toCity: request.toCity,
        km: request.km,
        amountRub: result.estimate.amountRub,
        lowRub: result.estimate.lowRub,
        highRub: result.estimate.highRub,
        perKmRub: result.estimate.perKmRub,
        confidence: result.estimate.confidence,
        samples: result.estimate.samples,
        sources: result.estimate.sources.join(","),
        basis: result.estimate.basis,
        costFloorRub: result.estimate.costFloorRub,
      },
    })
  } catch {
    // Историю не пишем молча, но и не ломаем экран: цена уже посчитана.
  }
  void now
}

/** Последняя сохранённая оценка по объекту — чтобы показать «что показывали раньше». */
export async function lastEstimate(organizationId: string, refKind: string, refId: string) {
  try {
    return await prisma.priceEstimate.findFirst({
      where: { organizationId, refKind, refId },
      orderBy: { createdAt: "desc" },
    })
  } catch {
    return null
  }
}

// ── Звонки ──────────────────────────────────────────────────────────────────

export { CALL_OUTCOMES, AMOUNT_OUTCOMES, callOutcomeLabel } from "./call-outcomes"
export type { CallOutcome } from "./call-outcomes"

export interface CallInput {
  organizationId: string
  refKind: "ati" | "order"
  refId: string
  outcome: CallOutcome
  amountRub?: number | null
  note?: string | null
  contactPhone?: string | null
  authorId?: string | null
}

/**
 * Записать результат разговора.
 *
 * Если разговор закончился согласованной суммой и объект — заказ, сумма
 * становится согласованной ценой заказа (и это единственный путь, которым
 * расчётная цена превращается в подтверждённую). Для заявки ATI сумма просто
 * фиксируется: заявка ещё не заказ.
 */
export async function recordPriceCall(input: CallInput) {
  const amount =
    input.outcome === "confirmed" || input.outcome === "proposed_other"
      ? typeof input.amountRub === "number" && input.amountRub > 0
        ? Math.round(input.amountRub)
        : null
      : null

  const call = await prisma.priceCall.create({
    data: {
      organizationId: input.organizationId,
      refKind: input.refKind,
      refId: input.refId,
      outcome: input.outcome,
      amountRub: amount,
      note: input.note ?? null,
      contactPhone: input.contactPhone ?? null,
      authorId: input.authorId ?? null,
    },
  })

  let confirmedOrder = false
  if (input.refKind === "order" && input.outcome === "confirmed" && amount) {
    const updated = await prisma.order.updateMany({
      where: { id: input.refId, organizationId: input.organizationId },
      data: { agreedPrice: amount, negotiationStatus: "agreed" },
    })
    confirmedOrder = updated.count > 0
  }

  return { call, confirmedOrder }
}

/** История звонков по объекту — последние сверху. */
export async function callHistory(organizationId: string, refKind: string, refId: string) {
  try {
    return await prisma.priceCall.findMany({
      where: { organizationId, refKind, refId },
      orderBy: { createdAt: "desc" },
      take: 20,
    })
  } catch {
    return []
  }
}

/**
 * Что показывать в карточке: цена из источника + оценка (если цена не указана).
 *
 * Единая точка, чтобы экран, API и сборщик маршрутов видели одно и то же.
 */
export async function priceView(input: {
  organizationId: string
  refKind: "ati" | "order"
  refId: string
  fromCity: string
  toCity: string
  km: number | null
  weightKg: number | null
  volumeM3: number | null
  bodyType: string | null
  date: Date | null
  /** Сырое значение цены из источника */
  rawPrice: unknown
  /** Телефон, если он уже был раскрыт (ATI отдаёт контакт только по кнопке) */
  contactPhone?: string | null
}) {
  const parsed: ParsedPrice = parseRawPrice(input.rawPrice, input.refKind === "order" ? "order" : "ati")
  const quote =
    parsed.status === "CONFIRMED" ? null : await quotePrice({
      organizationId: input.organizationId,
      refKind: input.refKind,
      refId: input.refId,
      fromCity: input.fromCity,
      toCity: input.toCity,
      km: input.km,
      weightKg: input.weightKg,
      volumeM3: input.volumeM3,
      bodyType: input.bodyType,
      temperature: input.bodyType ? isTemperatureType(input.bodyType) : null,
      date: input.date,
    })
  const calls = await callHistory(input.organizationId, input.refKind, input.refId)
  const lastCall = calls[0] ?? null

  return {
    price: {
      status:
        lastCall && (lastCall.outcome === "confirmed" || lastCall.outcome === "proposed_other") && lastCall.amountRub
          ? "CONFIRMED"
          : parsed.status,
      amountRub: parsed.status === "CONFIRMED" ? parsed.amountRub : (lastCall?.amountRub ?? null),
      raw: parsed.raw,
      note: parsed.note,
      source: parsed.source,
      vatIncluded: false,
    },
    quote,
    call: lastCall,
    calls,
    hasContact: Boolean(input.contactPhone),
    contactPhone: input.contactPhone ?? null,
  }
}

export type { PriceSample }
