// app/api/logist/routing/plan/route.ts
//
// Расчёт маршрутов новым ядром (lib/routing) на сервере.
//
// Почему сервер, а не браузер: расчёт стал строгим (точный перебор цепочек,
// кеш расстояний, независимая проверка), и повторять его в браузере — значит
// получить два разных ответа на один вопрос. Экран только показывает то, что
// посчитано здесь.
//
// Организация берётся из проверенной сессии. В теле запроса можно попросить
// только «сколько грузов брать» и «на какой горизонт» — но не «чьи данные».

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { captureRouteError } from "@/lib/sentry"
import { planForOrganisation } from "@/lib/routing/service"
import type { RoutePlan } from "@/lib/routing/types"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/** План превращается в JSON: даты — строками, без «магии» на клиенте. */
function serializePlan(plan: RoutePlan) {
  return {
    ...plan,
    schedule: {
      ...plan.schedule,
      startAt: plan.schedule.startAt.toISOString(),
      endAt: plan.schedule.endAt.toISOString(),
      events: plan.schedule.events.map((event) => ({
        ...event,
        at: event.at.toISOString(),
      })),
    },
    stops: plan.stops.map((stop) => ({
      ...stop,
      arriveAt: stop.arriveAt.toISOString(),
      startAt: stop.startAt.toISOString(),
      endAt: stop.endAt.toISOString(),
    })),
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffAuth(request)
    if (auth.error) return auth.error
    const org = requireStaffOrganization(auth.user)
    if (!org.ok) return org.response

    const body = (await request.json().catch(() => ({}))) as {
      poolLimit?: unknown
      horizonHours?: unknown
      source?: unknown
      now?: unknown
      excludeIds?: unknown
      keepIds?: unknown
      vehicleId?: unknown
    }

    // Входные параметры — только те, что не могут подменить данные:
    // чужую организацию или чужой пул через них не запросить.
    const poolLimit = Number.isFinite(Number(body.poolLimit))
      ? Math.min(Math.max(Number(body.poolLimit), 1), 200)
      : 120
    const horizonHours = Number.isFinite(Number(body.horizonHours))
      ? Math.min(Math.max(Number(body.horizonHours), 1), 24 * 14)
      : 72
    const source: "ati" | "orders" | "both" =
      body.source === "ati" || body.source === "orders" || body.source === "both"
        ? body.source
        : "both"
    // Момент расчёта можно передать для воспроизводимости (тесты, разбор),
    // но не «в прошлое бесконечно»: дальше суток назад план бессмыслен.
    const parsedNow = typeof body.now === "string" ? new Date(body.now) : new Date()
    const now =
      Number.isNaN(parsedNow.getTime()) || parsedNow.getTime() < Date.now() - 86400000
        ? new Date()
        : parsedNow

    // Идентификаторы грузов и машины — это фильтры по СВОИМ данным: сервис
    // ищет пул и автопарк только по организации из сессии, поэтому чужие
    // идентификаторы просто не найдутся. Ограничение длины — чтобы тело
    // запроса не превращалось в способ занять сервер.
    const idList = (value: unknown): string[] | undefined => {
      if (!Array.isArray(value)) return undefined
      return value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 300)
    }

    const result = await planForOrganisation({
      organisationId: org.organizationId,
      poolLimit,
      horizonHours,
      source,
      now,
      excludeIds: idList(body.excludeIds),
      keepIds: idList(body.keepIds),
      vehicleId: typeof body.vehicleId === "string" ? body.vehicleId : undefined,
    })

    // Нет плана — объясняем, почему. Пустой ответ без причины не отдаём.
    if (!result.plan) {
      return NextResponse.json(
        {
          ok: false,
          readiness: result.readiness,
          summary: result.summary,
          message: result.readiness.blockers[0] ?? "маршрут не построен",
        },
        { status: 200 },
      )
    }

    // Ответ — не архив расчёта, а то, что экран покажет. Экран берёт
    // рекомендацию и не больше трёх вариантов, поэтому отдавать все семь
    // вариантов по каждой машине значит гнать в браузер мегабайты ради
    // данных, которые никто не увидит (замер на пяти машинах: 143 КБ против
    // 1,8 МБ в худшем случае полного ответа). Сколько всего нашлось — сказано
    // числом `variantsTotal`, чтобы «показали три» не выглядело как «нашли три».
    const VARIANTS_PER_VEHICLE = 3
    const perVehicle = result.plan.perVehicle.map((item) => ({
      vehicleId: item.vehicleId,
      organisationId: item.organisationId,
      recommended: item.recommended ? serializePlan(item.recommended) : null,
      variants: item.variants.slice(0, VARIANTS_PER_VEHICLE).map(serializePlan),
      variantsTotal: item.variants.length,
      rejected: item.rejected,
      stats: item.stats,
    }))

    return NextResponse.json({
      ok: true,
      readiness: result.readiness,
      summary: result.summary,
      organisationId: result.plan.organisationId,
      stats: result.plan.stats,
      perVehicle,
      // Проверка независимым валидатором — в ответе, а не «в логах»:
      // если правило нарушено, это видно и API, и экрану.
      validations: result.plan.validations.map((item) => ({
        planId: item.planId,
        ok: item.result.ok,
        issues: item.result.issues,
      })),
    })
  } catch (error) {
    captureRouteError("logist/routing/plan", error)
    return NextResponse.json(
      { ok: false, message: "не удалось рассчитать маршрут — ошибка на сервере" },
      { status: 500 },
    )
  }
}
