// app/api/ati/loads/contacts/route.ts
//
// POST /api/ati/loads/contacts — «Показать контакты фрахтователя».
//
// ТОЛЬКО по нажатию диспетчера. Автоматически контакты не собираются —
// за это ATI.SU делает замечания (пользовательское соглашение, п. 3.2.1.7:
// запрещён автоматизированный сбор контактной информации участников).
//
// Что делает: официальным методом API ATI
// (GET /v1.0/firms/{atiId}/contacts/summary) запрашивает контакт фирмы
// конкретного груза и кладёт его в этот груз в нашей базе. Запрос уходит
// ровно в тот момент, когда человек нажал кнопку, — как если бы он сам
// нажал «показать» на сайте ATI.
//
// Лимиты: ATI разрешает 1000 запросов реквизитов других фирм в сутки. Мы
// держим свой лимит — CONTACTS_DAILY_LIMIT на организацию в сутки, чтобы
// исчерпание лимита ATI не превратилось в отказ по всей бирже.
//
// Контакт остаётся в грузе у организации: повторное нажатие тот же груз уже
// не дёргает ATI.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { fetchFirmContacts, CONTACTS_DAILY_LIMIT } from "@/lib/ati/contacts"
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

    // Контакт уже показан раньше — ATI не дёргаем
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
        { success: false, error: "У этого груза фрахтователь не указан — контакт не узнать" },
        { status: 422 },
      )
    }

    // Свой дневной лимит: считаем грузы, у которых контакт уже показан за сутки
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const shownToday = await prisma.atiCache.count({
      where: scopedWhere(org.organizationId, {
        contactPhone: { not: null },
        scannedAt: { gte: dayAgo },
      }),
    })
    if (shownToday >= CONTACTS_DAILY_LIMIT) {
      return NextResponse.json(
        {
          success: false,
          error: `Сегодня контакты запрошены ${shownToday} раз — это наш дневной лимит. Остальное — завтра.`,
          code: "daily_limit",
        },
        { status: 429 },
      )
    }

    const ati = await getActiveAtiToken(org.organizationId)
    const contacts = await fetchFirmContacts(
      cache.firmId,
      ati.ok ? ati.token : null,
      org.organizationId,
    )

    if (!contacts.shown) {
      return NextResponse.json(
        {
          success: false,
          error:
            "ATI не отдала контакт этой фирмы. Она скрыла свои данные или вы не авторизованы на ATI.",
        },
        { status: 502 },
      )
    }

    await prisma.atiCache.updateMany({
      where: { id: cache.id, organizationId: org.organizationId },
      data: { contactPhone: contacts.phone ?? contacts.mobile ?? null, contactName: contacts.name },
    })

    return NextResponse.json({
      success: true,
      phone: contacts.phone ?? contacts.mobile ?? null,
      name: contacts.name ?? null,
      email: contacts.email,
      cached: false,
    })
  } catch (error) {
    console.error("[ATI contacts] ошибка:\n", error)
    return NextResponse.json(
      { success: false, error: "Не удалось получить контакт фрахтователя" },
      { status: 500 },
    )
  }
}
