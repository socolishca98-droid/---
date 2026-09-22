// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyPassword, signJwt, setStaffAuthCookie } from "@/lib/auth-server"
import { ensureDbInitialized } from "@/lib/db-init"
import {
  getClientIp,
  checkRateLimit,
  recordFailure,
  resetRateLimit,
  buildRateLimitHeaders,
} from "@/lib/rate-limiter"

export async function POST(req: NextRequest) {
  try {
    await ensureDbInitialized()

    const body = await req.json()
    const { email, password } = body as { email?: string; password?: string }

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Укажите email и пароль" },
        { status: 400 }
      )
    }

    const cleanEmail = email.trim().toLowerCase()
    const ip = getClientIp(req)
    const rateKey = `staff:${ip}:${cleanEmail}`

    const rlCheck = checkRateLimit(rateKey)
    if (!rlCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: "Слишком много попыток входа. Попробуйте через 15 минут.",
        },
        { status: 429, headers: buildRateLimitHeaders(rlCheck) }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(cleanEmail) || password.length < 1 || password.length > 128) {
      const after = recordFailure(rateKey)
      return NextResponse.json(
        { success: false, error: "Неверный email или пароль" },
        { status: 401, headers: buildRateLimitHeaders(after) }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
    })

    if (!user) {
      const after = recordFailure(rateKey)
      return NextResponse.json(
        { success: false, error: "Неверный email или пароль" },
        { status: 401, headers: buildRateLimitHeaders(after) }
      )
    }

    const isValid = verifyPassword(password, user.salt, user.passwordHash)
    if (!isValid) {
      const after = recordFailure(rateKey)
      return NextResponse.json(
        { success: false, error: "Неверный email или пароль" },
        { status: 401, headers: buildRateLimitHeaders(after) }
      )
    }

    // Проверка статуса пользователя
    if (user.status === "pending_approval") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Ваша регистрация ожидает одобрения администратором/логистом. Доступ будет открыт после подтверждения.",
          status: "pending_approval",
        },
        { status: 403, headers: buildRateLimitHeaders(rlCheck) }
      )
    }

    if (user.status === "deactivated") {
      return NextResponse.json(
        {
          success: false,
          error: "Ваш аккаунт деактивирован. Для восстановления доступа обратитесь к руководителю.",
          status: "deactivated",
        },
        { status: 403, headers: buildRateLimitHeaders(rlCheck) }
      )
    }

    // Успешный вход — сбрасываем счетчик
    resetRateLimit(rateKey)

    // Создаем подписанный токен
    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name || user.email,
    })

    const response = NextResponse.json(
      {
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name || user.email,
          role: user.role,
          status: user.status,
        },
      },
      {
        headers: buildRateLimitHeaders({
          allowed: true,
          remaining: 5,
          resetAt: Date.now() + 15 * 60 * 1000,
          currentCount: 0,
        }),
      }
    )

    setStaffAuthCookie(response, token)
    return response
  } catch (error: any) {
    console.error("[Auth Login] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Ошибка сервера при входе" },
      { status: 500 }
    )
  }
}
