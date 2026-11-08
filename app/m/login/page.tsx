// app/m/login/page.tsx
//
// Вход водителя: телефон + пароль. Сервер проверяет пароль и выдаёт подписанный
// httpOnly-cookie (POST /api/m/login). Никаких «организация на глаз» и никакого
// driverId в localStorage — сессию хранит сервер.
//
// Оформление (просьба владельца): «сливай анимации, экраны и поля — дорога
// зарыта панелью, прозрачностью это не решить». Поэтому здесь НЕТ панели
// поверх сцены и нет стекла с blur: экран — это кабина грузовика.
//
//   • ЛОБОВОЕ СТЕКЛО (верх экрана) — живая сцена «ночная дорога»: та же
//     канвас-анимация, что у логиста, с указателями-модулями ВОДИТЕЛЯ
//     («Мои рейсы», «Маршрут», «Документы»…). Палец по стеклу поворачивает
//     камеру — дорогу можно осмотреть.
//   • КАПОТ — тёмный клин между стеклом и панелью: разметка МЧИТСЯ и
//     прячется под капот, сцена и «машина» сшиты в одну перспективу.
//   • ПРИБОРНАЯ ПАНЕЛЬ (низ) — НЕ стекло: глухой материал с заклёпками,
//     поля — приборные слоты с янтарной подсветкой, кнопка «В путь» —
//     запуск двигателя. Где вводить и куда жать — видно сразу.
//
// Логика контракта не тронута: useDriverSession({requireAuth:false}),
// login(phone, password) → {ok, error?, mustChangePassword?},
// mustChangePassword → /m/profile?changePassword=1, иначе /m.

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Truck, Phone, Loader2, Lock, Power, AlertCircle } from "lucide-react"
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
    <div className="relative min-h-dvh overflow-hidden bg-[#07090f] text-white">
      {/* Лобовое стекло: живая ночь за ним */}
      <LoginScene variant="driver" />

      {/* Кабина: капот + приборная панель. Контейнер прозрачен для касаний
          (палец достаётся лобовому стеклу), панель возвращает себе события */}
      <div className="pointer-events-none relative z-10 flex min-h-dvh flex-col justify-end">
        <div data-login-console className="console-rise pointer-events-auto relative">
          {/* Капот: разметка мчится и прячется под него — сцена и кабина
              сшиты одной перспективой */}
          <div
            aria-hidden="true"
            className="relative mx-auto h-[52px] w-[64%] bg-gradient-to-b from-[#141a2c] to-[#0b0e15] [clip-path:polygon(34%_0,66%_0,100%_100%,0_100%)]"
          >
            {/* «полоса» форточки — тонкая янтарная кромка стыка со стеклом */}
            <div className="absolute left-1/2 top-0 h-px w-[32%] -translate-x-1/2 bg-orange-400/50" />
          </div>

          {/* Приборная панель: глухой материал, НЕ стекло */}
          <div className="relative border-t border-white/[0.07] bg-[#0b0e15] px-5 pb-5 pt-4">
            {/* блик панели от горизонта + текстура «шлифованного пластика» */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#151b30]/50 via-transparent to-black/50"
            />
            {/* заклёпки по углам — панель физическая */}
            <span aria-hidden="true" className="absolute left-3 top-3 h-1.5 w-1.5 rounded-full bg-[#232c44] shadow-[inset_0_1px_1px_rgba(0,0,0,0.9)]" />
            <span aria-hidden="true" className="absolute right-3 top-3 h-1.5 w-1.5 rounded-full bg-[#232c44] shadow-[inset_0_1px_1px_rgba(0,0,0,0.9)]" />
            <span aria-hidden="true" className="absolute bottom-3 left-3 h-1.5 w-1.5 rounded-full bg-[#232c44] shadow-[inset_0_1px_1px_rgba(0,0,0,0.9)]" />
            <span aria-hidden="true" className="absolute bottom-3 right-3 h-1.5 w-1.5 rounded-full bg-[#232c44] shadow-[inset_0_1px_1px_rgba(0,0,0,0.9)]" />

            {/* шильдик на панели */}
            <div className="relative mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-orange-400/30 bg-orange-500/15">
                <Truck className="h-5 w-5 text-orange-400" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold leading-tight">{PRODUCT_NAME}</p>
                <p className="truncate text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  кабина водителя
                </p>
              </div>
              {/* «прибор»-вольтметр справа от шильдика */}
              <span aria-hidden="true" className="flex h-9 items-center gap-1 rounded-lg border border-white/[0.07] bg-black/40 px-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.9)]" />
                <span className="font-mono text-[10px] tracking-widest text-orange-300/80">24V</span>
              </span>
            </div>

            <form onSubmit={handleLogin} className="relative w-full space-y-3">
              {/* Приборный слот: ТЕЛЕФОН */}
              <div className="group">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-orange-400 opacity-40 shadow-[0_0_6px_rgba(251,146,60,0.9)] transition-opacity group-focus-within:opacity-100" />
                  <label
                    htmlFor="driver-phone"
                    className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 transition-colors group-focus-within:text-orange-300"
                  >
                    Телефон
                  </label>
                </div>
                <div className="relative rounded-xl border border-white/10 bg-black/50 shadow-[inset_0_2px_10px_rgba(0,0,0,0.55)] transition-colors focus-within:border-orange-400/60">
                  <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-600 transition-colors group-focus-within:text-orange-400" />
                  <input
                    id="driver-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="username"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+7 (999) 123-45-67"
                    className="w-full bg-transparent py-[15px] pl-12 pr-4 text-[16px] text-white placeholder-slate-600 caret-orange-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Приборный слот: ПАРОЛЬ */}
              <div className="group">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-orange-400 opacity-40 shadow-[0_0_6px_rgba(251,146,60,0.9)] transition-opacity group-focus-within:opacity-100" />
                  <label
                    htmlFor="driver-password"
                    className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 transition-colors group-focus-within:text-orange-300"
                  >
                    Пароль
                  </label>
                </div>
                <div className="relative rounded-xl border border-white/10 bg-black/50 shadow-[inset_0_2px_10px_rgba(0,0,0,0.55)] transition-colors focus-within:border-orange-400/60">
                  <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-600 transition-colors group-focus-within:text-orange-400" />
                  <input
                    id="driver-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="выдал логист"
                    className="w-full bg-transparent py-[15px] pl-12 pr-4 text-[16px] text-white placeholder-slate-600 caret-orange-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Лампа-предупреждение */}
              {error && (
                <div
                  role="alert"
                  className="login-shake flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-400"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Запуск двигателя */}
              <button
                type="submit"
                disabled={isLoading || !canSubmit}
                className="driver-ignite flex w-full items-center justify-center gap-2.5 rounded-xl border border-orange-300/40 bg-gradient-to-b from-orange-400 to-orange-600 py-4 text-[16px] font-extrabold uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_30px_-6px_rgba(251,146,60,0.55)] transition active:scale-[0.985] disabled:border-white/[0.06] disabled:from-slate-700 disabled:to-slate-800 disabled:text-slate-500 disabled:shadow-none"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Power className="h-5 w-5" />
                    В путь
                  </>
                )}
              </button>
            </form>

            <Link
              href="/login"
              className="relative mt-3.5 block text-center text-[13px] text-slate-400 transition-colors hover:text-orange-400"
            >
              Вход для логиста
            </Link>

            <p className="relative mt-2.5 border-t border-white/[0.07] pt-2.5 text-center text-[10.5px] leading-relaxed text-slate-600">
              Телефон и пароль выдаёт логист. Забыли — логист сбросит в разделе
              «Сотрудники и доступ»
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
