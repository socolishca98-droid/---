// lib/routing/client.ts
//
// Вызов серверного расчёта из экрана помощника.
//
// Экран больше не считает маршрут сам: он спрашивает POST /api/logist/routing/plan
// и показывает ответ. Причина простая — расчёт стал строгим (точный перебор
// цепочек, кеш расстояний, независимая проверка), и вторая его копия в браузере
// неизбежно разойдётся с серверной. Два разных ответа на один вопрос хуже, чем
// один медленный.
//
// Старый браузерный сборщик остаётся в проекте и работает как аварийный путь:
// если сервер недоступен или ответил отказом по данным, экран честно пишет
// «собрано упрощённо» и показывает результат, а не пустой экран.

import { buildRouteVariants, type BuildRouteOptions, type RouteVariant } from "../logist-mobile/route-builder"
import { serverFailureReason, variantsFromServer, type ServerVehiclePlan } from "./view"

export interface ServerPlanOutcome {
  variants: RouteVariant[]
  /** Кто посчитал: сервер (точный перебор) или браузер (упрощённо) */
  origin: "server" | "local"
  /** Что сказать логисту про происхождение цифр */
  note: string
}

interface ServerPlanResponse {
  ok: boolean
  message?: string
  readiness?: { ok: boolean; blockers?: string[]; warnings?: string[] }
  perVehicle?: ServerVehiclePlan[]
}

const SERVER_NOTE = "план посчитан на сервере: цепочки перебраны целиком, километры и деньги — по правилам организации"

/**
 * Серверный план → варианты для экрана.
 *
 * `options` — тот же вход, что был у браузерного сборщика: он нужен и как
 * источник объектов грузов для подписей, и как аварийный путь.
 */
export async function requestServerPlan(
  options: BuildRouteOptions & { vehicleId?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<ServerPlanOutcome> {
  const fallback = (reason: string): ServerPlanOutcome => {
    const built = buildRouteVariants(options)
    for (const variant of built) variant.route.reasons.unshift(reason)
    return { variants: built, origin: "local", note: reason }
  }

  // Идентификаторы грузов на экране — строки нашей базы (cuid), а ядро
  // называет груз биржевым номером. Переводим здесь, иначе «убрать этот груз»
  // и «оставить согласованный» до сервера не доедут.
  const externalId = (id: string): string => {
    const load = options.loads.find((item) => item.id === id)
    return load?.loadId || id
  }

  const body = {
    source: "both" as const,
    poolLimit: Math.min(Math.max(options.loads.length, 1), 200),
    horizonHours: Math.min(Math.max(Math.round(options.maxHours ?? 72), 1), 24 * 14),
    excludeIds: (options.excludeIds ?? []).map(externalId),
    keepIds: (options.keepIds ?? []).map(externalId),
    vehicleId: options.vehicleId ?? null,
  }

  let response: Response
  try {
    response = await fetchImpl("/api/logist/routing/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    return fallback("серверный расчёт недоступен (нет связи) — цепочка собрана упрощённо в браузере")
  }

  if (!response.ok) {
    return fallback(
      `серверный расчёт ответил ошибкой ${response.status} — цепочка собрана упрощённо в браузере`,
    )
  }

  const payload = (await response.json().catch(() => null)) as ServerPlanResponse | null
  if (!payload) {
    return fallback("серверный расчёт ответил непонятно — цепочка собрана упрощённо в браузере")
  }

  if (!payload.ok) {
    const blockers = payload.readiness?.blockers ?? []
    const reason = blockers[0] ?? payload.message ?? "сервер не смог построить план по данным организации"
    return fallback(`${reason} — цепочка собрана упрощённо в браузере`)
  }

  const vehicles = options.vehicles.map((vehicle) => vehicle)
  const variants = variantsFromServer(
    { perVehicle: payload.perVehicle ?? [] },
    {
      loads: options.loads,
      vehicles,
      startCity: options.startCity,
      startPoint: options.startPoint ?? null,
      maxHours: options.maxHours ?? 72,
    },
  )

  if (variants.length === 0) {
    const reason = serverFailureReason(payload.perVehicle ?? [])
    return fallback(
      `на сервере цепочка не собралась${reason ? ` (${reason})` : ""} — показываю упрощённый расчёт`,
    )
  }

  // Происхождение цифр — на видном месте в «Почему собрал так».
  for (const variant of variants) if (!variant.route.reasons.includes(SERVER_NOTE)) variant.route.reasons.push(SERVER_NOTE)
  return { variants, origin: "server", note: SERVER_NOTE }
}
