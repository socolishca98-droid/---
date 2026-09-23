// app/api/ati/sandbox/route.ts
import { requireStaffAuth } from "@/lib/api-auth"
import {requireStaffOrganization} from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET — грузы в песочнице (status = "imported")
export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const items = await prisma.atiCache.findMany({
      where: { status: "imported" },
      orderBy: { scannedAt: "desc" },
      take: 100,
    })

    const loads = items.map((item: any) => ({
      id: item.id,
      atiLoadId: item.atiLoadId,
      from: item.routeFrom,
      to: item.routeTo,
      price: item.price ?? 0,
      weight: item.weight ?? 0,
      distance: item.distance ?? 0,
      cargo: item.cargoType || "Груз",
      company: item.firmName || "Частник",
      phone: item.contactPhone,
      contactName: item.contactName,
      firmId: item.firmId,
      loadingDate: item.loadingDate ? item.loadingDate.toISOString() : null,
    }))

    return NextResponse.json(loads)
  } catch (error) {
    console.error("[ATI Sandbox GET] Error:", error)
    return NextResponse.json([], { status: 500 })
  }
}

// DELETE — вернуть груз обратно в базу (status = "new")
export async function DELETE(req: NextRequest) {
  const __auth = await requireStaffAuth(req);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const body = await req.json().catch(() => ({}))
    const { id } = body as { id?: string }

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id required" },
        { status: 400 }
      )
    }

    await prisma.atiCache.update({
      where: { id },
      data: { 
        status: "new",
        contactPhone: null,
        contactName: null,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[ATI Sandbox DELETE] Error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to reset status" },
      { status: 500 }
    )
  }
}