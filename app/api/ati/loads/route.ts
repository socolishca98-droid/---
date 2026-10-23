// app/api/ati/loads/route.ts
//
// Биржа грузов для помощника сборки: список грузов из накопленной базы
// организации (AtiCache) с автоматическим обновлением из ATI, если кэш
// устарел. Логист ничего не нажимает — открыл экран, данные свежие.
//
// Автообновление: смотрим свежесть по активному профилю сканирования
// (AtiScanConfig) — если он «due» (интервал прошёл) или в базе нет грузов
// моложе 5 минут, делаем один скан ATI (2 запроса: площадки + грузы) и
// только потом отдаём список. Лишних обращений к ATI не делаем: скан
// идёт не чаще одного раза в 5 минут на организацию, лимиты ATI (10 rps)
// не страдают.
//
// Ручное обновление — POST (тот же путь) или POST /api/ati/scan: обходит
// проверку свежести и всегда дёргает ATI.

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { getActiveAtiToken } from "@/lib/ati/connection"
import { scanAtiLoads, getAtiCache } from "@/lib/ati-client"
import { isProfileDue, parseProfileCities } from "@/lib/ati/scan-profile"
import { markProfileScanned, getDueScanProfiles } from "@/lib/ati/scan-schedule"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/** Если в базе нет грузов моложе этого времени — кэш считаем устаревшим. */
const MAX_CACHE_AGE_MINUTES = 5

/** Самый свежий груз в кэше организации — база для оценки свежести. */
async function lastCacheScanAt(organizationId: string): Promise<Date | null> {
  const row = await prisma.atiCache.findFirst({
    where: scopedWhere(organizationId, {}),
    orderBy: { scannedAt: "desc" },
    select: { scannedAt: true },
  })
  return row?.scannedAt ?? null
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response
  const organizationId = org.organizationId

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || "new"
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 100)
    const search = searchParams.get("search") || undefined
    const minPricePerKm = searchParams.get("minPricePerKm") || undefined

    // 1. Активный профиль сканирования (города под нашу специфику)
    const { active } = await getDueScanProfiles(organizationId)
    const profile = active[0] ?? null
    const cityIds = profile ? parseProfileCities(profile) : []

    // 2. Нужно ли обновление: профиль «due» ИЛИ вся база старая
    const scannedAt = await lastCacheScanAt(organizationId)
    const ageMinutes = scannedAt
      ? (Date.now() - scannedAt.getTime()) / 60_000
      : Infinity
    const profileDue = profile ? isProfileDue(profile) : ageMinutes > MAX_CACHE_AGE_MINUTES
    const needsRefresh = profileDue || ageMinutes > MAX_CACHE_AGE_MINUTES

    let refreshed = false
    let refreshError: string | null = null

    if (needsRefresh) {
      const ati = await getActiveAtiToken(organizationId)
      if (ati.ok) {
        const result = await scanAtiLoads({
          token: ati.token,
          organizationId,
          cityIds,
        })
        if (result?.success) {
          refreshed = true
          if (profile) await markProfileScanned(profile.id, organizationId)
        } else {
          refreshError = (result as { error?: string })?.error ?? "ATI.SU не ответил"
        }
      } else {
        // Не подключены — показываем кэш без обновления, это не ошибка экрана
        refreshError = ati.error
      }
    }

    // 3. Список из кэша (после возможного обновления)
    const result = await getAtiCache({
      status,
      search,
      limit,
      offset: 0,
      minPricePerKm,
      organizationId,
    })

    // Точки погрузки/выгрузки: лежат в rawJson груза — помощник берёт по ним
    // грузы «по пути». Сам rawJson наружу не отдаём (он может быть большим).
    const items = (result.items ?? []).map((row: any) => {
      let fromPoint = null
      let toPoint = null
      if (typeof row.rawJson === "string" && row.rawJson.startsWith("{")) {
        try {
          const parsed = JSON.parse(row.rawJson)
          fromPoint = parsed.fromPoint ?? null
          toPoint = parsed.toPoint ?? null
        } catch {
          // битый rawJson — просто без точек, это не ошибка экрана
        }
      }
      const { rawJson: _rawJson, ...rest } = row
      return { ...rest, fromPoint, toPoint }
    })

    const freshScannedAt = refreshed ? new Date() : scannedAt

    return NextResponse.json({
      success: true,
      ...result,
      items,
      lastScanAt: freshScannedAt,
      refreshed,
      refreshError,
      /** Профиль сканирования организации (города, интервал) — для шторки настроек */
      scanProfile: profile
        ? {
            id: profile.id,
            name: profile.name,
            cities: parseProfileCities(profile),
            minWeight: profile.minWeight,
            truckTypes: profile.truckTypes,
            autoScanInterval: profile.autoScanInterval,
          }
        : null,
    })
  } catch (error) {
    console.error("[ATI Loads] ошибка:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось загрузить биржу грузов" },
      { status: 500 },
    )
  }
}

/** Ручное обновление: всегда дёргаем ATI, проверку свежести пропускаем. */
export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response
  const organizationId = org.organizationId

  try {
    const ati = await getActiveAtiToken(organizationId)
    if (!ati.ok) {
      return NextResponse.json(
        { success: false, code: ati.code, error: ati.error },
        { status: 400 },
      )
    }

    const { active } = await getDueScanProfiles(organizationId)
    const profile = active[0] ?? null
    const cityIds = profile ? parseProfileCities(profile) : []

    const result = await scanAtiLoads({
      token: ati.token,
      organizationId,
      cityIds,
    })

    if (!result?.success) {
      return NextResponse.json(
        { success: false, error: (result as { error?: string })?.error ?? "Скан ATI.SU не удался" },
        { status: 502 },
      )
    }

    if (profile) await markProfileScanned(profile.id, organizationId)

    const cache = await getAtiCache({ status: "new", limit: 50, organizationId })
    return NextResponse.json({
      success: true,
      count: result.count ?? 0,
      lastScanAt: new Date(),
      refreshed: true,
      ...cache,
    })
  } catch (error) {
    console.error("[ATI Loads] ошибка ручного обновления:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось обновить биржу" },
      { status: 500 },
    )
  }
}
