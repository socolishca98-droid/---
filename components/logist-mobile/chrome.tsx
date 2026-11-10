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
import { LogistBottomNav, LogistSideNav } from "./bottom-nav"

/**
 * Экраны, которым на компьютере нужна вся ширина.
 *
 * Помощник сборки — не список карточек, а рабочее место: слева итог и плечи,
 * справа остаток биржи и объяснение. В колонку телефона (448 px) это
 * складывается в лестницу из девяти блоков, и на мониторe выглядит как
 * мобильный скриншот, растянутый по центру. Поэтому у него своя ширина.
 */
const WIDE_SCREENS = /^\/lm\/routes\/assistant/

/**
 * Экраны с двумя колонками на компьютере: лента + боковая колонка.
 *
 * Дежурному нужны 340 px справа под состояние и машины, а ленте — место на две
 * карточки в ряд. В 4xl (896 px) минус боковое меню 250 px на ленту остаётся
 * 280 px, и карточки грузов становятся уже телефона. Поэтому у дежурного своя
 * ширина: 1400 − 250 (меню) − 24 = ~1130 px → лента ~790 px на две колонки.
 */
const TWO_COLUMN_SCREENS = /^\/lm\/duty/

/** Ширина сцены: узкая «читаемая» для списков, полная — для рабочих экранов. */
export function panelWidth(pathname: string): string {
  if (WIDE_SCREENS.test(pathname)) return "lg:max-w-[1500px]"
  if (TWO_COLUMN_SCREENS.test(pathname)) return "lg:max-w-[1400px]"
  return "lg:max-w-4xl"
}

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
      <div className="theme-canvas lm-canvas-night" aria-hidden>
        <div className="theme-canvas__grid" />
      </div>

      {/* На компьютере меню переезжает влево: нижняя полоса на мониторе —
          мобильная привычка, а слева освобождается постоянное место. */}
      <LogistSideNav />

      <div className={`mx-auto max-w-md ${panelWidth(pathname)} lg:pl-[250px] lg:pr-6`}>
        {/* Полоса «Вы вошли как …» — только у владельца, когда он смотрит чужой аккаунт */}
        <AccountSwitchBanner className="sticky top-0 z-40" />
        {/* и23: main — чтобы пауза прилёта (html[data-arriving] main)
            действовала и здесь: после «ночного тоннеля» карточки
            панели встают по очереди ПОСЛЕ ухода тон-подложки */}
        <main
          className={
            hideNav
              ? "lm-deep pb-[env(safe-area-inset-bottom)]"
              : "lm-deep pb-[calc(72px+env(safe-area-inset-bottom))] lg:pb-10"
          }
        >
          {children}
        </main>
      </div>

      {hideNav ? null : <LogistBottomNav />}
    </div>
  )
}
