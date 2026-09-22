// proxy.ts - P0 hardened: enforce auth on all API routes (Next.js 16+)
// Replaces middleware.ts - Next.js 16 deprecates middleware file convention

import { NextResponse, type NextRequest } from "next/server"
import { verifyJwtEdge, getEdgeSecret } from "@/lib/jwt-edge"

let AUTH_SECRET: string
try {
  AUTH_SECRET = getEdgeSecret()
} catch {
  AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "loginex_dev_secret_only_for_local_development_do_not_use_in_prod_k9x2m4p8"
}

const STAFF_COOKIE_NAME = "loginex_token"
const DRIVER_COOKIE_NAME = "loginex_driver_token"

const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/m/login",
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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isStaticAsset(pathname)) {
    return NextResponse.next()
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

  if (pathname === "/m/login") {
    if (isDriverAuthenticated) {
      return NextResponse.redirect(new URL("/m", req.url))
    }
    return NextResponse.next()
  }

  if (pathname.startsWith("/m")) {
    if (!isDriverAuthenticated) {
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

    if (!isStaffAuthenticated) {
      return NextResponse.json({ success: false, error: "Unauthorized - staff authentication required" }, { status: 401 })
    }

    return NextResponse.next()
  }

  if (!isStaffAuthenticated) {
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
