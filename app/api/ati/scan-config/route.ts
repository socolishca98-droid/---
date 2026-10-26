// app/api/ati/scan-config/route.ts
//
// Профили сканирования биржи (AtiScanConfig): что и как часто организация
// забирает из ATI. Раньше профили создавались только через сид/cron — из
// интерфейса их было не настроить. Теперь логист может задать:
//   * города (по базовым хабам ATI — их id стабильны);
//   * минимальный вес груза (мелочь ниже порога не показываем);
//   * типы кузова;
//   * интервал автоскана в минутах (5 — максимум, что позволяют правила
//     ATI и лимиты токена; 0 — только вручную).
//
//   GET  — профили организации (список + активный)
//   POST — создать или обновить профиль
//
// organizationId берётся из проверенной сессии, не из тела запроса.

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/rate-limiter"
import { parseProfileCities } from "@/lib/ati/scan-profile"
import { regionOfBaseAddress } from "@/lib/ati/base-region"

export const dynamic = "force-dynamic"

/** Интервал автоскана: 5 минут — разумный максимум (правила ATI + лимиты). */
const MAX_INTERVAL_MINUTES = 5
const MIN_INTERVAL_MINUTES = 0

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    let profiles = await prisma.atiScanConfig.findMany({
      where: scopedWhere(org.organizationId, {}),
      orderBy: { createdAt: "asc" },
    })

    // Профиля нет — создаём сами из базы организации.
    //
    // Зачем: без профиля экран биржи не знает, когда пора обновиться, и
    // автообновление молча не работает — организация видит устаревшие грузы
    // и не понимает почему. Особенно это биёт по новой компании: она
    // зарегистрировалась, а профиль заводили только сидом. Поэтому лечим
    // на чтении, а не просим человека искать настройку.
    // Профиль есть, а городов в нём нет — лечим на чтении.
    //
    // Такие профили уже созданы: автосоздание раньше писало cities: [], и
    // плановый сборщик у таких организаций не фильтровал грузы по региону
    // базы и не искал по общей бирже. Живой замер: профиль «Основной
    // (Ярославль. Ул. Докучалова 12)» с городами [] — «Собрать» давало
    // «собрано 195», с биржи 0, новых 0.
    if (profiles.length > 0) {
      const settingsForHeal = await prisma.fleetSettings.findFirst({
        where: { organizationId: org.organizationId },
        select: { baseAddress: true },
      })
      const healedRegion = await regionOfBaseAddress(settingsForHeal?.baseAddress)
      const healCities = healedRegion ? [healedRegion.id] : []
      if (healCities.length > 0) {
        for (const profile of profiles) {
          if (parseProfileCities(profile.cities).length > 0) continue
          if (!profile.isActive) continue
          const healed = await prisma.atiScanConfig.update({
            where: { id: profile.id },
            data: { cities: JSON.stringify(healCities) },
          })
          profiles = profiles.map((row) => (row.id === healed.id ? healed : row))
        }
      }
    }

    if (profiles.length === 0) {
      const settings = await prisma.fleetSettings.findFirst({
        where: { organizationId: org.organizationId },
        select: { baseAddress: true },
      })
      const base = (settings?.baseAddress ?? "").trim()
      // Города профиля — из адреса базы. Раньше здесь был пустой список, и
      // плановый сборщик не фильтровал грузы по региону базы и не искал по
      // общей бирже: в кэш организации шли Москва, Калужская и Алтай, а
      // кнопка «Собрать» отчитывалась «собрано 195» при нуле новых грузов.
      // Город базы может быть не в своём словаре (199 городов) — тогда
      // регион определяет геокодер, он знает все 95 регионов.
      const baseRegion = await regionOfBaseAddress(base)
      const baseCities = baseRegion ? [baseRegion.id] : []
      const profile = await prisma.atiScanConfig.create({
        data: {
          organizationId: org.organizationId,
          name: base ? `Основной профиль (${base.split(",")[0].trim()})` : "Основной профиль",
          cities: JSON.stringify(baseCities),
          minWeight: null,
          truckTypes: "any",
          // 5 минут — максимум, который позволяют правила ATI и лимиты токена
          autoScanInterval: 5,
          isActive: true,
        },
      })
      profiles = [profile]
    }

    return NextResponse.json({ success: true, profiles })
  } catch (error) {
    console.error("[ATI ScanConfig] ошибка чтения:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось загрузить настройки сканирования" },
      { status: 500 },
    )
  }
}

interface ScanConfigBody {
  id?: unknown
  name?: unknown
  cities?: unknown
  minWeight?: unknown
  truckTypes?: unknown
  autoScanInterval?: unknown
  isActive?: unknown
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  // Настройки сканирования трогают всю организацию — только штаб
  if (!["admin", "logist"].includes(auth.value.user.role)) {
    return NextResponse.json(
      { success: false, error: "Настраивать сканирование могут сотрудники штаба" },
      { status: 403 },
    )
  }

  let body: ScanConfigBody
  try {
    body = (await request.json()) as ScanConfigBody
  } catch {
    return NextResponse.json(
      { success: false, error: "Некорректное тело запроса" },
      { status: 400 },
    )
  }

  const cities = Array.isArray(body.cities)
    ? body.cities
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    : []

  const minWeight =
    body.minWeight !== undefined && body.minWeight !== null && body.minWeight !== ""
      ? Math.max(0, Number(body.minWeight) || 0)
      : null

  const truckTypes =
    typeof body.truckTypes === "string" && body.truckTypes.trim()
      ? body.truckTypes.trim().slice(0, 200)
      : "any"

  let autoScanInterval = 5
  if (body.autoScanInterval !== undefined) {
    const value = Number(body.autoScanInterval)
    if (Number.isFinite(value)) {
      autoScanInterval = Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, value))
    }
  }

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 100)
      : "Основной профиль"

  try {
    let profile
    if (body.id) {
      // Обновление — только своего профиля своей организации
      const existing = await prisma.atiScanConfig.findFirst({
        where: scopedWhere(org.organizationId, { id: String(body.id) }),
      })
      if (!existing) {
        return NextResponse.json(
          { success: false, error: "Профиль не найден" },
          { status: 404 },
        )
      }
      profile = await prisma.atiScanConfig.update({
        where: { id: existing.id },
        data: {
          name,
          cities: JSON.stringify(cities),
          minWeight,
          truckTypes,
          autoScanInterval,
          isActive: body.isActive === undefined ? existing.isActive : Boolean(body.isActive),
        },
      })
    } else {
      // Создание: первый профиль — активный по умолчанию
      const count = await prisma.atiScanConfig.count({
        where: scopedWhere(org.organizationId, {}),
      })
      profile = await prisma.atiScanConfig.create({
        data: {
          organizationId: org.organizationId,
          name,
          cities: JSON.stringify(cities),
          minWeight,
          truckTypes,
          autoScanInterval,
          isActive: body.isActive === undefined ? true : Boolean(body.isActive),
        },
      })
      if (count > 0 && body.isActive === true) {
        // Если создали активный — остальные гасим (один активный профиль)
        await prisma.atiScanConfig.updateMany({
          where: scopedWhere(org.organizationId, { id: { not: profile.id } }),
          data: { isActive: false },
        })
      }
    }

    await logAudit({
      action: "ati_scan_config_save",
      actorId: auth.value.user.id,
      actorEmail: auth.value.user.email,
      organizationId: org.organizationId,
      ip: getClientIp(request),
      metadata: { profileId: profile.id, cities: cities.length, autoScanInterval },
    })

    return NextResponse.json({ success: true, profile })
  } catch (error) {
    console.error("[ATI ScanConfig] ошибка сохранения:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось сохранить настройки сканирования" },
      { status: 500 },
    )
  }
}
