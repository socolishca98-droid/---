// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyPassword, signJwt, setStaffAuthCookie } from "@/lib/auth-server"
import { ensureDbInitialized } from "@/lib/db-init"

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

    if (password.length < 1 || password.length > 128) {
      return NextResponse.json(
        { success: false, error: "Неверный email или пароль" },
        { status: 401 }
      )
    }

    const cleanEmail = email.trim().toLowerCase()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(cleanEmail)) {
      return NextResponse.json(
        { success: false, error: "Неверный email или пароль" },
        { status: 401 }
      )
    }
    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
    })

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Неверный email или пароль" },
        { status: 401 }
      )
    }

    const isValid = verifyPassword(password, user.salt, user.passwordHash)
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: "Неверный email или пароль" },
        { status: 401 }
      )
    }

    // Проверка статуса пользователя
    if (user.status === "pending_approval") {
      return NextResponse.json(
        {
          success: false,
          error: "Ваша регистрация ожидает одобрения администратором/логистом. Доступ будет открыт после подтверждения.",
          status: "pending_approval",
        },
        { status: 403 }
      )
    }

    if (user.status === "deactivated") {
      return NextResponse.json(
        {
          success: false,
          error: "Ваш аккаунт деактивирован. Для восстановления доступа обратитесь к руководителю.",
          status: "deactivated",
        },
        { status: 403 }
      )
    }

    // Создаем подписанный токен
    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name || user.email,
    })

    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        role: user.role,
        status: user.status,
      },
    })

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
