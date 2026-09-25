/**
 * /api/sos — штабная работа с SOS-сигналами водителей.
 *
 * Доступ: admin, logist.
 *   GET   — список сигналов (фильтр по статусу, настоящая пагинация)
 *   PATCH — взять в обработку / закрыть сигнал
 *
 * Раньше эти два обработчика лежали в /api/m/sos — то есть в водительском контуре,
 * куда middleware логиста не пускает: сигналы фактически никто не мог обработать.
 * Водитель по-прежнему создаёт сигнал через POST /api/m/sos.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"

import { SOS_STATUSES, sosLabel, type SosStatus } from "@/lib/sos-labels"

export const dynamic = "force-dynamic"

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const { searchParams } = request.nextUrl
  const statusParam = searchParams.get("status") || "active"
  const status = statusParam === "all" || (SOS_STATUSES as readonly string[]).includes(statusParam)
    ? statusParam
    : "active"
  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE),
  )

  try {
    const where = status === "all" ? {} : { status }

    const [alerts, total] = await Promise.all([
      prisma.sosAlert.findMany({
        where: scopedWhere(org.organizationId, where),
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.sosAlert.count({ where: scopedWhere(org.organizationId, where) }),
    ])

    const driverIds = [...new Set(alerts.map((alert: any) => alert.driverId) as string[])]
    const drivers = driverIds.length
      ? await prisma.driver.findMany({
          where: scopedWhere(org.organizationId, { id: { in: driverIds } }),
          select: { id: true, name: true, phone: true, vehiclePlate: true },
        })
      : []

    return NextResponse.json({
      success: true,
      alerts: alerts.map((alert: any) => ({
        ...alert,
        typeLabel: sosLabel(alert.type),
        driver: drivers.find((driver: any) => driver.id === alert.driverId) ?? null,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[sos] GET error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось загрузить SOS-сигналы" },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const actorId = auth.value.user.id

  let body: {
    sosId?: unknown
    status?: unknown
    resolution?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Некорректное тело запроса" },
      { status: 400 },
    )
  }

  const sosId = String(body.sosId ?? "")
  const status = String(body.status ?? "") as SosStatus
  const resolution = body.resolution == null ? null : String(body.resolution)

  if (!sosId) {
    return NextResponse.json(
      { success: false, error: "sosId обязателен" },
      { status: 400 },
    )
  }
  if (!(SOS_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      {
        success: false,
        error: `Недопустимый статус. Доступно: ${SOS_STATUSES.join(", ")}`,
      },
      { status: 400 },
    )
  }

  try {
    const existing = await prisma.sosAlert.findFirst({
      where: scopedWhere(org.organizationId, { id: sosId }),
      select: { id: true, driverId: true, type: true, status: true },
    })
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "SOS-сигнал не найден" },
        { status: 404 },
      )
    }

    const updateData: Record<string, unknown> = { status }

    if (status === "responding") {
      updateData.respondedAt = new Date()
      // Кто взял в обработку — из серверной сессии, а не из тела запроса
      updateData.respondedBy = actorId
    }

    if (status === "resolved" || status === "false_alarm") {
      updateData.resolvedAt = new Date()
      updateData.resolvedBy = actorId
      updateData.resolution = resolution
    }

    // org-audit: ok — сигнал найден выше внутри организации вызывающего
    const updated = await prisma.sosAlert.update({
      where: { id: sosId },
      data: updateData,
    })

    // Уведомление водителю о том, что сигнал обработан
    await prisma.notification.create({
      data: {
        organizationId: org.organizationId,
        userId: existing.driverId,
        userRole: "driver",
        type: "sos_status",
        title: status === "responding" ? "SOS принят в работу" : "SOS закрыт",
        message: `${sosLabel(existing.type)}: ${
          status === "responding"
            ? "логист взял сигнал в обработку"
            : status === "resolved"
              ? "сигнал закрыт"
              : "сигнал помечен как ложный"
        }${resolution ? `. ${resolution}` : ""}`,
        driverId: existing.driverId,
        sosId: existing.id,
        priority: status === "responding" ? "high" : "normal",
      },
    })

    return NextResponse.json({ success: true, sos: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[sos] PATCH error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось обновить SOS-сигнал" },
      { status: 500 },
    )
  }
}
