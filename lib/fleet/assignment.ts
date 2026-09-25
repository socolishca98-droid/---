// lib/fleet/assignment.ts
//
// Единственное место, где пишется связь «водитель ↔ машина».
//
// До задачи 2 связь хранилась дважды: Driver.vehicleId и Vehicle.driverId.
// Поля расходились (в базе был водитель, закреплённый за машиной, у которой
// driverId = NULL), а кэш Driver.vehicleType/vehiclePlate устаревал при
// отвязке. Теперь:
//   * источник правды — Driver.vehicleId (relation Driver.vehicle → Vehicle);
//   * Vehicle.driverId удалён из схемы;
//   * Driver.vehicleType/vehiclePlate — производный кэш, который пишется
//     ТОЛЬКО через функции этого модуля.
//
// Любой код, который назначает или снимает машину, обязан вызывать эти
// функции, а не писать поля напрямую.

import { prisma } from "@/lib/prisma"

/**
 * Фильтр по организации для служебных запросов внутри этого модуля.
 * organizationId = null/undefined — данные без организации (нулевая), фильтр не добавляется.
 */
function scoped<T extends Record<string, unknown>>(
  organizationId: string | null | undefined,
  where: T,
): T {
  return organizationId == null ? where : ({ ...where, organizationId } as T)
}

/**
 * Клиент БД или клиент транзакции: нужны только делегаты driver/vehicle.
 * Тип выводится из самого prisma-клиента, поэтому работает и внутри
 * $transaction, и снаружи.
 */
export type FleetDb = Pick<typeof prisma, "driver" | "vehicle">

export type AssignmentResult = {
  driverId: string
  vehicleId: string | null
  vehiclePlate: string | null
  vehicleType: string | null
}

const selectDriverLink = {
  id: true,
  name: true,
  vehicleId: true,
  vehiclePlate: true,
  vehicleType: true,
} as const

/**
 * Обновляет кэш vehicleType/vehiclePlate у водителя по его текущей машине.
 * Вызывается после правки машины (сменили госномер/тип) и после назначения.
 */
export async function syncDriverVehicleCache(
  db: FleetDb,
  driverId: string,
  organizationId?: string | null,
): Promise<void> {
  const driver = await db.driver.findFirst({
    where: scoped(organizationId, { id: driverId }),
    select: { id: true, vehicleId: true },
  })
  if (!driver) return

  if (!driver.vehicleId) {
    await db.driver.updateMany({
      where: scoped(organizationId, { id: driverId }),
      data: { vehiclePlate: null, vehicleType: null },
    })
    return
  }

  const vehicle = await db.vehicle.findFirst({
    where: scoped(organizationId, { id: driver.vehicleId }),
    select: { plate: true, type: true },
  })

  // org-audit: ok — водитель найден выше через scoped(organizationId): чужая карточка не обновится
  await db.driver.update({
    where: { id: driverId },
    data: {
      vehiclePlate: vehicle?.plate ?? null,
      vehicleType: vehicle?.type ?? null,
    },
  })
}

/**
 * Проверяет, свободна ли машина. `exceptDriverId` — водитель, для которого
 * машина уже считается своей (повторное назначение не ошибка).
 */
export async function findVehicleOccupant(
  db: FleetDb,
  vehicleId: string,
  exceptDriverId?: string | null,
  organizationId?: string | null,
): Promise<{ id: string; name: string } | null> {
  const occupant = await db.driver.findFirst({
    where: scoped(organizationId, {
      vehicleId,
      ...(exceptDriverId ? { id: { not: exceptDriverId } } : {}),
    }),
    select: { id: true, name: true },
  })
  return occupant ? { id: occupant.id, name: occupant.name } : null
}

/**
 * Закрепляет машину за водителем (vehicleId = null — снимает).
 *
 * Гарантии:
 *   1. связь пишется один раз — в Driver.vehicleId;
 *   2. предыдущий водитель этой машины автоматически отвязывается
 *      (включая очистку кэша номеров/типа);
 *   3. кэш vehiclePlate/vehicleType всегда соответствует машине
 *      (при снятии — обнуляется, раньше оставался «призрачный» номер).
 */
export async function linkDriverToVehicle(
  db: FleetDb,
  driverId: string,
  vehicleId: string | null,
  organizationId?: string | null,
): Promise<AssignmentResult> {
  const driver = await db.driver.findFirst({
    where: scoped(organizationId, { id: driverId }),
    select: selectDriverLink,
  })
  if (!driver) throw new Error("Водитель не найден")

  if (!vehicleId) {
    // org-audit: ok — driverId проверен выше через scoped(organizationId)
    const updated = await db.driver.update({
      where: { id: driverId },
      data: { vehicleId: null, vehiclePlate: null, vehicleType: null },
      select: selectDriverLink,
    })
    return {
      driverId: updated.id,
      vehicleId: null,
      vehiclePlate: null,
      vehicleType: null,
    }
  }

  // Машину из чужой организации назначить нельзя: она просто «не найдена»
  const vehicle = await db.vehicle.findFirst({
    where: scoped(organizationId, { id: vehicleId }),
    select: { id: true, plate: true, type: true },
  })
  if (!vehicle) throw new Error("Машина не найдена")

  // машина может быть закреплена только за одним водителем
  const previous = await db.driver.findMany({
    where: scoped(organizationId, { vehicleId, id: { not: driverId } }),
    select: { id: true },
  })
  for (const p of previous) {
    await db.driver.updateMany({
      where: scoped(organizationId, { id: p.id }),
      data: { vehicleId: null, vehiclePlate: null, vehicleType: null },
    })
  }

  // org-audit: ok — driverId и vehicleId проверены выше через scoped(organizationId)
  const updated = await db.driver.update({
    where: { id: driverId },
    data: {
      vehicleId: vehicle.id,
      vehiclePlate: vehicle.plate,
      vehicleType: vehicle.type,
    },
    select: selectDriverLink,
  })

  return {
    driverId: updated.id,
    vehicleId: vehicle.id,
    vehiclePlate: updated.vehiclePlate,
    vehicleType: updated.vehicleType,
  }
}

/**
 * Отвязывает всех водителей от машины.
 * Нужна перед удалением машины и при переназначении: FK в базе обнулит
 * Driver.vehicleId, но кэш vehiclePlate/vehicleType без этой функции
 * останется устаревшим.
 */
export async function unlinkVehicle(
  db: FleetDb,
  vehicleId: string,
  organizationId?: string | null,
): Promise<number> {
  const drivers = await db.driver.findMany({
    where: scoped(organizationId, { vehicleId }),
    select: { id: true },
  })

  for (const driver of drivers) {
    await db.driver.updateMany({
      where: scoped(organizationId, { id: driver.id }),
      data: { vehicleId: null, vehiclePlate: null, vehicleType: null },
    })
  }

  return drivers.length
}

/**
 * Синхронизирует кэш номеров/типов у всех водителей, закреплённых за
 * перечисленными машинами. Вызывается после изменения данных машины.
 */
export async function refreshVehicleCache(
  db: FleetDb,
  vehicleIds: string[],
  organizationId?: string | null,
): Promise<void> {
  const ids = [...new Set(vehicleIds.filter(Boolean))]
  if (ids.length === 0) return

  const drivers = await db.driver.findMany({
    where: scoped(organizationId, { vehicleId: { in: ids } }),
    select: { id: true },
  })

  for (const driver of drivers) {
    await syncDriverVehicleCache(db, driver.id, organizationId)
  }
}
