"use client"

// components/visual/welcome-splash.tsx — приветствие после входа.
//
// Короткий (≈1.6 с) полноэкранный слой: грузовик проезжает по нарисованной
// линии маршрута, рядом — «Доброе утро, Иван», название компании и дата.
//
// Принципы, из-за которых это не раздражает:
// — показывается ОДИН раз на сессию браузера (sessionStorage-гейт): после
//   первого входа дальше человек работает без заставок;
// — layer НЕ перехватывает ввод (pointer-events: none) — приложением можно
//   пользоваться сразу, а закрыть заставку можно кликом или Esc в любой момент;
// — системная настройка «уменьшить движение» отключает её целиком:
//   сразу ставим флаг и ничего не рисуем;
// — фон берём существующий (LiveBackground), ничего нового не изобретаем.

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { PRODUCT_NAME } from "@/lib/auth/constants"
import { formatGreeting, formatHumanDate } from "@/lib/ui/greeting"

const STORAGE_KEY = "loginex:welcome-shown"
/** Сколько заставка живёт на экране, мс */
const SPLASH_MS = 1600
/** Где приветствие не нужно: контур водителя, печать и экраны входа. */
const EXCLUDED_PREFIXES = ["/m", "/print", "/login", "/register"]

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function alreadyShown(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    // приватный режим / заблокированное хранилище — показываем заставку
    return false
  }
}

function markShown(): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "1")
  } catch {
    // не критично: максимум увидят приветствие ещё раз
  }
}

export function WelcomeSplash() {
  const { user } = useAuth()
  const pathname = usePathname() || ""

  // Стартуем со «скрыто», решение принимаем в effect — иначе серверный рендер
  // и клиент не совпадут (гидратационная ошибка).
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const timers = useRef<number[]>([])

  const dismiss = useCallback(() => {
    setLeaving(true)
    markShown()
    const timer = window.setTimeout(() => setVisible(false), 260)
    timers.current.push(timer)
  }, [])

  const isAuthenticated = Boolean(user)
  const isExcludedPath = EXCLUDED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )

  useEffect(() => {
    // До входа заставку не показываем (и флаг не ставим): человек увидит её
    // ровно один раз — когда войдёт и попадёт на первую рабочую страницу.
    if (!isAuthenticated || isExcludedPath) return

    if (alreadyShown() || prefersReducedMotion()) {
      // Заставка уже была или человек просит меньше движения — флаг ставим,
      // чтобы больше не спрашивать, и ничего не рисуем.
      markShown()
      return
    }

    setVisible(true)

    const auto = window.setTimeout(dismiss, SPLASH_MS)
    timers.current.push(auto)

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss()
    }
    const onPointer = () => dismiss()

    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onPointer, { capture: true })

    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onPointer, { capture: true })
      timers.current.forEach((timer) => window.clearTimeout(timer))
      timers.current = []
    }
  }, [dismiss, isAuthenticated, isExcludedPath])

  if (!visible) return null

  const name = user?.name ?? null
  const organization = user?.organization?.name ?? null
  const now = new Date()

  return (
    <div
      className={`welcome-splash${leaving ? " welcome-splash--leaving" : ""}`}
      role="status"
      aria-live="polite"
      data-leaving={leaving ? "true" : "false"}
    >
      <div className="welcome-splash__card surface-glass">
        <svg
          className="welcome-splash__route"
          viewBox="0 0 320 96"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          {/* база */}
          <circle className="welcome-splash__pin" cx="26" cy="66" r="5" />
          <circle className="welcome-splash__pin welcome-splash__pin--soft" cx="26" cy="66" r="11" />
          {/* маршрут: рисуется штрихом */}
          <path
            className="welcome-splash__track"
            d="M26 66 C 96 66, 104 26, 160 30 S 236 66, 294 44"
          />
          {/* точка-грузовик едет по той же линии */}
          <g className="welcome-splash__truck">
            <animateMotion
              dur="1.5s"
              repeatCount="1"
              fill="freeze"
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="spline"
              keySplines="0.32 0 0.24 1"
              path="M26 66 C 96 66, 104 26, 160 30 S 236 66, 294 44"
            />
            <circle r="9" opacity="0.18" fill="oklch(0.72 0.17 45)" />
            <circle r="3.6" fill="oklch(0.78 0.16 45)" />
          </g>
          {/* клиент */}
          <rect
            className="welcome-splash__pin"
            x="288"
            y="38"
            width="12"
            height="12"
            rx="3"
            transform="rotate(45 294 44)"
          />
        </svg>

        <p className="welcome-splash__greeting">{formatGreeting(name, now)}</p>
        <p className="welcome-splash__subtitle">
          {PRODUCT_NAME}
          {organization ? ` · ${organization}` : ""}
        </p>
        <p className="welcome-splash__date">{formatHumanDate(now)}</p>

        <div className="welcome-splash__bar" aria-hidden="true">
          <span className="welcome-splash__bar-fill" />
        </div>
      </div>
    </div>
  )
}
