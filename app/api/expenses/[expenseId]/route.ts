// app/api/expenses/[expenseId]/route.ts
//
// Удаление расхода рейса (задача 7).
//
// Удаляем только расход своей организации и из своей базы: чужой идентификатор
// не должен «снести» запись соседей. Чек-фото при этом остаётся — оно часть
// истории рейса, даже если расход отменили.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ expenseId: string }> }

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const { expenseId } = await params

    const expense = await prisma.routeExpense.findFirst({
      where: scopedWhere(org.organizationId, { id: expenseId }),
      select: { id: true, routeId: true },
    })

    if (!expense) {
      return NextResponse.json({ success: false, error: "Расход не найден" }, { status: 404 })
    }

    // org-audit: ok — расход найден выше через scopedWhere(organizationId)
    await prisma.routeExpense.delete({ where: { id: expenseId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось удалить расход"
    console.error("[Expenses] DELETE error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
