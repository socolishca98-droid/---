// app/api/m/expenses/[expenseId]/route.ts
//
// DELETE /api/m/expenses/[expenseId] — водитель удаляет расход СВОЕГО рейса.
//
// Водитель записывает топливо сам (POST /api/m/expenses), значит должен уметь
// и исправить ошибку: ошиблись суммой или продублировали чек — удаляют на
// месте, не дожидаясь логиста. Границы те же: расход своей организации и
// именно того рейса, который сейчас за водителем. Чужой идентификатор даёт
// 404 — по ответу нельзя понять, существует ли такая запись у соседей.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { refreshRouteCosts } from "@/lib/routes/service"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ expenseId: string }> }

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {
    const { expenseId } = await params

    const expense = await prisma.routeExpense.findFirst({
      where: scopedWhere(org.organizationId, { id: expenseId }),
      select: { id: true, routeId: true },
    })

    if (!expense) {
      return NextResponse.json({ success: false, error: "Расход не найден" }, { status: 404 })
    }

    // Рейс должен быть рейсом этого водителя — чужие расходы не трогаем
    const ownRoute = await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, { id: expense.routeId, driverId }),
      select: { id: true },
    })

    if (!ownRoute) {
      return NextResponse.json({ success: false, error: "Расход не найден" }, { status: 404 })
    }

    // org-audit: ok — рейс проверен выше через scopedWhere(organizationId)
    await prisma.routeExpense.delete({ where: { id: expenseId } })

    // Удалили расход — деньги рейса пересчитываем
    await refreshRouteCosts(prisma, expense.routeId, org.organizationId)

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось удалить расход"
    console.error("[Mobile Expenses] DELETE error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
