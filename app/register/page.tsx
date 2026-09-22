// app/register/page.tsx
"use client"

import type React from "react"
import { useState } from "react"
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
import {
  Truck,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react"
import { getCsrfToken } from "@/lib/csrf-client"

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [isSuccess, setIsSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError("")

    if (password.length < 4) {
      setError("Пароль должен содержать минимум 4 символа")
      return
    }

    if (password !== confirmPassword) {
      setError("Введенные пароли не совпадают")
      return
    }

    setIsLoading(true)

    try {
      let csrfToken = ""
      try {
        csrfToken = await getCsrfToken()
      } catch {}
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
        }),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setIsSuccess(true)
      } else {
        setError(data.error || "Не удалось зарегистрировать аккаунт")
      }
    } catch {
      setError("Ошибка сети при отправке запроса")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-2 shadow-lg shadow-primary/20">
            <Truck className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Loginex TMS</h1>
          <p className="text-xs text-muted-foreground">
            Регистрация нового логиста / диспетчера
          </p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Заявка на доступ</CardTitle>
            <CardDescription>
              Заполните свои данные для создания учётной записи в системе
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSuccess ? (
              <div className="space-y-5 text-center py-4">
                <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold text-lg">Заявка успешно отправлена!</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Ваш аккаунт зарегистрирован и передан на одобрение администратору или старшему логисту.
                    После подтверждения заявки вы сможете войти в Loginex.
                  </p>
                </div>
                <div className="pt-2">
                  <Button
                    className="w-full h-11"
                    onClick={() => router.push("/login")}
                  >
                    Вернуться ко входу
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">ФИО или имя</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Алексей Морозов"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="h-10"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Корпоративный или личный Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="morozov@loginex.ru"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-10"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Пароль (от 4 символов)</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-10"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Повторите пароль</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="h-10"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg border border-destructive/20">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {error}
                  </div>
                )}

                <div className="rounded-lg bg-muted/50 p-3 flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>
                    В целях безопасности новая учетная запись активируется только после верификации уполномоченным логистом.
                  </span>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 text-base"
                  disabled={isLoading || !email.trim() || !password.trim()}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Отправка заявки...
                    </>
                  ) : (
                    "Отправить заявку на регистрацию"
                  )}
                </Button>

                <div className="text-center pt-2">
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Уже зарегистрированы? Войти
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
