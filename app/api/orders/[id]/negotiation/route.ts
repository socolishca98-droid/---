// app/api/orders/[id]/negotiation/route.ts
//
// Согласование заказа: лента переговоров и торг по цене.
//
//   GET  /api/orders/:id/negotiation — лента (заметки, предложения цены, звонки,
//        письма, документы, автоматические записи о смене цены и статуса)
//   POST /api/orders/:id/negotiation — добавить запись
//
// Что можно добавить вручную: note, price_offer, call, email, document.
// Записи price_change и status_change создаются только сервером — при изменении
// цены или статуса заказа (PATCH /api/orders/:id), поэтому история торга не
// теряется и не зависит от добросовестности логиста.
//
// Организация — из проверенной сессии: чужой заказ даёт 404 (а не 403), чтобы не
// подтверждать существование заказа в другой компании.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import {
  NEGOTIATION_KIND_LABELS,
  isNegotiationKind,
  type NegotiationKind,
} from "@/lib/orders/stages"

export const dynamic = "force-dynamic"

/** Виды записей, которые логист добавляет руками. */
const MANUAL_KINDS: NegotiationKind[] = ["note", "price_offer", "call", "email", "document"]

const MAX_TEXT = 2000

type RouteParams = { params: Promise<{ id: string }> }

/** Поля заказа, нужные в ленте согласования. */
const ORDER_SELECT = {
  id: true,
  status: true,
  negotiationStatus: true,
  price: true,
  agreedPrice: true,
  routeFrom: true,
  routeTo: true,
  clientName: true,
  clientContact: true,
  nextFollowUpAt: true,
} as const

function describeEntry(entry: any) {
  return {
    id: entry.id,
    orderId: entry.orderId,
    kind: entry.kind,
    kindLabel: NEGOTIATION_KIND_LABELS[entry.kind as NegotiationKind] ?? entry.kind,
    text: entry.text ?? null,
    priceOffer: entry.priceOffer ?? null,
    authorId: entry.authorId ?? null,
    authorName: entry.authorName ?? null,
    createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : null,
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const { id } = await params
  if (!id) {
    return NextResponse.json({ success: false, error: "Не указан заказ" }, { status: 400 })
  }

  try {
    const order = await prisma.order.findFirst({
      where: scopedWhere(org.organizationId, { id }),
      select: ORDER_SELECT,
    })
    if (!order) {
      return NextResponse.json({ success: false, error: "Заказ не найден" }, { status: 404 })
    }

    // org-audit: ok — заказ проверен на принадлежность организации выше (findFirst + scopedWhere)
    const entries = await prisma.orderNegotiation.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "desc" },
      take: 500,
    })

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        status: order.status,
        negotiationStatus: order.negotiationStatus,
        price: order.price,
        agreedPrice: order.agreedPrice,
        routeFrom: order.routeFrom,
        routeTo: order.routeTo,
        clientName: order.clientName,
        clientContact: order.clientContact,
        nextFollowUpAt: order.nextFollowUpAt
          ? new Date(order.nextFollowUpAt).toISOString()
          : null,
      },
      entries: entries.map(describeEntry),
    })
  } catch (error) {
    console.error("[orders/negotiation GET] error:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось загрузить согласование" },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const { id } = await params
  if (!id) {
    return NextResponse.json({ success: false, error: "Не указан заказ" }, { status: 400 })
  }

  let body: { kind?: unknown; text?: unknown; priceOffer?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Некорректное тело запроса" }, { status: 400 })
  }

  const kind = String(body.kind ?? "").trim()
  if (!isNegotiationKind(kind) || !MANUAL_KINDS.includes(kind)) {
    return NextResponse.json(
      {
        success: false,
        error: `Недопустимый тип записи. Доступно: ${MANUAL_KINDS.join(", ")}`,
      },
      { status: 400 },
    )
  }

  const text = body.text == null ? null : String(body.text).trim()
  if (text && text.length > MAX_TEXT) {
    return NextResponse.json(
      { success: false, error: `Слишком длинный текст (максимум ${MAX_TEXT} символов)` },
      { status: 400 },
    )
  }

  let priceOffer: number | null = null
  if (body.priceOffer !== undefined && body.priceOffer !== null && body.priceOffer !== "") {
    const parsed = Number(body.priceOffer)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        { success: false, error: "Цена должна быть числом не меньше нуля" },
        { status: 400 },
      )
    }
    priceOffer = Math.round(parsed)
  }

  if (kind === "price_offer" && priceOffer === null) {
    return NextResponse.json(
      { success: false, error: "Для предложения цены укажите сумму (priceOffer)" },
      { status: 400 },
    )
  }

  if (!text && priceOffer === null) {
    return NextResponse.json(
      { success: false, error: "Пустая запись: нужен текст или сумма" },
      { status: 400 },
    )
  }

  try {
    const order = await prisma.order.findFirst({
      where: scopedWhere(org.organizationId, { id }),
      select: ORDER_SELECT,
    })
    if (!order) {
      return NextResponse.json({ success: false, error: "Заказ не найден" }, { status: 404 })
    }

    // org-audit: ok — заказ проверен на принадлежность организации выше (findFirst + scopedWhere)
    const entry = await prisma.orderNegotiation.create({
      data: {
        organizationId: org.organizationId,
        orderId: order.id,
        kind,
        text,
        priceOffer,
        authorId: org.userId,
        authorName: auth.value.user.name ?? auth.value.user.email ?? null,
      },
    })

    return NextResponse.json({
      success: true,
      entry: describeEntry(entry),
      message: "Запись добавлена в согласование",
    })
  } catch (error) {
    console.error("[orders/negotiation POST] error:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось добавить запись" },
      { status: 500 },
    )
  }
}
