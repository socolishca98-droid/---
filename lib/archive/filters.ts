// lib/archive/filters.ts
//
// Единое условие «только неархивные записи» (этап «сохранность данных»).
//
// Зачем модуль: архивные заказы, водители и машины скрыты из рабочих списков,
// карты, выбора и назначения, но остаются в деньгах и истории. Если фильтр
// размазать по обработчикам строкой "archivedAt: null", его легко пропустить
// или потерять при рефакторинге — поэтому одно имя на весь проект.

import type { Prisma } from "@prisma/client"

/** Условие для where: запись не в архиве. */
export const NOT_ARCHIVED = { archivedAt: null } as const

/**
 * То же, но для вложенных where (например, связи orders внутри рейса):
 * возвращает новый объект, чтобы не мутировать переданное условие.
 */
export function withNotArchived<T extends Prisma.OrderWhereInput>(
  where: T,
): T & { archivedAt: null } {
  return { ...where, archivedAt: null }
}
