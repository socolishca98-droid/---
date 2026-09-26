// lib/visual/background-quality.ts
//
// Качество живого фона: сколько движения показывать.
//
// Зачем три уровня: фон лежит под панелями с backdrop-filter: blur(), поэтому
// любое движение заставляет браузер пересчитывать размытие. На мощной машине
// это незаметно, на старом ноутбуке — ощутимо. Уровни позволяют не выбирать
// между «красиво» и «быстро»:
//
//   full — всё: дыхание цвета, дрейф сетки, «пинги» городов и грузовики;
//   soft — только то, что считается на видеокарте (цвет и сетка), грузовиков нет;
//   off  — полностью статичная картинка.
//
// Выбор пользователя сохраняется в localStorage и переживает перезагрузку.
// Переменная окружения задаёт лишь исходное значение по умолчанию.

export type BackgroundQuality = "full" | "soft" | "off"

const STORAGE_KEY = "loginex:background-quality"
const EVENT_NAME = "loginex:background-quality"

const QUALITIES: readonly string[] = ["full", "soft", "off"]

export const BACKGROUND_QUALITY_LABELS: Record<BackgroundQuality, string> = {
  full: "Живой",
  soft: "Спокойный",
  off: "Выключен",
}

/** Порядок пунктов в меню: от самого красивого к самому лёгкому. */
export const BACKGROUND_QUALITY_ORDER: readonly BackgroundQuality[] = ["full", "soft", "off"]

/**
 * Значение по умолчанию — из переменной окружения на момент сборки.
 * Понимает и старые варианты on/off, чтобы уже написанное в .env не сломалось.
 */
export const DEFAULT_BACKGROUND_QUALITY: BackgroundQuality = (() => {
  const raw = (process.env.NEXT_PUBLIC_LIVE_BACKGROUND || "full").trim().toLowerCase()
  if (raw === "off" || raw === "false" || raw === "0" || raw === "static") return "off"
  if (raw === "soft" || raw === "lite" || raw === "calm") return "soft"
  return "full"
})()

function isBackgroundQuality(value: unknown): value is BackgroundQuality {
  return typeof value === "string" && QUALITIES.includes(value)
}

/** Что выбрал пользователь. null — выбора не было, работает значение по умолчанию. */
export function readBackgroundQuality(): BackgroundQuality | null {
  if (typeof window === "undefined") return null
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isBackgroundQuality(stored) ? stored : null
  } catch {
    // приватный режим или запрет на хранение — просто работаем по умолчанию
    return null
  }
}

export function saveBackgroundQuality(quality: BackgroundQuality): void {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(STORAGE_KEY, quality)
  } catch {
    // не сохранилось — хотя бы переключим на этот раз
  }

  window.dispatchEvent(new CustomEvent<BackgroundQuality>(EVENT_NAME, { detail: quality }))
}

/** Подписка на смену качества: из меню в шапке или из соседней вкладки. */
export function subscribeBackgroundQuality(listener: (quality: BackgroundQuality) => void): () => void {
  if (typeof window === "undefined") return () => {}

  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<BackgroundQuality>).detail
    if (isBackgroundQuality(detail)) listener(detail)
  }

  const onStorage = () => {
    const stored = readBackgroundQuality()
    if (stored) listener(stored)
  }

  window.addEventListener(EVENT_NAME, onCustom)
  window.addEventListener("storage", onStorage)

  return () => {
    window.removeEventListener(EVENT_NAME, onCustom)
    window.removeEventListener("storage", onStorage)
  }
}
