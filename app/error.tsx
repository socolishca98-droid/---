"use client"

/**
 * Граница ошибок приложения (app/error.tsx).
 *
 * Зачем: любая необработанная ошибка в интерфейсе раньше показывала белый
 * экран Next.js на английском. Водитель или логист видели «Application error»
 * без объяснения и без выхода. Теперь — свой экран на русском: что случилось,
 * что делать, куда вернуться.
 *
 * Ошибку параллельно отправляем в мониторинг (если задан SENTRY_DSN), иначе —
 * в консоль. Идентификатор (digest) показываем человеку: по нему ошибку можно
 * найти в логах, и он одинаковый в браузере и в отчёте.
 */

import { useEffect } from "react"

import { AlertTriangle, Home, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { captureException } from "@/lib/sentry"

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureException(error, { digest: error.digest, boundary: "app/error" })
  }, [error])

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="size-5 text-destructive" />
          </div>
          <CardTitle>Что-то сломалось</CardTitle>
          <CardDescription>
            Страница не открылась из-за ошибки в приложении. Данные не потеряны —
            попробуйте открыть страницу заново.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error.digest ? (
            <p className="text-xs text-muted-foreground">
              Код ошибки: <span className="font-mono">{error.digest}</span> — его
              можно сообщить администратору.
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={reset} className="flex-1">
              <RefreshCw className="size-4" />
              Попробовать снова
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                window.location.href = "/"
              }}
            >
              <Home className="size-4" />
              На главную
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
