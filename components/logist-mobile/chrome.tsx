// components/logist-mobile/chrome.tsx
//
// Оболочка мобильной панели: фон рабочего места, нижнее меню и отступ под него.
//
// Фон — тот же «живой холст», что и в компьютерной версии (компонент
// LiveBackground), только в статичной версии: градиент и сетка склада без
// анимаций, световых пятен и треков. Вид один и тот же, а батарею и трафик
// телефона это не расходует — в движении ничего не пересчитывается.
//
// Обычно меню видно всегда, но на экране переписки оно мешает: внизу поле
// ввода, и «полоса» из меню съедала место и уводила ввод вверх (пункт 1.7).

"use client"

import { usePathname } from "next/navigation"

import { AccountSwitchBanner } from "@/components/account-switch-banner"
import { LogistBottomNav } from "./bottom-nav"

/** Экраны, где нижнее меню прячем (переписка с водителем) */
export function hidesBottomNav(pathname: string): boolean {
  return /^\/lm\/chat\/[^/]+$/.test(pathname)
}

export function LogistMobileChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/lm"
  const hideNav = hidesBottomNav(pathname)

  return (
    <div className="min-h-screen text-foreground">
      {/* Статичный фон компьютерной версии: градиент + сетка, без анимаций */}
      <div className="theme-canvas" aria-hidden>
        <div className="theme-canvas__grid" />
      </div>

      <div className="mx-auto max-w-md">
        {/* Полоса «Вы вошли как …» — только у владельца, когда он смотрит чужой аккаунт */}
        <AccountSwitchBanner className="sticky top-0 z-40" />
        <div
          className={
            hideNav
              ? "pb-[env(safe-area-inset-bottom)]"
              : "pb-[calc(72px+env(safe-area-inset-bottom))]"
          }
        >
          {children}
        </div>
      </div>

      {hideNav ? null : <LogistBottomNav />}
    </div>
  )
}
