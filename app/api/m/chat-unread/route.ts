// app/api/m/chat-unread/route.ts
//
// Сколько сообщений от штаба водитель ещё не прочитал (пункт 1.3 чек-листа).
// Нужно для точки на кнопке чата в приложении водителя: без неё о новом
// сообщении логиста он узнаёт, только если сам откроет чат.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    // Свои же сообщения адресуются штабу (recipientId = null), поэтому
    // «входящие без отметки о прочтении» — это ровно то, что нужно показать.
    const count = await prisma.chatMessage.count({
      where: scopedWhere(org.organizationId, {
        recipientId: auth.value.driver.id,
        isRead: false,
      }),
    })

    return NextResponse.json({ success: true, count })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось посчитать сообщения"
    console.error("[m/chat-unread] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
