// components/logist-mobile/bottom-nav.tsx
//
// Нижняя навигация мобильной панели логиста: пять разделов, крупные зоны
// нажатия, учёт «безопасной зоны» iPhone (env(safe-area-inset-bottom)).

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Package, Route as RouteIcon, Map as MapIcon, Menu } from "lucide-react"

const TABS = [
  { href: "/lm", label: "Главная", icon: Home, exact: true },
  { href: "/lm/orders", label: "Заказы", icon: Package },
  { href: "/lm/routes", label: "Рейсы", icon: RouteIcon },
  { href: "/lm/map", label: "Карта", icon: MapIcon },
  { href: "/lm/more", label: "Ещё", icon: Menu },
]

export function LogistBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border surface-glass backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-md items-stretch justify-between px-1">
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.9} />
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

/**
 * Левое меню компьютерной версии.
 *
 * На мониторе нижняя полоса неудобна: она отбирает высоту у списков и требует
 * тянуться вниз. Здесь те же пять разделов, но постоянной колонкой слева —
 * рабочее место логиста за столом, а не в поле.
 */
export function LogistSideNav() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[234px] flex-col border-r border-border surface-glass backdrop-blur lg:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-[15px] font-bold text-primary">
          Л
        </span>
        <div>
          <p className="text-[14px] font-semibold leading-tight text-foreground">Логистика</p>
          <p className="text-[11.5px] leading-tight text-muted-foreground">панель логиста</p>
        </div>
      </div>

      <nav className="mt-1 space-y-0.5 px-2.5">
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors ${
                active
                  ? "bg-primary/12 text-primary"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.3 : 1.9} />
              {tab.label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto px-5 py-4">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Грузы ATI → маршрут → машина в пути
        </p>
      </div>
    </aside>
  )
}
