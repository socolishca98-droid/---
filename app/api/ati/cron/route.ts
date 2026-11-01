// app/api/ati/cron/route.ts
// Эндпоинт для cron-задач: сканирование ATI по расписанию + очистка кэша.
// Вызывать раз в 10-15 минут через внешний cron или Vercel Cron.
//
// Что именно сканируется, решают профили расписания (таблица AtiScanConfig):
// города, радиус, минимальный вес, типы кузова и интервал запуска. Профили с
// autoScanInterval = 0 сами не запускаются — только вручную.
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
import { scanAtiLoads, cleanExpiredCache } from "@/lib/ati-client"
import { getActiveAtiToken } from "@/lib/ati/connection"
import { prisma } from "@/lib/prisma"
import { loadStaffSession } from "@/lib/auth/session"
import { getDueScanProfiles, markProfileScanned, scanParamsForProfile } from "@/lib/ati/scan-schedule"
import { cleanupPasswordResetTokens } from "@/lib/password-reset"

import { captureRouteError } from "@/lib/sentry"
export const dynamic = "force-dynamic"

/**
 * Сколько длится вызов планировщика. Скан идёт по организациям одна за другой,
 * и на проде (Pro) лимит по умолчанию в 60 секунд может не хватить. На Hobby
 * значение урезается планом (10 с) — там расписание всё равно реже.
 */
export const maxDuration = 60

const ACTIONS = ["all", "scan", "clean", "duty"] as const
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

/**
 * Скан по расписанию — обход подключений организаций.
 *
 * У каждой организации свой аккаунт ATI.SU: cron берёт её токен
 * (AtiConnection), её профили расписания (AtiScanConfig) и наполняет ЕЁ
 * накопленную базу грузов (AtiCache.organizationId). Организации без
 * подключения пропускаются — общий токен из .env больше не используется.
 *
 * Профили без интервала (autoScanInterval = 0) сами не запускаются — только
 * вручную из интерфейса. Профилей нет — скан всех видимых грузов площадок.
 */
async function runScheduledScan(mode: string) {
  // org-audit: manual — cron легально обходит подключения ВСЕХ организаций:
  // для каждой используется только её собственный токен и её профили
  const connections = await prisma.atiConnection.findMany({
    where: { status: { in: ["active", "unverified"] } },
    orderBy: { createdAt: "asc" },
  })

  if (connections.length === 0) {
    return {
      mode: "skipped",
      reason: "нет организаций, подключённых к ATI.SU — сканировать нечего",
    }
  }

  const organizations: { organizationId: string; profile?: string; result: unknown }[] = []

  for (const connection of connections) {
    const organizationId = connection.organizationId
    if (!organizationId) continue

    const ati = await getActiveAtiToken(organizationId)
    if (!ati.ok) {
      organizations.push({
        organizationId,
        result: { success: false, code: ati.code, error: ati.error },
      })
      continue
    }

    const { active, due } = await getDueScanProfiles(organizationId)

    if (active.length === 0) {
      const result = await scanAtiLoads({ mode, token: ati.token, organizationId })
      organizations.push({ organizationId, result })
      continue
    }

    for (const profile of due) {
      try {
        const result = await scanAtiLoads({
          ...scanParamsForProfile(profile, mode),
          token: ati.token,
          organizationId,
        })
        await markProfileScanned(profile.id, organizationId)
        organizations.push({ organizationId, profile: profile.name, result })
      } catch (error) {
        // один сломанный профиль не должен останавливать остальные
        organizations.push({
          organizationId,
          profile: profile.name,
          result: {
            success: false,
            error: error instanceof Error ? error.message : "ошибка скана",
          },
        })
      }
    }
  }

  return {
    mode: "organizations",
    scanned: organizations.length,
    organizations,
  }
}

/**
 * Дежурный логист по расписанию.
 *
 * Дежурный — не экран, а постоянное наблюдение: он должен смотреть биржу и
 * когда никто не открыл приложение. Поэтому cron после скана обходит
 * организации с включённым дежурным и запускает его. Внутри runDuty сам
 * решает, пора ли: рабочие часы, интервал с прошлого просмотра. Вне часов и
 * раньше интервала он честно отвечает «не пора» и не тратит запросы к бирже.
 *
 * Скан здесь не повторяем (scan: false) — его только что сделал cron.
 */
async function runDutyForOrganizations(now: Date = new Date()) {
  const configs = await prisma.fleetSettings.findMany({
    where: { dutyEnabled: true },
    select: { organizationId: true, dutyIntervalMin: true, dutyFromHour: true, dutyToHour: true },
  })

  if (configs.length === 0) {
    return { organizations: 0, reason: "дежурный нигде не включён" }
  }

  const { runDuty } = await import("@/lib/logist-mobile/duty-service")
  const results: Array<{
    organizationId: string
    ran: boolean
    itemsCount?: number
    reason?: string
    error?: string
  }> = []

  for (const config of configs) {
    // Настройки без организации — наследие общей базы: дежурному они не нужны
    const organizationId = config.organizationId
    if (!organizationId) continue
    try {
      const result = await runDuty(organizationId, { scan: false, now })
      results.push({
        organizationId,
        ran: result.ran,
        itemsCount: result.itemsCount,
        reason: result.reason,
      })
    } catch (error) {
      // Одна организация не должна ломать обход остальных
      results.push({
        organizationId,
        ran: false,
        error: error instanceof Error ? error.message : "ошибка дежурного",
      })
    }
  }

  return { organizations: results.length, results }
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
    // Ссылки восстановления пароля тоже мусор: держать их после истечения незачем
    results.passwordResetTokens = await cleanupPasswordResetTokens()
  }

  if (action === "scan" || action === "all") {
    console.log("[CRON] Starting scan...")
    results.scan = await runScheduledScan(mode)
  }

  // Дежурный идёт после скана: биржа уже опрошена, ему остаётся решить,
  // что из этого стоит внимания логиста.
  if (action === "duty" || action === "all") {
    console.log("[CRON] Starting duty...")
    results.duty = await runDutyForOrganizations()
  }

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
    captureRouteError("api/ati/cron", error)
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
    captureRouteError("api/ati/cron", error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
