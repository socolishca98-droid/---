/**
 * POST /api/auth/register — самостоятельная регистрация сотрудника.
 *
 * Схема, которую требует продукт:
 *   человек регистрируется (email + пароль)
 *     → статус «ожидает одобрения» (pending)
 *     → логист одобряет на странице /users
 *     → только после этого вход разрешён.
 *
 * Аварийный режим: если в базе нет НИ ОДНОЙ учётной записи, первая регистрация
 * становится администратором со статусом active — иначе одобрять её некому.
 * Основной способ завести администратора — `npm run seed:auth` (ADMIN_EMAIL/ADMIN_PASSWORD).
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password"

export const dynamic = "force-dynamic"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_NAME_LENGTH = 80

export async function POST(request: NextRequest) {
  let body: { name?: unknown; email?: unknown; password?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Некорректное тело запроса" },
      { status: 400 },
    )
  }

  const name = String(body.name ?? "").trim()
  const email = String(body.email ?? "").trim().toLowerCase()
  const password = String(body.password ?? "")

  if (name.length < 2 || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { success: false, error: "Укажите имя и фамилию (от 2 до 80 символов)" },
      { status: 400 },
    )
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { success: false, error: "Некорректный email" },
      { status: 400 },
    )
  }
  const strength = validatePasswordStrength(password)
  if (!strength.ok) {
    return NextResponse.json({ success: false, error: strength.error }, { status: 400 })
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      // Не раскрываем, зарегистрирован ли адрес: сообщение одинаковое для всех случаев
      return NextResponse.json(
        {
          success: false,
          error: "Регистрация с этим email невозможна. Обратитесь к администратору",
          code: "email_taken",
        },
        { status: 409 },
      )
    }

    const totalUsers = await prisma.user.count()
    const bootstrap = totalUsers === 0

    const { hash, salt } = await hashPassword(password)

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: hash,
        passwordSalt: salt,
        role: bootstrap ? "admin" : "logist",
        status: bootstrap ? "active" : "pending",
        approvedAt: bootstrap ? new Date() : null,
      },
      select: { id: true, email: true, name: true, role: true, status: true },
    })

    if (bootstrap) {
      console.warn(
        "[auth/register] В базе не было ни одной учётной записи — первая регистрация " +
          `получила роль admin (${email}). Для планового создания администратора используйте npm run seed:auth`,
      )
    }

    return NextResponse.json({
      success: true,
      status: user.status,
      bootstrapped: bootstrap,
      message: bootstrap
        ? "Учётная запись администратора создана. Вход доступен сразу"
        : "Заявка на регистрацию отправлена. Вход станет доступен после одобрения логиста",
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[auth/register] error:", message)

    // Гонка при одновременной регистрации одного email
    if (message.includes("Unique constraint")) {
      return NextResponse.json(
        { success: false, error: "Регистрация с этим email невозможна" },
        { status: 409 },
      )
    }

    return NextResponse.json(
      { success: false, error: "Не удалось отправить заявку. Попробуйте ещё раз" },
      { status: 500 },
    )
  }
}
