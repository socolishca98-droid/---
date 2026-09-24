// app/api/routes/[routeId]/expenses/route.ts
//
// Расходы рейса (задача 7): топливо, платные дороги, ремонт, прочее.
//
// GET  — расходы рейса и их разбивка по видам (сколько ушло на топливо).
// POST — добавить расход: руками или подтверждением распознанного чека.
//
// Расход всегда привязан к рейсу своей организации; чек-фото проверяется на
// принадлежность той же организации, чтобы распознанный чек нельзя было
// «повесить» на чужой рейс.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { EXPENSE_TYPES, groupExpensesByType } from "@/lib/trips/history"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ routeId: string }> }

const EXPENSE_SELECT = {
  id: true,
  routeId: true,
  orderId: true,
  type: true,
  amount: true,
  liters: true,
  odometer: true,
  vendor: true,
  spentAt: true,
  photoId: true,
  note: true,
  source: true,
  createdAt: true,
} as const

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const { routeId } = await params

    const route = await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, { id: routeId }),
      select: { id: true },
    })
    if (!route) {
      return NextResponse.json({ success: false, error: "Рейс не найден" }, { status: 404 })
    }

    const expenses = (await prisma.routeExpense.findMany({
      where: scopedWhere(org.organizationId, { routeId }),
      orderBy: [{ spentAt: "desc" }],
      select: EXPENSE_SELECT,
    })) as { amount: number; type: string | null; liters: number | null }[]

    const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)

    return NextResponse.json({
      success: true,
      expenses,
      total,
      byType: groupExpensesByType(
        expenses.map((expense) => ({
          id: "",
          type: expense.type,
          amount: expense.amount,
          liters: expense.liters,
        })),
      ),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить расходы"
    console.error("[Route expenses] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const { routeId } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
    }

    const allowed = [
      "type",
      "amount",
      "liters",
      "odometer",
      "vendor",
      "spentAt",
      "photoId",
      "orderId",
      "note",
      "source",
    ]
    const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
    if (unknown.length > 0) {
      return NextResponse.json(
        { success: false, error: `Неизвестные поля расхода: ${unknown.join(", ")}` },
        { status: 400 },
      )
    }

    const route = await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, { id: routeId }),
      select: { id: true, driverId: true },
    })
    if (!route) {
      return NextResponse.json({ success: false, error: "Рейс не найден" }, { status: 404 })
    }

    const type = typeof body.type === "string" ? body.type.trim() : "fuel"
    if (!(EXPENSE_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        { success: false, error: `Неизвестный вид расхода: ${type}` },
        { status: 400 },
      )
    }

    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
      return NextResponse.json(
        { success: false, error: "Сумма расхода — число больше нуля" },
        { status: 400 },
      )
    }

    const liters = body.liters === undefined || body.liters === null || body.liters === ""
      ? null
      : Number(body.liters)
    if (liters !== null && (!Number.isFinite(liters) || liters < 0 || liters > 5000)) {
      return NextResponse.json({ success: false, error: "Литры указаны неверно" }, { status: 400 })
    }

    const odometer = body.odometer === undefined || body.odometer === null || body.odometer === ""
      ? null
      : Number(body.odometer)
    if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0 || odometer > 10_000_000)) {
      return NextResponse.json({ success: false, error: "Показание одометра указано неверно" }, { status: 400 })
    }

    let spentAt = new Date()
    if (typeof body.spentAt === "string" && body.spentAt) {
      const parsed = new Date(body.spentAt)
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ success: false, error: "Дата расхода указана неверно" }, { status: 400 })
      }
      spentAt = parsed
    }

    const orderId = typeof body.orderId === "string" && body.orderId ? body.orderId : null
    if (orderId) {
      const order = await prisma.order.findFirst({
        where: scopedWhere(org.organizationId, { id: orderId }),
        select: { id: true },
      })
      if (!order) {
        return NextResponse.json({ success: false, error: "Заказ не найден" }, { status: 404 })
      }
    }

    const photoId = typeof body.photoId === "string" && body.photoId ? body.photoId : null
    if (photoId) {
      const photo = await prisma.photo.findFirst({
        where: scopedWhere(org.organizationId, { id: photoId }),
        select: { id: true },
      })
      if (!photo) {
        return NextResponse.json({ success: false, error: "Фото не найдено" }, { status: 404 })
      }
    }

    const source = body.source === "ocr" ? "ocr" : "manual"

    const expense = await prisma.routeExpense.create({
      data: {
        organizationId: org.organizationId,
        routeId,
        orderId,
        type,
        amount: Math.round(amount),
        liters,
        odometer,
        vendor: typeof body.vendor === "string" ? body.vendor.slice(0, 120) : null,
        spentAt,
        photoId,
        note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
        source,
        createdById: auth.user.id,
      },
      select: EXPENSE_SELECT,
    })

    // Если в чеке был одометр, а у рейса он ещё не записан — записываем:
    // это фактический пробег, из которого считается итог рейса
    if (odometer) {
      const routeRow = (await prisma.route.findFirst({
        where: scopedWhere(org.organizationId, { id: routeId }),
        select: { startOdometer: true, endOdometer: true },
      })) as { startOdometer: number | null; endOdometer: number | null } | null

      // Первое показание становится началом, следующие — концом рейса
      const patch: Record<string, number> = {}
      if (routeRow && routeRow.startOdometer === null) patch.startOdometer = odometer
      else if (routeRow && (routeRow.endOdometer === null || odometer > routeRow.endOdometer)) {
        patch.endOdometer = odometer
      }

      if (Object.keys(patch).length > 0) {
        // org-audit: ok — рейс найден выше через scopedWhere(organizationId)
        await prisma.route.update({ where: { id: routeId }, data: patch })
      }
    }

    return NextResponse.json({ success: true, expense })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить расход"
    console.error("[Route expenses] POST error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
