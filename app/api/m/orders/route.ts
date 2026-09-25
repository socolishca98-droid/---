// app/api/m/orders/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import {
  CLOSED_ORDER_STATUSES,
  LEGACY_ORDER_STATUS_MAP,
  ORDER_STATUSES,
  type OrderStatus,
} from "@/lib/orders/stages"

/**
 * Значения для фильтра: канонические статусы плюс прежние, которые в них
 * приводятся. Перенос статусов в базе может быть ещё не сделан (его выполняет
 * пользователь на своей машине), поэтому фильтр обязан понимать оба набора —
 * иначе у водителя пропали бы заказы со старыми статусами.
 */
function statusesFor(canon: readonly OrderStatus[]): string[] {
  const values = new Set<string>(canon)
  for (const [legacy, mapped] of Object.entries(LEGACY_ORDER_STATUS_MAP)) {
    if ((canon as readonly string[]).includes(mapped)) values.add(legacy)
  }
  return Array.from(values)
}

/**
 * «В работе» у водителя — всё, что ещё не закрыто. Заказ может быть уже
 * назначен водителю, но пока не переведён в «Контроль» (этап назначения), и
 * пропадать из мобильного списка он не должен. Закрытые заказы
 * (delivered / cancelled / rejected / expired) уходят в историю.
 */
const ACTIVE_STATUSES = statusesFor(
  ORDER_STATUSES.filter(
    (status) => !(CLOSED_ORDER_STATUSES as readonly string[]).includes(status),
  ),
)
const HISTORY_STATUSES = statusesFor(CLOSED_ORDER_STATUSES)

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


    const orders = await prisma.order.findMany({
      where: scopedWhere(org.organizationId, {
        assignedDriverId: driverId,
        // Канон этапов заказа (lib/orders/stages.ts): «в работе» — заказ уже в
        // рейсе (in_route/documents/assigned/control + их прежние значения).
        status: {
          in: status === 'history' ? HISTORY_STATUSES : ACTIVE_STATUSES,
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
        status: { in: statusesFor(['delivered']) },
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