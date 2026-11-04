// lib/pricing/samples.ts
//
// Отбор сопоставимых перевозок — «аналогов» для оценки цены.
//
// Здесь только правила сопоставимости, без базы и без сети: так их можно
// проверить независимо (tests/pricing-estimate.test.mjs) и так их нельзя
// случайно «подкрутить» под красивый результат.
//
// Что считается аналогом:
//   · СВОЯ история (фактические сделки организации) — сильнее любого
//     объявления: это цены, по которым организация реально работала;
//   · одинаковое направление — сильнее всего;
//   · близкое направление сравнимо только через ₽/км: «Москва → Тула за
//     20 000» не равно «Москва → Сочи за 20 000».
//
// Несовместимое не сравнивается никогда: рефрижератор и тент — разные рынки,
// 1,5 тонны и 18 тонн — разные машины.

import { buildEstimate, type EstimateOutcome, type EstimateRequest, type PriceSample } from "./estimate"

export interface CandidateSample {
  id: string
  origin: "history" | "board"
  amountRub: number
  fromCity: string
  toCity: string
  km: number | null
  weightKg: number | null
  volumeM3: number | null
  body: string[] | null
  temperature: boolean | null
  at: Date | null
  organizationId: string | null
}

/**
 * Оставить только данные этой организации и общей биржи.
 *
 * Мультиарендность: чужая история цен не должна влиять на оценку. Правило
 * продублировано в SQL-выборке (lib/pricing/service.ts), но проверяется и
 * здесь — на случай, если выборку когда-нибудь перепишут.
 */
export function filterByOrganisation(
  samples: CandidateSample[],
  organizationId: string,
): CandidateSample[] {
  return samples.filter(
    (sample) => sample.organizationId === null || sample.organizationId === organizationId,
  )
}

/** Привести кандидата к виду, с которым работает оценка. */
export function toPriceSample(sample: CandidateSample): PriceSample {
  return {
    id: sample.id,
    origin: sample.origin,
    amountRub: sample.amountRub,
    fromCity: sample.fromCity,
    toCity: sample.toCity,
    km: sample.km,
    weightKg: sample.weightKg,
    volumeM3: sample.volumeM3,
    body: sample.body,
    temperature: sample.temperature,
    at: sample.at,
    organizationId: sample.organizationId,
  }
}

export interface CollectInput {
  organizationId: string
  candidates: CandidateSample[]
  request: EstimateRequest
}

/** Собрать оценку из кандидатов с соблюдением изоляции организаций. */
export function estimateFromCandidates(input: CollectInput): EstimateOutcome {
  const own = filterByOrganisation(input.candidates, input.organizationId)
  return buildEstimate(input.request, own.map(toPriceSample))
}
