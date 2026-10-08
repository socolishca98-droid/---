// app/api/lm/chat-threads/route.ts
//
// Список переписок для мобильного чата логиста (пункт 1.4 чек-листа).
//
// Зачем отдельный эндпоинт: общий GET /api/chat отдаёт плоский список
// сообщений и используется десктопной страницей /chat — менять его формат
// нельзя. Здесь же для каждого водителя сразу считается то, что нужно
// телефону: последнее сообщение, кто его написал и сколько сообщений
// водителя ещё не прочитано.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"

export const dynamic = "force-dynamic"

/** Сколько последних сообщений организации просматриваем, чтобы собрать переписки */
const SCAN_LIMIT = 400

export interface ChatThreadSummary {
  driverId: string
  lastMessage: {
    id: string
    content: string
    createdAt: string
    /** Кто написал последнее сообщение: водитель или штаб */
    fromDriver: boolean
    isImportant: boolean
  }
  unreadCount: number
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    // Идём от свежих сообщений к старым: первое встреченное сообщение по
    // водителю и есть последнее, остальные нужны только для счётчика.
    const messages = await prisma.chatMessage.findMany({
      where: scopedWhere(org.organizationId, {}),
      orderBy: { createdAt: "desc" },
      take: SCAN_LIMIT,
      select: {
        id: true,
        senderId: true,
        senderRole: true,
        recipientId: true,
        content: true,
        type: true,
        isImportant: true,
        isRead: true,
        createdAt: true,
      },
    })

    const threads = new Map<string, ChatThreadSummary>()

    for (const message of messages) {
      const fromDriver = message.senderRole === "driver"
      // Переписка всегда «про водителя»: он либо автор, либо адресат.
      const driverId = fromDriver ? message.senderId : message.recipientId
      if (!driverId) continue

      const unread = fromDriver && !message.isRead
      const existing = threads.get(driverId)

      if (!existing) {
        threads.set(driverId, {
          driverId,
          lastMessage: {
            id: message.id,
            content: message.content,
            createdAt: message.createdAt.toISOString(),
            fromDriver,
            isImportant: Boolean(message.isImportant) || message.type === "alert",
          },
          unreadCount: unread ? 1 : 0,
        })
        continue
      }

      if (unread) existing.unreadCount += 1
    }

    return NextResponse.json({ success: true, threads: [...threads.values()] })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить переписки"
    console.error("[lm/chat-threads] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
