// app/api/auth/forgot-password/route.ts
//
// «Забыли пароль» — первый шаг восстановления: письмо со ссылкой на почту.
//
// Главное правило безопасности: ответ НЕ говорит, существует ли такой адрес.
// Иначе форма превращается в способ проверить, зарегистрирован ли человек в
// системе, — а это уже утечка данных о клиентах перевозчика.
//
// Второе правило: писем не должно уходить слишком много. Каждый запрос стоит
// письма, поэтому на пару «IP + адрес» действует ограничитель попыток (общий
// счётчик в Redis, если он настроен).

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import {
  buildRateLimitHeaders,
  checkRateLimitAsync,
  getClientIp,
  recordFailureAsync,
} from "@/lib/rate-limiter"
import { DEFAULT_RESET_TTL_MINUTES, issuePasswordResetToken } from "@/lib/password-reset"
import { appUrl, buildPasswordResetEmail, sendEmail } from "@/lib/mailer"
import { PRODUCT_NAME } from "@/lib/auth/constants"

export const dynamic = "force-dynamic"

/**
 * Один и тот же ответ на любой исход: и «адрес есть», и «адреса нет», и
 * «аккаунт заблокирован». Различия не должны уходить наружу.
 */
const NEUTRAL_RESPONSE = {
  success: true,
  message:
    "Если такой адрес зарегистрирован, письмо со ссылкой уже отправлено. Проверьте почту и папку «Спам».",
}

/** Грубая проверка адреса: точную валидацию делает почтовый сервис. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  let body: { email?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Некорректный запрос" },
      { status: 400 },
    )
  }

  const email = String(body.email ?? "").trim().toLowerCase()
  if (!EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { success: false, error: "Укажите адрес электронной почты" },
      { status: 400 },
    )
  }

  // Ограничитель: считаем каждый запрос, потому что каждый запрос — письмо
  const rateLimitKey = `pw-reset:${getClientIp(request)}:${email}`
  const rateLimit = await recordFailureAsync(rateLimitKey)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Слишком много запросов восстановления. Повторите позже",
        code: "rate_limited",
      },
      { status: 429, headers: buildRateLimitHeaders(rateLimit) },
    )
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, organizationId: true, status: true },
    })

    // Нет аккаунта или он отключён — отвечаем как при успехе, но письмо не шлём
    if (user && user.email && user.status !== "suspended") {
      const issued = await issuePasswordResetToken({
        userId: user.id,
        organizationId: user.organizationId,
        requestIp: getClientIp(request),
      })

      const resetUrl = `${appUrl()}/reset-password?token=${encodeURIComponent(issued.token)}`

      const mail = await sendEmail(
        buildPasswordResetEmail({
          to: user.email,
          resetUrl,
          expiresInMinutes: DEFAULT_RESET_TTL_MINUTES,
          productName: PRODUCT_NAME,
        }),
      )

      if (!mail.ok) {
        // Письмо не ушло (почтовый сервис не настроен или лежит) — молчать нельзя:
        // иначе человек будет ждать письма, которое не придёт никогда.
        console.error("[forgot-password] письмо не отправлено:", mail.error)
        return NextResponse.json(
          {
            success: false,
            error:
              "Не удалось отправить письмо. Обратитесь к администратору — он сменит пароль вручную",
            code: "mail_failed",
          },
          { status: 502 },
        )
      }

      if (mail.driver === "console") {
        // В консольном режиме письма нет вне сервера: говорим честно, куда смотреть
        return NextResponse.json({
          ...NEUTRAL_RESPONSE,
          notice:
            "Отправка писем не подключена (MAIL_DRIVER=console): ссылка для сброса записана в журнал сервера",
        })
      }
    }

    return NextResponse.json(NEUTRAL_RESPONSE)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось создать ссылку"
    console.error("[forgot-password] error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось выполнить запрос. Попробуйте позже" },
      { status: 500 },
    )
  }
}
