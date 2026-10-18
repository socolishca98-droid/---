// lib/push/client.ts
//
// Клиентские помощники Web Push. Только то, что нужно в браузере: привести
// base64url-ключ сервера к виду, который принимает pushManager.subscribe().
//
// Отдельно от хука, потому что преобразование — чистая функция: её можно
// проверить тестом без браузера и без service worker.

/**
 * base64url → Uint8Array (BufferSource для applicationServerKey).
 * Браузер требует именно Uint8Array, а не строку: молча игнорировать
 * неверный тип он не будет, но и подписаться не даст.
 */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
  // Свой ArrayBuffer (не срез чужого): pushManager требует именно его
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Поддерживает ли браузер push вообще. */
export function pushSupported(): boolean {
  if (typeof window === "undefined") return false
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

/**
 * Нужно ли предложить установить сайт: на iOS push работает только для
 * установленного (standalone) сайта. Без этой проверки пользователь нажимает
 * кнопку, а пуши не приходят — и непонятно почему.
 */
export function needsInstallHint(): boolean {
  if (typeof window === "undefined") return false
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // @ts-expect-error — старый Safari
    window.navigator.standalone === true
  return ios && !standalone
}

/** Короткое описание устройства из userAgent — для списка подписок. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Неизвестное устройство"
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iPhone / iPad"
  if (/Android/.test(userAgent)) return "Android"
  if (/Mac OS X/.test(userAgent)) return "Mac"
  if (/Windows/.test(userAgent)) return "Windows"
  if (/Linux/.test(userAgent)) return "Linux"
  return "Другое устройство"
}
