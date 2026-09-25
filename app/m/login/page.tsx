// app/m/login/page.tsx
// Вход водителя: телефон + пароль. Сервер проверяет пароль и выдаёт подписанный
// httpOnly-cookie (POST /api/m/login). Никаких «организация на глаз» и никакого
// driverId в localStorage — сессию хранит сервер.

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Truck, Phone, Loader2, ArrowRight, Lock, AlertCircle } from "lucide-react"
import { useDriverSession } from "@/hooks/use-driver-session"
import { PRODUCT_NAME } from "@/lib/auth/constants"

export default function DriverLoginPage() {
  const router = useRouter()
  const { login, isAuthenticated } = useDriverSession({ requireAuth: false })

  const [phone, setPhone] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  // Сессия уже есть — незачем показывать форму
  useEffect(() => {
    if (isAuthenticated) router.replace("/m")
  }, [isAuthenticated, router])

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!phone.trim() || !password) {
      setError("Укажите телефон и пароль")
      return
    }

    setIsLoading(true)
    setError("")

    const result = await login(phone.trim(), password)
    setIsLoading(false)

    if (!result.ok) {
      setError(result.error || "Не удалось войти")
      return
    }

    // Пароль выдан логистом и требует замены — сначала профиль
    if (result.mustChangePassword) {
      router.push("/m/profile?changePassword=1")
      return
    }

    router.push("/m")
  }

  const canSubmit = phone.trim().length > 0 && password.length > 0

  return (
    <div className="min-h-screen bg-[#09090b] text-white flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        {/* Logo */}
        <div className="w-20 h-20 rounded-2xl bg-orange-500/20 flex items-center justify-center mb-6">
          <Truck className="h-10 w-10 text-orange-500" />
        </div>

        <h1 className="text-2xl font-bold mb-2">{PRODUCT_NAME}</h1>
        <p className="text-gray-400 mb-8">Приложение водителя</p>

        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
          <div>
            <label htmlFor="driver-phone" className="block text-sm text-gray-400 mb-2">
              Номер телефона
            </label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
              <input
                id="driver-phone"
                type="tel"
                inputMode="tel"
                autoComplete="username"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+7 (999) 123-45-67"
                className="w-full pl-12 pr-4 py-4 bg-[#1a1a1f] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label htmlFor="driver-password" className="block text-sm text-gray-400 mb-2">
              Пароль
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
              <input
                id="driver-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Пароль выдал логист"
                className="w-full pl-12 pr-4 py-4 bg-[#1a1a1f] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !canSubmit}
            className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                Войти
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </button>
        </form>

        <Link
          href="/login"
          className="mt-6 text-sm text-gray-400 hover:text-orange-400 transition-colors"
        >
          Вход для логиста
        </Link>
      </div>

      <div className="p-6 text-center text-xs text-gray-600">
        Телефон и пароль выдаёт логист. Если пароль забыт — логист сбросит его
        в разделе «Сотрудники и доступ»
      </div>
    </div>
  )
}
