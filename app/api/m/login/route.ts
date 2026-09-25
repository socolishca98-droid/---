/**
 * POST /api/m/login — вход водителя в мобильное приложение.
 *
 * Было: организация «АИ Логистика» (захардкожена) + телефон, после чего клиент
 * сам хранил driverId в localStorage и присылал его в каждый запрос — то есть
 * любой, знающий телефон водителя, получал доступ к его данным.
 *
 * Стало: телефон + пароль, проверка на сервере (общая логика lib/auth/login.ts),
 * выдача подписанного токена в httpOnly-cookie и строки Session в БД.
 * Все /api/m/* берут driverId из проверенной сессии, а не из запроса.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { authenticateWithPassword } from "@/lib/auth/login"
import { sessionCookie } from "@/lib/auth/session"
import {
  buildRateLimitHeaders,
  checkRateLimit,
  getClientIp,
  recordFailure,
  resetRateLimit,
} from "@/lib/rate-limiter"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  let body: { phone?: unknown; password?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Некорректное тело запроса" },
      { status: 400 },
    )
  }

  const identifier = String(body.phone ?? "")
  const rateLimitKey = `m-login:${getClientIp(request)}:${identifier.replace(/\D/g, "")}`
  const rateLimit = checkRateLimit(rateLimitKey)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Слишком много неудачных попыток входа. Повторите через 15 минут",
        code: "rate_limited",
      },
      { status: 429, headers: buildRateLimitHeaders(rateLimit) },
    )
  }

  try {
    const result = await authenticateWithPassword({
      identifier,
      password: String(body.password ?? ""),
      expectedRoles: ["driver"],
      kind: "driver",
      request,
    })

    if (!result.ok) {
      const afterFailure = recordFailure(rateLimitKey)
      return NextResponse.json(
        { success: false, error: result.error, code: result.code },
        {
          status: afterFailure.allowed ? result.status : 429,
          headers: buildRateLimitHeaders(afterFailure),
        },
      )
    }

    resetRateLimit(rateLimitKey)

    if (!result.driverId) {
      return NextResponse.json(
        {
          success: false,
          error: "Учётная запись не привязана к карточке водителя. Обратитесь к логисту",
          code: "not_found",
        },
        { status: 403 },
      )
    }

    const driver = await prisma.driver.findUnique({
      where: { id: result.driverId },
      select: {
        id: true,
        name: true,
        phone: true,
        vehicleId: true,
        vehicleType: true,
        vehiclePlate: true,
        status: true,
        rating: true,
        ordersCompleted: true,
      },
    })

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Карточка водителя не найдена" },
        { status: 404 },
      )
    }

    const response = NextResponse.json({
      success: true,
      mustChangePassword: result.mustChangePassword,
      driver: {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        vehicleId: driver.vehicleId,
        vehicleType: driver.vehicleType,
        vehiclePlate: driver.vehiclePlate,
        status: driver.status,
        rating: driver.rating,
        ordersCompleted: driver.ordersCompleted,
      },
    })
    response.cookies.set(sessionCookie(result.session.cookieName, result.session.token))
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[m/login] error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось выполнить вход. Попробуйте ещё раз" },
      { status: 500 },
    )
  }
}
