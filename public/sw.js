/* Loginex service worker.
 *
 * Принцип: интерфейс доступен офлайн, данные — никогда не устаревшие.
 *  * install: кэш оболочки приложения (экраны мобильного контура, манифесты,
 *    иконка);
 *  * navigate: сеть прежде всего, успешный ответ кладём в кэш; офлайн —
 *    отдаём сохранённую оболочку своего контура (/s или /m);
 *  * статика origem: stale-while-revalidate;
 *  * /api/**: только сеть — деньги, заказы и статусы не имеют права быть
 *    вчерашними.
 */
const CACHE = "loginex-shell-v2";

const SHELL = [
  "/s",
  "/s/orders",
  "/s/routes",
  "/s/chat",
  "/s/menu",
  "/m",
  "/manifest.json",
  "/manifest-staff.json",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

function fallbackFor(pathname) {
  if (pathname.startsWith("/m")) return caches.match("/m");
  if (pathname.startsWith("/s")) return caches.match("/s");
  return Promise.resolve(undefined);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Данные — только сеть: кэш не должен подменять заказы, деньги и чат
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((hit) => hit || fallbackFor(url.pathname))
            .then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  // Статика: отдаём из кэша сразу, параллельно освежаем
  event.respondWith(
    caches.match(event.request).then((hit) => {
      const refresh = fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => hit);
      return hit || refresh;
    }),
  );
});
