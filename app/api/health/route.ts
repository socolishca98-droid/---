// app/api/health/route.ts — проверка живости для Docker и диагностика базы
//
// Кроме «сервис жив» здесь есть ответ на вопрос «почему экран открывается
// медленно»: пулер подключений включён или приложение ходит в базу напрямую,
// сколько стоит один запрос и сколько соединений разрешено. Секретов в ответе
// нет — только признаки и числа.

import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * Разбор строки подключения без её раскрытия.
 *
 * Что важно для скорости на Vercel: без пулера каждая функция открывает свои
 * соединения к удалённой базе, и одно обращение стоит 0,5–1 с. Признаки
 * пулера: `pgbouncer=true`, порт 6543 (Supabase transaction pooler) или
 * `pooler.supabase.com` в адресе.
 */
function databaseInfo() {
  const raw = process.env.DATABASE_URL ?? ""
  if (!raw) return { configured: false }

  let host = ""
  let port = ""
  let params: URLSearchParams | null = null

  try {
    const url = new URL(raw)
    host = url.hostname
    port = url.port
    params = url.searchParams
  } catch {
    // Строка нестандартная (например, file: для SQLite) — признаков не будет
  }

  const provider = raw.startsWith("postgres") ? "postgres" : raw.startsWith("file:") ? "sqlite" : "other"
  const pooledByParam = params?.get("pgbouncer") === "true"
  const pooledByHost = host.includes("pooler")
  const pooledByPort = port === "6543"
  const connectionLimit = params?.get("connection_limit") ?? null

  return {
    configured: true,
    provider,
    /** Ходим ли мы через пулер подключений (главный фактор скорости). */
    pooled: provider === "postgres" ? pooledByParam || pooledByHost || pooledByPort : null,
    connectionLimit: connectionLimit ? Number(connectionLimit) : null,
    directUrlConfigured: Boolean(process.env.DIRECT_URL),
  }
}

export async function GET() {
  const database = databaseInfo()

  // Замер одного простого запроса: столько стоит круг до базы.
  let latencyMs: number | null = null
  let reachable: boolean | null = null
  if (database.configured) {
    const started = Date.now()
    try {
      await prisma.$queryRaw`SELECT 1`
      latencyMs = Date.now() - started
      reachable = true
    } catch {
      reachable = false
    }
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || "1.0.0",
    env: process.env.NODE_ENV,
    database: { ...database, reachable, latencyMs },
  })
}
