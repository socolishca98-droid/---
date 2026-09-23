/**
 * POST /api/auth/register — регистрация сотрудника.
 *
 * Два сценария (ровно один из них, не оба):
 *
 * A. Первый пользователь компании: передаёт `organizationName` → создаётся
 *    организация, а сам человек становится её администратором со статусом
 *    active (одобрение не требуется — одобрять некому, он и есть владелец).
 *
 * B. Сотрудник существующей компании: передаёт `inviteCode` → организация и
 *    роль берутся из кода (не из тела запроса), статус «ожидает одобрения»
 *    (pending). Админ этой организации одобряет заявку на экране /organization.
 *
 * Присоединиться «по названию компании» нельзя намеренно: название не является
 * секретом, а значит не является и доказательством принадлежности.
 *
 * Водители здесь не регистрируются: карточку водителя заводит логист или
 * директор в кабинете (автопарк), учётная запись для входа создаётся там же —
 * и автоматически получает organizationId создающего.
 */

import { NextRequest, NextResponse } from "next/server"

import { logAudit } from "@/lib/audit"
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password"
import {
  consumeInvite,
  evaluateInvite,
  findInviteByCode,
  INVITE_ROLES,
  normalizeInviteCode,
  type InviteRole,
} from "@/lib/invites"
import {
  buildRateLimitHeaders,
  checkRateLimit,
  getClientIp,
  recordFailure,
} from "@/lib/rate-limiter"
import { checkOrganizationName, createOrganization } from "@/lib/organizations"
import { registerSchema } from "@/lib/validators"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

interface RegisterBody {
  name?: unknown
  email?: unknown
  password?: unknown
  organizationName?: unknown
  inviteCode?: unknown
}

function badRequest(error: string, code?: string, status = 400, headers?: Record<string, string>) {
  return NextResponse.json({ success: false, error, ...(code ? { code } : {}) }, { status, headers })
}

export async function POST(request: NextRequest) {
  let body: RegisterBody
  try {
    body = await request.json()
  } catch {
    return badRequest("Некорректное тело запроса")
  }

  // Единая точка проверки формы: lib/validators.registerSchema.
  // Там же зашито правило «ровно один сценарий» (организация ИЛИ код).
  const parsed = registerSchema.safeParse({
    name: body.name,
    email: body.email,
    password: body.password,
    organizationName: body.organizationName,
    inviteCode: body.inviteCode,
  })

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return badRequest(issue?.message ?? "Проверьте данные регистрации", "validation_error")
  }

  const name = parsed.data.name
  const email = parsed.data.email
  const password = parsed.data.password
  const organizationName = (parsed.data.organizationName ?? "").trim()
  const rawInviteCode = (parsed.data.inviteCode ?? "").trim()

  const ip = getClientIp(request)
  const creatingOrganization = organizationName.length > 0
  const joiningByInvite = rawInviteCode.length > 0

  // Требования к составу пароля (буквы + цифры) — поверх минимальной длины из схемы
  const strength = validatePasswordStrength(password)
  if (!strength.ok) {
    return badRequest(strength.error)
  }

  // ── Ограничение частоты ─────────────────────────────────────────────────
  // Создание организации считаем по каждому запросу (защита от спама компаниями),
  // присоединение по коду — только по неудачным (офис может заводить десятки людей).
  const rateLimitKey = creatingOrganization
    ? `auth-register-org:${ip}`
    : `auth-register-invite:${ip}`
  const rateLimit = checkRateLimit(rateLimitKey)
  if (!rateLimit.allowed) {
    return badRequest(
      "Слишком много попыток регистрации. Повторите через 15 минут",
      "rate_limited",
      429,
      buildRateLimitHeaders(rateLimit),
    )
  }

  try {
    // ── Занят ли email ────────────────────────────────────────────────────
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      // Сообщение одинаковое для всех случаев: не раскрываем, есть ли такой адрес
      if (!creatingOrganization) recordFailure(rateLimitKey)
      return badRequest(
        "Регистрация с этим email невозможна. Обратитесь к администратору вашей организации",
        "email_taken",
        409,
      )
    }

    const { hash, salt } = await hashPassword(password)
    const totalUsers = await prisma.user.count()

    // ── Сценарий A: новая организация ─────────────────────────────────────
    if (creatingOrganization) {
      const nameCheck = checkOrganizationName(organizationName)
      if (!nameCheck.ok) {
        return badRequest(nameCheck.error)
      }
      const { name: orgName, nameKey } = nameCheck
      const duplicateOrganization = await prisma.organization.findFirst({
        where: { nameKey },
        select: { id: true, name: true },
      })
      if (duplicateOrganization) {
        // Такая компания уже зарегистрирована — присоединяться нужно по коду
        recordFailure(rateLimitKey)
        return badRequest(
          `Организация «${duplicateOrganization.name}» уже зарегистрирована. Попросите у её администратора код приглашения`,
          "organization_exists",
          409,
        )
      }

      const bootstrap = totalUsers === 0
      const organization = await createOrganization({ name: orgName, nameKey })

      const user = await prisma.user.create({
        data: {
          email,
          name,
          passwordHash: hash,
          passwordSalt: salt,
          role: "admin",
          status: "active",
          approvedAt: new Date(),
          organizationId: organization.id,
        },
        select: { id: true, email: true, name: true, role: true, status: true, organizationId: true },
      })

      await logAudit({
        actorId: user.id,
        actorEmail: user.email ?? null,
        action: bootstrap ? "bootstrap_admin" : "create_organization",
        targetId: organization.id,
        targetType: "organization",
        metadata: { organizationName: organization.name, bootstrap },
        ip,
      })

      if (bootstrap) {
        console.warn(
          "[auth/register] В базе не было ни одной учётной записи — первая регистрация " +
            `создала организацию «${organization.name}» и стала её администратором (${email}).`,
        )
      }

      return NextResponse.json({
        success: true,
        scenario: "create_organization",
        status: user.status,
        bootstrapped: bootstrap,
        organization: { id: organization.id, name: organization.name },
        message: `Организация «${organization.name}» создана. Вход доступен сразу`,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      })
    }

    // ── Сценарий B: присоединение по коду приглашения ─────────────────────
    const normalizedCode = normalizeInviteCode(rawInviteCode)
    if (!normalizedCode) {
      recordFailure(rateLimitKey)
      return badRequest("Код приглашения имеет неверный формат", "invalid_invite")
    }

    const invite = await findInviteByCode(normalizedCode)
    if (!invite) {
      recordFailure(rateLimitKey)
      return badRequest(
        "Приглашение не найдено. Проверьте код или запросите новый у администратора",
        "invalid_invite",
        404,
      )
    }

    const validity = evaluateInvite(invite)
    if (!validity.ok) {
      recordFailure(rateLimitKey)
      return badRequest(validity.message, `invite_${validity.reason}`, 410)
    }

    if (!INVITE_ROLES.includes(invite.role as InviteRole)) {
      // Код создан с ролью, которой больше нет в продукте — не угадываем
      recordFailure(rateLimitKey)
      return badRequest(
        "Приглашение выдано с недопустимой ролью. Попросите администратора создать новый код",
        "invalid_invite",
        410,
      )
    }

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: hash,
        passwordSalt: salt,
        // роль и организация — из кода, а не из тела запроса
        role: invite.role,
        status: "pending",
        organizationId: invite.organizationId,
        inviteCodeId: invite.id,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        organizationId: true,
      },
    })

    await consumeInvite(invite.id)

    await logAudit({
      actorId: user.id,
      actorEmail: user.email ?? null,
      action: "register",
      targetId: user.id,
      targetType: "user",
      targetEmail: user.email ?? null,
      metadata: {
        scenario: "invite",
        organizationId: invite.organizationId,
        organizationName: invite.organization?.name ?? null,
        role: user.role,
        status: user.status,
      },
      ip,
    })

    return NextResponse.json({
      success: true,
      scenario: "join_by_invite",
      status: user.status,
      organization: { id: invite.organizationId, name: invite.organization?.name ?? null },
      message:
        "Заявка отправлена. Администратор организации одобрит её, после чего вход станет доступен",
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[auth/register] error:", message)

    // Гонка при одновременной регистрации одного email
    if (message.includes("Unique constraint")) {
      return badRequest("Регистрация с этим email невозможна", "email_taken", 409)
    }

    return badRequest("Не удалось отправить заявку. Попробуйте ещё раз", undefined, 500)
  }
}
