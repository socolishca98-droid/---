// app/api/m/login/route.ts - P1-5 refresh rotation
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  signAccessJwt,
  signRefreshJwt,
  setDriverAuthCookie,
  setDriverRefreshCookie,
  DRIVER_REFRESH_EXPIRES_IN,
} from "@/lib/auth-server"
import {
  getClientIp,
  checkRateLimit,
  recordFailure,
  resetRateLimit,
  buildRateLimitHeaders,
} from "@/lib/rate-limiter"
import { generateJti, createRefreshEntry } from "@/lib/refresh-tokens"

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

    const targetDigits = normalizePhone(phone).slice(-10)
    const ip = getClientIp(req)
    const rateKey = `driver:${ip}:${targetDigits}`

    const rlCheck = checkRateLimit(rateKey)
    if (!rlCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: "Слишком много попыток входа. Попробуйте через 15 минут.",
        },
        { status: 429, headers: buildRateLimitHeaders(rlCheck) }
      )
    }

    const normalizedOrg = normalizeOrgName(organization)
    const expectedOrg = normalizeOrgName(TEST_ORGANIZATION_NAME)

    if (normalizedOrg !== expectedOrg && normalizedOrg !== "loginex") {
      const after = recordFailure(rateKey)
      return NextResponse.json(
        { success: false, error: "Организация не найдена" },
        { status: 404, headers: buildRateLimitHeaders(after) }
      )
    }

    const allDrivers = await prisma.driver.findMany()
    const driver = allDrivers.find((d: any) => {
      const dDigits = normalizePhone(d.phone || "").slice(-10)
      return dDigits === targetDigits || (d.phone && d.phone.includes(targetDigits))
    })

    if (!driver) {
      const after = recordFailure(rateKey)
      return NextResponse.json(
        { success: false, error: "Водитель не найден в штате автопарка" },
        { status: 404, headers: buildRateLimitHeaders(after) }
      )
    }

    resetRateLimit(rateKey)

    // P1-5: access 15min + refresh 30d
    const accessToken = signAccessJwt({
      sub: driver.id,
      phone: driver.phone,
      role: "driver",
    })

    const jti = generateJti()
    const refreshToken = signRefreshJwt({ sub: driver.id, role: "driver", jti }, DRIVER_REFRESH_EXPIRES_IN)

    createRefreshEntry({
      jti,
      userId: driver.id,
      role: "driver",
      expiresInMs: DRIVER_REFRESH_EXPIRES_IN * 1000,
      ip,
    })

    const response = NextResponse.json(
      {
        success: true,
        token: accessToken,
        refreshToken,
        driver: {
          id: driver.id,
          name: driver.name,
          phone: driver.phone,
          vehicleType: driver.vehicleType,
          vehiclePlate: driver.vehiclePlate,
          status: driver.status,
        },
      },
      {
        headers: buildRateLimitHeaders({
          allowed: true,
          remaining: 5,
          resetAt: Date.now() + 15 * 60 * 1000,
          currentCount: 0,
        }),
      }
    )

    setDriverAuthCookie(response, accessToken)
    setDriverRefreshCookie(response, refreshToken)

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
