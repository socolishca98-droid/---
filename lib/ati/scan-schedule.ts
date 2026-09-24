// lib/ati/scan-schedule.ts
//
// Работа с расписанием сканирования в базе: какие профили (AtiScanConfig) пора
// запускать и когда отмечать, что скан прошёл.
//
// Почему профили читаются по всем организациям: сканируется ОБЩАЯ накопленная
// база грузов (AtiCache), и профили — это расписания наполнения этой базы, а не
// данные организации. Наружу из этого модуля уходят только города, радиус и
// фильтры — никаких заказов, водителей или цен организаций.
//
// Если профилей нет вообще (свежая база), cron работает как раньше: сканирует
// список основных хабов настройками по умолчанию.

import { prisma } from "@/lib/prisma"
import {
  buildProfileFilters,
  isProfileDue,
  parseProfileCities,
  type ScanProfileRow,
} from "@/lib/ati/scan-profile"

/** Все профили, которые сейчас должны сканироваться, и те, что ещё ждут. */
export async function getDueScanProfiles(now: Date = new Date()): Promise<{
  active: ScanProfileRow[]
  due: ScanProfileRow[]
  waiting: ScanProfileRow[]
}> {
  // Профили расписания общие: сканируется ОБЩАЯ накопленная база грузов, и из
  // профиля берутся только города, радиус и фильтры — заказы, цены и водители
  // организаций здесь не читаются.
  // org-audit: manual — профили расписания общие, данные организаций не читаются
  const rows = (await prisma.atiScanConfig.findMany({
    where: { isActive: true },
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
export async function markProfileScanned(id: string, at: Date = new Date()): Promise<void> {
  // id приходит из getDueScanProfiles (профиль уже отобран по расписанию)
  // org-audit: manual — отметка о скане в общем профиле расписания, не данные организации
  await prisma.atiScanConfig.updateMany({
    where: { id },
    data: { lastScanAt: at },
  })
}

/** Параметры скана для профиля: города, радиус и фильтры. */
export function scanParamsForProfile(profile: ScanProfileRow, mode: string) {
  return {
    mode,
    cityIds: parseProfileCities(profile.cities),
    radius: Number(profile.radius) > 0 ? Number(profile.radius) : 100,
    filters: buildProfileFilters(profile),
  }
}
