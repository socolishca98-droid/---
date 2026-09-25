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
 */

import { useState, type FormEvent } from "react"
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
import { AlertCircle, KeyRound, Loader2, Lock, ShieldCheck, Truck } from "lucide-react"
import { PRODUCT_NAME } from "@/lib/auth/constants"

interface LoginFormProps {
  /** Куда отправить после успешного входа */
  nextPath?: string
}

export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter()
  const { login } = useAuth()

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

  const redirectTarget = nextPath && nextPath.startsWith("/") ? nextPath : "/dashboard"

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

    router.replace(redirectTarget)
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

  if (needsPasswordChange) {
    return (
      <Shell
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
      title="Вход в систему"
      description="Доступ выдается администратором после одобрения заявки"
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

      <div className="mt-6 pt-4 border-t border-border/50 space-y-3">
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
      className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg"
    >
      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  )
}

function Shell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background/70 via-background/40 to-primary/10 p-4">
      <div className="rise-in w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4">
            <Truck className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{PRODUCT_NAME}</h1>
          <p className="text-muted-foreground flex items-center justify-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            система управления грузоперевозками
          </p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </div>
  )
}
