// lib/password-reset.ts
//
// Восстановление пароля: токен на почту → новый пароль.
//
// Раньше забывший пароль человек был заперт снаружи: пароль мог поменять только
// администратор, а в выходные или ночью этого сделать было некому. Теперь
// система сама высылает ссылку на почту учётной записи.
//
// Правила, из которых тут состоит вся безопасность:
//
//   1. В базе лежит только хэш токена (sha256). Сам токен знает почтовый ящик —
//      утечка базы не даёт войти под чужими аккаунтами.
//   2. Токен одноразовый: после использования он не работает повторно.
//   3. Токен живёт ограниченное время (PASSWORD_RESET_TTL_MINUTES, по
//      умолчанию 60 минут).
//   4. Новый запрос отменяет прежние неиспользованные токены этого человека —
//      иначе старые ссылки из писем продолжали бы работать.
//   5. Ответ на «забыли пароль» не говорит, существует ли такой адрес: иначе
//      форма превращается в способ проверить, зарегистрирован ли человек.
//   6. Успешный сброс отзывает все сессии этого человека: если пароль меняют
//      потому что в аккаунт попали, чужие сессии должны закрыться сразу.
//      Заодно снимается блокировка после неудачных попыток входа.

import "server-only"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { prisma } from "@/lib/prisma"
import { hashPassword } from "@/lib/auth/password"

/** Сколько живёт ссылка на сброс. Час — компромисс: хватает проверить почту,
 *  но не настолько долго, чтобы украденное письмо оставалось рабочим. */
export const DEFAULT_RESET_TTL_MINUTES = 60

/** Длина токена в байтах (32 → 64 символа hex). */
const TOKEN_BYTES = 32

export type PasswordResetRequest = {
  userId: string
  organizationId?: string | null
  requestIp?: string | null
}

export type IssuedPasswordReset = {
  /** Сам токен — только для письма. В базу не пишется. */
  token: string
  expiresAt: Date
}

function resetTtlMinutes(): number {
  const raw = Number(process.env.PASSWORD_RESET_TTL_MINUTES)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RESET_TTL_MINUTES
}

/** Хэш токена: тот же вид, что хранится в базе. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(String(token ?? "")).digest("hex")
}

function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex")
}

/**
 * Выдаёт токен восстановления и отменяет прежние неиспользованные.
 *
 * Возвращает сам токен (его надо положить в письмо) и срок жизни.
 */
export async function issuePasswordResetToken(
  params: PasswordResetRequest,
): Promise<IssuedPasswordReset> {
  const token = newToken()
  const tokenHash = hashResetToken(token)
  const expiresAt = new Date(Date.now() + resetTtlMinutes() * 60 * 1000)

  await prisma.$transaction([
    // Прежние ссылки перестают работать: иначе письмо из чата остаётся ключом
    prisma.passwordResetToken.updateMany({
      where: { userId: params.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: params.userId,
        organizationId: params.organizationId ?? null,
        expiresAt,
        requestIp: params.requestIp ?? null,
      },
    }),
  ])

  return { token, expiresAt }
}

export type PasswordResetOutcome =
  | { ok: true; userId: string; email: string | null; role: string }
  | { ok: false; error: string; code: "invalid_token" | "expired_token" }

/**
 * Проверяет токен и меняет пароль.
 *
 * Одноразовость обеспечивается не проверкой «usedAt == null», а атомарным
 * updateMany с условием usedAt: null — два параллельных запроса с одним
 * токеном не пройдут оба.
 */
export async function resetPasswordWithToken(params: {
  token: string
  newPassword: string
}): Promise<PasswordResetOutcome> {
  const token = String(params.token ?? "").trim()
  if (!token) {
    return { ok: false, error: "Ссылка восстановления неполная — запросите новую", code: "invalid_token" }
  }

  const tokenHash = hashResetToken(token)

  const claimed = await prisma.passwordResetToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, usedAt: true, expiresAt: true },
  })

  if (!record) {
    return { ok: false, error: "Ссылка восстановления недействительна — запросите новую", code: "invalid_token" }
  }
  if (claimed.count === 0) {
    // Токен есть, но уже использован или истёк: различать не нужно, оба случая
    // для человека означают «запросите новую ссылку»
    const expired = record.expiresAt.getTime() <= Date.now()
    return {
      ok: false,
      error: expired
        ? "Ссылка восстановления истела — запросите новую"
        : "Ссылка восстановления уже была использована — запросите новую",
      code: expired ? "expired_token" : "invalid_token",
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, email: true, role: true },
  })
  if (!user) {
    return { ok: false, error: "Учётная запись не найдена — обратитесь к администратору", code: "invalid_token" }
  }

  const { hash, salt } = await hashPassword(params.newPassword)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hash,
        passwordSalt: salt,
        // Пароль задан самим человеком — требовать смены при входе больше нечего
        mustChangePassword: false,
        // Сбрасываем блокировку после неудачных попыток: человек доказал,
        // что у него есть доступ к почте учётной записи
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    // Все прежние сессии закрыты: если пароль меняли из-за чужого доступа,
    // чужие сессии не должны продолжать работать
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ])

  return { ok: true, userId: user.id, email: user.email, role: user.role }
}

/** Проверка токена без смены пароля — чтобы форма сразу сказала «ссылка bad». */
export async function checkPasswordResetToken(token: string): Promise<{
  valid: boolean
  error?: string
}> {
  const value = String(token ?? "").trim()
  if (!value) return { valid: false, error: "Ссылка восстановления неполная" }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(value) },
    select: { usedAt: true, expiresAt: true },
  })

  if (!record) return { valid: false, error: "Ссылка восстановления недействительна" }
  if (record.usedAt) return { valid: false, error: "Ссылка уже была использована" }
  if (record.expiresAt.getTime() <= Date.now()) {
    return { valid: false, error: "Ссылка восстановления истекла" }
  }

  return { valid: true }
}

/** Уборка истёкших токенов — вызывается из cron рядом с очисткой кэша ATI. */
export async function cleanupPasswordResetTokens(): Promise<{ deleted: number }> {
  const result = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
  })
  return { deleted: result.count }
}

/** Сравнение токенов в постоянном времени (для служебных проверок). */
export function resetTokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(String(provided ?? ""))
  const b = Buffer.from(String(expected ?? ""))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
