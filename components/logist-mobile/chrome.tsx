// components/logist-mobile/chrome.tsx
//
// Оболочка мобильной панели: нижнее меню и отступ под него.
//
// Обычно меню видно всегда, но на экране переписки оно мешает: внизу поле
// ввода, и «полоса» из меню съедала место и уводила ввод вверх (пункт 1.7).

"use client"

import { usePathname } from "next/navigation"

import { LogistBottomNav } from "./bottom-nav"

/** Экраны, где нижнее меню прячем (переписка с водителем) */
export function hidesBottomNav(pathname: string): boolean {
  return /^\/lm\/chat\/[^/]+$/.test(pathname)
}

export function LogistMobileChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/lm"
  const hideNav = hidesBottomNav(pathname)

  return (
    <div className="min-h-screen bg-[#0b0b0e] text-white">
      <div className="mx-auto max-w-md">
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
