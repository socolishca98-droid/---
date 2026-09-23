// lib/csrf.ts - Double-submit cookie CSRF protection (P1-3)
import { NextRequest, NextResponse } from "next/server"

export const CSRF_COOKIE_NAME = "loginex_csrf"
export const CSRF_HEADER_NAME = "x-csrf-token"
export const CSRF_TOKEN_LENGTH = 32 // bytes, hex = 64 chars

export function generateCsrfToken(): string {
  // Node runtime: use crypto.randomBytes
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomBytes } = require("crypto") as typeof import("crypto")
    return randomBytes(CSRF_TOKEN_LENGTH).toString("hex")
  } catch {
    // Edge fallback: use Web Crypto
    const bytes = new Uint8Array(CSRF_TOKEN_LENGTH)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }
}

export function setCsrfCookie(response: NextResponse, token: string): void {
  const isProd = process.env.NODE_ENV === "production"
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // must be readable by JS for double-submit (or via GET endpoint)
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60, // 24h
  })
}

export function getCsrfTokenFromCookie(req: NextRequest): string | null {
  return req.cookies.get(CSRF_COOKIE_NAME)?.value || null
}

export function getCsrfTokenFromHeader(req: NextRequest): string | null {
  // header names are case-insensitive, NextRequest handles lowercasing
  return req.headers.get(CSRF_HEADER_NAME) || req.headers.get("X-CSRF-Token") || null
}

function safeEqual(a: string, b: string): boolean {
  // Try Node timingSafeEqual if available
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { timingSafeEqual } = require("crypto") as typeof import("crypto")
    const bufA = Buffer.from(a, "utf-8")
    const bufB = Buffer.from(b, "utf-8")
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  } catch {
    // Edge fallback: constant-time-ish comparison
    if (a.length !== b.length) return false
    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }
}

export function verifyCsrf(req: NextRequest): { valid: boolean; reason?: string } {
  const cookieToken = getCsrfTokenFromCookie(req)
  const headerToken = getCsrfTokenFromHeader(req)

  if (!cookieToken) {
    return { valid: false, reason: "missing cookie" }
  }
  if (!headerToken) {
    return { valid: false, reason: "missing header" }
  }
  if (!safeEqual(cookieToken, headerToken)) {
    return { valid: false, reason: "mismatch" }
  }
  return { valid: true }
}

// Helper for API routes that want to enforce CSRF manually
export function requireCsrf(req: NextRequest): NextResponse | null {
  const result = verifyCsrf(req)
  if (!result.valid) {
    return NextResponse.json(
      { success: false, error: "CSRF verification failed", reason: result.reason },
      { status: 403 }
    )
  }
  return null
}
