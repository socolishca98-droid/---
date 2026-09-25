// app/api/routes/[routeId]/documents/route.ts
//
// GET /api/routes/[routeId]/documents?types=ttn,waybill,contract
//
// Документы по маршруту для печати (задача 3, пункт 3): транспортная
// накладная по каждому заказу, путевой лист на рейс и договор-заявка по
// каждому заказу. Виды выбираются галочками в интерфейсе и приходят в `types`;
// без параметра отдаётся полный комплект.
//
// Рейс ищется в границах организации из сессии: чужой рейс — 404, документы по
// нему не собираются. Реквизиты перевозчика берутся из настроек ЭТОЙ
// организации, чужие данные в бланк попасть не могут.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { loadRouteDocuments } from "@/lib/documents/load"
import { DOCUMENT_KINDS, parseDocumentKinds, isDocumentKind } from "@/lib/documents/types"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ routeId: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const { routeId } = await params
    if (!routeId) {
      return NextResponse.json({ success: false, error: "Не указан рейс" }, { status: 400 })
    }

    const raw = request.nextUrl.searchParams.get("types")
    const kinds = parseDocumentKinds(raw)

    // Явно переданный неизвестный вид — ошибка, а не молчаливый полный комплект:
    // иначе опечатка в параметре печатала бы не то, что просили.
    if (raw) {
      const requested = raw
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
      const unknown = requested.filter((item) => !isDocumentKind(item))
      if (unknown.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Неизвестные виды документов: ${unknown.join(", ")}`,
            allowed: [...DOCUMENT_KINDS],
          },
          { status: 400 },
        )
      }
    }

    const result = await loadRouteDocuments({
      organizationId: org.organizationId,
      routeId,
      kinds,
    })

    if (!result.ok) {
      return NextResponse.json({ success: false, error: "Рейс не найден" }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      route: result.route,
      kinds,
      documents: result.documents,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось собрать документы"
    console.error("[Route Documents] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
