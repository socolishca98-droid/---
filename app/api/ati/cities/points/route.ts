// app/api/ati/cities/points/route.ts
//
// Координаты городов биржи — для сборки маршрута «по пути».
//
// Зачем: помощник строит цепочку плеч не только по точному совпадению
// городов, но и «по дороге»: груз из города рядом с маршрутом тоже берут,
// если он в пределах радиуса. Без координат «рядом» не измерить.
//
// Точки считаем через общий геокодер с постоянным кэшем (GeoCache):
// повторный вопрос о том же городе базу не трогает. Города без координат
// возвращаются как null — помощник тогда решает по названию города.
//
// Города приходят короткими («Подольск») в `cities` или полными адресами
// биржи («Шарапово д. (Новомосковский административный округ), Московская
// область») в `places` — через «|», потому что внутри адреса есть запятые.
// Полный адрес важен: ATI пишет точки как «Среднесибирский п.», и без
// региона геокодер находит одноимённое село в другом крае. В ответе ключ —
// короткое название города, чтобы вызывающему было удобно искать.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { geocodeAddresses } from "@/lib/geo/geocode"
import { normalizeCityKey } from "@/lib/logist-mobile/city-norm"
import { shortCity } from "@/lib/logist-mobile/format"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Сколько адресов максимум геокодируем за один запрос. Ограничение
 * геокодера: 12 адресов за вызов, иначе хвост молча остаётся без точек.
 */
const MAX_CITIES = 40

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  const { searchParams } = new URL(request.url)
  const cities = (searchParams.get("cities") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_CITIES)
  // Полные адреса биржи: разделитель «|», внутри адреса запятые
  const places = (searchParams.get("places") ?? "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_CITIES)

  const targets = [...cities, ...places]

  const points: Record<string, { lat: number; lng: number } | null> = {}
  if (targets.length === 0) return NextResponse.json({ points })

  try {
    const resolved = await geocodeAddresses(targets)
    for (const target of targets) {
      const point = resolved.get(target) ?? null
      points[normalizeCityKey(shortCity(target))] = point ? { lat: point.lat, lng: point.lng } : null
    }
    return NextResponse.json({ points })
  } catch (error) {
    console.error("[ATI cities/points] ошибка:", error)
    // Не смогли посчитать точки — не ошибка экрана: соберём по названиям
    return NextResponse.json({ points, error: "Не удалось посчитать расстояния" })
  }
}
