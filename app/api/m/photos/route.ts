// app/api/m/photos/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { forbidden, requireDriver } from "@/lib/auth/session"
import { logRouteEvent } from "@/lib/routes/service"
// Получить фото водителя (только свои)
export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const driverId = auth.value.driver.id

  try {
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get("orderId")
    const type = searchParams.get("type")

    const where: Record<string, string> = { driverId }
    if (orderId) where.orderId = orderId
    if (type) where.type = type

    const photos = await prisma.photo.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    return NextResponse.json({
      success: true,
      photos,
    })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error"
    console.error("[Photos GET] Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}

// Загрузить новое фото (JSON: { orderId, type, url, description })
// Автор фото всегда берётся из сессии — driverId в теле запроса игнорируется
export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const driverId = auth.value.driver.id

  try {
    const body = await request.json()
    const { orderId, type, url, description } = body

    if (!type || !url) {
      return NextResponse.json(
        {
          success: false,
          error: "type и url обязательны",
        },
        { status: 400 },
      )
    }

    const validTypes = [
      "cargo_before",
      "cargo_after",
      "receipt",
      "waybill",
      "damage",
      "document",
    ]

    if (!validTypes.includes(type)) {
      return NextResponse.json(
        {
          success: false,
          error: `Неверный тип фото. Допустимые: ${validTypes.join(", ")}`,
        },
        { status: 400 },
      )
    }

    const photo = await prisma.photo.create({
      data: {
        driverId,
        orderId: orderId || null,
        type,
        url,
        description: description || null,
      },
    })

    // Событие в таймлайне рейса (если фото привязано к заказу с маршрутом)
    try {
      let routeId: string | null = null
      let vehicleId: string | null = null

      if (orderId) {
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            routeId: true,
            assignedVehicleId: true,
          },
        })
        if (order?.routeId) {
          routeId = order.routeId
          vehicleId = order.assignedVehicleId ?? null
        }
      }

      if (routeId) {
        await logRouteEvent(prisma, {
          routeId,
          driverId,
          vehicleId,
          orderId: orderId || null,
          type: "photo",
          status: type,
          data: description ? JSON.stringify({ description }) : null,
        })
      }
    } catch (e) {
      console.error("[Photos POST] routeEvent error:", e)
    }

    // Создаём уведомление для логиста
    await prisma.notification.create({
      data: {
        userId: "logist",
        userRole: "logist",
        type: "new_photo",
        title: "Новое фото от водителя",
        message: `Водитель загрузил фото: ${type}`,
        driverId,
        orderId: orderId || null,
        photoId: photo.id,
        priority: type === "damage" ? "high" : "normal",
      },
    })

    return NextResponse.json({
      success: true,
      photo,
    })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error"
    console.error("[Photos POST] Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}

// Удалить фото — только своё
export async function DELETE(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id обязателен" },
        { status: 400 },
      )
    }

    const photo = await prisma.photo.findUnique({
      where: { id },
      select: { id: true, driverId: true },
    })

    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Фото не найдено" },
        { status: 404 },
      )
    }

    if (photo.driverId !== auth.value.driver.id) {
      return forbidden("Можно удалять только свои фото")
    }

    await prisma.photo.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error"
    console.error("[Photos DELETE] Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}