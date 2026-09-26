// app/not-found.tsx — аккуратная 404 вместо пустого экрана.
//
// Сюда попадают и битые ссылки, и запросы к маршрутам, которых нет в текущей
// сборке (например, dev-сервер поднят на устаревшем .next). Раньше в таких
// случаях человек видел пустоту и не понимал, что случилось.

import Link from "next/link"
import { Home, MapPinOff } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <MapPinOff className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Страница не найдена</h1>
            <p className="text-sm text-muted-foreground">
              Адрес не существует в этой сборке
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          Если раздел точно должен быть — перезапустите сервер с чистой сборкой:
          остановите <code className="rounded bg-muted px-1">npm run dev</code>,
          выполните{" "}
          <code className="rounded bg-muted px-1">rm -rf .next</code> и
          запустите снова. Устаревший кэш сборки — самая частая причина, когда
          существующий маршрут отвечает 404.
        </p>

        <Button variant="outline" asChild className="mt-5 gap-2">
          <Link href="/dashboard">
            <Home className="h-4 w-4" />
            На главную
          </Link>
        </Button>
      </div>
    </div>
  )
}
