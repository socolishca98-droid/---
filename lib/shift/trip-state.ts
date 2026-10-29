// lib/shift/trip-state.ts
//
// Состояние рейса по его точкам: что ещё открыто, что закрыто и выполнен ли
// рейс целиком.
//
// Зачем отдельный модуль: на главном экране водителя из этого считались сразу
// четыре разных вещи (активный заказ, наличие рейса, счётчик закрытых точек и
// прогресс), и каждая считалась по-своему. Из-за расхождения экран показывал
// «Вам назначен рейс · Начать рейс» на полностью выполненном рейсе, а кнопка
// молча ничего не делала — открытых точек уже не было.

import { isOrderClosed } from "../orders/stages"

export interface TripPointLike {
  status: string
}

export interface TripState<T extends TripPointLike> {
  /** Открытые точки — по ним идёт работа */
  open: T[]
  /** Закрытые точки — история рейса */
  closed: T[]
  /** Текущая точка рейса: первая открытая */
  active: T | null
  /** Есть незакрытые точки — рейс идёт */
  hasActiveTrip: boolean
  /** Точки есть, но все закрыты — рейс выполнен */
  finished: boolean
  /** Сколько процентов точек закрыто */
  progress: number
}

export function tripState<T extends TripPointLike>(points: readonly T[] | null | undefined): TripState<T> {
  const all = Array.isArray(points) ? points.filter(Boolean) : []
  const open: T[] = []
  const closed: T[] = []

  for (const point of all) {
    if (isOrderClosed(point.status)) closed.push(point)
    else open.push(point)
  }

  return {
    open,
    closed,
    active: open[0] ?? null,
    hasActiveTrip: open.length > 0,
    finished: all.length > 0 && open.length === 0,
    progress: all.length > 0 ? Math.round((closed.length / all.length) * 100) : 0,
  }
}
