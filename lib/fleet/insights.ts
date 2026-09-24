// lib/fleet/insights.ts
//
// Практика вместо «процента загрузки автопарка» (задача 4).
//
// Прежний процент считался как «машины в рейсе / все машины» и ничего не решал:
// он не отвечал на вопросы, с которыми логист приходит на страницу автопарка.
// Здесь считаются три вещи, по которым принимают решения:
//
//   1. какие машины простаивают и сколько дней;
//   2. что пора обслужить: ТО, страховка, техосмотр, открытые работы;
//   3. кто из водителей на какой машине ездил — история назначений.
//
// Модуль чистый: ни Prisma, ни Next.js — данные приходят аргументами, поэтому
// логика проверяется тестами без базы (tests/fleet-insights.test.mjs).

/** За сколько дней предупреждаем о ТО/страховке по умолчанию. */
export const SERVICE_WARNING_DAYS = 30

/** Сколько последних назначений показываем по машине. */
export const ASSIGNMENT_HISTORY_LIMIT = 10

export type ServiceKind = "maintenance" | "insurance" | "inspection"

export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  maintenance: "ТО",
  insurance: "Страховка",
  inspection: "Техосмотр",
}

export type ServiceStatus = "overdue" | "today" | "soon"

export type FleetVehicleInput = {
  id: string
  plate: string
  type: string
  brand?: string | null
  model?: string | null
  status: string
  mileage?: number | null
  lastMaintenanceDate?: Date | null
  nextMaintenanceDate?: Date | null
  insuranceExpiry?: Date | null
  inspectionExpiry?: Date | null
  createdAt?: Date | null
}

export type FleetDriverInput = {
  id: string
  name: string
  vehicleId: string | null
  status: string
}

/** Заказ, занимающий машину прямо сейчас. */
export type FleetActiveOrderInput = {
  id: string
  assignedVehicleId: string | null
  assignedDriverId: string | null
  routeFrom: string
  routeTo: string
  status: string
  deadline?: Date | null
}

export type FleetRouteInput = {
  id: string
  name: string | null
  vehicleId: string | null
  driverId: string | null
  status: string
  createdAt: Date
  startedAt?: Date | null
  completedAt?: Date | null
}

export type FleetMaintenanceInput = {
  id: string
  vehicleId: string
  type: string
  description: string
  status: string
  startedAt: Date
  completedAt?: Date | null
}

export type IdleVehicle = {
  vehicleId: string
  plate: string
  type: string
  driverName: string | null
  /** Сколько дней машина без рейса. */
  idleDays: number
  /** Когда машина последний раз работала (или когда её завели в систему). */
  lastWorkAt: Date | null
  /** Заказ, который сейчас на машине, — иначе null (машина как раз простаивает). */
  activeOrder: { id: string; route: string; status: string } | null
}

export type ServiceWarning = {
  vehicleId: string
  plate: string
  kind: ServiceKind
  title: string
  date: Date
  daysLeft: number
  status: ServiceStatus
}

export type OpenMaintenance = {
  vehicleId: string
  plate: string
  type: string
  description: string
  startedAt: Date
  /** Сколько дней работа идёт. */
  daysOpen: number
}

export type VehicleAssignment = {
  routeId: string
  routeName: string | null
  driverId: string | null
  driverName: string | null
  startedAt: Date | null
  completedAt: Date | null
  status: string
  /** Машина работает по этому рейсу прямо сейчас. */
  isActive: boolean
}

export type FleetInsights = {
  /** Сколько машина простаивает, дней: последний рейс или дата постановки на учёт. */
  idle: IdleVehicle[]
  service: ServiceWarning[]
  openMaintenance: OpenMaintenance[]
  history: Record<string, VehicleAssignment[]>
  summary: {
    vehicles: number
    working: number
    idle: number
    /** Из простаивающих — дольше недели. */
    idleOverWeek: number
    serviceSoon: number
    serviceOverdue: number
    openMaintenance: number
    /** Всего предупреждений об обслуживании (то же, что service.length). */
    service: number
  }
}

function startOfDay(value: Date): Date {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

/** Целых дней между датами (по календарным суткам, а не по часам). */
export function daysBetween(from: Date, to: Date): number {
  const diff = startOfDay(to).getTime() - startOfDay(from).getTime()
  return Math.round(diff / (24 * 60 * 60 * 1000))
}

/** Состояние даты: просрочено, сегодня, скоро (в пределах warnDays). */
export function serviceStatus(date: Date, now: Date, warnDays = SERVICE_WARNING_DAYS): ServiceStatus | null {
  const daysLeft = daysBetween(now, date)

  if (daysLeft < 0) return "overdue"
  if (daysLeft === 0) return "today"
  if (daysLeft <= warnDays) return "soon"
  return null
}

/** Ближайшая из дат срабатывания по машине — то, что логист должен увидеть. */
function serviceWarningsFor(
  vehicle: FleetVehicleInput,
  now: Date,
  warnDays: number,
): ServiceWarning[] {
  const dates: { kind: ServiceKind; date: Date | null | undefined }[] = [
    { kind: "maintenance", date: vehicle.nextMaintenanceDate },
    { kind: "insurance", date: vehicle.insuranceExpiry },
    { kind: "inspection", date: vehicle.inspectionExpiry },
  ]

  const warnings: ServiceWarning[] = []

  for (const { kind, date } of dates) {
    if (!date) continue
    const status = serviceStatus(date, now, warnDays)
    if (!status) continue

    warnings.push({
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      kind,
      title: SERVICE_KIND_LABELS[kind],
      date,
      daysLeft: daysBetween(now, date),
      status,
    })
  }

  return warnings
}

export function buildFleetInsights(input: {
  vehicles: FleetVehicleInput[]
  drivers: FleetDriverInput[]
  activeOrders: FleetActiveOrderInput[]
  routes: FleetRouteInput[]
  maintenance: FleetMaintenanceInput[]
  now?: Date
  warningDays?: number
  historyLimit?: number
}): FleetInsights {
  const {
    vehicles,
    drivers,
    activeOrders,
    routes,
    maintenance,
    now = new Date(),
    warningDays = SERVICE_WARNING_DAYS,
    historyLimit = ASSIGNMENT_HISTORY_LIMIT,
  } = input

  const driverById = new Map(drivers.map((driver) => [driver.id, driver]))
  // связь «водитель ↔ машина» хранится в Driver.vehicleId (lib/fleet/assignment.ts)
  const driverByVehicle = new Map<string, FleetDriverInput>()
  for (const driver of drivers) {
    if (driver.vehicleId) driverByVehicle.set(driver.vehicleId, driver)
  }

  const activeOrderByVehicle = new Map<string, FleetActiveOrderInput>()
  for (const order of activeOrders) {
    if (order.assignedVehicleId && !activeOrderByVehicle.has(order.assignedVehicleId)) {
      activeOrderByVehicle.set(order.assignedVehicleId, order)
    }
  }

  // Последний рейс машины: по нему считается простой
  const lastRouteByVehicle = new Map<string, FleetRouteInput>()
  for (const route of routes) {
    if (!route.vehicleId) continue
    const current = lastRouteByVehicle.get(route.vehicleId)
    const routeDate = route.completedAt ?? route.startedAt ?? route.createdAt
    const currentDate = current
      ? current.completedAt ?? current.startedAt ?? current.createdAt
      : null
    if (!current || !currentDate || routeDate.getTime() > currentDate.getTime()) {
      lastRouteByVehicle.set(route.vehicleId, route)
    }
  }

  // История назначений: последние рейсы машины, свежие — первыми
  const history: Record<string, VehicleAssignment[]> = {}
  const sortedRoutes = [...routes].sort((a, b) => {
    const aDate = a.startedAt ?? a.createdAt
    const bDate = b.startedAt ?? b.createdAt
    return bDate.getTime() - aDate.getTime()
  })

  for (const route of sortedRoutes) {
    if (!route.vehicleId) continue
    const list = history[route.vehicleId] ?? []
    if (list.length >= historyLimit) continue

    list.push({
      routeId: route.id,
      routeName: route.name,
      driverId: route.driverId,
      driverName: route.driverId ? driverById.get(route.driverId)?.name ?? null : null,
      startedAt: route.startedAt ?? null,
      completedAt: route.completedAt ?? null,
      status: route.status,
      isActive: route.status === "active" && !route.completedAt,
    })

    history[route.vehicleId] = list
  }

  // Простаивающие машины: на ТО не считаем простоем, работающие — по активному заказу
  const idle: IdleVehicle[] = []
  let working = 0

  for (const vehicle of vehicles) {
    const activeOrder = activeOrderByVehicle.get(vehicle.id) ?? null

    if (vehicle.status === "maintenance" || vehicle.status === "in_use") {
      if (vehicle.status === "in_use" || activeOrder) working += 1
      // на ТО машина не «простаивает»: она в ремонте, это отдельный блок
      continue
    }

    if (activeOrder) {
      working += 1
      continue
    }

    const lastRoute = lastRouteByVehicle.get(vehicle.id) ?? null
    const lastWorkAt = lastRoute
      ? lastRoute.completedAt ?? lastRoute.startedAt ?? lastRoute.createdAt
      : vehicle.createdAt ?? null

    idle.push({
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      type: vehicle.type,
      driverName: driverByVehicle.get(vehicle.id)?.name ?? null,
      idleDays: lastWorkAt ? Math.max(0, daysBetween(lastWorkAt, now)) : 0,
      lastWorkAt,
      activeOrder: null,
    })
  }

  // Дольше простаивает — выше в списке
  idle.sort((a, b) => b.idleDays - a.idleDays)

  const service = vehicles
    .flatMap((vehicle) => serviceWarningsFor(vehicle, now, warningDays))
    .sort((a, b) => a.daysLeft - b.daysLeft)

  const openMaintenance: OpenMaintenance[] = maintenance
    .filter((log) => log.status === "in_progress" && !log.completedAt)
    .map((log) => ({
      vehicleId: log.vehicleId,
      plate: vehicles.find((vehicle) => vehicle.id === log.vehicleId)?.plate ?? "—",
      type: log.type,
      description: log.description,
      startedAt: log.startedAt,
      daysOpen: Math.max(0, daysBetween(log.startedAt, now)),
    }))
    .sort((a, b) => b.daysOpen - a.daysOpen)

  return {
    idle,
    service,
    openMaintenance,
    history,
    summary: {
      vehicles: vehicles.length,
      working,
      idle: idle.length,
      idleOverWeek: idle.filter((item) => item.idleDays > 7).length,
      serviceSoon: service.filter((item) => item.status === "soon").length,
      serviceOverdue: service.filter((item) => item.status !== "soon").length,
      openMaintenance: openMaintenance.length,
      service: service.length,
    },
  }
}
