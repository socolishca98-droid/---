// lib/db-init.ts - P0 hardened
import { prisma } from "@/lib/prisma"
import { hashPassword } from "@/lib/auth-server"

let isInitialized = false

function getDefaultAdminPassword(): string {
  const envPassword = process.env.ADMIN_DEFAULT_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD
  if (envPassword) {
    if (envPassword.length < 8) {
      console.warn('[DB Init] ADMIN_DEFAULT_PASSWORD too short, should be at least 8 chars')
    }
    return envPassword
  }
  if (process.env.NODE_ENV === 'production') {
    // In production, require explicit password
    console.warn('[DB Init] ADMIN_DEFAULT_PASSWORD not set in production, using random secure password - check logs and change immediately')
    // Generate random password for production if not set, but log warning
    const crypto = require('node:crypto')
    return crypto.randomBytes(16).toString('hex')
  }
  // Development fallback
  return "demo"
}

export async function ensureDbInitialized() {
  if (isInitialized) return

  try {
    // 1. Создание или проверка дефолтного администратора Loginex
    const admin = await prisma.user.findUnique({
      where: { email: "admin@loginex.ru" },
    })

    if (!admin) {
      const defaultPassword = getDefaultAdminPassword()
      const { salt, hash } = hashPassword(defaultPassword)
      await prisma.user.create({
        data: {
          email: "admin@loginex.ru",
          name: "Главный Логист (Loginex)",
          passwordHash: hash,
          salt: salt,
          role: "admin",
          status: "active",
        },
      })
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Loginex DB] Default admin created: admin@loginex.ru / ${defaultPassword}`)
      } else {
        console.log(`[Loginex DB] Default admin created: admin@loginex.ru - password set from env or generated`)
      }
    }

    // 2. Проверка наличия хотя бы одного активного водителя для мобильного входа
    const driverCount = await prisma.driver.count()
    if (driverCount === 0) {
      await prisma.driver.create({
        data: {
          id: "drv-1",
          name: "Алексей Смирнов",
          phone: "+7 (916) 123-45-67",
          status: "busy",
          vehiclePlate: "А123БВ777",
          vehicleType: "Тягач 20т (Scania R450)",
          rating: 4.9,
        },
      })
      console.log("[Loginex DB] Default driver created: +7 (916) 123-45-67")
    }

    // 3. Создание записей Route для существующих заказов
    const routesToEnsure = [
      {
        id: "route-m10-spb",
        name: "Рейс #101: Москва (Юг) — Тверь — СПб (Шушары)",
        status: "active",
        driverId: "drv-1",
        vehicleId: "veh-1",
        totalDistance: 710,
        totalCost: 98000,
        fuelExpense: 22000,
        cargoWeight: 19500,
        cargoVolume: 86.0,
      },
      {
        id: "route-m7-nn",
        name: "Рейс #102: Ногинск — Покров — Нижний Новгород",
        status: "active",
        driverId: "drv-2",
        vehicleId: "veh-2",
        totalDistance: 380,
        totalCost: 64000,
        fuelExpense: 14500,
        cargoWeight: 8500,
        cargoVolume: 42.0,
      },
      {
        id: "route-m4-vrn",
        name: "Рейс #103: Чехов — Тула — Воронеж",
        status: "active",
        driverId: "drv-3",
        vehicleId: "veh-3",
        totalDistance: 470,
        totalCost: 52000,
        fuelExpense: 11200,
        cargoWeight: 4800,
        cargoVolume: 28.0,
      },
      {
        id: "route-m8-yar",
        name: "Рейс #104: Москва (Север) — Переславль — Ярославль",
        status: "active",
        driverId: "drv-4",
        vehicleId: "veh-4",
        totalDistance: 260,
        totalCost: 49000,
        fuelExpense: 8500,
        cargoWeight: 18000,
        cargoVolume: 82.0,
      },
    ]

    for (const r of routesToEnsure) {
      const existing = await prisma.route.findUnique({ where: { id: r.id } })
      if (!existing) {
        try {
          await prisma.route.create({ data: r })
        } catch (e) {
          // Ignore if driver/vehicle not exist yet
          console.warn(`[Loginex DB] Could not create route ${r.id}:`, e)
        }
      }
    }

    isInitialized = true
  } catch (err) {
    console.error("[Loginex DB] Init error:", err)
    isInitialized = false
    // P0: Don't swallow error in production, rethrow for visibility
    if (process.env.NODE_ENV === 'production') {
      throw err
    }
  }
}

// For testing: reset initialization flag
export function resetDbInitFlag() {
  isInitialized = false
}
