"use client"

// app/error.tsx — граница ошибок приложения.
//
// Без этого файла любая необработанная ошибка в клиентском компоненте гасила
// всё дерево React: человек видел просто тёмный экран и ничего не мог понять.
// Теперь ошибка показывается текстом, а страницу можно перезапустить кнопкой.

import { useEffect } from "react"
import Link from "next/link"
import { AlertTriangle, Home, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[app] необработанная ошибка интерфейса:", error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Что-то пошло не так</h1>
            <p className="text-sm text-muted-foreground">
              Раздел не смог отрисоваться
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          Данные не затронуты: это сбой показа, а не операции. Нажмите
          «Обновить» — если повторится, причина указана ниже.
        </p>

        <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          {error?.message || "Неизвестная ошибка"}
          {error?.digest ? `\ndigest: ${error.digest}` : ""}
        </pre>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={reset} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Обновить
          </Button>
          <Button variant="outline" asChild className="gap-2">
            <Link href="/dashboard">
              <Home className="h-4 w-4" />
              На главную
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
