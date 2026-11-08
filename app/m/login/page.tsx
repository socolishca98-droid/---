// app/m/login/page.tsx
//
// Вход водителя: телефон + пароль. Сервер проверяет пароль и выдаёт подписанный
// httpOnly-cookie (POST /api/m/login). Никаких «организации на глаз» и никакого
// driverId в localStorage — сессию хранит сервер.
//
// Оформление: тот же 3D-мир «Ночной рейс», что и у входа логиста (просьба
// владельца: «всё интегрировано в 3D, больше объёма, перемещаемся в
// пространстве»). Камера едет сквозь ночь по дороге водителя — ворота с его
// разделами («Мои рейсы», «Маршрут», «Документы»…) пролетают мимо, ракурс —
// пальцем или ГИРОСКОПОМ (наклоняй телефон). Форма — объект мира: парящая
// плита на ближайшей глубине, дорога течёт позади неё.
//
// Логика контракта не тронута: useDriverSession({requireAuth:false}),
// login(phone, password) → {ok, error?, mustChangePassword?},
// mustChangePassword → /m/profile?changePassword=1, иначе /m.

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Phone, Loader2, ArrowRight, Lock, AlertCircle, Truck } from "lucide-react"
import { LoginWorld } from "@/components/visual/login-world"
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

    // Успешный вход — рывок сквозь мир и только потом редирект
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    window.dispatchEvent(new CustomEvent("login:warp"))
    if (!reduced) await new Promise((resolve) => setTimeout(resolve, 720))

    // Пароль выдан логистом и требует замены — сначала профиль
    if (result.mustChangePassword) {
      router.push("/m/profile?changePassword=1")
      return
    }

    router.push("/m")
  }

  const canSubmit = phone.trim().length > 0 && password.length > 0

  return (
    <div className="relative min-h-dvh">
      <LoginWorld
        variant="driver"
        headline={
          <div>
            <p className="flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-white/45 lg:justify-start">
              <Truck className="h-4 w-4 text-orange-400" />
              {PRODUCT_NAME} · водитель
            </p>
            <h2 className="mt-3 text-[30px] font-extrabold leading-[1.06] tracking-tight text-white sm:text-[40px]">
              Доброй
              <br />
              дороги
            </h2>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-400 sm:text-sm">
              Рейсы, маршрут и документы — с вами в дороге, без звонков
              диспетчеру.
            </p>
          </div>
        }
      >
        <form onSubmit={handleLogin} className="w-full space-y-3">
          <div>
            <label htmlFor="driver-phone" className="mb-1.5 block text-[13px] text-slate-400">
              Телефон
            </label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <input
                id="driver-phone"
                type="tel"
                inputMode="tel"
                autoComplete="username"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+7 (999) 123-45-67"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.06] py-4 pl-12 pr-4 text-[16px] text-white placeholder-slate-600 caret-orange-400 transition-colors focus:border-orange-400/70 focus:bg-white/[0.09] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="driver-password" className="mb-1.5 block text-[13px] text-slate-400">
              Пароль
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
              <input
                id="driver-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="выдал логист"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.06] py-4 pl-12 pr-4 text-[16px] text-white placeholder-slate-600 caret-orange-400 transition-colors focus:border-orange-400/70 focus:bg-white/[0.09] focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="login-shake flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-[13px] text-red-400"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !canSubmit}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-400 py-4 text-[16px] font-bold text-white shadow-[0_12px_40px_-10px_rgba(251,146,60,0.65)] transition active:scale-[0.98] active:brightness-95 disabled:from-slate-700 disabled:to-slate-800 disabled:text-slate-500 disabled:shadow-none"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                В путь
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </button>
        </form>

        <Link
          href="/login"
          className="mt-3.5 block text-center text-[13px] text-slate-400 transition-colors hover:text-orange-400"
        >
          Вход для логиста
        </Link>

        <p className="mt-2.5 text-center text-[11px] leading-relaxed text-slate-500">
          Телефон и пароль выдаёт логист. Забыли — он сбросит их в разделе
          «Сотрудники и доступ»
        </p>
      </LoginWorld>
    </div>
  )
}
