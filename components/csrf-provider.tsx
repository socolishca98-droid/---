// components/csrf-provider.tsx - P1-3 CSRF auto-injection for mutating API calls
"use client"

import { useEffect } from "react"

const CSRF_COOKIE = "loginex_csrf"
const CSRF_HEADER = "x-csrf-token"
const TOKEN_ROUTE = "/api/auth/csrf"

/** Сколько ждём маршрут токена, прежде чем отправить запрос как есть. */
const TOKEN_TIMEOUT_MS = 5000

/**
 * Пауза после неудачи. Без неё при недоступном маршруте токена (например 404
 * от устаревшей сборки) каждый изменяющий запрос тащил бы за собой лишний GET
 * и получал 403 — интерфейс захлёбывался и выглядел зависшим.
 */
const TOKEN_COOLDOWN_MS = 10_000

/** Метка повторной попытки: её срезает proxy.ts, до обработчиков она не дойдёт. */
const RETRY_HEADER = "x-loginex-csrf-retry"

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"))
  return match ? decodeURIComponent(match[2]) : null
}

function shouldAddCsrf(url: string, method: string): boolean {
  if (!url) return false
  const m = method?.toUpperCase()
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(m)) return false
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0]
    if (!path.startsWith("/api/")) return false
    if (path.startsWith("/api/m/")) return false
    if (path === TOKEN_ROUTE) return false
    if (path.startsWith("/api/ati/cron")) return false
    return true
  } catch {
    return false
  }
}

// ── Состояние модуля: токен один на всё приложение ────────────────────────────

/** Незавершённый запрос токена: параллельные вызовы дожидаются один и тот же. */
let tokenRequest: Promise<string | null> | null = null
/**
 * Номер текущего запроса токена. Принудительный запрос увеличивает номер, и
 * предыдущий незавершённый уже не считается актуальным: иначе он вернул бы тот
 * самый токен, который сервер только что отверг.
 */
let tokenSequence = 0
/** Время последней неудачи, чтобы не долбить маршрут на каждом запросе. */
let lastTokenFailureAt = 0

/**
 * Достать действующий токен: из cookie, а если её нет — запросить маршрут.
 *
 * Порядок важен. Первый запрос после входа уходил без заголовка (cookie ещё не
 * выставлена) и падал с «Сессия устарела: не прошёл CSRF-токен», поэтому при
 * отсутствии cookie сначала дожидаемся токена. Токен берём из тела ответа, а не
 * только из cookie: в приватном режиме и при блокировке cookie ответ прочитать
 * всё равно можно. Любая неудача (нет сети, 404, тайм-аут) не роняет запрос —
 * он уходит как есть, а сервер ответит понятной ошибкой вместо зависания.
 */
function requestToken(
  fetchFn: typeof window.fetch,
  options: { force?: boolean } = {},
): Promise<string | null> {
  const fromCookie = getCookie(CSRF_COOKIE)
  if (fromCookie) return Promise.resolve(fromCookie)

  if (options.force) {
    // Нужен гарантированно новый токен: незавершённый запрос может вернуть тот
    // самый, который сервер уже отверг, — тогда повтор был бы бессмысленным.
    tokenSequence += 1
    tokenRequest = null
  } else if (Date.now() - lastTokenFailureAt < TOKEN_COOLDOWN_MS) {
    return Promise.resolve(null)
  }

  if (!tokenRequest) {
    const sequence = tokenSequence
    tokenRequest = (async () => {
      try {
        const response = await fetchFn(TOKEN_ROUTE, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
        })
        if (!response.ok) {
          lastTokenFailureAt = Date.now()
          return null
        }

        const body = (await response.json().catch(() => null)) as {
          csrfToken?: unknown
        } | null
        const fromBody =
          typeof body?.csrfToken === "string" && body.csrfToken.length > 0
            ? body.csrfToken
            : null
        const token = fromBody ?? getCookie(CSRF_COOKIE)
        if (!token) lastTokenFailureAt = Date.now()
        return token
      } catch {
        // Сеть недоступна или маршрут не ответил — не мешаем основному запросу
        lastTokenFailureAt = Date.now()
        return null
      } finally {
        // Снимаем только актуальный запрос: принудительный мог уже заменить его
        if (tokenSequence === sequence) tokenRequest = null
      }
    })()
  }

  return tokenRequest
}

/** Собрать параметры запроса с заголовком токена. */
function withToken(
  init: RequestInit | undefined,
  token: string | null,
  retried = false,
): RequestInit {
  const headers = new Headers(init?.headers)
  if (token && !headers.has(CSRF_HEADER)) {
    headers.set(CSRF_HEADER, token)
  }
  if (retried) {
    headers.set(RETRY_HEADER, "1")
  }
  return { ...init, headers, credentials: init?.credentials || "include" }
}

function hasRetryMarker(init: RequestInit | undefined): boolean {
  if (!init?.headers) return false
  try {
    return new Headers(init.headers as HeadersInit).has(RETRY_HEADER)
  } catch {
    return false
  }
}

export function CsrfProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Токен нужен заранее: берём его до подмены fetch, чтобы первый же
    // изменяющий запрос ушёл с заголовком.
    void requestToken(window.fetch)

    const originalFetch = window.fetch

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url
      const method =
        init?.method ||
        (typeof input !== "string" && input instanceof Request
          ? input.method
          : "GET")

      if (!shouldAddCsrf(url, method)) {
        return originalFetch(input, init as any)
      }

      // Копию готовим заранее: после первого fetch тело Request уже прочитано,
      // и повторить запрос было бы нечем.
      const retryInput = input instanceof Request ? input.clone() : input
      const alreadyRetried = hasRetryMarker(init)

      const token = await requestToken(originalFetch)
      const response = await originalFetch(input, withToken(init, token))

      // Самовосстановление: сервер сказал, что токен не прошёл, — берём свежий
      // и повторяем запрос ровно один раз. Это лечит и «первый вход», и
      // протухший токен после долгой вкладки.
      if (alreadyRetried || response.status !== 403) return response

      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { code?: unknown } | null
      if (body?.code !== "csrf_failed") return response

      const freshToken = await requestToken(originalFetch, { force: true })
      if (!freshToken || freshToken === token) return response

      return originalFetch(retryInput, withToken(init, freshToken, true))
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return <>{children}</>
}
