// app/api/sidebar-counts/route.ts
//
// Счётчики для сайдбара: раньше рядом с «Заказы» и «Чат» были жёстко зашитые
// числа (6 и 1), которые ничего не означали. Здесь — настоящие данные
// организации из сессии.
//
// GET /api/sidebar-counts → {
//   orders: number,  // заказы, которые ждут действия логиста
//   chat: number,    // непрочитанные сообщения чата (не мои собственные)
// }
//
// «Ждут действия» = заказ на этапе «Поиск» или «Согласование» (канон и прежние
// значения — база может быть ещё не перенесена) либо у него просрочено
// напоминание nextFollowUpAt и заказ не закрыт.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import {
  CLOSED_ORDER_STATUSES,
  LEGACY_ORDER_STATUS_MAP,
  ORDER_STATUSES,
} from "@/lib/orders/stages"

export const dynamic = "force-dynamic"

/** Все значения статуса (канон + прежние), которые означают «Поиск»/«Согласование». */
const PENDING_STATUSES: string[] = [
  ...ORDER_STATUSES.filter((status) => status === "search" || status === "negotiation"),
  ...Object.entries(LEGACY_ORDER_STATUS_MAP)
    .filter(([, canonical]) => canonical === "search" || canonical === "negotiation")
    .map(([legacy]) => legacy),
]

const CLOSED_STATUSES: string[] = [
  ...CLOSED_ORDER_STATUSES,
  ...Object.entries(LEGACY_ORDER_STATUS_MAP)
    .filter(([, canonical]) => (CLOSED_ORDER_STATUSES as readonly string[]).includes(canonical))
    .map(([legacy]) => legacy),
]

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const now = new Date()

    const [orders, chat] = await Promise.all([
      prisma.order.count({
        where: scopedWhere(org.organizationId, {
          OR: [
            { status: { in: PENDING_STATUSES } },
            {
              nextFollowUpAt: { lte: now },
              status: { notIn: CLOSED_STATUSES },
            },
          ],
        }),
      }),
      prisma.chatMessage.count({
        where: scopedWhere(org.organizationId, {
          isRead: false,
          // свои собственные сообщения непрочитанными не считаются
          senderId: { not: org.userId },
        }),
      }),
    ])

    return NextResponse.json({ success: true, orders, chat })
  } catch (error) {
    const message = error instanceof Error ? error.message : "sidebar counts error"
    console.error("[sidebar-counts] GET error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось получить счётчики", orders: 0, chat: 0 },
      { status: 500 },
    )
  }
}
