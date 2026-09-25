// lib/documents/load.ts
//
// Загрузка данных рейса для печати документов (задача 3, пункт 3).
//
// Рейс, его заказы, машина, водитель и реквизиты организации читаются ТОЛЬКО
// в границах проверенной организации: чужой рейс не откроется, реквизиты и
// заказы другой организации в документы не попадут.

import { prisma } from "@/lib/prisma"
import { scopedWhere } from "@/lib/org"

import { buildRouteDocuments } from "./build"
import type {
  CarrierRequisites,
  DocumentKind,
  DocumentOrder,
  DocumentRoute,
  PrintDocument,
} from "./types"

export type RouteDocumentsResult =
  | {
      ok: true
      documents: PrintDocument[]
      route: { id: string; name: string | null; ordersCount: number }
    }
  | { ok: false; error: "route_not_found" }

function requisitesFromSettings(
  settings: {
    parkName: string | null
    legalName: string | null
    inn: string | null
    kpp: string | null
    ogrn: string | null
    legalAddress: string | null
    phone: string | null
    email: string | null
    bankName: string | null
    bankBic: string | null
    bankAccount: string | null
    signerName: string | null
    signerPosition: string | null
  } | null,
  organizationName: string,
): CarrierRequisites {
  return {
    // Название организации есть всегда; реквизиты заполняются в настройках
    name: settings?.parkName?.trim() || organizationName,
    legalName: settings?.legalName ?? null,
    inn: settings?.inn ?? null,
    kpp: settings?.kpp ?? null,
    ogrn: settings?.ogrn ?? null,
    legalAddress: settings?.legalAddress ?? null,
    phone: settings?.phone ?? null,
    email: settings?.email ?? null,
    bankName: settings?.bankName ?? null,
    bankBic: settings?.bankBic ?? null,
    bankAccount: settings?.bankAccount ?? null,
    signerName: settings?.signerName ?? null,
    signerPosition: settings?.signerPosition ?? null,
  }
}

/**
 * Документы рейса для печати.
 * `kinds` — выбранные галочками виды (ТТН / путевой лист / договор-заявка).
 */
/** Фактический пробег рейса по одометрам: оба значения нужны и конец > начала. */
function tripDistanceKm(start: number | null | undefined, end: number | null | undefined): number | null {
  if (typeof start !== "number" || typeof end !== "number") return null
  const diff = end - start
  return diff > 0 ? diff : null
}

export async function loadRouteDocuments(params: {
  organizationId: string
  routeId: string
  kinds: DocumentKind[]
}): Promise<RouteDocumentsResult> {
  const { organizationId, routeId, kinds } = params

  const route = await prisma.route.findFirst({
    where: scopedWhere(organizationId, { id: routeId }),
    select: {
      id: true,
      name: true,
      status: true,
      notes: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      totalDistance: true,
      startOdometer: true,
      endOdometer: true,
      totalCost: true,
      fuelExpense: true,
      cargoWeight: true,
      driver: { select: { name: true, phone: true } },
      vehicle: {
        select: { plate: true, type: true, brand: true, model: true, capacity: true },
      },
    },
  })

  if (!route) return { ok: false, error: "route_not_found" }

  const orders = await prisma.order.findMany({
    where: scopedWhere(organizationId, { routeId }),
    orderBy: [{ routeSequence: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      routeFrom: true,
      routeTo: true,
      cargoType: true,
      weight: true,
      volume: true,
      price: true,
      agreedPrice: true,
      clientName: true,
      clientContact: true,
      paymentType: true,
      vatType: true,
      deferredDays: true,
      deadline: true,
      requirements: true,
    },
  })

  const settings = await prisma.fleetSettings.findFirst({
    where: scopedWhere(organizationId),
    select: {
      parkName: true,
      baseAddress: true,
      legalName: true,
      inn: true,
      kpp: true,
      ogrn: true,
      legalAddress: true,
      phone: true,
      email: true,
      bankName: true,
      bankBic: true,
      bankAccount: true,
      signerName: true,
      signerPosition: true,
    },
  })

  // org-audit: manual — читается сама организация вызывающего (по её же id из сессии), только название для печати
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId },
    select: { name: true },
  })

  const documentOrders: DocumentOrder[] = orders.map((order) => ({
    id: order.id,
    routeFrom: order.routeFrom,
    routeTo: order.routeTo,
    cargoType: order.cargoType,
    weightKg: order.weight ?? 0,
    volumeM3: order.volume ?? null,
    priceRub: order.price ?? null,
    agreedPriceRub: order.agreedPrice ?? null,
    clientName: order.clientName ?? null,
    clientContact: order.clientContact ?? null,
    paymentType: order.paymentType ?? null,
    vatType: order.vatType ?? null,
    deferredDays: order.deferredDays ?? null,
    deadline: order.deadline ?? null,
    notes: order.requirements ?? null,
  }))

  const documentRoute: DocumentRoute = {
    id: route.id,
    name: route.name ?? null,
    status: route.status,
    startedAt: route.startedAt ?? null,
    completedAt: route.completedAt ?? null,
    createdAt: route.createdAt ?? new Date(),
    totalDistanceKm: route.totalDistance ?? null,
    // Путевой лист требует факт, а не план: если водитель записал одометр
    // (начало и конец рейса), показываем реальный пробег
    tripDistanceKm: tripDistanceKm(route.startOdometer, route.endOdometer),
    totalCostRub: route.totalCost ?? null,
    fuelExpenseRub: route.fuelExpense ?? null,
    cargoWeightKg: route.cargoWeight ?? null,
    notes: route.notes ?? null,
    baseAddress: settings?.baseAddress ?? null,
    orders: documentOrders,
    crew: {
      vehiclePlate: route.vehicle?.plate ?? null,
      vehicleType: route.vehicle?.type ?? null,
      vehicleBrand: route.vehicle?.brand ?? null,
      vehicleModel: route.vehicle?.model ?? null,
      vehicleCapacityKg: route.vehicle?.capacity ?? null,
      driverName: route.driver?.name ?? null,
      driverPhone: route.driver?.phone ?? null,
    },
  }

  return {
    ok: true,
    documents: buildRouteDocuments({
      route: documentRoute,
      carrier: requisitesFromSettings(settings, organization?.name ?? "Перевозчик"),
      kinds,
    }),
    route: { id: route.id, name: route.name ?? null, ordersCount: documentOrders.length },
  }
}
