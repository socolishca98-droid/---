"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import {
  LayoutDashboard,
  Package,
  RouteIcon,
  Camera,
  Contact,
  FileBarChart,
  Truck,
  Settings,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Warehouse,
  LogOut,
  CreditCard,
  Users,
  Building2,
  Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

/** Какие счётчики может показывать пункт меню. */
type BadgeKey = "orders" | "chat"

const navigation: Array<{ name: string; href: string; icon: any; badgeKey?: BadgeKey }> = [
  { name: "Дашборд", href: "/dashboard", icon: LayoutDashboard },
  // бейджи — настоящие числа организации (/api/sidebar-counts), а не зашитые значения
  { name: "Заказы", href: "/orders", icon: Package, badgeKey: "orders" },
  // поиск грузов — по требованию, отдельной страницей (не постоянная вкладка)
  { name: "Поиск грузов", href: "/search", icon: Search },
  { name: "Маршруты", href: "/routes", icon: RouteIcon },
  { name: "Автопарк", href: "/fleet", icon: Warehouse },
  { name: "Клиенты", href: "/clients", icon: Contact },
  { name: "Фото", href: "/photos", icon: Camera },
  { name: "Чат", href: "/chat", icon: MessageSquare, badgeKey: "chat" },
  { name: "Оплаты", href: "/payments", icon: CreditCard },
  { name: "Отчёты", href: "/reports", icon: FileBarChart },
  { name: "Сотрудники", href: "/users", icon: Users },
  { name: "Организация", href: "/organization", icon: Building2 },
]

const EMPTY_COUNTS: Record<BadgeKey, number> = { orders: 0, chat: 0 }

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const { isCollapsed, toggle } = useSidebar()
  const [counts, setCounts] = useState<Record<BadgeKey, number>>(EMPTY_COUNTS)

  // Счётчики обновляются при переходе между разделами, раз в минуту и когда
  // вкладка снова становится видимой. Ошибка не ломает меню — бейджи просто
  // не показываются.
  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const response = await fetch("/api/sidebar-counts", { credentials: "include" })
        if (!response.ok) return
        const data = await response.json()
        if (!active) return
        setCounts({
          orders: Number(data?.orders) || 0,
          chat: Number(data?.chat) || 0,
        })
      } catch {
        /* счётчики — не критично */
      }
    }

    load()
    const interval = window.setInterval(load, 60_000)
    const onVisible = () => {
      if (!document.hidden) load()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [pathname])

  const handleLogout = async () => {
    // Серверный выход: сессия отзывается в БД, httpOnly-cookie удаляется
    await logout()
    router.replace("/login")
    router.refresh()
  }

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-sidebar/92 backdrop-blur-xl border-r border-sidebar-border transition-[width] duration-300 ease-out",
        isCollapsed ? "w-20" : "w-64",
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          {!isCollapsed && (
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Truck className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-lg font-bold text-sidebar-foreground">
                ГрузоПоток
              </span>
            </Link>
          )}
          {isCollapsed && (
            <Link href="/dashboard" className="mx-auto">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Truck className="h-5 w-5 text-primary-foreground" />
              </div>
            </Link>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3">
          {navigation.map((item) => {
            const isActive = pathname === item.href
            const badgeValue = item.badgeKey ? counts[item.badgeKey] : 0
            const badgeLabel = badgeValue > 99 ? "99+" : String(badgeValue)
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium group",
                  "transition-[background-color,color,transform] duration-200 ease-out",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground hover:translate-x-0.5",
                )}
                title={isCollapsed ? item.name : undefined}
              >
                {/* Активный раздел помечен полосой: видно боковым зрением */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_12px_var(--primary)]" />
                )}
                <item.icon className="h-5 w-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-105" />
                {!isCollapsed && (
                  <>
                    <span className="flex-1">{item.name}</span>
                    {badgeValue > 0 && (
                      <Badge
                        variant="default"
                        className="h-5 min-w-5 px-1.5 text-xs bg-primary text-primary-foreground"
                      >
                        {badgeLabel}
                      </Badge>
                    )}
                  </>
                )}
                {/* Бейдж в свёрнутом режиме */}
                {isCollapsed && badgeValue > 0 && (
                  <Badge
                    variant="default"
                    className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] bg-primary text-primary-foreground"
                  >
                    {badgeLabel}
                  </Badge>
                )}

                {/* Тултип при наведении в свёрнутом режиме */}
                {isCollapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-sm rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50 border">
                    {item.name}
                  </div>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Bottom Section */}
        <div className="border-t border-sidebar-border p-3 space-y-1">
          {/* User info */}
          {!isCollapsed && user && (
            <div className="px-3 py-2 mb-2">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {user.name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user.email || "—"}
              </p>
            </div>
          )}

          {/* Ссылка ведёт на существующую страницу: раньше здесь был /settings,
              которого нет в приложении — «Настройки» открывали 404 */}
          <Link
            href="/organization"
            className={cn(
              "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground transition-[background-color,color,transform] duration-200 ease-out hover:translate-x-0.5 group",
            )}
            title={isCollapsed ? "Настройки" : undefined}
          >
            <Settings className="h-5 w-5 flex-shrink-0" />
            {!isCollapsed && <span>Настройки</span>}
            {isCollapsed && (
              <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-sm rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50 border">
                Настройки
              </div>
            )}
          </Link>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className={cn(
              "w-full justify-start text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10 px-3 relative group",
              isCollapsed && "justify-center",
            )}
            title={isCollapsed ? "Выйти" : undefined}
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            {!isCollapsed && <span className="ml-3">Выйти</span>}
            {isCollapsed && (
              <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-sm rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50 border">
                Выйти
              </div>
            )}
          </Button>

          {/* Кнопка сворачивания */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggle}
            className="w-full justify-center text-sidebar-foreground/70 hover:text-sidebar-foreground mt-2"
          >
            {isCollapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <>
                <ChevronLeft className="h-5 w-5 mr-2" />
                <span>Свернуть</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </aside>
  )
}