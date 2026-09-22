// app/api/m/login/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { signJwt, setDriverAuthCookie } from "@/lib/auth-server"

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

    // Проверяем принадлежность к автопарку
    if (normalizedOrg !== expectedOrg && normalizedOrg !== "loginex") {
      return NextResponse.json(
        { success: false, error: "Организация не найдена" },
        { status: 404 }
      )
    }

    const targetDigits = normalizePhone(phone).slice(-10)

    // Ищем водителя с нормализацией телефона без привязки к скобкам и дефисам
    const allDrivers = await prisma.driver.findMany()
    const driver = allDrivers.find((d: any) => {
      const dDigits = normalizePhone(d.phone || "").slice(-10)
      return dDigits === targetDigits || (d.phone && d.phone.includes(targetDigits))
    })

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Водитель не найден в штате автопарка" },
        { status: 404 }
      )
    }

    // Создаем подписанный токен для водителя на 30 дней
    const token = signJwt(
      {
        sub: driver.id,
        phone: driver.phone,
        role: "driver",
      },
      30 * 24 * 3600
    )

    const response = NextResponse.json({
      success: true,
      token,
      driver: {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        vehiclePlate: driver.vehiclePlate,
        status: driver.status,
      },
    })

    // Устанавливаем защищенную HttpOnly cookie
    setDriverAuthCookie(response, token)

    return response
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error"
    console.error("POST /api/m/login error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
