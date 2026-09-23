// app/api/fleet/settings/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    // Настройки автопарка свои у каждой организации (раньше была одна на всю базу)
    let settings = await prisma.fleetSettings.findFirst({
      where: scopedWhere(__org.organizationId),
    })

    if (!settings) {
      settings = await prisma.fleetSettings.create({
        data: {
          organizationId: __org.organizationId,
          parkName: "Наш автопарк",
          baseAddress: null,
          baseLat: null,
          baseLng: null,
        },
      })
    }

    return NextResponse.json({ success: true, settings })
  } catch (error: any) {
    console.error("[Fleet Settings] GET Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Fleet settings GET error" },
      { status: 500 },
    )
  }
}

// POST /api/fleet/settings
// body: { parkName?: string; baseAddress?: string; baseLat?: number | null; baseLng?: number | null }
export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const body = await request.json().catch(() => ({}))
    const {
      parkName,
      baseAddress,
      baseLat,
      baseLng,
    } = body as {
      parkName?: string
      baseAddress?: string
      baseLat?: number | null
      baseLng?: number | null
    }

    const data: any = {}
    if (parkName !== undefined) data.parkName = parkName
    if (baseAddress !== undefined) data.baseAddress = baseAddress
    if (baseLat !== undefined) data.baseLat = baseLat
    if (baseLng !== undefined) data.baseLng = baseLng

    const settings = await prisma.fleetSettings.upsert({
      // organizationId — уникальный ключ настроек организации (@@unique в схеме)
      where: { organizationId: __org.organizationId },
      create: {
        organizationId: __org.organizationId,
        parkName: parkName || "Наш автопарк",
        baseAddress: baseAddress || null,
        baseLat: baseLat ?? null,
        baseLng: baseLng ?? null,
      },
      update: data,
    })

    return NextResponse.json({ success: true, settings })
  } catch (error: any) {
    console.error("[Fleet Settings] POST Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Fleet settings POST error" },
      { status: 500 },
    )
  }
}