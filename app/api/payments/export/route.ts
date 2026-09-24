// app/api/payments/export/route.ts
//
// Выгрузка оплат для бухгалтерии (задача 6).
//
// GET /api/payments/export?tab=pending&from=2026-09-01&to=2026-09-30&clientId=…
//
// Отдаётся CSV с разделителем «;», датами ДД.ММ.ГГГГ и BOM в начале — Excel
// открывает такой файл сразу, без «импорта данных» и настройки кодировки.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import {
  buildAccountingCsv,
  buildPaymentRow,
  buildPaymentsSummary,
  isOverdueRow,
  type PaymentRow,
} from "@/lib/payments/summary"

export const dynamic = "force-dynamic"

const TABS = ["all", "pending", "deferred", "overdue", "paid"] as const
type Tab = (typeof TABS)[number]

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaff(request)
    if (!auth.ok) return auth.response
    const org = requireOrganization(auth.value)
    if (!org.ok) return org.response

    const { searchParams } = new URL(request.url)
    const tabParam = (searchParams.get("tab") || "all") as Tab
    const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? tabParam : "all"
    const clientId = searchParams.get("clientId")
    const from = searchParams.get("from")
    const to = searchParams.get("to")

    const createdAt: Record<string, Date> = {}
    if (from && !Number.isNaN(new Date(from).getTime())) createdAt.gte = new Date(from)
    if (to && !Number.isNaN(new Date(to).getTime())) createdAt.lte = new Date(`${to}T23:59:59`)

    const orders = (await prisma.order.findMany({
      where: scopedWhere(org.organizationId, {
        ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      }),
      select: {
        id: true,
        clientId: true,
        clientName: true,
        clientContact: true,
        routeFrom: true,
        routeTo: true,
        distance: true,
        cargoType: true,
        status: true,
        createdAt: true,
        deadline: true,
        completedAt: true,
        price: true,
        agreedPrice: true,
        paymentType: true,
        vatType: true,
        deferredDays: true,
        dueDate: true,
        isPaid: true,
        paidAt: true,
        client: { select: { id: true, name: true, inn: true } },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    })) as Parameters<typeof buildPaymentRow>[0][]

    const now = new Date()
    let rows: PaymentRow[] = orders
      .map((order) => buildPaymentRow(order, now))
      .filter((row) => row.amount > 0)

    if (tab === "pending") rows = rows.filter((row) => !row.isPaid)
    else if (tab === "deferred") rows = rows.filter((row) => !row.isPaid && row.isDeferred)
    else if (tab === "overdue") rows = rows.filter((row) => isOverdueRow(row))
    else if (tab === "paid") rows = rows.filter((row) => row.isPaid)

    if (clientId) rows = rows.filter((row) => row.clientId === clientId)

    const csv = buildAccountingCsv(rows)
    const summary = buildPaymentsSummary(rows)
    const stamp = new Date().toISOString().slice(0, 10)

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payments-${tab}-${stamp}.csv"`,
        // сводка рядом с файлом: бухгалтеру видно, что выгружено
        "X-Payments-Count": String(rows.length),
        "X-Payments-Pending": String(summary.totalPending),
        "X-Payments-Overdue": String(summary.totalOverdue),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось выгрузить оплаты"
    console.error("[api/payments/export] Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
