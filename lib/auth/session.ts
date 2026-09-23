/**
 * Серверная часть авторизации: guard'ы для API-обработчиков и жизненный цикл сессий.
 *
 * Здесь происходит НАСТОЯЩАЯ проверка доступа:
 *  1. подпись и срок токена (lib/auth/token.ts),
 *  2. строка Session в БД — не отозвана и не истекла,
 *  3. пользователь существует, а его статус — active (pending/suspended не пускаем),
 *  4. для «смешанных» эндпоинтов — принадлежность данных (водитель видит только своё).
 *
 * Файл серверный: использует Prisma и node-рантайм. В клиентские компоненты
 * и в middleware его импортировать нельзя.
 */

import "server-only"
import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  DRIVER_COOKIE,
  getSessionTtlMs,
  getSessionTtlSeconds,
  STAFF_COOKIE,
  STAFF_ROLES,
  type UserRole,
} from "@/lib/auth/constants"
import { buildTokenPayload, signSessionToken, verifySessionToken, type SessionKind } from "@/lib/auth/token"

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

export interface StaffIdentity {
  id: string
  name: string
  email: string | null
  role: UserRole
  status: string
  mustChangePassword: boolean
  /// Организация, к которой принадлежит сотрудник. Источник — база (сессия),
  /// никогда не тело запроса. null только у записей, созданных до миграции.
  organizationId: string | null
}

export interface DriverIdentity {
  id: string
  name: string
  phone: string
  /// Организация-владелец карточки водителя
  organizationId: string | null
  vehicleId: string | null
  vehicleType: string
  vehiclePlate: string
  status: string
  rating: number
  ordersCompleted: number
  latitude: number | null
  longitude: number | null
  lastGpsUpdate: Date | null
  licenseNumber: string | null
  licenseExpiry: Date | null
  medicalExpiry: Date | null
  hiredAt: Date | null
}

export interface StaffSession {
  kind: "staff"
  sessionId: string
  user: StaffIdentity
}

export interface DriverSession {
  kind: "driver"
  sessionId: string
  userId: string
  mustChangePassword: boolean
  driver: DriverIdentity
}

export type AnySession = StaffSession | DriverSession

export type Guard<T> = { ok: true; value: T } | { ok: false; response: NextResponse }

// ---------------------------------------------------------------------------
// Ошибки доступа (единый формат ответа — клиент показывает текст пользователю)
// ---------------------------------------------------------------------------

export function unauthorized(error = "Требуется авторизация"): NextResponse {
  return NextResponse.json({ success: false, error, code: "unauthorized" }, { status: 401 })
}

export function forbidden(error = "Недостаточно прав для этого действия"): NextResponse {
  return NextResponse.json({ success: false, error, code: "forbidden" }, { status: 403 })
}

export function badRequest(error: string, details?: unknown): NextResponse {
  return NextResponse.json(
    { success: false, error, ...(details ? { details } : {}) },
    { status: 400 },
  )
}

// ---------------------------------------------------------------------------
// Чтение токена из запроса
// ---------------------------------------------------------------------------

function cookieNameFor(kind: SessionKind): string {
  return kind === "driver" ? DRIVER_COOKIE : STAFF_COOKIE
}

async function readPayload(request: NextRequest, kind: SessionKind) {
  const token = request.cookies.get(cookieNameFor(kind))?.value
  const payload = await verifySessionToken(token)
  if (!payload) return null
  if (payload.kind !== kind) return null
  if (kind === "driver" && payload.role !== "driver") return null
  if (kind === "staff" && !STAFF_ROLES.includes(payload.role)) return null
  return payload
}

/** Проверить, что сессия жива в БД (не отозвана, не истекла) */
async function assertSessionActive(sessionId: string, userId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true },
  })
  if (!session) return false
  if (session.userId !== userId) return false
  if (session.revokedAt) return false
  if (session.expiresAt.getTime() <= Date.now()) return false
  return true
}

// ---------------------------------------------------------------------------
// Загрузка сессий
// ---------------------------------------------------------------------------

/** Сессия сотрудника или null (без исключений) */
export async function loadStaffSession(request: NextRequest): Promise<StaffSession | null> {
  const payload = await readPayload(request, "staff")
  if (!payload) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      mustChangePassword: true,
      organizationId: true,
    },
  })
  if (!user) return null
  if (user.status !== "active") return null
  if (!STAFF_ROLES.includes(user.role as UserRole)) return null
  if (!(await assertSessionActive(payload.jti, user.id))) return null

  return {
    kind: "staff",
    sessionId: payload.jti,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as UserRole,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      organizationId: user.organizationId ?? null,
    },
  }
}

/** Сессия водителя или null (без исключений) */
export async function loadDriverSession(request: NextRequest): Promise<DriverSession | null> {
  const payload = await readPayload(request, "driver")
  if (!payload) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      role: true,
      status: true,
      mustChangePassword: true,
      driverId: true,
      organizationId: true,
      driver: {
        select: {
          id: true,
          name: true,
          phone: true,
          organizationId: true,
          vehicleId: true,
          vehicleType: true,
          vehiclePlate: true,
          status: true,
          rating: true,
          ordersCompleted: true,
          latitude: true,
          longitude: true,
          lastGpsUpdate: true,
          licenseNumber: true,
          licenseExpiry: true,
          medicalExpiry: true,
          hiredAt: true,
        },
      },
    },
  })
  if (!user || user.role !== "driver" || user.status !== "active") return null
  if (!user.driverId || !user.driver) return null
  if (!(await assertSessionActive(payload.jti, user.id))) return null

  return {
    kind: "driver",
    sessionId: payload.jti,
    userId: user.id,
    mustChangePassword: user.mustChangePassword,
    driver: {
      ...user.driver,
      organizationId: user.driver.organizationId ?? user.organizationId ?? null,
    },
  }
}

/** Любая из двух сессий */
export async function loadAnySession(request: NextRequest): Promise<AnySession | null> {
  const staff = await loadStaffSession(request)
  if (staff) return staff
  return loadDriverSession(request)
}

// ---------------------------------------------------------------------------
// Guard'ы для обработчиков
// ---------------------------------------------------------------------------

/** Требовать сотрудника (по умолчанию admin или logist) */
export async function requireStaff(
  request: NextRequest,
  roles: UserRole[] = STAFF_ROLES,
): Promise<Guard<StaffSession>> {
  const session = await loadStaffSession(request)
  if (!session) return { ok: false, response: unauthorized() }
  if (!roles.includes(session.user.role)) {
    return { ok: false, response: forbidden() }
  }
  return { ok: true, value: session }
}

/** Требовать водителя */
export async function requireDriver(request: NextRequest): Promise<Guard<DriverSession>> {
  const session = await loadDriverSession(request)
  if (!session) return { ok: false, response: unauthorized() }
  return { ok: true, value: session }
}

/** Требовать любую авторизованную роль */
export async function requireAnySession(request: NextRequest): Promise<Guard<AnySession>> {
  const session = await loadAnySession(request)
  if (!session) return { ok: false, response: unauthorized() }
  return { ok: true, value: session }
}

// ---------------------------------------------------------------------------
// Проверка принадлежности данных (для эндпоинтов, доступных обеим ролям)
// ---------------------------------------------------------------------------

/** Водитель может работать только со своей карточкой */
export function isSelfOrStaff(session: AnySession, requestedDriverId: string | null): boolean {
  if (session.kind === "staff") return true
  if (!requestedDriverId) return true
  return session.driver.id === requestedDriverId
}

/** Заказ принадлежит водителю? */
export async function canDriverAccessOrder(
  session: AnySession,
  orderId: string,
): Promise<boolean> {
  if (session.kind === "staff") return true
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { assignedDriverId: true },
  })
  return Boolean(order && order.assignedDriverId === session.driver.id)
}

/** Рейс принадлежит водителю? (рейс — это группа заказов с общим routeId) */
export async function canDriverAccessRoute(
  session: AnySession,
  routeId: string,
): Promise<boolean> {
  if (session.kind === "staff") return true

  // Рейс — настоящая запись в таблице Route: водитель своего рейса
  // определяется по Route.driverId (источник правды с задачи 2).
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    select: { driverId: true },
  })
  if (route?.driverId) return route.driverId === session.driver.id

  // Рейса в таблице нет (исторический routeId) или водитель не назначен —
  // проверяем по заказам, как раньше.
  const total = await prisma.order.count({ where: { routeId } })
  if (total === 0) return false
  const own = await prisma.order.count({
    where: { routeId, assignedDriverId: session.driver.id },
  })
  return own === total
}

// ---------------------------------------------------------------------------
// Выпуск и отзыв сессий
// ---------------------------------------------------------------------------

export interface IssueSessionParams {
  userId: string
  role: UserRole
  kind: SessionKind
  name?: string
  driverId?: string | null
  request?: NextRequest
}

export interface IssuedSession {
  sessionId: string
  token: string
  cookieName: string
  expiresAt: Date
}

/** Создать запись Session в БД и подписать токен для cookie */
export async function issueSession(params: IssueSessionParams): Promise<IssuedSession> {
  const ttlMs = getSessionTtlMs()
  const expiresAt = new Date(Date.now() + ttlMs)

  const session = await prisma.session.create({
    data: {
      // cuid-подобный id генерируем сами, чтобы сразу использовать его как jti
      id: randomSessionId(),
      userId: params.userId,
      role: params.role,
      expiresAt,
      userAgent: params.request?.headers.get("user-agent")?.slice(0, 300) ?? null,
      ip: clientIp(params.request) ?? null,
    },
    select: { id: true },
  })

  const token = await signSessionToken(
    buildTokenPayload({
      userId: params.userId,
      role: params.role,
      kind: params.kind,
      sessionId: session.id,
      name: params.name,
      driverId: params.driverId,
      ttlMs,
    }),
  )

  return {
    sessionId: session.id,
    token,
    cookieName: cookieNameFor(params.kind),
    expiresAt,
  }
}

function randomSessionId(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  let out = "ses_"
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0")
  return out
}

function clientIp(request?: NextRequest): string | null {
  if (!request) return null
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim().slice(0, 64) ?? null
  return request.headers.get("x-real-ip")?.slice(0, 64) ?? null
}

export function sessionCookie(name: string, token: string) {
  return {
    name,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getSessionTtlSeconds(),
  }
}

export function expiredSessionCookie(name: string) {
  return {
    name,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  }
}

/** Настоящий выход: отзываем сессию в БД, а не только чистим cookie */
export async function revokeSession(sessionId: string, reason = "logout"): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  })
}

/**
 * Отозвать все сессии, пришедшие с этим запросом (и сотрудника, и водителя).
 * Используется при выходе: cookie удаляются в любом случае, даже если БД недоступна.
 */
export async function revokeRequestSessions(
  request: NextRequest,
  reason = "logout",
): Promise<string[]> {
  const revoked: string[] = []
  const pairs: Array<[SessionKind, string]> = [
    ["staff", STAFF_COOKIE],
    ["driver", DRIVER_COOKIE],
  ]

  for (const [kind, cookieName] of pairs) {
    const payload = await readPayload(request, kind)
    if (!payload) continue
    try {
      await revokeSession(payload.jti, reason)
      revoked.push(payload.jti)
    } catch (error) {
      console.error(`[auth] не удалось отозвать сессию (${kind}):`, error)
    }
  }

  return revoked
}

/** Отозвать все сессии пользователя (деактивация доступа, смена пароля) */
export async function revokeAllSessions(userId: string, reason: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  })
  return result.count
}

/** Обновить lastSeenAt (не чаще раза в минуту, чтобы не нагружать БД на GPS-потоке) */
export async function touchSession(sessionId: string): Promise<void> {
  const now = new Date()
  await prisma.session.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - 60_000) } }],
    },
    data: { lastSeenAt: now },
  })
}

/** Удалить истёкшие и отозванные сессии старше 30 дней */
export async function cleanupExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const result = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
    },
  })
  return result.count
}

/** Публичное представление сессии для клиента (без хэшей и служебных полей) */
export function publicSessionView(session: AnySession) {
  if (session.kind === "staff") {
    return {
      kind: "staff" as const,
      role: session.user.role,
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        mustChangePassword: session.user.mustChangePassword,
      },
    }
  }
  return {
    kind: "driver" as const,
    role: "driver" as const,
    user: {
      id: session.userId,
      name: session.driver.name,
      role: "driver" as const,
      mustChangePassword: session.mustChangePassword,
    },
    driver: session.driver,
  }
}
