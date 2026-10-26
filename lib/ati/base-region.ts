// lib/ati/base-region.ts
// Регион базы организации — для ЛЮБОГО города, а не только из 199 зашитых.
//
// Зачем отдельный модуль. От адреса базы (FleetSettings.baseAddress) зависит
// три вещи: какие города попадёт в профиль сканирования, будет ли сборщик
// собирать регион организации, и по какому региону помощник отфильтровывает
// грузы («не нужен груз из Новосибирска»). Свой словарь покрывает 199 городов,
// в основном областные центры:
//
//   Ярославль → 88 Ярославская область      Тулун  → ничего
//   Биробиджан → 89 Еврейская АО            Кировск → ничего
//   Новый Уренгой → 17 ЯНАО                 Надым  → ничего
//
// Для такой организации сборщик не собирал её регион, а помощник показывал
// грузы со всей страны — ровно та претензия, от которой мы уходили.
//
// Решение: город не нашёлся в словаре — спрашиваем геокодер, какой регион у
// этого адреса. Словарь РЕГИОНОВ покрывает все 95 регионов, поэтому любого
// города хватает: «Тулун, Иркутская область» → Иркутская область → 70.
//
// Модуль серверный (сеть + словари), но без Prisma: им пользуются и роут
// скана, и настройки профиля, и выдача грузов помощнику.

import { regionOfPlace } from "@/lib/geo/nominatim"
import { findRegionByNameLocal } from "./regions"
import { ATI_REGION_NAMES } from "./ati-city-regions"

export type BaseRegion = { id: number; name: string }

/** Служебные слова в названиях регионов — они мешают сравнению. */
const TYPE_WORDS = new Set([
  "область",
  "край",
  "республика",
  "автономная",
  "автономный",
  "округ",
  "ао",
  "г",
  "город",
])

/** Нормализация для сравнения: без пунктуации и служебных слов. */
function norm(value: string): string {
  const words = value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !TYPE_WORDS.has(word))
  return ` ${words.join(" ")} `
}

/**
 * Регион по названию в любом написании: «Иркутская область», «Иркутская»,
 * «Ханты-Мансийский автономный округ — Югра». Словарь регионов полный.
 */
export function regionByName(name: unknown): BaseRegion | null {
  const text = String(name ?? "").trim()
  if (!text) return null
  const hit = findRegionByNameLocal(text)
  return hit ? { id: hit.id, name: hit.name } : null
}

/** Поиск названия региона внутри текста: берём самое длинное совпадение. */
export function regionFromText(text: unknown): BaseRegion | null {
  const haystack = norm(String(text ?? ""))
  if (!haystack.trim()) return null
  let best: BaseRegion | null = null
  let bestLength = 0
  for (const [id, name] of Object.entries(ATI_REGION_NAMES)) {
    const needle = norm(name).trim()
    if (needle.length < 4) continue
    if (haystack.includes(` ${needle} `) && needle.length > bestLength) {
      best = { id: Number(id), name }
      bestLength = needle.length
    }
  }
  return best
}

/**
 * Регион базы по её адресу.
 *
 * Сначала быстрый путь без сети — свой словарь городов. Если города в нём
 * нет, спрашиваем геокодер и ищем регион в его разборе адреса.
 */
export async function regionOfBaseAddress(baseAddress: unknown): Promise<BaseRegion | null> {
  const text = String(baseAddress ?? "").trim()
  if (!text) return null

  const head = text.split(/[,.;]/)[0].trim()
  const local = regionByName(head)
  if (local) return local

  try {
    const placeRegion = await regionOfPlace(text)
    if (placeRegion) {
      const hit = regionByName(placeRegion) ?? regionFromText(placeRegion)
      if (hit) return hit
    }
    // Геокодер мог отдать регион не тем полем — пробуем по подписи места
    const { searchPlaces } = await import("@/lib/geo/nominatim")
    for (const place of await searchPlaces(text, 3)) {
      const hit = regionFromText(place.label)
      if (hit) return hit
    }
  } catch {
    /* геокодер недоступен — не наша ошибка, просто регион неизвестен */
  }
  return null
}
