// lib/routing/compatibility.ts
//
// Compatibility Engine: подходит ли груз машине и, если нет, то почему.
//
// Два требования из практики:
//   1. Груз, подходящий по весу, нельзя объявлять неподходящим — отказ должен
//      называть настоящую причину, а не «не подошло»;
//   2. неизвестное (в карточке груза нет объёма) — это НЕ отказ. Такое
//      помечается как «неизвестно» и пропускается дальше: лучше спросить у
//      фрахтователя, чем молча выкинуть выгодный груз.

import type { LoadOrder, Vehicle } from "./types"

/** Классы кузова: от «любой» до конкретного. */
export const BODY_CLASSES = [
  "tent",
  "isotherm",
  "reefer",
  "flatbed",
  "tanker",
  "container",
  "any",
] as const

export type BodyClass = (typeof BODY_CLASSES)[number]

/** Приведение свободного текста из базы/биржи к классу кузова. */
export function bodyClass(raw: string | null | undefined): BodyClass {
  const text = String(raw ?? "").toLowerCase()
  if (!text) return "any"
  if (/рефр|refr|reefer/.test(text)) return "reefer"
  if (/изотерм|isotherm/.test(text)) return "isotherm"
  if (/тент|штор|tent|curtain/.test(text)) return "tent"
  if (/плоск|платформ|flatbed|открыт/.test(text)) return "flatbed"
  if (/цистерн|tanker|бензовоз/.test(text)) return "tanker"
  if (/контейнер|container/.test(text)) return "container"
  return "any"
}

/**
 * Какие грузы возьмёт машина с таким кузовом.
 *
 * Рефрижератор берёт изотермические и тентовые грузы (перевозчик так и
 * работает: холод не мешает), изотерм берёт тент, обратное — нет.
 *
 * Если тип кузова в карточке не распознан («Фура», «Тягач», пусто), это
 * НЕИЗВЕСТНОСТЬ, а не «ничего не возит»: такая машина принимает все типы,
 * а сопоставление делает логист. Отказ по незнанию — та же ошибка, что
 * «груз подходит по весу, а объявлен неподходящим».
 */
export function acceptedBodies(vehicle: Vehicle): BodyClass[] {
  const out = new Set<BodyClass>()
  for (const raw of vehicle.body) {
    const cls = bodyClass(raw)
    if (cls === "any") {
      // Кузов не указан — не ограничиваем.
      return [...BODY_CLASSES]
    }
    out.add(cls)
    if (cls === "reefer") {
      out.add("isotherm")
      out.add("tent")
    }
    if (cls === "isotherm") out.add("tent")
    if (cls === "tent") out.add("flatbed")
  }
  out.add("any")
  return [...out]
}

export interface CompatibilityResult {
  fits: boolean
  /** Причины отказа словами — для экрана, а не для лога */
  reasons: string[]
  /** Что неизвестно и поэтому не проверено */
  unknown: string[]
}

export function compatible(order: LoadOrder, vehicle: Vehicle): CompatibilityResult {
  const reasons: string[] = []
  const unknown: string[] = []

  // Масса
  if (order.weightKg === null || order.weightKg === undefined) {
    unknown.push("масса груза не указана")
  } else if (order.weightKg > vehicle.capacityKg) {
    reasons.push(
      `груз ${Math.round(order.weightKg / 100) / 10} т тяжелее машины ` +
        `(${Math.round(vehicle.capacityKg / 100) / 10} т)`,
    )
  }

  // Объём
  if (order.volumeM3 === null || order.volumeM3 === undefined) {
    unknown.push("объём груза не указан")
  } else if (order.volumeM3 > vehicle.capacityM3) {
    reasons.push(
      `объём ${Math.round(order.volumeM3)} м³ больше кузова (${Math.round(vehicle.capacityM3)} м³)`,
    )
  }

  // Кузов
  const accepted = acceptedBodies(vehicle)
  const required = (order.bodyRequired ?? []).map((item) => bodyClass(item))
  for (const need of required) {
    if (need === "any") continue
    if (!accepted.includes(need)) {
      reasons.push(`нужен кузов «${BODY_LABEL[need] ?? need}», у машины ${vehicle.body.join("/") || "не указан"}`)
      break
    }
  }

  return { fits: reasons.length === 0, reasons, unknown }
}

const BODY_LABEL: Record<string, string> = {
  tent: "тент",
  isotherm: "изотерм",
  reefer: "рефрижератор",
  flatbed: "площадка",
  tanker: "цистерна",
  container: "контейнер",
}
