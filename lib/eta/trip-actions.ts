// lib/eta/trip-actions.ts
//
// Какие действия водителю доступны на текущем этапе рейса.
//
// Зачем отдельный модуль без базы: правила показа кнопок нужны и серверу
// (проверить команду), и браузеру (не показывать невозможное). Если правила
// живут в двух местах, они расходятся, и кнопка, нажатая у водителя,
// оказывается отклонена сервером — или наоборот.
//
// Главное правило ТЗ: кнопки показываются по ТЕКУЩЕМУ этапу, а не все сразу.
// Второе: этап нельзя произвольно пропустить. Команда «завершить операцию»
// без отметки «начал» недействительна, «прибыл» на недоеханной точке —
// недействительна.
//
// Здесь нет ни базы, ни сети: на входе — этапы рейса (из lib/eta/trip.ts) и
// отметки фактического времени. Проверка принадлежности рейса организации
// водителя — за пределами этого файла, в API.

import type { TripEtaResult } from "./trip"

/** Команды, которые водитель может отдать. */
export const TRIP_COMMANDS = [
  "start_trip", // начать рейс
  "start_driving", // начать движение
  "arrive_point", // прибыл в точку
  "start_operation", // начал погрузку/выгрузку (или другую операцию)
  "finish_operation", // завершил операцию
  "next_leg", // следующее плечо
  "return_to_base", // возвращение на базу
  "finish_trip", // завершить рейс
  "report_problem", // сообщить о проблеме
] as const

export type TripCommand = (typeof TRIP_COMMANDS)[number]

export interface AvailableAction {
  command: TripCommand
  label: string
  /** Кнопка опасная (завершение рейса) — рисуем иначе */
  danger?: boolean
  /** Основное действие этапа — крупная кнопка */
  primary?: boolean
}

export interface BlockedAction {
  command: TripCommand
  /** Почему нельзя — показываем водителю дословно */
  reason: string
}

export interface TripActionState {
  /** Что можно сделать прямо сейчас */
  available: AvailableAction[]
  /** Что было бы логично, но нельзя (с причиной) */
  blocked: BlockedAction[]
  /** Индекс этапа, на котором находится водитель (null — все закрыты) */
  currentStageIndex: number | null
  /** Все этапы рейса закрыты */
  finished: boolean
}

/**
 * Этап, на котором находится водитель: первый незавершённый.
 *
 * ВАЖНО: это НЕ trip.currentStageIndex — тот указывает на этап, который уже
 * НАЧАЛИ но не закончили. Для рейса, в котором водитель ещё не отметил
 * прибытие на первую точку, такой этап отсутствует (null), хотя действовать
 * надо на нулевом. Поэтому здесь берём первый не completed.
 */
function actionStageIndex(trip: TripEtaResult): number | null {
  const index = trip.stages.findIndex((stage) => stage.status !== "completed")
  return index === -1 ? null : index
}

const LABELS: Record<TripCommand, string> = {
  start_trip: "Начать рейс",
  start_driving: "Начать движение",
  arrive_point: "Прибыл",
  start_operation: "Начать операцию",
  finish_operation: "Завершить операцию",
  next_leg: "Следующее плечо",
  return_to_base: "Возвращение на базу",
  finish_trip: "Завершить рейс",
  report_problem: "Сообщить о проблеме",
}

/** Подписи операций по виду этапа. */
function operationLabel(kind: string): string {
  switch (kind) {
    case "loading":
      return "Начать погрузку"
    case "unloading":
      return "Начать выгрузку"
    case "documents":
      return "Начать оформление"
    case "waiting":
      return "Начать ожидание"
    default:
      return "Начать операцию"
  }
}

function finishOperationLabel(kind: string): string {
  switch (kind) {
    case "loading":
      return "Погрузка завершена"
    case "unloading":
      return "Выгрузка завершена"
    case "documents":
      return "Оформление завершено"
    case "waiting":
      return "Ожидание завершено"
    default:
      return "Операция завершена"
  }
}

/**
 * Доступные действия для рейса.
 *
 * `routeStarted` — рейс запущен (Route.startedAt). Без него водителю
 * доступна только команда start_trip: до начала рейса отмечать прибытие
 * на точку некуда, и такие отметки сломали бы историю.
 */
export function availableTripActions(trip: TripEtaResult, routeStarted: boolean): TripActionState {
  const available: AvailableAction[] = []
  const blocked: BlockedAction[] = []

  const currentIndex = actionStageIndex(trip)
  const current = currentIndex == null ? null : trip.stages[currentIndex] ?? null

  if (!routeStarted) {
    available.push({ command: "start_trip", label: LABELS.start_trip, primary: true })
    blocked.push({
      command: "start_driving",
      reason: "Сначала начните рейс",
    })
  } else if (!current) {
    // Рейс начат и все этапы закрыты — остаётся только завершить рейс
    available.push({ command: "finish_trip", label: LABELS.finish_trip, danger: true, primary: true })
  } else if (current.kind === "driving" || current.kind === "return_to_base") {
    // Движение: начать движение, затем прибыть в точку
    if (current.actualStartAt) {
      available.push({ command: "arrive_point", label: LABELS.arrive_point, primary: true })
    } else {
      available.push({ command: "start_driving", label: LABELS.start_driving, primary: true })
      blocked.push({ command: "arrive_point", reason: "Сначала начните движение" })
    }
  } else if (current.kind === "rest") {
    if (current.actualStartAt) {
      available.push({ command: "next_leg", label: "Отдых завершён — дальше", primary: true })
    } else {
      blocked.push({ command: "next_leg", reason: "Отдых ещё не начат" })
    }
  } else {
    // Операция: погрузка, выгрузка, документы, ожидание
    if (current.actualStartAt) {
      available.push({ command: "finish_operation", label: finishOperationLabel(current.kind), primary: true })
    } else {
      available.push({ command: "start_operation", label: operationLabel(current.kind), primary: true })
      blocked.push({
        command: "finish_operation",
        reason: "Сначала отметьте начало операции",
      })
    }
  }

  // Завершить рейс можно, только когда незакрытых этапов не осталось
  const pending = trip.stages.filter((stage) => !stage.completed)
  if (pending.length === 0 && routeStarted && current) {
    blocked.push({ command: "finish_trip", reason: "Сначала завершите текущий этап" })
  }

  // Сообщить о проблеме можно ВСЕГДА: водитель может не уехать из-за
  // неисправной машины ещё до начала рейса, и молчать в этот момент нельзя.
  available.push({ command: "report_problem", label: LABELS.report_problem })

  return {
    available,
    blocked,
    currentStageIndex: currentIndex,
    finished: routeStarted && trip.stages.every((stage) => stage.completed),
  }
}

export interface CommandCheck {
  ok: boolean
  /** Причина отказа — дословно водителю */
  reason?: string
  /** Этап, на который команда воздействует */
  stageIndex?: number
}

/**
 * Проверка команды. Тот же набор правил, что и availableTripActions, поэтому
 * кнопка не может быть одновременно показана и отклонена.
 *
 * Команда без указанного этапа применяется к текущему. Явно указанный чужой
 * этап — отказ: иначе можно «закрыть» точку, до которой водитель не доехал.
 */
export function checkTripCommand(
  trip: TripEtaResult,
  routeStarted: boolean,
  command: TripCommand,
  requestedStageIndex?: number | null,
): CommandCheck {
  if (!routeStarted && command !== "start_trip" && command !== "report_problem") {
    return { ok: false, reason: "Рейс не начат. Сначала нажмите «Начать рейс»" }
  }

  // «Сообщить о проблеме» доступно всегда на начавшемся рейсе — иначе
  // застрявший водитель не сможет ничем отчитаться
  if (command === "report_problem") {
    return { ok: true, stageIndex: actionStageIndex(trip) ?? undefined }
  }

  if (command === "start_trip") {
    if (routeStarted) return { ok: false, reason: "Рейс уже начат" }
    return { ok: true, stageIndex: 0 }
  }

  const currentIndex = actionStageIndex(trip)
  const current = currentIndex == null ? null : trip.stages[currentIndex] ?? null

  if (requestedStageIndex != null && currentIndex != null && requestedStageIndex !== currentIndex) {
    return {
      ok: false,
      reason: "Этап не является текущим. Действия выполняются по порядку",
    }
  }

  if (command === "finish_trip") {
    const pending = trip.stages.filter((stage) => !stage.completed)
    if (pending.length > 0) {
      return {
        ok: false,
        reason: `Остались незавершённые этапы (${pending.length}). Их нельзя пропускать`,
      }
    }
    return { ok: true, stageIndex: currentIndex ?? undefined }
  }

  if (!current) {
    return { ok: false, reason: "Нет текущего этапа: рейс завершён или не начат" }
  }

  switch (command) {
    case "start_driving":
      if (current.kind !== "driving" && current.kind !== "return_to_base") {
        return { ok: false, reason: "Сейчас не движение" }
      }
      if (current.actualStartAt) {
        return { ok: false, reason: "Движение уже начато" }
      }
      return { ok: true, stageIndex: currentIndex! }

    case "arrive_point":
      if (current.kind !== "driving" && current.kind !== "return_to_base") {
        return { ok: false, reason: "Сейчас не движение" }
      }
      if (!current.actualStartAt) {
        return { ok: false, reason: "Движение не начато: отмечать прибытие нечему" }
      }
      if (current.actualEndAt) {
        return { ok: false, reason: "Прибытие уже отмечено" }
      }
      return { ok: true, stageIndex: currentIndex! }

    case "start_operation":
      if (current.kind === "driving" || current.kind === "return_to_base") {
        return { ok: false, reason: "Сейчас движение: операции ещё не начинались" }
      }
      if (current.actualStartAt) {
        return { ok: false, reason: "Операция уже начата" }
      }
      return { ok: true, stageIndex: currentIndex! }

    case "finish_operation":
      if (current.kind === "driving" || current.kind === "return_to_base") {
        return { ok: false, reason: "Сейчас движение: операцию нельзя завершить" }
      }
      if (!current.actualStartAt) {
        return { ok: false, reason: "Операция не начата" }
      }
      if (current.actualEndAt) {
        return { ok: false, reason: "Операция уже завершена" }
      }
      return { ok: true, stageIndex: currentIndex! }

    case "next_leg":
      if (current.kind !== "rest" && current.kind !== "driving" && current.kind !== "return_to_base") {
        return { ok: false, reason: "Сейчас не движение и не отдых" }
      }
      if (current.kind === "rest" && !current.actualStartAt) {
        return { ok: false, reason: "Отдых не начат" }
      }
      return { ok: true, stageIndex: currentIndex! }

    case "return_to_base": {
      // Возврат на базу — последнее плечо, доступен только на нём
      if (current.kind !== "return_to_base") {
        const hasReturn = trip.stages.some((stage) => stage.kind === "return_to_base")
        if (!hasReturn) return { ok: false, reason: "В рейсе нет возврата на базу" }
        return { ok: false, reason: "Возврат на базу будет после выполнения всех точек" }
      }
      return { ok: true, stageIndex: currentIndex! }
    }

    default:
      return { ok: false, reason: "Неизвестная команда" }
  }
}
