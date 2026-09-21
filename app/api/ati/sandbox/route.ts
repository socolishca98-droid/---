// app/api/ati/sandbox/route.ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireStaff } from "@/lib/auth/session"
// GET — грузы в песочнице (status = "imported")
export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  try {
    const items = await prisma.atiCache.findMany({
      where: { status: "imported" },
      orderBy: { scannedAt: "desc" },
      take: 100,
    })

    const loads = items.map((item) => ({
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
export async function DELETE(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  try {
    const body = await request.json().catch(() => ({}))
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