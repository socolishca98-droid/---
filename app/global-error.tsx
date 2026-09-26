"use client"

// app/global-error.tsx — последняя граница: ошибка в самом корневом макете.
//
// Этот экран подменяет корневой layout, поэтому стили приложения могут быть
// недоступны — оформление задано встроенными стилями, чтобы экран точно
// отрисовался в любом состоянии.

import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[app] критическая ошибка интерфейса:", error)
  }, [error])

  const page: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    background: "#09090b",
    color: "#fafafa",
    fontFamily:
      "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  }

  const card: React.CSSProperties = {
    width: "100%",
    maxWidth: 460,
    padding: 24,
    borderRadius: 14,
    border: "1px solid #27272a",
    background: "#18181b",
  }

  const muted: React.CSSProperties = { color: "#a1a1aa", lineHeight: 1.6 }

  const pre: React.CSSProperties = {
    marginTop: 12,
    maxHeight: 140,
    overflow: "auto",
    padding: 12,
    borderRadius: 8,
    background: "#27272a",
    color: "#d4d4d8",
    fontSize: 12,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  }

  const button: React.CSSProperties = {
    marginTop: 20,
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid #3f3f46",
    background: "#fafafa",
    color: "#18181b",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  }

  return (
    <html lang="ru">
      <body style={page}>
        <main style={card}>
          <h1 style={{ fontSize: 18, margin: 0 }}>Приложение не запустилось</h1>
          <p style={{ ...muted, fontSize: 14, marginTop: 8 }}>
            Произошла ошибка в общей оболочке — данные не затронуты. Обновите
            страницу; если это повторяется, причина указана ниже.
          </p>
          <pre style={pre}>
            {error?.message || "Неизвестная ошибка"}
            {error?.digest ? `\ndigest: ${error.digest}` : ""}
          </pre>
          <button type="button" style={button} onClick={reset}>
            Обновить страницу
          </button>
        </main>
      </body>
    </html>
  )
}
