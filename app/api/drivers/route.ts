// app/api/drivers/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { normalizePhone } from "@/lib/auth/constants"
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password"
import { friendlyDbError, friendlyDbErrorStatus } from "@/lib/db/errors"
import { linkDriverToVehicle } from "@/lib/fleet/assignment"
// ✅ Допустимые статусы водителя
const ALLOWED_DRIVER_STATUSES = ["available", "busy", "maintenance", "offline"] as const

// GET /api/drivers?status=available|busy|maintenance|offline|all
// GET /api/drivers?ids=id1,id2,id3 — bulk fetch
export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || undefined
    const idsParam = searchParams.get("ids")

    // ✅ Bulk fetch по списку ID
    if (idsParam) {
      const ids = idsParam.split(",").filter(Boolean)
      
      if (ids.length === 0) {
        return NextResponse.json({ success: true, drivers: [] })
      }

      if (ids.length > 100) {
        return NextResponse.json(
          { success: false, error: "Maximum 100 IDs allowed per request" },
          { status: 400 }
        )
      }

      const drivers = await prisma.driver.findMany({
        where: scopedWhere(org.organizationId, { id: { in: ids } }),
      })

      // Возвращаем Map для быстрого доступа на клиенте
      const driversMap: Record<string, typeof drivers[0]> = {}
      drivers.forEach((driver) => {
        driversMap[driver.id] = driver
      })

      return NextResponse.json({ 
        success: true, 
        drivers,
        driversMap,
      })
    }

    // Стандартный запрос с фильтрацией по статусу
    const where: Record<string, unknown> = {}
    if (status && status !== "all") {
      where.status = status
    }

    const drivers = await prisma.driver.findMany({
      where: scopedWhere(org.organizationId, where),
      orderBy: { name: "asc" },
    })

    return NextResponse.json({ success: true, drivers })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drivers GET error"
    console.error("[Drivers] GET Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// POST /api/drivers
export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response
  try {
    const body = await request.json().catch(() => ({}))
    const {
      name,
      phone,
      vehicleId,
      licenseNumber,
      licenseExpiry,
      medicalExpiry,
    } = body as {
      name?: string
      phone?: string
      vehicleId?: string
      licenseNumber?: string
      licenseExpiry?: string
      medicalExpiry?: string
    }

    if (!name || !phone) {
      return NextResponse.json(
        { success: false, error: "name and phone are required" },
        { status: 400 }
      )
    }

    const driver = await prisma.driver.create({
      data: {
        organizationId: org.organizationId,
        name,
        phone,
        status: "available",
        licenseNumber: licenseNumber || null,
        licenseExpiry: licenseExpiry ? new Date(licenseExpiry) : null,
        medicalExpiry: medicalExpiry ? new Date(medicalExpiry) : null,
        hiredAt: new Date(),
      },
    })

    // Машина закрепляется единым путём: Driver.vehicleId + кэш номера/типа
    // из данных самой машины (vehicleType/vehiclePlate из запроса игнорируются).
    if (vehicleId) {
      await linkDriverToVehicle(prisma, driver.id, vehicleId, org.organizationId)
    }

    // Учётка для входа в приложение водителя: одна система доступа на всех.
    // Пароль временный, водитель обязан сменить его при первом входе.
    const normalizedPhone = normalizePhone(phone)
    let credentials: { phone: string; temporaryPassword: string } | null = null
    let warning: string | undefined

    if (normalizedPhone.length >= 10) {
      // Телефон — глобальный логин: учётка ищется по всей базе намеренно (нельзя завести второй вход на тот же номер)
      // org-audit: manual — телефон уникален во всей базе намеренно: это проверка логина, а не данные организации
      const existing = await prisma.user.findFirst({
        where: { OR: [{ phone: normalizedPhone }, { driverId: driver.id }] },
        select: { id: true },
      })

      if (existing) {
        warning =
          "Учётка с таким телефоном уже есть — водитель входит под существующим паролем. " +
          "При необходимости сбросьте пароль в разделе «Сотрудники и доступ»."
      } else {
        const temporaryPassword = generateTemporaryPassword()
        const { hash, salt } = await hashPassword(temporaryPassword)

        try {
          await prisma.user.create({
            data: {
              organizationId: org.organizationId,
              phone: normalizedPhone,
              name,
              passwordHash: hash,
              passwordSalt: salt,
              role: "driver",
              status: "active",
              driverId: driver.id,
              approvedAt: new Date(),
              approvedById: auth.value.user.id,
              mustChangePassword: true,
            },
          })
          credentials = { phone: normalizedPhone, temporaryPassword }
        } catch (userError) {
          console.error("[Drivers] не удалось создать учётку водителя:", userError)
          warning =
            "Карточка водителя создана, но учётку для входа создать не удалось. " +
            "Проверьте телефон и создайте доступ в разделе «Сотрудники и доступ»."
        }
      }
    } else {
      warning =
        "Карточка водителя создана, но телефон не распознан — учётка для входа не создана. " +
        "Укажите корректный телефон и сбросьте пароль в разделе «Сотрудники и доступ»."
    }

    return NextResponse.json({ success: true, driver, credentials, warning })
  } catch (error) {
    // Driver.phone теперь @unique: повтор телефона — это 409 с понятным текстом,
    // а не 500 с техническим сообщением Prisma
    const friendly = friendlyDbError(error)
    const message = friendly || (error instanceof Error ? error.message : "Drivers POST error")
    console.error("[Drivers] POST Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: friendly ? friendlyDbErrorStatus(error) : 500 }
    )
  }
}