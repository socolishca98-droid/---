// lib/routes/route-points.ts
//
// Точки маршрута рейса для карты: в каком порядке их объезжать.
//
// Зачем отдельный чистый модуль: порядок точек решает, как выглядит нить на
// карте и сколько в ней километров. Раньше точки брались по дате создания
// заказов, и получался зигзаг: «Тула → Воронеж», потом «Москва → Воронеж» —
// машина на карте ехала назад, а пробег завышался в разы (Москва — Воронеж
// показывало 2228 км вместо ~525). Здесь точки идут по порядку объезда
// (routeSequence), подряд идущие дубли убираются, база всегда последняя.
//
// Модуль чистый (без БД и Next) — его проверяют юнит-тесты
// tests/routes-route-points.test.mjs.

/** Точка на карте. Локальный тип — модуль должен собираться без Next-алиасов. */
export interface Coordinates {
  lat: number
  lng: number
}

/** Минимум о заказе, нужный для порядка точек. */
export interface RoutePointOrder {
  routeFrom: string
  routeTo: string
  /** Порядок точки в рейсе: 1, 2, 3… Может быть null у старых заказов. */
  routeSequence?: number | null
  /** Дата создания — запасной признак порядка, если routeSequence нет. */
  createdAt?: Date | null
}

export interface RoutePointsInput {
  orders: readonly RoutePointOrder[]
  /** Текущая позиция водителя: если есть, маршрут начинается от неё. */
  driverPoint?: Coordinates | null
  /** База (автопарк): рейс возвращается в неё — она последняя точка. */
  basePoint: Coordinates
  /** Координаты адреса: адрес → точка. Неизвестный адрес — null. */
  pointOf: (address: string) => Coordinates | null
}

/** Одинаковые ли точки (с точностью до 5 знаков ≈ 1 м). */
function samePoint(a: Coordinates, b: Coordinates): boolean {
  return (
    Math.abs(a.lat - b.lat) < 1e-5 &&
    Math.abs(a.lng - b.lng) < 1e-5
  )
}

/**
 * Заказы в порядке объезда: сначала по routeSequence (номеру точки рейса),
 * затем по дате создания. Заказы без номера идут последними — их порядок
 * неизвестен, выдумывать его нельзя.
 */
export function sortOrdersByRouteSequence<T extends RoutePointOrder>(
  orders: readonly T[],
): T[] {
  return [...orders].sort((a, b) => {
    const aSeq = typeof a.routeSequence === "number" ? a.routeSequence : null
    const bSeq = typeof b.routeSequence === "number" ? b.routeSequence : null
    if (aSeq !== null && bSeq !== null && aSeq !== bSeq) return aSeq - bSeq
    if (aSeq !== null && bSeq === null) return -1
    if (aSeq === null && bSeq !== null) return 1
    const aTime = a.createdAt?.getTime() ?? 0
    const bTime = b.createdAt?.getTime() ?? 0
    return aTime - bTime
  })
}

/**
 * Точки маршрута по порядку: [водитель?, …погрузки и выгрузки…, база].
 *
 * Подряд идущие повторы убираются: выгрузка одного заказа и погрузка
 * следующего — часто один и тот же город, и без склейки OSRM строит
 * «петлю» на месте, накручивая километры.
 */
export function buildRoutePoints(input: RoutePointsInput): Coordinates[] {
  const ordered = sortOrdersByRouteSequence(input.orders)
  const points: Coordinates[] = []

  const push = (point: Coordinates | null) => {
    if (!point) return
    const last = points[points.length - 1]
    if (last && samePoint(last, point)) return
    points.push(point)
  }

  if (input.driverPoint) push(input.driverPoint)
  for (const order of ordered) {
    push(input.pointOf(order.routeFrom))
    push(input.pointOf(order.routeTo))
  }
  // База — последняя точка: рейс возвращается в автопарк. Если последняя
  // точка уже есть база (завершение у парка), повтор не добавляем.
  push(input.basePoint)

  return points
}
