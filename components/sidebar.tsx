"use client"

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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const navigation = [
  { name: "Дашборд", href: "/dashboard", icon: LayoutDashboard },
  { name: "Заказы", href: "/orders", icon: Package, badge: 6 },
  { name: "Маршруты", href: "/routes", icon: RouteIcon },
  { name: "Автопарк", href: "/fleet", icon: Warehouse },
  { name: "Фото", href: "/photos", icon: Camera },
  { name: "Чат", href: "/chat", icon: MessageSquare, badge: 1 },
  { name: "Оплаты", href: "/payments", icon: CreditCard },
  { name: "Отчёты", href: "/reports", icon: FileBarChart },
  { name: "Сотрудники", href: "/users", icon: Users },
  { name: "Организация", href: "/organization", icon: Building2 },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const { isCollapsed, toggle } = useSidebar()

  const handleLogout = async () => {
    // Серверный выход: сессия отзывается в БД, httpOnly-cookie удаляется
    await logout()
    router.replace("/login")
    router.refresh()
  }

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300",
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
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors relative group",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )}
                title={isCollapsed ? item.name : undefined}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {!isCollapsed && (
                  <>
                    <span className="flex-1">{item.name}</span>
                    {item.badge && (
                      <Badge
                        variant="default"
                        className="h-5 min-w-5 px-1.5 text-xs bg-primary text-primary-foreground"
                      >
                        {item.badge}
                      </Badge>
                    )}
                  </>
                )}
                {/* Бейдж в свёрнутом режиме */}
                {isCollapsed && item.badge && (
                  <Badge
                    variant="default"
                    className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] bg-primary text-primary-foreground"
                  >
                    {item.badge}
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

          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors relative group",
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