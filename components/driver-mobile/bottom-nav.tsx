"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, ListChecks, Camera, User } from "lucide-react"

const ITEMS = [
  { href: "/m", label: "Главная", icon: Home },
  { href: "/m/orders", label: "Рейсы", icon: ListChecks },
  { href: "/m/photo", label: "Фото", icon: Camera },
  { href: "/m/profile", label: "Профиль", icon: User },
]

export function BottomNav() {
  const rawPathname = usePathname()
  const pathname = rawPathname ?? "/m"

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-50 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-3 mb-2 rounded-2xl bg-[#0a0a0c]/95 border border-gray-800/80 shadow-2xl backdrop-blur-xl">
        <div className="flex h-16 items-stretch">
          {ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/m" && pathname.startsWith(item.href))

            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex-1 flex items-center justify-center"
              >
                <div
                  className={`flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-xl transition-all ${
                    isActive
                      ? "text-orange-400"
                      : "text-gray-500 active:text-gray-300"
                  }`}
                >
                  <item.icon
                    className={`h-5 w-5 ${
                      isActive ? "text-orange-400" : "text-gray-500"
                    }`}
                  />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}