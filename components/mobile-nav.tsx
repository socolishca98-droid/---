// components/mobile-nav.tsx
//
// Выдвижное меню для телефона. На узком экране боковая панель занимала четверть
// ширины и контент обрезался — теперь она срыта, а разделы открываются по кнопке.

"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LogOut, Settings, Smartphone, Truck, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { navItemsForRole } from "@/lib/navigation"
import { Button } from "@/components/ui/button"
import { PRODUCT_NAME } from "@/lib/auth/constants"

export function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()

  // Пока меню открыто, страница под ним не должна прокручиваться
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  // Перешли в другой раздел — меню закрываем
  useEffect(() => {
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const handleLogout = async () => {
    await logout()
    onClose()
    router.replace("/login")
    router.refresh()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] lg:hidden">
      <button
        type="button"
        aria-label="Закрыть меню"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <aside className="absolute left-0 top-0 flex h-full w-[85%] max-w-sm flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Truck className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold">{PRODUCT_NAME}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto overscroll-contain p-3">
          {user?.role === "logist" ? (
            <Link
              href="/lm"
              onClick={onClose}
              className="mb-2 flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary"
            >
              <Smartphone className="h-5 w-5 shrink-0" />
              Мобильная панель
            </Link>
          ) : null}

          {navItemsForRole(user?.role).map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/80 active:bg-sidebar-accent/70",
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="flex-1">{item.name}</span>
              </Link>
            )
          })}

          <Link
            href="/settings"
            onClick={onClose}
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium text-sidebar-foreground/80 active:bg-sidebar-accent/70"
          >
            <Settings className="h-5 w-5 shrink-0" />
            Настройки
          </Link>
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-3">
          {user ? (
            <div className="mb-2 px-2">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email || "—"}</p>
            </div>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => void handleLogout()}
            className="w-full justify-start text-sidebar-foreground/80 hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-5 w-5" />
            <span className="ml-3">Выйти</span>
          </Button>
        </div>
      </aside>
    </div>
  )
}
