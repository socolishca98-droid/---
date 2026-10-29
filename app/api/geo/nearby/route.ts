// app/api/geo/nearby/route.ts
//
// «Что рядом» для водителя: АЗС, места отдыха и отели вокруг точки.
//
// Зачем свой маршрут, а не прямой запрос из браузера: публичный Overpass
// (overpass-api.de) не отдаёт CORS-заголовки, поэтому запрос со страницы
// водителя блокировался браузером и выглядел как «вокруг ничего нет». Здесь
// запрос идёт с сервера, а причина неудачи возвращается словами, чтобы экран
// не выдавал сетевую ошибку за пустую карту.

import { NextRequest, NextResponse } from "next/server"
import { requireStaffAuth } from "@/lib/api-auth"
import { loadDriverSession, loadStaffSession } from "@/lib/auth/session"
import { searchNearby } from "@/lib/geo/overpass"
import {
  formatMeters,
  nearbyOutcome,
  type NearbyKind,
} from "@/lib/geo/nearby"

export const dynamic = "force-dynamic"

const KINDS: NearbyKind[] = ["fuel", "rest", "hotel"]
const MAX_RADIUS_M = 50_000

export async function GET(request: NextRequest) {
  // Экран открывает водитель (/m/nearby), но тот же список нужен и логисту
  const driver = await loadDriverSession(request)
  if (!driver) {
    const staff = await loadStaffSession(request)
    if (!staff) {
      return NextResponse.json(
        { success: false, error: "Нужен вход в приложение", code: "unauthorized" },
        { status: 401 },
      )
    }
  }

  const lat = Number(request.nextUrl.searchParams.get("lat"))
  const lng = Number(request.nextUrl.searchParams.get("lng"))
  const kindParam = request.nextUrl.searchParams.get("kind") ?? "fuel"
  const kind = (KINDS as string[]).includes(kindParam) ? (kindParam as NearbyKind) : "fuel"
  const radius = Number(request.nextUrl.searchParams.get("radius") ?? 7000)
  const radiusM = Number.isFinite(radius) && radius > 0 ? Math.min(radius, MAX_RADIUS_M) : 7000

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json(
      { success: false, error: "Нужны координаты точки: lat и lng", code: "bad_coordinates" },
      { status: 400 },
    )
  }

  const { places, failed } = await searchNearby(lat, lng, kind, radiusM)
  const outcome = nearbyOutcome(places, Math.round(radiusM / 1000), failed)

  return NextResponse.json({
    success: !failed,
    places: outcome.places,
    problem: outcome.problem,
    message: outcome.message,
    // Подпись радиуса для экрана — чтобы клиент не повторял округление
    radiusLabel: formatMeters(radiusM),
    error: failed ? outcome.message : undefined,
  })
}
