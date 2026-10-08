// app/api/ati/oauth/start/route.ts
//
// Шаг 3 OAuth 2.0 ATI.SU: уводим админа организации на страницу согласия
// https://id.ati.su/oauth2/?client_id=…&scope=…&redirect_uri=…&response_type=code.
// После согласия ATI вернёт пользователя на /api/ati/oauth/callback с code.
//
// OAuth доступен, только если продукту выданы ATI_CLIENT_ID и ATI_CLIENT_SECRET
// (их получает интегратор заявкой в поддержку ATI.SU — один комплект на продукт,
// а не на организацию).

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization } from "@/lib/org"
import { buildOAuthStartUrl, oauthAvailable } from "@/lib/ati/connection"
import { appBaseUrl } from "@/lib/ati/oauth-shared"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  if (!["admin", "logist"].includes(auth.value.user.role)) {
    return NextResponse.json(
      { success: false, error: "Подключать ATI.SU могут сотрудники штаба" },
      { status: 403 },
    )
  }

  if (!oauthAvailable()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "OAuth не настроен: серверу нужны ATI_CLIENT_ID и ATI_CLIENT_SECRET. До их получения подключите постоянный токен из «Мои токены» ATI.SU",
      },
      { status: 400 },
    )
  }

  const redirectUri = `${appBaseUrl(request)}/api/ati/oauth/callback`
  return NextResponse.redirect(buildOAuthStartUrl(redirectUri), 302)
}
