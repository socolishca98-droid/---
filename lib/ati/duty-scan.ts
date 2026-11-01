// lib/ati/duty-scan.ts
//
// Сбор с биржи для дежурного: один вызов, который берёт токен организации,
// её профиль расписания (города, радиус, фильтры) и наполняет накопленную
// базу. Тот же путь, что у кнопки «Собрать» и cron, но собранный в одну
// функцию — чтобы дежурный не дублировал логику расписания у себя.

import { prisma } from "@/lib/prisma"
import { scanAtiLoads } from "@/lib/ati-client"
import { getActiveAtiToken } from "@/lib/ati/connection"
import { scanParamsForProfile } from "@/lib/ati/scan-schedule"
import { regionOfBaseAddress } from "@/lib/ati/base-region"

export interface DutyScanResult {
  ok: boolean
  /** Сколько грузов пришло/обновилось — как отчиталась биржа */
  scanned: number | null
  note: string
}

/**
 * Свежий сбор по профилю организации.
 *
 * Если профиля нет — скан без фильтров по региону базы: пустой профиль не
 * должен значить «дежурный ничего не нашёл».
 */
export async function scanForOrganization(organizationId: string): Promise<DutyScanResult> {
  const ati = await getActiveAtiToken(organizationId)
  if (!ati.ok) {
    return { ok: false, scanned: null, note: `Биржа недоступна: ${ati.error}` }
  }

  const profile = await prisma.atiScanConfig.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
  })

  let params: Record<string, unknown> = { mode: "normal" }
  if (profile) {
    params = { ...scanParamsForProfile(profile, "normal") }
  }
  // Профиль мог остаться без городов — тогда регион из адреса базы, иначе
  // скан уйдёт «во всю страну» и притащит чужие регионы.
  if (!Array.isArray(params.cityIds) || (params.cityIds as number[]).length === 0) {
    const settings = await prisma.fleetSettings.findFirst({
      where: { organizationId },
      select: { baseAddress: true },
    })
    const region = await regionOfBaseAddress(settings?.baseAddress)
    if (region) params.cityIds = [region.id]
  }

  try {
    const result = (await scanAtiLoads({
      ...params,
      token: ati.token,
      organizationId,
    })) as { success?: boolean; error?: string; saved?: number; found?: number; total?: number }

    if (result?.success === false) {
      return {
        ok: false,
        scanned: null,
        note: `Биржа ответила ошибкой: ${result.error ?? "без пояснения"}`,
      }
    }
    const saved = Number(result?.saved ?? result?.found ?? result?.total ?? 0)
    if (profile) {
      await prisma.atiScanConfig.updateMany({
        where: { id: profile.id, organizationId },
        data: { lastScanAt: new Date() },
      })
    }
    return {
      ok: true,
      scanned: Number.isFinite(saved) ? saved : null,
      note:
        saved > 0
          ? `Биржа отдала ${saved} грузов`
          : "Биржа ответила, новых грузов нет",
    }
  } catch (error) {
    return {
      ok: false,
      scanned: null,
      note: error instanceof Error ? `Биржа не ответила: ${error.message}` : "Биржа не ответила",
    }
  }
}
