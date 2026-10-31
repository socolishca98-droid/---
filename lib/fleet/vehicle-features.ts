// lib/fleet/vehicle-features.ts
//
// Особенности машины: как их хранить и как показать.
//
// Зачем отдельный модуль: в базе особенности лежат строкой JSON, причём
// исторически в двух видах — идентификаторами формы («tail_lift») и русскими
// названиями («Гидроборт»), потому что сиды и старые записи писали по-своему.
// Плюс есть оборудование, под которое в форме нет галочки (термограф, коник,
// кран-балка).
//
// Для правки машины это критично: форма должна показать галочки там, где они
// стояли, и не стереть незнакомое оборудование. Иначе логист открывает карточку
// с пустым списком, сохраняет — и молча снимает с машины гидроборт.

/** Идентификаторы особенностей, которые правит форма. */
export type VehicleFeatureId =
  | "tent"
  | "refrigerator"
  | "top_loading"
  | "side_loading"
  | "tail_lift"
  | "gps"
  | "adr"

/** Подписи: то, что видит логист и что хранится в базе. */
export const VEHICLE_FEATURES: Array<{ id: VehicleFeatureId; label: string }> = [
  { id: "tent", label: "Тент" },
  { id: "refrigerator", label: "Рефрижератор" },
  { id: "top_loading", label: "Верхняя загрузка" },
  { id: "side_loading", label: "Боковая загрузка" },
  { id: "tail_lift", label: "Гидроборт" },
  { id: "gps", label: "GPS-трекер" },
  { id: "adr", label: "ADR (опасные грузы)" },
]

const ALIASES: Array<{ id: VehicleFeatureId; re: RegExp }> = [
  { id: "refrigerator", re: /рефриж|изотерм|refriger/i },
  { id: "tent", re: /тент|tent/i },
  { id: "top_loading", re: /верхн|top/i },
  { id: "side_loading", re: /боков|side/i },
  { id: "tail_lift", re: /гидроборт|tail/i },
  { id: "gps", re: /gps|глонасс/i },
  { id: "adr", re: /adr|опасн/i },
]

/** Строка из базы → сырые названия (как записаны), пустые отбрасываются. */
export function rawFeatureList(raw: unknown): string[] {
  if (raw == null) return []
  let list: unknown[] = []
  if (Array.isArray(raw)) {
    list = raw
  } else if (typeof raw === "string") {
    const text = raw.trim()
    if (!text) return []
    try {
      const parsed = JSON.parse(text)
      list = Array.isArray(parsed) ? parsed : [text]
    } catch {
      list = text.split(",").map((part) => part.trim())
    }
  }

  const out: string[] = []
  for (const item of list) {
    const value = String(item ?? "").trim()
    if (value) out.push(value)
  }
  return out
}

/** Сырое название → идентификатор формы (null, если особенность неизвестна). */
function toFeatureId(value: string): VehicleFeatureId | null {
  const known = VEHICLE_FEATURES.find(
    (feature) =>
      feature.id === value.toLowerCase() || feature.label.toLowerCase() === value.toLowerCase(),
  )
  if (known) return known.id
  const alias = ALIASES.find((entry) => entry.re.test(value))
  return alias ? alias.id : null
}

/**
 * Строка из базы → идентификаторы для галочек в форме.
 * Незнакомые особенности сюда не попадают — для них customVehicleFeatures.
 */
export function parseVehicleFeatures(raw: unknown): VehicleFeatureId[] {
  const out: VehicleFeatureId[] = []
  for (const value of rawFeatureList(raw)) {
    const id = toFeatureId(value)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/**
 * Особенности, которых нет среди галочек формы (термограф, коники, кран-балка).
 * Нужны, чтобы правка машины не стирала то, чего форма не понимает.
 */
export function customVehicleFeatures(raw: unknown): string[] {
  const out: string[] = []
  for (const value of rawFeatureList(raw)) {
    if (toFeatureId(value)) continue
    if (!out.some((item) => item.toLowerCase() === value.toLowerCase())) out.push(value)
  }
  return out
}

/** Особенности словами — для карточки: известные подписи плюс нестандартные. */
export function vehicleFeatureLabels(raw: unknown): string[] {
  const out = parseVehicleFeatures(raw).map(
    (id) => VEHICLE_FEATURES.find((feature) => feature.id === id)?.label ?? id,
  )
  for (const value of customVehicleFeatures(raw)) out.push(value)
  return out
}

/**
 * Что сохранять в базу: человеческие названия, как их показывает карточка,
 * плюс ранее сохранённые нестандартные особенности (extra).
 */
export function featuresForSave(ids: readonly string[], extra: readonly string[] = []): string[] {
  const out = ids.map(
    (id) =>
      VEHICLE_FEATURES.find(
        (feature) =>
          feature.id === id || feature.label.toLowerCase() === String(id).toLowerCase(),
      )?.label ?? String(id),
  )
  for (const value of extra) {
    const label = String(value ?? "").trim()
    if (label && !out.some((item) => item.toLowerCase() === label.toLowerCase())) out.push(label)
  }
  return out
}
