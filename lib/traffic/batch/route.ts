// app/api/traffic/batch/route.ts

import { NextRequest, NextResponse } from "next/server"
import { getRouteTraffic, type LatLng } from "@/lib/traffic/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type BatchBody = {
  routes?: { routeId?: string; coordinates?: LatLng[] }[]
}

function isLatLng(x: unknown): x is LatLng {
  return (
    Array.isArray(x) &&
    x.length === 2 &&
    typeof x[0] === "number" &&
    typeof x[1] === "number" &&
    Number.isFinite(x[0]) &&
    Number.isFinite(x[1])
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as BatchBody
    const routes = Array.isArray(body.routes) ? body.routes : []

    if (routes.length === 0) {
      return NextResponse.json(
        { success: false, error: "routes[] required" },
        { status: 400 },
      )
    }

    const trafficByRouteId: Record<
      string,
      {
        provider: string
        generatedAt: string
        expiresAt: string
        segments: { startT: number; endT: number; severity: number; delayMin?: number }[]
      }
    > = {}

    for (const r of routes) {
      const routeId = typeof r.routeId === "string" ? r.routeId : ""
      const coordsRaw = Array.isArray(r.coordinates) ? r.coordinates : []

      const coordinates: LatLng[] = coordsRaw.filter(isLatLng)

      if (!routeId || coordinates.length < 2) continue

      const traffic = await getRouteTraffic({ routeId, coordinates })

      trafficByRouteId[routeId] = {
        provider: traffic.provider,
        generatedAt: new Date(traffic.generatedAtMs).toISOString(),
        expiresAt: new Date(traffic.expiresAtMs).toISOString(),
        segments: traffic.segments,
      }
    }

    return NextResponse.json({ success: true, trafficByRouteId })
  } catch (e: any) {
    console.error("[Traffic Batch] Error:", e)
    return NextResponse.json(
      { success: false, error: e?.message || "Traffic batch error" },
      { status: 500 },
    )
  }
}