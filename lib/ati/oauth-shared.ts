// lib/ati/oauth-shared.ts
//
// Общий помощник OAuth-маршрутов ATI: базовый адрес приложения для
// redirect_uri. Берётся из APP_BASE_URL (продакшен — домен, зарегистрированный
// в ATI) или из адреса текущего запроса (локальная разработка).

import type { NextRequest } from "next/server"

export function appBaseUrl(request: NextRequest): string {
  const configured = process.env.APP_BASE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, "")
  return request.nextUrl.origin
}
