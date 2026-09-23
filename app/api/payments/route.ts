// app/api/payments/route.ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaff(request)
    if (!auth.ok) return auth.response
    const org = requireOrganization(auth.value)
    if (!org.ok) return org.response

    const { searchParams } = new URL(request.url)
    const tab = searchParams.get("tab") || "all" // all | pending | deferred | overdue | paid
    const query = searchParams.get("q")?.toLowerCase()

    const now = new Date()

    // Загружаем все заказы с ценой
    const allOrders = await prisma.order.findMany({
      where: scopedWhere(org.organizationId, {
        price: { not: null },
      }),
      include: {
        driver: {
          select: { id: true, name: true, phone: true },
        },
        vehicle: {
          select: { id: true, plate: true, type: true },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    // Вычисляем показатели для дашборда оплат
    let totalPending = 0
    let totalDeferred = 0
    let totalOverdue = 0
    let totalPaid = 0

    let pendingCount = 0
    let deferredCount = 0
    let overdueCount = 0
    let paidCount = 0

    const formattedOrders = allOrders.map((o: any) => {
      const isPaid = Boolean(o.isPaid)
      const price = o.price || 0
      const isDeferred = o.paymentType === "deferred"
      const isOverdue =
        !isPaid && isDeferred && o.dueDate ? new Date(o.dueDate) < now : false

      if (isPaid) {
        totalPaid += price
        paidCount++
      } else {
        totalPending += price
        pendingCount++

        if (isDeferred) {
          totalDeferred += price
          deferredCount++
        }

        if (isOverdue) {
          totalOverdue += price
          overdueCount++
        }
      }

      return {
        id: o.id,
        routeFrom: o.routeFrom,
        routeTo: o.routeTo,
        distance: o.distance,
        cargoType: o.cargoType,
        clientName: o.clientName || "ООО «Грузоотправитель»",
        clientContact: o.clientContact,
        clientFirmId: o.clientFirmId,
        price,
        priceNegotiable: o.priceNegotiable,
        paymentType: o.paymentType || "bank_transfer",
        vatType: o.vatType || "with_vat",
        deferredDays: o.deferredDays || 0,
        dueDate: o.dueDate ? o.dueDate.toISOString() : null,
        isPaid,
        paidAt: o.paidAt ? o.paidAt.toISOString() : null,
        isOverdue,
        status: o.status,
        driver: o.driver,
        vehicle: o.vehicle,
        createdAt: o.createdAt.toISOString(),
      }
    })

    // Фильтрация по табам
    let filtered = formattedOrders
    if (tab === "pending") {
      filtered = formattedOrders.filter((o: any) => !o.isPaid)
    } else if (tab === "deferred") {
      filtered = formattedOrders.filter((o: any) => !o.isPaid && o.paymentType === "deferred"
      )
    } else if (tab === "overdue") {
      filtered = formattedOrders.filter((o: any) => o.isOverdue)
    } else if (tab === "paid") {
      filtered = formattedOrders.filter((o: any) => o.isPaid)
    }

    // Поиск по строке
    if (query) {
      filtered = filtered.filter((o: any) =>
          o.clientName.toLowerCase().includes(query) ||
          o.routeFrom.toLowerCase().includes(query) ||
          o.routeTo.toLowerCase().includes(query) ||
          o.id.toLowerCase().includes(query)
      )
    }

    return NextResponse.json({
      success: true,
      orders: filtered,
      stats: {
        totalPending,
        totalDeferred,
        totalOverdue,
        totalPaid,
        pendingCount,
        deferredCount,
        overdueCount,
        paidCount,
        totalOrders: allOrders.length,
      },
    })
  } catch (error: any) {
    console.error("[api/payments GET] Error:", error)
    return NextResponse.json(
      { success: false, error: "Ошибка получения данных по оплатам" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireStaff(request)
    if (!auth.ok) return auth.response
    const org = requireOrganization(auth.value)
    if (!org.ok) return org.response

    const body = await request.json()
    const { orderId, isPaid, paymentType, vatType, deferredDays, dueDate, price } = body

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "orderId обязателен" },
        { status: 400 }
      )
    }

    const existing = await prisma.order.findFirst({
      where: scopedWhere(org.organizationId, { id: orderId }),
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 }
      )
    }

    const updateData: Record<string, any> = {}

    if (typeof isPaid === "boolean") {
      updateData.isPaid = isPaid
      updateData.paidAt = isPaid ? new Date() : null
    }

    if (paymentType) updateData.paymentType = paymentType
    if (vatType) updateData.vatType = vatType
    if (typeof deferredDays === "number") {
      updateData.deferredDays = deferredDays
      // Рассчитаем dueDate, если отсрочка задана
      if (deferredDays > 0) {
        const due = new Date(existing.createdAt)
        due.setDate(due.getDate() + deferredDays)
        updateData.dueDate = due
      }
    }
    if (dueDate) updateData.dueDate = new Date(dueDate)
    if (typeof price === "number") updateData.price = price

    // org-audit: ok — заказ найден выше внутри организации вызывающего
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
    })

    return NextResponse.json({
      success: true,
      order: updated,
    })
  } catch (error: any) {
    console.error("[api/payments PATCH] Error:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось обновить платежные данные" },
      { status: 500 }
    )
  }
}

// Отправка напоминания клиенту
export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaff(request)
    if (!auth.ok) return auth.response
    const org = requireOrganization(auth.value)
    if (!org.ok) return org.response

    const body = await request.json()
    const { orderId } = body

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "orderId обязателен" },
        { status: 400 }
      )
    }

    const order = await prisma.order.findFirst({
      where: scopedWhere(org.organizationId, { id: orderId }),
    })

    if (!order) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 }
      )
    }

    // Формируем текст уведомления
    const message = `Уведомление об оплате по заказу #${order.id} (${order.routeFrom} → ${order.routeTo}) на сумму ${order.price?.toLocaleString("ru-RU")} ₽ направлено контрагенту ${order.clientName || "Клиент"} (${order.clientContact}).`

    return NextResponse.json({
      success: true,
      message,
      contact: order.clientContact,
      clientName: order.clientName,
      sentAt: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error("[api/payments POST] Error:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось сформировать напоминание" },
      { status: 500 }
    )
  }
}
