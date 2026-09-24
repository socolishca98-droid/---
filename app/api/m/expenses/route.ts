// app/api/m/expenses/route.ts
//
// Расходы рейса глазами водителя (задача 7).
//
// GET  — расходы текущего рейса водителя и его итог.
// POST — записать расход: топливо по чеку (после распознавания) или вручную.
//
// Рейс и водитель берутся из сессии — водитель не может записать расход
// в чужой рейс, даже если подставит чужой идентификатор.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { logRouteEvent } from "@/lib/routes/service"
import { EXPENSE_TYPES, buildTripSummary, groupExpensesByType } from "@/lib/trips/history"

export const dynamic = "force-dynamic"

const CLOSED_ROUTE_STATUSES = ["completed", "cancelled"]

export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {
    const route = (await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, {
        driverId,
        status: { notIn: CLOSED_ROUTE_STATUSES },
      }),
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        totalDistance: true,
        startOdometer: true,
        endOdometer: true,
      },
    })) as Record<string, any> | null

    if (!route) {
      return NextResponse.json({ success: true, route: null, expenses: [], byType: [], total: 0 })
    }

    const [expenses, orders] = await Promise.all([
      prisma.routeExpense.findMany({
        where: scopedWhere(org.organizationId, { routeId: route.id }),
        orderBy: [{ spentAt: "desc" }],
        select: {
          id: true,
          type: true,
          amount: true,
          liters: true,
          odometer: true,
          vendor: true,
          spentAt: true,
          source: true,
          photoId: true,
          note: true,
        },
      }),
      prisma.order.findMany({
        where: scopedWhere(org.organizationId, { routeId: route.id }),
        select: { id: true, status: true, price: true, agreedPrice: true, distance: true },
      }),
    ])

    const expenseRows = expenses as {
      amount: number
      type: string | null
      liters: number | null
    }[]

    return NextResponse.json({
      success: true,
      route: { id: route.id, name: route.name, status: route.status },
      expenses,
      byType: groupExpensesByType(
        expenseRows.map((row) => ({ id: "", type: row.type, amount: row.amount, liters: row.liters })),
      ),
      total: expenseRows.reduce((sum, row) => sum + row.amount, 0),
      summary: buildTripSummary({
        route: route as any,
        orders: orders as any[],
        expenses: expenseRows as any[],
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить расходы"
    console.error("[Mobile expenses] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
    }

    const route = (await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, {
        driverId,
        status: { notIn: CLOSED_ROUTE_STATUSES },
      }),
      orderBy: [{ createdAt: "desc" }],
      select: { id: true },
    })) as { id: string } | null

    if (!route) {
      return NextResponse.json(
        { success: false, error: "Нет активного рейса — расход записывать некуда" },
        { status: 409 },
      )
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

    const liters =
      body.liters === undefined || body.liters === null || body.liters === ""
        ? null
        : Number(body.liters)

    const photoId = typeof body.photoId === "string" && body.photoId ? body.photoId : null
    if (photoId) {
      // Фото должно быть своим: чужой чек не прикладываем
      const photo = await prisma.photo.findFirst({
        where: scopedWhere(org.organizationId, { id: photoId, driverId }),
        select: { id: true },
      })
      if (!photo) {
        return NextResponse.json({ success: false, error: "Фото не найдено" }, { status: 404 })
      }
    }

    const expense = await prisma.routeExpense.create({
      data: {
        organizationId: org.organizationId,
        routeId: route.id,
        type,
        amount: Math.round(amount),
        liters: liters !== null && Number.isFinite(liters) ? liters : null,
        odometer:
          typeof body.odometer === "number" && Number.isInteger(body.odometer) && body.odometer > 0
            ? body.odometer
            : null,
        vendor: typeof body.vendor === "string" ? body.vendor.slice(0, 120) : null,
        spentAt: new Date(),
        photoId,
        note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
        source: body.source === "ocr" ? "ocr" : "manual",
        createdById: auth.value.userId,
      },
      select: {
        id: true,
        type: true,
        amount: true,
        liters: true,
        odometer: true,
        vendor: true,
        spentAt: true,
      },
    })

    await logRouteEvent(prisma, {
      organizationId: org.organizationId,
      routeId: route.id,
      driverId,
      type: "expense",
      data: JSON.stringify({ expenseId: expense.id, expenseType: type, amount: expense.amount }),
    })

    return NextResponse.json({ success: true, expense })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось записать расход"
    console.error("[Mobile expenses] POST error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
