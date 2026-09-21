// components/login-form.tsx
"use client"

import type React from "react"
import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Truck,
  User,
  Loader2,
  AlertCircle,
  Phone,
  Building2,
  Clock,
  UserPlus,
} from "lucide-react"

type RoleTab = "logist" | "driver"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get("from") || "/dashboard"
  const { setUser } = useAuth()

  const [activeTab, setActiveTab] = useState<RoleTab>("logist")

  // Для логиста
  const [email, setEmail] = useState<string>("")
  const [password, setPassword] = useState<string>("")

  // Для водителя
  const [driverOrg, setDriverOrg] = useState<string>("")
  const [driverPhone, setDriverPhone] = useState<string>("")

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [statusNotice, setStatusNotice] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError("")
    setStatusNotice(null)
    setIsLoading(true)

    try {
      if (activeTab === "logist") {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            password: password,
          }),
        })

        const data = await res.json()

        if (res.ok && data.success && data.user) {
          setUser(data.user)
          router.push(from)
        } else {
          if (data.status === "pending_approval") {
            setStatusNotice(data.error)
          } else {
            setError(data.error || "Неверный email или пароль")
          }
        }
      } else {
        if (!driverOrg.trim() || !driverPhone.trim()) {
          setError("Укажите организацию и номер телефона")
          setIsLoading(false)
          return
        }

        const res = await fetch("/api/m/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: driverPhone.trim(),
            organization: driverOrg.trim(),
          }),
        })

        const data = await res.json()

        if (res.ok && data.success && data.driver) {
          if (typeof window !== "undefined") {
            localStorage.setItem("driver_session", JSON.stringify(data.driver))
          }
          router.push("/m")
        } else {
          setError(data.error || "Водитель не найден в автопарке")
        }
      }
    } catch (err: any) {
      console.error(err)
      setError("Ошибка соединения с сервером")
    } finally {
      setIsLoading(false)
    }
  }

  const demoLogist = {
    email: "admin@loginex.ru",
    password: "demo",
  }

  const demoDriver = {
    organization: "АИ Логистика",
    phone: "+7 (916) 123-45-67",
  }

  const fillDemo = () => {
    setError("")
    setStatusNotice(null)
    if (activeTab === "logist") {
      setEmail(demoLogist.email)
      setPassword(demoLogist.password)
    } else {
      setDriverOrg(demoDriver.organization)
      setDriverPhone(demoDriver.phone)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4 shadow-lg shadow-primary/20">
            <Truck className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Loginex TMS</h1>
          <p className="text-muted-foreground">
            Профессиональная система управления перевозками
          </p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Вход в систему</CardTitle>
            <CardDescription>
              Выберите тип профиля для авторизации
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              value={activeTab}
              onValueChange={(v) => {
                setActiveTab(v as RoleTab)
                setError("")
                setStatusNotice(null)
              }}
              className="space-y-4"
            >
              <TabsList className="grid w-full grid-cols-2 h-12">
                <TabsTrigger
                  value="logist"
                  className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  <User className="h-4 w-4" />
                  Диспетчер / Логист
                </TabsTrigger>
                <TabsTrigger
                  value="driver"
                  className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  <Truck className="h-4 w-4" />
                  Водитель
                </TabsTrigger>
              </TabsList>

              <form onSubmit={handleSubmit} className="space-y-4">
                {activeTab === "logist" ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="admin@loginex.ru"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="h-11"
                        autoComplete="email"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="password">Пароль</Label>
                      </div>
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="h-11"
                        autoComplete="current-password"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="org">Организация</Label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="org"
                          type="text"
                          placeholder="АИ Логистика"
                          value={driverOrg}
                          onChange={(e) => setDriverOrg(e.target.value)}
                          className="h-11 pl-9"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="driver-phone">Телефон</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="driver-phone"
                          type="tel"
                          placeholder="+7 (916) 123-45-67"
                          value={driverPhone}
                          onChange={(e) => setDriverPhone(e.target.value)}
                          className="h-11 pl-9"
                          required
                        />
                      </div>
                    </div>
                  </>
                )}

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg border border-destructive/20">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {error}
                  </div>
                )}

                {statusNotice && (
                  <div className="flex items-start gap-2.5 text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 p-3.5 rounded-lg border border-amber-500/20">
                    <Clock className="h-5 w-5 flex-shrink-0 mt-0.5" />
                    <span>{statusNotice}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-11 text-base font-medium"
                  disabled={
                    isLoading ||
                    (activeTab === "logist"
                      ? !email.trim() || !password.trim()
                      : !driverOrg.trim() || !driverPhone.trim())
                  }
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Проверка доступа...
                    </>
                  ) : activeTab === "logist" ? (
                    "Войти в диспетчерскую"
                  ) : (
                    "Войти в кабину водителя"
                  )}
                </Button>
              </form>
            </Tabs>

            {activeTab === "logist" && (
              <div className="mt-4 text-center">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Регистрация нового сотрудника
                </Link>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-border/50">
              <p className="text-xs text-muted-foreground text-center mb-2.5">
                Быстрый вход для проверки
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={fillDemo}
                type="button"
              >
                Подставить демо‑данные (
                {activeTab === "logist" ? "логист" : "водитель"})
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Loginex TMS • Безопасные серверные сессии • PBKDF2 шифрование
        </p>
      </div>
    </div>
  )
}
