// app/api/payments/route.ts
//
// Оплаты по заказам (задача 6). Отдельной модели «платёж» нет: оплата — это
// состояние заказа (isPaid / paidAt / dueDate / deferredDays / paymentType).
//
// GET   — список оплат со статистикой и должниками по клиентам.
// PATCH — отметить оплату, снять отметку, поправить форму оплаты, НДС, отсрочку.
// POST  — напоминание о просрочке: создаёт настоящие уведомления логистам
//         (Notification), а не просто текст в ответе. Напоминание по одному
//         заказу или по всем просроченным сразу; повтор в тот же день не плодится.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import {
  buildDebtors,
  buildPaymentsSummary,
  buildPaymentRow,
  isOverdueRow,
  normalizePaymentType,
  overdueReminderText,
  type PaymentRow,
  type ReminderInfo,
} from "@/lib/payments/summary"

export const dynamic = "force-dynamic"

const TABS = ["all", "pending", "deferred", "overdue", "paid"] as const
type Tab = (typeof TABS)[number]

const REMINDER_TYPE = "payment_overdue"

const ORDER_SELECT = {
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
} as const

type OrderRow = Parameters<typeof buildPaymentRow>[0]

/**
 * Напоминания, уже отправленные по заказам.
 *
 * Читаются из уведомлений (тип payment_overdue), поэтому «напомнили 2 раза,
 * последний — 24.09» видно в списке, а не только в момент отправки.
 */
async function loadReminders(
  organizationId: string | null,
): Promise<Map<string, ReminderInfo>> {
  const notifications = (await prisma.notification.findMany({
    where: scopedWhere(organizationId, { type: REMINDER_TYPE }),
    select: { orderId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  })) as { orderId: string | null; createdAt: Date }[]

  const map = new Map<string, ReminderInfo>()

  for (const notification of notifications) {
    if (!notification.orderId) continue
    const current = map.get(notification.orderId)
    if (!current) {
      map.set(notification.orderId, { lastAt: notification.createdAt, count: 1 })
      continue
    }
    current.count += 1
    if (notification.createdAt > (current.lastAt ?? new Date(0))) {
      current.lastAt = notification.createdAt
    }
  }

  return map
}

function applyTab(rows: PaymentRow[], tab: Tab): PaymentRow[] {
  switch (tab) {
    case "pending":
      return rows.filter((row) => !row.isPaid)
    case "deferred":
      return rows.filter((row) => !row.isPaid && row.isDeferred)
    case "overdue":
      return rows.filter((row) => isOverdueRow(row))
    case "paid":
      return rows.filter((row) => row.isPaid)
    default:
      return rows
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaff(request)
    if (!auth.ok) return auth.response
    const org = requireOrganization(auth.value)
    if (!org.ok) return org.response

    const { searchParams } = new URL(request.url)
    const tabParam = (searchParams.get("tab") || "all") as Tab
    const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? tabParam : "all"
    const query = searchParams.get("q")?.trim().toLowerCase() ?? ""
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
      select: ORDER_SELECT,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    })) as OrderRow[]

    const now = new Date()
    const reminders = await loadReminders(org.organizationId)

    // Заказ с нулевой суммой в оплатах смысла не имеет: выставлять нечего.
    const allRows = orders
      .map((order) => buildPaymentRow(order, now, reminders.get(order.id)))
      .filter((row) => row.amount > 0)

    let filtered = applyTab(allRows, tab)

    if (query) {
      filtered = filtered.filter((row) =>
        [row.clientName, row.routeFrom, row.routeTo, row.id, row.inn ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    }

    if (clientId) filtered = filtered.filter((row) => row.clientId === clientId)

    return NextResponse.json({
      success: true,
      orders: filtered,
      stats: buildPaymentsSummary(allRows),
      debtors: buildDebtors(allRows),
      tab,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка получения данных по оплатам"
    console.error("[api/payments GET] Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/** Поля заказа, которые можно править из оплат. */
const EDITABLE_FIELDS = [
  "isPaid",
  "paymentType",
  "vatType",
  "deferredDays",
  "dueDate",
  "price",
  "agreedPrice",
] as const

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireStaff(request)
    if (!auth.ok) return auth.response
    const org = requireOrganization(auth.value)
    if (!org.ok) return org.response

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
    }

    const orderId = typeof body.orderId === "string" ? body.orderId : null
    if (!orderId) {
      return NextResponse.json({ success: false, error: "orderId обязателен" }, { status: 400 })
    }

    const unknown = Object.keys(body).filter(
      (key) => key !== "orderId" && !(EDITABLE_FIELDS as readonly string[]).includes(key),
    )
    if (unknown.length > 0) {
      return NextResponse.json(
        { success: false, error: `Неизвестные поля оплаты: ${unknown.join(", ")}` },
        { status: 400 },
      )
    }

    const existing = (await prisma.order.findFirst({
      where: scopedWhere(org.organizationId, { id: orderId }),
      select: { id: true, createdAt: true, price: true, agreedPrice: true },
    })) as { id: string; createdAt: Date; price: number | null; agreedPrice: number | null } | null

    if (!existing) {
      return NextResponse.json({ success: false, error: "Заказ не найден" }, { status: 404 })
    }

    const data: Record<string, unknown> = {}

    if (typeof body.isPaid === "boolean") {
      data.isPaid = body.isPaid
      data.paidAt = body.isPaid ? new Date() : null
    }

    if ("paymentType" in body) {
      const raw = body.paymentType
      if (raw === null || raw === "") data.paymentType = null
      else if (typeof raw === "string") data.paymentType = normalizePaymentType(raw) ?? raw.trim()
      else {
        return NextResponse.json({ success: false, error: "Форма оплаты указана неверно" }, { status: 400 })
      }
    }

    if ("vatType" in body) {
      const raw = body.vatType
      data.vatType = raw === null || raw === "" ? null : typeof raw === "string" ? raw.trim() : null
    }

    if ("price" in body) {
      const price = Number(body.price)
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ success: false, error: "Сумма заказа указана неверно" }, { status: 400 })
      }
      data.price = Math.round(price)
    }

    if ("agreedPrice" in body) {
      if (body.agreedPrice === null || body.agreedPrice === "") data.agreedPrice = null
      else {
        const agreed = Number(body.agreedPrice)
        if (!Number.isFinite(agreed) || agreed < 0) {
          return NextResponse.json(
            { success: false, error: "Согласованная сумма указана неверно" },
            { status: 400 },
          )
        }
        data.agreedPrice = Math.round(agreed)
      }
    }

    if ("deferredDays" in body) {
      if (body.deferredDays === null || body.deferredDays === "") {
        data.deferredDays = null
        if (!("dueDate" in body)) data.dueDate = null
      } else {
        const days = Number(body.deferredDays)
        if (!Number.isInteger(days) || days < 0 || days > 365) {
          return NextResponse.json(
            { success: false, error: "Отсрочка — целое число дней от 0 до 365" },
            { status: 400 },
          )
        }
        data.deferredDays = days
        // срок оплаты пересчитываем от даты заказа: так его и понимает
        // бухгалтерия, когда отсрочка меняется задним числом
        if (!("dueDate" in body)) {
          const due = new Date(existing.createdAt)
          due.setDate(due.getDate() + days)
          data.dueDate = days > 0 ? due : null
        }
      }
    }

    if ("dueDate" in body) {
      if (body.dueDate === null || body.dueDate === "") data.dueDate = null
      else {
        const due = new Date(String(body.dueDate))
        if (Number.isNaN(due.getTime())) {
          return NextResponse.json({ success: false, error: "Срок оплаты указан неверно" }, { status: 400 })
        }
        data.dueDate = due
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: false, error: "Нечего сохранять" }, { status: 400 })
    }

    // org-audit: ok — заказ найден выше через scopedWhere(organizationId)
    const updated = await prisma.order.update({
      where: { id: orderId },
      data,
      select: ORDER_SELECT,
    })

    const reminders = await loadReminders(org.organizationId)
    const row = buildPaymentRow(updated as OrderRow, new Date(), reminders.get(orderId))

    return NextResponse.json({ success: true, order: row })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обновить оплату"
    console.error("[api/payments PATCH] Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/** Сколько заказов упомянуто в напоминании: один или все просроченные. */
type ReminderResult = {
  created: number
  skipped: number
  orders: { orderId: string; clientName: string; amount: number; overdueDays: number }[]
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaff(request)
    if (!auth.ok) return auth.response
    const org = requireOrganization(auth.value)
    if (!org.ok) return org.response

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const orderId = typeof body?.orderId === "string" ? body.orderId : null
    const allOverdue = body?.allOverdue === true

    if (!orderId && !allOverdue) {
      return NextResponse.json(
        { success: false, error: "Укажите orderId или allOverdue: true" },
        { status: 400 },
      )
    }

    const now = new Date()

    const orders = (await prisma.order.findMany({
      where: scopedWhere(org.organizationId, orderId ? { id: orderId } : { isPaid: false }),
      select: ORDER_SELECT,
    })) as OrderRow[]

    if (orderId && orders.length === 0) {
      return NextResponse.json({ success: false, error: "Заказ не найден" }, { status: 404 })
    }

    const reminders = await loadReminders(org.organizationId)
    const overdueRows = orders
      .map((order) => buildPaymentRow(order, now, reminders.get(order.id)))
      .filter((row) => isOverdueRow(row))

    if (overdueRows.length === 0) {
      return NextResponse.json({
        success: true,
        created: 0,
        skipped: 0,
        orders: [],
        message: "Просроченных оплат нет — напоминать не о чем",
      })
    }

    const result: ReminderResult = { created: 0, skipped: 0, orders: [] }

    for (const row of overdueRows) {
      // Повтор в тот же день не нужен: логист уже видел это напоминание.
      const lastAt = row.remindedAt
      const remindedToday =
        lastAt !== null && lastAt.toDateString() === now.toDateString()

      if (remindedToday) {
        result.skipped += 1
        continue
      }

      const { title, message } = overdueReminderText(row)

      await prisma.notification.create({
        data: {
          organizationId: org.organizationId,
          // напоминание для всех логистов и админов организации — так же,
          // как это делает SOS от водителя
          userId: "all_logists",
          userRole: "logist",
          type: REMINDER_TYPE,
          title,
          message,
          orderId: row.id,
          priority: row.overdueDays >= 7 ? "high" : "normal",
        },
      })

      result.created += 1
      result.orders.push({
        orderId: row.id,
        clientName: row.clientName,
        amount: row.amount,
        overdueDays: row.overdueDays,
      })
    }

    const total = result.orders.reduce((sum, item) => sum + item.amount, 0)

    return NextResponse.json({
      success: true,
      ...result,
      totalAmount: total,
      message:
        result.created > 0
          ? `Напоминаний отправлено: ${result.created} на сумму ${total.toLocaleString("ru-RU")} ₽`
          : "Сегодня по этим заказам уже напоминали",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить напоминание"
    console.error("[api/payments POST] Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
