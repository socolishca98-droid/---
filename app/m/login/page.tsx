// app/m/login/page.tsx
//
// Вход водителя: телефон + пароль. Сервер проверяет пароль и выдаёт подписанный
// httpOnly-cookie (POST /api/m/login). Никаких «организация на глаз» и никакого
// driverId в localStorage — сессию хранит сервер.
//
// Оформление v5 «Доброй дороги»: никаких панелей, карточек и «приборок» —
// живая сцена занимает ВЕСЬ экран, форма лежит прямо на ней:
//
//   • сверху — крупный заголовок над горизонтом (небо, звёзды);
//   • в середине — чистая дорога с точкой схода: ничего не перекрывает;
//   • снизу — мягкое затемнение-градиент (НЕ стекло, НЕ blur), на нём
//     поля и кнопка «В путь». Дорога просвечивает до самого низа.
//
// Палец по верхней половине поворачивает камеру. Успешный вход —
// ночной «ворп» и переход в приложение.
//
// Логика контракта не тронута: useDriverSession({requireAuth:false}),
// login(phone, password) → {ok, error?, mustChangePassword?},
// mustChangePassword → /m/profile?changePassword=1, иначе /m.

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Truck, Phone, Loader2, ArrowRight, Lock, AlertCircle } from "lucide-react"
import { LoginScene } from "@/components/visual/login-scene"
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

    // Успешный вход — «ночь прыгает навстречу»: ворп сцены и только потом
    // редирект (как у входа логиста)
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
    <div className="relative min-h-dvh overflow-hidden bg-[#05070e] text-white">
      {/* Вся страница — живая дорога */}
      <LoginScene variant="driver" />

      {/* Затемнение к низу: горизонт и дорога видны, текст формы читается.
          Никакого blur — дорога остаётся резкой до самого низа. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[6] h-[62%] bg-gradient-to-b from-transparent via-[#05070e]/40 to-[#05070e]/95"
      />

      <div className="relative z-10 flex min-h-dvh flex-col justify-between">
        {/* Шапка — над горизонтом, в небе */}
        <header className="driver-head pointer-events-none px-6 pt-9">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500/15 ring-1 ring-orange-400/30">
              <Truck className="h-[18px] w-[18px] text-orange-400" />
            </span>
            <span className="text-[13px] font-semibold tracking-wide text-slate-300">
              {PRODUCT_NAME}
            </span>
          </div>
          <h1 className="mt-6 text-[34px] font-extrabold leading-[1.04] tracking-tight text-white">
            Доброй
            <br />
            дороги
          </h1>
          <p className="mt-3 max-w-[280px] text-[13px] leading-relaxed text-slate-400">
            Рейсы, маршрут и документы — с вами в дороге, без звонков диспетчеру.
          </p>
        </header>

        {/* Форма — прямо на сцене, без карточки и без панели */}
        <div data-login-console className="console-rise pointer-events-auto mx-auto w-full max-w-sm px-6 pb-7">
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
        </div>
      </div>
    </div>
  )
}
