// app/api/orders/from-cache/route.ts
//
// POST /api/orders/from-cache — «Взять в работу» груз из накопленной базы ATI.
//
// Зачем: раньше заказ рождался только в момент оформления рейса (POST /api/routes),
// а до рейса груз жил строкой общей таблицы AtiCache — без статуса, без заметок и
// без истории торгов. То есть этапов «Поиск» и «Согласование» у заказа физически
// не существовало. Теперь заказ создаётся в начале процесса:
//   Поиск → Согласование → Маршрут → Документы → Назначение → Контроль.
//
// Три правила, которые здесь важны:
//  1. AtiCache — ОБЩАЯ таблица (биржа грузов). Мы её не помечаем и не меняем:
//     иначе груз, взятый одной организацией, исчез бы из базы у других
//     (прежний /api/ati/import ставил status="imported" именно так).
//  2. organizationId берётся из проверенной сессии, а не из тела запроса.
//  3. Внутри организации один груз берётся один раз: @@unique([organizationId, atiCacheId])
//     → повторный запрос возвращает 409 и уже созданный заказ.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { linkOrderToClientByName } from "@/lib/clients/service"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/rate-limiter"
import { normalizeOrderStatus, orderStageOf, orderStatusLabel } from "@/lib/orders/stages"
import { fetchFirmContacts } from "@/lib/ati/contacts"

export const dynamic = "force-dynamic"

/** Груз можно взять в работу, пока он не помечен снятым/неактуальным. */
const UNAVAILABLE_CACHE_STATUSES = ["expired", "archived"] as const

function publicOrder(order: {
  id: string
  status: string
  atiCacheId: string | null
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  price: number | null
  agreedPrice: number | null
  negotiationStatus: string
  cargoType: string
  clientName: string | null
  clientContact: string
  deadline: Date
  createdAt: Date
}) {
  const status = normalizeOrderStatus(order.status) ?? "search"
  return {
    ...order,
    status,
    stage: orderStageOf(status),
    statusLabel: orderStatusLabel(status),
    createdAt: order.createdAt.toISOString(),
    deadline: order.deadline.toISOString(),
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  let body: { cacheId?: unknown; fetchContacts?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
  }

  const cacheId = String(body.cacheId ?? "").trim()
  if (!cacheId || cacheId.length > 100) {
    return NextResponse.json(
      { success: false, error: "Нужен cacheId — идентификатор груза в накопленной базе" },
      { status: 400 },
    )
  }

  try {
    // org-audit: manual — AtiCache общая таблица (биржа грузов): организация к ней
    // не применяется намеренно, а созданный заказ получает организацию из сессии
    const cache = await prisma.atiCache.findUnique({ where: { id: cacheId } })
    if (!cache) {
      return NextResponse.json(
        { success: false, error: "Груз в накопленной базе не найден" },
        { status: 404 },
      )
    }

    if (UNAVAILABLE_CACHE_STATUSES.includes(cache.status as never)) {
      return NextResponse.json(
        { success: false, error: "Груз снят или неактуален — взять в работу нельзя" },
        { status: 410 },
      )
    }

    // Этот груз уже взят нашей организацией? Не плодим дубликаты.
    const existing = await prisma.order.findFirst({
      where: scopedWhere(org.organizationId, { atiCacheId: cache.id }),
      select: {
        id: true,
        status: true,
        atiCacheId: true,
        routeFrom: true,
        routeTo: true,
        distance: true,
        weight: true,
        price: true,
        agreedPrice: true,
        negotiationStatus: true,
        cargoType: true,
        clientName: true,
        clientContact: true,
        deadline: true,
        createdAt: true,
      },
    })
    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: "Этот груз уже взят в работу вашей организацией",
          code: "already_taken",
          order: publicOrder(existing),
        },
        { status: 409 },
      )
    }

    // Контакты добираем живым запросом к ATI только по явному флагу: это
    // обращение во внешнюю систему, по умолчанию оно не выполняется.
    // Результат пишем в строку общей базы (контакты — свойство груза, а не
    // принадлежность организации), статус строки не меняем.
    let contactPhone: string | null = cache.contactPhone || null
    let contactName: string | null = cache.contactName || null
    let contactEmail: string | null = null
    if (body.fetchContacts === true && cache.firmId && (!contactPhone || !contactName)) {
      try {
        const fetched = await fetchFirmContacts(cache.firmId)
        contactPhone = contactPhone || fetched.phone || null
        contactName = contactName || fetched.name || null
        contactEmail = fetched.email || null
        if (contactPhone || contactName) {
          await prisma.atiCache.updateMany({
            where: { id: cache.id },
            data: { contactPhone, contactName },
          })
        }
      } catch (error) {
        // живой ATI недоступен — груз всё равно можно взять в работу
        console.error("[orders/from-cache] контакты не получены:", error)
      }
    }

    const loadingDate = cache.loadingDate instanceof Date ? cache.loadingDate : null
    const created = await prisma.order.create({
      data: {
        organizationId: org.organizationId,
        source: "ATI",
        sourceId: cache.atiLoadId ? String(cache.atiLoadId) : null,
        atiCacheId: cache.id,
        routeFrom: cache.routeFrom,
        routeTo: cache.routeTo,
        distance: cache.distance ?? 0,
        weight: cache.weight ?? 0,
        volume: cache.volume ?? null,
        cargoType: cache.cargoType || "Груз",
        loadingType: cache.loadingType || "other",
        requirements: cache.note || null,
        price: cache.price ?? 0,
        priceNegotiable: !cache.price,
        paymentType: cache.paymentType || null,
        clientName: cache.firmName || null,
        clientContact: contactPhone || "",
        clientFirmId: cache.firmId ? String(cache.firmId) : null,
        // срок: дата погрузки из карточки груза, иначе неделя на согласование
        deadline: loadingDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: "search",
        negotiationStatus: "new",
        takenAt: new Date(),
        takenById: org.userId,
        aiScore: cache.aiScore ?? 50,
        aiReason: cache.aiReason ?? null,
      },
      select: {
        id: true,
        status: true,
        atiCacheId: true,
        routeFrom: true,
        routeTo: true,
        distance: true,
        weight: true,
        price: true,
        agreedPrice: true,
        negotiationStatus: true,
        cargoType: true,
        clientName: true,
        clientContact: true,
        deadline: true,
        createdAt: true,
      },
    })

    // Клиентская база (задача 5): груз из общей базы тоже попадает в историю
    // клиента, если его карточка уже заведена. Нет карточки — не выдумываем.
    if (created.clientName) {
      await linkOrderToClientByName({
        organizationId: org.organizationId,
        orderId: created.id,
        clientName: created.clientName,
      })
    }

    await logAudit({
      organizationId: org.organizationId,
      actorId: org.userId,
      actorEmail: auth.value.user.email ?? null,
      action: "order_take_from_base",
      targetId: created.id,
      targetType: "order",
      metadata: {
        atiCacheId: cache.id,
        atiLoadId: cache.atiLoadId ? String(cache.atiLoadId) : null,
        routeFrom: created.routeFrom,
        routeTo: created.routeTo,
        status: created.status,
      },
      ip: getClientIp(request),
    })

    return NextResponse.json({
      success: true,
      order: publicOrder(created),
      contacts: {
        name: contactName,
        phone: contactPhone,
        email: contactEmail,
        firmName: cache.firmName || null,
        firmId: cache.firmId ? String(cache.firmId) : null,
      },
      message: "Груз взят в работу — этап «Поиск». Дальше согласование.",
    })
  } catch (error) {
    // Нарушение уникальности (гонка двух одновременных «взять в работу»)
    const message = error instanceof Error ? error.message : "Неизвестная ошибка"
    if (/Unique constraint/i.test(message) || /organizationId_atiCacheId/.test(message)) {
      return NextResponse.json(
        {
          success: false,
          error: "Этот груз уже взят в работу вашей организацией",
          code: "already_taken",
        },
        { status: 409 },
      )
    }
    console.error("[orders/from-cache] error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось взять груз в работу" },
      { status: 500 },
    )
  }
}
