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

import { Suspense, useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatHumanDate } from "@/lib/ui/greeting"
import { Label } from "@/components/ui/label"
import { PRODUCT_NAME } from "@/lib/auth/constants"
import { LoginWorld } from "@/components/visual/login-world"
// Минимальную длину пароля берём из lib/auth/constants — файла без node:util.
// Импорт из lib/auth/password тянул в клиентский бандл node:util, и страница
// падала на этапе оценки модуля, не показав форму (см. аудит, блокер Б-2).
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants"

/**
 * useSearchParams в Next требует границы Suspense: без неё prerender падает
 * с «useSearchParams() should be wrapped in a suspense boundary», и production-
 * сборка не собирается вовсе (в dev-режиме prerender не выполняется, поэтому
 * дефект был не виден). Остальные страницы с поисковыми параметрами
 * (/register, /m/photo, /print/route/…) обёрнуты так же.
 */
function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = (searchParams?.get("token") || "").trim()

  const [checking, setChecking] = useState(true)

  // Дата на пропуске — на клиенте, чтобы SSR не расходился с гидратацией
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => setNow(new Date()), [])
  const dateLabel = now ? formatHumanDate(now) : undefined
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
      <ResetWorld title="Проверяем ссылку">
        <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Проверяем ссылку...
        </div>
      </ResetWorld>
    )
  }

  if (linkError) {
    return (
      <ResetWorld title="Ссылка не работает" subtitle={linkError}>
        <div className="space-y-4">
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
        </div>
      </ResetWorld>
    )
  }

  return (
    <ResetWorld
      dateLabel={dateLabel}
      title={done ? "Пароль изменён" : "Новый пароль"}
      subtitle={
        done
          ? "Прежние сессии закрыты"
          : `Не короче ${MIN_PASSWORD_LENGTH} символов, буквы и цифры`
      }
    >
      <div className="max-h-[46dvh] overflow-y-auto pr-1">
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
      </div>
    </ResetWorld>
  )
}

/** Общий каркас страницы смены пароля (и21): тот же мир «Ночной
 *  рейс» и пропуск-документ, что у входа и регистрации. */
function ResetWorld({
  title,
  subtitle,
  dateLabel,
  children,
}: {
  title: string
  subtitle?: string
  dateLabel?: string
  children: React.ReactNode
}) {
  return (
    <LoginWorld
      headline={
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/45">
            {PRODUCT_NAME}
          </p>
          <h2 className="mt-3 text-[30px] font-extrabold leading-[1.06] tracking-tight text-white sm:text-[40px]">
            Новый
            <br />
            пароль
          </h2>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-400 sm:text-sm">
            Пропуск перевыпустим за минуту — и снова в путь.
          </p>
        </div>
      }
    >
      <div className="mb-4 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
          Восстановление{dateLabel ? ` · ${dateLabel}` : ""}
        </p>
        <h1 className="mt-1 text-[17px] font-bold tracking-tight sm:text-xl">{title}</h1>
        {subtitle ? (
          <p className="mt-1 hidden text-xs leading-relaxed text-muted-foreground sm:block">
            {subtitle}
          </p>
        ) : null}
      </div>
      {children}
      <p className="mt-4 text-center text-sm text-muted-foreground">
        <Link href="/login" className="hover:text-foreground">
          Вернуться ко входу
        </Link>
      </p>
    </LoginWorld>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Проверяем ссылку...
          </div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  )
}
