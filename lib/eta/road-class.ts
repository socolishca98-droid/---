// lib/eta/road-class.ts
//
// Класс дороги и базовая скорость.
//
// Зачем: бесплатный OSRM (router.project-osrm.org) отдаёт шаги маршрута БЕЗ
// класса дороги и без ограничений скорости — проверил живым запросом: в шаге
// есть только name, mode, distance, duration, maneuver, intersections. Значит
// класс приходится выводить из названия дороги, манёвра, длины шага, средней
// скорости и плотности перекрёстков.
//
// Это оценка, а не измерение, поэтому у неё есть честная уверенность
// (confidence): она попадает в общий уровень доверия к прогнозу. Никаких
// «выдуманных» классов: если признаков мало — класс unknown и скорость берётся
// из фактической скорости OSRM.

/** Классы дорог из таблицы базовых скоростей. */
export type RoadClass =
  | "motorway"
  | "federal"
  | "regional"
  | "rural"
  | "settlement"
  | "city"
  | "dense_city"
  | "industrial"
  | "unknown"

export interface RoadClassProfile {
  class: RoadClass
  /** Название для интерфейса и объяснений */
  label: string
  /**
   * Предлагаемая базовая скорость свободного потока, км/ч.
   *
   * Необязательна: в классификации по косвенным признакам (манёвр, длина шага)
   * таблица уже дала значение, но сегмент может получить свою скорость из
   * фактической скорости OSRM — см. segmentBaseSpeedKmh.
   */
  baseSpeedKmh?: number
  /** Насколько класс доверенный: 1 — по названию дороги, 0.3 — по косвенным признакам */
  confidence: number
  /** Почему решили, что это такой класс */
  reason: string
}

/**
 * Начальные базовые скорости для грузового автомобиля.
 *
 * Это эвристики, а не нормативные скорости: у бесплатного OSRM нет данных об
 * ограничениях, поэтому таблица сама выступает верхней границей скорости в
 * модели. Калибруется по фактическим рейсам (lib/eta/calibration).
 */
export const BASE_SPEEDS: Record<Exclude<RoadClass, "unknown">, number> = {
  motorway: 75,
  federal: 65,
  regional: 55,
  rural: 50,
  settlement: 35,
  city: 25,
  dense_city: 18,
  industrial: 12,
}

export const ROAD_CLASS_LABELS: Record<RoadClass, string> = {
  motorway: "автомагистраль",
  federal: "федеральная трасса",
  regional: "региональная трасса",
  rural: "загородная дорога",
  settlement: "населённый пункт",
  city: "городская дорога",
  dense_city: "плотная застройка",
  industrial: "промзона",
  unknown: "класс не определён",
}

/**
 * Признаки класса дороги по НОМЕРУ (поле ref) и по НАЗВАНИЮ.
 *
 * Порядок важен: номера трасс проверяются ПЕРВЫМИ. Без этого «М-4 Дон» падало
 * в «федеральную трассу» по косвенным признакам с уверенностью 0.45, а слово
 * «федеральная» уводило в автомагистраль со скоростью 75 км/ч — время
 * занижалось. Российские номера в ответах OSRM встречаются постоянно:
 * М-11 Нева, Р-22 Каспий, А-108, 46К-16, Е-101.
 */
const ROAD_NUMBER_PATTERNS: Array<{ class: Exclude<RoadClass, "unknown">; re: RegExp; confidence: number }> = [
  // Федеральные: М-4, М4 «Дон», М-11 Нева, М-8 «Холмогоры»
  { class: "federal", re: /^(?:м|m)[-–\s]?\d/i, confidence: 0.9 },
  // Европейские и азиатские маршруты: Е-101, Е-22, АН-4
  { class: "federal", re: /^(?:е|e|ah|ан)[-–\s]?\d/i, confidence: 0.85 },
  { class: "federal", re: /федеральн/i, confidence: 0.8 },
  // Региональные и межмуниципальные: Р-22, А-108, 46К-16, 78К-0043, 22Н-13
  { class: "regional", re: /^(?:р|p|а|a)[-–\s]?\d/i, confidence: 0.8 },
  { class: "regional", re: /^\d{2}[а-яa-z]{1,2}[-–\s]?\d+/i, confidence: 0.8 },
]

const NAME_PATTERNS: Array<{ class: Exclude<RoadClass, "unknown">; re: RegExp; confidence: number }> = [
  // Федеральные: М-4, М4 «Дон», М-11 Нева
  { class: "federal", re: /(?:^|[\s(«"'])(?:м|m)[-–\s]?\d/i, confidence: 0.85 },
  // Европейские и азиатские маршруты: Е-101, Е-22, АН-4
  { class: "federal", re: /(?:^|[\s(«"'])(?:е|e|ah|ан)[-–\s]?\d/i, confidence: 0.8 },
  { class: "federal", re: /федеральн/i, confidence: 0.8 },
  // Именованная трасса в кавычках-ёлочках: «Холмогоры», «Дон», «Нева».
  // Проверено на живом маршруте Ярославль — Москва: 218 из 265 км шли именно
  // с таким названием, и без этого правила вся федеральная трасса уходила в
  // unknown с городскими коэффициентами пробок.
  { class: "federal", re: /^[«"'[][^»"']+[»"']$/, confidence: 0.7 },
  // Региональные и межмуниципальные: Р-22, А-108, 46К-16, 22Н-13
  { class: "regional", re: /(?:^|[\s(«"'])(?:р|p|а|a)[-–\s]?\d/i, confidence: 0.75 },
  { class: "regional", re: /(?:^|\s)\d{2}[а-яa-z]{1,2}[-–\s]?\d+/i, confidence: 0.7 },
  // Скоростные дороги
  { class: "motorway", re: /(шоссе|трасса|автодорог|магистрал|кольц|кад|цкад|обход|скоростн)/i, confidence: 0.9 },
  { class: "industrial", re: /(пром|промышлен|склад|логистик|терминал|порт|депо|подъездн)/i, confidence: 0.85 },
  { class: "settlement", re: /(пос[её]лок|пос\.|снт|днп|станция|разъезд|хутор|село|деревня|мкр|микрорайон)/i, confidence: 0.8 },
  { class: "city", re: /(улица|ул\.|проспект|пр-т|проезд|переулок|площадь|бульвар|набережная|аллея|квартал)/i, confidence: 0.75 },
]

/** Манёвры, говорящие о внеклассовой инфраструктуре. */
const MANEUVER_HINTS: Record<string, Exclude<RoadClass, "unknown">> = {
  roundabout: "city",
  rotary: "city",
  "exit roundabout": "city",
  "enter roundabout": "city",
  merge: "motorway",
  fork: "motorway",
}

export interface StepLike {
  name?: string
  /**
   * Номер дороги из OSM (поле ref в ответе OSRM): «М-8», «78К-0043», «А-108».
   *
   * Проверено живым запросом: публичный OSRM отдаёт ref, хотя и не отдаёт
   * way_class. Это самый надёжный признак класса — надёжнее названия, потому
   * что приходит из тега дороги, а не из строки, которую мог написать кто угодно.
   */
  ref?: string
  distance: number
  duration: number
  maneuver?: { type?: string; modifier?: string }
  intersections?: unknown[]
}

/**
 * Определяет класс дороги по шагу OSRM.
 *
 * Приоритет: название дороги → манёвр → средняя скорость и длина шага →
 * плотность перекрёстков. У каждого шага своя уверенность, и она честно
 * попадает в общий уровень доверия к прогнозу.
 */
export function classifyStep(step: StepLike): RoadClassProfile {
  const name = (step.name || "").trim()
  const speedKmh = step.duration > 0 ? (step.distance / step.duration) * 3.6 : 0
  const junctionCount = Array.isArray(step.intersections) ? step.intersections.length : 0

  // 1. Номер дороги (ref) — самый надёжный признак: тег из OSM
  const ref = (step.ref || "").trim()
  if (ref) {
    for (const pattern of ROAD_NUMBER_PATTERNS) {
      if (pattern.re.test(ref)) {
        return {
          class: pattern.class,
          label: ROAD_CLASS_LABELS[pattern.class],
          baseSpeedKmh: BASE_SPEEDS[pattern.class],
          confidence: pattern.confidence,
          reason: `номер дороги «${ref}»`,
        }
      }
    }
  }

  // 2. Название дороги
  if (name) {
    for (const pattern of NAME_PATTERNS) {
      if (pattern.re.test(name)) {
        return {
          class: pattern.class,
          label: ROAD_CLASS_LABELS[pattern.class],
          baseSpeedKmh: BASE_SPEEDS[pattern.class],
          confidence: pattern.confidence,
          reason: `название «${name}»`,
        }
      }
    }
  }

  // 2. Манёвр: развязки и кольца — про город и автомагистрали
  const maneuverType = step.maneuver?.type
  if (maneuverType && MANEUVER_HINTS[maneuverType]) {
    const klass = MANEUVER_HINTS[maneuverType]
    return {
      class: klass,
      label: ROAD_CLASS_LABELS[klass],
      baseSpeedKmh: BASE_SPEEDS[klass],
      confidence: 0.5,
      reason: `манёвр «${maneuverType}»`,
    }
  }

  // 3. Длинный быстрый шаг с редкими перекрёстками — скорее трасса.
  //    Сравниваем ПЛОТНОСТЬ перекрёстков, а не их число: на 51 км магистрали
  //    два съезда — это норма, а на 1 км городской улицы два — уже город.
  //    На живом маршруте именно из-за абсолютного числа участки трассы без
  //    названия уходили в unknown.
  if (step.distance > 5000 && speedKmh > 60) {
    // Среднюю скорость выше 60 км/ч в городе на протяжении больше 5 км не
    // поддержить: светофоры не дадут. Значит это трасса. Перекрёстки тут не
    // критерий: OSRM считает пересечениями и съезды, и на магистрали их бывает
    // больше одного на километр — проверено на М-8 (до 1.3 на км).
    return {
      class: "federal",
      label: ROAD_CLASS_LABELS.federal,
      baseSpeedKmh: BASE_SPEEDS.federal,
      confidence: 0.5,
      reason: `длинный шаг ${Math.round(step.distance / 1000)} км при ${Math.round(speedKmh)} км/ч`,
    }
  }

  // 4. Короткие шаги с частыми перекрёстками — город
  if (junctionCount >= 3 && step.distance < 1500) {
    const klass: Exclude<RoadClass, "unknown"> = speedKmh < 12 ? "dense_city" : "city"
    return {
      class: klass,
      label: ROAD_CLASS_LABELS[klass],
      baseSpeedKmh: BASE_SPEEDS[klass],
      confidence: 0.4,
      reason: `${junctionCount} перекрёстков на ${Math.round(step.distance)} м`,
    }
  }

  // 5. Очень медленно и очень коротко — промзона/дворы
  if (speedKmh < 15 && step.distance < 800) {
    return {
      class: "industrial",
      label: ROAD_CLASS_LABELS.industrial,
      baseSpeedKmh: BASE_SPEEDS.industrial,
      confidence: 0.3,
      reason: `скорость ${Math.round(speedKmh)} км/ч на ${Math.round(step.distance)} м`,
    }
  }

  return {
    class: "unknown",
    label: ROAD_CLASS_LABELS.unknown,
    baseSpeedKmh: 0,
    confidence: 0.2,
    reason: "признаков класса недостаточно",
  }
}

/**
 * Базовая скорость сегмента.
 *
 * Приоритет (ТЗ §2): фактическая скорость выше таблицы. Поэтому:
 *
 *   - класс определён → берём МИНИМУМ из таблицы класса и фактической скорости
 *     OSRM. Таблица — верхняя граница: на «Ярославском шоссе» с классом
 *     автомагистрали OSRM считает 63 км/ч, и 63 честнее 75. Но и наоборот:
 *     на улице через town, которая числится частью М-8, OSRM даёт 45 км/ч —
 *     и брать «федеральные» 65 было бы врать.
 *   - класс неизвестен → доверяемся фактической скорости OSRM в разумных
 *     пределах (8..80), потому что таблицы под этот случай нет.
 */
export function segmentBaseSpeedKmh(
  profile: RoadClassProfile,
  osrmSpeedKmh: number,
): { speedKmh: number; source: "table" | "osrm" | "table_capped"; limited: boolean } {
  const table = profile.baseSpeedKmh ?? 0

  if (profile.class !== "unknown" && table > 0) {
    // Фактической скорости нет (нулевой шаг) — только таблица
    if (osrmSpeedKmh <= 0) {
      return { speedKmh: table, source: "table", limited: false }
    }
    // Дорога медленнее своего класса: реальность важнее таблицы
    if (osrmSpeedKmh < table) {
      return { speedKmh: Math.round(osrmSpeedKmh * 10) / 10, source: "osrm", limited: false }
    }
    // Быстрее таблицы — таблица и есть верхняя граница
    return { speedKmh: table, source: "table_capped", limited: true }
  }

  const fallback = Math.max(8, Math.min(80, osrmSpeedKmh))
  return { speedKmh: fallback, source: "osrm", limited: false }
}
