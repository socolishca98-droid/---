// app/api/auth/login/route.ts - P1-5 refresh + P1-6 zod
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  verifyPassword,
  signAccessJwt,
  signRefreshJwt,
  setStaffAuthCookie,
  setStaffRefreshCookie,
  STAFF_REFRESH_EXPIRES_IN,
} from "@/lib/auth-server"
import { ensureDbInitialized } from "@/lib/db-init"
import {
  getClientIp,
  checkRateLimit,
  recordFailure,
  resetRateLimit,
  buildRateLimitHeaders,
} from "@/lib/rate-limiter"
import { generateJti, createRefreshEntry } from "@/lib/refresh-tokens"
import { loginSchema, zodErrorResponse } from "@/lib/validators"

export async function POST(req: NextRequest) {
  try {
    await ensureDbInitialized()

    const rawBody = await req.json().catch(() => null)
    if (!rawBody) {
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
    }

    const parsed = loginSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(zodErrorResponse(parsed.error), { status: 400 })
    }

    const { email, password } = parsed.data
    const cleanEmail = email.trim().toLowerCase()
    const ip = getClientIp(req)
    const rateKey = `staff:${ip}:${cleanEmail}`

    const rlCheck = checkRateLimit(rateKey)
    if (!rlCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "Слишком много попыток входа. Попробуйте через 15 минут." },
        { status: 429, headers: buildRateLimitHeaders(rlCheck) }
      )
    }

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } })

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

    if (user.status === "pending_approval") {
      return NextResponse.json(
        {
          success: false,
          error: "Ваша регистрация ожидает одобрения администратором/логистом. Доступ будет открыт после подтверждения.",
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

    resetRateLimit(rateKey)

    const accessToken = signAccessJwt({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name || user.email,
    })

    const jti = generateJti()
    const refreshToken = signRefreshJwt(
      { sub: user.id, role: user.role as "admin" | "logist", jti },
      STAFF_REFRESH_EXPIRES_IN
    )

    createRefreshEntry({
      jti,
      userId: user.id,
      role: user.role as "admin" | "logist",
      expiresInMs: STAFF_REFRESH_EXPIRES_IN * 1000,
      ip,
    })

    const response = NextResponse.json(
      {
        success: true,
        token: accessToken,
        refreshToken,
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

    setStaffAuthCookie(response, accessToken)
    setStaffRefreshCookie(response, refreshToken)
    return response
  } catch (error: any) {
    console.error("[Auth Login] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Ошибка сервера при входе" },
      { status: 500 }
    )
  }
}
