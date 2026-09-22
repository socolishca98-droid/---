// lib/auth-server.ts - P0 hardened
import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NEXT_PHASE === 'phase-development-build' ||
    process.env.npm_lifecycle_event === 'build' ||
    process.env.npm_lifecycle_event === 'build:safe'
  )
}

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production' && !isBuildPhase()) {
      throw new Error('AUTH_SECRET is required in production - set AUTH_SECRET env variable')
    }
    // Build phase or development fallback with warning
    if (!isBuildPhase()) {
      console.warn('[Auth] AUTH_SECRET not set, using development fallback - DO NOT USE IN PRODUCTION')
    }
    return "loginex_dev_secret_only_for_local_development_do_not_use_in_prod_k9x2m4p8"
  }
  if (secret.length < 32) {
    console.warn('[Auth] AUTH_SECRET is too short, should be at least 32 chars')
  }
  return secret
}

const AUTH_SECRET = getAuthSecret()
const STAFF_COOKIE_NAME = "loginex_token"
const DRIVER_COOKIE_NAME = "loginex_driver_token"

export interface StaffTokenPayload {
  sub: string // user.id
  email: string
  role: "admin" | "logist"
  name: string
  exp: number
  iat?: number
}

export interface DriverTokenPayload {
  sub: string // driver.id
  phone: string
  role: "driver"
  exp: number
  iat?: number
}

// -------------------------------------------------------------
// Хэширование паролей (PBKDF2 + salt) - P0 fixed timingSafeEqual
// -------------------------------------------------------------
export function hashPassword(password: string, existingSalt?: string): { salt: string; hash: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString("hex")
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex")
  return { salt, hash }
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  try {
    if (!password || !salt || !hash) return false
    const computed = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex")
    const bufA = Buffer.from(computed, 'hex')
    const bufB = Buffer.from(hash, 'hex')
    // P0: Ensure equal length to avoid timingSafeEqual throw
    if (bufA.length !== bufB.length) {
      // Still do constant-time comparison to avoid timing leak, but return false
      // Compare with itself to waste same time
      crypto.timingSafeEqual(bufA, bufA)
      return false
    }
    return crypto.timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

// -------------------------------------------------------------
// Подпись и верификация токенов (HMAC-SHA256 JWT)
// -------------------------------------------------------------
function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/")
  while (base64.length % 4) {
    base64 += "="
  }
  return Buffer.from(base64, "base64").toString("utf8")
}

export function signJwt(payload: Record<string, any>, expiresInSeconds = 7 * 24 * 3600): string {
  const header = { alg: "HS256", typ: "JWT" }
  const fullPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload))
  const data = `${encodedHeader}.${encodedPayload}`

  const signature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")

  return `${data}.${signature}`
}

export function verifyJwt<T = any>(token: string): T | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const [encodedHeader, encodedPayload, signature] = parts
    const data = `${encodedHeader}.${encodedPayload}`

    const expectedSignature = crypto
      .createHmac("sha256", AUTH_SECRET)
      .update(data)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")

    // P0: Use constant-time comparison for signature
    const sigBuf = Buffer.from(signature)
    const expBuf = Buffer.from(expectedSignature)
    if (sigBuf.length !== expBuf.length) {
      return null
    }
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as { exp?: number }
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null // истек
    }

    return payload as T
  } catch {
    return null
  }
}

// -------------------------------------------------------------
// Извлечение токена из запроса (Cookie или Authorization: Bearer)
// -------------------------------------------------------------
export function extractToken(req: NextRequest, cookieName: string): string | null {
  const authHeader = req.headers.get("authorization")
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim()
  }

  const cookie = req.cookies.get(cookieName)
  if (cookie?.value) {
    return cookie.value
  }

  return null
}

// -------------------------------------------------------------
// Проверка сессии логиста/админа
// -------------------------------------------------------------
export async function getStaffSession(req: NextRequest) {
  const token = extractToken(req, STAFF_COOKIE_NAME)
  if (!token) return null

  const payload = verifyJwt<StaffTokenPayload>(token)
  if (!payload || !payload.sub || (payload.role !== "admin" && payload.role !== "logist")) {
    return null
  }

  // Проверяем актуальный статус в БД
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
      },
    })

    if (!user || user.status !== "active") {
      return null // пользователь удален или деактивирован
    }

    return user
  } catch (e) {
    console.error('[Auth] getStaffSession DB error:', e)
    return null
  }
}

// -------------------------------------------------------------
// Проверка сессии водителя
// -------------------------------------------------------------
export async function getDriverSession(req: NextRequest) {
  const token = extractToken(req, DRIVER_COOKIE_NAME)
  if (!token) return null

  const payload = verifyJwt<DriverTokenPayload>(token)
  if (!payload || !payload.sub || payload.role !== "driver") {
    return null
  }

  try {
    const driver = await prisma.driver.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        name: true,
        phone: true,
        vehicleId: true,
        vehiclePlate: true,
        vehicleType: true,
        status: true,
      },
    })

    if (!driver) {
      return null
    }

    return { driverId: driver.id, driver }
  } catch (e) {
    console.error('[Auth] getDriverSession DB error:', e)
    return null
  }
}

// -------------------------------------------------------------
// Cookie утилиты для ответов - P0 secure flags
// -------------------------------------------------------------
export function setStaffAuthCookie(res: NextResponse, token: string) {
  res.cookies.set({
    name: STAFF_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 3600, // 7 дней
  })
}

export function setDriverAuthCookie(res: NextResponse, token: string) {
  res.cookies.set({
    name: DRIVER_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 3600, // 30 дней для водителя
  })
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.delete(STAFF_COOKIE_NAME)
  res.cookies.delete(DRIVER_COOKIE_NAME)
}

// Export cookie names for middleware reuse
export { STAFF_COOKIE_NAME, DRIVER_COOKIE_NAME }
export { getAuthSecret }
