// app/api/clients/[clientId]/route.ts
//
// Карточка клиента (задача 5): контакты и реквизиты, статистика, история
// заказов и свежие фото по его заказам.
//
// GET    — карточка
// PATCH  — правка (белый список полей, переименование проверяется на дубликат)
// DELETE — удаление, если за клиентом нет заказов (иначе рвётся история)

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { deleteClient, loadClientCard, updateClient } from "@/lib/clients/service"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ clientId: string }> }

const EDITABLE_FIELDS = [
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
] as const

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const { clientId } = await params
    if (!clientId) {
      return NextResponse.json({ success: false, error: "Не указан клиент" }, { status: 400 })
    }

    const card = await loadClientCard({ organizationId: org.organizationId, clientId })
    if (!card) {
      return NextResponse.json({ success: false, error: "Клиент не найден" }, { status: 404 })
    }

    return NextResponse.json({ success: true, ...card })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось открыть клиента"
    console.error("[Clients API] GET card error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const { clientId } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
    }

    const unknown = Object.keys(body).filter(
      (key) => !(EDITABLE_FIELDS as readonly string[]).includes(key),
    )
    if (unknown.length > 0) {
      return NextResponse.json(
        { success: false, error: `Неизвестные поля клиента: ${unknown.join(", ")}` },
        { status: 400 },
      )
    }

    const result = await updateClient({
      organizationId: org.organizationId,
      clientId,
      input: body,
    })

    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : result.code === "duplicate" ? 409 : 400
      return NextResponse.json({ success: false, error: result.error }, { status })
    }

    return NextResponse.json({ success: true, client: result.client })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить клиента"
    console.error("[Clients API] PATCH error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const { clientId } = await params

    const result = await deleteClient({ organizationId: org.organizationId, clientId })

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, ordersCount: result.ordersCount },
        { status: result.code === "not_found" ? 404 : 409 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось удалить клиента"
    console.error("[Clients API] DELETE error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
