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
  AlertCircle,
  KeyRound,
  Loader2,
  Lock,
} from "lucide-react"
import { PRODUCT_NAME } from "@/lib/auth/constants"
import { formatGreeting, formatHumanDate } from "@/lib/ui/greeting"
import { LoginWorld } from "@/components/visual/login-world"

interface LoginFormProps {
  /** Куда отправить после успешного входа */
  nextPath?: string
}

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

      <div className="mt-4 space-y-1.5 border-t border-border/50 pt-3">
        {/* Забытый пароль раньше означал «зовите администратора» — теперь
            человек восстанавливает доступ сам, ссылкой на почту */}
        <p className="text-[13px] text-muted-foreground text-center">
          Забыли пароль?{" "}
          <Link href="/forgot-password" className="text-primary hover:underline font-medium">
            Восстановить доступ
          </Link>
        </p>
        <p className="text-[13px] text-muted-foreground text-center">
          Нет учётной записи?{" "}
          <Link href="/register" className="text-primary hover:underline font-medium">
            Оставить заявку на доступ
          </Link>
        </p>
        <p className="text-[13px] text-muted-foreground text-center">
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
    // Вход как 3D-мир (просьба владельца: «всё интегрировано в 3D, больше
    // объёма, перемещаемся в пространстве»). Камера едет сквозь ночь,
    // форма — объект мира на ближайшей глубине, заголовок парит в небе.
    <div className="relative min-h-dvh">
      <LoginWorld
        headline={
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/45">
              {PRODUCT_NAME}
            </p>
            <h2 className="mt-3 text-[30px] font-extrabold leading-[1.06] tracking-tight text-white sm:text-[40px]">
              От заявки —
              <br />
              до документов
            </h2>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-400 sm:text-sm">
              Живая карта, маршруты по настоящим дорогам, биржа грузов и оплаты
              — в одной системе, без Excel и звонков «где машина».
            </p>
          </div>
        }
      >
        <div className="mb-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            {eyebrow}
            {dateLabel ? ` · ${dateLabel}` : ""}
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {children}
      </LoginWorld>
    </div>
  )
}
