"use client"

/**
 * /reset-password?token=… — задать новый пароль по ссылке из письма.
 *
 * Ссылка проверяется до отправки формы (GET /api/auth/reset-password): нечего
 * заставлять человека придумывать пароль для мёртвой ссылки.
 *
 * После смены пароля все прежние сессии закрыты — об этом сказано прямо,
 * иначе человек удивится, почему его разлогинило на других устройствах.
 */

import { useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password"

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = (searchParams?.get("token") || "").trim()

  const [checking, setChecking] = useState(true)
  const [linkError, setLinkError] = useState("")
  const [password, setPassword] = useState("")
  const [repeat, setRepeat] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      if (!token) {
        setLinkError("В ссылке нет токена восстановления — откройте письмо ещё раз")
        setChecking(false)
        return
      }

      try {
        const response = await fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
        const data = await response.json().catch(() => ({}))

        if (cancelled) return

        if (!response.ok || data.valid === false) {
          setLinkError(data.error || "Ссылка восстановления недействительна")
        }
      } catch {
        if (!cancelled) setLinkError("Сервер недоступен. Попробуйте позже")
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    check()
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError("")

    if (password !== repeat) {
      setError("Пароли не совпадают")
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(data.error || "Не удалось сменить пароль")
        return
      }

      setDone(true)
      // Не auto-логиним: пусть человек войдёт сам новым паролем — так он его
      // сразу проверит и запомнит
      window.setTimeout(() => router.push("/login"), 2500)
    } catch {
      setError("Сервер недоступен. Проверьте соединение и попробуйте снова")
    } finally {
      setIsLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Проверяем ссылку...
          </CardContent>
        </Card>
      </div>
    )
  }

  if (linkError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl tracking-tight">Ссылка не работает</CardTitle>
            <CardDescription className="leading-relaxed">{linkError}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Ссылки живут один час и работают один раз. Запросите новую — она придёт на
              почту учётной записи.
            </p>
            <Button asChild className="w-full">
              <Link href="/forgot-password">Запросить новую ссылку</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Вернуться ко входу</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl tracking-tight">Новый пароль</CardTitle>
          <CardDescription className="leading-relaxed">
            {done
              ? "Пароль изменён"
              : `Придумайте пароль: не короче ${MIN_PASSWORD_LENGTH} символов, буквы и цифры`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/40 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />
                <p>
                  Пароль изменён, прежние сессии закрыты. Сейчас откроется страница входа —
                  войдите с новым паролем.
                </p>
              </div>
              <Button asChild className="w-full">
                <Link href="/login">Перейти ко входу</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Новый пароль</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="repeat">Повторите пароль</Label>
                <Input
                  id="repeat"
                  type="password"
                  value={repeat}
                  onChange={(event) => setRepeat(event.target.value)}
                  autoComplete="new-password"
                  required
                  className="h-11"
                />
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <p>{error}</p>
                </div>
              ) : null}

              <Button
                type="submit"
                className="w-full h-11"
                disabled={isLoading || !password || !repeat}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Сохраняем...
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4 mr-2" />
                    Сохранить пароль
                  </>
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
