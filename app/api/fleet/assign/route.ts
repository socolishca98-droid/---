// app/api/fleet/assign/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireStaff } from "@/lib/auth/session"

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  try {
    const body = await request.json()
    const { driverId, vehicleId } = body as {
      driverId?: string
      vehicleId?: string
    }

    if (!driverId || !vehicleId) {
      return NextResponse.json(
        { success: false, error: "Укажите driverId и vehicleId" },
        { status: 400 },
      )
    }

    const [driver, vehicle] = await Promise.all([
      prisma.driver.findUnique({ where: { id: driverId } }),
      prisma.vehicle.findUnique({ where: { id: vehicleId } }),
    ])

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Водитель не найден" },
        { status: 404 },
      )
    }

    if (!vehicle) {
      return NextResponse.json(
        { success: false, error: "Машина не найдена" },
        { status: 404 },
      )
    }

    if (vehicle.driverId && vehicle.driverId !== driverId) {
      const currentDriver = await prisma.driver.findUnique({
        where: { id: vehicle.driverId },
        select: { name: true },
      })

      return NextResponse.json(
        {
          success: false,
          error: `Машина уже закреплена за ${currentDriver?.name || "другим водителем"}`,
        },
        { status: 400 },
      )
    }

    await prisma.$transaction(async (tx) => {
      if (driver.vehicleId && driver.vehicleId !== vehicleId) {
        await tx.vehicle.update({
          where: { id: driver.vehicleId },
          data: { driverId: null },
        })
      }

      await tx.driver.update({
        where: { id: driverId },
        data: {
          vehicleId,
          vehiclePlate: vehicle.plate,
          vehicleType: vehicle.type,
        },
      })

      await tx.vehicle.update({
        where: { id: vehicleId },
        data: { driverId },
      })
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[Fleet Assign] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Ошибка назначения водителя" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(request.url)
    const driverId = searchParams.get("driverId")
    const vehicleId = searchParams.get("vehicleId")

    if (!driverId && !vehicleId) {
      return NextResponse.json(
        { success: false, error: "Укажите driverId или vehicleId" },
        { status: 400 },
      )
    }

    await prisma.$transaction(async (tx) => {
      if (driverId) {
        const driver = await tx.driver.findUnique({
          where: { id: driverId },
          select: { vehicleId: true },
        })

        if (driver?.vehicleId) {
          await tx.vehicle.update({
            where: { id: driver.vehicleId },
            data: { driverId: null },
          })
        }

        await tx.driver.update({
          where: { id: driverId },
          data: {
            vehicleId: null,
          },
        })
      }

      if (vehicleId && !driverId) {
        const vehicle = await tx.vehicle.findUnique({
          where: { id: vehicleId },
          select: { driverId: true },
        })

        if (vehicle?.driverId) {
          await tx.driver.update({
            where: { id: vehicle.driverId },
            data: {
              vehicleId: null,
            },
          })
        }

        await tx.vehicle.update({
          where: { id: vehicleId },
          data: { driverId: null },
        })
      }
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[Fleet Unassign] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Ошибка отвязки" },
      { status: 500 },
    )
  }
}