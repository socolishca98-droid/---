// lib/ati/ati-city-resolver.ts
// CityId из грузов byboards → имя города. Сначала компактный срез из
// репозитория (крупные города), затем полный справочник из таблицы AtiCity
// (scripts/seed-ati-cities.ts). Внешних запросов нет — только БД/JSON.

import { prisma } from "@/lib/prisma"
import { ATI_CITIES } from "./ati-cities"

export type AtiCityInfo = { name: string; region: string }

/** Компактный срез: cityId → [name, region] (lib/ati/ati-cities.ts). */
const BUILTIN = ATI_CITIES

/**
 * Резолв списка CityId → { name, region }.
 * Неизвестные города (нет ни в срезе, ни в БД) в результат не попадают.
 */
export async function resolveAtiCities(
  cityIds: number[]
): Promise<Map<number, AtiCityInfo>> {
  const out = new Map<number, AtiCityInfo>()
  const missing: number[] = []

  for (const id of cityIds) {
    if (!Number.isFinite(id)) continue
    const hit = BUILTIN[String(id)]
    if (hit) out.set(id, { name: hit[0], region: hit[1] })
    else missing.push(id)
  }

  if (missing.length > 0) {
    try {
      const rows = await prisma.atiCity.findMany({
        where: { cityId: { in: missing } },
        select: { cityId: true, name: true, region: true },
      })
      for (const row of rows) {
        out.set(row.cityId, { name: row.name, region: row.region })
      }
    } catch {
      // БД может быть недоступна (например, сиды без миграции) — работаем
      // на том, что есть во встроенном срезе.
    }
  }

  return out
}
