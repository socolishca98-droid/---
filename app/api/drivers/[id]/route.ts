// app/api/drivers/[id]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  forbidden,
  isSelfOrStaff,
  requireAnySession,
  requireStaff,
  revokeAllSessions,
} from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { friendlyDbError, friendlyDbErrorStatus } from "@/lib/db/errors"
import { normalizePhone } from "@/lib/auth/constants"
import { linkDriverToVehicle } from "@/lib/fleet/assignment"
import { parseDateValue } from "@/lib/dates"
import { OCCUPYING_ORDER_STATUSES } from "@/lib/orders/stages"
// ✅ Добавлен 'offline' в список разрешённых статусов
const ALLOWED_DRIVER_STATUSES = ["available", "busy", "maintenance", "offline"] as const
type DriverStatus = typeof ALLOWED_DRIVER_STATUSES[number]

type RouteParams = {
  params: Promise<{ id: string }>
}

// GET /api/drivers/[id]
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Не указан водитель" },
        { status: 400 }
      )
    }

    // Водитель читает только свою карточку
    if (!isSelfOrStaff(auth.value, id)) {
      return forbidden("Недостаточно прав для просмотра этой карточки водителя")
    }

    const driver = await prisma.driver.findFirst({
      where: scopedWhere(org.organizationId, { id }),
    })

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Водитель не найден" },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, driver })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить водителя"
    console.error("[Driver] GET Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// PATCH /api/drivers/[id]
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Не указан водитель" },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const {
      name,
      phone,
      status,
      vehicleId,
      licenseNumber,
      licenseExpiry,
      medicalExpiry,
      currentLocation,
      latitude,
      longitude,
    } = body as {
      name?: string
      phone?: string
      status?: string
      vehicleId?: string | null
      licenseNumber?: string | null
      licenseExpiry?: string | null
      medicalExpiry?: string | null
      currentLocation?: string | null
      latitude?: number
      longitude?: number
    }

    const data: Record<string, unknown> = {}

    if (name !== undefined) data.name = name
    // Канонический номер — как при создании: иначе правка телефона возвращает
    // карточку в состояние «тот же человек, но другой строкой» и ломает вход.
    if (phone !== undefined) {
      const normalized = normalizePhone(String(phone))
      data.phone = normalized.length >= 10 ? normalized : String(phone).trim()
    }

    // ✅ Проверка статуса с поддержкой 'offline'
    if (status !== undefined) {
      if (!ALLOWED_DRIVER_STATUSES.includes(status as DriverStatus)) {
        return NextResponse.json(
          { success: false, error: `Invalid driver status. Allowed: ${ALLOWED_DRIVER_STATUSES.join(", ")}` },
          { status: 400 }
        )
      }
      data.status = status
    }

    if (licenseNumber !== undefined) data.licenseNumber = licenseNumber
    // Календарная дата из <input type="date"> — как местный день (lib/dates.ts)
    if (licenseExpiry !== undefined || medicalExpiry !== undefined) {
      const licenseExpiryDate = parseDateValue(licenseExpiry)
      const medicalExpiryDate = parseDateValue(medicalExpiry)
      if ((licenseExpiry && !licenseExpiryDate) || (medicalExpiry && !medicalExpiryDate)) {
        return NextResponse.json(
          { success: false, error: "Дата указана неверно: ожидается ГГГГ-ММ-ДД" },
          { status: 400 }
        )
      }
      if (licenseExpiry !== undefined) data.licenseExpiry = licenseExpiryDate
      if (medicalExpiry !== undefined) data.medicalExpiry = medicalExpiryDate
    }
    if (currentLocation !== undefined) data.currentLocation = currentLocation
    // Координаты приводим и проверяем: строка из формы — в число, пусто — null,
    // планетарный мусор — 400. Иначе маркер водителя уезжает с карты,
    // а нечисло роняет весь PATCH в 500.
    const rawLat = latitude as unknown
    if (rawLat !== undefined) {
      if (rawLat === null || rawLat === "") {
        data.latitude = null
      } else {
        const lat =
          typeof rawLat === "string"
            ? parseFloat(rawLat.replace(",", "."))
            : typeof rawLat === "number"
              ? rawLat
              : NaN
        if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
          return NextResponse.json(
            { success: false, error: "Неверная широта: число от -90 до 90" },
            { status: 400 }
          )
        }
        data.latitude = lat
      }
    }
    const rawLng = longitude as unknown
    if (rawLng !== undefined) {
      if (rawLng === null || rawLng === "") {
        data.longitude = null
      } else {
        const lng =
          typeof rawLng === "string"
            ? parseFloat(rawLng.replace(",", "."))
            : typeof rawLng === "number"
              ? rawLng
              : NaN
        if (!Number.isFinite(lng) || Math.abs(lng) > 180) {
          return NextResponse.json(
            { success: false, error: "Неверная долгота: число от -180 до 180" },
            { status: 400 }
          )
        }
        data.longitude = lng
      }
    }

    // Закрепление машины пишется только через единый путь (задача 2):
    // Driver.vehicleId — источник правды, vehicleType/vehiclePlate — кэш,
    // который заполняется из данных машины, а не из тела запроса.
    // Править можно только водителя своей организации
    const existingDriver = await prisma.driver.findFirst({
      where: scopedWhere(org.organizationId, { id }),
      select: { id: true },
    })
    if (!existingDriver) {
      return NextResponse.json(
        { success: false, error: "Водитель не найден" },
        { status: 404 }
      )
    }

    let driver
    if (vehicleId !== undefined) {
      await prisma.$transaction(async (tx: any) => {
        await tx.driver.updateMany({
          where: scopedWhere(org.organizationId, { id }),
          data,
        })
        await linkDriverToVehicle(tx, id, vehicleId, org.organizationId)
      })
      driver = await prisma.driver.findFirstOrThrow({
        where: scopedWhere(org.organizationId, { id }),
      })
    } else {
      driver = await prisma.driver.updateMany({
        where: scopedWhere(org.organizationId, { id }),
        data,
      }).then(() =>
        prisma.driver.findFirstOrThrow({
          where: scopedWhere(org.organizationId, { id }),
        })
      )
    }

    return NextResponse.json({ success: true, driver })
  } catch (error) {
    // повтор телефона (Driver.phone @unique) → 409 с понятным текстом
    const friendly = friendlyDbError(error)
    const message = friendly || (error instanceof Error ? error.message : "Не удалось обновить водителя")
    console.error("[Driver] PATCH Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: friendly ? friendlyDbErrorStatus(error) : 500 }
    )
  }
}

// DELETE /api/drivers/[id]
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Не указан водитель" },
        { status: 400 }
      )
    }

    // Удалить можно только водителя своей организации
    const existingDriver = await prisma.driver.findFirst({
      where: scopedWhere(org.organizationId, { id }),
      select: { id: true },
    })
    if (!existingDriver) {
      return NextResponse.json(
        { success: false, error: "Водитель не найден" },
        { status: 404 }
      )
    }

    // Водитель с открытым рейсом или активными заказами не удаляется:
    // иначе рейс молча потеряет водителя посреди исполнения.
    const openRoutes = await prisma.route.count({
      where: scopedWhere(org.organizationId, {
        driverId: id,
        status: { notIn: ["completed", "cancelled"] },
      }),
    })
    const busyOrders = await prisma.order.count({
      where: scopedWhere(org.organizationId, {
        assignedDriverId: id,
        status: { in: [...OCCUPYING_ORDER_STATUSES] },
      }),
    })
    if (openRoutes > 0 || busyOrders > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "У водителя есть открытые рейсы или активные заказы — сначала завершите их или снимите назначение",
          code: "driver_busy",
        },
        { status: 409 },
      )
    }

    // Доступ водителя закрываем вместе с карточкой: иначе учётка останется
    // активной, а войти по ней будет нельзя (связь с Driver обнулится)
    const linkedUser = await prisma.user.findFirst({
      where: scopedWhere(org.organizationId, { driverId: id }),
      select: { id: true, name: true },
    })
    if (linkedUser) {
      // org-audit: ok — учётка найдена выше внутри организации вызывающего
      await prisma.user.update({
        where: { id: linkedUser.id },
        data: {
          status: "suspended",
          suspendedAt: new Date(),
          suspendReason: `Карточка водителя «${linkedUser.name}» удалена`,
        },
      })
      await revokeAllSessions(linkedUser.id, "Карточка водителя удалена")
    }

    // Машина отвязывается автоматически: связь хранится в Driver.vehicleId
    // и удаляется вместе с карточкой водителя (поле Vehicle.driverId удалено
    // из схемы в задаче 2).
    await prisma.driver.deleteMany({
      where: scopedWhere(org.organizationId, { id }),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось удалить водителя"
    console.error("[Driver] DELETE Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}