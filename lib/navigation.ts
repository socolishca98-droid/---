// lib/navigation.ts
//
// Пункты меню штабной версии — один список на два интерфейса: боковую панель
// на компьютере и выдвижное меню на телефоне. Раньше список лежал внутри
// компонента сайдбара, из-за чего мобильное меню пришлось бы дублировать.

import {
  Building2,
  Camera,
  Contact,
  CreditCard,
  FileBarChart,
  Fuel,
  LayoutDashboard,
  MessageSquare,
  Package,
  RouteIcon,
  ScrollText,
  Search,
  Smartphone,
  Users,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react"

/** Какие счётчики может показывать пункт меню. */
export type BadgeKey = "orders" | "chat"

export interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  badgeKey?: BadgeKey
  /** Пункт виден только администратору организации */
  adminOnly?: boolean
  /** Пункт виден только логисту (у администратора своя полная версия) */
  logistOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { name: "Дашборд", href: "/dashboard", icon: LayoutDashboard },
  // логист работает с телефона: без этой ссылки мобильная панель теряется
  { name: "Мобильная панель", href: "/lm", icon: Smartphone, logistOnly: true },
  // бейджи — настоящие числа организации (/api/sidebar-counts), а не зашитые значения
  { name: "Заказы", href: "/orders", icon: Package, badgeKey: "orders" },
  // поиск грузов — по требованию, отдельной страницей (не постоянная вкладка)
  { name: "Поиск грузов", href: "/search", icon: Search },
  { name: "Маршруты", href: "/routes", icon: RouteIcon },
  { name: "Автопарк", href: "/fleet", icon: Warehouse },
  { name: "Топливо", href: "/fuel", icon: Fuel },
  { name: "Обслуживание", href: "/maintenance", icon: Wrench },
  { name: "Клиенты", href: "/clients", icon: Contact },
  { name: "Фото", href: "/photos", icon: Camera },
  { name: "Чат", href: "/chat", icon: MessageSquare, badgeKey: "chat" },
  { name: "Оплаты", href: "/payments", icon: CreditCard },
  { name: "Отчёты", href: "/reports", icon: FileBarChart },
  // журнал действий — для админа: кто и что менял в организации
  { name: "Журнал", href: "/audit", icon: ScrollText, adminOnly: true },
  { name: "Сотрудники", href: "/users", icon: Users },
  { name: "Организация", href: "/organization", icon: Building2 },
]

/** Пункты, доступные роли: админу — всё, логисту — без админских. */
export function navItemsForRole(role: string | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin").filter(
    (item) => !item.logistOnly || role === "logist",
  )
}
