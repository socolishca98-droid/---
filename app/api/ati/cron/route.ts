// app/api/ati/cron/route.ts
// Эндпоинт для cron-задач: сканирование ATI + очистка кэша.
// Вызывать раз в 10-15 минут через внешний cron или Vercel Cron.
//
// Доступ (на выбор):
//   1. Authorization: Bearer <CRON_SECRET>  — для внешнего планировщика
//   2. ?secret=<CRON_SECRET>                — для планировщиков, не умеющих заголовки
//   3. активная сессия сотрудника (admin/logist) — для ручного запуска из интерфейса
//
// Было: process.env.CRON_SECRET || "your-secret-key" — без переменной окружения
// секрет становился публично известной строкой, то есть эндпоинт был открыт всем.
// Стало: если CRON_SECRET не задан, эндпоинт закрыт (fail closed).

import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { scanAtiLoads, cleanExpiredCache, getAtiStats } from "@/lib/ati-client"
import { loadStaffSession } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

const ACTIONS = ["all", "scan", "clean"] as const
type Action = (typeof ACTIONS)[number]

function secretMatches(provided: string | null | undefined): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected || !provided) return false
  const a = Buffer.from(String(provided))
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

async function isAllowed(request: NextRequest): Promise<
  { ok: true } | { ok: false; response: NextResponse }
> {
  if (!process.env.CRON_SECRET) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Cron отключён: не задан CRON_SECRET в окружении",
        },
        { status: 503 },
      ),
    }
  }

  const authHeader = request.headers.get("authorization")
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
  const querySecret = request.nextUrl.searchParams.get("secret")

  if (secretMatches(bearer) || secretMatches(querySecret)) {
    return { ok: true }
  }

  // Ручной запуск из интерфейса — по сессии сотрудника
  const staff = await loadStaffSession(request)
  if (staff) return { ok: true }

  return {
    ok: false,
    response: NextResponse.json(
      { success: false, error: "Недоступно: требуется CRON_SECRET или сессия сотрудника" },
      { status: 401 },
    ),
  }
}

function resolveAction(value: string | null | undefined, fallback: Action = "all"): Action {
  const action = String(value ?? fallback)
  return (ACTIONS as readonly string[]).includes(action) ? (action as Action) : "all"
}

async function runActions(action: Action, mode: string) {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    action,
    mode,
  }

  if (action === "clean" || action === "all") {
    console.log("[CRON] Starting cleanup...")
    results.cleanup = await cleanExpiredCache()
  }

  if (action === "scan" || action === "all") {
    console.log("[CRON] Starting scan...")
    results.scan = await scanAtiLoads({ mode })
  }

  results.stats = await getAtiStats()
  return results
}

export async function GET(request: NextRequest) {
  const access = await isAllowed(request)
  if (!access.ok) return access.response

  const action = resolveAction(request.nextUrl.searchParams.get("action"))

  try {
    const results = await runActions(action, "fast")
    console.log("[CRON] Complete:", results)
    return NextResponse.json({ success: true, ...results })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[CRON GET] Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const access = await isAllowed(request)
  if (!access.ok) return access.response

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      mode?: string
    }
    const action = resolveAction(body.action)
    const mode = body.mode === "fast" || body.mode === "full" ? body.mode : "normal"

    const results = await runActions(action, mode)
    return NextResponse.json({ success: true, ...results })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[CRON POST] Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
