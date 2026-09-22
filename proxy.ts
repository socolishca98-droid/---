// proxy.ts - P0 hardened: enforce auth on all API routes (Next.js 16+)
// Replaces middleware.ts - Next.js 16 deprecates middleware file convention
// P1-3: CSRF protection for mutating API routes

import { NextResponse, type NextRequest } from "next/server"
import { verifyJwtEdge, getEdgeSecret } from "@/lib/jwt-edge"
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/csrf"

let AUTH_SECRET: string
try {
  AUTH_SECRET = getEdgeSecret()
} catch {
  AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "loginex_dev_secret_only_for_local_development_do_not_use_in_prod_k9x2m4p8"
}

const STAFF_COOKIE_NAME = "loginex_token"
const DRIVER_COOKIE_NAME = "loginex_driver_token"
const STAFF_REFRESH_COOKIE_NAME = "loginex_refresh"
const DRIVER_REFRESH_COOKIE_NAME = "loginex_driver_refresh"

const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/csrf",
  "/api/auth/refresh",
  "/api/m/login",
  "/api/m/refresh",
  "/api/health",
]

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PATHS.some(p => pathname.startsWith(p))
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/public/") ||
    (pathname.includes(".") && !pathname.startsWith("/api/"))
  )
}

function isMutatingMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())
}

function shouldCheckCsrf(req: NextRequest): boolean {
  const { pathname } = req.nextUrl
  const method = req.method

  if (!isMutatingMethod(method)) return false
  if (!pathname.startsWith("/api/")) return false
  if (pathname.startsWith("/api/m/")) return false // mobile uses Bearer
  if (pathname === "/api/auth/csrf") return false
  if (pathname.startsWith("/api/ati/cron")) return false // server-to-server with secret
  // Skip CSRF if Authorization Bearer present (API client, not browser cookie)
  const authHeader = req.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) return false

  return true
}

function verifyCsrfEdge(req: NextRequest): { valid: boolean; reason?: string } {
  const cookieToken = req.cookies.get(CSRF_COOKIE_NAME)?.value || null
  const headerToken = req.headers.get(CSRF_HEADER_NAME) || req.headers.get("X-CSRF-Token") || null

  if (!cookieToken) return { valid: false, reason: "missing cookie" }
  if (!headerToken) return { valid: false, reason: "missing header" }
  // constant-time-ish compare
  if (cookieToken.length !== headerToken.length) return { valid: false, reason: "mismatch" }
  let result = 0
  for (let i = 0; i < cookieToken.length; i++) {
    result |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i)
  }
  if (result !== 0) return { valid: false, reason: "mismatch" }
  return { valid: true }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isStaticAsset(pathname)) {
    return NextResponse.next()
  }

  // P1-3: CSRF check for mutating API routes (before public bypass, so login/register also protected)
  if (shouldCheckCsrf(req)) {
    const csrfResult = verifyCsrfEdge(req)
    if (!csrfResult.valid) {
      return NextResponse.json(
        { success: false, error: "CSRF verification failed", reason: csrfResult.reason },
        { status: 403 }
      )
    }
  }

  if (isPublicApiPath(pathname)) {
    return NextResponse.next()
  }

  const staffToken = req.cookies.get(STAFF_COOKIE_NAME)?.value
  const driverToken = req.cookies.get(DRIVER_COOKIE_NAME)?.value
  const authHeader = req.headers.get("authorization")
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7).trim() : null

  let isStaffAuthenticated = false
  if (staffToken) {
    const payload = await verifyJwtEdge(staffToken, AUTH_SECRET)
    if (payload && (payload.role === "admin" || payload.role === "logist")) {
      isStaffAuthenticated = true
    }
  }
  if (!isStaffAuthenticated && bearerToken) {
    const payload = await verifyJwtEdge(bearerToken, AUTH_SECRET)
    if (payload && (payload.role === "admin" || payload.role === "logist")) {
      isStaffAuthenticated = true
    }
  }

  let isDriverAuthenticated = false
  if (driverToken) {
    const payload = await verifyJwtEdge(driverToken, AUTH_SECRET)
    if (payload && payload.role === "driver") {
      isDriverAuthenticated = true
    }
  }
  if (!isDriverAuthenticated && bearerToken) {
    const payload = await verifyJwtEdge(bearerToken, AUTH_SECRET)
    if (payload && payload.role === "driver") {
      isDriverAuthenticated = true
    }
  }

  const staffRefreshToken = req.cookies.get(STAFF_REFRESH_COOKIE_NAME)?.value
  const driverRefreshToken = req.cookies.get(DRIVER_REFRESH_COOKIE_NAME)?.value

  if (pathname === "/m/login") {
    if (isDriverAuthenticated) {
      return NextResponse.redirect(new URL("/m", req.url))
    }
    return NextResponse.next()
  }

  if (pathname.startsWith("/m")) {
    if (!isDriverAuthenticated) {
      // P1-5: allow if driver refresh exists, let client silent-refresh
      if (driverRefreshToken) {
        return NextResponse.next()
      }
      const loginUrl = new URL("/m/login", req.url)
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next()
  }

  if (pathname === "/login" || pathname === "/register") {
    if (isStaffAuthenticated) {
      return NextResponse.redirect(new URL("/", req.url))
    }
    return NextResponse.next()
  }

  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith("/api/m/")) {
      if (!isDriverAuthenticated && !isStaffAuthenticated) {
        // P1-5: allow refresh endpoint to be handled by its own route even without access
        if (pathname === "/api/m/refresh" && driverRefreshToken) {
          return NextResponse.next()
        }
        return NextResponse.json({ success: false, error: "Unauthorized - driver authentication required" }, { status: 401 })
      }
      return NextResponse.next()
    }

    if (pathname.startsWith("/api/ati/cron")) {
      const cronSecret = process.env.CRON_SECRET
      if (cronSecret && (authHeader === `Bearer ${cronSecret}` || req.nextUrl.searchParams.get('secret') === cronSecret)) {
        return NextResponse.next()
      }
      if (!isStaffAuthenticated) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
      }
      return NextResponse.next()
    }

    // P1-5: allow refresh endpoint even if access expired, if refresh cookie present
    if (pathname === "/api/auth/refresh" && staffRefreshToken) {
      return NextResponse.next()
    }

    if (!isStaffAuthenticated) {
      return NextResponse.json({ success: false, error: "Unauthorized - staff authentication required" }, { status: 401 })
    }

    return NextResponse.next()
  }

  if (!isStaffAuthenticated) {
    // P1-5: allow page if refresh token exists, client will silent-refresh
    if (staffRefreshToken) {
      return NextResponse.next()
    }
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("from", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
}

export default proxy
