// app/api/m/orders/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"

export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  // Водитель видит только свои заказы: driverId из сессии, query-параметр игнорируется
  const driverId = auth.value.driver.id

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // 'active' | 'history'

    const activeStatuses = [
      'new',
      'confirmed',
      'in_transit',
      'processing',
      'loading',
      'unloading',
    ]

    const historyStatuses = ['delivered', 'cancelled']

    const orders = await prisma.order.findMany({
      where: scopedWhere(org.organizationId, {
        assignedDriverId: driverId,
        status: {
          in: status === 'history' ? historyStatuses : activeStatuses,
        },
      }),
      orderBy: {
        createdAt: status === 'history' ? 'desc' : 'asc',
      },
      take: 50,
    })

    // Статистика для водителя
    const stats = await prisma.order.aggregate({
      where: scopedWhere(org.organizationId, {
        assignedDriverId: driverId,
        status: 'delivered',
      }),
      _count: true,
      _sum: {
        price: true,
        distance: true,
      },
    })

    return NextResponse.json({
      success: true,
      orders,
      stats: {
        completedOrders: stats._count || 0,
        totalEarnings: stats._sum.price || 0,
        totalDistance: stats._sum.distance || 0,
      },
    })
  } catch (error: unknown) {
    console.error('GET /api/m/orders error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}