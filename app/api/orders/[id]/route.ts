// app/api/orders/[id]/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  CLOSED_ORDER_STATUSES,
  ORDER_STATUSES,
  allowedOrderStatuses,
  canChangeOrderStatus,
  isNegotiationStatus,
  isOrderClosed,
  normalizeOrderStatus,
  orderStatusLabel,
  statusFromNegotiation,
  type OrderStatus,
} from "@/lib/orders/stages"

/**
 * Поля заказа, которые разрешено менять через PATCH /api/orders/[id].
 *
 * Список явный: раньше тело запроса раскладывалось как `...other` и целиком
 * попадало в `order.update({ data })`. Так вместе с нужными полями можно было
 * прислать `organizationId` и перенести свой заказ в чужую организацию
 * (массовое присваивание). Всё, чего нет в списке, — 400 с понятным текстом.
 */
const EDITABLE_ORDER_FIELDS = [
  "source",
  "sourceId",
  "routeFrom",
  "routeTo",
  "distance",
  "weight",
  "volume",
  "cargoType",
  "loadingType",
  "requirements",
  "price",
  "priceNegotiable",
  "clientName",
  "clientContact",
  "clientFirmId",
  "deadline",
  "priority",
  "aiScore",
  "aiReason",
  "routeId",
  "routeSequence",
  "isAdditionalLoad",
  "addedToRouteAt",
  "proposedToDriver",
  "proposedAt",
  "acceptedAt",
  "rejectedAt",
  "rejectionReason",
  // ── процесс заказа (Задача 2) ──
  "agreedPrice",
  "negotiationStatus",
  "nextFollowUpAt",
] as const

/**
 * Поля, которые через этот эндпоинт не меняются никогда: служебные
 * (id, организация, метки времени) и платёжные — у них свой роут /api/payments.
 */
const FORBIDDEN_ORDER_FIELDS = [
  "id",
  "organizationId",
  "createdAt",
  "updatedAt",
  "isPaid",
  "paidAt",
  "dueDate",
  "paymentType",
  "vatType",
  "deferredDays",
] as const

type RouteParams = {
  params: Promise<{ id: string }>
}

// GET /api/orders/[id]
export async function GET(_request: NextRequest,
  { params }: RouteParams) {
  const __auth = await requireStaffAuth(_request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Order ID is required" },
        { status: 400 }
      )
    }

    // чужой заказ не отличим от несуществующего: ищем внутри своей организации
    const order = await prisma.order.findFirst({
      where: scopedWhere(__org.organizationId, { id }),
    })

    if (!order) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, order })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order GET error"
    console.error("[Order API] GET Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// PATCH /api/orders/[id]
export async function PATCH(request: NextRequest,
  { params }: RouteParams) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Order ID is required" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { status, assignedDriverId, assignedVehicleId, ...other } = body as {
      status?: string
      assignedDriverId?: string | null
      assignedVehicleId?: string | null
      [key: string]: unknown
    }

    const forbiddenFields = Object.keys(other).filter((key) =>
      (FORBIDDEN_ORDER_FIELDS as readonly string[]).includes(key),
    )
    if (forbiddenFields.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Эти поля нельзя менять через /api/orders: ${forbiddenFields.join(", ")}. Платёжные данные меняются в /api/payments`,
        },
        { status: 400 }
      )
    }

    const unknownFields = Object.keys(other).filter(
      (key) => !(EDITABLE_ORDER_FIELDS as readonly string[]).includes(key),
    )
    if (unknownFields.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Неизвестные поля заказа: ${unknownFields.join(", ")}`,
        },
        { status: 400 }
      )
    }

    const otherFields = other as Record<string, unknown>

    // Поля процесса приходят из JSON строками — приводим к типам схемы.
    // Делаем это до сравнения с прежними значениями, иначе автозапись в ленту
    // согласования не заметит изменение.
    if ("nextFollowUpAt" in otherFields) {
      const value = otherFields.nextFollowUpAt
      if (value === null || value === "") {
        otherFields.nextFollowUpAt = null
      } else if (typeof value === "string" || value instanceof Date) {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) {
          return NextResponse.json(
            { success: false, error: "Неверная дата напоминания (nextFollowUpAt)" },
            { status: 400 },
          )
        }
        otherFields.nextFollowUpAt = date
      } else {
        return NextResponse.json(
          { success: false, error: "Неверная дата напоминания (nextFollowUpAt)" },
          { status: 400 },
        )
      }
    }
    if ("agreedPrice" in otherFields) {
      const value = otherFields.agreedPrice
      if (value === null || value === "") {
        otherFields.agreedPrice = null
      } else {
        const parsed = Number(value)
        if (!Number.isFinite(parsed) || parsed < 0) {
          return NextResponse.json(
            { success: false, error: "Согласованная цена должна быть числом не меньше нуля" },
            { status: 400 },
          )
        }
        otherFields.agreedPrice = Math.round(parsed)
      }
    }

    // Рейс из тела запроса проверяем на принадлежность организации:
    // иначе заказ своей организации оказался бы привязан к чужому рейсу
    const nextRouteId = otherFields.routeId
    if (typeof nextRouteId === "string" && nextRouteId) {
      const ownRoute = await prisma.route.findFirst({
        where: scopedWhere(__org.organizationId, { id: nextRouteId }),
        select: { id: true },
      })
      if (!ownRoute) {
        return NextResponse.json(
          { success: false, error: "Рейс не найден" },
          { status: 404 }
        )
      }
    }

    const existing = await prisma.order.findFirst({
      where: scopedWhere(__org.organizationId, { id }),
      select: {
        id: true,
        status: true,
        price: true,
        agreedPrice: true,
        negotiationStatus: true,
        assignedDriverId: true,
        assignedVehicleId: true,
      },
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 }
      )
    }

    // Назначить заказу можно только своего водителя и свою машину
    if (assignedDriverId) {
      const driver = await prisma.driver.findFirst({
        where: scopedWhere(__org.organizationId, { id: assignedDriverId }),
        select: { id: true },
      })
      if (!driver) {
        return NextResponse.json(
          { success: false, error: "Водитель не найден" },
          { status: 404 }
        )
      }
    }
    if (assignedVehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: scopedWhere(__org.organizationId, { id: assignedVehicleId }),
        select: { id: true },
      })
      if (!vehicle) {
        return NextResponse.json(
          { success: false, error: "Машина не найдена" },
          { status: 404 }
        )
      }
    }

    // ── Статус: только канонические значения и только разрешённые переходы ──
    // Единый источник правды — lib/orders/stages.ts. Прежние значения («new»,
    // «confirmed», «in_transit», «loading», …) принимаются и приводятся к канону,
    // поэтому старые клиенты и старые строки в базе не ломаются.
    let nextStatus: OrderStatus | undefined
    if (status !== undefined && status !== null && status !== "") {
      const normalized = normalizeOrderStatus(status)
      if (!normalized) {
        return NextResponse.json(
          {
            success: false,
            error: `Неизвестный статус заказа: ${status}. Допустимо: ${ORDER_STATUSES.join(", ")}`,
          },
          { status: 400 }
        )
      }
      if (!canChangeOrderStatus(existing.status, normalized)) {
        return NextResponse.json(
          {
            success: false,
            error: `Переход «${orderStatusLabel(existing.status)}» → «${orderStatusLabel(normalized)}» невозможен. Допустимо: ${
              allowedOrderStatuses(existing.status).map(orderStatusLabel).join(", ") || "никаких"
            }`,
            code: "invalid_status_transition",
            allowed: allowedOrderStatuses(existing.status),
          },
          { status: 400 }
        )
      }
      nextStatus = normalized
    }

    // Итог переговоров переводит заказ сам, если статус не меняли вручную:
    // «договорились» → согласован, «не договорились» → отклонён.
    const negotiationStatus =
      typeof otherFields.negotiationStatus === "string" ? otherFields.negotiationStatus : undefined
    if (negotiationStatus !== undefined && !isNegotiationStatus(negotiationStatus)) {
      return NextResponse.json(
        { success: false, error: "Неизвестное состояние переговоров (negotiationStatus)" },
        { status: 400 }
      )
    }
    if (!nextStatus && negotiationStatus) {
      const derived = statusFromNegotiation(negotiationStatus)
      if (derived && canChangeOrderStatus(existing.status, derived)) nextStatus = derived
    }

    // Заказ занимает водителя и машину, пока он не закрыт
    const wasActive = !isOrderClosed(existing.status)
    const willBeActive = nextStatus ? !isOrderClosed(nextStatus) : wasActive
    const isCompleting = Boolean(nextStatus && isOrderClosed(nextStatus))

    const updatedOrder = await prisma.$transaction(async (tx: any) => {
      // org-audit: ok — id заказа проверен на принадлежность организации выше
      const order = await tx.order.update({
        where: { id },
        data: {
          ...(nextStatus && { status: nextStatus }),
          // Доставка запоминается временем: от него считается отсрочка платежа
          ...(nextStatus === "delivered" && { deliveredAt: new Date() }),
          ...(assignedDriverId !== undefined && { assignedDriverId }),
          ...(assignedVehicleId !== undefined && { assignedVehicleId }),
          ...otherFields,
        },
      })

      // История согласования пишется автоматически: смена цены и смена статуса
      // всегда попадают в ленту, даже если логист не добавил заметку руками.
      const actorName = __auth.user?.name ?? __auth.user?.email ?? null
      const feed: { kind: string; text: string; priceOffer: number | null }[] = []

      if (typeof otherFields.price === "number" && otherFields.price !== existing.price) {
        feed.push({
          kind: "price_change",
          text: `Цена: ${existing.price ?? 0} → ${otherFields.price}`,
          priceOffer: otherFields.price,
        })
      }
      if (
        typeof otherFields.agreedPrice === "number" &&
        otherFields.agreedPrice !== existing.agreedPrice
      ) {
        feed.push({
          kind: "price_change",
          text: `Согласованная цена: ${existing.agreedPrice ?? "не задана"} → ${otherFields.agreedPrice}`,
          priceOffer: otherFields.agreedPrice,
        })
      }
      if (nextStatus && normalizeOrderStatus(existing.status) !== nextStatus) {
        feed.push({
          kind: "status_change",
          text: `Статус: ${orderStatusLabel(existing.status)} → ${orderStatusLabel(nextStatus)}`,
          priceOffer: null,
        })
      }
      for (const entry of feed) {
        await tx.orderNegotiation.create({
          data: {
            organizationId: __org.organizationId,
            orderId: order.id,
            kind: entry.kind,
            text: entry.text,
            priceOffer: entry.priceOffer,
            authorId: __org.userId,
            authorName: actorName,
          },
        })
      }

      const driverId = order.assignedDriverId
      const vehicleId = order.assignedVehicleId

      // Если заказ переходит из активного в неактивный – освобождаем ресурсы
      if (wasActive && isCompleting) {
        if (driverId) {
          const otherActive = await tx.order.count({
            where: scopedWhere(__org.organizationId, {
              assignedDriverId: driverId,
              status: { notIn: [...CLOSED_ORDER_STATUSES] },
              id: { not: order.id },
            }),
          })
          if (otherActive === 0) {
            await tx.driver.updateMany({
              where: scopedWhere(__org.organizationId, { id: driverId }),
              data: { status: "available" },
            })
          }
        }

        if (vehicleId) {
          const otherActive = await tx.order.count({
            where: scopedWhere(__org.organizationId, {
              assignedVehicleId: vehicleId,
              status: { notIn: [...CLOSED_ORDER_STATUSES] },
              id: { not: order.id },
            }),
          })
          if (otherActive === 0) {
            await tx.vehicle.updateMany({
              where: scopedWhere(__org.organizationId, { id: vehicleId }),
              data: { status: "available" },
            })
          }
        }
      }

      // Если заказ стал активным – проставляем busy/in_use
      if (!wasActive && willBeActive) {
        if (driverId) {
          await tx.driver.updateMany({
            where: scopedWhere(__org.organizationId, { id: driverId }),
            data: { status: "busy" },
          })
        }
        if (vehicleId) {
          await tx.vehicle.updateMany({
            where: scopedWhere(__org.organizationId, { id: vehicleId }),
            data: { status: "in_use" },
          })
        }
      }

      return order
    })

    return NextResponse.json({ success: true, order: updatedOrder })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order PATCH error"
    console.error("[Order API] PATCH Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// DELETE /api/orders/[id]
export async function DELETE(_request: NextRequest,
  { params }: RouteParams) {
  const __auth = await requireStaffAuth(_request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Order ID is required" },
        { status: 400 }
      )
    }

    const existing = await prisma.order.findFirst({
      where: scopedWhere(__org.organizationId, { id }),
      select: {
        id: true,
        status: true,
        assignedDriverId: true,
        assignedVehicleId: true,
      },
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 }
      )
    }

    // Заказ занимал водителя/машину, пока не был закрыт (канон — lib/orders/stages.ts)
    const wasActive = !isOrderClosed(existing.status)

    await prisma.$transaction(async (tx: any) => {
      // deleteMany с фильтром организации: чужой заказ удалить нельзя
      await tx.order.deleteMany({ where: scopedWhere(__org.organizationId, { id }) })

      if (wasActive) {
        if (existing.assignedDriverId) {
          const otherActive = await tx.order.count({
            where: scopedWhere(__org.organizationId, {
              assignedDriverId: existing.assignedDriverId,
              status: { notIn: [...CLOSED_ORDER_STATUSES] },
            }),
          })
          if (otherActive === 0) {
            await tx.driver.updateMany({
              where: scopedWhere(__org.organizationId, { id: existing.assignedDriverId }),
              data: { status: "available" },
            })
          }
        }

        if (existing.assignedVehicleId) {
          const otherActive = await tx.order.count({
            where: scopedWhere(__org.organizationId, {
              assignedVehicleId: existing.assignedVehicleId,
              status: { notIn: [...CLOSED_ORDER_STATUSES] },
            }),
          })
          if (otherActive === 0) {
            await tx.vehicle.updateMany({
              where: scopedWhere(__org.organizationId, { id: existing.assignedVehicleId }),
              data: { status: "available" },
            })
          }
        }
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order DELETE error"
    console.error("[Order API] DELETE Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}