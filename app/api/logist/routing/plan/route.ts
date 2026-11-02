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
//
// Разбор тела и сборка ответа живут в `lib/routing/api.ts`: это контракт
// эндпоинта, и он проверяется тестами отдельно от ядра. Здесь — только
// авторизация, вызов расчёта и обработка ошибок.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { captureRouteError } from "@/lib/sentry"
import { parsePlanRequest, planResponse } from "@/lib/routing/api"
import { planForOrganisation } from "@/lib/routing/service"

export const dynamic = "force-dynamic"
// Расчёт на боевом пуле (120 грузов × весь парк) занимает 1–3 с. Запас нужен
// на догрузку координат: городов без них может быть до MAX_GEOCODE_CITIES, а
// геокодер спрашивают не чаще раза в секунду.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffAuth(request)
    if (auth.error) return auth.error
    const org = requireStaffOrganization(auth.user)
    if (!org.ok) return org.response

    const body = await request.json().catch(() => ({}))
    const input = parsePlanRequest(body)

    const result = await planForOrganisation({
      organisationId: org.organizationId,
      poolLimit: input.poolLimit,
      horizonHours: input.horizonHours,
      source: input.source,
      now: input.now,
      excludeIds: input.excludeIds,
      keepIds: input.keepIds,
      vehicleId: input.vehicleId,
    })

    // Нет плана — объясняем, почему. Пустой ответ без причины не отдаём.
    return NextResponse.json(planResponse(result), { status: 200 })
  } catch (error) {
    captureRouteError("logist/routing/plan", error)
    return NextResponse.json(
      { ok: false, message: "не удалось рассчитать маршрут — ошибка на сервере" },
      { status: 500 },
    )
  }
}
