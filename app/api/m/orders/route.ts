// app/api/m/orders/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { requireDriverAuth } from "@/lib/api-auth"
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const __auth = await requireDriverAuth(request);
  if (__auth.error) return __auth.error;

  try {
    const { searchParams } = new URL(request.url)
    const driverId = searchParams.get('driverId')
    const status = searchParams.get('status') // 'active' | 'history'

    if (!driverId) {
      return NextResponse.json(
        { success: false, error: 'driverId обязателен' },
        { status: 400 }
      )
    }

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
      where: {
        assignedDriverId: driverId,
        status: {
          in: status === 'history' ? historyStatuses : activeStatuses,
        },
      },
      orderBy: {
        createdAt: status === 'history' ? 'desc' : 'asc',
      },
      take: 50,
    })

    // Статистика для водителя
    const stats = await prisma.order.aggregate({
      where: {
        assignedDriverId: driverId,
        status: 'delivered',
      },
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