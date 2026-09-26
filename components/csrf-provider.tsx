// components/csrf-provider.tsx - P1-3 CSRF auto-injection for mutating API calls
"use client"

import { useEffect } from "react"

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"))
  return match ? decodeURIComponent(match[2]) : null
}

function shouldAddCsrf(url: string, method: string): boolean {
  if (!url) return false
  const m = method?.toUpperCase()
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(m)) return false
  // Only for /api/ routes, excluding /api/m/ and /api/auth/csrf
  try {
    // Handle relative URLs
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

export function CsrfProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Fetch CSRF token once on mount to set cookie
    fetch("/api/auth/csrf", { method: "GET", credentials: "include" }).catch(() => {})

    const originalFetch = window.fetch

    // Patch window.fetch to auto-add CSRF header
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url
      const method = init?.method || (typeof input !== "string" && input instanceof Request ? input.method : "GET")

      if (shouldAddCsrf(url, method)) {
        let csrfFromCookie = getCookie("loginex_csrf")

        // Первый запрос после входа уходил без заголовка: cookie ещё нет,
        // сервер отвечал «Сессия устарела: не прошёл CSRF-токен».
        // Поэтому сначала дожидаемся токена, а потом отправляем запрос.
        if (!csrfFromCookie) {
          try {
            const tokenResponse = await originalFetch("/api/auth/csrf", {
              method: "GET",
              credentials: "include",
              cache: "no-store",
            })
            if (tokenResponse.ok) {
              csrfFromCookie = getCookie("loginex_csrf")
            }
          } catch {
            // сеть недоступна — отправляем запрос как есть
          }
        }

        const headers = new Headers(init?.headers || (typeof input !== "string" && input instanceof Request ? (input as Request).headers : undefined))
        if (csrfFromCookie && !headers.has("x-csrf-token")) {
          headers.set("x-csrf-token", csrfFromCookie)
        }
        init = { ...init, headers, credentials: init?.credentials || "include" }
      }

      return originalFetch(input, init as any)
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return <>{children}</>
}
