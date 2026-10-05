// app/api/m/shift/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { OCCUPYING_ORDER_STATUSES } from "@/lib/orders/stages"
import {
  REST_END,
  REST_START,
  currentBreak,
  drivingMinutes,
  restVerdict,
  sumRestMinutes,
} from "@/lib/rest/norms"

// Заказ занимает водителя/машину, пока он в рейсе, на документах, назначен или на контроле
// (канон жизненного цикла заказа — lib/orders/stages.ts)
const ACTIVE_ORDER_STATUSES = OCCUPYING_ORDER_STATUSES

async function getActiveOrderForDriver(driverId: string, organizationId: string) {
  return prisma.order.findFirst({
    where: scopedWhere(organizationId, {
      assignedDriverId: driverId,
      status: { in: ACTIVE_ORDER_STATUSES as any },
    }),
    orderBy: { createdAt: "asc" },
  })
}

// GET /api/m/shift
// Текущая активная смена + активный заказ (если есть).
// Водитель — из проверенной сессии, query-параметр driverId больше не принимается.
export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {

    const [shift, activeOrder] = await Promise.all([
      prisma.driverShift.findFirst({
        where: scopedWhere(org.organizationId, {
          driverId,
          endedAt: null,
        }),
        orderBy: { startedAt: "desc" },
      }),
      getActiveOrderForDriver(driverId, org.organizationId),
    ])

    // ── Нормы отдыха: непрерывное время в пути по смене и событиям отдыха ──
    let rest: {
      resting: boolean
      restDue: boolean
      drivingMinutes: number
      minutesToRest: number
      currentBreakMin: number
      breakCounts: boolean
      limitMin: number
      minBreakMin: number
    } | null = null

    if (shift) {
      const settings = await prisma.fleetSettings.findFirst({
        where: scopedWhere(org.organizationId),
        select: { restDriveLimitMin: true, restMinBreakMin: true },
      })
      const limitMin = settings?.restDriveLimitMin ?? 270
      const minBreakMin = settings?.restMinBreakMin ?? 45

      const events = activeOrder?.routeId
        ? await prisma.routeEvent.findMany({
            where: scopedWhere(org.organizationId, {
              routeId: activeOrder.routeId,
              driverId,
              type: "status",
              status: { in: [REST_START, REST_END] },
            }),
            select: { status: true, createdAt: true },
          })
        : []

      const now = new Date()
      const shiftStart = new Date(shift.startedAt)
      const restMinutes = sumRestMinutes(events, shiftStart, now)
      const breakInfo = currentBreak(events, now)
      const verdict = restVerdict({
        shiftStart,
        now,
        restMinutes,
        resting: breakInfo.resting,
        currentBreakMin: breakInfo.currentBreakMin,
        limitMin,
        minBreakMin,
      })
      rest = {
        resting: verdict.resting,
        restDue: verdict.restDue,
        drivingMinutes: drivingMinutes(shiftStart, now, restMinutes),
        minutesToRest: verdict.minutesToRest,
        currentBreakMin: verdict.currentBreakMin,
        breakCounts: verdict.breakCounts,
        limitMin,
        minBreakMin,
      }
    }

    return NextResponse.json({
      success: true,
      shift,
      activeOrder,
      rest,
    })
  } catch (error: any) {
    console.error("[m/shift] GET Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Не удалось загрузить смену" },
      { status: 500 },
    )
  }
}

// POST /api/m/shift
// body не требуется: смена стартует для водителя из сессии
// Старт смены:
// - если есть активный заказ → Shift.status = 'driving', Driver.status = 'busy'
// - если нет заказа → Shift.status = 'waiting', Driver.status = 'available'
export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {

    const driver = await prisma.driver.findFirst({
      where: scopedWhere(org.organizationId, { id: driverId }),
    })

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Водитель не найден" },
        { status: 404 },
      )
    }

    // Проверяем, что нет уже активной смены
    const existingShift = await prisma.driverShift.findFirst({
      where: scopedWhere(org.organizationId, { driverId, endedAt: null }),
      orderBy: { startedAt: "desc" },
    })

    if (existingShift) {
      return NextResponse.json({
        success: true,
        alreadyActive: true,
        shift: existingShift,
      })
    }

    const activeOrder = await getActiveOrderForDriver(driverId, org.organizationId)

    const { shift } = await prisma.$transaction(async (tx: any) => {
      const shiftStatus = activeOrder ? "driving" : "waiting"

      const newShift = await tx.driverShift.create({
        data: {
          organizationId: org.organizationId,
          driverId,
          status: shiftStatus,
          startedAt: new Date(),
          lastStatusChangeAt: new Date(),
        },
      })

      // Driver.status в БД:
      //   maintenance — только руками/ТО
      //   busy       — есть активный заказ
      //   available  — нет заказа
      if (driver.status !== "maintenance") {
        await tx.driver.updateMany({
          where: scopedWhere(org.organizationId, { id: driverId }),
          data: {
            status: activeOrder ? "busy" : "available",
          },
        })
      }

      return { shift: newShift }
    })

    // ── Нормы отдыха: непрерывное время в пути по смене и событиям отдыха ──
    let rest: {
      resting: boolean
      restDue: boolean
      drivingMinutes: number
      minutesToRest: number
      currentBreakMin: number
      breakCounts: boolean
      limitMin: number
      minBreakMin: number
    } | null = null

    if (shift) {
      const settings = await prisma.fleetSettings.findFirst({
        where: scopedWhere(org.organizationId),
        select: { restDriveLimitMin: true, restMinBreakMin: true },
      })
      const limitMin = settings?.restDriveLimitMin ?? 270
      const minBreakMin = settings?.restMinBreakMin ?? 45

      const events = activeOrder?.routeId
        ? await prisma.routeEvent.findMany({
            where: scopedWhere(org.organizationId, {
              routeId: activeOrder.routeId,
              driverId,
              type: "status",
              status: { in: [REST_START, REST_END] },
            }),
            select: { status: true, createdAt: true },
          })
        : []

      const now = new Date()
      const shiftStart = new Date(shift.startedAt)
      const restMinutes = sumRestMinutes(events, shiftStart, now)
      const breakInfo = currentBreak(events, now)
      const verdict = restVerdict({
        shiftStart,
        now,
        restMinutes,
        resting: breakInfo.resting,
        currentBreakMin: breakInfo.currentBreakMin,
        limitMin,
        minBreakMin,
      })
      rest = {
        resting: verdict.resting,
        restDue: verdict.restDue,
        drivingMinutes: drivingMinutes(shiftStart, now, restMinutes),
        minutesToRest: verdict.minutesToRest,
        currentBreakMin: verdict.currentBreakMin,
        breakCounts: verdict.breakCounts,
        limitMin,
        minBreakMin,
      }
    }

    return NextResponse.json({
      success: true,
      shift,
      activeOrder,
      rest,
    })
  } catch (error: any) {
    console.error("[m/shift] POST Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Не удалось начать смену" },
      { status: 500 },
    )
  }
}

// PATCH /api/m/shift
// body: { status: 'driving' | 'waiting' | 'resting' | 'sleeping' | 'loading' | 'unloading' }
// Обновление статуса текущей смены (для карты / аналитики)
export async function PATCH(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {
    const body = await request.json().catch(() => ({}))
    const { status } = body as {
      status?: string
    }

    if (!status) {
      return NextResponse.json(
        { success: false, error: "Не указан статус" },
        { status: 400 },
      )
    }

    const shift = await prisma.driverShift.findFirst({
      where: scopedWhere(org.organizationId, { driverId, endedAt: null }),
      orderBy: { startedAt: "desc" },
    })

    if (!shift) {
      return NextResponse.json(
        { success: false, error: "No active shift" },
        { status: 400 },
      )
    }

    const allowedStatuses = [
      "driving",
      "waiting",
      "resting",
      "sleeping",
      "loading",
      "unloading",
    ]
    if (!allowedStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: "Invalid shift status" },
        { status: 400 },
      )
    }

    await prisma.driverShift.updateMany({
      where: scopedWhere(org.organizationId, { id: shift.id }),
      data: {
        status,
        lastStatusChangeAt: new Date(),
      },
    })

    const updated = await prisma.driverShift.findFirstOrThrow({
      where: scopedWhere(org.organizationId, { id: shift.id }),
    })

    return NextResponse.json({
      success: true,
      shift: updated,
    })
  } catch (error: any) {
    console.error("[m/shift] PATCH Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Не удалось обновить статус смены" },
      { status: 500 },
    )
  }
}

// DELETE /api/m/shift — завершение своей смены
// - если нет активных заказов → Driver.status = 'available'
// - если есть активные заказы (теоретически) → Driver.status = 'busy'
export async function DELETE(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {

    const shift = await prisma.driverShift.findFirst({
      where: scopedWhere(org.organizationId, { driverId, endedAt: null }),
      orderBy: { startedAt: "desc" },
    })

    if (!shift) {
      return NextResponse.json({
        success: true,
        alreadyEnded: true,
      })
    }

    await prisma.$transaction(async (tx: any) => {
      await tx.driverShift.updateMany({
        where: scopedWhere(org.organizationId, { id: shift.id }),
        data: {
          endedAt: new Date(),
          lastStatusChangeAt: new Date(),
        },
      })

      const activeOrdersCount = await tx.order.count({
        where: scopedWhere(org.organizationId, {
          assignedDriverId: driverId,
          status: { in: ACTIVE_ORDER_STATUSES as any },
        }),
      })

      const newStatus = activeOrdersCount > 0 ? "busy" : "available"

      await tx.driver.updateMany({
        where: scopedWhere(org.organizationId, { id: driverId }),
        data: {
          status: newStatus,
        },
      })
    })

    return NextResponse.json({
      success: true,
    })
  } catch (error: any) {
    console.error("[m/shift] DELETE Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Не удалось завершить смену" },
      { status: 500 },
    )
  }
}