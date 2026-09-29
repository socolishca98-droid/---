// lib/maintenance/schedule.ts
//
// Сроки обслуживания машин: ТО, страховка, техосмотр. Чистые функции —
// их используют API /api/maintenance, страница обслуживания и тесты.

/** За сколько дней до даты срок считается «скоро». */
export const SOON_DAYS = 30

export type DeadlineStatus = "expired" | "soon" | "ok"

export interface Deadline {
  status: DeadlineStatus
  /** Целое число дней до даты; отрицательное — просрочка. */
  daysLeft: number
  /** ISO-дата для UI. */
  date: string
}

export const DEADLINE_STATUS_LABELS: Record<DeadlineStatus, string> = {
  expired: "Просрочено",
  soon: "Скоро",
  ok: "В порядке",
}

function startOfDay(value: Date): number {
  const copy = new Date(value)
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

/** Статус срока: просрочен / скоро (≤ soonDays) / в порядке. Без даты — null. */
export function deadlineStatus(
  date: Date | string | null | undefined,
  now: Date,
  soonDays: number = SOON_DAYS,
): Deadline | null {
  if (!date) return null
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return null
  const daysLeft = Math.round((startOfDay(parsed) - startOfDay(now)) / 86_400_000)
  const status: DeadlineStatus = daysLeft < 0 ? "expired" : daysLeft <= soonDays ? "soon" : "ok"
  return { status, daysLeft, date: parsed.toISOString() }
}

export interface VehicleDeadlineFields {
  nextMaintenanceDate?: Date | string | null
  insuranceExpiry?: Date | string | null
  inspectionExpiry?: Date | string | null
}

export interface VehicleDeadlines {
  maintenance: Deadline | null
  insurance: Deadline | null
  inspection: Deadline | null
  /** Худший из трёх статусов — для сортировки и цвета карточки. */
  worst: DeadlineStatus | null
}

const SEVERITY: Record<DeadlineStatus, number> = { expired: 2, soon: 1, ok: 0 }

/** Все сроки одной машины + худший статус. */
export function vehicleDeadlines(vehicle: VehicleDeadlineFields, now: Date): VehicleDeadlines {
  const maintenance = deadlineStatus(vehicle.nextMaintenanceDate, now)
  const insurance = deadlineStatus(vehicle.insuranceExpiry, now)
  const inspection = deadlineStatus(vehicle.inspectionExpiry, now)
  let worst: DeadlineStatus | null = null
  for (const deadline of [maintenance, insurance, inspection]) {
    if (deadline && (worst === null || SEVERITY[deadline.status] > SEVERITY[worst])) {
      worst = deadline.status
    }
  }
  return { maintenance, insurance, inspection, worst }
}

export interface MaintenanceLogLike {
  cost?: number | null
  status?: string | null
}

export interface MaintenanceTotals {
  count: number
  inProgress: number
  costRub: number
}

/** Итоги по записям обслуживания: сколько всего, в работе и на какую сумму. */
export function maintenanceTotals(logs: readonly MaintenanceLogLike[]): MaintenanceTotals {
  let costRub = 0
  let inProgress = 0
  for (const log of logs) {
    if (log.cost !== null && log.cost !== undefined && Number.isFinite(log.cost)) {
      costRub += Number(log.cost)
    }
    if (log.status === "in_progress") inProgress += 1
  }
  return { count: logs.length, inProgress, costRub: Math.round(costRub) }
}
