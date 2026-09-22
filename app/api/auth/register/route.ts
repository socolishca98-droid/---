// app/api/auth/register/route.ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hashPassword } from "@/lib/auth-server"
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
    const { email, password, name } = body as {
      email?: string
      password?: string
      name?: string
    }

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email и пароль обязательны" },
        { status: 400 }
      )
    }

    const cleanEmailForRate = email.trim().toLowerCase()
    const ip = getClientIp(req)
    const rateKey = `register:${ip}:${cleanEmailForRate}`
    const rlCheck = checkRateLimit(rateKey)
    if (!rlCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: "Слишком много попыток регистрации. Попробуйте позже.",
        },
        { status: 429, headers: buildRateLimitHeaders(rlCheck) }
      )
    }

    if (password.length < 8) {
      const after = recordFailure(rateKey)
      return NextResponse.json(
        { success: false, error: "Пароль должен содержать не менее 8 символов" },
        { status: 400, headers: buildRateLimitHeaders(after) }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      const after = recordFailure(rateKey)
      return NextResponse.json(
        { success: false, error: "Некорректный формат email" },
        { status: 400, headers: buildRateLimitHeaders(after) }
      )
    }

    const cleanEmail = email.trim().toLowerCase()
    const existing = await prisma.user.findUnique({
      where: { email: cleanEmail },
    })

    if (existing) {
      return NextResponse.json(
        { success: false, error: "Пользователь с таким email уже зарегистрирован" },
        { status: 400, headers: buildRateLimitHeaders(rlCheck) }
      )
    }

    const { salt, hash } = hashPassword(password)

    const user = await prisma.user.create({
      data: {
        email: cleanEmail,
        name: name?.trim() || cleanEmail.split("@")[0],
        passwordHash: hash,
        salt,
        role: "logist",
        status: "pending_approval",
      },
    })

    await prisma.notification.create({
      data: {
        userId: "all_logists",
        userRole: "admin",
        type: "user_registered",
        title: "Новая заявка на регистрацию",
        message: `Сотрудник ${user.name} (${user.email}) подал заявку на доступ в Loginex. Требуется одобрение.`,
        priority: "high",
      },
    })

    resetRateLimit(rateKey)

    return NextResponse.json(
      {
        success: true,
        message:
          "Заявка на регистрацию отправлена. Она будет активирована после одобрения логистом или администратором.",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
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
  } catch (error: any) {
    console.error("[Auth Register] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Ошибка при регистрации" },
      { status: 500 }
    )
  }
}
