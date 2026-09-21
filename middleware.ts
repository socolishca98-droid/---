/**
 * Middleware защиты всех страниц и /api/*.
 *
 * Что делает:
 *  1. Классифицирует путь (lib/auth/access.ts): публичный / штабной / водительский /
 *     любая роль / защищённый отдельным секретом.
 *  2. Проверяет подпись и срок действия сессионного токена в httpOnly-cookie
 *     (Web Crypto — работает в edge-окружении).
 *  3. Не пускает без валидного токена: API получает 401/403 JSON,
 *     страница — редирект на экран входа с сохранением ?next=.
 *  4. Вырезает входящие заголовки x-loginex-* (защита от подделки) и проставляет
 *     проверенные значения для обработчиков.
 *
 * Чего middleware НЕ делает (и не может в edge): обращения к базе.
 * Статус пользователя (pending/suspended), отзыв сессии и права на конкретную
 * запись проверяют серверные guard'ы в lib/auth/session.ts — они вызываются
 * в каждом обработчике /api. Поэтому middleware — это первый контур,
 * а не единственный.
 */

import { NextRequest, NextResponse } from "next/server"
import {
  DRIVER_COOKIE,
  IDENTITY_HEADERS,
  STAFF_COOKIE,
  STAFF_ROLES,
} from "@/lib/auth/constants"
import { acceptsDriver, acceptsStaff, classifyRoute } from "@/lib/auth/access"
import { AuthSecretError, verifySessionToken, type SessionTokenPayload } from "@/lib/auth/token"

export const config = {
  // Всё, кроме статики Next.js и файлов с расширениями
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|css|js|mjs|cjs|map|txt|json|webmanifest|woff2?|ttf|otf|pdf|mp3|wav|webm|mp4)$).*)",
  ],
}

function unauthorizedJson(error: string, status: 401 | 403) {
  return NextResponse.json({ success: false, error }, { status })
}

function stripIdentityHeaders(source: Headers): Headers {
  const headers = new Headers(source)
  headers.delete(IDENTITY_HEADERS.userId)
  headers.delete(IDENTITY_HEADERS.role)
  headers.delete(IDENTITY_HEADERS.sessionId)
  // На всякий случай — любые заголовки этого семейства
  for (const key of Array.from(headers.keys())) {
    if (key.toLowerCase().startsWith("x-loginex-")) headers.delete(key)
  }
  return headers
}

function withIdentity(
  request: NextRequest,
  payload: SessionTokenPayload | null,
): NextResponse {
  const headers = stripIdentityHeaders(request.headers)
  if (payload) {
    headers.set(IDENTITY_HEADERS.userId, payload.sub)
    headers.set(IDENTITY_HEADERS.role, payload.role)
    headers.set(IDENTITY_HEADERS.sessionId, payload.jti)
  }
  return NextResponse.next({ request: { headers } })
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const access = classifyRoute(pathname)

  let staffPayload: SessionTokenPayload | null = null
  let driverPayload: SessionTokenPayload | null = null

  try {
    const [staff, driver] = await Promise.all([
      verifySessionToken(request.cookies.get(STAFF_COOKIE)?.value),
      verifySessionToken(request.cookies.get(DRIVER_COOKIE)?.value),
    ])
    staffPayload = staff && staff.kind === "staff" && STAFF_ROLES.includes(staff.role) ? staff : null
    driverPayload = driver && driver.kind === "driver" && driver.role === "driver" ? driver : null
  } catch (error) {
    if (error instanceof AuthSecretError) {
      // Конфигурация сломана — закрываем доступ явно, а не «пускаем всех»
      const message = `${error.message}`
      if (access.isApi) {
        return NextResponse.json(
          { success: false, error: "Сервер не настроен: отсутствует AUTH_SECRET" },
          { status: 503 },
        )
      }
      return new NextResponse(
        `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Ошибка конфигурации</title></head>
         <body style="font-family:system-ui,sans-serif;background:#09090b;color:#fafafa;padding:48px;max-width:720px;margin:0 auto">
         <h1 style="font-size:20px">Сервер не настроен</h1>
         <p style="color:#a1a1aa;line-height:1.6">${message}</p>
         </body></html>`,
        { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
      )
    }
    // Любая другая ошибка проверки токена трактуется как «токена нет»
    staffPayload = null
    driverPayload = null
  }

  // --- Публичные пути -------------------------------------------------------
  if (access.area === "public") {
    // Уже вошедшего сотрудника не держим на экране входа
    if ((pathname === "/" || pathname === "/login") && staffPayload) {
      return NextResponse.redirect(new URL("/dashboard", request.url))
    }
    if (pathname === "/m/login" && driverPayload) {
      return NextResponse.redirect(new URL("/m", request.url))
    }
    return withIdentity(request, staffPayload ?? driverPayload)
  }

  // --- Пути с собственным секретом (cron) -----------------------------------
  if (access.area === "secret") {
    return withIdentity(request, null)
  }

  // --- Проверка роли --------------------------------------------------------
  const staffAllowed = acceptsStaff(access.area) && staffPayload !== null
  const driverAllowed = acceptsDriver(access.area) && driverPayload !== null
  const allowed = staffAllowed || driverAllowed

  if (!allowed) {
    const hasSomeToken = staffPayload !== null || driverPayload !== null

    if (access.isApi) {
      return unauthorizedJson(
        hasSomeToken
          ? "Недостаточно прав для этого действия"
          : "Требуется авторизация",
        hasSomeToken ? 403 : 401,
      )
    }

    const loginUrl = new URL(access.loginPath, request.url)
    const next = `${pathname}${search}`
    if (next && next !== access.loginPath) loginUrl.searchParams.set("next", next)
    return NextResponse.redirect(loginUrl)
  }

  return withIdentity(request, staffPayload ?? driverPayload)
}
