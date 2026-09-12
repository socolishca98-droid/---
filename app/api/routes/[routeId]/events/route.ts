// app/api/routes/[routeId]/events/route.ts
// События рейса для таймлайна логиста
//
// GET /api/routes/:routeId/events

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

type RouteParams = {
  params: Promise<{ routeId: string }>
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
) {
  try {
    const { routeId } = await params

    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "routeId is required" },
        { status: 400 },
      )
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