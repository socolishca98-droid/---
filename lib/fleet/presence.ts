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

/** Возраст последней GPS-точки в секундах; null — точки не было (или дата битая). */
export function gpsAgeSeconds(
  lastGpsUpdate: GpsTimestamp,
  now: Date = new Date(),
): number | null {
  const age = gpsAgeMs(lastGpsUpdate, now)
  if (age === null) return null
  // Метка из будущего (часы устройства спешат) — считаем возраст нулевым,
  // иначе интерфейс показывал бы «-5 мин назад»
  return Math.max(0, Math.round(age / 1000))
}

/**
 * «только что», «5 мин назад», «3 ч назад», «2 дн назад».
 *
 * Возраст берётся готовым числом секунд из API: на клиенте его не нужно
 * пересчитывать от своих часов, которые могут расходиться с серверными.
 */
export function formatAgeSeconds(ageSeconds: number | null | undefined): string | null {
  if (ageSeconds == null || !Number.isFinite(ageSeconds)) return null

  const seconds = Math.max(0, Math.round(ageSeconds))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return "только что"
  if (minutes < 60) return `${minutes} мин назад`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`

  const days = Math.floor(hours / 24)
  return `${days} дн назад`
}

/** «5 мин назад» прямо из метки времени — для серверной стороны. */
export function formatGpsAge(
  lastGpsUpdate: GpsTimestamp,
  now: Date = new Date(),
): string | null {
  return formatAgeSeconds(gpsAgeSeconds(lastGpsUpdate, now))
}
