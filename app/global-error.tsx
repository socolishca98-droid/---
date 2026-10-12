"use client"

/**
 * Последняя граница ошибок (app/global-error.tsx).
 *
 * Сюда Next приходит, когда сломался сам корневой layout — тогда app/error.tsx
 * уже некому показать. Поэтому здесь свои <html> и <body> и минимум зависимостей:
 * провайдеры темы и контекста как раз могут быть той самой причиной поломки.
 *
 * Текст и поведение те же, что у app/error.tsx: человек понимает, что случилось,
 * и знает, куда нажать.
 */

import { useEffect } from "react"

import { AlertTriangle, Home, RefreshCw } from "lucide-react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Здесь нельзя тянуть провайдеры приложения: они могут быть сломаны.
    // Sentry подключается своим клиентским конфигом, если задан DSN.
    void (async () => {
      try {
        const { captureException } = await import("@/lib/sentry")
        captureException(error, { digest: error.digest, boundary: "app/global-error" })
      } catch {
        // если и мониторинг не поднялся — хотя бы в консоль
        console.error("[global-error]", error)
      }
    })()
  }, [error])

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#141414",
          color: "#f5f5f5",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, width: "100%" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#f87171",
              fontWeight: 600,
            }}
          >
            <AlertTriangle size={20} />
            Что-то сломалось
          </div>
          <p style={{ color: "#a3a3a3", lineHeight: 1.5 }}>
            Приложение не смогло открыться из-за ошибки. Данные не потеряны —
            попробуйте загрузить страницу заново.
          </p>
          {error.digest ? (
            <p style={{ color: "#737373", fontSize: 12 }}>
              Код ошибки: <code>{error.digest}</code> — его можно сообщить
              администратору.
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              onClick={reset}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: "#f5f5f5",
                color: "#141414",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <RefreshCw size={16} />
              Попробовать снова
            </button>
            <button
              onClick={() => {
                window.location.href = "/"
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #404040",
                background: "transparent",
                color: "#f5f5f5",
                cursor: "pointer",
              }}
            >
              <Home size={16} />
              На главную
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
