// lib/ati/scan-profile.ts
//
// Профили расписания сканирования ATI (модель AtiScanConfig): что сканировать,
// с какими фильтрами и как часто.
//
// Файл намеренно чистый — без Prisma и без Next.js: те же правила нужны и
// серверу (cron выбирает, какие профили пора запускать), и интерфейсу (показать
// расписание человеческим языком), и тестам.
//
// Главный принцип: живой ATI опрашивается только по расписанию. Поиск заказов
// работает по накопленной базе (AtiCache), которую наполняют эти сканы.

/** Строка профиля так, как она лежит в AtiScanConfig. */
export type ScanProfileRow = {
  id: string
  name: string
  /** JSON-массив идентификаторов городов ATI: "[151, 153]" */
  cities: string
  radius: number
  /** "any" либо список типов кузова через запятую */
  truckTypes: string
  minWeight: number | null
  /** Период в минутах; 0 — профиль не запускается сам, только вручную */
  autoScanInterval: number
  isActive: boolean
  lastScanAt: Date | string | null
}

/** Фильтры, которые понимает скан (lib/ati-client.ts). */
export type ProfileScanFilters = {
  minWeight?: number
  truckTypes?: string[]
}

/** Город из значения профиля: пусто и мусор не превращаются в город с id 0. */
function toCityId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Города профиля: принимаем и JSON-массив, и список через запятую. */
export function parseProfileCities(raw: unknown): number[] {
  const collect = (values: unknown[]): number[] =>
    values.map(toCityId).filter((value): value is number => value !== null)

  if (Array.isArray(raw)) return collect(raw)

  const text = String(raw ?? "").trim()
  if (!text) return []

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return collect(parsed)
    } catch {
      /* ниже попробуем разобрать как список */
    }
  }

  return collect(text.split(/[,\s;]+/))
}

/** Типы кузова профиля: "any" (по умолчанию) или список слов. */
export function parseProfileTruckTypes(raw: unknown): string[] {
  const text = String(raw ?? "").trim()
  if (!text || text.toLowerCase() === "any" || text.toLowerCase() === "любой") return []
  return text
    .split(/[,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

/**
 * Пора ли запускать профиль: активен, интервал задан, и с прошлого скана
 * прошло достаточно времени. Профиль без интервала сканируется только вручную.
 */
export function isProfileDue(profile: ScanProfileRow, now: Date = new Date()): boolean {
  if (!profile.isActive) return false
  const interval = Number(profile.autoScanInterval) || 0
  if (interval <= 0) return false
  if (!profile.lastScanAt) return true

  const last = new Date(profile.lastScanAt)
  if (Number.isNaN(last.getTime())) return true

  return now.getTime() - last.getTime() >= interval * 60 * 1000
}

/** Фильтры скана из профиля: пока только минимальный вес и типы кузова. */
export function buildProfileFilters(profile: ScanProfileRow): ProfileScanFilters {
  const filters: ProfileScanFilters = {}
  const minWeight = Number(profile.minWeight)
  if (Number.isFinite(minWeight) && minWeight > 0) filters.minWeight = minWeight

  const truckTypes = parseProfileTruckTypes(profile.truckTypes)
  if (truckTypes.length > 0) filters.truckTypes = truckTypes

  return filters
}

/** Человеческая подпись расписания — для интерфейса и журнала. */
export function describeProfileSchedule(profile: ScanProfileRow): string {
  if (!profile.isActive) return "выключен"
  const interval = Number(profile.autoScanInterval) || 0
  if (interval <= 0) return "только вручную"
  if (interval < 60) return `каждые ${interval} мин`
  if (interval === 60) return "каждый час"
  if (interval % 60 === 0) return `каждые ${interval / 60} ч`
  return `каждые ${interval} мин`
}

/**
 * Через сколько минут профиль запустится снова.
 * null — профиль выключен или ручной.
 */
export function minutesUntilNextScan(
  profile: ScanProfileRow,
  now: Date = new Date(),
): number | null {
  const interval = Number(profile.autoScanInterval) || 0
  if (!profile.isActive || interval <= 0) return null
  if (!profile.lastScanAt) return 0

  const last = new Date(profile.lastScanAt)
  if (Number.isNaN(last.getTime())) return 0

  const nextAt = last.getTime() + interval * 60 * 1000
  return Math.max(0, Math.ceil((nextAt - now.getTime()) / 60000))
}
