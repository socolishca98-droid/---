// app/m/login/page.tsx
//
// Вход водителя: телефон + пароль. Сервер проверяет пароль и выдаёт подписанный
// httpOnly-cookie (POST /api/m/login). Никаких «организация на глаз» и никакого
// driverId в localStorage — сессию хранит сервер.
//
// Оформление (переписано с нуля по просьбе владельца): та же «ночная дорога»,
// что и на входе логиста, но СТАТИЧНАЯ — постер SVG с лёгкой анимацией
// разметки, без канваса и постоянного рендера (водительская зона экономит
// батарею и трафик). Кабина: дорога в «лобовом стекле», консоль с крупными
// полями — под большим пальцем.

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
    <div className="relative min-h-dvh overflow-hidden bg-[#07090f] text-white">
      {/* Ночная дорога — статичный постер: горизонт с заревом, разметка
          «идёт» под колёсами (единственная анимация — дёшево для GPU) */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 390 844"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="dsky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#04060d" />
            <stop offset="0.52" stopColor="#0a1122" />
            <stop offset="1" stopColor="#16203a" />
          </linearGradient>
          <radialGradient id="dglow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="rgba(251,146,60,0.2)" />
            <stop offset="1" stopColor="rgba(251,146,60,0)" />
          </radialGradient>
          <radialGradient id="dcool" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="rgba(56,130,246,0.14)" />
            <stop offset="1" stopColor="rgba(56,130,246,0)" />
          </radialGradient>
        </defs>
        <rect width="390" height="844" fill="url(#dsky)" />
        {/* звёзды */}
        {[
          [40, 60], [110, 34], [180, 78], [255, 48], [322, 90], [70, 130],
          [150, 155], [235, 128], [305, 170], [36, 210], [120, 235], [210, 205],
          [290, 242], [350, 285], [60, 300], [160, 290], [250, 320], [330, 350],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={i % 3 === 0 ? 1.4 : 0.9} fill="#e2e8f0" opacity={0.25 + (i % 4) * 0.14} />
        ))}
        {/* зарево города на горизонте */}
        <ellipse cx="195" cy="360" rx="250" ry="95" fill="url(#dcool)" />
        <ellipse cx="195" cy="362" rx="150" ry="60" fill="url(#dglow)" />
        {/* огни города по сторонам */}
        {[
          [52, 356], [88, 362], [130, 358], [268, 360], [308, 356], [340, 364],
        ].map(([cx, cy], i) => (
          <circle key={`l${i}`} cx={cx} cy={cy} r={1.6} fill={i % 2 ? "#fbbf24" : "#7dd3fc"} opacity="0.8" />
        ))}
        {/* дорога */}
        <path d="M170 366 L220 366 L312 844 L78 844 Z" fill="#0b1220" />
        {/* обочины */}
        <path d="M168 366 L171 366 L92 844 L62 844 Z" fill="#1b2540" opacity="0.75" />
        <path d="M219 366 L222 366 L298 844 L328 844 Z" fill="#1b2540" opacity="0.75" />
        {/* кромки */}
        <path d="M171 366 L96 844" stroke="#94a3b8" strokeWidth="2.5" opacity="0.35" fill="none" />
        <path d="M219 366 L294 844" stroke="#94a3b8" strokeWidth="2.5" opacity="0.35" fill="none" />
        {/* разметка — бежит под колёсами */}
        <line
          className="driver-roadline"
          x1="195"
          y1="372"
          x2="195"
          y2="844"
          stroke="#e2e8f0"
          strokeWidth="4"
          strokeDasharray="16 26"
          opacity="0.45"
        />
        {/* столбики с огоньками */}
        {[
          [150, 470], [138, 590], [122, 730],
          [240, 470], [252, 590], [268, 730],
        ].map(([cx, cy], i) => (
          <g key={`p${i}`}>
            <line x1={cx} y1={cy} x2={cx - (i % 2 ? 3 : -3)} y2={cy - 26} stroke="#38bdf8" strokeWidth="1.5" opacity="0.5" />
            <circle cx={cx - (i % 2 ? 3 : -3)} cy={cy - 26} r="2.4" fill="#7dd3fc" opacity="0.9" />
          </g>
        ))}
      </svg>

      {/* Кабина: консоль снизу — как у входа логиста */}
      <div className="relative z-10 flex min-h-dvh flex-col justify-end">
        <div className="console-rise rounded-t-[1.75rem] border-x border-t border-white/10 bg-[#0d1017]/85 px-5 pb-6 pt-5 backdrop-blur-lg">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-500/20">
              <Truck className="h-6 w-6 text-orange-400" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold leading-tight">{PRODUCT_NAME}</p>
              <p className="truncate text-[11px] text-gray-400">приложение водителя</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="w-full space-y-3.5">
            <div>
              <label htmlFor="driver-phone" className="mb-1.5 block text-[13px] text-gray-400">
                Номер телефона
              </label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
                <input
                  id="driver-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="username"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+7 (999) 123-45-67"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-4 pl-12 pr-4 text-[16px] text-white placeholder-gray-500 transition-colors focus:border-orange-400 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="driver-password" className="mb-1.5 block text-[13px] text-gray-400">
                Пароль
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
                <input
                  id="driver-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Пароль выдал логист"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-4 pl-12 pr-4 text-[16px] text-white placeholder-gray-500 transition-colors focus:border-orange-400 focus:outline-none"
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="login-shake flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/20 p-3 text-sm text-red-400"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !canSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-4 text-[16px] font-bold text-white transition-all hover:bg-orange-600 disabled:bg-gray-700 disabled:text-gray-500"
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
            className="mt-4 block text-center text-[13px] text-gray-400 transition-colors hover:text-orange-400"
          >
            Вход для логиста
          </Link>

          <p className="mt-3 border-t border-white/10 pt-3 text-center text-[11px] leading-relaxed text-gray-500">
            Телефон и пароль выдаёт логист. Если пароль забыт — логист сбросит его
            в разделе «Сотрудники и доступ»
          </p>
        </div>
      </div>
    </div>
  )
}
