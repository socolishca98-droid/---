// components/logist-mobile/bottom-nav.tsx
//
// Нижняя навигация мобильной панели логиста: пять разделов, крупные зоны
// нажатия, учёт «безопасной зоны» iPhone (env(safe-area-inset-bottom)).

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Package, Route as RouteIcon, Users, Menu } from "lucide-react"

const TABS = [
  { href: "/lm", label: "Главная", icon: Home, exact: true },
  { href: "/lm/orders", label: "Заказы", icon: Package },
  { href: "/lm/routes", label: "Рейсы", icon: RouteIcon },
  { href: "/lm/drivers", label: "Водители", icon: Users },
  { href: "/lm/more", label: "Ещё", icon: Menu },
]

export function LogistBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/8 bg-[#0b0b0e]/95 backdrop-blur"
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
                active ? "text-orange-400" : "text-zinc-500"
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
