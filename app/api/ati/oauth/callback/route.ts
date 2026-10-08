// app/api/ati/oauth/callback/route.ts
//
// Шаги 4–5 OAuth 2.0 ATI.SU: пользователь вернулся с code после согласия.
// Обмениваем code на access_token (2 часа) + refresh_token и сохраняем
// подключение организации (шифрованием AES-256-GCM — lib/ati/secrets.ts).
// Дальше lib/ati/connection.ts обновляет access_token автоматически.

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization } from "@/lib/org"
import { exchangeOAuthCode } from "@/lib/ati/connection"
import { appBaseUrl } from "@/lib/ati/oauth-shared"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const base = appBaseUrl(request)

  if (!["admin", "logist"].includes(auth.value.user.role)) {
    return NextResponse.redirect(`${base}/organization?ati=error_admin`, 302)
  }

  const code = request.nextUrl.searchParams.get("code")
  if (!code) {
    return NextResponse.redirect(`${base}/organization?ati=error_nocode`, 302)
  }

  const redirectUri = `${base}/api/ati/oauth/callback`
  const result = await exchangeOAuthCode(org.organizationId, code, redirectUri)
  if (!result.ok) {
    return NextResponse.redirect(
      `${base}/organization?ati=error_exchange&reason=${encodeURIComponent(result.error)}`,
      302,
    )
  }

  return NextResponse.redirect(`${base}/organization?ati=connected`, 302)
}
