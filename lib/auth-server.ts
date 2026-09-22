// lib/auth-server.ts - P0 hardened + P1-5 refresh rotation
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
const STAFF_REFRESH_COOKIE_NAME = "loginex_refresh"
const DRIVER_REFRESH_COOKIE_NAME = "loginex_driver_refresh"

// P1-5: short-lived access + long refresh
export const ACCESS_TOKEN_EXPIRES_IN = 15 * 60 // 15 min
export const STAFF_REFRESH_EXPIRES_IN = 7 * 24 * 3600 // 7 days
export const DRIVER_REFRESH_EXPIRES_IN = 30 * 24 * 3600 // 30 days

export interface StaffTokenPayload {
  sub: string
  email: string
  role: "admin" | "logist"
  name: string
  exp: number
  iat?: number
}

export interface DriverTokenPayload {
  sub: string
  phone: string
  role: "driver"
  exp: number
  iat?: number
}

export interface RefreshTokenPayload {
  sub: string
  role: "admin" | "logist" | "driver"
  jti: string
  type: "refresh"
  exp: number
  iat?: number
}

// -------------------------------------------------------------
// Хэширование паролей
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
    if (bufA.length !== bufB.length) {
      crypto.timingSafeEqual(bufA, bufA)
      return false
    }
    return crypto.timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

// -------------------------------------------------------------
// JWT sign/verify
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

export function signAccessJwt(payload: Record<string, any>): string {
  return signJwt(payload, ACCESS_TOKEN_EXPIRES_IN)
}

export function signRefreshJwt(payload: { sub: string; role: "admin" | "logist" | "driver"; jti: string }, expiresInSeconds: number): string {
  return signJwt({ ...payload, type: "refresh" }, expiresInSeconds)
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
    const sigBuf = Buffer.from(signature)
    const expBuf = Buffer.from(expectedSignature)
    if (sigBuf.length !== expBuf.length) return null
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as { exp?: number }
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload as T
  } catch {
    return null
  }
}

export function verifyRefreshJwt(token: string): RefreshTokenPayload | null {
  const payload = verifyJwt<RefreshTokenPayload>(token)
  if (!payload) return null
  if ((payload as any).type !== "refresh") return null
  if (!payload.jti || !payload.sub) return null
  return payload
}

// -------------------------------------------------------------
// Extract token
// -------------------------------------------------------------
export function extractToken(req: NextRequest, cookieName: string): string | null {
  const authHeader = req.headers.get("authorization")
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim()
  }
  const cookie = req.cookies.get(cookieName)
  if (cookie?.value) return cookie.value
  return null
}

// -------------------------------------------------------------
// Sessions
// -------------------------------------------------------------
export async function getStaffSession(req: NextRequest) {
  const token = extractToken(req, STAFF_COOKIE_NAME)
  if (!token) return null
  const payload = verifyJwt<StaffTokenPayload>(token)
  if (!payload || !payload.sub || (payload.role !== "admin" && payload.role !== "logist")) return null
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, status: true },
    })
    if (!user || user.status !== "active") return null
    return user
  } catch (e) {
    console.error('[Auth] getStaffSession DB error:', e)
    return null
  }
}

export async function getDriverSession(req: NextRequest) {
  const token = extractToken(req, DRIVER_COOKIE_NAME)
  if (!token) return null
  const payload = verifyJwt<DriverTokenPayload>(token)
  if (!payload || !payload.sub || payload.role !== "driver") return null
  try {
    const driver = await prisma.driver.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, phone: true, vehicleId: true, vehiclePlate: true, vehicleType: true, status: true },
    })
    if (!driver) return null
    return { driverId: driver.id, driver }
  } catch (e) {
    console.error('[Auth] getDriverSession DB error:', e)
    return null
  }
}

// -------------------------------------------------------------
// Cookie utils - P0 + P1-5
// -------------------------------------------------------------
export function setStaffAuthCookie(res: NextResponse, token: string) {
  res.cookies.set({
    name: STAFF_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TOKEN_EXPIRES_IN,
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
    maxAge: ACCESS_TOKEN_EXPIRES_IN,
  })
}

export function setStaffRefreshCookie(res: NextResponse, token: string) {
  res.cookies.set({
    name: STAFF_REFRESH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STAFF_REFRESH_EXPIRES_IN,
  })
}

export function setDriverRefreshCookie(res: NextResponse, token: string) {
  res.cookies.set({
    name: DRIVER_REFRESH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DRIVER_REFRESH_EXPIRES_IN,
  })
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.delete(STAFF_COOKIE_NAME)
  res.cookies.delete(DRIVER_COOKIE_NAME)
}

export function clearRefreshCookies(res: NextResponse) {
  res.cookies.delete(STAFF_REFRESH_COOKIE_NAME)
  res.cookies.delete(DRIVER_REFRESH_COOKIE_NAME)
}

export function clearAllAuthCookies(res: NextResponse) {
  clearAuthCookies(res)
  clearRefreshCookies(res)
}

export {
  STAFF_COOKIE_NAME,
  DRIVER_COOKIE_NAME,
  STAFF_REFRESH_COOKIE_NAME,
  DRIVER_REFRESH_COOKIE_NAME,
}
export { getAuthSecret }
