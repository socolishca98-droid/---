"use client"

/**
 * /forgot-password — «забыли пароль».
 *
 * Первый шаг восстановления: человек вводит почту учётной записи, система
 * присылает ссылку на страницу смены пароля.
 *
 * Ответ намеренно не говорит, есть ли такой адрес в системе: иначе форма
 * стала бы способом проверить, зарегистрирован ли человек.
 *
 * Водители входят по номеру телефона и почты не имеют — для них пароль меняет
 * логист, об этом сказано прямо на странице.
 */

import { useState, type FormEvent } from "react"
import Link from "next/link"

import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react"

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
import { PRODUCT_NAME } from "@/lib/auth/constants"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setNotice(null)
    setIsLoading(true)

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(data.error || "Не удалось отправить письмо. Попробуйте позже")
        return
      }

      if (data.notice) setNotice(String(data.notice))
      setDone(true)
    } catch {
      setError("Сервер недоступен. Проверьте соединение и попробуйте снова")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl tracking-tight">Восстановление пароля</CardTitle>
          <CardDescription className="leading-relaxed">
            {done
              ? "Проверьте почту — ссылка для смены пароля отправлена"
              : `Укажите почту учётной записи ${PRODUCT_NAME} — пришлём ссылку для смены пароля`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/40 p-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />
                <div className="space-y-1 text-sm">
                  <p>
                    Если адрес <span className="font-medium">{email}</span> зарегистрирован в
                    системе, письмо со ссылкой уже отправлено. Ссылка работает один час и
                    одноразовая.
                  </p>
                  <p className="text-muted-foreground">
                    Не нашли письмо? Проверьте папку «Спам» и папки рассылок.
                  </p>
                </div>
              </div>

              {notice ? (
                <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-500" />
                  <p>{notice}</p>
                </div>
              ) : null}

              <Button asChild className="w-full">
                <Link href="/login">Вернуться ко входу</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email учётной записи</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="logist@company.ru"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
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
                disabled={isLoading || !email.trim()}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Отправляем...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Прислать ссылку
                  </>
                )}
              </Button>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Водители входят по номеру телефона и почты не имеют — пароль им меняет
                логист в разделе «Водители».
              </p>
            </form>
          )}

          <div className="mt-6 border-t border-border/50 pt-4">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Вернуться ко входу
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
