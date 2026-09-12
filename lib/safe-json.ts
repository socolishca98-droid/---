// lib/safe-json.ts

/**
 * Безопасный парсинг JSON с fallback значением
 */
export function safeJsonParse<T = unknown>(
  value: string | null | undefined,
  fallback: T
): T {
  if (!value || value.trim() === "") return fallback

  try {
    const parsed = JSON.parse(value)
    return parsed as T
  } catch (error) {
    console.warn(
      "[safeJsonParse] Invalid JSON:",
      value?.substring(0, 100),
      error
    )
    return fallback
  }
}

/**
 * Безопасный stringify с обработкой ошибок
 */
export function safeJsonStringify<T = unknown>(
  value: T,
  fallback: string = "null"
): string {
  try {
    return JSON.stringify(value)
  } catch (error) {
    console.warn("[safeJsonStringify] Error:", error)
    return fallback
  }
}

/**
 * Безопасное чтение из localStorage
 */
export function safeLocalStorageGet<T = unknown>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback

  try {
    const item = localStorage.getItem(key)
    if (item === null) return fallback
    return safeJsonParse<T>(item, fallback)
  } catch (error) {
    console.warn("[safeLocalStorageGet] Error reading key:", key, error)
    return fallback
  }
}

/**
 * Безопасная запись в localStorage
 */
export function safeLocalStorageSet<T = unknown>(
  key: string,
  value: T
): boolean {
  if (typeof window === "undefined") return false

  try {
    const stringified = safeJsonStringify(value)
    localStorage.setItem(key, stringified)
    return true
  } catch (error) {
    console.warn("[safeLocalStorageSet] Error writing key:", key, error)
    return false
  }
}

/**
 * Безопасное удаление из localStorage
 */
export function safeLocalStorageRemove(key: string): boolean {
  if (typeof window === "undefined") return false

  try {
    localStorage.removeItem(key)
    return true
  } catch (error) {
    console.warn("[safeLocalStorageRemove] Error removing key:", key, error)
    return false
  }
}