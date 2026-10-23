// app/api/ati/loads/contacts/route.ts
//
// POST /api/ati/loads/contacts — «узнать телефон фрахтователя» груза биржи.
//
// Зачем: в списке грузов ATI телефона нет — он приходит отдельным запросом
// карточки фирмы. Логисту на бирже телефон нужен ДО создания заказа:
// помощник показывает маршрут, логист звонит по каждому плечу и договаривается.
// Поэтому эндпоинт только доставляет контакт и сохраняет его в грузе —
// заказ при этом НЕ создаётся, этап «Поиск» не начинается.
//
// Обращение к ATI идёт с токеном ОРГАНИЗАЦИИ (её аккаунт, её лимиты),
// результат кэшируется в AtiCache: повторный запрос телефона тот же груз
// уже не дёргает.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { fetchFirmContacts } from "@/lib/ati/contacts"
import { getActiveAtiToken } from "@/lib/ati/connection"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  let body: { cacheId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
  }

  const cacheId = String(body.cacheId ?? "").trim()
  if (!cacheId || cacheId.length > 100) {
    return NextResponse.json({ success: false, error: "Нужен cacheId" }, { status: 400 })
  }

  try {
    const cache = await prisma.atiCache.findFirst({
      where: scopedWhere(org.organizationId, { id: cacheId }),
      select: { id: true, firmId: true, contactPhone: true, contactName: true },
    })
    if (!cache) {
      return NextResponse.json({ success: false, error: "Груз не найден" }, { status: 404 })
    }

    // Телефон уже известен — ATI не дёргаем
    if (cache.contactPhone) {
      return NextResponse.json({
        success: true,
        phone: cache.contactPhone,
        name: cache.contactName ?? null,
        cached: true,
      })
    }

    if (!cache.firmId) {
      return NextResponse.json(
        { success: false, error: "У этого груза фрахтователь не указан — телефон не узнать" },
        { status: 422 },
      )
    }

    const ati = await getActiveAtiToken(org.organizationId)
    const contacts = await fetchFirmContacts(
      cache.firmId,
      ati.ok ? ati.token : null,
      org.organizationId,
    )

    if (!contacts.phone && !contacts.name) {
      return NextResponse.json(
        { success: false, error: "ATI не отдал контакт фрахтователя" },
        { status: 502 },
      )
    }

    if (contacts.phone || contacts.name) {
      await prisma.atiCache.updateMany({
        where: { id: cache.id, organizationId: org.organizationId },
        data: { contactPhone: contacts.phone ?? null, contactName: contacts.name ?? null },
      })
    }

    return NextResponse.json({
      success: true,
      phone: contacts.phone ?? null,
      name: contacts.name ?? null,
      cached: false,
    })
  } catch (error) {
    console.error("[ATI contacts] ошибка:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось получить контакт фрахтователя" },
      { status: 500 },
    )
  }
}
