// lib/clients/service.ts
//
// Работа с клиентской базой: чтение списка и карточки, создание/правка,
// импорт из файла (задача 5).
//
// Все запросы ограничены организацией из проверенной сессии. Расчёты (статистика,
// разбор файла) живут в чистых модулях lib/clients/*, здесь только база.

import { prisma } from "@/lib/prisma"
import { scopedWhere } from "@/lib/org"

import { buildClientStats, type ClientStats, type ClientOrderLike } from "./stats"
import {
  IMPORT_FIELDS,
  buildImportPreview,
  matchOrdersToClients,
  planImport,
  type ImportField,
  type ImportMode,
  type ImportPlan,
  type ImportPreview,
} from "./import"
import {
  cleanClientName,
  clientNameKey,
  normalizeDeferredDays,
  normalizeInn,
  normalizeKpp,
  normalizePaymentType,
  normalizePhone,
  normalizeVatType,
} from "./normalize"

export type ClientRecord = {
  id: string
  name: string
  nameKey: string
  inn: string | null
  kpp: string | null
  address: string | null
  contactName: string | null
  phone: string | null
  email: string | null
  paymentType: string | null
  vatType: string | null
  deferredDays: number | null
  notes: string | null
  source: string
  createdAt: Date
}

const CLIENT_SELECT = {
  id: true,
  name: true,
  nameKey: true,
  inn: true,
  kpp: true,
  address: true,
  contactName: true,
  phone: true,
  email: true,
  paymentType: true,
  vatType: true,
  deferredDays: true,
  notes: true,
  source: true,
  createdAt: true,
} as const

/** Поля заказа, из которых считается статистика клиента. */
const ORDER_STATS_SELECT = {
  id: true,
  clientId: true,
  status: true,
  price: true,
  agreedPrice: true,
  isPaid: true,
  paidAt: true,
  dueDate: true,
  deadline: true,
  createdAt: true,
  updatedAt: true,
  routeFrom: true,
  routeTo: true,
  routeId: true,
} as const

export type ClientWithStats = ClientRecord & {
  stats: ClientStats
}

/**
 * Список клиентов со статистикой. Заказы читаются одним запросом и
 * раскладываются по клиентам в памяти: клиентов в базе обычно десятки, а
 * отдельный запрос на каждого превратил бы страницу в N+1.
 */
export async function listClients(params: {
  organizationId: string
  search?: string | null
  limit?: number
  offset?: number
}): Promise<{ clients: ClientWithStats[]; total: number }> {
  const { organizationId, search, limit = 100, offset = 0 } = params

  const where = scopedWhere(organizationId, {})

  const clients = (await prisma.client.findMany({
    where,
    orderBy: [{ name: "asc" }],
    select: CLIENT_SELECT,
  })) as ClientRecord[]

  const orders = (await prisma.order.findMany({
    where: scopedWhere(organizationId, {}),
    select: ORDER_STATS_SELECT,
  })) as (ClientOrderLike & { clientId: string | null })[]

  const ordersByClient = new Map<string, ClientOrderLike[]>()
  for (const order of orders) {
    if (!order.clientId) continue
    const list = ordersByClient.get(order.clientId) ?? []
    list.push(order)
    ordersByClient.set(order.clientId, list)
  }

  const withStats: ClientWithStats[] = clients.map((client) => ({
    ...client,
    stats: buildClientStats(ordersByClient.get(client.id) ?? []),
  }))

  const query = search?.trim().toLowerCase()
  const filtered = query
    ? withStats.filter((client) => {
        const haystack = [client.name, client.inn, client.phone, client.contactName, client.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return haystack.includes(query)
      })
    : withStats

  return {
    clients: filtered.slice(offset, offset + limit),
    total: filtered.length,
  }
}

export type ClientCardOrder = {
  id: string
  status: string
  routeFrom: string
  routeTo: string
  price: number | null
  agreedPrice: number | null
  isPaid: boolean
  createdAt: Date
  deadline: Date | null
  routeId: string | null
  driverName: string | null
}

export type ClientCard = {
  client: ClientRecord
  stats: ClientStats
  orders: ClientCardOrder[]
  photos: { id: string; url: string; type: string; createdAt: Date }[]
}

/** Карточка клиента: контакты, статистика, история заказов и свежие фото. */
export async function loadClientCard(params: {
  organizationId: string
  clientId: string
}): Promise<ClientCard | null> {
  const { organizationId, clientId } = params

  const client = (await prisma.client.findFirst({
    where: scopedWhere(organizationId, { id: clientId }),
    select: CLIENT_SELECT,
  })) as ClientRecord | null

  if (!client) return null

  const orders = (await prisma.order.findMany({
    where: scopedWhere(organizationId, { clientId }),
    orderBy: [{ createdAt: "desc" }],
    select: {
      ...ORDER_STATS_SELECT,
      driver: { select: { name: true } },
    },
  })) as (ClientOrderLike & { driver?: { name: string | null } | null })[]

  const orderIds = orders.map((order) => order.id)
  const photos = orderIds.length
    ? ((await prisma.photo.findMany({
        where: scopedWhere(organizationId, { orderId: { in: orderIds } }),
        orderBy: [{ createdAt: "desc" }],
        take: 8,
        select: { id: true, url: true, type: true, createdAt: true },
      })) as { id: string; url: string; type: string; createdAt: Date }[])
    : []

  return {
    client,
    stats: buildClientStats(orders),
    orders: orders.map((order) => ({
      id: order.id,
      status: order.status,
      routeFrom: order.routeFrom ?? "",
      routeTo: order.routeTo ?? "",
      price: order.price ?? null,
      agreedPrice: order.agreedPrice ?? null,
      isPaid: Boolean(order.isPaid),
      createdAt: order.createdAt ?? new Date(0),
      deadline: order.deadline ?? null,
      routeId: order.routeId ?? null,
      driverName: order.driver?.name ?? null,
    })),
    photos,
  }
}

/** Поля клиента, которые можно записать (белый список — тело запроса не идёт в data спредом). */
export function pickClientFields(input: Record<string, unknown>): {
  data: Record<string, unknown>
  errors: string[]
} {
  const data: Record<string, unknown> = {}
  const errors: string[] = []

  const text = (value: unknown): string | null => {
    if (value === null || value === undefined) return null
    if (typeof value !== "string") return null
    const trimmed = value.replace(/\s+/g, " ").trim()
    return trimmed === "" ? null : trimmed.slice(0, 500)
  }

  if ("name" in input) {
    const name = cleanClientName(input.name)
    if (!name) errors.push("Название клиента не может быть пустым")
    else data.name = name
  }

  if ("inn" in input) {
    const raw = text(input.inn)
    data.inn = raw ? normalizeInn(raw) : null
  }
  if ("kpp" in input) {
    const raw = text(input.kpp)
    data.kpp = raw ? normalizeKpp(raw) : null
  }

  for (const field of ["address", "contactName", "email", "notes"] as const) {
    if (field in input) data[field] = text(input[field])
  }

  if ("phone" in input) {
    const raw = text(input.phone)
    data.phone = raw ? normalizePhone(raw) : null
  }

  if ("paymentType" in input) {
    const raw = text(input.paymentType)
    data.paymentType = raw ? normalizePaymentType(raw) ?? raw : null
  }

  if ("vatType" in input) {
    const raw = text(input.vatType)
    data.vatType = raw ? normalizeVatType(raw) ?? raw : null
  }

  if ("deferredDays" in input) {
    const raw = input.deferredDays
    if (raw === null || raw === "" || raw === undefined) data.deferredDays = null
    else {
      const days = normalizeDeferredDays(raw)
      if (days === null) errors.push("Отсрочка указывается числом дней (0–365)")
      else data.deferredDays = days
    }
  }

  return { data, errors }
}

/** Создание клиента вручную. Дубликат по названию — понятная ошибка, а не второй ряд. */
export async function createClient(params: {
  organizationId: string
  input: Record<string, unknown>
}): Promise<
  | { ok: true; client: ClientRecord }
  | { ok: false; code: "invalid" | "duplicate"; error: string; errors?: string[] }
> {
  const { organizationId, input } = params
  const { data, errors } = pickClientFields(input)

  if (errors.length > 0) return { ok: false, code: "invalid", error: errors.join("; "), errors }
  if (typeof data.name !== "string") {
    return { ok: false, code: "invalid", error: "Название клиента обязательно" }
  }

  const nameKey = clientNameKey(data.name)
  if (!nameKey) {
    return { ok: false, code: "invalid", error: "Название состоит только из правовой формы — уточните" }
  }

  const existing = await prisma.client.findFirst({
    where: scopedWhere(organizationId, { nameKey }),
    select: { id: true, name: true },
  })
  if (existing) {
    return {
      ok: false,
      code: "duplicate",
      error: `Клиент «${existing.name}» уже есть в базе`,
    }
  }

  const client = (await prisma.client.create({
    data: { ...data, organizationId, nameKey, source: "manual" },
    select: CLIENT_SELECT,
  })) as ClientRecord

  return { ok: true, client }
}

/** Правка карточки. Переименование проверяем на дубликат. */
export async function updateClient(params: {
  organizationId: string
  clientId: string
  input: Record<string, unknown>
}): Promise<
  | { ok: true; client: ClientRecord }
  | { ok: false; code: "not_found" | "invalid" | "duplicate"; error: string }
> {
  const { organizationId, clientId, input } = params

  const current = await prisma.client.findFirst({
    where: scopedWhere(organizationId, { id: clientId }),
    select: { id: true, name: true, nameKey: true },
  })
  if (!current) return { ok: false, code: "not_found", error: "Клиент не найден" }

  const { data, errors } = pickClientFields(input)
  if (errors.length > 0) return { ok: false, code: "invalid", error: errors.join("; ") }

  if (typeof data.name === "string") {
    const nameKey = clientNameKey(data.name)
    if (!nameKey) {
      return { ok: false, code: "invalid", error: "Название состоит только из правовой формы — уточните" }
    }

    const duplicate = await prisma.client.findFirst({
      where: scopedWhere(organizationId, { nameKey }),
      select: { id: true, name: true },
    })
    if (duplicate && duplicate.id !== clientId) {
      return { ok: false, code: "duplicate", error: `Клиент «${duplicate.name}» уже есть в базе` }
    }

    data.nameKey = nameKey
  }

  // org-audit: ok — карточка найдена выше через scopedWhere(organizationId)
  const client = (await prisma.client.update({
    where: { id: clientId },
    data,
    select: CLIENT_SELECT,
  })) as ClientRecord

  return { ok: true, client }
}

/** Удаление возможно, только если за клиентом нет заказов: иначе порвётся история. */
export async function deleteClient(params: {
  organizationId: string
  clientId: string
}): Promise<{ ok: true } | { ok: false; code: "not_found" | "has_orders"; error: string; ordersCount?: number }> {
  const { organizationId, clientId } = params

  const client = await prisma.client.findFirst({
    where: scopedWhere(organizationId, { id: clientId }),
    select: { id: true },
  })
  if (!client) return { ok: false, code: "not_found", error: "Клиент не найден" }

  const ordersCount = await prisma.order.count({
    where: scopedWhere(organizationId, { clientId }),
  })
  if (ordersCount > 0) {
    return {
      ok: false,
      code: "has_orders",
      error: `У клиента ${ordersCount} заказов — сначала переназначьте их другому клиенту`,
      ordersCount,
    }
  }

  // org-audit: ok — карточка найдена выше через scopedWhere(organizationId)
  await prisma.client.delete({ where: { id: clientId } })
  return { ok: true }
}

/** Данные для предпросмотра импорта: существующие клиенты и их заполненные поля. */
async function loadImportContext(organizationId: string) {
  const clients = (await prisma.client.findMany({
    where: scopedWhere(organizationId, {}),
    select: {
      id: true,
      name: true,
      nameKey: true,
      inn: true,
      kpp: true,
      address: true,
      contactName: true,
      phone: true,
      email: true,
      paymentType: true,
      vatType: true,
      deferredDays: true,
      notes: true,
    },
  })) as (ClientRecord & { nameKey: string })[]

  const values: Record<string, Partial<Record<ImportField, string | number | null>>> = {}
  for (const client of clients) {
    const filled: Partial<Record<ImportField, string | number | null>> = {}
    for (const field of IMPORT_FIELDS) {
      const value = (client as unknown as Record<string, unknown>)[field]
      filled[field] = (value ?? null) as string | number | null
    }
    values[client.id] = filled
  }

  return { clients, values }
}

/** Предпросмотр импорта: что распознано и что будет сделано. */
export async function previewClientImport(params: {
  organizationId: string
  text: string
  delimiter?: string
  headerRow?: number
  mapping?: Partial<Record<ImportField, number>>
  mode?: ImportMode
}): Promise<{ preview: ImportPreview; plan: ImportPlan }> {
  const { organizationId, text, mode = "merge" } = params
  const { clients, values } = await loadImportContext(organizationId)

  const preview = buildImportPreview({
    text,
    existing: clients.map((client) => ({ id: client.id, name: client.name, nameKey: client.nameKey })),
    delimiter: params.delimiter,
    headerRow: params.headerRow,
    mapping: params.mapping,
  })

  return { preview, plan: planImport(preview, mode, values) }
}

export type ImportResult = {
  created: number
  updated: number
  skipped: number
  /** Сколько заказов привязано к карточкам по совпадению названия. */
  linkedOrders: number
  plan: ImportPlan
}

/**
 * Импорт клиентской базы.
 *
 * Помимо самих карточек, импорт приводит в порядок уже существующие заказы:
 * заказы, у которых клиент записан только именем (Order.clientName), привязываются
 * к карточке по тем же правилам сравнения названий. Так база «раскладывается по
 * своим местам»: у клиента сразу появляется история заказов.
 */
export async function importClients(params: {
  organizationId: string
  text: string
  mode?: ImportMode
  delimiter?: string
  headerRow?: number
  mapping?: Partial<Record<ImportField, number>>
}): Promise<{ result: ImportResult; preview: ImportPreview }> {
  const { organizationId, text, mode = "merge" } = params

  const { preview, plan } = await previewClientImport({ ...params, organizationId, text, mode })

  let created = 0
  let updated = 0

  for (const row of plan.rows) {
    if (row.action === "skip") continue

    const data: Record<string, unknown> = { source: "import" }
    for (const field of IMPORT_FIELDS) {
      const value = row.fields[field]
      if (value === null || value === undefined || value === "") continue
      if (field === "name" && row.action === "update") continue
      data[field] = value
    }

    if (row.action === "create") {
      const name = typeof row.fields.name === "string" ? row.fields.name : null
      if (!name) continue
      const nameKey = clientNameKey(name)
      if (!nameKey) continue

      await prisma.client.create({
        data: { ...data, name, nameKey, organizationId },
      })
      created += 1
      continue
    }

    if (row.action === "update" && row.existingClientId) {
      // обновляем только те поля, которые у клиента пусты (проверено в planImport)
      const patch: Record<string, unknown> = { source: "import" }
      for (const field of row.changedFields) {
        const value = row.fields[field]
        if (value === null || value === undefined || value === "") continue
        patch[field] = value
      }

      // org-audit: ok — clientId получен из своих карточек (loadImportContext через scopedWhere)
      await prisma.client.update({ where: { id: row.existingClientId }, data: patch })
      updated += 1
    }
  }

  // Привязка заказов: имя клиента в заказе → карточка
  const clients = (await prisma.client.findMany({
    where: scopedWhere(organizationId, {}),
    select: { id: true, name: true },
  })) as { id: string; name: string }[]

  const orders = (await prisma.order.findMany({
    where: scopedWhere(organizationId, { clientId: null }),
    select: { id: true, clientName: true },
  })) as { id: string; clientName: string | null }[]

  const links = matchOrdersToClients(orders, clients)
  for (const link of links) {
    await prisma.order.updateMany({
      where: scopedWhere(organizationId, { id: link.orderId, clientId: null }),
      data: { clientId: link.clientId },
    })
  }

  return {
    result: {
      created,
      updated,
      skipped: plan.summary.skip,
      linkedOrders: links.length,
      plan,
    },
    preview,
  }
}

/**
 * Привязать только что созданный заказ к карточке клиента по имени.
 * Вызывается из мест, где заказ появляется (POST /api/orders, сборка рейса),
 * поэтому дальше история клиента собирается сама.
 */
export async function linkOrderToClientByName(params: {
  organizationId: string
  orderId: string
  clientName: string | null | undefined
}): Promise<string | null> {
  const { organizationId, orderId, clientName } = params
  const nameKey = clientNameKey(clientName ?? "")
  if (!nameKey) return null

  const client = await prisma.client.findFirst({
    where: scopedWhere(organizationId, { nameKey }),
    select: { id: true },
  })
  if (!client) return null

  await prisma.order.updateMany({
    where: scopedWhere(organizationId, { id: orderId, clientId: null }),
    data: { clientId: client.id },
  })

  return client.id
}
