// lib/ati/scan-schedule.ts
//
// Работа с расписанием сканирования в базе: какие профили (AtiScanConfig) пора
// запускать и когда отмечать, что скан прошёл.
//
// Профили принадлежат организациям: у каждой организации свой аккаунт ATI.SU,
// свои площадки и своя накопленная база грузов (AtiCache.organizationId).
// Cron обходит подключения организаций и для каждой запускает ЕЁ профили
// с ЕЁ токеном.
//
// Если профилей у организации нет, cron делает скан по умолчанию — грузы всех
// её площадок без гео-фильтра.

import { prisma } from "@/lib/prisma"
import { scopedWhere } from "@/lib/org"
import {
  buildProfileFilters,
  isProfileDue,
  parseProfileCities,
  type ScanProfileRow,
} from "@/lib/ati/scan-profile"

/** Профили организации, которые сейчас должны сканироваться, и те, что ждут. */
export async function getDueScanProfiles(
  organizationId: string,
  now: Date = new Date(),
): Promise<{
  active: ScanProfileRow[]
  due: ScanProfileRow[]
  waiting: ScanProfileRow[]
}> {
  // org-audit: ok — профили расписания читаются только своей организации
  const rows = (await prisma.atiScanConfig.findMany({
    where: scopedWhere(organizationId, { isActive: true }),
    orderBy: { createdAt: "asc" },
  })) as ScanProfileRow[]

  const due: ScanProfileRow[] = []
  const waiting: ScanProfileRow[] = []

  for (const profile of rows) {
    if (isProfileDue(profile, now)) due.push(profile)
    else waiting.push(profile)
  }

  return { active: rows, due, waiting }
}

/** Отмечает, что скан профиля прошёл: следующий запуск — по интервалу. */
export async function markProfileScanned(
  id: string,
  organizationId: string,
  at: Date = new Date(),
): Promise<void> {
  // org-audit: ok — профиль принадлежит организации из сессии/cron-обхода
  await prisma.atiScanConfig.updateMany({
    where: scopedWhere(organizationId, { id }),
    data: { lastScanAt: at },
  })
}

/**
 * Параметры скана для профиля: города, радиус, фильтры и источник.
 *
 * source: "both" — и площадки организации, и общая биржа. Без этого плановый
 * скан (и cron, и кнопка «Собрать») смотрел только на площадки организации:
 * живой замер дал «с биржи 0» при 45 грузах на площадках, хотя биржа по
 * региону базы отдаёт тысячи. Источники независимы — если биржа не ответит,
 * площадки всё равно соберутся.
 */
export function scanParamsForProfile(profile: ScanProfileRow, mode: string) {
  return {
    mode,
    source: "both" as const,
    cityIds: parseProfileCities(profile.cities),
    radius: Number(profile.radius) > 0 ? Number(profile.radius) : 100,
    filters: buildProfileFilters(profile),
  }
}
