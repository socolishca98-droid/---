// app/api/m/me/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { requireDriverAuth } from "@/lib/api-auth"
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const __auth = await requireDriverAuth(request);
  if (__auth.error) return __auth.error;

  try {
    const { searchParams } = new URL(request.url)
    const driverId = searchParams.get('driverId')

    if (!driverId) {
      return NextResponse.json(
        { success: false, error: 'driverId обязателен' },
        { status: 400 }
      )
    }

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        name: true,
        phone: true,
        vehicleType: true,
        vehiclePlate: true,
        status: true,
        latitude: true,
        longitude: true,
        lastGpsUpdate: true,
        ordersCompleted: true,
        rating: true,
        licenseNumber: true,
        licenseExpiry: true,
        medicalExpiry: true,
        hiredAt: true,
        createdAt: true,
      }
    })

    if (!driver) {
      return NextResponse.json(
        { success: false, error: 'Водитель не найден' },
        { status: 404 }
      )
    }

    // Получаем активную смену
    const activeShift = await prisma.driverShift.findFirst({
      where: {
        driverId: driverId,
        endedAt: null
      },
      orderBy: {
        startedAt: 'desc'
      }
    })

    // Статистика за сегодня
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const todayStats = await prisma.order.aggregate({
      where: {
        assignedDriverId: driverId,
        status: 'delivered',
        updatedAt: { gte: today }
      },
      _count: true,
      _sum: {
        distance: true,
        price: true
      }
    })

    return NextResponse.json({
      success: true,
      driver,
      activeShift: activeShift || null,
      todayStats: {
        ordersDelivered: todayStats._count || 0,
        distanceKm: todayStats._sum.distance || 0,
        earnings: todayStats._sum.price || 0
      }
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Me API] Error:', message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}