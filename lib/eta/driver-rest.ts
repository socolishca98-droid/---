// lib/eta/driver-rest.ts
//
// Перерывы и отдых водителя в прогнозе рейса.
//
// По ТЗ §10: нормы не зашиты жёстко под одну страну. Правила конфигурируются,
// применённая юрисдикция указывается в результате, и если данных о предыдущем
// времени управления нет — честно предупреждаем, что соответствие не доказано.
//
// Здесь — планирование ПЕРЕД рейсом: куда вставятся паузы. Фактические события
// отдыха уже считает lib/rest/norms.ts, и этот модуль с ним не конфликтует:
// один планирует, другой фиксирует.

export interface RestRules {
  /** Юрисдикция правил — попадает в результат для объяснения */
  jurisdiction: string
  /** Максимум минут непрерывного движения до обязательного перерыва */
  maxDrivingMinutes: number
  /** Длительность обязательного перерыва, минуты */
  breakMinutes: number
  /** Максимум минут движения в смене до обязательного отдыха */
  maxShiftDrivingMinutes: number
  /** Длительность ежедневного отдыха, минуты */
  dailyRestMinutes: number
  /** Многоводительский экипаж: перерывы всё равно нужны, но сменяются */
  multiDriver: boolean
}

/**
 * Правила по умолчанию — российская практика междугородных перевозок.
 *
 * Это КОНФИГУРИРУЕМЫЕ значения, а не юридическая консультация: реальные нормы
 * зависят от типа перевозки, приказа и договора. Через FleetSettings их можно
 * переопределить (см. applyRestRules).
 */
export const DEFAULT_REST_RULES: RestRules = {
  jurisdiction: "RU (настройка по умолчанию)",
  maxDrivingMinutes: 270, // 4.5 часа непрерывно
  breakMinutes: 45,
  maxShiftDrivingMinutes: 600, // 10 часов движения в смену
  dailyRestMinutes: 660, // 11 часов
  multiDriver: false,
}

export interface RestBreak {
  /** После какого сегмента вставляется пауза */
  afterSegmentIndex: number
  minutes: number
  kind: "break" | "daily_rest"
  reason: string
}

export interface RestPlan {
  breaks: RestBreak[]
  /** Суммарные минуты пауз */
  totalMinutes: number
  /** Применённые правила (для объяснения) */
  rules: RestRules
  /** Данных о предыдущем времени управления нет — соответствие не доказано */
  priorDrivingUnknown: boolean
  warning?: string
}

export interface RestPlanInput {
  /** Минуты движения по сегментам в базовом сценарии */
  segmentDrivingMinutes: readonly number[]
  rules?: Partial<RestRules>
  /** Минуты, уже отработанные водителем до выезда (если известны) */
  priorDrivingMinutes?: number
}

/**
 * Планирует паузы: разбивает движение на порции до maxDrivingMinutes.
 *
 * Одноводительский экипаж: после каждых maxDrivingMinutes движения — перерыв
 * breakMinutes; после maxShiftDrivingMinutes — ежедневный отдых.
 * Многоводительский: перерывы сдвигаются на стык смен, поэтому в планировании
 * остаётся только один перерыв на длинную порчу непрерывности — пометка об этом
 * честно пишется в reason.
 */
export function planRestBreaks(input: RestPlanInput): RestPlan {
  const rules: RestRules = { ...DEFAULT_REST_RULES, ...(input.rules || {}) }
  const breaks: RestBreak[] = []

  let continuous = input.priorDrivingMinutes ?? 0
  let shiftTotal = input.priorDrivingMinutes ?? 0
  let totalMinutes = 0

  for (let index = 0; index < input.segmentDrivingMinutes.length; index += 1) {
    const segment = input.segmentDrivingMinutes[index]
    continuous += segment
    shiftTotal += segment

    if (continuous >= rules.maxDrivingMinutes) {
      const minutes = rules.breakMinutes
      breaks.push({
        afterSegmentIndex: index,
        minutes,
        kind: "break",
        reason: `непрерывное движение ${Math.round(continuous)} мин ≥ лимита ${rules.maxDrivingMinutes} мин`,
      })
      totalMinutes += minutes
      continuous = 0
    }

    if (shiftTotal >= rules.maxShiftDrivingMinutes) {
      const minutes = rules.dailyRestMinutes
      breaks.push({
        afterSegmentIndex: index,
        minutes,
        kind: "daily_rest",
        reason: `движение в смене ${Math.round(shiftTotal)} мин ≥ лимита ${rules.maxShiftDrivingMinutes} мин`,
      })
      totalMinutes += minutes
      shiftTotal = 0
    }
  }

  const priorDrivingUnknown = input.priorDrivingMinutes === undefined

  return {
    breaks,
    totalMinutes,
    rules,
    priorDrivingUnknown,
    warning: priorDrivingUnknown
      ? "Данных о времени управления до выезда нет: соответствие нормам труда и отдыха не доказано"
      : undefined,
  }
}

// ---------------------------------------------------------------------------
// Инкрементальный планировщик: перерыв вставляется В ЧАСЫ рейса
// ---------------------------------------------------------------------------

/**
 * Состояние планирования перерывов для одного прохода по сегментам.
 *
 * Зачем отдельно от planRestBreaks: planRestBreaks получает готовый список
 * минут движения и возвращает план целиком. Но время прибытия в КАЖДЫЙ
 * следующий сегмент зависит от того, когда вставлен перерыв, — а это
 * известно только в момент прохода. Поэтому планировщик Stateful: его
 * дёргают после каждого сегмента, и он говорит, надо ли вставить паузу
 * ПЕРЕД следующим сегментом.
 *
 * Перерыв сдвигает часы: последующие сегменты считаются на более поздний
 * момент, поэтому час пик, сезон и погода берутся уже сдвинутые.
 */
export interface RestTracker {
  /** Вызывать после каждого сегмента. null — перерыв не нужен. */
  afterSegment(segmentIndex: number, drivingMinutes: number): RestBreak | null
  /** Сколько минут пауз накоплено (для итога и объяснения) */
  totalMinutes(): number
  /** Все вставленные паузы */
  breaks(): RestBreak[]
  /** Применённые правила — для объяснения в интерфейсе */
  rules(): RestRules
  /** Неизвестно время управления до выезда — соответствие не доказано */
  priorDrivingUnknown(): boolean
}

/**
 * Создаёт планировщик перерывов.
 *
 * Остановки (погрузка, выгрузка) счётчик непрерывного движения НЕ сбрасывают:
 * длительная выгрузка не гарантирует условий перерыва, и считать её отдыхом —
 * это юридическое утверждение, которого мы делать не вправе. Планирование
 * поэтому консервативное: перерыв ставится по накопленному времени движения.
 */
export function createRestTracker(
  rules?: Partial<RestRules>,
  priorDrivingMinutes?: number,
): RestTracker {
  const resolved: RestRules = { ...DEFAULT_REST_RULES, ...(rules || {}) }
  const breaks: RestBreak[] = []

  let continuous = priorDrivingMinutes ?? 0
  let shiftTotal = priorDrivingMinutes ?? 0

  return {
    afterSegment(segmentIndex: number, drivingMinutes: number): RestBreak | null {
      if (!Number.isFinite(drivingMinutes) || drivingMinutes <= 0) return null

      continuous += drivingMinutes
      shiftTotal += drivingMinutes

      // Сначала проверяется смена: она длиннее и поглощает обычный перерыв
      if (shiftTotal >= resolved.maxShiftDrivingMinutes) {
        const rest: RestBreak = {
          afterSegmentIndex: segmentIndex,
          minutes: resolved.dailyRestMinutes,
          kind: "daily_rest",
          reason: `движение в смене ${Math.round(shiftTotal)} мин ≥ лимита ${resolved.maxShiftDrivingMinutes} мин`,
        }
        breaks.push(rest)
        shiftTotal = 0
        continuous = 0
        return rest
      }

      if (continuous >= resolved.maxDrivingMinutes) {
        const rest: RestBreak = {
          afterSegmentIndex: segmentIndex,
          minutes: resolved.breakMinutes,
          kind: "break",
          reason: `непрерывное движение ${Math.round(continuous)} мин ≥ лимита ${resolved.maxDrivingMinutes} мин`,
        }
        breaks.push(rest)
        continuous = 0
        return rest
      }

      return null
    },
    totalMinutes: () => breaks.reduce((sum, item) => sum + item.minutes, 0),
    breaks: () => [...breaks],
    rules: () => resolved,
    priorDrivingUnknown: () => priorDrivingMinutes === undefined,
  }
}
