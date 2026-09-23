"use client"

/**
 * /register — регистрация сотрудника.
 *
 * Два сценария (переключаются вкладками):
 *   1. «Своя организация» — первый пользователь компании указывает её название,
 *      организация создаётся, а он становится её администратором. Вход сразу.
 *   2. «По коду приглашения» — сотрудник существующей компании вводит код,
 *      который ему дал админ. Заявка получает статус «ожидает одобрения»,
 *      одобряет её админ ЭТОЙ организации на экране /organization.
 *
 * Присоединиться по названию компании нельзя: название не секрет.
 *
 * Поддержка ссылки-приглашения: /register?invite=XXXX-XXXX-XXXX — код
 * подставляется в форму и сразу открывается нужная вкладка.
 */

import { Suspense, useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  Truck,
} from "lucide-react"
import { PRODUCT_NAME } from "@/lib/auth/constants"

type Mode = "create" | "join"

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const inviteFromLink = (searchParams?.get("invite") || "").trim().toUpperCase()
  const [mode, setMode] = useState<Mode>(inviteFromLink ? "join" : "create")

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const [organizationName, setOrganizationName] = useState("")
  const [inviteCode, setInviteCode] = useState(inviteFromLink)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [submitted, setSubmitted] = useState<{
    message: string
    scenario: string
    organizationName?: string | null
    canLogin: boolean
  } | null>(null)

  useEffect(() => {
    if (inviteFromLink) {
      setMode("join")
      setInviteCode(inviteFromLink)
    }
  }, [inviteFromLink])

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
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          ...(mode === "create"
            ? { organizationName: organizationName.trim() }
            : { inviteCode: inviteCode.trim() }),
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.success) {
        setError(data?.error || "Не удалось отправить заявку")
        return
      }

      setSubmitted({
        message: data.message,
        scenario: data.scenario,
        organizationName: data.organization?.name ?? null,
        // Сценарий «своя организация» даёт доступ сразу, заявка по коду ждёт одобрения
        canLogin: data.status === "active",
      })
      if (data.status === "active") {
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
          <p className="text-muted-foreground">доступ к системе для вашей компании</p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="space-y-3 pb-4">
            <CardTitle className="text-xl">Регистрация</CardTitle>
            <CardDescription>
              Создайте организацию для своей компании или присоединитесь к существующей по коду
              приглашения
            </CardDescription>

            {!submitted && (
              <Tabs
                value={mode}
                onValueChange={(value) => setMode(value as Mode)}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="create" className="gap-1.5 text-xs">
                    <Building2 className="h-3.5 w-3.5" />
                    Своя организация
                  </TabsTrigger>
                  <TabsTrigger value="join" className="gap-1.5 text-xs">
                    <KeyRound className="h-3.5 w-3.5" />
                    По коду
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="space-y-4">
                <div
                  className={`flex items-start gap-2 text-sm p-3 rounded-lg ${
                    submitted.canLogin
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-primary/10 text-primary"
                  }`}
                >
                  {submitted.canLogin ? (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  )}
                  <span>{submitted.message}</span>
                </div>

                {submitted.organizationName && (
                  <p className="text-xs text-muted-foreground">
                    Организация: <span className="text-foreground">{submitted.organizationName}</span>
                  </p>
                )}

                {!submitted.canLogin && (
                  <p className="text-xs text-muted-foreground">
                    Администратор организации увидит заявку на экране «Организация» и откроет доступ.
                    До одобрения вход недоступен.
                  </p>
                )}

                <Button className="w-full h-11" onClick={() => router.push("/login")} type="button">
                  Перейти к входу
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === "create" ? (
                  <div className="space-y-2">
                    <Label htmlFor="organizationName">Название организации</Label>
                    <Input
                      id="organizationName"
                      type="text"
                      placeholder="ИП Фролов Иван Александрович"
                      value={organizationName}
                      onChange={(event) => setOrganizationName(event.target.value)}
                      autoComplete="organization"
                      required
                      minLength={2}
                      maxLength={120}
                    />
                    <p className="text-xs text-muted-foreground">
                      Вы станете администратором этой организации и сможете выдавать коды
                      приглашения сотрудникам
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="inviteCode">Код приглашения</Label>
                    <Input
                      id="inviteCode"
                      type="text"
                      placeholder="XXXX-XXXX-XXXX"
                      value={inviteCode}
                      onChange={(event) =>
                        setInviteCode(event.target.value.toUpperCase().slice(0, 14))
                      }
                      autoComplete="one-time-code"
                      required
                      className="font-mono tracking-widest uppercase"
                    />
                    <p className="text-xs text-muted-foreground">
                      Код выдаёт администратор вашей организации на экране «Организация».
                      Организация и роль берутся из кода
                    </p>
                  </div>
                )}

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
                    autoComplete="email"
                    required
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
                    maxLength={128}
                  />
                  <p className="text-xs text-muted-foreground">
                    Не короче 8 символов, буквы и цифры
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="repeatPassword">Повторите пароль</Label>
                  <Input
                    id="repeatPassword"
                    type="password"
                    value={repeatPassword}
                    onChange={(event) => setRepeatPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={128}
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" className="w-full h-11" disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : mode === "create" ? (
                    <>
                      <Building2 className="h-4 w-4 mr-2" />
                      Создать организацию
                    </>
                  ) : (
                    <>
                      <KeyRound className="h-4 w-4 mr-2" />
                      Отправить заявку
                    </>
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Уже есть доступ?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  )
}
