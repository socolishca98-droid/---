// app/api/ati/cron/route.ts
// Эндпоинт для cron-задач: сканирование + очистка
// Вызывать раз в 10-15 минут через внешний cron или Vercel Cron

import { NextRequest, NextResponse } from "next/server"
import { scanAtiLoads, cleanExpiredCache, getAtiStats } from "@/lib/ati-client"

// Секретный ключ для защиты от внешних вызовов
const CRON_SECRET = process.env.CRON_SECRET || "your-secret-key"

export async function GET(request: NextRequest) {
  // Проверка авторизации
  const authHeader = request.headers.get("authorization")
  const url = new URL(request.url)
  const secret = url.searchParams.get("secret")

  if (authHeader !== `Bearer ${CRON_SECRET}` && secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const action = url.searchParams.get("action") || "all"

  try {
    const results: any = { timestamp: new Date().toISOString() }

    // Очистка устаревших записей
    if (action === "clean" || action === "all") {
      console.log("[CRON] Starting cleanup...")
      results.cleanup = await cleanExpiredCache()
    }

    // Сканирование новых грузов
    if (action === "scan" || action === "all") {
      console.log("[CRON] Starting scan...")
      results.scan = await scanAtiLoads({ mode: "fast" })
    }

    // Статистика
    results.stats = await getAtiStats()

    console.log("[CRON] Complete:", results)
    return NextResponse.json({ success: true, ...results })
  } catch (error: any) {
    console.error("[CRON] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

// POST для ручного запуска с параметрами
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { action, mode } = body as { action?: string; mode?: string }

    const results: any = { timestamp: new Date().toISOString() }

    if (action === "clean" || action === "all" || !action) {
      results.cleanup = await cleanExpiredCache()
    }

    if (action === "scan" || action === "all" || !action) {
      results.scan = await scanAtiLoads({ mode: mode || "normal" })
    }

    results.stats = await getAtiStats()

    return NextResponse.json({ success: true, ...results })
  } catch (error: any) {
    console.error("[CRON POST] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}