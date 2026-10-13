// public/sw.js
//
// Service worker Loginex: показывает push-уведомления и открывает нужный
// экран приложения по клику.
//
// Почему вообще worker: push приходит в браузер даже когда вкладка закрыта,
// а отрисовать уведомление может только service worker. Без него пуши
// «доставляются», но пользователь не видит ничего.
//
// Обработка ошибок специально подробная: в push-сценарии отладка трудна
// (нет консоли), поэтому любая неожиданная ситуация превращается в видимое
// уведомление-заглушку, а не в тишину.

/// <reference lib="webworker" />

/* global self, clients */

const SW = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self))

/** Заголовок по умолчанию — если payload не разобрался. */
const FALLBACK_TITLE = "Loginex"

/** Куда ведёт клик, если в сообщении нет адреса. */
const FALLBACK_URL = "/"

SW.addEventListener("install", (event) => {
  // Новый worker должен активироваться сразу, иначе пуши будет принимать старый
  event.waitUntil(SW.skipWaiting())
})

SW.addEventListener("activate", (event) => {
  event.waitUntil(SW.clients.claim())
})

/**
 * Разбор payload. Приходит он зашифрованным и расшифровывает его браузер,
 * поэтому здесь работаем уже с обычным объектом.
 * @param {unknown} data
 */
function readMessage(data) {
  if (!data || typeof data !== "object") return { title: FALLBACK_TITLE }
  const message = /** @type {Record<string, unknown>} */ (data)
  const title = typeof message.title === "string" && message.title.trim() ? message.title : FALLBACK_TITLE
  return {
    title,
    body: typeof message.body === "string" ? message.body : "",
    url: typeof message.url === "string" && message.url ? message.url : FALLBACK_URL,
    tag: typeof message.tag === "string" && message.tag ? message.tag : undefined,
    icon: typeof message.icon === "string" && message.icon ? message.icon : undefined,
  }
}

SW.addEventListener("push", (event) => {
  let message
  try {
    message = readMessage(event.data ? event.data.json() : null)
  } catch {
    // Битый payload: показываем хоть что-то, иначе уведомление потеряется
    message = { title: FALLBACK_TITLE, body: "Новое событие в Loginex", url: FALLBACK_URL }
  }

  const options = {
    body: message.body,
    icon: message.icon || "/icon-dark-32x32.png",
    badge: "/icon-dark-32x32.png",
    tag: message.tag,
    // requireInteraction: уведомление не должно исчезать, пока человек не увидит
    requireInteraction: true,
    data: { url: message.url },
  }

  event.waitUntil(SW.registration.showNotification(message.title, options))
})

SW.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const target = (event.notification.data && event.notification.data.url) || FALLBACK_URL

  event.waitUntil(
    (async () => {
      // Уже открытая вкладка просто получает фокус — новая вкладка с тем же
      // адресом сбивала бы с толку и теряла состояние формы.
      const clientList = await SW.clients.matchAll({ type: "window", includeUncontrolled: true })
      for (const client of clientList) {
        if (new URL(client.url).origin === SW.location.origin) {
          await client.focus()
          if ("navigate" in client) {
            try {
              await client.navigate(target)
              return
            } catch {
              // Навигация не всегда доступна — тогда просто фокус
            }
          }
          return
        }
      }
      await SW.clients.openWindow(target)
    })(),
  )
})
