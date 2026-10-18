/**
 * GET  /api/auth/profile — свои данные (имя, телефон, email, роль) для формы профиля.
 * PATCH /api/auth/profile — изменить СВОИ имя и телефон.
 *
 * Только свой аккаунт. Идентификатор берётся из проверенной сессии
 * (lib/auth/session.ts), параметра с чужим id в роуте нет — изменить чужой
 * аккаунт здесь нечем. Роль, организация, email и статус этим роутом не
 * меняются никогда: даже если они пришли в теле, они игнорируются.
 *
 * Водитель: имя и телефон лежат в двух записях — User (учётная запись для
 * входа) и Driver (карточка, по которой его знает логист). Меняем одной
 * транзакцией, иначе они разъедутся. Телефон водителя — его вход в /m,
 * поэтому убрать его нельзя (сотруднику можно: он входит по email).
 *
 * Защита: CSRF для мутаций /api/* проверяет proxy.ts (double-submit cookie),
 * заголовок добавляет клиентский CsrfProvider. Каждое изменение пишется в
 * журнал действий (lib/audit.ts).
 */

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireAnySession } from "@/lib/auth/session"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/rate-limiter"
import { validateProfileName, validateProfilePhone } from "@/lib/profile"

export const dynamic = "force-dynamic"

const PROFILE_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  role: true,
  organizationId: true,
  driverId: true,
} as const

function profileView(user: {
  id: string
  name: string
  phone: string | null
  email: string | null
  role: string
  organizationId: string | null
  organization?: { name: string } | null
}) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: user.organization?.name ?? null,
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response
  const userId = auth.value.kind === "staff" ? auth.value.user.id : auth.value.userId

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...PROFILE_SELECT, organization: { select: { name: true } } },
  })
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Учётная запись не найдена" },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true, profile: profileView(user) })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response
  const userId = auth.value.kind === "staff" ? auth.value.user.id : auth.value.userId

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { success: false, error: "Некорректное тело запроса" },
        { status: 400 },
      )
    }
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { success: false, error: "Некорректное тело запроса" },
      { status: 400 },
    )
  }

  const nameProvided = Object.prototype.hasOwnProperty.call(body, "name") && body.name !== undefined
  const phoneProvided = Object.prototype.hasOwnProperty.call(body, "phone") && body.phone !== undefined
  if (!nameProvided && !phoneProvided) {
    return NextResponse.json(
      { success: false, error: "Нет изменений: укажите имя или телефон" },
      { status: 400 },
    )
  }

  const name = nameProvided ? validateProfileName(body.name) : null
  if (name && !name.ok) {
    return NextResponse.json({ success: false, error: name.error }, { status: 400 })
  }
  const phone = phoneProvided ? validateProfilePhone(body.phone) : null
  if (phone && !phone.ok) {
    return NextResponse.json({ success: false, error: phone.error }, { status: 400 })
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_SELECT,
    })
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Учётная запись не найдена" },
        { status: 404 },
      )
    }

    const isDriver = user.role === "driver" && Boolean(user.driverId)

    // Телефон водителя — его вход в приложение: убрать нельзя.
    if (isDriver && phoneProvided && phone?.ok && phone.value === null) {
      return NextResponse.json(
        { success: false, error: "Телефон — вход в приложение водителя, убрать его нельзя" },
        { status: 400 },
      )
    }

    // Занятость телефона: проверяем и среди учётных записей, и среди карточек
    // водителей — иначе уникальный индекс базы отвергнет UPDATE невнятной
    // ошибкой, а водителя с таким номером уже не пустит вход.
    if (phoneProvided && phone?.ok && phone.value !== null) {
      const takenByUser = await prisma.user.findFirst({
        where: { phone: phone.value, NOT: { id: user.id } },
        select: { id: true },
      })
      if (takenByUser) {
        return NextResponse.json(
          { success: false, error: "Этот телефон уже занят другой учётной записью" },
          { status: 400 },
        )
      }
      if (isDriver && user.driverId) {
        const takenByDriver = await prisma.driver.findFirst({
          where: { phone: phone.value, NOT: { id: user.driverId } },
          select: { id: true },
        })
        if (takenByDriver) {
          return NextResponse.json(
            { success: false, error: "Этот телефон уже занят карточкой другого водителя" },
            { status: 400 },
          )
        }
      }
    }

    const changed: string[] = []
    if (nameProvided && name?.ok && name.value !== user.name) changed.push("name")
    if (phoneProvided && phone?.ok && phone.value !== user.phone) changed.push("phone")

    if (changed.length > 0) {
      const userData: { name?: string; phone?: string | null } = {}
      if (changed.includes("name") && name?.ok) userData.name = name.value
      if (changed.includes("phone") && phone?.ok) userData.phone = phone.value

      try {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({ where: { id: user.id }, data: userData })
          // Карточка водителя едет за учётной записью: имя и телефон одни на обоих
          if (isDriver && user.driverId) {
            const driverData: { name?: string; phone?: string } = {}
            if (changed.includes("name") && name?.ok) driverData.name = name.value
            if (changed.includes("phone") && phone?.ok && phone.value !== null) {
              driverData.phone = phone.value
            }
            if (Object.keys(driverData).length > 0) {
              await tx.driver.update({ where: { id: user.driverId }, data: driverData })
            }
          }
        })
      } catch (error) {
        // Гонка: между проверкой и UPDATE телефон успели занять. Уникальный
        // индекс — второй рубеж, объясняем его человеческим языком.
        if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
          return NextResponse.json(
            { success: false, error: "Этот телефон уже занят" },
            { status: 400 },
          )
        }
        throw error
      }

      await logAudit({
        organizationId: user.organizationId,
        actorId: user.id,
        actorEmail: user.email,
        action: "profile_update",
        targetId: user.id,
        targetType: "user",
        targetEmail: user.email,
        metadata: { scope: "profile", fields: changed, role: user.role },
        ip: getClientIp(request),
      })
    }

    const fresh = await prisma.user.findUnique({
      where: { id: user.id },
      select: { ...PROFILE_SELECT, organization: { select: { name: true } } },
    })

    return NextResponse.json({
      success: true,
      profile: profileView(fresh ?? user),
      changed,
      message: changed.length > 0 ? "Данные сохранены" : "Изменений нет",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[auth/profile] error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось сохранить данные" },
      { status: 500 },
    )
  }
}
