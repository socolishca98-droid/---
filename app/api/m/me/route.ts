// app/api/m/me/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"

export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  // driverId берём из проверенной серверной сессии, а не из query-параметра
  const driverId = auth.value.driver.id

  try {
    const driver = await prisma.driver.findFirst({
      where: scopedWhere(org.organizationId, { id: driverId }),
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
      where: scopedWhere(org.organizationId, {
        driverId: driverId,
        endedAt: null
      }),
      orderBy: {
        startedAt: 'desc'
      }
    })

    // Статистика за сегодня
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const todayStats = await prisma.order.aggregate({
      where: scopedWhere(org.organizationId, {
        assignedDriverId: driverId,
        status: 'delivered',
        updatedAt: { gte: today }
      }),
      _count: true,
      _sum: {
        distance: true,
        price: true
      }
    })

    // Контакты СВОЕГО автопарка: в мобильном приложении есть кнопка звонка
    // диспетчеру, и она должна набирать настоящий номер из настроек автопарка
    // (FleetSettings.phone — телефон перевозчика), а не зашитый в разметку
    // (раньше был +79001234567). Отдельного «телефона диспетчерской» в схеме
    // нет, поэтому выдумывать его нельзя.
    const fleetSettings = await prisma.fleetSettings.findFirst({
      where: scopedWhere(org.organizationId),
      select: { parkName: true, phone: true }
    })

    const fleetPhone = (fleetSettings?.phone || "").trim()

    return NextResponse.json({
      success: true,
      driver,
      fleet: {
        parkName: fleetSettings?.parkName || null,
        // null — номер не задан в настройках автопарка: интерфейс честно
        // делает кнопку звонка неактивной вместо набора несуществующего номера
        phone: fleetPhone || null
      },
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