// app/api/cargomart/scan/route.ts
//
// POST /api/cargomart/scan — разъём второй площадки (Cargomart) за флагом.
//
// Правила (ТЗ понедельника, блок Г):
//   · разъём целиком за флагом CARGOMART_ENABLED, по умолчанию ВЫКЛЮЧЕН:
//     без флага эндпоинт отвечает 403 и продукт ведёт себя так, будто
//     Cargomart не существует;
//   · без CARGOMART_TOKEN разъём работает на локальном моке — без сети
//     и без аккаунта; реальный токен — только явным значением в env;
//   · контакты грузовладельцев не запрашиваются ВООБЩЕ;
//   · код не зависит от ATI-кода: общая только накопленная база заявок
//     (AtiCache) — внутренняя модель продукта, куда пишут все источники;
//   · организация — из проверенной сессии, не из тела запроса.

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"

import { cargomartEnabled, searchCargomartLoads } from "@/lib/cargomart/client"
import { saveCargomartLoads } from "@/lib/cargomart/persist"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request)
  if (__auth.error) return __auth.error
  const __org = requireStaffOrganization(__auth.user)
  if (!__org.ok) return __org.response

  // Флаг выключен — разъёма «нет»: единый код и текст на весь продукт.
  if (!cargomartEnabled()) {
    return NextResponse.json(
      {
        success: false,
        code: "cargomart_disabled",
        error: "Разъём Cargomart выключен (CARGOMART_ENABLED=on чтобы включить)",
      },
      { status: 403 },
    )
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      departureCode?: unknown
      departureRadiusKm?: unknown
      weightFromKg?: unknown
      weightToKg?: unknown
      maxPages?: unknown
    }

    const search = await searchCargomartLoads({
      departureCode: typeof body.departureCode === "string" ? body.departureCode : null,
      departureRadiusKm: Number.isFinite(Number(body.departureRadiusKm))
        ? Number(body.departureRadiusKm)
        : null,
      weightFromKg: Number.isFinite(Number(body.weightFromKg)) ? Number(body.weightFromKg) : null,
      weightToKg: Number.isFinite(Number(body.weightToKg)) ? Number(body.weightToKg) : null,
      maxPages: Number.isFinite(Number(body.maxPages)) ? Number(body.maxPages) : undefined,
    })

    // Ошибка транспорта честно проваливает сборку целиком: полбазы хуже,
    // чем понятное «не получилось».
    if (search.error) {
      return NextResponse.json(
        { success: false, error: search.error },
        { status: 502 },
      )
    }

    const saved = await saveCargomartLoads(__org.organizationId, search.loads)

    return NextResponse.json({
      success: true,
      source: "cargomart",
      mock: search.mock,
      found: search.loads.length,
      pages: search.pages,
      created: saved.created,
      updated: saved.updated,
      contactsFetched: false,
    })
  } catch (error: unknown) {
    console.error("[Cargomart Scan] ошибка:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Cargomart scan error",
      },
      { status: 500 },
    )
  }
}
