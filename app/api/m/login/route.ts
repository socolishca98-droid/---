// app/api/m/login/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const TEST_ORGANIZATION_NAME = "АИ Логистика"

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.startsWith("8") && digits.length === 11) return "7" + digits.slice(1)
  return digits
}

function normalizeOrgName(name: string): string {
  return name.trim().toLowerCase()
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      phone?: string
      organization?: string
    }

    const phone = body.phone
    const organization = body.organization

    if (!phone || !organization) {
      return NextResponse.json(
        { success: false, error: "Организация и телефон обязательны" },
        { status: 400 }
      )
    }

    const normalizedOrg = normalizeOrgName(organization)
    const expectedOrg = normalizeOrgName(TEST_ORGANIZATION_NAME)

    // Пока у нас одна тестовая организация — просто проверяем имя.
    // Когда появится модель Organization, сюда добавится фильтр по orgId.
    if (normalizedOrg !== expectedOrg) {
      return NextResponse.json(
        { success: false, error: "Организация не найдена" },
        { status: 404 }
      )
    }

    const normalizedPhone = normalizePhone(phone)
    const last10 = normalizedPhone.slice(-10)

    const driver = await prisma.driver.findFirst({
      where: {
        phone: { contains: last10 },
        // TODO: когда появится orgId у Driver:
        // orgId: someOrgId
      },
    })

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Водитель не найден" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      driver: {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        vehiclePlate: driver.vehiclePlate,
      },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error"
    console.error("POST /api/m/login error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}