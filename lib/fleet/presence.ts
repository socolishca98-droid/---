// lib/fleet/presence.ts — «на связи» по фактическому сигналу, а не по названию статуса.
//
// Единственный настоящий признак присутствия водителя — время последней
// GPS-точки (Driver.lastGpsUpdate). Её пишет мобильное приложение водителя:
// POST /api/m/location и PATCH /api/drivers/[id]/location.
//
// Рабочий статус (available | busy | maintenance | offline) — это состояние
// смены, а не связь: водитель со статусом «available» может сутки не выходить
// на связь, а водитель на погрузке — присылать точку каждые полминуты.
//
// Раньше дашборд, карта и сводка автопарка считали «онлайн» как
// `status !== "offline"`, из-за чего счётчик «N водителей на связи» показывал
// почти всех подряд, включая тех, у кого последняя точка была вчера.
// Теперь правило одно и живёт здесь.
//
// Файл намеренно чистый: без Prisma и без Next.js — его можно импортировать и
// в клиентские компоненты, и в middleware, и тестировать без базы.

/** Сколько времени GPS-точка считается свежей: 15 минут. */
export const GPS_ONLINE_WINDOW_MS = 15 * 60 * 1000

/**
 * Запас на расхождение часов устройства: точка, пришедшая «из будущего» в
 * пределах 5 минут, всё ещё считается свежей. Дальше — уже сбой часов, и
 * выдавать его за присутствие нельзя.
 */
export const GPS_FUTURE_TOLERANCE_MS = 5 * 60 * 1000

/** Метка времени из базы: Date, ISO-строка (JSON) или пусто. */
export type GpsTimestamp = Date | string | null | undefined

/**
 * Возраст последней GPS-точки в миллисекундах.
 * null — точки не было никогда либо значение не читается как дата.
 * Отрицательное значение — метка из будущего (часы устройства спешат).
 */
export function gpsAgeMs(lastGpsUpdate: GpsTimestamp, now: Date = new Date()): number | null {
  if (!lastGpsUpdate) return null

  const timestamp =
    typeof lastGpsUpdate === "string" ? new Date(lastGpsUpdate) : lastGpsUpdate

  if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) return null

  return now.getTime() - timestamp.getTime()
}

/** Водитель на связи: последняя GPS-точка свежая. */
export function isDriverOnline(lastGpsUpdate: GpsTimestamp, now: Date = new Date()): boolean {
  const age = gpsAgeMs(lastGpsUpdate, now)
  if (age === null) return false
  return age <= GPS_ONLINE_WINDOW_MS && age >= -GPS_FUTURE_TOLERANCE_MS
}

/** Сколько водителей на связи — для счётчиков в сводках. */
export function countOnlineDrivers(
  drivers: Iterable<{ lastGpsUpdate?: GpsTimestamp } | null | undefined>,
  now: Date = new Date(),
): number {
  let total = 0
  for (const driver of drivers) {
    if (driver && isDriverOnline(driver.lastGpsUpdate, now)) total += 1
  }
  return total
}
