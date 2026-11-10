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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  Truck,
} from "lucide-react"
import { PRODUCT_NAME } from "@/lib/auth/constants"
import { LoginWorld } from "@/components/visual/login-world"

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
  // Согласие на обработку персональных данных (152-ФЗ): без него регистрация
  // невозможна — согласие является правовым основанием обработки данных
  const [acceptedTerms, setAcceptedTerms] = useState(false)

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

    if (!acceptedTerms) {
      setError("Примите условия: согласие на обработку данных и пользовательское соглашение")
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
          acceptedTerms,
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
        // и21: уходим красиво — «ночный тоннель» до страницы входа
        // (эстафету подхватит приветствие после первого входа)
        const reduced =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        if (!reduced) window.dispatchEvent(new CustomEvent("login:warp"))
        setTimeout(() => router.push("/login"), reduced ? 2500 : 2200)
      }
    } catch {
      setError("Ошибка соединения. Попробуйте ещё раз")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    // Регистрация — в том же 3D-мире «Ночной рейс» (и21: раньше была
    // «своя карточка» мимо системы — теперь тоже пропуск-документ со
    // штрихкодом и приездом по касанию). Форма длинная: зона полей
    // прокручивается внутри пропуска, вкладки и итог — всегда на виду.
    <div className="relative min-h-dvh">
      <LoginWorld
        headline={
          <div>
            <p className="flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-white/45 lg:justify-start">
              <Truck className="h-4 w-4 text-orange-400" />
              {PRODUCT_NAME}
            </p>
            <h2 className="mt-3 text-[30px] font-extrabold leading-[1.06] tracking-tight text-white sm:text-[40px]">
              Перевозки —
              <br />
              в одной системе
            </h2>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-400 sm:text-sm">
              Создайте организацию своей компании или присоединитесь по коду
              приглашения.
            </p>
          </div>
        }
      >
        <div className="mb-3 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Регистрация
          </p>
          <h1 className="mt-1 text-[17px] font-bold tracking-tight sm:text-xl">
            {submitted ? (submitted.canLogin ? "Организация готова" : "Заявка отправлена") : "Новый пропуск"}
          </h1>
          <p className="mt-1 hidden text-xs leading-relaxed text-muted-foreground sm:block">
            Свою компанию — или по коду приглашения от администратора
          </p>
        </div>
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
        <div className="max-h-[48dvh] overflow-y-auto pr-1">
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
                      placeholder="Название организации или ФИО для ИП"
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
                    placeholder="Имя и фамилия"
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
                    placeholder="email@example.ru"
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

                <label className="flex items-start gap-2.5 text-sm leading-relaxed cursor-pointer">
                  <Checkbox
                    id="acceptedTerms"
                    checked={acceptedTerms}
                    onCheckedChange={(value) => setAcceptedTerms(value === true)}
                    className="mt-0.5"
                  />
                  <span className="text-muted-foreground">
                    Я согласен на обработку персональных данных и принимаю{" "}
                    <Link href="/privacy" className="text-primary hover:underline">
                      политику конфиденциальности
                    </Link>{" "}
                    и{" "}
                    <Link href="/terms" className="text-primary hover:underline">
                      условия использования
                    </Link>
                  </span>
                </label>

                <Button
                  type="submit"
                  className="w-full h-11"
                  disabled={isLoading || !acceptedTerms}
                >
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
        </div>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Уже есть доступ?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Войти
          </Link>
        </p>
      </LoginWorld>
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
