// app/api/routes/[routeId]/events/route.ts
// События рейса для таймлайна логиста
//
// GET /api/routes/:routeId/events

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { canDriverAccessRoute, forbidden, requireAnySession } from "@/lib/auth/session"
type RouteParams = {
  params: Promise<{ routeId: string }>
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  try {
    const { routeId } = await params

    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "routeId is required" },
        { status: 400 },
      )
    }

    // Водитель видит события только своего рейса
    if (!(await canDriverAccessRoute(auth.value, routeId))) {
      return forbidden("Рейс назначен другому водителю")
    }

    const events = await prisma.routeEvent.findMany({
      where: { routeId },
      orderBy: { createdAt: "asc" },
      take: 200,
    })

    return NextResponse.json({
      success: true,
      events,
    })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error"
    console.error("[RouteEvents API] GET error:", message, error)
    return NextResponse.json(
      { success: false, error: message, events: [] },
      { status: 500 },
    )
  }
}