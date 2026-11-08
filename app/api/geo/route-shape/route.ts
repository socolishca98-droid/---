// app/api/geo/route-shape/route.ts
//
// POST /api/geo/route-shape — геометрия ДОРОГИ для точек плана.
//
// Зачем: карта в помощнике сборки показывает вариант маршрута ещё ДО
// создания рейса — у неё нет routeId, и эндпоинт /api/routes/:id/map не
// подходит. Раньше карта рисовала прямые между городами («сквозь дома и
// поля»): логист не видел форму поездки, ради которой карта и стоит на
// экране. Теперь карта спрашивает дорогу здесь — по тем же точкам,
// которые уже показаны кружками.
//
// Правила:
//   · OSRM зовётся только с сервера (публичные серверы лимитируют по IP,
//     и браузеру напрямую ходить нельзя) — основной сервер, затем
//     запасной;
//   · каждый участок кэшируется в памяти процесса на 30 минут: карту
//     открывают и закрывают, а плечо Ярославль→Нижний не меняется;
//   · если дорогу получить не удалось — честная прямая с source:"line"
//     (карта рисует её пунктиром, чтобы отличалась от дороги);
//   · точек не больше 12 и координаты проверяются: эндпоинт не должен
//     стать открытым прокси к чужому сервису.

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import {
  fetchOSRMRouteFrom,
  OSRM_BASE_URL,
  OSRM_FALLBACK_BASE_URL,
  decodePolyline,
} from "@/lib/eta/osrm-client"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_POINTS = 12
const CACHE_TTL_MS = 30 * 60_000
const CACHE_LIMIT = 300

type Leg = {
  geometry: [number, number][]
  km: number
  min: number
  source: "osrm" | "line"
}

/** Кэш участков в памяти процесса: ключ — округлённые координаты пары. */
const shapeCache = new Map<string, { at: number; leg: Leg }>()

function cacheKey(a: [number, number], b: [number, number]): string {
  const r = (v: number) => v.toFixed(4)
  return `${r(a[0])},${r(a[1])}->${r(b[0])},${r(b[1])}`
}

function getCached(key: string): Leg | null {
  const hit = shapeCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    shapeCache.delete(key)
    return null
  }
  return hit.leg
}

function putCached(key: string, leg: Leg): void {
  if (shapeCache.size >= CACHE_LIMIT) {
    // Простейшая защита от роста: срезаем старейшую треть.
    const keys = [...shapeCache.entries()].sort((x, y) => x[1].at - y[1].at)
    for (const [k] of keys.slice(0, Math.ceil(keys.length / 3))) shapeCache.delete(k)
  }
  shapeCache.set(key, { at: Date.now(), leg })
}

async function roadLeg(a: [number, number], b: [number, number]): Promise<Leg> {
  const key = cacheKey(a, b)
  const cached = getCached(key)
  if (cached) return cached

  const ask = async (baseUrl: string) => {
    const osrm = await fetchOSRMRouteFrom(
      baseUrl,
      { lat: a[0], lng: a[1] },
      { lat: b[0], lng: b[1] },
      [],
      { overview: "simplified" },
    )
    const route = osrm.routes[0]
    const geometry = decodePolyline(route.geometry).map((p) => [p.lat, p.lng] as [number, number])
    if (geometry.length < 2) throw new Error("пустая геометрия")
    return {
      geometry,
      km: Math.round((route.distance / 1000) * 10) / 10,
      min: Math.round(route.duration / 60),
      source: "osrm" as const,
    }
  }

  let leg: Leg
  try {
    leg = await ask(OSRM_BASE_URL)
  } catch {
    try {
      leg = await ask(OSRM_FALLBACK_BASE_URL)
    } catch (error) {
      console.error("[geo/route-shape] OSRM недоступен:", error)
      // Честная прямая: карта покажет её пунктиром как «не дорога».
      leg = { geometry: [a, b], km: 0, min: 0, source: "line" }
    }
  }
  if (leg.source === "osrm") putCached(key, leg)
  return leg
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  try {
    const body = (await request.json().catch(() => ({}))) as { points?: unknown }
    const rawPoints = Array.isArray(body.points) ? body.points : []

    if (rawPoints.length < 2 || rawPoints.length > MAX_POINTS) {
      return NextResponse.json(
        { success: false, error: `Нужно от 2 до ${MAX_POINTS} точек` },
        { status: 400 },
      )
    }

    const points: [number, number][] = []
    for (const raw of rawPoints) {
      const lat = Number((raw as { lat?: unknown })?.lat)
      const lng = Number((raw as { lng?: unknown })?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return NextResponse.json(
          { success: false, error: "Некорректные координаты" },
          { status: 400 },
        )
      }
      points.push([lat, lng])
    }

    const legs: Leg[] = []
    for (let i = 0; i < points.length - 1; i += 1) {
      legs.push(await roadLeg(points[i], points[i + 1]))
    }

    const all = legs.flatMap((leg) => leg.geometry)
    const bounds: [[number, number], [number, number]] | null =
      all.length > 0
        ? [
            [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1]))],
            [Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))],
          ]
        : null

    return NextResponse.json({
      success: true,
      legs: legs.map((leg) => ({
        geometry: leg.geometry,
        km: leg.km,
        min: leg.min,
        source: leg.source,
      })),
      bounds,
      totalKm: Math.round(legs.reduce((sum, leg) => sum + leg.km, 0) * 10) / 10,
      totalMin: legs.reduce((sum, leg) => sum + leg.min, 0),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "route shape error"
    console.error("[geo/route-shape] POST error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось получить дорогу" },
      { status: 500 },
    )
  }
}
