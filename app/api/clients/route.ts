// app/api/clients/route.ts
//
// Клиентская база (задача 5).
//
// GET  /api/clients?search=&limit=&offset= — список клиентов со статистикой:
//      сколько заказов, сколько денег, есть ли просроченная оплата, надёжность.
// POST /api/clients                        — создать карточку вручную.
//
// Дубликат по названию — понятная ошибка 409, а не вторая карточка: сравниваются
// названия без правовой формы и кавычек («ООО "Ромашка"» = «Ромашка»).

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { createClient, listClients } from "@/lib/clients/service"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const params = request.nextUrl.searchParams
    const limitParam = Number(params.get("limit"))
    const offsetParam = Number(params.get("offset"))

    const { clients, total } = await listClients({
      organizationId: org.organizationId,
      search: params.get("search"),
      limit: Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100,
      offset: Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0,
    })

    return NextResponse.json({ success: true, clients, total })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить клиентов"
    console.error("[Clients API] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
    }

    const allowed = [
      "name",
      "inn",
      "kpp",
      "address",
      "contactName",
      "phone",
      "email",
      "paymentType",
      "vatType",
      "deferredDays",
      "notes",
    ]
    const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
    if (unknown.length > 0) {
      return NextResponse.json(
        { success: false, error: `Неизвестные поля клиента: ${unknown.join(", ")}` },
        { status: 400 },
      )
    }

    const result = await createClient({ organizationId: org.organizationId, input: body })

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, errors: result.errors },
        { status: result.code === "duplicate" ? 409 : 400 },
      )
    }

    return NextResponse.json({ success: true, client: result.client })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось создать клиента"
    console.error("[Clients API] POST error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
