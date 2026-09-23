// lib/api-auth.ts — адаптер guard'ов поверх единого слоя авторизации.
//
// В проекте какое-то время существовало два слоя авторизации: сессии в БД
// (lib/auth/session.ts, задача 1) и JWT access/refresh (lib/auth-server.ts,
// ветка hardening). Оставили один — сессии в БД: они отзываемые, хранят
// роль и organizationId и не требуют ротации refresh-токенов.
//
// Этот файл сохраняет имена guard'ов, которыми пользуется часть API-роутов,
// и делегирует всю работу в lib/auth/session.ts. Новому коду лучше
// импортировать requireStaff / requireDriver / requireAnySession напрямую.

import type { NextRequest, NextResponse } from "next/server"

import {
  loadDriverSession,
  loadStaffSession,
  requireAnySession,
  requireDriver,
  requireStaff,
  type AnySession,
  type DriverIdentity,
  type StaffIdentity,
} from "@/lib/auth/session"

/** Сотрудник из проверенной сессии или null (без исключений). */
export async function getStaffSession(request: NextRequest): Promise<StaffIdentity | null> {
  const session = await loadStaffSession(request)
  return session ? session.user : null
}

export interface DriverSessionView {
  driver: DriverIdentity
  driverId: string
  userId: string
  sessionId: string
  mustChangePassword: boolean
}

/** Водитель из проверенной сессии или null. */
export async function getDriverSession(request: NextRequest): Promise<DriverSessionView | null> {
  const session = await loadDriverSession(request)
  if (!session) return null
  return {
    driver: session.driver,
    driverId: session.driver.id,
    userId: session.userId,
    sessionId: session.sessionId,
    mustChangePassword: session.mustChangePassword,
  }
}

export interface StaffAuthResult {
  user: StaffIdentity
  error: NextResponse | null
}

/**
 * Guard для штабных роутов в «старой» форме:
 *   const { user, error } = await requireStaffAuth(req)
 *   if (error) return error
 */
export async function requireStaffAuth(request: NextRequest): Promise<StaffAuthResult> {
  const auth = await requireStaff(request)
  if (!auth.ok) {
    return { user: null as unknown as StaffIdentity, error: auth.response }
  }
  return { user: auth.value.user, error: null }
}

export interface DriverAuthResult {
  driver: DriverIdentity
  driverId: string
  staff: StaffIdentity | null
  error: NextResponse | null
  isStaff: boolean
}

/**
 * Guard для водительских роутов в «старой» форме.
 * Сотрудник тоже проходит (isStaff: true) — часть мобильных эндпоинтов
 * используется диспетчерской для отладки; driver в этом случае null.
 */
export async function requireDriverAuth(request: NextRequest): Promise<DriverAuthResult> {
  const auth = await requireDriver(request)
  if (auth.ok) {
    return {
      driver: auth.value.driver,
      driverId: auth.value.driver.id,
      staff: null,
      error: null,
      isStaff: false,
    }
  }

  const staff = await loadStaffSession(request)
  if (staff) {
    return {
      driver: null as unknown as DriverIdentity,
      driverId: "",
      staff: staff.user,
      error: null,
      isStaff: true,
    }
  }

  return {
    driver: null as unknown as DriverIdentity,
    driverId: "",
    staff: null,
    error: auth.response,
    isStaff: false,
  }
}

export type AnyAuthResult =
  | { type: "driver"; driver: DriverIdentity; user: null; error: null }
  | { type: "staff"; user: StaffIdentity; driver: null; error: null }
  | { type: null; user: null; driver: null; error: NextResponse }

/** Guard «подойдёт любая роль» в «старой» форме. */
export async function requireAnyAuth(request: NextRequest): Promise<AnyAuthResult> {
  const auth = await requireAnySession(request)
  if (!auth.ok) {
    return { type: null, user: null, driver: null, error: auth.response }
  }
  return auth.value.kind === "driver"
    ? { type: "driver", driver: auth.value.driver, user: null, error: null }
    : { type: "staff", user: auth.value.user, driver: null, error: null }
}

/** Сессия в том виде, в котором её отдаёт адаптер (для новых роутов). */
export async function loadAnySession(request: NextRequest): Promise<AnySession | null> {
  const staff = await loadStaffSession(request)
  if (staff) return staff
  return loadDriverSession(request)
}

export { requireStaff, requireDriver, requireAnySession }
