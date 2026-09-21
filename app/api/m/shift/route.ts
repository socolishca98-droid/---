// app/api/m/shift/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireDriver } from "@/lib/auth/session"

const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

async function getActiveOrderForDriver(driverId: string) {
  return prisma.order.findFirst({
    where: {
      assignedDriverId: driverId,
      status: { in: ACTIVE_ORDER_STATUSES as any },
    },
    orderBy: { createdAt: "asc" },
  })
}

// GET /api/m/shift
// Текущая активная смена + активный заказ (если есть).
// Водитель — из проверенной сессии, query-параметр driverId больше не принимается.
export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const driverId = auth.value.driver.id

  try {

    const [shift, activeOrder] = await Promise.all([
      prisma.driverShift.findFirst({
        where: {
          driverId,
          endedAt: null,
        },
        orderBy: { startedAt: "desc" },
      }),
      getActiveOrderForDriver(driverId),
    ])

    return NextResponse.json({
      success: true,
      shift,
      activeOrder,
    })
  } catch (error: any) {
    console.error("[m/shift] GET Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Shift GET error" },
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

  const driverId = auth.value.driver.id

  try {

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
    })

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 },
      )
    }

    // Проверяем, что нет уже активной смены
    const existingShift = await prisma.driverShift.findFirst({
      where: { driverId, endedAt: null },
      orderBy: { startedAt: "desc" },
    })

    if (existingShift) {
      return NextResponse.json({
        success: true,
        alreadyActive: true,
        shift: existingShift,
      })
    }

    const activeOrder = await getActiveOrderForDriver(driverId)

    const { shift } = await prisma.$transaction(async (tx) => {
      const shiftStatus = activeOrder ? "driving" : "waiting"

      const newShift = await tx.driverShift.create({
        data: {
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
        await tx.driver.update({
          where: { id: driverId },
          data: {
            status: activeOrder ? "busy" : "available",
          },
        })
      }

      return { shift: newShift }
    })

    return NextResponse.json({
      success: true,
      shift,
      activeOrder,
    })
  } catch (error: any) {
    console.error("[m/shift] POST Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Shift start error" },
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

  const driverId = auth.value.driver.id

  try {
    const body = await request.json().catch(() => ({}))
    const { status } = body as {
      status?: string
    }

    if (!status) {
      return NextResponse.json(
        { success: false, error: "status required" },
        { status: 400 },
      )
    }

    const shift = await prisma.driverShift.findFirst({
      where: { driverId, endedAt: null },
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

    const updated = await prisma.driverShift.update({
      where: { id: shift.id },
      data: {
        status,
        lastStatusChangeAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      shift: updated,
    })
  } catch (error: any) {
    console.error("[m/shift] PATCH Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Shift update error" },
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

  const driverId = auth.value.driver.id

  try {

    const shift = await prisma.driverShift.findFirst({
      where: { driverId, endedAt: null },
      orderBy: { startedAt: "desc" },
    })

    if (!shift) {
      return NextResponse.json({
        success: true,
        alreadyEnded: true,
      })
    }

    await prisma.$transaction(async (tx) => {
      await tx.driverShift.update({
        where: { id: shift.id },
        data: {
          endedAt: new Date(),
          lastStatusChangeAt: new Date(),
        },
      })

      const activeOrdersCount = await tx.order.count({
        where: {
          assignedDriverId: driverId,
          status: { in: ACTIVE_ORDER_STATUSES as any },
        },
      })

      const newStatus = activeOrdersCount > 0 ? "busy" : "available"

      await tx.driver.update({
        where: { id: driverId },
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
      { success: false, error: error.message || "Shift end error" },
      { status: 500 },
    )
  }
}