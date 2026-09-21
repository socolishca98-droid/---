// app/api/traffic/batch/route.ts

import { NextRequest, NextResponse } from "next/server"
import { getRouteTraffic } from "@/lib/traffic/service"
import type { LatLng, TrafficBatchResponse, TrafficRouteInfo } from "@/lib/traffic/types"

import { requireStaff } from "@/lib/auth/session"

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

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  try {
    const url = new URL(request.url)
    const debug = url.searchParams.get("debug") === "1"

    const body = (await request.json().catch(() => ({}))) as BatchBody
    const routes = Array.isArray(body.routes) ? body.routes : []

    if (routes.length === 0) {
      return NextResponse.json(
        { success: false, error: "routes[] required" } as TrafficBatchResponse,
        { status: 400 },
      )
    }

    const trafficByRouteId: Record<string, TrafficRouteInfo> = {}
    const errorsByRouteId: Record<string, string> = {}

    for (const r of routes) {
      const routeId = typeof r.routeId === "string" ? r.routeId : ""
      const coordsRaw = Array.isArray(r.coordinates) ? r.coordinates : []
      const coordinates: LatLng[] = coordsRaw.filter(isLatLng)

      if (!routeId || coordinates.length < 2) continue

      try {
        const traffic = await getRouteTraffic({ routeId, coordinates })
        trafficByRouteId[routeId] = {
          provider: traffic.provider,
          generatedAt: new Date(traffic.generatedAtMs).toISOString(),
          expiresAt: new Date(traffic.expiresAtMs).toISOString(),
          segments: traffic.segments,
        }
      } catch (e: any) {
        if (debug) {
          const msg = String(e?.message || e || "unknown error")
          errorsByRouteId[routeId] = msg.slice(0, 400)
        }
        continue
      }
    }

    const base: TrafficBatchResponse = { success: true, trafficByRouteId }

    if (debug) {
      return NextResponse.json({
        ...base,
        debug: {
          trafficProvider: process.env.TRAFFIC_PROVIDER || "mock",
          yandexUrl: process.env.YANDEX_ROUTING_API_URL || null,
          hasYandexKey: Boolean(process.env.YANDEX_ROUTING_API_KEY),
          errorsByRouteId,
        },
      })
    }

    return NextResponse.json(base, { status: 200 })
  } catch (e: any) {
    console.error("[Traffic Batch] Error:", e)
    return NextResponse.json(
      { success: false, error: e?.message || "Traffic batch error" } as TrafficBatchResponse,
      { status: 500 },
    )
  }
}