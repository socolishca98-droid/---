// app/api/auth/reset-password/route.ts
//
// «Забыли пароль» — второй шаг: по ссылке из письма человек задаёт новый пароль.
//
// GET  ?token=… — проверить ссылку до отправки формы (чтобы не заставлять
//                 придумывать пароль для мёртвой ссылки).
// POST {token, password} — сменить пароль.
//
// Что важно:
//   * токен одноразовый и с сроком (проверка в lib/password-reset.ts);
//   * успешная смена отзывает ВСЕ сессии человека — если пароль меняли из-за
//     чужого доступа, чужие сессии не должны продолжать работать;
//   * на изменение пароля тоже есть ограничитель попыток: перебор токена
//     бессмыслен, но и шум в логах никому не нужен.

import { NextRequest, NextResponse } from "next/server"

import {
  checkPasswordResetToken,
  resetPasswordWithToken,
} from "@/lib/password-reset"
import { validatePasswordStrength } from "@/lib/auth/password"
import {
  buildRateLimitHeaders,
  checkRateLimitAsync,
  getClientIp,
  recordFailureAsync,
} from "@/lib/rate-limiter"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? ""
  const result = await checkPasswordResetToken(token)

  if (!result.valid) {
    return NextResponse.json(
      { success: false, valid: false, error: result.error },
      { status: 400 },
    )
  }

  return NextResponse.json({ success: true, valid: true })
}

export async function POST(request: NextRequest) {
  let body: { token?: unknown; password?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Некорректный запрос" },
      { status: 400 },
    )
  }

  const rateLimitKey = `pw-reset-use:${getClientIp(request)}`
  const rateLimit = await checkRateLimitAsync(rateLimitKey)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Слишком много попыток. Повторите позже",
        code: "rate_limited",
      },
      { status: 429, headers: buildRateLimitHeaders(rateLimit) },
    )
  }

  const token = String(body.token ?? "").trim()
  const password = String(body.password ?? "")

  const strength = validatePasswordStrength(password)
  if (!strength.ok) {
    // Неудачная попытка считается: иначе форму можно долбить разными паролями
    await recordFailureAsync(rateLimitKey)
    return NextResponse.json({ success: false, error: strength.error }, { status: 400 })
  }

  try {
    const outcome = await resetPasswordWithToken({ token, newPassword: password })

    if (!outcome.ok) {
      await recordFailureAsync(rateLimitKey)
      const status = outcome.code === "expired_token" ? 410 : 400
      return NextResponse.json(
        { success: false, error: outcome.error, code: outcome.code },
        { status },
      )
    }

    return NextResponse.json({
      success: true,
      message: "Пароль изменён. Войдите с новым паролем — прежние сессии закрыты",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сменить пароль"
    console.error("[reset-password] error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось сменить пароль. Попробуйте позже" },
      { status: 500 },
    )
  }
}
