/**
 * Эвристические коэффициенты для оценки времени в пути.
 *
 * Это модельные поправки (час пик, тип груза, длина плеча, день недели), а не
 * измерения дорожного трафика: настоящие пробки приходят из lib/traffic.
 * Всё, для чего нет входных данных (например, погода), остаётся нейтральным —
 * коэффициент 1.0, а не случайное число.
 */

import type { TrafficCoefficients, RiskFactors, RiskLevel, ETARequest } from "./types";

const RUSH_HOURS = {
  morning: { start: 7, end: 10, peak: 8.5 },
  evening: { start: 17, end: 20, peak: 18.5 }
};

const WEATHER_MULTIPLIERS: Record<string, number> = {
  clear: 1.0,
  rain: 1.15,
  snow: 1.35,
  fog: 1.20,
  storm: 1.50
};

const CARGO_MULTIPLIERS: Record<string, number> = {
  standard: 1.0,
  fragile: 1.10,
  hazmat: 1.20,
  oversized: 1.30,
  refrigerated: 1.05
};

const DAY_MULTIPLIERS: Record<number, number> = {
  0: 0.85,
  1: 1.0,
  2: 1.0,
  3: 1.0,
  4: 1.05,
  5: 1.15,
  6: 0.90
};

export function calculateRushHourCoefficient(departureTime: Date): number {
  const hour = departureTime.getHours() + departureTime.getMinutes() / 60;

  if (hour >= RUSH_HOURS.morning.start && hour <= RUSH_HOURS.morning.end) {
    const distanceFromPeak = Math.abs(hour - RUSH_HOURS.morning.peak);
    const intensity = 1 - distanceFromPeak / 1.5;
    return 1 + intensity * 0.6;
  }

  if (hour >= RUSH_HOURS.evening.start && hour <= RUSH_HOURS.evening.end) {
    const distanceFromPeak = Math.abs(hour - RUSH_HOURS.evening.peak);
    const intensity = 1 - distanceFromPeak / 1.5;
    return 1 + intensity * 0.8;
  }

  if (hour >= 23 || hour <= 6) {
    return 0.85;
  }

  return 1.0;
}

/**
 * Влияние погоды на время в пути.
 *
 * Погода учитывается ТОЛЬКО если её реально передали в запросе (поле weather:
 * "clear" | "rain" | "snow" | "fog" | "storm"). Раньше при отсутствии данных
 * функция «угадывала» погоду по месяцу через Math.random() и возвращала то
 * «snow» (1.35), то «fog» (1.2): один и тот же рейс при пересчёте получал
 * разное ETA, а в рисках появлялось выдуманное «Сложные погодные условия»
 * (+30 к оценке риска). Это не измерение, а лотерея, поэтому теперь без
 * входных данных погода нейтральна — condition: "unknown", коэффициент 1.0.
 *
 * Нужна настоящая погода — подключите источник и передавайте её в
 * ETARequest.weather (например, из /api/routes/calculate-eta).
 */
export function calculateWeatherCoefficient(
  weather?: string,
  _departureTime?: Date
): { coefficient: number; condition: string } {
  const known = typeof weather === "string" ? weather.trim().toLowerCase() : "";

  if (known && WEATHER_MULTIPLIERS[known]) {
    return { coefficient: WEATHER_MULTIPLIERS[known], condition: known };
  }

  // Данных о погоде нет (или значение не из справочника) — не влияем на ETA
  return { coefficient: 1.0, condition: "unknown" };
}

export function calculateCargoCoefficient(cargo?: ETARequest["cargo"]): number {
  if (!cargo) return 1.0;

  let multiplier = CARGO_MULTIPLIERS[cargo.type || "standard"] || 1.0;

  if (cargo.weight && cargo.weight > 20) {
    multiplier *= 1 + (cargo.weight - 20) * 0.005;
  }

  if (cargo.requiresEscort) {
    multiplier *= 1.25;
  }

  return Math.min(multiplier, 1.5);
}

export function calculateRoadTypeCoefficient(distanceKm: number): number {
  if (distanceKm < 20) return 1.3;
  if (distanceKm < 50) return 1.15;
  if (distanceKm < 100) return 1.05;
  if (distanceKm > 300) return 0.95;
  return 1.0;
}

export function calculateDayCoefficient(date: Date): number {
  const day = date.getDay();
  const hour = date.getHours();

  let multiplier = DAY_MULTIPLIERS[day] || 1.0;

  if (day === 5 && hour >= 15) multiplier *= 1.2;
  if (day === 0 && hour >= 16) multiplier *= 1.25;

  return multiplier;
}

export function calculateAllCoefficients(
  request: ETARequest,
  distanceKm: number
): TrafficCoefficients {
  const departureTime = request.departureTime || new Date();

  const rushHour = calculateRushHourCoefficient(departureTime);
  const { coefficient: weather } = calculateWeatherCoefficient(
    request.weather,
    departureTime
  );
  const cargoComplexity = calculateCargoCoefficient(request.cargo);
  const roadType = calculateRoadTypeCoefficient(distanceKm);
  const dayOfWeek = calculateDayCoefficient(departureTime);

  const total =
    rushHour * 0.35 +
    weather * 0.25 +
    roadType * 0.2 +
    cargoComplexity * 0.1 +
    dayOfWeek * 0.1;

  return {
    rushHour,
    weather,
    cargoComplexity,
    roadType,
    dayOfWeek,
    total: Math.max(total, 0.85)
  };
}

export function calculateRiskFactors(
  coefficients: TrafficCoefficients,
  request: ETARequest,
  distanceKm: number
): RiskFactors {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let riskScore = 0;

  if (coefficients.rushHour > 1.5) {
    reasons.push("Пиковая загрузка дорог");
    recommendations.push("Рассмотрите выезд на 1-2 часа раньше");
    riskScore += 25;
  } else if (coefficients.rushHour > 1.2) {
    reasons.push("Умеренная загрузка дорог");
    riskScore += 10;
  }

  if (coefficients.weather > 1.3) {
    reasons.push("Сложные погодные условия");
    recommendations.push("Снизить скорость, увеличить дистанцию");
    riskScore += 30;
  } else if (coefficients.weather > 1.15) {
    reasons.push("Умеренно сложная погода");
    riskScore += 15;
  }

  if (coefficients.cargoComplexity > 1.2) {
    reasons.push("Сложный тип груза");
    recommendations.push("Проверить крепление груза перед выездом");
    riskScore += 20;
  }

  if (distanceKm > 500) {
    reasons.push("Длительный маршрут (> 500 км)");
    recommendations.push("Запланировать обязательный отдых водителя");
    riskScore += 15;
  }

  let level: RiskLevel;
  if (riskScore >= 60) {
    level = "critical";
    recommendations.unshift("Рекомендуется пересмотреть время выезда");
  } else if (riskScore >= 40) {
    level = "high";
  } else if (riskScore >= 20) {
    level = "medium";
  } else {
    level = "low";
    if (reasons.length === 0) reasons.push("Благоприятные условия");
  }

  return {
    level,
    delayProbability: Math.min(riskScore * 1.2, 95),
    reasons,
    recommendations
  };
}

export function calculateRouteCost(
  distanceKm: number,
  vehicle?: ETARequest["vehicle"]
): { fuel: number; tolls: number; total: number } {
  const fuelConsumption = vehicle?.fuelConsumption || 32;
  const fuelPrice = 65;
  const fuelCost = (distanceKm / 100) * fuelConsumption * fuelPrice;

  let tollsCost = 0;
  if (distanceKm > 100) {
    tollsCost = distanceKm * 0.3 * 3;
  }

  return {
    fuel: Math.round(fuelCost),
    tolls: Math.round(tollsCost),
    total: Math.round(fuelCost + tollsCost)
  };
}