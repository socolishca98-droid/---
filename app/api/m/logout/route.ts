// app/api/m/logout/route.ts
import { NextResponse } from "next/server"
import { clearAuthCookies } from "@/lib/auth-server"

export async function POST() {
  const res = NextResponse.json({ success: true, message: "Выход выполнен" })
  clearAuthCookies(res)
  return res
}
