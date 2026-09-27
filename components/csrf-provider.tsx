// components/csrf-provider.tsx — CSRF-токен для мутирующих вызовов /api/*
//
// Раньше здесь была гонка: токен подтягивался асинхронно на маунте, а любой
// POST, ушедший до его появления, отправлялся без заголовка `x-csrf-token`
// и падал с 403. Теперь:
//   1. Запрос токена кэшируется в едином промисе (один полёт на приложение).
//   2. Мутирующий вызов БЕЗ куки дожидается токен (с таймаутом, чтобы не висеть).
//   3. На 403 (токен протух/ротация) — одноразовый повтор со свежим токеном.
"use client"

import { useEffect } from "react"

const COOKIE_NAME = "loginex_csrf"
const HEADER_NAME = "x-csrf-token"
/** Сколько ждём токен, если его ещё нет (мс). Дальше уходим без него — сервер решит. */
const TOKEN_WAIT_MS = 2500

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"))
  return match ? decodeURIComponent(match[2]) : null
}

function shouldAddCsrf(url: string, method: string): boolean {
  if (!url) return false
  const m = method?.toUpperCase()
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(m)) return false
  // Только /api/*, кроме мобильных ключей, самого получения токена и cron
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0]
    if (!path.startsWith("/api/")) return false
    if (path.startsWith("/api/m/")) return false
    if (path === "/api/auth/csrf") return false
    if (path.startsWith("/api/ati/cron")) return false
    return true
  } catch {
    return false
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      }
    )
  })
}

export function CsrfProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch

    /** Единственный «в полёте» запрос токена — чтобы не плодить дубли */
    let tokenFlight: Promise<string | null> | null = null

    const requestToken = async (): Promise<string | null> => {
      const existing = getCookie(COOKIE_NAME)
      if (existing) return existing
      try {
        await originalFetch("/api/auth/csrf", { method: "GET", credentials: "include" })
      } catch {
        /* сеть недоступна — дальше пойдём без токена */
      }
      return getCookie(COOKIE_NAME)
    }

    const ensureToken = (): Promise<string | null> => {
      if (!tokenFlight) {
        tokenFlight = requestToken().finally(() => {
          // После завершения даём следующему вызову право сделать новый полёт
          // (нужно для ротации токена на 403)
          tokenFlight = null
        })
      }
      return tokenFlight
    }

    // Прогреваем куку сразу, но НЕ блокируем рендер
    void ensureToken()

    const extractUrl = (input: RequestInfo | URL): string =>
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url

    const extractMethod = (input: RequestInfo | URL, init?: RequestInit): string =>
      init?.method || (typeof input !== "string" && input instanceof Request ? input.method : "GET")

    /** Проставляет заголовок токена и credentials, не ломая исходный init */
    const withToken = async (
      input: RequestInfo | URL,
      init: RequestInit | undefined,
      token: string | null
    ): Promise<RequestInit> => {
      const headers = new Headers(
        init?.headers ||
          (typeof input !== "string" && input instanceof Request ? (input as Request).headers : undefined)
      )
      if (token && !headers.has(HEADER_NAME)) headers.set(HEADER_NAME, token)
      return { ...init, headers, credentials: init?.credentials || "include" }
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = extractUrl(input)
      const method = extractMethod(input, init)

      if (!shouldAddCsrf(url, method)) {
        return originalFetch(input, init as RequestInit)
      }

      // Токен уже в куке — не ждём ничего
      let token = getCookie(COOKIE_NAME)
      if (!token) {
        token = await withTimeout(ensureToken(), TOKEN_WAIT_MS)
      }

      const response = await originalFetch(input, (await withToken(input, init, token)) as RequestInit)

      // Токен протух/ротирован: повторяем ОДИН раз со свежим значением.
      // 403 означает, что мутация не выполнена, поэтому повтор безопасен.
      if (response.status === 403) {
        tokenFlight = null
        const fresh = await withTimeout(
          Promise.resolve(requestToken()),
          TOKEN_WAIT_MS
        )
        if (fresh && fresh !== token) {
          return originalFetch(input, (await withToken(input, init, fresh)) as RequestInit)
        }
      }

      return response
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return <>{children}</>
}
