// app/api/routes/[routeId]/backhaul/route.ts
//
// Подбор попутных грузов на обратное плечо рейса: загрузка в городе окончания
// рейса, выгрузка — в городе базы компании. Источники грузов — накопленная
// база поиска (ATI), статус «new». Только данные своей организации и общая
// поисковая база: чужих рейсов и заказов здесь нет.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import {
  backhaulCandidates,
  emptyReturnKm,
  routeEndpointCity,
  showBackhaulWarning,
} from "@/lib/routes/backhaul"
import { normalizeCity } from "@/lib/routes/optimizer"

type RouteParams = { params: Promise<{ routeId: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { routeId } = await params
    const route = await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, { id: routeId }),
      include: {
        orders: {
          where: scopedWhere(org.organizationId, {}),
          select: { routeTo: true, routeSequence: true },
          orderBy: { routeSequence: "asc" },
        },
        events: {
          where: { type: "location" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { latitude: true, longitude: true },
        },
      },
    })
    if (!route) {
      return NextResponse.json({ success: false, error: "Рейс не найден" }, { status: 404 })
    }

    const settings = await prisma.fleetSettings.findFirst({
      where: scopedWhere(org.organizationId),
      select: { baseAddress: true, baseLat: true, baseLng: true },
    })
    const baseCity = normalizeCity(settings?.baseAddress ?? "")
    const basePoint =
      settings?.baseLat != null && settings?.baseLng != null
        ? { lat: settings.baseLat, lng: settings.baseLng }
        : null

    const endpointCity = routeEndpointCity(route.orders)
    const lastEvent = route.events?.[0] ?? null
    const lastPoint =
      lastEvent?.latitude != null && lastEvent?.longitude != null
        ? { lat: lastEvent.latitude, lng: lastEvent.longitude }
        : null
    const returnKm = emptyReturnKm(lastPoint, basePoint)

    const loads = await prisma.atiCache.findMany({
      where: { status: "new" },
      select: {
        id: true,
        routeFrom: true,
        routeTo: true,
        distance: true,
        weight: true,
        price: true,
        cargoType: true,
      },
      take: 100,
      orderBy: { createdAt: "desc" },
    })

    const candidates = backhaulCandidates(endpointCity, baseCity, loads)

    return NextResponse.json({
      success: true,
      endpointCity,
      baseCity,
      emptyReturnKm: returnKm,
      warning: showBackhaulWarning(endpointCity, baseCity, returnKm),
      candidates,
    })
  } catch (error: any) {
    console.error("[Route Backhaul] GET Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Backhaul GET error" },
      { status: 500 },
    )
  }
}
