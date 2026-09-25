/**
 * Сид-скрипт авторизации.
 *
 *   npm run seed:auth
 *
 * Что делает:
 *  1. Проверяет, что AUTH_SECRET задан (без него система не пустит никого).
 *  1b. Создаёт организацию (ORGANIZATION_NAME, по умолчанию — «ИП Фролов Иван
 *      Александрович») и привязывает к ней администратора, водителей и их учётки.
 *      Без организации доступ не работает: lib/org.ts отвечает 403.
 *  2. Создаёт первого администратора из ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME.
 *     Если администратор уже есть — пароль НЕ перезаписывается.
 *  3. Создаёт учётные записи (роль driver) для всех карточек Driver, у которых их ещё нет.
 *     Пароль — из DRIVER_DEFAULT_PASSWORD, иначе генерируется и печатается в консоль.
 *     Таким учёткам ставится mustChangePassword = true.
 *  4. Чистит истёкшие и давно отозванные сессии.
 *
 * Скрипт идемпотентен: повторный запуск ничего не ломает и не дублирует.
 */

import { prisma } from "../lib/prisma"
import {
  generateTemporaryPassword,
  hashPassword,
  validatePasswordStrength,
} from "../lib/auth/password"
import { normalizePhone } from "../lib/auth/constants"
import { normalizeOrganizationName } from "../lib/organizations"

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

const DEFAULT_ORGANIZATION_NAME = "ИП Фролов Иван Александрович"

function env(name: string): string {
  return (process.env[name] || "").trim()
}

/**
 * Организация, которой принадлежат все данные разработки.
 * Создаётся один раз; повторный запуск находит существующую.
 */
async function ensureOrganization(): Promise<string> {
  const name = env("ORGANIZATION_NAME") || DEFAULT_ORGANIZATION_NAME
  const nameKey = normalizeOrganizationName(name)

  const existing = await prisma.organization.findFirst({
    where: { nameKey },
    orderBy: { createdAt: "asc" },
  })

  if (existing) {
    console.log(`• Организация «${existing.name}» уже есть (${existing.id})`)
    return existing.id
  }

  const organization = await prisma.organization.create({ data: { name, nameKey } })
  await prisma.fleetSettings.upsert({
    where: { organizationId: organization.id },
    create: { organizationId: organization.id, parkName: organization.name },
    update: {},
  })
  console.log(`✔ Создана организация «${organization.name}» (${organization.id})`)
  return organization.id
}

/**
 * Подтягивает organizationId у записей, созданных до появления организаций
 * (водители, машины, заказы и остальные бизнес-данные).
 * Полный перенос делает `npm run db:migrate-orgs`; здесь — страховка,
 * чтобы сид не оставлял «ничьих» карточек водителей.
 */
async function attachDriversToOrganization(organizationId: string): Promise<void> {
  const result = await prisma.driver.updateMany({
    where: { organizationId: null },
    data: { organizationId },
  })
  if (result.count > 0) {
    console.log(`✔ Карточек водителей привязано к организации: ${result.count}`)
  }
}

async function ensureAdmin(organizationId: string): Promise<void> {
  const email = env("ADMIN_EMAIL").toLowerCase()
  const password = env("ADMIN_PASSWORD")
  const name = env("ADMIN_NAME") || "Администратор"

  if (!email || !password) {
    console.warn(
      "⚠ ADMIN_EMAIL / ADMIN_PASSWORD не заданы в .env — администратор не создан.\n" +
        "  Без него одобрять регистрации некому (если пользователей нет вовсе,\n" +
        "  первая регистрация на /register автоматически станет администратором).",
    )
    return
  }

  const strength = validatePasswordStrength(password)
  if (!strength.ok) {
    throw new Error(`ADMIN_PASSWORD не соответствует требованиям: ${strength.error}`)
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    if (existing.role !== "admin" || existing.status !== "active" || !existing.organizationId) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          role: "admin",
          status: "active",
          suspendedAt: null,
          suspendReason: null,
          organizationId: existing.organizationId ?? organizationId,
        },
      })
      console.log(`✔ Администратор ${email} приведён в состояние active/admin в организации`)
    } else {
      console.log(`• Администратор ${email} уже есть — пароль не меняю`)
    }
    return
  }

  const { hash, salt } = await hashPassword(password)
  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: hash,
      passwordSalt: salt,
      role: "admin",
      status: "active",
      approvedAt: new Date(),
      organizationId,
    },
  })
  console.log(`✔ Создан администратор ${email}`)
}

async function ensureDriverUsers(organizationId: string): Promise<void> {
  const drivers = await prisma.driver.findMany({
    select: { id: true, name: true, phone: true, organizationId: true },
    orderBy: { createdAt: "asc" },
  })

  if (drivers.length === 0) {
    console.log("• Карточек водителей нет — учётки не создаю")
    return
  }

  const defaultPassword = env("DRIVER_DEFAULT_PASSWORD")
  if (defaultPassword) {
    const strength = validatePasswordStrength(defaultPassword)
    if (!strength.ok) {
      throw new Error(`DRIVER_DEFAULT_PASSWORD не соответствует требованиям: ${strength.error}`)
    }
  }

  let created = 0
  const printed: string[] = []

  for (const driver of drivers) {
    const phone = normalizePhone(driver.phone)
    if (phone.length < 10) {
      console.warn(`⚠ Водитель «${driver.name}»: телефон «${driver.phone}» не распознан — пропуск`)
      continue
    }

    const existingByLink = await prisma.user.findUnique({ where: { driverId: driver.id } })
    const existingByPhone = await prisma.user.findFirst({ where: { phone } })
    if (existingByLink || existingByPhone) {
      continue
    }

    const password = defaultPassword || generateTemporaryPassword()
    const { hash, salt } = await hashPassword(password)

    try {
      await prisma.user.create({
        data: {
          phone,
          name: driver.name,
          passwordHash: hash,
          passwordSalt: salt,
          role: "driver",
          status: "active",
          driverId: driver.id,
          approvedAt: new Date(),
          mustChangePassword: !defaultPassword,
          // организация водителя: из его карточки, иначе — организация разработки
          organizationId: driver.organizationId ?? organizationId,
        },
      })
      created++
      if (!defaultPassword) {
        printed.push(`    ${driver.name} · ${phone} · пароль: ${password}`)
      }
    } catch (error) {
      console.warn(
        `⚠ Не удалось создать учётку для водителя «${driver.name}» (${phone}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  if (created === 0) {
    console.log(`• Учётки водителей уже созданы (проверено ${drivers.length} карточек)`)
    return
  }

  console.log(`✔ Создано учётных записей водителей: ${created}`)
  if (defaultPassword) {
    console.log(
      `  Пароль у всех один — из DRIVER_DEFAULT_PASSWORD. Водители должны сменить его\n` +
        `  в приложении: Профиль → Сменить пароль (флаг mustChangePassword не выставлен).`,
    )
  } else {
    console.log("  Индивидуальные пароли (сообщите водителям, они обязаны их сменить):")
    for (const line of printed) console.log(line)
  }
}

async function cleanupSessions(): Promise<void> {
  const result = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: new Date(Date.now() - THIRTY_DAYS_MS) } }],
    },
  })
  console.log(`✔ Удалено устаревших сессий: ${result.count}`)
}

async function main(): Promise<void> {
  if (!env("AUTH_SECRET")) {
    throw new Error(
      "AUTH_SECRET не задан в .env. Сгенерируйте:\n" +
        '  node -e "console.log(require(\'node:crypto\').randomBytes(48).toString(\'hex\'))"',
    )
  }

  const organizationId = await ensureOrganization()
  await attachDriversToOrganization(organizationId)
  await ensureAdmin(organizationId)
  await ensureDriverUsers(organizationId)
  await cleanupSessions()

  const stats = {
    organizations: await prisma.organization.count(),
    withoutOrg: await prisma.user.count({ where: { organizationId: null } }),
    users: await prisma.user.count(),
    pending: await prisma.user.count({ where: { status: "pending" } }),
    active: await prisma.user.count({ where: { status: "active" } }),
    suspended: await prisma.user.count({ where: { status: "suspended" } }),
  }
  console.log(
    `\nИтог: организаций ${stats.organizations}, всего учётных записей ${stats.users} ` +
      `(активных ${stats.active}, ожидают одобрения ${stats.pending}, закрыт доступ ${stats.suspended})`,
  )
  if (stats.withoutOrg > 0) {
    console.warn(
      `⚠ Учётных записей без организации: ${stats.withoutOrg} — запустите npm run db:migrate-orgs`,
    )
  }
}

main()
  .catch((error) => {
    console.error("\n✖ seed:auth завершился ошибкой:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
