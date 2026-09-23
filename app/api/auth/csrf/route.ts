// app/api/auth/csrf/route.ts - GET CSRF token (P1-3)
import { NextRequest, NextResponse } from "next/server"
import { generateCsrfToken, setCsrfCookie, getCsrfTokenFromCookie } from "@/lib/csrf"

export async function GET(req: NextRequest) {
  // If token already exists in cookie, reuse it (optional, but we generate new for simplicity)
  const existing = getCsrfTokenFromCookie(req)
  const token = existing || generateCsrfToken()

  const response = NextResponse.json({ success: true, csrfToken: token })
  setCsrfCookie(response, token)
  return response
}
