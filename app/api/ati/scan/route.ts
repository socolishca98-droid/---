// app/api/ati/scan/route.ts
import { requireStaffAuth } from "@/lib/api-auth"
import {requireStaffOrganization} from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { scanAtiLoads } from "@/lib/ati-client"
import { getActiveAtiToken } from "@/lib/ati/connection"
import { prisma } from "@/lib/prisma"
import { scanParamsForProfile } from "@/lib/ati/scan-schedule"
import { cityIdsFromBaseAddress } from "@/lib/ati/scan-profile"

export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const body = await request.json().catch(() => ({}))

    // Плановый сбор (кнопка «Собрать» и cron) берёт настройки из активного
    // профиля организации: его города, радиус, фильтры и источник.
    //
    // Зачем здесь: экран отправлял только режим («быстрый/обычный/глубокий»)
    // — без городов профиля скан не фильтровал грузы по региону базы и не
    // искал по общей бирже, то есть пересобирал одно и то же с площадок.
    // Живой замер: «собрано 195», с биржи 0, новых грузов в базе 0.
    let scanBody: Record<string, unknown> = body
    if (!body?.manualMode && !Array.isArray(body?.cityIds)) {
      const profile = await prisma.atiScanConfig.findFirst({
        where: { organizationId: __org.organizationId, isActive: true },
        orderBy: { createdAt: "asc" },
      })
      if (profile) {
        const fromProfile = scanParamsForProfile(profile, String(body?.mode ?? "normal"))
        // Профиль мог остаться без городов (создан до правки) — тогда
        // регион берём из адреса базы, иначе сборщик снова уйдёт «во всю
        // страну»: без городов нет ни фильтра по региону, ни обхода биржи.
        let cityIds = fromProfile.cityIds
        if (cityIds.length === 0) {
          const settings = await prisma.fleetSettings.findFirst({
            where: { organizationId: __org.organizationId },
            select: { baseAddress: true },
          })
          cityIds = cityIdsFromBaseAddress(settings?.baseAddress)
        }
        scanBody = {
          ...body,
          mode: body?.mode ?? "normal",
          cityIds,
          radius: fromProfile.radius,
          // Фильтры складываем: с экрана приходит minDistance, из профиля —
          // минимальный вес и типы кузова. Одно не должно вытеснять другое.
          filters: { ...(body?.filters ?? {}), ...fromProfile.filters },
          source: fromProfile.source,
        }
      }
    }

    // Скан идёт в аккаунт ATI самой организации: её токен, её площадки, её лимиты
    const ati = await getActiveAtiToken(__org.organizationId)
    if (!ati.ok) {
      return NextResponse.json(
        { success: false, code: ati.code, error: ati.error },
        { status: 400 },
      )
    }

    const result = await scanAtiLoads({
      ...scanBody,
      token: ati.token,
      organizationId: __org.organizationId,
    })
    return NextResponse.json(result)
  } catch (error: any) {
    console.error("[ATI Scan] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Scan failed" },
      { status: 500 }
    )
  }
}