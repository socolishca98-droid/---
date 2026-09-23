// __tests__/__mocks__/prisma-memory.ts
//
// In-memory замена Prisma-клиента для функциональных тестов изоляции данных
// по организациям (vitest.isolation.config.ts подменяет ею "@/lib/prisma").
//
// Зачем: настоящие API-роуты вызываются в тестах как есть — с настоящими
// гардами доступа, настоящими подписанными cookie и настоящей логикой запросов.
// Единственная заглушка — слой хранения. Это позволяет проверить главное:
// действительно ли запросы роутов возвращают и меняют данные ТОЛЬКО своей
// организации.
//
// Поддерживается то, что реально использует проект:
//   findUnique / findUniqueOrThrow / findFirst / findFirstOrThrow / findMany
//   count / aggregate (_count, _sum, _avg) / create / update / updateMany
//   delete / deleteMany / upsert / $transaction (массив и колбэк)
//   where: равенство, null, in, notIn, not, gte, gt, lte, lt, contains,
//          startsWith, endsWith, OR, AND, NOT
//   select / include — включая вложенные связи (user.driver.organization)
//   orderBy (объект или массив), skip, take
//   уникальности: user.email, user.phone, driver.phone,
//                 vehicle(organizationId, plate), organization.nameKey,
//                 inviteCode.code, fleetSettings.organizationId
//
// Реляционные фильтры (some/every/is) в проекте не используются и здесь
// не поддерживаются: если такой запрос появится, тест упадёт с понятной ошибкой.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>

const store = new Map<string, Row[]>()

function table(model: string): Row[] {
  let rows = store.get(model)
  if (!rows) {
    rows = []
    store.set(model, rows)
  }
  return rows
}

// ---------------------------------------------------------------------------
// Метаданные связей (для select/include)
//   local   — поле на текущей модели
//   foreign — поле на связанной модели
// ---------------------------------------------------------------------------
type Relation = { model: string; many: boolean; local: string; foreign: string }

const RELATIONS: Record<string, Record<string, Relation>> = {
  organization: {
    users: { model: "user", many: true, local: "id", foreign: "organizationId" },
    drivers: { model: "driver", many: true, local: "id", foreign: "organizationId" },
    vehicles: { model: "vehicle", many: true, local: "id", foreign: "organizationId" },
    orders: { model: "order", many: true, local: "id", foreign: "organizationId" },
    routes: { model: "route", many: true, local: "id", foreign: "organizationId" },
    inviteCodes: { model: "inviteCode", many: true, local: "id", foreign: "organizationId" },
    fleetSettings: { model: "fleetSettings", many: true, local: "id", foreign: "organizationId" },
  },
  user: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    driver: { model: "driver", many: false, local: "driverId", foreign: "id" },
    inviteCode: { model: "inviteCode", many: false, local: "inviteCodeId", foreign: "id" },
    sessions: { model: "session", many: true, local: "id", foreign: "userId" },
  },
  session: {
    user: { model: "user", many: false, local: "userId", foreign: "id" },
  },
  driver: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    vehicle: { model: "vehicle", many: false, local: "vehicleId", foreign: "id" },
    user: { model: "user", many: false, local: "id", foreign: "driverId" },
    orders: { model: "order", many: true, local: "id", foreign: "assignedDriverId" },
    routes: { model: "route", many: true, local: "id", foreign: "driverId" },
    shifts: { model: "driverShift", many: true, local: "id", foreign: "driverId" },
    sosAlerts: { model: "sosAlert", many: true, local: "id", foreign: "driverId" },
    photos: { model: "photo", many: true, local: "id", foreign: "driverId" },
    events: { model: "routeEvent", many: true, local: "id", foreign: "driverId" },
    stages: { model: "routeStage", many: true, local: "id", foreign: "driverId" },
    maintenanceLogs: { model: "maintenanceLog", many: true, local: "id", foreign: "driverId" },
  },
  vehicle: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    drivers: { model: "driver", many: true, local: "id", foreign: "vehicleId" },
    orders: { model: "order", many: true, local: "id", foreign: "assignedVehicleId" },
    routes: { model: "route", many: true, local: "id", foreign: "vehicleId" },
    maintenanceLogs: { model: "maintenanceLog", many: true, local: "id", foreign: "vehicleId" },
    stages: { model: "routeStage", many: true, local: "id", foreign: "vehicleId" },
    events: { model: "routeEvent", many: true, local: "id", foreign: "vehicleId" },
  },
  order: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    driver: { model: "driver", many: false, local: "assignedDriverId", foreign: "id" },
    vehicle: { model: "vehicle", many: false, local: "assignedVehicleId", foreign: "id" },
    route: { model: "route", many: false, local: "routeId", foreign: "id" },
    photos: { model: "photo", many: true, local: "id", foreign: "orderId" },
    events: { model: "routeEvent", many: true, local: "id", foreign: "orderId" },
  },
  route: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    driver: { model: "driver", many: false, local: "driverId", foreign: "id" },
    vehicle: { model: "vehicle", many: false, local: "vehicleId", foreign: "id" },
    orders: { model: "order", many: true, local: "id", foreign: "routeId" },
    events: { model: "routeEvent", many: true, local: "id", foreign: "routeId" },
    stages: { model: "routeStage", many: true, local: "id", foreign: "routeId" },
  },
  routeEvent: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    route: { model: "route", many: false, local: "routeId", foreign: "id" },
    driver: { model: "driver", many: false, local: "driverId", foreign: "id" },
    vehicle: { model: "vehicle", many: false, local: "vehicleId", foreign: "id" },
    order: { model: "order", many: false, local: "orderId", foreign: "id" },
    stage: { model: "routeStage", many: false, local: "stageId", foreign: "id" },
  },
  routeStage: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    route: { model: "route", many: false, local: "routeId", foreign: "id" },
    order: { model: "order", many: false, local: "orderId", foreign: "id" },
    driver: { model: "driver", many: false, local: "driverId", foreign: "id" },
    vehicle: { model: "vehicle", many: false, local: "vehicleId", foreign: "id" },
  },
  driverShift: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    driver: { model: "driver", many: false, local: "driverId", foreign: "id" },
    events: { model: "shiftEvent", many: true, local: "id", foreign: "shiftId" },
  },
  shiftEvent: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    shift: { model: "driverShift", many: false, local: "shiftId", foreign: "id" },
  },
  photo: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    driver: { model: "driver", many: false, local: "driverId", foreign: "id" },
    order: { model: "order", many: false, local: "orderId", foreign: "id" },
  },
  sosAlert: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    driver: { model: "driver", many: false, local: "driverId", foreign: "id" },
    order: { model: "order", many: false, local: "orderId", foreign: "id" },
  },
  maintenanceLog: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    vehicle: { model: "vehicle", many: false, local: "vehicleId", foreign: "id" },
    driver: { model: "driver", many: false, local: "driverId", foreign: "id" },
  },
  chatMessage: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
  },
  notification: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
  },
  fleetSettings: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
  },
  inviteCode: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
    users: { model: "user", many: true, local: "id", foreign: "inviteCodeId" },
  },
  auditLog: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
  },
  atiScanConfig: {
    organization: { model: "organization", many: false, local: "organizationId", foreign: "id" },
  },
}

/** Уникальности (как в prisma/schema.prisma). */
const UNIQUE: Record<string, string[][]> = {
  user: [["id"], ["email"], ["phone"]],
  driver: [["id"], ["phone"]],
  vehicle: [["id"], ["organizationId", "plate"]],
  order: [["id"]],
  route: [["id"]],
  routeEvent: [["id"]],
  routeStage: [["id"]],
  photo: [["id"]],
  sosAlert: [["id"]],
  maintenanceLog: [["id"]],
  chatMessage: [["id"]],
  notification: [["id"]],
  driverShift: [["id"]],
  shiftEvent: [["id"]],
  organization: [["id"], ["nameKey"]],
  inviteCode: [["id"], ["code"]],
  fleetSettings: [["id"], ["organizationId"]],
  session: [["id"]],
  auditLog: [["id"]],
  atiScanConfig: [["id"]],
  atiCache: [["id"]],
  geoCache: [["id"]],
}

/** Значения по умолчанию (как @default в схеме). */
const DEFAULTS: Record<string, Row> = {
  user: { role: "logist", status: "pending", mustChangePassword: false, failedLoginCount: 0 },
  driver: { status: "available", ordersCompleted: 0, rating: 5 },
  vehicle: { status: "available", features: "[]", capacity: 0 },
  order: { status: "new", priority: "needs_clarification", source: "manual", loadingType: "other", distance: 0, weight: 0, priceNegotiable: false, isPaid: false, clientContact: "" },
  route: { status: "planned" },
  routeEvent: { type: "custom" },
  routeStage: { status: "planned", type: "other" },
  driverShift: { status: "driving", totalDrivingSeconds: 0, totalRestingSeconds: 0, totalLoadingSeconds: 0, totalWaitingSeconds: 0, drivingSinceRestSeconds: 0 },
  sosAlert: { status: "active" },
  notification: { priority: "normal", isRead: false },
  chatMessage: { type: "text", isImportant: false },
  inviteCode: { role: "logist", usedCount: 0 },
  fleetSettings: { parkName: "Наш Автопарк" },
  auditLog: { targetType: "user" },
  organization: {},
}

class MemoryPrismaError extends Error {
  code: string
  meta?: Record<string, unknown>
  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(message)
    this.name = "MemoryPrismaError"
    this.code = code
    this.meta = meta
  }
}

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}_${idCounter.toString(36)}${Date.now().toString(36).slice(-4)}`
}

// ---------------------------------------------------------------------------
// where
// ---------------------------------------------------------------------------
const OPERATORS = new Set([
  "in",
  "notIn",
  "not",
  "gte",
  "gt",
  "lte",
  "lt",
  "contains",
  "startsWith",
  "endsWith",
  "equals",
])

function isOperatorObject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) return false
  return Object.keys(value as object).some((key) => OPERATORS.has(key))
}

function compareValues(left: unknown, right: unknown): number {
  const a = left instanceof Date ? left.getTime() : (left as number | string)
  const b = right instanceof Date ? right.getTime() : (right as number | string)
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  return a < b ? -1 : 1
}

function matchesValue(rowValue: unknown, condition: unknown): boolean {
  if (isOperatorObject(condition)) {
    const operators = condition as Row
    for (const [operator, expected] of Object.entries(operators)) {
      switch (operator) {
        case "equals":
          if (!equals(rowValue, expected)) return false
          break
        case "in":
          if (!Array.isArray(expected) || !expected.some((item) => equals(rowValue, item))) return false
          break
        case "notIn":
          if (Array.isArray(expected) && expected.some((item) => equals(rowValue, item))) return false
          break
        case "not":
          if (equals(rowValue, expected)) return false
          break
        case "gte":
          if (rowValue == null || compareValues(rowValue, expected) < 0) return false
          break
        case "gt":
          if (rowValue == null || compareValues(rowValue, expected) <= 0) return false
          break
        case "lte":
          if (rowValue == null || compareValues(rowValue, expected) > 0) return false
          break
        case "lt":
          if (rowValue == null || compareValues(rowValue, expected) >= 0) return false
          break
        case "contains":
          if (typeof rowValue !== "string" || !rowValue.includes(String(expected))) return false
          break
        case "startsWith":
          if (typeof rowValue !== "string" || !rowValue.startsWith(String(expected))) return false
          break
        case "endsWith":
          if (typeof rowValue !== "string" || !rowValue.endsWith(String(expected))) return false
          break
        default:
          throw new Error(`where: оператор «${operator}» не поддерживается заглушкой`)
      }
    }
    return true
  }
  return equals(rowValue, condition)
}

function equals(left: unknown, right: unknown): boolean {
  if (left instanceof Date || right instanceof Date) {
    const a = left instanceof Date ? left.getTime() : left
    const b = right instanceof Date ? right.getTime() : right
    return a === b
  }
  if (right === null) return left === null || left === undefined
  if (left === null || left === undefined) return right === null || right === undefined
  return left === right
}

export function matches(row: Row, where?: Row | null): boolean {
  if (!where) return true
  for (const [key, condition] of Object.entries(where)) {
    if (key === "OR") {
      const list = condition as Row[]
      if (list.length > 0 && !list.some((sub) => matches(row, sub))) return false
      continue
    }
    if (key === "AND") {
      const list = Array.isArray(condition) ? (condition as Row[]) : [condition as Row]
      if (!list.every((sub) => matches(row, sub))) return false
      continue
    }
    if (key === "NOT") {
      const list = Array.isArray(condition) ? (condition as Row[]) : [condition as Row]
      if (list.some((sub) => matches(row, sub))) return false
      continue
    }
    if (!matchesValue(row[key], condition)) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// orderBy / select / include
// ---------------------------------------------------------------------------
function applyOrderBy(rows: Row[], orderBy?: unknown): Row[] {
  if (!orderBy) return rows
  const list = Array.isArray(orderBy) ? orderBy : [orderBy]
  const sorted = [...rows]
  sorted.sort((a, b) => {
    for (const entry of list) {
      for (const [field, direction] of Object.entries(entry as Row)) {
        const result = compareValues(a[field], b[field])
        if (result !== 0) return direction === "desc" ? -result : result
      }
    }
    return 0
  })
  return sorted
}

function resolveRelation(model: string, row: Row, name: string, spec: any): any {
  const relation = RELATIONS[model]?.[name]
  if (!relation) {
    throw new Error(
      `Заглушка Prisma: связь ${model}.${name} не описана в __tests__/__mocks__/prisma-memory.ts`,
    )
  }
  const related = table(relation.model)
  if (relation.many) {
    let rows = related.filter((item) => equals(item[relation.foreign], row[relation.local]))
    if (spec && typeof spec === "object") {
      rows = rows.filter((item) => matches(item, spec.where))
      rows = applyOrderBy(rows, spec.orderBy)
      if (typeof spec.skip === "number") rows = rows.slice(spec.skip)
      if (typeof spec.take === "number") rows = rows.slice(0, spec.take)
    }
    return rows.map((item) => project(relation.model, item, spec))
  }
  if (row[relation.local] === null || row[relation.local] === undefined) return null
  const found = related.find((item) => equals(item[relation.foreign], row[relation.local]))
  return found ? project(relation.model, found, spec) : null
}

function project(model: string, row: Row, args?: any): Row {
  if (!args || typeof args !== "object") return { ...row }

  if (args.select && typeof args.select === "object") {
    const out: Row = {}
    for (const [key, value] of Object.entries(args.select as Row)) {
      if (!value) continue
      if (RELATIONS[model]?.[key]) out[key] = resolveRelation(model, row, key, value)
      else if (key === "_count" && value && typeof value === "object") {
        const counts: Row = {}
        for (const relationName of Object.keys((value as Row).select || {})) {
          const resolved = resolveRelation(model, row, relationName, true)
          counts[relationName] = Array.isArray(resolved) ? resolved.length : resolved ? 1 : 0
        }
        out[key] = counts
      } else out[key] = row[key]
    }
    return out
  }

  const out: Row = { ...row }
  if (args.include && typeof args.include === "object") {
    for (const [key, value] of Object.entries(args.include as Row)) {
      if (!value) continue
      if (RELATIONS[model]?.[key]) out[key] = resolveRelation(model, row, key, value)
      else if (key === "_count" && value && typeof value === "object") {
        const counts: Row = {}
        for (const relationName of Object.keys((value as Row).select || {})) {
          const resolved = resolveRelation(model, row, relationName, true)
          counts[relationName] = Array.isArray(resolved) ? resolved.length : resolved ? 1 : 0
        }
        out[key] = counts
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// уникальности и запись
// ---------------------------------------------------------------------------
function uniqueSets(model: string): string[][] {
  return UNIQUE[model] || [["id"]]
}

function assertUnique(model: string, candidate: Row, ignoreId?: string) {
  for (const fields of uniqueSets(model)) {
    if (fields.length === 1 && fields[0] === "id") continue
    const conflict = table(model).find(
      (row) => row.id !== ignoreId && fields.every((field) => equals(row[field], candidate[field]) && candidate[field] != null),
    )
    if (conflict) {
      throw new MemoryPrismaError(
        "P2002",
        `Unique constraint failed on the fields: (${fields.join(", ")})`,
        { target: fields },
      )
    }
  }
}

function applyData(row: Row, data: Row): Row {
  const next: Row = { ...row }
  for (const [key, value] of Object.entries(data || {})) {
    if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value)) {
      const operation = value as Row
      if ("increment" in operation) next[key] = (Number(row[key]) || 0) + Number(operation.increment)
      else if ("decrement" in operation) next[key] = (Number(row[key]) || 0) - Number(operation.decrement)
      else if ("set" in operation) next[key] = operation.set
      else next[key] = value
    } else {
      next[key] = value
    }
  }
  next.updatedAt = new Date()
  return next
}

function withDefaults(model: string, data: Row): Row {
  const now = new Date()
  const row: Row = {
    ...(DEFAULTS[model] || {}),
    ...data,
  }
  if (!row.id) row.id = nextId(model)
  if (!row.createdAt) row.createdAt = now
  row.updatedAt = row.updatedAt || now
  return row
}

function findUniqueRow(model: string, where: Row): Row | null {
  const keys = Object.keys(where || {})
  // составной уникальный ключ вида organizationId_plate: { … }
  if (keys.length === 1 && keys[0].includes("_")) {
    const compound = where[keys[0]] as Row
    return table(model).find((row) => Object.entries(compound).every(([field, value]) => equals(row[field], value))) || null
  }
  return table(model).find((row) => matches(row, where)) || null
}

// ---------------------------------------------------------------------------
// клиент
// ---------------------------------------------------------------------------
function makeDelegate(model: string) {
  return {
    async findMany(args: any = {}) {
      let rows = table(model).filter((row) => matches(row, args.where))
      rows = applyOrderBy(rows, args.orderBy)
      if (typeof args.skip === "number") rows = rows.slice(args.skip)
      if (typeof args.take === "number") rows = rows.slice(0, args.take)
      return rows.map((row) => project(model, row, args))
    },

    async findFirst(args: any = {}) {
      const rows = await this.findMany({ ...args, take: 1 })
      return rows[0] ?? null
    },

    async findFirstOrThrow(args: any = {}) {
      const row = await this.findFirst(args)
      if (!row) throw new MemoryPrismaError("P2025", `${model}: запись не найдена`)
      return row
    },

    async findUnique(args: any = {}) {
      const row = findUniqueRow(model, args.where)
      return row ? project(model, row, args) : null
    },

    async findUniqueOrThrow(args: any = {}) {
      const row = await this.findUnique(args)
      if (!row) throw new MemoryPrismaError("P2025", `${model}: запись не найдена`)
      return row
    },

    async count(args: any = {}) {
      return table(model).filter((row) => matches(row, args.where)).length
    },

    async aggregate(args: any = {}) {
      const rows = table(model).filter((row) => matches(row, args.where))
      const result: Row = {}
      if (args._count) result._count = args._count === true ? rows.length : (() => {
        const counts: Row = {}
        for (const field of Object.keys(args._count as Row)) counts[field] = rows.filter((row) => row[field] != null).length
        return counts
      })()
      for (const kind of ["_sum", "_avg", "_min", "_max"] as const) {
        const fields = args[kind]
        if (!fields) continue
        const out: Row = {}
        for (const field of Object.keys(fields as Row)) {
          const values = rows.map((row) => Number(row[field])).filter((value) => Number.isFinite(value))
          if (kind === "_sum") out[field] = values.length ? values.reduce((a, b) => a + b, 0) : null
          else if (kind === "_avg") out[field] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
          else if (kind === "_min") out[field] = values.length ? Math.min(...values) : null
          else out[field] = values.length ? Math.max(...values) : null
        }
        result[kind] = out
      }
      return result
    },

    async create(args: any = {}) {
      const row = withDefaults(model, args.data || {})
      assertUnique(model, row)
      table(model).push(row)
      return project(model, row, args)
    },

    async createMany(args: any = {}) {
      let count = 0
      for (const data of args.data || []) {
        const row = withDefaults(model, data)
        try {
          assertUnique(model, row)
        } catch (error) {
          if (args.skipDuplicates) continue
          throw error
        }
        table(model).push(row)
        count += 1
      }
      return { count }
    },

    async update(args: any = {}) {
      const row = findUniqueRow(model, args.where)
      if (!row) throw new MemoryPrismaError("P2025", `${model}: запись для update не найдена`)
      const next = applyData(row, args.data || {})
      assertUnique(model, next, row.id)
      Object.assign(row, next)
      return project(model, row, args)
    },

    async updateMany(args: any = {}) {
      const rows = table(model).filter((row) => matches(row, args.where))
      for (const row of rows) Object.assign(row, applyData(row, args.data || {}))
      return { count: rows.length }
    },

    async upsert(args: any = {}) {
      const existing = findUniqueRow(model, args.where)
      if (existing) {
        const next = applyData(existing, args.update || {})
        assertUnique(model, next, existing.id)
        Object.assign(existing, next)
        return project(model, existing, args)
      }
      return this.create({ data: { ...(args.create || {}) }, select: args.select, include: args.include })
    },

    async delete(args: any = {}) {
      const rows = table(model)
      const index = rows.findIndex((row) => matches(row, args.where))
      if (index < 0) throw new MemoryPrismaError("P2025", `${model}: запись для delete не найдена`)
      const [removed] = rows.splice(index, 1)
      return project(model, removed, args)
    },

    async deleteMany(args: any = {}) {
      const rows = table(model)
      let count = 0
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index], args.where)) {
          rows.splice(index, 1)
          count += 1
        }
      }
      return { count }
    },
  }
}

const delegates = new Map<string, ReturnType<typeof makeDelegate>>()

function delegateFor(model: string) {
  let delegate = delegates.get(model)
  if (!delegate) {
    delegate = makeDelegate(model)
    delegates.set(model, delegate)
  }
  return delegate
}

export const prisma: any = new Proxy(
  {},
  {
    get(_target, property: string) {
      if (property === "$connect" || property === "$disconnect") return async () => undefined
      if (property === "$transaction") {
        return async (input: any) => {
          if (typeof input === "function") return input(prisma)
          return Promise.all(input)
        }
      }
      if (property === "$queryRaw" || property === "$executeRaw") {
        return async () => {
          throw new Error("Заглушка Prisma не поддерживает сырые запросы — в проекте их быть не должно")
        }
      }
      if (typeof property !== "string") return undefined
      return delegateFor(property)
    },
  },
)

/** Помощники для тестов. */
export const memoryDb = {
  reset() {
    store.clear()
    idCounter = 0
  },
  seed(model: string, rows: Row[]) {
    for (const row of rows) table(model).push(withDefaults(model, row))
  },
  insert(model: string, row: Row) {
    const created = withDefaults(model, row)
    table(model).push(created)
    return created
  },
  rows(model: string): Row[] {
    return table(model).map((row) => ({ ...row }))
  },
  /** Строка по id или по предикату. */
  find(model: string, idOrPredicate: string | ((row: Row) => boolean)): Row | undefined {
    const predicate =
      typeof idOrPredicate === "string"
        ? (row: Row) => row.id === idOrPredicate
        : idOrPredicate
    return table(model).find(predicate)
  },
  count(model: string): number {
    return table(model).length
  },
}

export default prisma
