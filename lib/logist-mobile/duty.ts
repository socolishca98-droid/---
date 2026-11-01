// lib/logist-mobile/duty.ts
//
// Дежурный логист: смотрит биржу регулярно, а не «за ночь».
//
// Почему не ночная сводка. Грузы появляются в течение дня, у каждой компании
// свой график: утром выкладывают новые, к обеду разбирают, вечером снова
// добавляют. Ночью новых почти нет — сводка «за ночь» показывала бы пустое
// утро и опаздывала на весь рабочий день. Поэтому дежурный работает по
// интервалу в рабочих часах организации и каждый раз отвечает на один вопрос:
// «что появилось или изменилось такого, из-за чего стоит действовать».
//
// Файл чистый (без Prisma и Next): то же ядро нужно cron, кнопке «Посмотреть
// сейчас», экрану дежурного и тестам.

import { estimateFuelL } from "../fleet/fuel"
import {
  haversineKm,
  isFresh,
  loadFitsVehicle,
  loadPrice,
  loadedDistanceKm,
  roadKm,
  type BuilderLoad,
  type BuilderVehicle,
  type Point,
} from "./route-builder"
import { samePlace } from "./city-norm"
import { displayCity, formatCount, formatMoney, shortCity } from "./format"

/** Как часто смотрим и в какие часы организации это имеет смысл. */
export interface DutySettings {
  enabled: boolean
  /** Интервал между просмотрами, минуты. 0 — только вручную. */
  intervalMin: number
  /** Начало рабочего дня организации (час, 0–23). */
  fromHour: number
  /** Конец рабочего дня (час, 0–24). Ночью дежурный не бегает. */
  toHour: number
}

export const DEFAULT_DUTY: DutySettings = {
  enabled: true,
  intervalMin: 15,
  fromHour: 7,
  toHour: 21,
}

/**
 * Пора ли смотреть биржу.
 *
 * Три причины не смотреть, и все три называются словами — экран обязан
 * объяснять, почему «сейчас тихо», а не молчать.
 */
export function dutyIsDue(
  settings: DutySettings,
  lastRunAt: Date | string | null,
  now: Date = new Date(),
): { due: boolean; reason: string; nextAt: Date | null } {
  const nice = normalizeDutySettings(settings)
  if (!nice.enabled) {
    return { due: false, reason: "Дежурный выключен в настройках", nextAt: null }
  }
  if (nice.intervalMin <= 0) {
    return { due: false, reason: "Смотреть биржу можно только вручную", nextAt: null }
  }

  const hour = now.getHours()
  const inHours = isInsideWorkingHours(hour, nice.fromHour, nice.toHour)
  if (!inHours) {
    const next = nextWorkingStart(now, nice.fromHour, nice.toHour)
    return {
      due: false,
      reason:
        `Сейчас ${formatTimeShort(now)} — вне рабочих часов организации ` +
        `(${hourLabel(nice.fromHour)}–${hourLabel(nice.toHour)}). ` +
        `Ночью новых грузов почти нет: их выкладывают в рабочее время.`,
      nextAt: next,
    }
  }

  const last = lastRunAt ? new Date(lastRunAt) : null
  if (last && Number.isFinite(last.getTime())) {
    const elapsedMin = (now.getTime() - last.getTime()) / 60000
    if (elapsedMin < nice.intervalMin) {
      return {
        due: false,
        reason: `Смотрели ${formatTimeShort(last)} — следующий просмотр по графику`,
        nextAt: new Date(last.getTime() + nice.intervalMin * 60000),
      }
    }
  }

  return { due: true, reason: "Пора посмотреть биржу", nextAt: null }
}

/** Настройки дежурного с разумными границами — мусор из базы не должен ломать график. */
export function normalizeDutySettings(input: Partial<DutySettings> | null | undefined): DutySettings {
  const raw = input ?? {}
  const interval = Number(raw.intervalMin)
  const from = Number(raw.fromHour)
  const to = Number(raw.toHour)
  const clamp = (value: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min
  const fromHour = clamp(from, 0, 23)
  const toHour = clamp(to, 1, 24)
  return {
    enabled: raw.enabled === undefined ? DEFAULT_DUTY.enabled : Boolean(raw.enabled),
    // 0 — «только вручную», это допустимое значение, поэтому не подменяем его
    intervalMin: Number.isFinite(interval) ? Math.min(240, Math.max(0, Math.round(interval))) : DEFAULT_DUTY.intervalMin,
    fromHour,
    // Конец раньше начала — это «через полночь»: 22 → 6. Оставляем как есть.
    toHour: toHour === fromHour ? Math.min(24, fromHour + 1) : toHour,
  }
}

export function isInsideWorkingHours(hour: number, fromHour: number, toHour: number): boolean {
  if (fromHour === toHour) return true
  if (fromHour < toHour) return hour >= fromHour && hour < toHour
  // Через полночь: 22:00–06:00
  return hour >= fromHour || hour < toHour
}

/** Когда дежурный снова посмотрит — ближайшее начало рабочих часов. */
export function nextWorkingStart(now: Date, fromHour: number, toHour: number): Date {
  const next = new Date(now)
  next.setMinutes(0, 0, 0)
  for (let step = 0; step < 48; step += 1) {
    if (isInsideWorkingHours(next.getHours(), fromHour, toHour)) return next
    next.setHours(next.getHours() + 1)
  }
  return next
}

/** «09:40» — для фраз вида «смотрели 09:40, следующий по графику». */
export function formatTimeShort(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function hourLabel(hour: number): string {
  return `${String(Math.min(23, Math.max(0, hour))).padStart(2, "0")}:00`
}

// ---------------------------------------------------------------------------
// Город в падеже: «уже стоит в Казани», а не «в Казань»
// ---------------------------------------------------------------------------
//
// Дежурный пишет короткие фразы, и в них город стоит то в предложном падеже
// («стоит в Казани»), то в родительном («из Перми грузов нет»). Без падежа
// фраза читается как машинный перевод, а логист должен читать её как записку
// от коллеги.
//
// Правила покрывают обычные названия; на незнакомом (Мытищи, Ростов-на-Дону)
// функция честно возвращает null, и вызывающий код говорит нейтрально —
// «в городе Мытищи». Выдуманный падеж хуже нейтральной фразы.

/** Прилагательное в составе названия: Нижний → Нижнем / Нижнего. */
function adjectiveForm(word: string, prepositional: boolean): string | null {
  const lower = word.toLowerCase()
  if (/(ий|ый|ой)$/.test(lower)) {
    const stem = word.slice(0, -2)
    // Великий → Великом, но Нижний → Нижнем: после г,к,х пишется «ом»
    const ending = prepositional ? (/[гкхжшчщ]$/i.test(stem) ? "ом" : "ем") : "его"
    return stem + ending
  }
  if (/ая$/.test(lower)) return word.slice(0, -2) + (prepositional ? "ей" : "ой")
  if (/ое$/.test(lower)) return word.slice(0, -2) + (prepositional ? "ом" : "ого")
  return null
}

/** Существительное-название города в предложном или родительном падеже. */
function nounForm(word: string, prepositional: boolean): string | null {
  const lower = word.toLowerCase()

  if (/[аеёиоуыэюя]$/.test(lower)) {
    // Женские на -а: Москва → Москве / Москвы; после г,к,х — Уфа → Уфе / Уфы
    if (/а$/.test(lower)) {
      const stem = word.slice(0, -1)
      if (prepositional) return stem + "е"
      return /[гкхжшчщ]$/i.test(stem) ? stem + "и" : stem + "ы"
    }
    // Несклоняемые (Пушкино, Кемерово, Сочи) — оставляем как есть
    if (/[ое]$/.test(lower)) return word
    return null
  }

  if (/ь$/.test(lower)) {
    // Ярославль → Ярославле, но Казань → Казани
    if (/ль$/.test(lower)) return word.slice(0, -1) + (prepositional ? "е" : "я")
    return word.slice(0, -1) + "и"
  }

  // Твёрдый согласный: Воронеж → Воронеже / Воронежа
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(lower)) {
    return word + (prepositional ? "е" : "а")
  }

  return null
}

function cityForm(city: string | null | undefined, prepositional: boolean): string | null {
  const name = cleanCity(city).trim()
  if (!name || name === "—") return null
  // Дефисные и служебные части названия («Ростов-на-Дону») не склоняем:
  // ошибиться в них проще, чем сказать нейтрально.
  if (name.includes("-")) return null

  const words = name.split(/\s+/)
  const out: string[] = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    const isLast = index === words.length - 1
    const form = isLast ? nounForm(word, prepositional) : adjectiveForm(word, prepositional)
    if (!form) return null
    out.push(form)
  }
  return out.join(" ")
}

/**
 * Название города для фраз дежурного: «Обухово рп. (Богородский г.о.)» →
 * «Обухово», «Красулино с.» → «Красулино». Биржа присылает адрес с типом
 * населённого пункта и уточнением района — в короткой строке это мусор.
 */
export function cleanCity(address?: string | null): string {
  const base = displayCity(address)
  const trimmed = base
    .replace(/\s+(?:рп|пгт|г|город|с|село|п|пос|посёлок|поселок|д|дер|деревня|х|хутор|ст-ца|станица|мкр|аул|сл|слобода)\.?$/i, "")
    .trim()
  return trimmed || base
}

/** «в Казани» / «в городе Мытищи» — всегда грамотно, даже если падеж не угадан. */
export function inCity(city: string | null | undefined): string {
  const form = cityForm(city, true)
  return form ? `в ${form}` : `в городе ${cleanCity(city)}`
}

/** То же с заглавной буквы — для начала фразы. */
export function InCity(city: string | null | undefined): string {
  const phrase = inCity(city)
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/** «из Перми» / «из города Мытищи». */
export function fromCity(city: string | null | undefined): string {
  const form = cityForm(city, false)
  return form ? `из ${form}` : `из города ${cleanCity(city)}`
}

/** «Из Перми» — для начала фразы. */
export function FromCity(city: string | null | undefined): string {
  const phrase = fromCity(city)
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

// ---------------------------------------------------------------------------
// Что показывать
// ---------------------------------------------------------------------------

export type DutyKind = "backhaul" | "new" | "rate-up" | "expiring"

/** Груз, который дежурный уже видел раньше. */
export interface DutySeenRow {
  atiLoadId: string
  firstSeenAt: Date | string
  priceRub: number | null
}

/** Машина стоит в городе (или доедет туда) — оттуда ценна обратка. */
export interface AwayVehicle {
  plate: string
  city: string
  /** «стоит» — уже там; «доедет» — везёт груз в этот город */
  kind: "стоит" | "доедет"
}

export interface DutyItem {
  kind: DutyKind
  atiLoadId: string
  load: BuilderLoad
  /** Сколько останется, если взять этот груз одним плечом с возвратом домой */
  netRub: number
  netPerKm: number
  /** По чему сортируем: деньги плюс экономия на порожнем ходе */
  score: number
  title: string
  note: string
}

export interface DutyFeedInput {
  /** Свежий пул: то, что сейчас лежит в накопленной базе */
  loads: BuilderLoad[]
  /** Что дежурный уже видел: по этим записям отличаем новое от старого */
  seen: DutySeenRow[]
  vehicles: BuilderVehicle[]
  basePoint: Point | null
  baseCity: string
  fuelPriceRubPerL: number | null
  /** Ставка работы машины, ₽/км — та же, что у сборщика */
  operatingCostPerKm: number
  /** Где сейчас машины: оттуда обратка дороже золота */
  away?: AwayVehicle[]
  /** Радиус внимания от базы, км. 0 — не ограничивать (смотрим всё) */
  radiusKm?: number
  /** Порог «ради чего вообще звонить», ₽/км остатка */
  minNetPerKm?: number
  /**
   * Круг (гружёное плечо + подъезд + возврат), который дежурный считает
   * «взять сейчас». Длиннее — это уже рейс на несколько дней, его собирают
   * в помощнике сборки. 0 — не ограничивать.
   */
  maxRoundTripKm?: number
  now?: Date
  /** Сколько пунктов максимум отдать */
  limit?: number
}

/**
 * Что из нового стоит внимания.
 *
 * Правила простые и объяснимые:
 *   1. груз должен влезать в свободную машину, быть свежим и со ставкой;
 *   2. после топлива и работы машины он обязан что-то оставлять (порог ₽/км);
 *   3. обратка из города, где стоит или окажется наша машина, важнее прочего:
 *      она заменяет порожний ход, а не добавляет рейс;
 *   4. новый груз важнее подорожавшего, подорожавший важнее «скоро уйдёт»;
 *   5. круг длиннее 2 500 км — не «взять сейчас»: он отбрасывается и
 *      считается отдельно, чтобы экран предложил сборщик, а не молчал.
 */
export function buildDutyFeed(input: DutyFeedInput): DutyItem[] {
  return buildDutyFeedDetailed(input).items
}

/**
 * То же, что buildDutyFeed, плюс счётчик отброшенных дальних рейсов: экран
 * обязан сказать «рядом пусто, но есть три дальних», а не молчать.
 */
export function buildDutyFeedDetailed(input: DutyFeedInput): {
  items: DutyItem[]
  farCount: number
} {
  const now = input.now ?? new Date()
  const limit = input.limit ?? 12
  const minNetPerKm = input.minNetPerKm ?? 8
  const radiusKm = input.radiusKm ?? 0
  const available = (input.vehicles ?? []).filter((vehicle) => vehicle.status !== "maintenance")
  if (available.length === 0) return { items: [], farCount: 0 }

  const seenById = new Map<string, DutySeenRow>()
  for (const row of input.seen ?? []) seenById.set(row.atiLoadId, row)
  const away = input.away ?? []

  const maxRoundTripKm = input.maxRoundTripKm ?? 2500
  const items: DutyItem[] = []
  /** Сколько выгодных грузов отброшено как «дальние» — экран скажет об этом. */
  let farCount = 0

  for (const load of input.loads ?? []) {
    if (!isFresh(load, now)) continue
    const revenue = loadPrice(load)
    if (revenue <= 0) continue

    const vehicle = available.find((item) => loadFitsVehicle(load, item))
    if (!vehicle) continue

    const loadedKm = loadedDistanceKm(load)
    if (loadedKm <= 0) continue

    // Один конец рейса у базы — это либо выезд из дома, либо обратка домой.
    const pickupKm =
      input.basePoint && load.fromPoint ? roadKm(input.basePoint, load.fromPoint) : 0

    // Обратный путь. Координат выгрузки часто нет (биржа отдаёт их не всегда),
    // и раньше возврат считался нулевым: рейс Ярославль → Новосибирск за
    // 410 000 ₽ выглядел как 38 ₽/км остатка, хотя 6 600 км надо ещё проехать
    // обратно. Без координат берём длину гружёного плеча — это честнее нуля.
    // Исключение — груз домой: там возврата нет вовсе.
    const endsAtBase = samePlace(load.toCity, input.baseCity)
    const homeKm = endsAtBase
      ? input.basePoint && load.toPoint
        ? roadKm(load.toPoint, input.basePoint)
        : 0
      : input.basePoint && load.toPoint
        ? roadKm(load.toPoint, input.basePoint)
        : loadedKm
    const nearBase =
      samePlace(load.fromCity, input.baseCity) ||
      samePlace(load.toCity, input.baseCity) ||
      (radiusKm > 0 && pickupKm > 0 && pickupKm <= radiusKm)

    const fromAway = away.find((item) => samePlace(item.city, load.fromCity))
    if (!nearBase && !fromAway) continue

    // Часть пути машина проедет в любом случае: к погрузке и домой.
    const totalKm = loadedKm + pickupKm + homeKm
    const fuelLiters = estimateFuelL(vehicle, totalKm, load.weightKg ?? 0)
    const fuelRub =
      fuelLiters !== null && input.fuelPriceRubPerL !== null
        ? fuelLiters * input.fuelPriceRubPerL
        : 0
    const workRub = input.operatingCostPerKm * totalKm
    const netRub = Math.round(revenue - fuelRub - workRub)
    const netPerKm = totalKm > 0 ? netRub / totalKm : 0
    if (netRub <= 0 || netPerKm < minNetPerKm) continue

    // Дежурный отвечает на вопрос «что взять сейчас», а не «куда уехать на
    // неделю». Дальние круги (по умолчанию больше 2 500 км туда и обратно)
    // считаем отдельно: их место — в помощнике сборки, где видно весь маршрут.
    if (maxRoundTripKm > 0 && totalKm > maxRoundTripKm) {
      farCount += 1
      continue
    }

    // Сколько стоило бы уехать из точки выгрузки порожнем — столько экономит
    // обратка. Именно поэтому она в приоритете: это не новый рейс, а
    // исправление пустого хода.
    const emptyCost =
      homeKm > 0
        ? Math.round(
            (input.fuelPriceRubPerL !== null
              ? (estimateFuelL(vehicle, homeKm, 0) ?? 0) * input.fuelPriceRubPerL
              : 0) + input.operatingCostPerKm * homeKm,
          )
        : 0

    const previously = seenById.get(load.loadId || load.id)
    const oldPrice = previously?.priceRub ?? null
    const priceUp = oldPrice !== null && revenue > oldPrice * 1.05 && revenue - oldPrice >= 2000

    let kind: DutyKind
    if (fromAway) kind = "backhaul"
    else if (!previously) kind = "new"
    else if (priceUp) kind = "rate-up"
    else if (isAlmostGone(load, now)) kind = "expiring"
    else continue

    const score =
      netRub + (fromAway ? emptyCost : 0) + (kind === "new" ? 1000 : 0) + (priceUp ? 500 : 0)

    items.push({
      kind,
      atiLoadId: load.loadId || load.id,
      load,
      netRub,
      netPerKm: Math.round(netPerKm),
      score,
      title: dutyTitle(kind, load, revenue, fromAway, oldPrice),
      note: dutyNote({
        kind,
        load,
        netRub,
        netPerKm: Math.round(netPerKm),
        vehicle,
        fromAway,
        oldPrice,
        revenue,
        emptyCost,
        now,
      }),
    })
  }

  const unique = items
    .sort((a, b) => b.score - a.score)
    .filter((item, index, all) => {
      // Один груз — одна строка, даже если он пришёл из двух источников
      if (all.findIndex((other) => other.atiLoadId === item.atiLoadId) !== index) return false
      // Одна и та же заявка от разных фирм — тоже одна строка: логисту звонить
      // по одному маршруту и одной ставке, а не читать список дважды.
      const twin = all.findIndex(
        (other) =>
          cleanCity(other.load.fromCity) === cleanCity(item.load.fromCity) &&
          cleanCity(other.load.toCity) === cleanCity(item.load.toCity) &&
          loadPrice(other.load) === loadPrice(item.load) &&
          (other.load.weightKg ?? 0) === (item.load.weightKg ?? 0),
      )
      return twin === index
    })
    .slice(0, limit)

  return { items: unique, farCount }
}

/**
 * «Скоро уйдёт»: загрузка в ближайшие 12 часов.
 *
 * Окно узкое намеренно. С сутками в него попадало почти всё, и на каждом
 * просмотре дежурный повторял один и тот же список — лента превращалась в
 * шум, а логист перестаёт читать шум. 12 часов — это «звонить сейчас».
 */
function isAlmostGone(load: BuilderLoad, now: Date): boolean {
  if (!load.loadingDate) return false
  const date = new Date(load.loadingDate)
  if (Number.isNaN(date.getTime())) return false
  const hours = (date.getTime() - now.getTime()) / 3600000
  return hours >= -12 && hours <= 12
}

function dutyTitle(
  kind: DutyKind,
  load: BuilderLoad,
  revenue: number,
  fromAway: AwayVehicle | undefined,
  oldPrice: number | null,
): string {
  const where = `${cleanCity(load.fromCity)} → ${cleanCity(load.toCity)}`
  if (kind === "backhaul" && fromAway) {
    const tail = fromAway.kind === "стоит" ? "стоит" : "приедет"
    return `Обратка: ${where} · ${formatMoney(revenue)}`
  }
  if (kind === "rate-up" && oldPrice !== null) {
    const delta = revenue - oldPrice
    return `Подорожал: ${where} · +${formatMoney(delta)}`
  }
  if (kind === "expiring") return `Скоро уйдёт: ${where} · ${formatMoney(revenue)}`
  return `Новый груз: ${where} · ${formatMoney(revenue)}`
}

function dutyNote(input: {
  kind: DutyKind
  load: BuilderLoad
  netRub: number
  netPerKm: number
  vehicle: BuilderVehicle
  fromAway: AwayVehicle | undefined
  oldPrice: number | null
  revenue: number
  emptyCost: number
  now: Date
}): string {
  const { kind, load, netRub, netPerKm, vehicle, fromAway, oldPrice, emptyCost } = input
  const money = `останется ${formatMoney(netRub)} (${netPerKm} ₽/км), машина ${vehicle.plate}`

  if (kind === "backhaul" && fromAway) {
    const tail = fromAway.kind === "стоит" ? "уже стоит" : "приедет"
    const saving =
      emptyCost > 0
        ? ` Вместо ${formatMoney(emptyCost)} на порожний ход домой.`
        : ""
    // Госномер уже назван в начале фразы — второй раз «машина <номер>» лишний.
    const moneyNoPlate = `останется ${formatMoney(netRub)} (${netPerKm} ₽/км)`
    return `${fromAway.plate} ${tail} ${inCity(fromAway.city)}. ${moneyNoPlate}, груз везёт эта же машина.${saving}`
  }
  if (kind === "rate-up" && oldPrice !== null) {
    return `Было ${formatMoney(oldPrice)}, стало ${formatMoney(input.revenue)}. ${money}.`
  }
  if (kind === "expiring") {
    return `Загрузка ${formatDateShortRu(load.loadingDate)} — времени договориться мало. ${money}.`
  }
  return `${money}. Раньше дежурный его не видел.`
}

function formatDateShortRu(value: Date | string | null | undefined): string {
  if (!value) return "без даты"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "без даты"
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
}

/** Итог для экрана: одной фразой, что нашёл дежурный. */
export function dutyHeadline(items: DutyItem[], farCount = 0): string {
  if (items.length === 0) {
    if (farCount > 0) {
      return (
        `Рядом нового нет. Дальних выгодных рейсов на бирже: ${farCount} — ` +
        "их место в помощнике сборки, дежурный показывает только то, что можно взять сейчас."
      )
    }
    return "Нового ничего: всё, что есть на бирже, дежурный уже показывал."
  }
  const backhauls = items.filter((item) => item.kind === "backhaul")
  const best = items[0]
  const parts = [
    `${formatCount(items.length, ["груз", "груза", "грузов"])} стоит внимания`,
  ]
  if (backhauls.length > 0) {
    parts.push(
      `${formatCount(backhauls.length, ["обратка", "обратки", "обраток"])} под ваши машины`,
    )
  }
  parts.push(`лучший: ${best.title}`)
  const tail =
    farCount > 0
      ? ` Плюс ${farCount} дальних — в помощнике сборки.`
      : ""
  return `${parts.join(", ")}.${tail}`
}

// ---------------------------------------------------------------------------
// Сводка по машинам: где они и чего им не хватает
// ---------------------------------------------------------------------------

export interface DutyVehicleHint {
  plate: string
  city: string
  kind: AwayVehicle["kind"]
  /** Сколько грузов из этого города есть на бирже прямо сейчас */
  loadsThere: number
  /** Сколько из них влезает в машину */
  fitting: number
  note: string
}

/**
 * «А421ВС750 приедет в Казань, там 31 груз, но ни один не влезает» — этот
 * разбор уже спас один маршрут: логист звонит фрахтователю и договаривается
 * о весе, вместо того чтобы гнать 720 км пустым.
 */
export function vehicleHints(input: {
  away: AwayVehicle[]
  loads: BuilderLoad[]
  vehicles: BuilderVehicle[]
}): DutyVehicleHint[] {
  const byPlate = new Map((input.vehicles ?? []).map((vehicle) => [vehicle.plate, vehicle]))
  const hints: DutyVehicleHint[] = []
  for (const away of input.away ?? []) {
    const there = (input.loads ?? []).filter((load) => samePlace(load.fromCity, away.city))
    const vehicle = byPlate.get(away.plate)
    const fitting = vehicle
      ? there.filter((load) => loadFitsVehicle(load, vehicle) && loadPrice(load) > 0).length
      : 0
    const withPrice = there.filter((load) => loadPrice(load) > 0).length
    let note: string
    if (there.length === 0) {
      note = `${FromCity(away.city)} грузов на бирже нет — возвращаться пустым`
    } else if (fitting === 0) {
      note =
        `${InCity(away.city)} ${formatCount(withPrice, ["груз", "груза", "грузов"])} со ставкой, ` +
        `но ни один не влезает в машину`
    } else {
      note =
        `${InCity(away.city)} ${formatCount(fitting, ["подходящий груз", "подходящих груза", "подходящих грузов"])}`
    }
    hints.push({
      plate: away.plate,
      // Город, а не адрес: «Калуга, улица Московская, 289» в строке «машина → …»
      // читается как ошибка вёрстки.
      city: shortCity(away.city),
      kind: away.kind,
      loadsThere: there.length,
      fitting,
      note,
    })
  }
  return hints
}

/** Города, где сейчас машины: из рейсов и заказов. */
export function awayFromTrips(
  trips: { plate: string | null; city: string | null; kind: AwayVehicle["kind"] }[],
): AwayVehicle[] {
  const out: AwayVehicle[] = []
  for (const trip of trips) {
    if (!trip.plate || !trip.city) continue
    if (!String(trip.city).trim()) continue
    out.push({ plate: trip.plate, city: trip.city, kind: trip.kind })
  }
  return out
}
