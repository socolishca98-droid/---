"use client"

/**
 * Экран входа сотрудника (admin / logist).
 *
 * Вход проверяется на сервере: POST /api/auth/login сверяет пароль с хэшем в БД
 * и выдаёт подписанный httpOnly-cookie. Никаких «демо-доступов» и подстановки
 * готовых учётных данных — их в системе больше нет.
 *
 * Если учётная запись помечена mustChangePassword (создана сид-скриптом или
 * пароль сбросил логист) — после входа показывается обязательная смена пароля.
 *
 * Оформление: живой фон приложения (LiveBackground из app/layout.tsx) остаётся
 * видимым — карточка полупрозрачная, слева брендовая панель с той же
 * геометрией маршрута, сверху приветствие по времени суток.
 */

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
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
  AlertCircle,
  BarChart3,
  Boxes,
  FileText,
  KeyRound,
  Loader2,
  Lock,
  Map,
  MapPinned,
  Route,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react"
import { PRODUCT_NAME } from "@/lib/auth/constants"
import { formatGreeting, formatHumanDate } from "@/lib/ui/greeting"
import { LoginScene } from "@/components/visual/login-scene"
import { Tilt3D } from "@/components/visual/tilt-3d"

interface LoginFormProps {
  /** Куда отправить после успешного входа */
  nextPath?: string
}

/** Что коротко показываем о системе на экране входа. */
const HIGHLIGHTS: Array<{ icon: typeof Boxes; text: string }> = [
  { icon: Boxes, text: "Заказы, рейсы и водители в одном окне" },
  { icon: MapPinned, text: "Живая карта: пробки, ETA и статусы машин" },
  { icon: Route, text: "Маршруты по настоящим дорогам: OSRM и плечи" },
  { icon: ShieldCheck, text: "Документы, оплаты и отчёты без Excel" },
]

/** Модули программы — «витрина наполненности» с первого взгляда. */
const MODULES: Array<{ icon: typeof Boxes; label: string }> = [
  { icon: Map, label: "Живая карта" },
  { icon: Route, label: "Маршруты OSRM" },
  { icon: Boxes, label: "Биржа грузов" },
  { icon: FileText, label: "Документы" },
  { icon: BarChart3, label: "Аналитика KPI" },
  { icon: Users, label: "Роли и доступы" },
]

export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter()
  const { login, user } = useAuth()

  // Приветствие по времени суток считаем на клиенте: серверный рендер и
  // гидратация не должны расходиться из-за часов.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => setNow(new Date()), [])

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  // Обязательная смена пароля
  const [needsPasswordChange, setNeedsPasswordChange] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const [isChanging, setIsChanging] = useState(false)

  // Куда вести после входа. Явный ?next= уважаем всегда; иначе логиста
  // отправляем в его мобильную панель /lm, а администратора — в полную версию.
  const explicitTarget =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : null
  const homeFor = (role?: string) => (role === "logist" ? "/lm" : "/dashboard")
  const redirectTarget = explicitTarget ?? homeFor(user?.role)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setIsLoading(true)

    const result = await login(email.trim(), password)
    setIsLoading(false)

    if (!result.ok) {
      setError(result.error || "Не удалось войти")
      return
    }

    if (result.mustChangePassword) {
      setNeedsPasswordChange(true)
      setCurrentPassword(password)
      return
    }

    // Кинематографичный «провал» в программу: сцена входа на миг
    // превращается в прыжок сквозь коридор — и только потом редирект
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    window.dispatchEvent(new CustomEvent("login:warp"))
    if (!reduced) await new Promise((resolve) => setTimeout(resolve, 720))

    // Владелец платформы — на свой стартовый экран; остальные — по роли
    router.replace(explicitTarget ?? (result.isOwner ? "/owner" : homeFor(result.role)))
    router.refresh()
  }

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")

    if (newPassword !== repeatPassword) {
      setError("Пароли не совпадают")
      return
    }

    setIsChanging(true)
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.success) {
        setError(data?.error || "Не удалось сменить пароль")
        return
      }

      router.replace(redirectTarget)
      router.refresh()
    } catch {
      setError("Ошибка соединения. Попробуйте ещё раз")
    } finally {
      setIsChanging(false)
    }
  }

  const eyebrow = now ? formatGreeting(null, now) : "Здравствуйте"
  const dateLabel = now ? formatHumanDate(now) : undefined

  if (needsPasswordChange) {
    return (
      <Shell
        eyebrow={eyebrow}
        dateLabel={dateLabel}
        title="Смените пароль"
        description="Учётная запись создана администратором или пароль был сброшен. Придумайте свой пароль, чтобы продолжить"
      >
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">Новый пароль</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="h-11"
              required
              minLength={8}
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
              autoComplete="new-password"
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
              className="h-11"
              required
              minLength={8}
            />
          </div>

          <ErrorBlock message={error} />

          <Button type="submit" className="w-full h-11" disabled={isChanging || !newPassword}>
            {isChanging ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Меняем пароль...
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4 mr-2" />
                Сменить пароль и войти
              </>
            )}
          </Button>
        </form>
      </Shell>
    )
  }

  return (
    <Shell
      eyebrow={eyebrow}
      dateLabel={dateLabel}
      title="Вход в систему"
      description="Доступ выдаёт администратор после одобрения заявки"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
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

        <div className="space-y-2">
          <Label htmlFor="password">Пароль</Label>
          <Input
            id="password"
            type="password"
            placeholder="Введите пароль"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            className="h-11"
          />
        </div>

        <ErrorBlock message={error} />

        <Button
          type="submit"
          className="w-full h-11"
          disabled={isLoading || !email.trim() || !password}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Проверяем...
            </>
          ) : (
            <>
              <Lock className="h-4 w-4 mr-2" />
              Войти
            </>
          )}
        </Button>
      </form>

      <div className="mt-6 pt-4 border-t border-border/50 space-y-2.5">
        {/* Забытый пароль раньше означал «зовите администратора» — теперь
            человек восстанавливает доступ сам, ссылкой на почту */}
        <p className="text-sm text-muted-foreground text-center">
          Забыли пароль?{" "}
          <Link href="/forgot-password" className="text-primary hover:underline font-medium">
            Восстановить доступ
          </Link>
        </p>
        <p className="text-sm text-muted-foreground text-center">
          Нет учётной записи?{" "}
          <Link href="/register" className="text-primary hover:underline font-medium">
            Оставить заявку на доступ
          </Link>
        </p>
        <p className="text-sm text-muted-foreground text-center">
          Вы водитель?{" "}
          <Link href="/m/login" className="text-primary hover:underline font-medium">
            Вход в приложение водителя
          </Link>
        </p>
      </div>
    </Shell>
  )
}

function ErrorBlock({ message }: { message: string }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="login-shake flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/25 p-3 rounded-xl"
    >
      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  )
}

function Shell({
  eyebrow,
  dateLabel,
  title,
  description,
  children,
}: {
  /** Приветствие по времени суток: «Доброе утро» */
  eyebrow: string
  /** «суббота, 26 сентября» — показываем, когда часы уже известны клиенту */
  dateLabel?: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    // Кинематографичный вход (просьба владельца): за экраном — 3D-полёт
    // сквозь коридор программы (LoginScene), каждый клик «проваливает»
    // глубже, успешный вход — ворп. Слева — витрина: что внутри системы,
    // чтобы серьёзность считывалась с первого взгляда.
    <div className="relative flex min-h-dvh items-center justify-center overflow-x-hidden px-4 py-6 sm:py-10 bg-[radial-gradient(120%_100%_at_12%_8%,oklch(0.22_0.04_40/0.4),transparent_55%),radial-gradient(90%_80%_at_92%_92%,oklch(0.2_0.04_255/0.4),transparent_60%)]">
      <LoginScene />
      <div className="relative z-10 grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-12">
        {/* Витрина программы — только на широких экранах */}
        <div className="scene-rise hidden lg:flex flex-col gap-7 rounded-3xl border border-border/40 bg-card/45 p-8 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <span className="login-mark h-14 w-14 shrink-0">
              <Truck className="h-7 w-7 text-primary-foreground" />
            </span>
            <div>
              <p className="text-2xl font-bold tracking-tight">{PRODUCT_NAME}</p>
              <p className="text-sm text-muted-foreground">
                система управления грузоперевозками
              </p>
            </div>
          </div>

          {/* Та же геометрия маршрута, что и на фоне: база → рейс → клиент */}
          <svg
            className="h-20 w-full max-w-md"
            viewBox="0 0 420 100"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              className="login-brand__track"
              d="M18 74 C 90 74, 110 30, 176 34 S 268 78, 336 52 S 386 30, 402 26"
            />
            <circle cx="18" cy="74" r="5" stroke="var(--primary)" strokeWidth="1.8" />
            <circle cx="18" cy="74" r="1.8" fill="var(--primary)" />
            <circle
              cx="176"
              cy="34"
              r="3"
              fill="color-mix(in oklab, var(--foreground) 45%, transparent)"
            />
            <rect
              x="396"
              y="20"
              width="12"
              height="12"
              rx="3"
              transform="rotate(45 402 26)"
              stroke="color-mix(in oklab, var(--foreground) 55%, transparent)"
              strokeWidth="1.6"
            />
          </svg>

          <div className="space-y-2.5">
            <h1 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
              Управление перевозками целиком — от заявки до документов
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Живая карта, маршруты по настоящим дорогам, биржа грузов, оплаты
              и аналитика — в одной системе, без Excel и звонков «где машина».
            </p>
          </div>

          <ul className="space-y-3">
            {HIGHLIGHTS.map((item) => (
              <li key={item.text} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card/60">
                  <item.icon className="h-4 w-4 text-primary" />
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {item.text}
                </span>
              </li>
            ))}
          </ul>

          {/* Модули: «наполненность» системы с первого взгляда */}
          <div
            data-login-info
            className="grid max-w-md grid-cols-2 gap-2 border-t border-border/40 pt-5"
          >
            {MODULES.map((m) => (
              <div
                key={m.label}
                className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/55 px-3 py-2 backdrop-blur-sm"
              >
                <m.icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Карточка входа */}
        <div className="mx-auto w-full max-w-md space-y-5">
          {/* Компактный логотип там, где витрины нет (узкие экраны) */}
          <div className="scene-rise flex items-center gap-3 lg:hidden">
            <span className="login-mark h-11 w-11 shrink-0">
              <Truck className="h-6 w-6 text-primary-foreground" />
            </span>
            <div>
              <p className="text-xl font-bold leading-tight tracking-tight">{PRODUCT_NAME}</p>
              <p className="text-xs text-muted-foreground">
                система управления грузоперевозками
              </p>
            </div>
          </div>

          <div className="card-enter">
            <Tilt3D>
              <Card className="login-card-glow border-border/60 bg-card/90 shadow-2xl shadow-black/40 sm:bg-card/85 sm:backdrop-blur-xl">
                <CardHeader className="space-y-1.5 pb-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                      {eyebrow}
                    </p>
                    {dateLabel && (
                      <p className="hidden text-[11px] text-muted-foreground sm:block">
                        {dateLabel}
                      </p>
                    )}
                  </div>
                  <CardTitle className="text-2xl tracking-tight">{title}</CardTitle>
                  <CardDescription className="leading-relaxed">{description}</CardDescription>
                </CardHeader>
                <CardContent>{children}</CardContent>
              </Card>
            </Tilt3D>
          </div>

          {/* Модули программы — компактная витрина на телефоне */}
          <div
            data-login-info
            className="scene-rise grid grid-cols-2 gap-2 lg:hidden"
            style={{ animationDelay: "0.25s" }}
          >
            {MODULES.map((m) => (
              <div
                key={m.label}
                className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-2.5 py-1.5"
              >
                <m.icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
