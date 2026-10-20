// lib/fleet/archive-policy.ts
//
// Чистая политика для водителя и машины (этап «сохранность данных»).
// Без Prisma и без Next — тестируется отдельно от обработчиков.
//
// Правило (согласовано с владельцем продукта): физическое удаление допустимо
// только если у объекта нет НИ ОДНОЙ связанной исторической записи. Если
// история есть — архив: карточка скрыта из выбора и назначения, но смены,
// рейсы, SOS, фото, ТО и топливо остаются доступными.

export type DriverHistoryCounts = {
  shifts: number
  shiftEvents: number
  sosAlerts: number
  photos: number
  routeEvents: number
}

export type VehicleHistoryCounts = {
  maintenanceLogs: number
  routes: number
  orders: number
  routeEvents: number
  stages: number
}

export type RemovalDecision = { action: "archive" } | { action: "delete" }

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0)

export function decideDriverRemoval(history: DriverHistoryCounts): RemovalDecision {
  const total = sum([
    history.shifts,
    history.shiftEvents,
    history.sosAlerts,
    history.photos,
    history.routeEvents,
  ])
  return total > 0 ? { action: "archive" } : { action: "delete" }
}

export function decideVehicleRemoval(history: VehicleHistoryCounts): RemovalDecision {
  const total = sum([
    history.maintenanceLogs,
    history.routes,
    history.orders,
    history.routeEvents,
    history.stages,
  ])
  return total > 0 ? { action: "archive" } : { action: "delete" }
}
