/**
 * Сид владельца платформы.
 *
 *   npm run seed:owner
 *
 * Владелец — НЕ участник какой-либо компании по грузоперевозкам: его учётная
 * запись живёт без организации (organizationId = null). Его пульт /owner
 * открывается только после входа с его email и паролем (lib/auth/owner.ts),
 * во всех остальных случаях вход обычный и пульт никак себя не выдаёт.
 *
 * Что делает:
 *  1. Берёт OWNER_EMAIL (или DEFAULT_OWNER_EMAIL) и OWNER_PASSWORD из окружения.
 *  2. Создаёт учётную запись владельца, если её нет; если есть — отвязывает от
 *     организации (пульту компания не нужна) и ставит статус active.
 *  3. Пароль ставится ТОЛЬКО если задан OWNER_PASSWORD; существующий пароль
 *     без OWNER_PASSWORD не трогается.
 *
 * Скрипт идемпотентен: повторный запуск ничего не ломает.
 */

import { prisma } from "../lib/prisma"
import { hashPassword, validatePasswordStrength } from "../lib/auth/password"
import { ownerEmails } from "../lib/auth/owner"

function env(name: string): string {
  return (process.env[name] || "").trim()
}

async function main(): Promise<void> {
  if (!env("AUTH_SECRET")) {
    console.error("✗ AUTH_SECRET не задан — вход работать не будет. Заполните .env")
    process.exitCode = 1
    return
  }

  const email = (env("OWNER_EMAIL") || ownerEmails()[0]).toLowerCase()
  const password = env("OWNER_PASSWORD")
  const name = env("OWNER_NAME") || "Владелец платформы"

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, organizationId: true, status: true },
  })

  let passwordFields: { passwordHash: string; passwordSalt: string } | null = null
  if (password) {
    const strength = validatePasswordStrength(password)
    if (!strength.ok) {
      console.error(`✗ OWNER_PASSWORD не подходит: ${strength.error}`)
      process.exitCode = 1
      return
    }
    const { hash, salt } = await hashPassword(password)
    passwordFields = { passwordHash: hash, passwordSalt: salt }
  }

  if (!existing) {
    if (!passwordFields) {
      console.error("✗ Владельца ещё нет, а OWNER_PASSWORD не задан — создать нечем")
      process.exitCode = 1
      return
    }
    await prisma.user.create({
      data: {
        email,
        name,
        role: "admin",
        status: "active",
        organizationId: null,
        ...passwordFields,
      },
    })
    console.log(`✔ Создан владелец платформы ${email} (без организации)`)
    return
  }

  await prisma.user.update({
    where: { id: existing.id },
    data: {
      // Пульт владельца не принадлежит ни одной компании
      organizationId: null,
      status: "active",
      suspendedAt: null,
      suspendReason: null,
      failedLoginCount: 0,
      lockedUntil: null,
      ...(passwordFields ?? {}),
    },
  })
  console.log(
    `✔ Владелец ${email}: отвязан от организации, доступ открыт${passwordFields ? ", пароль обновлён" : ""}`,
  )
}

main()
  .catch((error) => {
    console.error("✗ seed-owner:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
