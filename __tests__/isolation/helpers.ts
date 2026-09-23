// __tests__/isolation/helpers.ts
//
// Общая обвязка функциональных тестов изоляции:
//   * две организации с полным набором бизнес-данных в каждой;
//   * настоящие подписанные сессионные cookie (как в боевом приложении) —
//     организация попадает в роут из проверенного токена, а не из параметров теста;
//   * конструктор NextRequest для вызова обработчиков роутов напрямую.
//
// База — in-memory заглушка Prisma (__tests__/__mocks__/prisma-memory.ts),
// которую подключает vitest.isolation.config.ts.

import { NextRequest } from "next/server"

import { STAFF_COOKIE, DRIVER_COOKIE } from "@/lib/auth/constants"
import { buildTokenPayload, signSessionToken } from "@/lib/auth/token"
import { memoryDb } from "../__mocks__/prisma-memory"

// Секрет нужен до первого подписывания токена (минимум 32 символа)
process.env.AUTH_SECRET =
  process.env.AUTH_SECRET || "isolation-tests-secret-0123456789abcdef0123456789abcdef"

export type World = {
  orgA: string
  orgB: string
  adminA: string
  adminB: string
  logistNoOrg: string
  driverUserA: string
  driverUserB: string
  driverA: string
  driverB: string
  vehicleA: string
  vehicleB: string
  orderA: string
  orderB: string
  routeA: string
  routeB: string
  eventA: string
  eventB: string
  shiftA: string
  shiftB: string
  sosA: string
  sosB: string
  photoA: string
  photoB: string
  chatA: string
  chatB: string
  notificationA: string
  notificationB: string
  maintenanceA: string
  maintenanceB: string
  settingsA: string
  settingsB: string
  inviteA: string
  inviteB: string
  /** все идентификаторы организации Б: по ним проверяем утечки в ответах */
  foreignIds: string[]
  ownIds: string[]
}

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

let idCounter = 0

/**
 * Идентификатор в формате cuid: валидаторы проекта (zod) принимают только его.
 * Все идентификаторы одной длины (26 символов) — значит, ни один из них не может
 * оказаться подстрокой другого, и проверка «id чужой организации не встретился
 * в ответе» не даёт ложных срабатываний.
 */
export function cid(slug: string): string {
  idCounter += 1
  const clean = slug.replace(/[^a-z0-9]/gi, "").toLowerCase()
  return `c${clean}${String(idCounter).padStart(3, "0")}`.padEnd(26, "0")
}

/** Создаёт две организации с одинаковым набором данных в каждой. */
export function seedWorld(): World {
  memoryDb.reset()

  idCounter = 0
  const world: World = {
    orgA: cid("orga"),
    orgB: cid("orgb"),
    adminA: cid("admina"),
    adminB: cid("adminb"),
    logistNoOrg: cid("nologist"),
    driverUserA: cid("driverusera"),
    driverUserB: cid("driveruserb"),
    driverA: cid("drivera"),
    driverB: cid("driverb"),
    vehicleA: cid("vehiclea"),
    vehicleB: cid("vehicleb"),
    orderA: cid("ordera"),
    orderB: cid("orderb"),
    routeA: cid("routea"),
    routeB: cid("routeb"),
    eventA: cid("eventa"),
    eventB: cid("eventb"),
    shiftA: cid("shifta"),
    shiftB: cid("shiftb"),
    sosA: cid("sosa"),
    sosB: cid("sosb"),
    photoA: cid("photoa"),
    photoB: cid("photob"),
    chatA: cid("chata"),
    chatB: cid("chatb"),
    notificationA: cid("notifya"),
    notificationB: cid("notifyb"),
    maintenanceA: cid("mainta"),
    maintenanceB: cid("maintb"),
    settingsA: cid("settingsa"),
    settingsB: cid("settingsb"),
    inviteA: cid("invitea"),
    inviteB: cid("inviteb"),
    foreignIds: [],
    ownIds: [],
  }

  memoryDb.insert("organization", { id: world.orgA, name: "Организация А", nameKey: "организация а" })
  memoryDb.insert("organization", { id: world.orgB, name: "Организация Б", nameKey: "организация б" })

  memoryDb.insert("user", {
    id: world.adminA,
    organizationId: world.orgA,
    name: "Админ А",
    email: "admin@a.test",
    passwordHash: "x",
    passwordSalt: "x",
    role: "admin",
    status: "active",
  })
  memoryDb.insert("user", {
    id: world.adminB,
    organizationId: world.orgB,
    name: "Админ Б",
    email: "admin@b.test",
    passwordHash: "x",
    passwordSalt: "x",
    role: "admin",
    status: "active",
  })
  // Учётка без организации: проверяем, что гард организации отвечает 403
  memoryDb.insert("user", {
    id: world.logistNoOrg,
    organizationId: null,
    name: "Логист без организации",
    email: "noorg@test.local",
    passwordHash: "x",
    passwordSalt: "x",
    role: "logist",
    status: "active",
  })

  // Госномер машины намеренно одинаковый в двух организациях:
  // уникальность номера — в рамках организации, а не глобально.
  memoryDb.insert("vehicle", {
    id: world.vehicleA,
    organizationId: world.orgA,
    plate: "А001АА77",
    type: "truck",
    capacity: 20,
    status: "available",
  })
  memoryDb.insert("vehicle", {
    id: world.vehicleB,
    organizationId: world.orgB,
    plate: "А001АА77",
    type: "truck",
    capacity: 20,
    status: "available",
  })

  memoryDb.insert("driver", {
    id: world.driverA,
    organizationId: world.orgA,
    name: "Водитель А",
    phone: "+79000000001",
    vehicleType: "truck",
    vehiclePlate: "А001АА77",
    vehicleId: world.vehicleA,
    status: "available",
  })
  memoryDb.insert("driver", {
    id: world.driverB,
    organizationId: world.orgB,
    name: "Водитель Б",
    phone: "+79000000002",
    vehicleType: "truck",
    vehiclePlate: "А001АА77",
    vehicleId: world.vehicleB,
    status: "available",
  })

  memoryDb.insert("user", {
    id: world.driverUserA,
    organizationId: world.orgA,
    name: "Водитель А",
    phone: "+79000000001",
    passwordHash: "x",
    passwordSalt: "x",
    role: "driver",
    status: "active",
    driverId: world.driverA,
  })
  memoryDb.insert("user", {
    id: world.driverUserB,
    organizationId: world.orgB,
    name: "Водитель Б",
    phone: "+79000000002",
    passwordHash: "x",
    passwordSalt: "x",
    role: "driver",
    status: "active",
    driverId: world.driverB,
  })

  memoryDb.insert("route", {
    id: world.routeA,
    organizationId: world.orgA,
    name: "Рейс А",
    status: "active",
    driverId: world.driverA,
    vehicleId: world.vehicleA,
  })
  memoryDb.insert("route", {
    id: world.routeB,
    organizationId: world.orgB,
    name: "Рейс Б",
    status: "active",
    driverId: world.driverB,
    vehicleId: world.vehicleB,
  })

  const orderFields = {
    source: "manual",
    routeFrom: "Москва",
    routeTo: "Казань",
    distance: 800,
    weight: 10,
    cargoType: "Груз",
    clientContact: "",
    clientName: "Клиент",
    deadline: FUTURE,
    status: "confirmed",
    price: 100000,
  }
  memoryDb.insert("order", {
    id: world.orderA,
    organizationId: world.orgA,
    ...orderFields,
    routeId: world.routeA,
    assignedDriverId: world.driverA,
    assignedVehicleId: world.vehicleA,
  })
  memoryDb.insert("order", {
    id: world.orderB,
    organizationId: world.orgB,
    ...orderFields,
    routeFrom: "Питер",
    routeTo: "Псков",
    routeId: world.routeB,
    assignedDriverId: world.driverB,
    assignedVehicleId: world.vehicleB,
  })

  memoryDb.insert("routeEvent", {
    id: world.eventA,
    organizationId: world.orgA,
    routeId: world.routeA,
    driverId: world.driverA,
    type: "status",
    status: "active",
  })
  memoryDb.insert("routeEvent", {
    id: world.eventB,
    organizationId: world.orgB,
    routeId: world.routeB,
    driverId: world.driverB,
    type: "status",
    status: "active",
  })

  memoryDb.insert("driverShift", {
    id: world.shiftA,
    organizationId: world.orgA,
    driverId: world.driverA,
    status: "driving",
    startedAt: new Date(),
  })
  memoryDb.insert("driverShift", {
    id: world.shiftB,
    organizationId: world.orgB,
    driverId: world.driverB,
    status: "driving",
    startedAt: new Date(),
  })

  memoryDb.insert("sosAlert", {
    id: world.sosA,
    organizationId: world.orgA,
    driverId: world.driverA,
    type: "breakdown",
    latitude: 55.75,
    longitude: 37.61,
    status: "active",
  })
  memoryDb.insert("sosAlert", {
    id: world.sosB,
    organizationId: world.orgB,
    driverId: world.driverB,
    type: "breakdown",
    latitude: 59.93,
    longitude: 30.33,
    status: "active",
  })

  memoryDb.insert("photo", {
    id: world.photoA,
    organizationId: world.orgA,
    url: "https://test.local/a.jpg",
    type: "doc",
    driverId: world.driverA,
    orderId: world.orderA,
  })
  memoryDb.insert("photo", {
    id: world.photoB,
    organizationId: world.orgB,
    url: "https://test.local/b.jpg",
    type: "doc",
    driverId: world.driverB,
    orderId: world.orderB,
  })

  memoryDb.insert("chatMessage", {
    id: world.chatA,
    organizationId: world.orgA,
    senderId: world.driverA,
    senderRole: "driver",
    senderName: "Водитель А",
    content: "сообщение организации А",
  })
  memoryDb.insert("chatMessage", {
    id: world.chatB,
    organizationId: world.orgB,
    senderId: world.driverB,
    senderRole: "driver",
    senderName: "Водитель Б",
    content: "сообщение организации Б",
  })

  memoryDb.insert("notification", {
    id: world.notificationA,
    organizationId: world.orgA,
    userId: world.adminA,
    userRole: "admin",
    type: "test",
    title: "Уведомление А",
    message: "уведомление организации А",
  })
  memoryDb.insert("notification", {
    id: world.notificationB,
    organizationId: world.orgB,
    userId: world.adminB,
    userRole: "admin",
    type: "test",
    title: "Уведомление Б",
    message: "уведомление организации Б",
  })

  memoryDb.insert("maintenanceLog", {
    id: world.maintenanceA,
    organizationId: world.orgA,
    vehicleId: world.vehicleA,
    type: "oil",
    description: "ТО организации А",
    status: "completed",
  })
  memoryDb.insert("maintenanceLog", {
    id: world.maintenanceB,
    organizationId: world.orgB,
    vehicleId: world.vehicleB,
    type: "oil",
    description: "ТО организации Б",
    status: "completed",
  })

  memoryDb.insert("fleetSettings", {
    id: world.settingsA,
    organizationId: world.orgA,
    parkName: "Автопарк А",
  })
  memoryDb.insert("fleetSettings", {
    id: world.settingsB,
    organizationId: world.orgB,
    parkName: "Автопарк Б",
  })

  memoryDb.insert("inviteCode", {
    id: world.inviteA,
    code: "AAAA-AAAA-AAAA",
    organizationId: world.orgA,
    createdById: world.adminA,
    role: "logist",
  })
  memoryDb.insert("inviteCode", {
    id: world.inviteB,
    code: "BBBB-BBBB-BBBB",
    organizationId: world.orgB,
    createdById: world.adminB,
    role: "logist",
  })

  world.ownIds = [
    world.orgA,
    world.adminA,
    world.driverA,
    world.driverUserA,
    world.vehicleA,
    world.orderA,
    world.routeA,
    world.eventA,
    world.shiftA,
    world.sosA,
    world.photoA,
    world.chatA,
    world.notificationA,
    world.maintenanceA,
    world.settingsA,
    world.inviteA,
  ]
  world.foreignIds = [
    world.orgB,
    world.adminB,
    world.driverB,
    world.driverUserB,
    world.vehicleB,
    world.orderB,
    world.routeB,
    world.eventB,
    world.shiftB,
    world.sosB,
    world.photoB,
    world.chatB,
    world.notificationB,
    world.maintenanceB,
    world.settingsB,
    world.inviteB,
  ]

  return world
}

/** Подписанная сессия: cookie, как его выдаёт боевое приложение. */
export async function sessionCookie(params: {
  userId: string
  role: "admin" | "logist" | "driver"
  kind: "staff" | "driver"
  driverId?: string | null
  sessionId?: string
}): Promise<string> {
  const sessionId = params.sessionId || `session_${params.userId}`
  memoryDb.insert("session", {
    id: sessionId,
    userId: params.userId,
    role: params.role,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  const token = await signSessionToken(
    buildTokenPayload({
      userId: params.userId,
      role: params.role,
      kind: params.kind,
      sessionId,
      ttlMs: 60 * 60 * 1000,
      driverId: params.driverId ?? null,
    }),
  )
  const cookieName = params.kind === "driver" ? DRIVER_COOKIE : STAFF_COOKIE
  return `${cookieName}=${token}`
}

/** NextRequest для прямого вызова обработчика роута. */
export function makeRequest(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  urlPath: string,
  options: { cookie?: string | null; body?: unknown } = {},
): NextRequest {
  const headers: Record<string, string> = {}
  if (options.cookie) headers.cookie = options.cookie
  const hasBody = options.body !== undefined
  if (hasBody) headers["content-type"] = "application/json"
  return new NextRequest(`http://localhost${urlPath}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  })
}

/** Контекст динамического сегмента: { params: Promise<{…}> } (Next.js 15+). */
export function routeContext(params: Record<string, string>) {
  return { params: Promise.resolve(params) } as never
}

export async function jsonOf(response: Response): Promise<any> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

/**
 * Строка из тестовой базы. Падает, если записи нет: в тестах она обязана быть,
 * а `undefined.status` превратил бы причину в непонятную ошибку типов.
 */
export function rowOf(model: string, id: string): Record<string, any> {
  const found = memoryDb.find(model, id)
  if (!found) throw new Error(`в тестовой базе нет записи ${model} с id ${id}`)
  return found
}

/**
 * Ответ роута не должен содержать ни одного идентификатора чужой организации.
 * Проверка намеренно «грубая» — по сериализованному JSON: так ловятся утечки
 * в любых полях, включая вложенные include/select.
 */
export function expectNoForeignIds(payload: unknown, world: World) {
  const serialized = JSON.stringify(payload ?? null)
  for (const id of world.foreignIds) {
    if (serialized.includes(id)) {
      throw new Error(`в ответе встретился идентификатор чужой организации: ${id}`)
    }
  }
}
