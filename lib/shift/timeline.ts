// lib/shift/timeline.ts
//
// Состояния смены водителя и таймлайн — чистые функции.
//
// Зачем: кнопки на главном экране водителя («в пути», «погрузка», «выгрузка»,
// «отдых»…) — это не украшение, а способ измерить время. Сколько водитель
// простоял на погрузке, сколько ждал у ворот, сколько ехал — из этих же
// секунд собирается аналитика по организации.
//
// Файл намеренно чистый: без Prisma, без Next.js. Его можно импортировать и в
// клиентские компоненты, и в роуты, и тестировать без базы. Вся математика
// времени — здесь и только здесь, чтобы в экране и в отчёте были одни цифры.
//
// Хранение: DriverShift.status + DriverShift.lastStatusChangeAt плюс журнал
// ShiftEvent (type: "status", metadata: {from,to,seconds,orderId,bucket}).
// Итоги по смене (totalLoadingSeconds и другие) — производные от журнала:
// их можно пересчитать в любой момент, поэтому в БД они не расходятся.

// ---------------------------------------------------------------------------
// Статусы и их группы
// ---------------------------------------------------------------------------

/** Группа, в которую попадает время статуса. Из них складывается аналитика. */
export type ShiftBucket =
  | "driving"
  | "loading"
  | "unloading"
  | "waiting"
  | "resting"
  | "fueling"
  | "other"

/** Что это за статус по смыслу — от этого зависит место в потоке рейса. */
export type ShiftStatusKind = "idle" | "move" | "point" | "rest" | "service"

export interface ShiftStatusMeta {
  id: string
  /** Подпись на кнопке водителя */
  label: string
  /** Короткая подпись для таймлайна */
  short: string
  bucket: ShiftBucket
  kind: ShiftStatusKind
  /** Цвет (Tailwind-класс фона) — один и тот же на экране и в отчёте */
  color: string
  /** Пояснение: что означает статус для водителя */
  hint: string
}

/**
 * Все состояния, в которых может находиться водитель в смене.
 *
 * Порядок важен: он же порядок кнопок на экране управления.
 * `waiting` — «жду рейс», `waiting_point` — «стою на точке»: это разные
 * ситуации с разным смыслом для аналитики, поэтому и статусы разные.
 */
export const SHIFT_STATUSES: readonly ShiftStatusMeta[] = [
  {
    id: "driving",
    label: "В пути",
    short: "Путь",
    bucket: "driving",
    kind: "move",
    color: "bg-orange-500",
    hint: "Еду по маршруту",
  },
  {
    id: "loading",
    label: "Погрузка",
    short: "Погрузка",
    bucket: "loading",
    kind: "point",
    color: "bg-blue-500",
    hint: "Принял груз, стою на погрузке",
  },
  {
    id: "unloading",
    label: "Выгрузка",
    short: "Выгрузка",
    bucket: "unloading",
    kind: "point",
    color: "bg-emerald-500",
    hint: "Отдаю груз на выгрузке",
  },
  {
    id: "waiting_point",
    label: "Ожидание",
    short: "Ожидание",
    bucket: "waiting",
    kind: "point",
    color: "bg-gray-500",
    hint: "Жду на точке: ворот, документов, очереди",
  },
  {
    id: "fueling",
    label: "Заправка",
    short: "Заправка",
    bucket: "fueling",
    kind: "service",
    color: "bg-purple-500",
    hint: "Заправляюсь, чек в фото",
  },
  {
    id: "resting",
    label: "Отдых",
    short: "Отдых",
    bucket: "resting",
    kind: "rest",
    color: "bg-amber-500",
    hint: "Перерыв 15–45 минут",
  },
  {
    id: "sleeping",
    label: "Сон",
    short: "Сон",
    bucket: "resting",
    kind: "rest",
    color: "bg-indigo-500",
    hint: "Ночной отдых между сменами",
  },
  {
    id: "waiting",
    label: "Ожидаю рейс",
    short: "Ожидание рейса",
    bucket: "waiting",
    kind: "idle",
    color: "bg-gray-600",
    hint: "Смена идёт, задания нет",
  },
] as const

export const SHIFT_STATUS_IDS = SHIFT_STATUSES.map((s) => s.id)

const STATUS_BY_ID = new Map(SHIFT_STATUSES.map((s) => [s.id, s]))

export function shiftStatusMeta(status: string | null | undefined): ShiftStatusMeta | undefined {
  if (!status) return undefined
  return STATUS_BY_ID.get(status)
}

/** Человекочитаемая подпись статуса; неизвестное значение не роняет экран. */
export function shiftStatusLabel(status: string | null | undefined): string {
  return shiftStatusMeta(status)?.label ?? (status || "—")
}

/** Группа времени: неизвестный статус не теряется, а уходит в «прочее». */
export function bucketOf(status: string | null | undefined): ShiftBucket {
  return shiftStatusMeta(status)?.bucket ?? "other"
}

/** Статусы, которые водитель может выставить кнопкой. */
export const SELECTABLE_SHIFT_STATUSES = SHIFT_STATUSES

// ---------------------------------------------------------------------------
// Поток рейса: что обычно идёт после текущего статуса
// ---------------------------------------------------------------------------

/**
 * Типичная цепочка рейса:
 *   ожидаю рейс → в пути → погрузка → в пути → выгрузка → в пути → (догруз) …
 *
 * Экран показывает не плоский список кнопок, а шаги рейса: водитель видит, на
 * каком он шаге и что дальше. `FLOW` — порядок шагов точки (погрузка/выгрузка),
 * `SUGGESTED_NEXT` — какие кнопки имеет смысл нажать сейчас.
 */
export const TRIP_FLOW = ["driving", "loading", "driving", "unloading"] as const

const SUGGESTED_NEXT: Record<string, readonly string[]> = {
  waiting: ["driving", "resting", "fueling"],
  driving: ["loading", "unloading", "waiting_point", "resting", "fueling"],
  loading: ["driving", "waiting_point", "unloading"],
  unloading: ["driving", "loading", "waiting"],
  waiting_point: ["loading", "unloading", "driving", "resting"],
  fueling: ["driving", "loading"],
  resting: ["driving", "loading", "waiting_point"],
  sleeping: ["driving", "waiting"],
}

/** Какие статусы логично выставить следующим — для подсказки на экране. */
export function suggestedNext(status: string | null | undefined): string[] {
  if (!status) return [...SUGGESTED_NEXT.waiting]
  return [...(SUGGESTED_NEXT[status] ?? SUGGESTED_NEXT.waiting)]
}

/**
 * Номер шага рейса для полоски прогресса: 1 — в пути к точке, 2 — погрузка,
 * 3 — выгрузка, 0 — вне рейса. Догруз считается новой погрузкой.
 */
export function tripStep(status: string | null | undefined): number {
  switch (status) {
    case "loading":
      return 2
    case "unloading":
      return 3
    case "driving":
    case "waiting_point":
      return 1
    default:
      return 0
  }
}

// ---------------------------------------------------------------------------
// Итоги по смене
// ---------------------------------------------------------------------------

export type ShiftTotals = Record<ShiftBucket, number>

export function emptyTotals(): ShiftTotals {
  return { driving: 0, loading: 0, unloading: 0, waiting: 0, resting: 0, fueling: 0, other: 0 }
}

/** Секунды из интервала, обрезанные по [from, to] (никогда не отрицательные). */
export function secondsBetween(from: Date | string, to: Date | string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.floor(ms / 1000)
}

export interface StatusChangeInput {
  /** Статус, который был (null — смена только начата) */
  previous: string | null
  /** Новый статус */
  next: string
  /** Когда предыдущий статус стал действительным */
  since: Date | string
  /** Момент переключения */
  now: Date | string
  /** Текущие итоги по смене */
  totals: ShiftTotals
  /** Секунды непрерывного вождения до переключения */
  drivingSinceRestSeconds?: number
}

export interface StatusChangeResult {
  /** Итоги после переключения */
  totals: ShiftTotals
  /** Сколько секунд длился предыдущий статус */
  seconds: number
  /** Секунды непрерывного вождения после переключения */
  drivingSinceRestSeconds: number
}

/**
 * Переключение статуса: время предыдущего состояния добавляется в его группу,
 * счётчик непрерывного вождения растёт на время в пути и обнуляется на отдыхе.
 *
 * Повторное включение того же статуса даёт 0 секунд — двойное нажатие кнопки
 * не должно удваивать время.
 */
export function applyStatusChange(input: StatusChangeInput): StatusChangeResult {
  const seconds = secondsBetween(input.since, input.now)
  const totals = { ...input.totals }
  if (input.previous) {
    totals[bucketOf(input.previous)] += seconds
  }

  const nextBucket = bucketOf(input.next)
  const before = input.drivingSinceRestSeconds ?? 0

  let drivingSinceRestSeconds = before
  if (nextBucket === "driving") {
    drivingSinceRestSeconds = before + seconds
  } else if (nextBucket === "resting") {
    // Отдых (в том числе сон) сбрасывает непрерывное вождение — это и есть
    // смысл нормы: перерыв засчитывается, только если водитель реально стоял.
    drivingSinceRestSeconds = 0
  }

  return { totals, seconds, drivingSinceRestSeconds }
}

/** Сумма всех групп = учтённое время смены. */
export function totalSeconds(totals: ShiftTotals): number {
  return Object.values(totals).reduce((sum, value) => sum + value, 0)
}

// ---------------------------------------------------------------------------
// Таймлайн
// ---------------------------------------------------------------------------

export interface ShiftStatusEvent {
  /** Момент переключения */
  at: Date | string
  /** Статус, который начался */
  status: string
  /** Предыдущий статус (если известен) */
  from?: string | null
  /** Заказ, к которому относится статус (погрузка конкретной точки) */
  orderId?: string | null
}

export interface ShiftSegment {
  status: string
  from: Date
  to: Date
  seconds: number
  orderId: string | null
}

/**
 * Таймлайн смены: из журнала переключений + времени начала/конца смены.
 * Незакрытый последний статус идёт до `until` (обычно «сейчас»).
 */
export function buildTimeline(params: {
  events: readonly ShiftStatusEvent[]
  shiftStart: Date | string
  until: Date | string
  /**
   * Статус, если журнал пуст: смены, открытые до появления журнала, не должны
   * выглядеть как «нулевое время» — их текущий статус идёт с начала смены.
   */
  initialStatus?: string | null
}): ShiftSegment[] {
  const sorted = [...params.events].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )

  const segments: ShiftSegment[] = []
  let cursor = new Date(params.shiftStart)
  // Легаси-фолбэк: смена без журнала считается одним отрезком текущего
  // статуса. Если журнал есть, он главный — иначе первый его статус
  // «растянулся» бы назад на всё время до первого переключения.
  let current: { status: string; orderId: string | null } | null =
    sorted.length === 0 && params.initialStatus
      ? { status: params.initialStatus, orderId: null }
      : null

  for (const event of sorted) {
    const at = new Date(event.at)

    if (!current) {
      // Первое событие описывает статус с начала смены: курсор не двигаем,
      // иначе минуты между «смена начата» и первым переключением выпали бы
      // из аналитики. Событие ровно на момент старта — норма, а не дубль.
      current = { status: event.status, orderId: event.orderId ?? null }
      continue
    }

    // События вне порядка (часы съехали назад) не двигают время вспять
    if (at < cursor) continue

    // Событие ровно на границе — мгновенное переключение: отрезок нулевой,
    // но статус обязан обновиться, иначе он «растянется» на весь отрезок.
    if (at > cursor) {
      segments.push({
        status: current.status,
        from: cursor,
        to: at,
        seconds: secondsBetween(cursor, at),
        orderId: current.orderId,
      })
      cursor = at
    }
    current = { status: event.status, orderId: event.orderId ?? null }
  }

  const until = new Date(params.until)
  if (current && until > cursor) {
    segments.push({
      status: current.status,
      from: cursor,
      to: until,
      seconds: secondsBetween(cursor, until),
      orderId: current.orderId,
    })
  }

  return segments
}

/** Итоги по группам из таймлайна — те же числа, что и в DriverShift. */
export function totalsFromTimeline(segments: readonly ShiftSegment[]): ShiftTotals {
  const totals = emptyTotals()
  for (const segment of segments) {
    totals[bucketOf(segment.status)] += segment.seconds
  }
  return totals
}

export interface BucketSummary {
  bucket: ShiftBucket
  seconds: number
  /** Сколько раз водитель входил в эту группу (погрузок, выгрузок, перерывов) */
  stops: number
}

/** Сводка по группам: сколько времени и сколько остановок — для аналитики. */
export function summarizeTimeline(segments: readonly ShiftSegment[]): BucketSummary[] {
  const order: ShiftBucket[] = ["driving", "loading", "unloading", "waiting", "resting", "fueling", "other"]
  const map = new Map<ShiftBucket, BucketSummary>()
  for (const bucket of order) map.set(bucket, { bucket, seconds: 0, stops: 0 })

  for (const segment of segments) {
    const entry = map.get(bucketOf(segment.status))
    if (!entry) continue
    entry.seconds += segment.seconds
    // Начало группы считается остановкой только если до неё была другая группа
    entry.stops += 1
  }

  return order.map((bucket) => map.get(bucket)!).filter((entry) => entry.seconds > 0 || entry.stops > 0)
}

/** «2 ч 15 мин», «45 мин», «12 с» — коротко, как на кнопке. */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0))
  if (safe < 60) return `${safe} с`
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  if (h > 0) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
  return `${m} мин`
}

/** «1 ч 05 мин» — для точного таймера на экране (с секундами до минуты). */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const pad = (value: number) => String(value).padStart(2, "0")
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}
