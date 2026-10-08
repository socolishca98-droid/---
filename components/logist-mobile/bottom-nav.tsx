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
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border surface-glass backdrop-blur"
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
              className={`press flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors duration-300 ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {/* Пилюля активного раздела — как подсветка пункта в боковом меню компьютера */}
              <span
                className={`flex h-7 w-14 items-center justify-center rounded-full transition-all duration-300 ${
                  active ? "scale-100 bg-primary/15" : "scale-90 bg-transparent"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.9} />
              </span>
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
