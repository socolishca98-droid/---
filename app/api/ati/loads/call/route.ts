// app/api/ati/loads/call/route.ts
//
// POST /api/ati/loads/call — «Уточнить стоимость по телефону».
//
// Что здесь важно и почему именно так:
//
//   · звонок делает ЧЕЛОВЕК. Программа не звонит и не придумывает результат.
//     Здесь только фиксируется, чем разговор закончился, — шесть исходов,
//     ровно те, что бывают в жизни;
//   · контакт берётся из предложения, если он уже был раскрыт кнопкой
//     «Контакты». Если контакта нет — так и говорим («контактов нет»), а не
//     подставляем выдуманный номер: ATI.SU запрещает автоматический сбор
//     контактов (соглашение, п. 3.2.1.7);
//   · если перевозчик назвал сумму, она становится согласованной ценой
//     заказа. Расчётная оценка при этом НЕ стирается: она остаётся в истории
//     (PriceEstimate), чтобы потом было видно, насколько расчёт врал.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { CALL_OUTCOMES, callHistory, recordPriceCall, type CallOutcome } from "@/lib/pricing/service"

export const dynamic = "force-dynamic"

const OUTCOMES = new Set(CALL_OUTCOMES.map((item) => item.value))

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const { searchParams } = new URL(request.url)
  const refKind = searchParams.get("refKind") === "order" ? "order" : "ati"
  const refId = String(searchParams.get("refId") ?? "").trim()
  if (!refId) {
    return NextResponse.json({ success: false, error: "Нужен refId" }, { status: 400 })
  }
  const calls = await callHistory(org.organizationId, refKind, refId)
  return NextResponse.json({ success: true, calls, outcomes: CALL_OUTCOMES })
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  let body: {
    cacheId?: unknown
    orderId?: unknown
    outcome?: unknown
    amountRub?: unknown
    note?: unknown
    markOrder?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
  }

  const outcome = String(body.outcome ?? "").trim() as CallOutcome
  if (!OUTCOMES.has(outcome)) {
    return NextResponse.json(
      { success: false, error: "Неизвестный исход звонка", outcomes: CALL_OUTCOMES },
      { status: 400 },
    )
  }

  const cacheId = String(body.cacheId ?? "").trim()
  const orderId = String(body.orderId ?? "").trim()
  if (!cacheId && !orderId) {
    return NextResponse.json({ success: false, error: "Нужен cacheId или orderId" }, { status: 400 })
  }

  const amountRaw = body.amountRub === null || body.amountRub === undefined ? null : Number(body.amountRub)
  if (amountRaw !== null && (!Number.isFinite(amountRaw) || amountRaw < 0)) {
    return NextResponse.json({ success: false, error: "Сумма должна быть числом" }, { status: 400 })
  }
  if ((outcome === "confirmed" || outcome === "proposed_other") && (!amountRaw || amountRaw <= 0)) {
    return NextResponse.json(
      {
        success: false,
        error:
          outcome === "confirmed"
            ? "Подтверждённая стоимость должна быть суммой больше нуля"
            : "Укажите сумму, которую предложил перевозчик",
      },
      { status: 400 },
    )
  }

  try {
    // Контакт и объект проверяются в рамках СВОЕЙ организации: чужой груз
    // недоступен, даже если id известен.
    let contactPhone: string | null = null
    let refKind: "ati" | "order" = cacheId ? "ati" : "order"
    let refId = cacheId || orderId

    if (cacheId) {
      const cache = await prisma.atiCache.findFirst({
        where: scopedWhere(org.organizationId, { id: cacheId }),
        select: { id: true, contactPhone: true },
      })
      if (!cache) {
        return NextResponse.json({ success: false, error: "Груз не найден" }, { status: 404 })
      }
      contactPhone = cache.contactPhone ?? null
    } else {
      const order = await prisma.order.findFirst({
        where: scopedWhere(org.organizationId, { id: orderId }),
        select: { id: true, clientContact: true },
      })
      if (!order) {
        return NextResponse.json({ success: false, error: "Заказ не найден" }, { status: 404 })
      }
      contactPhone = order.clientContact || null
    }

    const saved = await recordPriceCall({
      organizationId: org.organizationId,
      refKind,
      refId,
      outcome,
      amountRub: amountRaw,
      note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
      contactPhone,
      authorId: (auth.value as { userId?: string }).userId ?? null,
    })

    // «Заказчик не определился» и «не дозвонились» — это не отказ по грузу.
    // Меняем только отметку переговоров, статус заказа не трогаем.
    if (body.markOrder === true && cacheId && (outcome === "confirmed" || outcome === "proposed_other")) {
      await prisma.order.updateMany({
        where: { organizationId: org.organizationId, atiCacheId: cacheId },
        data: { agreedPrice: amountRaw ?? undefined, priceStatus: "CONFIRMED" },
      })
    }

    return NextResponse.json({
      success: true,
      call: {
        id: saved.call.id,
        outcome: saved.call.outcome,
        amountRub: saved.call.amountRub,
        createdAt: saved.call.createdAt,
      },
      // Честно про контакт: звонить было по чему или нет
      hasContact: Boolean(contactPhone),
      contactPhone,
      note: contactPhone ? null : "Контактов в предложении нет — номер нужно найти в ATI вручную",
      confirmedOrder: saved.confirmedOrder,
      outcomes: CALL_OUTCOMES,
    })
  } catch (error) {
    console.error("[Price call] ошибка:", error)
    return NextResponse.json({ success: false, error: "Не удалось записать результат звонка" }, { status: 500 })
  }
}
