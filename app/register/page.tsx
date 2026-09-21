"use client"

/**
 * /register — заявка на доступ.
 *
 * Человек сам регистрируется (имя, email, пароль) и попадает в статус
 * «ожидает одобрения». Вход разрешён только после того, как логист одобрит
 * заявку на странице /users.
 *
 * Исключение: если в базе нет ни одной учётной записи, первая регистрация
 * становится администратором — иначе одобрять её некому (сервер сообщает
 * об этом отдельно, и на экране показывается предупреждение).
 */

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { AlertCircle, CheckCircle2, Loader2, Truck, UserPlus } from "lucide-react"
import { PRODUCT_NAME } from "@/lib/auth/constants"

export default function RegisterPage() {
  const router = useRouter()

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [submitted, setSubmitted] = useState<{ message: string; bootstrapped: boolean } | null>(
    null,
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")

    if (password !== repeatPassword) {
      setError("Пароли не совпадают")
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.success) {
        setError(data?.error || "Не удалось отправить заявку")
        return
      }

      setSubmitted({ message: data.message, bootstrapped: Boolean(data.bootstrapped) })
      if (data.bootstrapped) {
        // Первая учётная запись в системе — вход доступен сразу
        setTimeout(() => router.push("/login"), 2500)
      }
    } catch {
      setError("Ошибка соединения. Попробуйте ещё раз")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4">
            <Truck className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{PRODUCT_NAME}</h1>
          <p className="text-muted-foreground">заявка на доступ к системе</p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Регистрация сотрудника</CardTitle>
            <CardDescription>
              После отправки заявки логист проверит её и откроет доступ
            </CardDescription>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="space-y-4">
                <div
                  className={`flex items-start gap-2 text-sm p-3 rounded-lg ${
                    submitted.bootstrapped
                      ? "bg-primary/10 text-primary"
                      : "bg-emerald-500/10 text-emerald-500"
                  }`}
                >
                  {submitted.bootstrapped ? (
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  )}
                  <span>{submitted.message}</span>
                </div>

                {submitted.bootstrapped && (
                  <p className="text-xs text-muted-foreground">
                    В системе не было ни одной учётной записи, поэтому вы получили роль
                    администратора. Сейчас вы попадёте на экран входа.
                  </p>
                )}

                <Button className="w-full h-11" onClick={() => router.push("/login")} type="button">
                  Перейти к входу
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Имя и фамилия</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Иван Петров"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    required
                    minLength={2}
                    maxLength={80}
                    className="h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="ivan@company.ru"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    required
                    className="h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Пароль</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">
                    Минимум 8 символов, буквы и цифры
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="repeat-password">Повторите пароль</Label>
                  <Input
                    id="repeat-password"
                    type="password"
                    value={repeatPassword}
                    onChange={(event) => setRepeatPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    className="h-11"
                  />
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg"
                  >
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-11"
                  disabled={isLoading || !name.trim() || !email.trim() || !password}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Отправляем...
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Отправить заявку
                    </>
                  )}
                </Button>
              </form>
            )}

            <div className="mt-6 pt-4 border-t border-border/50">
              <p className="text-sm text-muted-foreground text-center">
                Уже есть доступ?{" "}
                <Link href="/login" className="text-primary hover:underline font-medium">
                  Войти
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
