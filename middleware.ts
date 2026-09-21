// middleware.ts
import { NextResponse, type NextRequest } from "next/server"
import { verifyJwtEdge } from "@/lib/jwt-edge"

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "loginex_jwt_secret_salt_k9x2m4p8"
const STAFF_COOKIE_NAME = "loginex_token"
const DRIVER_COOKIE_NAME = "loginex_driver_token"

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 1. Пропускаем статику, иконки, системные эндпоинты Next.js
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/m/login") ||
    pathname.startsWith("/api/health") ||
    pathname === "/favicon.ico" ||
    pathname.includes(".") // файлы .png, .jpg, .svg, .css, etc.
  ) {
    return NextResponse.next()
  }

  const staffToken = req.cookies.get(STAFF_COOKIE_NAME)?.value
  const driverToken = req.cookies.get(DRIVER_COOKIE_NAME)?.value

  // Проверка сессии логиста/админа
  let isStaffAuthenticated = false
  if (staffToken) {
    const payload = await verifyJwtEdge(staffToken, AUTH_SECRET)
    if (payload && (payload.role === "admin" || payload.role === "logist")) {
      isStaffAuthenticated = true
    }
  }

  // Проверка сессии водителя
  let isDriverAuthenticated = false
  if (driverToken) {
    const payload = await verifyJwtEdge(driverToken, AUTH_SECRET)
    if (payload && payload.role === "driver") {
      isDriverAuthenticated = true
    }
  }

  // 2. Страницы авторизации водителя
  if (pathname === "/m/login") {
    if (isDriverAuthenticated) {
      return NextResponse.redirect(new URL("/m", req.url))
    }
    return NextResponse.next()
  }

  // 3. Мобильное приложение водителя (/m/...)
  if (pathname.startsWith("/m")) {
    if (!isDriverAuthenticated) {
      const loginUrl = new URL("/m/login", req.url)
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next()
  }

  // 4. Страницы входа и регистрации диспетчерской
  if (pathname === "/login" || pathname === "/register") {
    if (isStaffAuthenticated) {
      return NextResponse.redirect(new URL("/", req.url))
    }
    return NextResponse.next()
  }

  // 5. API роуты (кроме /api/auth и /api/m)
  if (pathname.startsWith("/api/")) {
    // Для API роутов диспетчерской проверяем авторизацию логиста
    // Если нет cookie, проверяем заголовок Authorization
    const authHeader = req.headers.get("authorization")
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null

    let apiAuth = isStaffAuthenticated
    if (!apiAuth && bearerToken) {
      const payload = await verifyJwtEdge(bearerToken, AUTH_SECRET)
      if (payload) apiAuth = true
    }

    // Если это не /api/m (у водительских свои проверки в хендлерах) и нет авторизации
    if (!apiAuth && !pathname.startsWith("/api/m")) {
      // Пока разрешаем API если в запросе есть заголовок или в dev-режиме,
      // но возвращаем 401 для защищенных админских роутов
      if (pathname.startsWith("/api/admin")) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
      }
    }

    return NextResponse.next()
  }

  // 6. Все остальные страницы диспетчерской панели (/, /orders, /fleet, /routes, /chat, etc.)
  if (!isStaffAuthenticated) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("from", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
}
