// lib/logist-mobile/city-case.ts
//
// Город в нужном падеже: «уже стоит в Казани», «из Перми грузов нет»,
// «грузов из «Ярославля» нет».
//
// Зачем отдельным модулем: склонение нужно и дежурному, и объяснению провала
// в сборщике. Две копии правил разошлись бы — и один экран писал бы
// «в Казани», а другой «из Казань».
//
// Правила покрывают обычные названия; на незнакомом (Мытищи, Ростов-на-Дону)
// функция честно возвращает null, и вызывающий код говорит нейтрально —
// «в городе Мытищи». Выдуманный падеж хуже нейтральной фразы.

import { displayCity } from "./format"

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

/** Название в родительном падеже: «Ярославля», «Казани»; null — не угадали. */
export function cityGenitive(city: string | null | undefined): string | null {
  return cityForm(city, false)
}

/** Название в предложном падеже: «Казани», «Москве»; null — не угадали. */
export function cityPrepositional(city: string | null | undefined): string | null {
  return cityForm(city, true)
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
