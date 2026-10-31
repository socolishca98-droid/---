// lib/logist-mobile/pool.ts
//
// Какой груз вообще имеет отношение к базе организации — то, из чего собирается
// маршрут.
//
// Правило простое и одно на весь помощник: груз интересен, если ОДИН ИЗ ЕГО
// КОНЦОВ в районе базы — в регионе или в пределах заданного радиуса.
//
// Почему не «только погрузка», как было: экран фильтровал пул по городу
// ПОГРУЗКИ, и грузы «в регион» отбрасывались ещё до сборщика. То есть обратка
// (Москва → Ярославль, Брянск → Ярославль) в пул не попадала никогда. Сборщик
// честно писал «обратки нет» и считал порожний возврат — а на бирже в это же
// время лежали десятки грузов домой. Живой замер (снимок прода, 300 грузов
// региона): 57 свежих грузов со ставкой везли В Ярославскую область, и ни один
// не доходил до сборщика. Маршрут «Тутаев → Раменское» с обраткой «Химки →
// Ярославль» даёт 78 000 ₽ прибыли вместо 28 000 ₽ у одностороннего.
//
// Модуль чистый — тесты tests/route-pool.test.mjs.

import { haversineKm, type BuilderLoad, type Point } from "./route-builder"

export interface BaseArea {
  /**
   * Регион базы без типа: «Ярославская». Пусто — региональное правило не
   * применяем, остаётся только радиус (так работают базы, регион которых не
   * удалось определить).
   */
  regionRoot: string | null
  /** Точка базы — без неё радиус посчитать нечем */
  basePoint: Point | null
  /** Радиус вокруг базы, км. 0 — только регион */
  radiusKm: number
}

/** Название региона без хвоста «область/край/республика». */
export function regionRootOf(regionName: string | null | undefined): string | null {
  const text = String(regionName ?? "").trim()
  if (!text) return null
  return text.replace(/\s+(область|край|республика).*$/i, "").trim() || null
}

/** Город попадает в район базы: тот же регион или ближе радиуса. */
export function cityInBaseArea(
  city: string | null | undefined,
  point: Point | null | undefined,
  area: BaseArea,
): boolean {
  const text = String(city ?? "")
  if (area.regionRoot && text.includes(area.regionRoot)) return true
  if (!area.basePoint || !point || area.radiusKm <= 0) return false
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false
  return haversineKm(area.basePoint, point) <= area.radiusKm
}

/**
 * Груз относится к району базы, если к нему относится погрузка ИЛИ выгрузка.
 *
 * Оба конца важны: погрузка в районе — груз, с которого можно начать (или
 * который «по пути»); выгрузка в районе — обратка домой, без неё маршрут
 * всегда заканчивается порожним пробегом.
 */
export function loadInBaseArea(load: BuilderLoad, area: BaseArea): boolean {
  return (
    cityInBaseArea(load.fromCity, load.fromPoint, area) ||
    cityInBaseArea(load.toCity, load.toPoint, area)
  )
}

/** Пул района базы: оба конца проверяем, дубликатов не бывает. */
export function baseAreaPool(loads: readonly BuilderLoad[], area: BaseArea): BuilderLoad[] {
  return loads.filter((load) => loadInBaseArea(load, area))
}

/**
 * Склейка двух выборок биржи без дублей.
 *
 * Зачем: помощник берёт грузы двумя запросами — «регион базы» (гарантированно
 * полный) и «вся биржа» (нужен, когда логист расширил радиус: в регионе
 * пятитонке грузов нет, а в 300 км, в Москве, они есть). Один и тот же груз
 * приходит в обеих выборках с одним id — берём первую версию.
 */
export function mergeLoads<T extends { id: string }>(
  primary: readonly T[],
  extra: readonly T[],
): T[] {
  const seen = new Set(primary.map((load) => load.id))
  const out = [...primary]
  for (const load of extra) {
    if (seen.has(load.id)) continue
    seen.add(load.id)
    out.push(load)
  }
  return out
}
