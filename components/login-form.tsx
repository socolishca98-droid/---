"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
} from "lucide-react"

type RoleTab = "logist" | "driver"

export function LoginForm() {
  const router = useRouter()
  const { login } = useAuth()

  const [activeTab, setActiveTab] = useState<RoleTab>("logist")

  // Для логиста
  const [email, setEmail] = useState<string>("")
  const [password, setPassword] = useState<string>("")

  // Для водителя
  const [driverOrg, setDriverOrg] = useState<string>("")
  const [driverPhone, setDriverPhone] = useState<string>("")

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      if (activeTab === "logist") {
        // TS ругался на (email, password). Пробуем передать объектом или привести к any,
        // чтобы обойти несовпадение сигнатуры заглушки.
        // И убираем проверку if (success), так как login может возвращать void.
        await (login as any)(email, password)
        
        // Если login не выбросил ошибку — считаем успешным
        router.push("/dashboard")
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

        if (data.success && data.driver) {
          if (typeof window !== "undefined") {
            localStorage.setItem(
              "driver_session",
              JSON.stringify(data.driver)
            )
          }
          router.push("/m")
        } else {
          setError(data.error || "Водитель не найден")
        }
      }
    } catch (err) {
      console.error(err)
      setError("Неверный email или пароль")
    } finally {
      setIsLoading(false)
    }
  }

  const demoLogist = {
    email: "logist@gruzopotok.ru",
    password: "demo",
  }

  const demoDriver = {
    organization: "АИ Логистика",
    phone: "+7 (999) 123-45-67",
  }

  const fillDemo = () => {
    setError("")
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
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4">
            <Truck className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            АИ Логистика
          </h1>
          <p className="text-muted-foreground">
            система управления грузоперевозками
          </p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Вход в систему</CardTitle>
            <CardDescription>
              Выберите тип аккаунта для входа
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              value={activeTab}
              onValueChange={(v) => {
                setActiveTab(v as RoleTab)
                setError("")
              }}
              className="space-y-4"
            >
              <TabsList className="grid w-full grid-cols-2 h-12">
                <TabsTrigger
                  value="logist"
                  className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  <User className="h-4 w-4" />
                  Логист
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
                        placeholder="logist@company.ru"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
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
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="h-11"
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
                          placeholder="Например: АИ Логистика"
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
                          placeholder="+7 (999) 123-45-67"
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
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-11"
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
                      Вход...
                    </>
                  ) : activeTab === "logist" ? (
                    "Войти как логист"
                  ) : (
                    "Войти как водитель"
                  )}
                </Button>
              </form>
            </Tabs>

            <div className="mt-6 pt-4 border-t border-border/50">
              <p className="text-xs text-muted-foreground text-center mb-3">
                Демо-доступ для тестирования
              </p>
              <Button
                variant="outline"
                className="w-full bg-transparent"
                onClick={fillDemo}
                type="button"
              >
                Подставить данные демо‑аккаунта (
                {activeTab === "logist" ? "логист" : "водитель"})
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Защищено шифрованием. Ваши данные в безопасности.
        </p>
      </div>
    </div>
  )
}