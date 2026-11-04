// lib/pricing/estimate.ts
//
// Оценка рыночной стоимости перевозки по сопоставимым данным.
//
// ГЛАВНОЕ ПРАВИЛО: цена не выдумывается. Если сопоставимых перевозок нет,
// функция возвращает отказ с причиной, а не «среднее по рынку». Поэтому здесь
// нет ни одного зашитого коэффициента вроде «₽/км по России»: единственные
// числа — те, что пришли из данных организации или биржи.
//
// Как считается:
//   1. Отбор: перевозка должна быть СОВМЕСТИМА (кузов, температура, вес) и
//      географически связана с искомым направлением. Несовместимое не
//      сравнивается никогда: рефрижератор Москва → Сочи и тент Москва → Тула —
//      это разные рынки.
//   2. Приведение к одной базе: для направлений «рядом» берётся цена за
//      километр и умножается на километры искомого плеча. Для того же
//      направления цена берётся как есть.
//   3. Взвешивание: своя история (фактические сделки организации) весит больше
//      чужих объявлений; свежие данные весят больше старых; совпадение сезона
//      добавляет вес.
//   4. Свёртка: взвешенная медиана (устойчива к выбросам), границы — квартили
//      при достаточном числе наблюдений, иначе минимум/максимум, иначе границ
//      нет вовсе.
//   5. Уверенность: по числу наблюдений, их разбросу и «родству» направлений.
//      Мало данных — уверенность низкая, и это говорится словами.

import type { EstimateConfidence, RateEstimate } from "../routing/types"

/** Одна сопоставимая перевозка, из которой строится оценка. */
export interface PriceSample {
  /** Идентификатор для разбора: номер заявки ATI или заказа */
  id: string
  /** Откуда: подтверждённая сделка организации или объявление на бирже */
  origin: "history" | "board"
  amountRub: number
  fromCity: string
  toCity: string
  /** Километры по дорогам, если известны */
  km: number | null
  weightKg: number | null
  volumeM3: number | null
  /** Тип кузова в нормализованном виде: tent | reefer | isotherm | flatbed | tanker | any */
  body: string[] | null
  /** Нужен ли температурный режим */
  temperature: boolean | null
  /** Когда перевозка была/будет. Свежесть влияет на вес. */
  at: Date | null
  /** Организация, чьи это данные (null — общая биржа) */
  organizationId: string | null
}

export interface EstimateRequest {
  fromCity: string
  toCity: string
  /** Километры искомого плеча. Без них нельзя приводить «близкие» направления */
  km: number | null
  weightKg: number | null
  volumeM3: number | null
  body: string[] | null
  temperature: boolean | null
  /** Дата перевозки — влияет на сезонный вес */
  at: Date | null
  /**
   * Себестоимость рейса по расходам организации. Это НЕ рыночная цена, а
   * нижняя граница: ниже неё везти убыточно. В оценку не подмешивается,
   * показывается отдельно.
   */
  costFloorRub?: number | null
  currency?: string
  now?: Date
}

export interface UsedSample {
  id: string
  origin: "history" | "board"
  /** Цена в источнике */
  amountRub: number
  /** Цена после приведения к искомому направлению */
  adjustedRub: number
  weight: number
  relation: "same-direction" | "same-origin" | "same-destination"
}

export type EstimateOutcome =
  | {
      ok: true
      estimate: RateEstimate
      used: UsedSample[]
      /** Сколько кандидатов отброшено и почему — верхние причины для разбора */
      rejected: Array<{ id: string; reason: string }>
      /** Оценка ниже себестоимости: рейс по такой цене убыточен */
      belowCost: boolean
    }
  | {
      ok: false
      /** Причина отказа словами: «нет сопоставимых перевозок», «только 1 аналог»… */
      reason: string
      rejected: Array<{ id: string; reason: string }>
      /** Себестоимость, если известна: «ниже неё — убыток» */
      costFloorRub: number | null
    }

const DAY_MS = 24 * 3600 * 1000

function normalizeCity(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+(г\.?|город|п\.?|пос\.?|с\.?|д\.?|пгт)$/i, "")
    // «Ярославль, Ярославская область» и «Ярославль» — один город
    .split(",")[0]
    .replace(/\s+/g, " ")
    .trim()
}

const BODY_GROUPS: Record<string, string[]> = {
  tent: ["тент", "tent", "штор", "curtain"],
  reefer: ["реф", "reefer", "frigo", "холод"],
  isotherm: ["изотерм", "isotherm", "термо"],
  flatbed: ["площадк", "flatbed", "open", "борт"],
  tanker: ["цистерн", "tanker", "танкер"],
  any: ["любой", "any", "не указан"],
}

function bodyGroup(value: string | null | undefined): string | null {
  const text = String(value ?? "").toLowerCase()
  if (!text.trim()) return null
  for (const [group, words] of Object.entries(BODY_GROUPS)) {
    if (group === "any") continue
    if (words.some((word) => text.includes(word))) return group
  }
  return null
}

/**
 * Совместимы ли перевозки настолько, чтобы их вообще сравнивать.
 *
 * Рефрижератор с тентом не сравниваем: там другая техника и другая цена.
 * Неизвестность (кузов не указан) — не повод для отказа, но повод для
 * осторожности: такой аналог получает пониженный вес.
 */
function compatibleBody(
  request: string[] | null,
  sample: string[] | null,
): { ok: boolean; cautious: boolean; reason?: string } {
  const wanted = (request ?? []).map(bodyGroup).filter(Boolean) as string[]
  const offered = (sample ?? []).map(bodyGroup).filter(Boolean) as string[]
  if (wanted.length === 0 || offered.length === 0) return { ok: true, cautious: true }
  if (wanted.includes("reefer") || wanted.includes("isotherm")) {
    const coldOk = offered.some((item) => item === "reefer" || item === "isotherm")
    return coldOk ? { ok: true, cautious: false } : { ok: false, cautious: false, reason: "нужен температурный режим, а аналог — без него" }
  }
  if (offered.some((item) => item === "reefer" || item === "isotherm")) {
    // Реф может везти обычный груз, но его рейс дороже — сравнение в сторону
    // завышения. Не отказываем, но помечаем.
    return { ok: true, cautious: true }
  }
  const overlap = wanted.some((item) => offered.includes(item) || item === "any")
  if (overlap) return { ok: true, cautious: false }
  return { ok: false, cautious: false, reason: "другой тип кузова" }
}

function seasonOf(date: Date): "winter" | "summer" | "other" {
  const month = date.getUTCMonth() + 1
  if (month === 12 || month <= 2) return "winter"
  if (month >= 6 && month <= 8) return "summer"
  return "other"
}

function freshnessWeight(at: Date | null, now: Date): number {
  if (!at) return 0.7
  const days = Math.max(0, (now.getTime() - at.getTime()) / DAY_MS)
  if (days <= 14) return 1
  if (days <= 30) return 0.95
  if (days <= 90) return 0.85
  if (days <= 180) return 0.7
  return 0.5
}

function weightedMedian(values: Array<{ value: number; weight: number }>): number {
  const list = [...values].sort((a, b) => a.value - b.value)
  const total = list.reduce((sum, item) => sum + item.weight, 0)
  if (total <= 0) return list[Math.floor(list.length / 2)]?.value ?? 0
  let acc = 0
  const half = total / 2
  for (let index = 0; index < list.length; index += 1) {
    acc += list[index].weight
    if (acc === half && index + 1 < list.length) {
      // Ровно половина веса набежала на этом значении: медиана — середина
      // между ним и следующим. Иначе при чётном числе равных весов медиана
      // всегда съезжала бы вниз.
      return (list[index].value + list[index + 1].value) / 2
    }
    if (acc > half) return list[index].value
  }
  return list[list.length - 1].value
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const position = (sorted.length - 1) * q
  const base = Math.floor(position)
  const rest = position - base
  const next = sorted[Math.min(base + 1, sorted.length - 1)]
  return sorted[base] + rest * (next - sorted[base])
}

const round100 = (value: number) => Math.round(value / 100) * 100

/**
 * Построить оценку по набору сопоставимых перевозок.
 *
 * Ничего не подставляет: если данных нет — отказ с причиной и (если известна)
 * себестоимостью рейса.
 */
export function buildEstimate(request: EstimateRequest, samples: PriceSample[]): EstimateOutcome {
  const now = request.now ?? new Date()
  const currency = request.currency ?? "RUB"
  const targetKm = request.km && request.km > 0 ? request.km : null
  const fromKey = normalizeCity(request.fromCity)
  const toKey = normalizeCity(request.toCity)

  const rejected: Array<{ id: string; reason: string }> = []
  const used: UsedSample[] = []
  const values: Array<{ value: number; weight: number }> = []

  for (const sample of samples) {
    if (!(sample.amountRub > 0)) {
      rejected.push({ id: sample.id, reason: "цена не указана" })
      continue
    }
    const body = compatibleBody(request.body, sample.body)
    if (!body.ok) {
      rejected.push({ id: sample.id, reason: body.reason ?? "несовместимый тип кузова" })
      continue
    }
    if (request.temperature === true && sample.temperature === false) {
      rejected.push({ id: sample.id, reason: "нужен температурный режим" })
      continue
    }
    // Вес: перевозка на 1,5 т не заменяет перевозку на 18 т — там другая
    // машина и другая ставка. Несовместимое не сравниваем.
    if (request.weightKg && sample.weightKg && (sample.weightKg < request.weightKg * 0.5 || sample.weightKg > request.weightKg * 2)) {
      rejected.push({ id: sample.id, reason: "другая грузоподъёмность" })
      continue
    }

    const sameFrom = normalizeCity(sample.fromCity) === fromKey
    const sameTo = normalizeCity(sample.toCity) === toKey
    const relation: UsedSample["relation"] | null = sameFrom && sameTo ? "same-direction" : sameFrom ? "same-origin" : sameTo ? "same-destination" : null
    if (!relation) {
      rejected.push({ id: sample.id, reason: "другое направление" })
      continue
    }

    // Приведение к искомому плечу.
    let adjusted = sample.amountRub
    if (relation !== "same-direction") {
      // Близкое направление сравнимо только через цену за километр: иначе
      // «Москва → Тула за 20 000» превратится в «Москва → Сочи за 20 000».
      const sampleKm = sample.km && sample.km > 0 ? sample.km : null
      if (!sampleKm || !targetKm) {
        rejected.push({ id: sample.id, reason: "неизвестны километры — нельзя привести к направлению" })
        continue
      }
      adjusted = (sample.amountRub / sampleKm) * targetKm
    }

    let weight = relation === "same-direction" ? 1 : 0.55
    if (sample.origin === "history") weight *= 1.2 // фактические сделки организации
    else weight *= 0.95 // чужие объявления — рынок, но не наши деньги
    if (body.cautious) weight *= 0.8
    weight *= freshnessWeight(sample.at, now)
    if (request.at && sample.at && seasonOf(request.at) === seasonOf(sample.at)) weight *= 1.05

    used.push({
      id: sample.id,
      origin: sample.origin,
      amountRub: sample.amountRub,
      adjustedRub: Math.round(adjusted),
      weight: Math.round(weight * 1000) / 1000,
      relation,
    })
    values.push({ value: adjusted, weight })
  }

  if (values.length === 0) {
    return {
      ok: false,
      reason:
        samples.length === 0
          ? "нет сопоставимых перевозок"
          : "среди найденных нет сопоставимых: " +
            [...new Set(rejected.map((item) => item.reason))].slice(0, 3).join("; "),
      rejected,
      costFloorRub: request.costFloorRub ?? null,
    }
  }

  const amounts = values.map((item) => item.value).sort((a, b) => a - b)
  const median = weightedMedian(values)
  const distinct = new Set(values.map((item) => Math.round(item.value / 100))).size
  const spread = median > 0 ? (quantile(amounts, 0.75) - quantile(amounts, 0.25)) / median : 1

  // Границы. При одном наблюдении границ НЕТ: диапазон из одной точки — это
  // ложная точность. При двух-трёх — минимум и максимум, при большем числе —
  // квартили (устойчивее к выбросам, чем крайние значения).
  let low: number | null = null
  let high: number | null = null
  if (values.length >= 4) {
    low = round100(quantile(amounts, 0.25))
    high = round100(quantile(amounts, 0.75))
  } else if (values.length >= 2) {
    low = round100(amounts[0])
    high = round100(amounts[amounts.length - 1])
  }

  const sameDirection = used.filter((item) => item.relation === "same-direction")
  const historyCount = used.filter((item) => item.origin === "history").length

  // Уверенность. Считается по трём вещам: сколько наблюдений, насколько они
  // разбросаны и насколько «родное» направление. Одно наблюдение с чужого
  // направления высоким не бывает никогда.
  let confidence: EstimateConfidence = "low"
  if (used.length >= 5 && spread <= 0.25 && sameDirection.length >= 3) confidence = "high"
  else if (used.length >= 3 && spread <= 0.5) confidence = "medium"
  else if (used.length >= 4 && spread <= 0.35 && sameDirection.length >= 2) confidence = "medium"
  if (distinct <= 1 && used.length > 2) confidence = confidence === "high" ? "medium" : confidence

  // Порядок источников — как в ТЗ: сначала предложения ATI на этом же
  // направлении, затем близкие направления, затем собственная история.
  // Вес при этом разный (своя сделка надёжнее чужого объявления), но
  // приоритет ПОИСКА — именно такой, и первым в списке идёт тот источник,
  // который сработал раньше всех.
  const sources: string[] = []
  if (sameDirection.some((item) => item.origin === "board")) sources.push("ati-same-direction")
  if (used.some((item) => item.origin === "board" && item.relation !== "same-direction")) {
    sources.push("ati-nearby")
  }
  if (historyCount > 0) sources.push("history")
  if (sources.length === 0) {
    // Осталась только своя история либо только близкие направления — берём
    // то, что есть, в том же порядке.
    if (used.some((item) => item.relation !== "same-direction")) sources.push("ati-nearby")
    if (historyCount > 0) sources.push("history")
  }
  if (sources.length === 0) sources.push("ati-nearby")

  const parts: string[] = []
  parts.push(
    sameDirection.length > 0
      ? `${sameDirection.length} сопоставимых на этом направлении`
      : "на этом направлении сопоставимых нет",
  )
  const nearby = used.length - sameDirection.length
  if (nearby > 0) parts.push(`${nearby} на близких направлениях (с поправкой на километры)`)
  if (historyCount > 0) parts.push(`${historyCount} из собственной истории организации`)
  parts.push(`разброс ${(spread * 100).toFixed(0)} %`)

  const amountRub = round100(median)
  const costFloorRub = request.costFloorRub ?? null
  const belowCost = costFloorRub !== null && amountRub < costFloorRub

  return {
    ok: true,
    estimate: {
      amountRub,
      lowRub: low,
      highRub: high,
      perKmRub: targetKm ? Math.round(amountRub / targetKm) : null,
      confidence,
      samples: used.length,
      source: sources[0],
      sources,
      basis: parts.join(", "),
      measuredAt: now.toISOString(),
      currency,
      costFloorRub,
    },
    used,
    rejected,
    belowCost,
  }
}
