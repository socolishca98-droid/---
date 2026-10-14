// lib/eta/weather/model.ts
//
// Погодная модель: коэффициент времени в пути по условиям.
//
// Диапазоны взяты из ТЗ как начальные гипотезы, требующие калибровки:
//
//   Сухое покрытие, хорошая видимость   1.00
//   Слабый дождь                        1.03–1.07
//   Умеренный дождь                     1.08–1.15
//   Сильный дождь                       1.15–1.30
//   Слабый снег                         1.05–1.15
//   Умеренный снегопад                  1.15–1.30
//   Сильный снегопад                    1.30–1.60
//   Мокрый снег                         1.10–1.25
//   Подтверждённая гололедица            1.20–1.60
//   Сильный туман                       1.10–1.35
//   Видимость < 100 м                   1.20–1.50
//   Сильный ветер                       1.05–1.25
//
// Важные правила, зашитые в код:
//   - не назначаем максимум «просто за осадки»: смотрим интенсивность,
//     видимость, температуру и класс дороги;
//   - если источник не сообщает состояние покрытия — не делаем вид, что знаем:
//     считаем ВЕРОЯТНОСТЬ гололедица по температуре и осадкам и снижаем
//     уверенность прогноза;
//   - коэффициент не применяется поверх уже имеющейся погодной скорости
//     (правило «без двойного учёта» реализовано в forecast.ts).

import type { RoadClass } from "../road-class"

export type WeatherCondition =
  | "clear"
  | "light_rain"
  | "rain"
  | "heavy_rain"
  | "light_snow"
  | "snow"
  | "heavy_snow"
  | "wet_snow"
  | "freezing_rain"
  | "fog"
  | "low_visibility"
  | "wind"
  | "unknown"

export const WEATHER_LABELS: Record<WeatherCondition, string> = {
  clear: "сухо",
  light_rain: "слабый дождь",
  rain: "дождь",
  heavy_rain: "сильный дождь",
  light_snow: "слабый снег",
  snow: "снегопад",
  heavy_snow: "сильный снегопад",
  wet_snow: "мокрый снег",
  freezing_rain: "гололёд",
  fog: "туман",
  low_visibility: "видимость < 100 м",
  wind: "сильный ветер",
  unknown: "погода неизвестна",
}

/** Нормализованные погодные данные на момент прохождения сегмента. */
export interface WeatherSample {
  temperatureC: number
  /** мм/час */
  precipitationMm: number
  /** Код погоды WMO (Open-Meteo) */
  weatherCode?: number
  /** метры */
  visibilityM?: number
  windSpeedKmh: number
  windGustsKmh?: number
  humidity?: number
}

/**
 * Погодная выборка с привязкой к часу (то, что отдаёт клиент Open-Meteo).
 *
 * Живёт в модели, а не в клиенте, чтобы прогноз по сегментам зависел только от
 * чистых типов: клиент с сетью подменяется тестовой выборкой.
 */
export interface HourlyWeather extends WeatherSample {
  /** Местное время часа в формате "YYYY-MM-DDTHH:mm" */
  time: string
}

/** Диапазоны коэффициентов: [минимум, максимум]. */
const RANGES: Record<WeatherCondition, [number, number]> = {
  clear: [1.0, 1.0],
  light_rain: [1.03, 1.07],
  rain: [1.08, 1.15],
  heavy_rain: [1.15, 1.3],
  light_snow: [1.05, 1.15],
  snow: [1.15, 1.3],
  heavy_snow: [1.3, 1.6],
  wet_snow: [1.1, 1.25],
  freezing_rain: [1.2, 1.6],
  fog: [1.1, 1.35],
  low_visibility: [1.2, 1.5],
  wind: [1.05, 1.25],
  unknown: [1.0, 1.0],
}

/**
 * Классы дорог, на которых погода влияет сильнее.
 *
 * На автомагистрали гололёд опаснее, чем в городе с регулярной уборкой, но
 * городская плотная застройка сильнее страдает от тумана и осадков. Коэффициент
 * масштабируется на класс, чтобы «снег на трассе» не равнялся «снегу во дворе».
 */
const CLASS_SENSITIVITY: Record<RoadClass, number> = {
  motorway: 1.15,
  federal: 1.1,
  regional: 1.05,
  rural: 1.0,
  settlement: 0.9,
  city: 0.95,
  dense_city: 0.9,
  industrial: 0.85,
  unknown: 1.0,
}

export interface WeatherAssessment {
  condition: WeatherCondition
  label: string
  /** Итоговый коэффициент с учётом класса дороги */
  factor: number
  /** Вероятность опасного состояния покрытия (0..1), если источник её не подтвердил */
  iceRisk: number
  /** Покоты подтверждены источником, а не выведены */
  iceConfirmed: boolean
  /** Данные есть? Если нет — фактор 1.0 и падает уверенность прогноза */
  available: boolean
  reason: string
}

/** Код погоды WMO → условие (Open-Meteo weather_code). */
function conditionFromCode(code: number | undefined, sample: WeatherSample): WeatherCondition {
  if (code === undefined) return "unknown"

  // WMO: 0 ясно; 1-3 облачно; 45,48 туман; 51-57 морось; 61-67 дождь;
  // 71-77 снег; 80-82 ливни; 85-86 снег с дождём; 95-99 гроза
  if (code === 45 || code === 48) return "fog"
  if (code >= 95) return "heavy_rain"
  if (code >= 85) return "wet_snow"
  if (code >= 80) return "heavy_rain"
  if (code >= 71) return sample.temperatureC > 0 ? "wet_snow" : "snow"
  if (code >= 61) return sample.precipitationMm > 4 ? "heavy_rain" : "rain"
  if (code >= 51) return "light_rain"
  if (code <= 3) return "clear"
  return "unknown"
}

/**
 * Оценивает погодное влияние на сегмент.
 *
 * Никогда не возвращает «максимальный коэффициент просто за осадки»: интенсивность
 * и видимость решают. Температура около нуля + осадки = риск гололедица, но это
 * ВЕРОЯТНОСТЬ, а не подтверждение — покрытие бесплатный источник не сообщает.
 */
export function assessWeather(
  sample: WeatherSample | null,
  roadClass: RoadClass,
): WeatherAssessment {
  if (!sample) {
    return {
      condition: "unknown",
      label: WEATHER_LABELS.unknown,
      factor: 1.0,
      iceRisk: 0,
      iceConfirmed: false,
      available: false,
      reason: "данных о погоде нет",
    }
  }

  let condition = conditionFromCode(sample.weatherCode, sample)

  // Видимость важнее кода: туман без кода 45 тоже туман
  if (sample.visibilityM !== undefined && sample.visibilityM < 100) {
    condition = "low_visibility"
  } else if (sample.visibilityM !== undefined && sample.visibilityM < 500 && condition === "clear") {
    condition = "fog"
  }

  // Гололёд: температура около нуля и есть осадки. Подтвердить покрытие
  // бесплатный источник не может — только вероятность.
  const nearFreezing = sample.temperatureC <= 0.5 && sample.temperatureC >= -3
  const iceRisk = nearFreezing && sample.precipitationMm > 0 ? Math.min(1, 0.4 + sample.precipitationMm / 8) : 0
  const iceConfirmed = false

  if (iceRisk >= 0.5 && (condition === "light_rain" || condition === "rain" || condition === "wet_snow")) {
    condition = "freezing_rain"
  }

  // Ветер: порывы опасны для грузовиков сильнее, чем средняя скорость
  const gusts = sample.windGustsKmh ?? sample.windSpeedKmh
  if (gusts >= 60 && condition === "clear") {
    condition = "wind"
  }

  const [min, max] = RANGES[condition]
  const range = max - min

  // Доля диапазона по интенсивности осадков: 0 мм → минимум, 8+ мм → максимум
  const intensity = Math.min(1, sample.precipitationMm / 8)
  const raw = min + range * intensity
  const factor = 1 + (raw - 1) * CLASS_SENSITIVITY[roadClass]

  const reasons: string[] = [WEATHER_LABELS[condition]]
  if (sample.temperatureC <= 0.5 && sample.temperatureC >= -3) {
    reasons.push(`${round(sample.temperatureC)}°C — риск гололедица`)
  }
  if (sample.visibilityM !== undefined && sample.visibilityM < 1000) {
    reasons.push(`видимость ${Math.round(sample.visibilityM)} м`)
  }
  if (gusts >= 50) reasons.push(`порывы ${Math.round(gusts)} км/ч`)

  return {
    condition,
    label: WEATHER_LABELS[condition],
    factor: Math.round(factor * 1000) / 1000,
    iceRisk: Math.round(iceRisk * 100) / 100,
    iceConfirmed,
    available: true,
    reason: reasons.join(", "),
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Неопределённость погоды: у прогноза она растёт со временем.
 *
 * Первые 6 часов — прогноз надёжный, дальше всё меньше. Используется для
 * оптимистичного и консервативного сценариев.
 */
export function weatherUncertainty(hoursAhead: number): { optimistic: number; conservative: number } {
  const spread = Math.min(0.35, Math.max(0.05, hoursAhead / 48))
  return { optimistic: 1 - spread, conservative: 1 + spread }
}
