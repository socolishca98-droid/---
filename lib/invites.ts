// lib/invites.ts — инвайт-коды организаций.
//
// Присоединиться к существующей организации можно ТОЛЬКО по коду, который
// админ организации создаёт в её панели. Регистрация «по названию компании»
// невозможна намеренно: иначе любой мог бы попасть в чужую организацию,
// угадав её название.
//
// Код многоразовый, со сроком действия, ролью и (опционально) лимитом
// использований; админ может отозвать его в любой момент.
//
// Функции проверки статуса кода — чистые (без БД), поэтому покрыты
// unit-тестами: __tests__/organizations/invites.test.ts.

import { randomBytes } from "crypto"

import { prisma } from "@/lib/prisma"

/** Алфавит без визуально похожих символов (I, O, 0, 1). */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/** Сколько символов в коде (без разделителей). */
export const INVITE_CODE_LENGTH = 12

/** Роль, которую может дать инвайт-код. Водителей заводит логист в кабинете. */
export const INVITE_ROLES = ["admin", "logist"] as const
export type InviteRole = (typeof INVITE_ROLES)[number]

export type InviteRejectReason = "revoked" | "expired" | "exhausted" | "invalid"

export type InviteValidity =
  | { ok: true }
  | { ok: false; reason: InviteRejectReason; message: string }

const REJECT_MESSAGES: Record<InviteRejectReason, string> = {
  revoked: "Приглашение отозвано администратором организации",
  expired: "Срок действия приглашения истёк. Запросите новый код у администратора",
  exhausted: "Приглашение уже использовано полностью. Запросите новый код у администратора",
  invalid: "Приглашение не найдено. Проверьте код или запросите новый у администратора",
}

/**
 * Приведение кода к каноническому виду: верхний регистр, без разделителей.
 * Пустая строка на выходе = в коде есть недопустимые символы.
 */
export function normalizeInviteCode(raw: unknown): string {
  const cleaned = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")

  if (cleaned.length !== INVITE_CODE_LENGTH) return ""
  for (const char of cleaned) {
    if (!INVITE_CODE_ALPHABET.includes(char)) return ""
  }
  return cleaned
}

/** Код для показа человеку: XXXX-XXXX-XXXX. */
export function formatInviteCode(code: string): string {
  const normalized = normalizeInviteCode(code) || String(code).toUpperCase()
  return normalized.replace(/(.{4})(?=.)/g, "$1-")
}

/**
 * Генерация кода. `bytes` можно передать для тестируемости;
 * по умолчанию — криптографически стойкая случайность.
 */
export function generateInviteCode(bytes?: Uint8Array): string {
  const source = bytes ?? randomBytes(INVITE_CODE_LENGTH)
  let code = ""
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    const byte = source[i % source.length]
    code += INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length]
  }
  return code
}

/** Состояние кода, достаточное для проверки его пригодности. */
export interface InviteState {
  revokedAt: Date | string | null
  expiresAt: Date | string | null
  maxUses: number | null
  usedCount: number
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

/** Чистая проверка: можно ли сейчас зарегистрироваться по этому коду. */
export function evaluateInvite(invite: InviteState, now: Date = new Date()): InviteValidity {
  const revokedAt = toDate(invite.revokedAt)
  if (revokedAt && revokedAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "revoked", message: REJECT_MESSAGES.revoked }
  }

  const expiresAt = toDate(invite.expiresAt)
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired", message: REJECT_MESSAGES.expired }
  }

  if (invite.maxUses !== null && invite.maxUses !== undefined && invite.usedCount >= invite.maxUses) {
    return { ok: false, reason: "exhausted", message: REJECT_MESSAGES.exhausted }
  }

  return { ok: true }
}

export function inviteRejectMessage(reason: InviteRejectReason): string {
  return REJECT_MESSAGES[reason]
}

/** Сколько использований осталось (null = без ограничения). */
export function inviteUsesLeft(invite: Pick<InviteState, "maxUses" | "usedCount">): number | null {
  if (invite.maxUses === null || invite.maxUses === undefined) return null
  return Math.max(0, invite.maxUses - invite.usedCount)
}

// ---------------------------------------------------------------------------
// Работа с базой
// ---------------------------------------------------------------------------

export interface CreateInviteInput {
  organizationId: string
  createdById: string
  role: InviteRole
  /** null = бессрочный */
  expiresAt?: Date | null
  /** null = без ограничения */
  maxUses?: number | null
}

/** Создание кода с защитой от коллизии (перебор до 5 попыток). */
export async function createInvite(input: CreateInviteInput) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode()
    try {
      return await prisma.inviteCode.create({
        data: {
          code,
          organizationId: input.organizationId,
          createdById: input.createdById,
          role: input.role,
          expiresAt: input.expiresAt ?? null,
          maxUses: input.maxUses ?? null,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes("Unique constraint")) throw error
    }
  }
  throw new Error("Не удалось сгенерировать уникальный код приглашения")
}

/** Поиск кода с организацией (организация нужна, чтобы не пустить чужую). */
export async function findInviteByCode(code: string) {
  const normalized = normalizeInviteCode(code)
  if (!normalized) return null
  return prisma.inviteCode.findUnique({
    where: { code: normalized },
    include: { organization: { select: { id: true, name: true } } },
  })
}

/** Отметить использование кода (регистрация по нему состоялась). */
export async function consumeInvite(inviteId: string): Promise<void> {
  await prisma.inviteCode.update({
    where: { id: inviteId },
    data: { usedCount: { increment: 1 } },
  })
}

/**
 * Вернуть использование, если заявка по коду отклонена или удалена:
 * код не должен «сгорать» из-за чужой ошибки.
 */
export async function releaseInvite(inviteId: string): Promise<void> {
  await prisma.inviteCode.update({
    where: { id: inviteId },
    data: { usedCount: { decrement: 1 } },
  })
}

/** Список кодов организации (для панели админа). */
export async function listInvites(organizationId: string) {
  return prisma.inviteCode.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { users: true } },
    },
  })
}

/** Отзыв кода. Чужой код отозвать нельзя: организация part of the where. */
export async function revokeInvite(params: {
  id: string
  organizationId: string
  revokedById: string
}): Promise<boolean> {
  const result = await prisma.inviteCode.updateMany({
    where: { id: params.id, organizationId: params.organizationId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: params.revokedById },
  })
  return result.count > 0
}

// ---------------------------------------------------------------------------
// Представление кода для интерфейса
// ---------------------------------------------------------------------------

export type InviteStatus = "active" | "expired" | "revoked" | "exhausted"

export interface InviteRecord {
  id: string
  code: string
  role: string
  organizationId: string
  createdById: string
  expiresAt: Date | string | null
  maxUses: number | null
  usedCount: number
  revokedAt: Date | string | null
  createdAt: Date | string
  _count?: { users: number }
}

export interface InviteView {
  id: string
  /** Код в читаемом виде: XXXX-XXXX-XXXX */
  code: string
  role: string
  expiresAt: string | null
  maxUses: number | null
  usedCount: number
  usesLeft: number | null
  revokedAt: string | null
  createdAt: string
  status: InviteStatus
  registeredUsers: number
}

function toIso(value: Date | string | null): string | null {
  const date = toDate(value)
  return date ? date.toISOString() : null
}

/** Статус кода — чистая функция (проверяется unit-тестами). */
export function inviteStatus(invite: InviteState, now: Date = new Date()): InviteStatus {
  const validity = evaluateInvite(invite, now)
  if (validity.ok) return "active"
  return validity.reason === "revoked"
    ? "revoked"
    : validity.reason === "expired"
      ? "expired"
      : "exhausted"
}

/** Приведение записи из БД к виду, который отдаёт API и рисует панель. */
export function describeInvite(invite: InviteRecord, now: Date = new Date()): InviteView {
  return {
    id: invite.id,
    code: formatInviteCode(invite.code),
    role: invite.role,
    expiresAt: toIso(invite.expiresAt),
    maxUses: invite.maxUses ?? null,
    usedCount: invite.usedCount ?? 0,
    usesLeft: inviteUsesLeft(invite),
    revokedAt: toIso(invite.revokedAt),
    createdAt: toIso(invite.createdAt) ?? new Date().toISOString(),
    status: inviteStatus(invite, now),
    registeredUsers: invite._count?.users ?? 0,
  }
}
