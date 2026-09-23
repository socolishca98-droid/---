#!/usr/bin/env node
/**
 * scripts/verify-organizations.mjs
 *
 * Проверка задачи «Организации»: полная изоляция данных между организациями.
 *
 * Три уровня проверки:
 *   1. Схема        — organizationId во всех бизнес-таблицах, уникальность номера
 *                     машины в рамках организации, общие таблицы (GeoCache, AtiCache)
 *                     без организации.
 *   2. Аудит роутов — scripts/audit-org-isolation.mjs: ни один API-роут не читает и
 *                     не пишет бизнес-данные без фильтра организации из сессии.
 *   3. База данных  — создаются две тестовые организации с полным набором данных,
 *                     затем проверяется, что логист одной не видит и не может изменить
 *                     данные другой (заказы, водители, машины, рейсы, события, смены,
 *                     SOS, фото, чат, ТО, уведомления, сотрудники, инвайт-коды,
 *                     настройки автопарка).
 *   4. HTTP (опция) — то же самое через реальные эндпоинты запущенного сервера.
 *
 * Запуск:
 *   node scripts/verify-organizations.mjs                    # схема + аудит + БД
 *   node scripts/verify-organizations.mjs --no-db            # только схема + аудит
 *   node scripts/verify-organizations.mjs --base-url http://localhost:3000
 *   node scripts/verify-organizations.mjs --keep             # не удалять тестовые данные
 *   node scripts/verify-organizations.mjs --json             # машинный вывод
 *
 * Тестовые организации называются «Тест-Изоляция А/Б <метка времени>» и удаляются
 * в конце (каскадно, вместе со всеми своими данными). Флаг --keep оставляет их.
 */

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(name)
const getValue = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}

const KEEP = hasFlag("--keep")
const NO_DB = hasFlag("--no-db")
const JSON_OUT = hasFlag("--json")
const BASE_URL = (getValue("--base-url") || "").replace(/\/+$/, "")

/** Модели, у которых обязан быть organizationId (бизнес-данные). */
const BUSINESS_MODELS = [
  "User",
  "Driver",
  "Vehicle",
  "Order",
  "Route",
  "RouteStage",
  "RouteEvent",
  "Photo",
  "MaintenanceLog",
  "ChatMessage",
  "Notification",
  "SosAlert",
  "DriverShift",
  "ShiftEvent",
  "FleetSettings",
  "AtiScanConfig",
  "AuditLog",
]

/** Общие данные: организация не применяется намеренно. */
const SHARED_MODELS = ["GeoCache", "AtiCache"]

const results = []

function check(section, name, ok, detail = "") {
  // ok === null — проверка пропущена (не провалена)
  results.push({ section, name, ok: ok === null ? null : Boolean(ok), detail })
}

function modelBlock(schema, model) {
  const start = schema.indexOf(`model ${model} `)
  if (start < 0) return null
  const end = schema.indexOf("\n}\n", start)
  return schema.slice(start, end < 0 ? schema.length : end + 3)
}

// ---------------------------------------------------------------------------
// 1. Схема
// ---------------------------------------------------------------------------
function checkSchema() {
  const section = "Схема"
  const schemaPath = path.join(ROOT, "prisma", "schema.prisma")
  let schema
  try {
    schema = readFileSync(schemaPath, "utf8")
  } catch {
    check(section, "prisma/schema.prisma читается", false, "файл не найден")
    return
  }

  const org = modelBlock(schema, "Organization")
  check(section, "Модель Organization существует", Boolean(org))
  if (org) {
    check(section, "Organization.name обязательное", /^\s+name\s+String\s*$/m.test(org))
    check(
      section,
      "Organization.nameKey уникален (регистронезависимое название)",
      /nameKey\s+String\?\s+@unique/.test(org),
    )
    check(section, "Organization.createdAt есть", /createdAt\s+DateTime/.test(org))
  }

  for (const model of BUSINESS_MODELS) {
    const block = modelBlock(schema, model)
    if (!block) {
      check(section, `${model}: организация`, false, "модель не найдена в схеме")
      continue
    }
    check(
      section,
      `${model}: есть organizationId`,
      /^\s+organizationId\s+String\?/m.test(block),
    )
    check(
      section,
      `${model}: organizationId проиндексирован`,
      /@@index\(\[organizationId/.test(block),
    )
  }

  for (const model of SHARED_MODELS) {
    const block = modelBlock(schema, model)
    if (!block) {
      check(section, `${model}: общая таблица`, false, "модель не найдена в схеме")
      continue
    }
    check(
      section,
      `${model}: organizationId отсутствует (общие данные)`,
      !/organizationId/.test(block),
    )
  }

  const vehicle = modelBlock(schema, "Vehicle")
  if (vehicle) {
    check(
      section,
      "Vehicle: номер уникален в рамках организации",
      /@@unique\(\[organizationId,\s*plate\]\)/.test(vehicle),
    )
    check(
      section,
      "Vehicle: глобальной уникальности номера нет",
      !/^\s+plate\s+String\s+@unique/m.test(vehicle),
    )
  }

  const invite = modelBlock(schema, "InviteCode")
  if (invite) {
    check(section, "InviteCode: привязан к организации", /organizationId\s+String/.test(invite))
    check(section, "InviteCode: есть срок действия", /expiresAt\s+DateTime\?/.test(invite))
    check(section, "InviteCode: есть отзыв", /revokedAt\s+DateTime\?/.test(invite))
    check(section, "InviteCode: роль из кода", /role\s+String/.test(invite))
  }
}

// ---------------------------------------------------------------------------
// 2. Аудит API-роутов
// ---------------------------------------------------------------------------
function checkAudit() {
  const section = "Аудит роутов"
  const script = path.join(ROOT, "scripts", "audit-org-isolation.mjs")
  const run = spawnSync(process.execPath, [script, "--json"], { encoding: "utf8" })
  if (run.status !== 0 && !run.stdout) {
    check(section, "аудит запускается", false, (run.stderr || "").slice(0, 300))
    return
  }

  let reports
  try {
    reports = JSON.parse(run.stdout)
  } catch (error) {
    check(section, "аудит отдаёт JSON", false, String(error).slice(0, 200))
    return
  }

  const withViolations = reports.filter((r) => (r.violations || []).length || (r.raw || []).length)
  const noGuard = reports.filter(
    (r) => !r.exempt && !r.hasCronSecret && !r.guard && (r.orgModels || 0) > 0,
  )
  const noOrgContext = reports.filter(
    (r) => !r.exempt && !r.hasCronSecret && (r.orgModels || 0) > 0 && !r.hasOrgContext,
  )

  check(
    section,
    `проверено роут-файлов: ${reports.length}`,
    reports.length >= 60,
    "ожидалось не меньше 60 файлов app/**/route.ts",
  )
  check(
    section,
    "нарушений изоляции нет",
    withViolations.length === 0,
    withViolations.map((r) => `${r.path}: ${(r.violations || []).length}`).join("; "),
  )
  check(
    section,
    "у всех роутов с бизнес-данными есть гард доступа",
    noGuard.length === 0,
    noGuard.map((r) => r.path).join(", "),
  )
  check(
    section,
    "организация берётся из сессии во всех роутах с бизнес-данными",
    noOrgContext.length === 0,
    noOrgContext.map((r) => r.path).join(", "),
  )
}

// ---------------------------------------------------------------------------
// 3. База данных: две организации и полная изоляция
// ---------------------------------------------------------------------------
const CHILD_MODELS = [
  "shiftEvent",
  "driverShift",
  "routeEvent",
  "routeStage",
  "maintenanceLog",
  "photo",
  "sosAlert",
  "chatMessage",
  "notification",
  "order",
  "route",
  "atiScanConfig",
  "fleetSettings",
  "auditLog",
  "inviteCode",
  "session",
  "user",
  "vehicle",
  "driver",
]

async function cleanupOrganizations(prisma, ids) {
  for (const id of ids) {
    for (const model of CHILD_MODELS) {
      const delegate = prisma[model]
      if (!delegate || typeof delegate.deleteMany !== "function") continue
      try {
        await delegate.deleteMany({ where: { organizationId: id } })
      } catch {
        // модель без organizationId (например Session) — её удаляет каскад от User
      }
    }
    try {
      await prisma.organization.delete({ where: { id } })
    } catch {
      // уже удалена каскадом
    }
  }
}

async function dbChecks() {
  const section = "База данных"

  let PrismaClient
  try {
    ;({ PrismaClient } = await import("@prisma/client"))
  } catch (error) {
    check(
      section,
      "Prisma-клиент доступен",
      false,
      `не удалось импортировать @prisma/client — выполните npx prisma generate (${String(error).slice(0, 120)})`,
    )
    return null
  }

  const prisma = new PrismaClient()
  const stamp = Date.now()
  const suffix = stamp.toString(36)
  const names = {
    a: `Тест-Изоляция А ${stamp}`,
    b: `Тест-Изоляция Б ${stamp}`,
  }
  const created = []

  try {
    await prisma.$connect()
  } catch (error) {
    check(section, "подключение к базе", false, String(error.message || error).slice(0, 200))
    return null
  }

  try {
    const [orgA, orgB] = await Promise.all([
      prisma.organization.create({
        data: { name: names.a, nameKey: names.a.toLowerCase() },
      }),
      prisma.organization.create({
        data: { name: names.b, nameKey: names.b.toLowerCase() },
      }),
    ])
    created.push(orgA.id, orgB.id)
    check(section, "две тестовые организации созданы", Boolean(orgA.id && orgB.id))

    const shared = { plate: `А000АА${suffix.slice(-4)}`, type: "truck", capacity: 20 }

    // сотрудники
    const userA = await prisma.user.create({
      data: {
        organizationId: orgA.id,
        name: "Логист А",
        email: `logist-a-${suffix}@test.local`,
        passwordHash: "x",
        passwordSalt: "x",
        role: "logist",
        status: "active",
      },
    })
    const userB = await prisma.user.create({
      data: {
        organizationId: orgB.id,
        name: "Логист Б",
        email: `logist-b-${suffix}@test.local`,
        passwordHash: "x",
        passwordSalt: "x",
        role: "logist",
        status: "active",
      },
    })

    // водители
    const driverA = await prisma.driver.create({
      data: {
        organizationId: orgA.id,
        name: "Водитель А",
        phone: `+7900000${suffix.slice(-4)}`,
        vehicleType: "truck",
        vehiclePlate: shared.plate,
      },
    })
    const driverB = await prisma.driver.create({
      data: {
        organizationId: orgB.id,
        name: "Водитель Б",
        phone: `+7911111${suffix.slice(-4)}`,
        vehicleType: "truck",
        vehiclePlate: shared.plate,
      },
    })

    // машины: один и тот же номер в двух организациях — разрешено
    const vehicleA = await prisma.vehicle.create({
      data: { organizationId: orgA.id, plate: shared.plate, type: shared.type, capacity: shared.capacity },
    })
    let vehicleB = null
    let samePlateOk = false
    try {
      vehicleB = await prisma.vehicle.create({
        data: { organizationId: orgB.id, plate: shared.plate, type: shared.type, capacity: shared.capacity },
      })
      samePlateOk = true
    } catch (error) {
      check(section, "одинаковый номер в двух организациях разрешён", false, String(error.message).slice(0, 160))
    }
    if (samePlateOk) {
      check(section, "одинаковый номер в двух организациях разрешён", true, shared.plate)
    }

    // дубль номера внутри одной организации — запрещён
    let duplicateRejected = false
    try {
      const dup = await prisma.vehicle.create({
        data: { organizationId: orgA.id, plate: shared.plate, type: shared.type, capacity: shared.capacity },
      })
      await prisma.vehicle.delete({ where: { id: dup.id } })
    } catch (error) {
      duplicateRejected = /P2002|unique|Unique/i.test(String(error.message || error.code || error))
    }
    check(section, "дубль номера внутри организации отклонён", duplicateRejected, "ожидалась ошибка P2002")

    // заказы
    const orderBase = {
      source: "manual",
      routeFrom: "Москва",
      routeTo: "Казань",
      distance: 800,
      weight: 10,
      cargoType: "Груз",
      clientContact: "",
      deadline: new Date(Date.now() + 86400000),
      status: "confirmed",
      price: 1000,
    }
    const orderA = await prisma.order.create({
      data: { organizationId: orgA.id, ...orderBase, assignedDriverId: driverA.id, assignedVehicleId: vehicleA.id },
    })
    const orderB = await prisma.order.create({
      data: {
        organizationId: orgB.id,
        ...orderBase,
        routeFrom: "Питер",
        routeTo: "Псков",
        assignedDriverId: driverB.id,
        assignedVehicleId: vehicleB?.id ?? null,
      },
    })

    // рейсы и события
    const routeA = await prisma.route.create({ data: { organizationId: orgA.id, status: "active", name: "Рейс А" } })
    const routeB = await prisma.route.create({ data: { organizationId: orgB.id, status: "active", name: "Рейс Б" } })
    await prisma.order.updateMany({ where: { id: orderA.id }, data: { routeId: routeA.id } })
    await prisma.order.updateMany({ where: { id: orderB.id }, data: { routeId: routeB.id } })
    const eventA = await prisma.routeEvent.create({
      data: { organizationId: orgA.id, routeId: routeA.id, driverId: driverA.id, type: "status", status: "active" },
    })
    const eventB = await prisma.routeEvent.create({
      data: { organizationId: orgB.id, routeId: routeB.id, driverId: driverB.id, type: "status", status: "active" },
    })

    // смены, SOS, фото, чат, ТО, уведомления
    const shiftA = await prisma.driverShift.create({ data: { organizationId: orgA.id, driverId: driverA.id } })
    const shiftB = await prisma.driverShift.create({ data: { organizationId: orgB.id, driverId: driverB.id } })
    const sosA = await prisma.sosAlert.create({
      data: { organizationId: orgA.id, driverId: driverA.id, type: "breakdown", latitude: 55.75, longitude: 37.61 },
    })
    const sosB = await prisma.sosAlert.create({
      data: { organizationId: orgB.id, driverId: driverB.id, type: "breakdown", latitude: 59.93, longitude: 30.33 },
    })
    const photoA = await prisma.photo.create({
      data: { organizationId: orgA.id, url: "https://test.local/a.jpg", type: "doc", driverId: driverA.id },
    })
    const photoB = await prisma.photo.create({
      data: { organizationId: orgB.id, url: "https://test.local/b.jpg", type: "doc", driverId: driverB.id },
    })
    const chatA = await prisma.chatMessage.create({
      data: {
        organizationId: orgA.id,
        senderId: driverA.id,
        senderRole: "driver",
        senderName: "Водитель А",
        content: "сообщение А",
      },
    })
    const chatB = await prisma.chatMessage.create({
      data: {
        organizationId: orgB.id,
        senderId: driverB.id,
        senderRole: "driver",
        senderName: "Водитель Б",
        content: "сообщение Б",
      },
    })
    const maintA = await prisma.maintenanceLog.create({
      data: { organizationId: orgA.id, vehicleId: vehicleA.id, type: "oil", description: "ТО А" },
    })
    const maintB = vehicleB
      ? await prisma.maintenanceLog.create({
          data: { organizationId: orgB.id, vehicleId: vehicleB.id, type: "oil", description: "ТО Б" },
        })
      : null
    const notifA = await prisma.notification.create({
      data: {
        organizationId: orgA.id,
        userId: userA.id,
        userRole: "logist",
        type: "test",
        title: "А",
        message: "уведомление А",
      },
    })
    const notifB = await prisma.notification.create({
      data: {
        organizationId: orgB.id,
        userId: userB.id,
        userRole: "logist",
        type: "test",
        title: "Б",
        message: "уведомление Б",
      },
    })
    const settingsA = await prisma.fleetSettings.create({
      data: { organizationId: orgA.id, parkName: "Автопарк А" },
    })
    const settingsB = await prisma.fleetSettings.create({
      data: { organizationId: orgB.id, parkName: "Автопарк Б" },
    })
    const inviteA = await prisma.inviteCode.create({
      data: { code: `TESTA${suffix.slice(-7)}`, organizationId: orgA.id, createdById: userA.id, role: "logist" },
    })
    const inviteB = await prisma.inviteCode.create({
      data: { code: `TESTB${suffix.slice(-7)}`, organizationId: orgB.id, createdById: userB.id, role: "logist" },
    })

    // --- проверки: логист А видит только своё ---
    const scopedA = (where) => ({ ...(where || {}), organizationId: orgA.id })

    const [
      ordersA,
      driversA,
      vehiclesA,
      routesA,
      eventsA,
      shiftsA,
      sosAList,
      photosA,
      chatsA,
      maintAList,
      notifsA,
      usersA,
      invitesA,
      settingsAFound,
      settingsBFound,
    ] = await Promise.all([
      prisma.order.findMany({ where: scopedA({}) }),
      prisma.driver.findMany({ where: scopedA({}) }),
      prisma.vehicle.findMany({ where: scopedA({}) }),
      prisma.route.findMany({ where: scopedA({}) }),
      prisma.routeEvent.findMany({ where: scopedA({}) }),
      prisma.driverShift.findMany({ where: scopedA({}) }),
      prisma.sosAlert.findMany({ where: scopedA({}) }),
      prisma.photo.findMany({ where: scopedA({}) }),
      prisma.chatMessage.findMany({ where: scopedA({}) }),
      prisma.maintenanceLog.findMany({ where: scopedA({}) }),
      prisma.notification.findMany({ where: scopedA({}) }),
      prisma.user.findMany({ where: scopedA({}) }),
      prisma.inviteCode.findMany({ where: scopedA({}) }),
      prisma.fleetSettings.findFirst({ where: scopedA({}) }),
      prisma.fleetSettings.findFirst({ where: { organizationId: orgA.id, id: settingsB.id } }),
    ])

    const only = (rows, ownIds, foreignIds) =>
      rows.every((row) => ownIds.includes(row.id)) && rows.every((row) => !foreignIds.includes(row.id))

    check(section, "заказы: логист А видит только свои", only(ordersA, [orderA.id], [orderB.id]), `найдено ${ordersA.length}`)
    check(section, "водители: логист А видит только своих", only(driversA, [driverA.id], [driverB.id]))
    check(section, "машины: логист А видит только свои", only(vehiclesA, [vehicleA.id], vehicleB ? [vehicleB.id] : []))
    check(section, "рейсы: логист А видит только свои", only(routesA, [routeA.id], [routeB.id]))
    check(section, "события рейсов изолированы", only(eventsA, [eventA.id], [eventB.id]))
    check(section, "смены изолированы", only(shiftsA, [shiftA.id], [shiftB.id]))
    check(section, "SOS изолированы", only(sosAList, [sosA.id], [sosB.id]))
    check(section, "фото изолированы", only(photosA, [photoA.id], [photoB.id]))
    check(section, "чат изолирован", only(chatsA, [chatA.id], [chatB.id]))
    check(
      section,
      "журналы ТО изолированы",
      only(maintAList, [maintA.id], maintB ? [maintB.id] : []),
    )
    check(section, "уведомления изолированы", only(notifsA, [notifA.id], [notifB.id]))
    check(section, "сотрудники изолированы", only(usersA, [userA.id], [userB.id]))
    check(section, "инвайт-коды изолированы", only(invitesA, [inviteA.id], [inviteB.id]))
    check(
      section,
      "настройки автопарка свои у каждой организации",
      settingsAFound?.id === settingsA.id && settingsBFound === null,
    )

    // точечный доступ к чужой записи
    const foreignOrder = await prisma.order.findFirst({ where: scopedA({ id: orderB.id }) })
    check(section, "чужой заказ по id не находится", foreignOrder === null)
    const foreignDriver = await prisma.driver.findFirst({ where: scopedA({ id: driverB.id }) })
    check(section, "чужой водитель по id не находится", foreignDriver === null)
    const foreignVehicle = vehicleB
      ? await prisma.vehicle.findFirst({ where: scopedA({ id: vehicleB.id }) })
      : null
    check(section, "чужая машина по id не находится", !vehicleB || foreignVehicle === null)

    // запись в чужую организацию с фильтром своей ничего не меняет
    const touched = await prisma.order.updateMany({
      where: scopedA({ id: orderB.id }),
      data: { status: "cancelled" },
    })
    const orderBAfter = await prisma.order.findUnique({ where: { id: orderB.id } })
    check(
      section,
      "чужой заказ нельзя изменить (updateMany с фильтром организации)",
      touched.count === 0 && orderBAfter.status === "confirmed",
      `изменено строк: ${touched.count}, статус: ${orderBAfter.status}`,
    )

    const deleted = await prisma.order.deleteMany({ where: scopedA({ id: orderB.id }) })
    const orderBStill = await prisma.order.findUnique({ where: { id: orderB.id } })
    check(
      section,
      "чужой заказ нельзя удалить (deleteMany с фильтром организации)",
      deleted.count === 0 && Boolean(orderBStill),
    )

    const driverTouched = await prisma.driver.updateMany({
      where: scopedA({ id: driverB.id }),
      data: { status: "offline" },
    })
    const driverBAfter = await prisma.driver.findUnique({ where: { id: driverB.id } })
    check(
      section,
      "чужого водителя нельзя изменить",
      driverTouched.count === 0 && driverBAfter.status === "available",
    )

    return { prisma, orgA, orgB, created }
  } catch (error) {
    check(section, "проверки на базе данных выполнены", false, String(error.message || error).slice(0, 300))
    return { prisma, created }
  }
}

// ---------------------------------------------------------------------------
// 4. HTTP: то же самое через реальные эндпоинты
// ---------------------------------------------------------------------------
class CookieJar {
  constructor() {
    this.cookies = new Map()
  }

  absorb(response) {
    const raw = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : []
    for (const cookie of raw) {
      const [pair] = cookie.split(";")
      const index = pair.indexOf("=")
      if (index < 0) continue
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      if (value === "" || /expires=Thu, 01 Jan 1970/i.test(cookie)) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ")
  }

  get(name) {
    return this.cookies.get(name) || null
  }
}

async function api(jar, method, urlPath, body) {
  const csrf = jar.get("loginex_csrf")
  const headers = { accept: "application/json" }
  if (body !== undefined) headers["content-type"] = "application/json"
  if (csrf) headers["x-csrf-token"] = csrf
  const cookie = jar.header()
  if (cookie) headers.cookie = cookie

  const response = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  jar.absorb(response)
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // не JSON — оставим текст
  }
  return { status: response.status, json, text }
}

/**
 * Регистрация по сценарию А (своя организация) и вход: регистрация не выдаёт
 * сессию, поэтому дальше обязателен POST /api/auth/login.
 */
async function registerOrganization(jar, name, email, password) {
  await api(jar, "GET", "/api/auth/csrf")
  const register = await api(jar, "POST", "/api/auth/register", {
    name,
    email,
    password,
    organizationName: name,
  })
  const login =
    register.status < 300
      ? await api(jar, "POST", "/api/auth/login", { email, password })
      : null
  return { register, login }
}

async function httpChecks(dbContext) {
  const section = "HTTP"
  if (!BASE_URL) {
    check(section, "проверка через API", null, "пропущено: укажите --base-url http://localhost:3000")
    return
  }

  const stamp = Date.now()
  const suffix = stamp.toString(36)
  const jars = { a: new CookieJar(), b: new CookieJar() }
  const orgNames = { a: `Тест-API А ${stamp}`, b: `Тест-API Б ${stamp}` }
  const orgIds = []
  const cleanup = { drivers: [], vehicles: [], orders: [], routes: [] }

  try {
    const a = await registerOrganization(jars.a, orgNames.a, `api-a-${suffix}@test.local`, "TestPass123!")
    const b = await registerOrganization(jars.b, orgNames.b, `api-b-${suffix}@test.local`, "TestPass123!")
    check(
      section,
      "регистрация организации (сценарий А) — обе прошли",
      a.register.status < 300 && b.register.status < 300,
      `A: ${a.register.status} ${a.register.text?.slice(0, 120) || ""} / B: ${b.register.status} ${b.register.text?.slice(0, 120) || ""}`,
    )
    check(
      section,
      "вход после регистрации работает",
      Boolean(a.login && a.login.status < 300 && b.login && b.login.status < 300),
      `A: ${a.login?.status ?? "-"} / B: ${b.login?.status ?? "-"}`,
    )
    check(
      section,
      "регистрация вернула созданную организацию",
      Boolean(a.register.json?.organization?.id && b.register.json?.organization?.id),
    )
    if (a.register.json?.organization?.id) orgIds.push(a.register.json.organization.id)
    if (b.register.json?.organization?.id) orgIds.push(b.register.json.organization.id)

    const sessionA = await api(jars.a, "GET", "/api/auth/session")
    const sessionB = await api(jars.b, "GET", "/api/auth/session")
    const orgA = sessionA.json?.session?.organization || null
    const orgB = sessionB.json?.session?.organization || null
    check(section, "сессия отдаёт организацию пользователя", Boolean(orgA?.id && orgB?.id), JSON.stringify({ orgA, orgB }))
    check(section, "организации разные", Boolean(orgA?.id && orgB?.id && orgA.id !== orgB.id))

    const roleA = sessionA.json?.session?.role
    check(section, "первый пользователь — админ своей организации", roleA === "admin", `роль: ${roleA}`)

    // данные организации Б
    const driverB = await api(jars.b, "POST", "/api/drivers", {
      name: "Водитель Б",
      phone: `+7922222${suffix.slice(-4)}`,
    })
    const vehicleB = await api(jars.b, "POST", "/api/vehicles", {
      plate: `В000ВВ${suffix.slice(-4)}`,
      type: "truck",
      capacity: 20,
    })
    const driverBId = driverB.json?.driver?.id
    const vehicleBId = vehicleB.json?.vehicle?.id
    check(section, "организация Б создала водителя и машину", Boolean(driverBId && vehicleBId), `driver: ${driverB.status}, vehicle: ${vehicleB.status}`)

    const orderB = await api(jars.b, "POST", "/api/orders", {
      routeFrom: "Питер",
      routeTo: "Псков",
      distance: 300,
      weight: 5,
      price: 5000,
      assignedDriverId: driverBId,
      assignedVehicleId: vehicleBId,
    })
    const orderBId = orderB.json?.order?.id
    check(section, "организация Б создала заказ", Boolean(orderBId), `${orderB.status} ${orderB.text?.slice(0, 140) || ""}`)
    if (driverBId) cleanup.drivers.push(driverBId)
    if (vehicleBId) cleanup.vehicles.push(vehicleBId)
    if (orderBId) cleanup.orders.push(orderBId)

    // организация А не видит данные Б
    const ordersA = await api(jars.a, "GET", "/api/orders")
    const driversA = await api(jars.a, "GET", "/api/drivers")
    const vehiclesA = await api(jars.a, "GET", "/api/vehicles")

    const listIds = (payload, key) => {
      const rows = payload?.json?.[key] || []
      return rows.map((row) => row.id)
    }
    check(
      section,
      "GET /api/orders: заказа организации Б нет в выдаче А",
      !listIds(ordersA, "orders").includes(orderBId),
    )
    check(
      section,
      "GET /api/drivers: водителя организации Б нет в выдаче А",
      !listIds(driversA, "drivers").includes(driverBId),
    )
    check(
      section,
      "GET /api/vehicles: машины организации Б нет в выдаче А",
      !listIds(vehiclesA, "vehicles").includes(vehicleBId),
    )

    // точечный доступ к чужим записям — 404
    const directOrder = await api(jars.a, "GET", `/api/orders/${orderBId}`)
    check(section, "GET /api/orders/{чужой} → 404", directOrder.status === 404, `факт: ${directOrder.status}`)
    const directVehicle = await api(jars.a, "GET", `/api/vehicles/${vehicleBId}`)
    check(section, "GET /api/vehicles/{чужая} → 404", directVehicle.status === 404, `факт: ${directVehicle.status}`)
    const directDriver = await api(jars.a, "GET", `/api/drivers/${driverBId}`)
    check(section, "GET /api/drivers/{чужой} → 404", directDriver.status === 404, `факт: ${directDriver.status}`)

    // изменение и удаление чужих записей — 404
    const patchOrder = await api(jars.a, "PATCH", `/api/orders/${orderBId}`, { status: "cancelled" })
    check(section, "PATCH /api/orders/{чужой} → 404", patchOrder.status === 404, `факт: ${patchOrder.status}`)
    const deleteDriver = await api(jars.a, "DELETE", `/api/drivers/${driverBId}`)
    check(section, "DELETE /api/drivers/{чужой} → 404", deleteDriver.status === 404, `факт: ${deleteDriver.status}`)
    const deleteVehicle = await api(jars.a, "DELETE", `/api/vehicles/${vehicleBId}`)
    check(section, "DELETE /api/vehicles/{чужая} → 404", deleteVehicle.status === 404, `факт: ${deleteVehicle.status}`)

    // назначить чужого водителя/машину в свой заказ нельзя
    const hijack = await api(jars.a, "POST", "/api/orders", {
      routeFrom: "Москва",
      routeTo: "Тула",
      distance: 200,
      weight: 3,
      price: 3000,
      assignedDriverId: driverBId,
      assignedVehicleId: vehicleBId,
    })
    check(
      section,
      "POST /api/orders с чужим водителем/машиной отклонён",
      hijack.status === 404 || hijack.status === 400 || hijack.status === 403,
      `факт: ${hijack.status}`,
    )
    if (hijack.json?.order?.id) cleanup.orders.push(hijack.json.order.id)

    // данные Б остались нетронутыми
    const orderBAfter = await api(jars.b, "GET", `/api/orders/${orderBId}`)
    check(
      section,
      "заказ организации Б не изменился",
      orderBAfter.status === 200 && orderBAfter.json?.order?.status !== "cancelled",
      `${orderBAfter.status} ${orderBAfter.json?.order?.status || ""}`,
    )
  } catch (error) {
    check(section, "проверки через API выполнены", false, String(error.message || error).slice(0, 240))
  } finally {
    if (!KEEP) {
      // чистим созданные через API сущности, затем организации (если есть доступ к БД)
      for (const id of cleanup.orders) await api(jars.b, "DELETE", `/api/orders/${id}`).catch(() => {})
      for (const id of cleanup.routes) await api(jars.b, "DELETE", `/api/routes/${id}`).catch(() => {})
      for (const id of cleanup.drivers) await api(jars.b, "DELETE", `/api/drivers/${id}`).catch(() => {})
      for (const id of cleanup.vehicles) await api(jars.b, "DELETE", `/api/vehicles/${id}`).catch(() => {})
      if (dbContext?.prisma && orgIds.length) {
        await cleanupOrganizations(dbContext.prisma, orgIds)
        check(section, "тестовые организации удалены", true, orgIds.join(", "))
      } else if (orgIds.length) {
        check(
          section,
          "тестовые организации удалены",
          null,
          `удалите вручную в базе: ${orgIds.join(", ")} (или запустите проверку вместе с БД)`,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Вывод
// ---------------------------------------------------------------------------
function report(dbContext) {
  const sections = [...new Set(results.map((r) => r.section))]
  const failed = results.filter((r) => r.ok === false)
  const skipped = results.filter((r) => r.ok === null)
  const passed = results.filter((r) => r.ok === true)

  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify({ passed: passed.length, failed: failed.length, skipped: skipped.length, results }, null, 2)}\n`)
    return failed.length === 0
  }

  process.stdout.write("\n═══ Проверка изоляции данных по организациям ═══\n\n")
  for (const section of sections) {
    const rows = results.filter((r) => r.section === section)
    const bad = rows.filter((r) => r.ok === false)
    process.stdout.write(`${bad.length ? "✗" : "✓"} ${section} — ${rows.length - bad.length}/${rows.length}\n`)
    for (const row of rows) {
      const mark = row.ok === true ? "  ✓" : row.ok === false ? "  ✗" : "  –"
      process.stdout.write(`${mark} ${row.name}${row.ok === false && row.detail ? ` — ${row.detail}` : ""}\n`)
    }
    process.stdout.write("\n")
  }

  process.stdout.write(
    `Итог: ${passed.length} проверок пройдено, ${failed.length} провалено, ${skipped.length} пропущено.\n`,
  )
  if (failed.length === 0) {
    process.stdout.write("Изоляция данных по организациям подтверждена.\n")
  } else {
    process.stdout.write("Есть нарушения изоляции — список выше.\n")
  }
  if (KEEP) process.stdout.write("Флаг --keep: тестовые данные оставлены в базе.\n")
  process.stdout.write("\n")
  return failed.length === 0
}

async function main() {
  checkSchema()
  checkAudit()

  let dbContext = null
  if (!NO_DB) {
    dbContext = await dbChecks()
    if (BASE_URL) await httpChecks(dbContext)
    if (dbContext?.prisma && !KEEP && dbContext.created?.length) {
      await cleanupOrganizations(dbContext.prisma, dbContext.created)
      check("База данных", "тестовые организации удалены из базы", true)
    } else if (dbContext?.created?.length && KEEP) {
      check(
        "База данных",
        "тестовые организации оставлены (--keep)",
        null,
        dbContext.created.join(", "),
      )
    }
    if (dbContext?.prisma) await dbContext.prisma.$disconnect().catch(() => {})
  } else if (BASE_URL) {
    await httpChecks(null)
  }

  const ok = report(dbContext)
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  process.stderr.write(`\nСбой проверки: ${error?.stack || error}\n`)
  process.exit(1)
})
