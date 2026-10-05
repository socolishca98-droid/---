"use client";

import { useEffect, useState } from "react";

import { pluralDays } from "@/lib/billing/plans";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useSidebar } from "@/lib/sidebar-context";
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
  Smartphone,
  Plug,
  Fuel,
  Wrench,
  ScrollText,
  Crown,
  Wand2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PRODUCT_NAME } from "@/lib/auth/constants";

/** Какие счётчики может показывать пункт меню. */
type BadgeKey = "orders" | "chat";

const navigation: Array<{
  name: string;
  href: string;
  icon: any;
  badgeKey?: BadgeKey;
  /** Пункт виден только администратору организации */
  adminOnly?: boolean;
  /** Пункт виден только владельцу платформы (PLATFORM_OWNER_EMAIL) */
  ownerOnly?: boolean;
  /** Пункт виден, только пока организация использует ATI.SU */
  atiOnly?: boolean;
}> = [
  { name: "Дашборд", href: "/dashboard", icon: LayoutDashboard },
  // бейджи — настоящие числа организации (/api/sidebar-counts), а не зашитые значения
  { name: "Заказы", href: "/orders", icon: Package, badgeKey: "orders" },
  // поиск грузов — по требованию, отдельной страницей (не постоянная вкладка)
  { name: "Поиск грузов", href: "/search", icon: Search, atiOnly: true },
  { name: "Кабинет ATI", href: "/ati", icon: Plug, atiOnly: true },
  { name: "Мобильный пульт", href: "/s", icon: Smartphone },
  { name: "Маршруты", href: "/routes", icon: RouteIcon },
  { name: "Виртуальный логист", href: "/planner", icon: Wand2 },
  { name: "Автопарк", href: "/fleet", icon: Warehouse },
  { name: "Топливо", href: "/fuel", icon: Fuel },
  { name: "Обслуживание", href: "/maintenance", icon: Wrench },
  { name: "Клиенты", href: "/clients", icon: Contact },
  { name: "Фото", href: "/photos", icon: Camera },
  { name: "Чат", href: "/chat", icon: MessageSquare, badgeKey: "chat" },
  { name: "Оплаты", href: "/payments", icon: CreditCard },
  { name: "Отчёты", href: "/reports", icon: FileBarChart },
  { name: "Тарифы", href: "/pricing", icon: Wallet },
  // журнал действий — для админа: кто и что менял в организации
  { name: "Журнал", href: "/audit", icon: ScrollText, adminOnly: true },
  // режим владельца: все организации платформы (виден только владельцу)
  { name: "Владелец", href: "/owner", icon: Crown, ownerOnly: true },
  { name: "Сотрудники", href: "/users", icon: Users },
  { name: "Организация", href: "/organization", icon: Building2 },
];

const EMPTY_COUNTS: Record<BadgeKey, number> = { orders: 0, chat: 0 };

/** Тариф организации в том виде, в каком его отдаёт GET /api/org-settings. */
interface Billing {
  plan: string;
  storedPlan: string;
  isTrialing: boolean;
  trialDaysLeft: number | null;
  vehicleLimit: number | null;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { isCollapsed, toggle } = useSidebar();
  const [counts, setCounts] = useState<Record<BadgeKey, number>>(EMPTY_COUNTS);
  // ATI-разделы видны, только пока организация использует биржу (/api/sidebar-counts)
  const [atiEnabled, setAtiEnabled] = useState(true);
  // Пункт «Владелец» показываем только аккаунту из PLATFORM_OWNER_EMAIL
  const [isOwner, setIsOwner] = useState(false);
  // Пробный период: предупреждаем заранее и не молчим, когда он кончился
  const [billing, setBilling] = useState<Billing | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/org-settings", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.billing) setBilling(data.billing);
      })
      .catch(() => {
        /* тариф не узнали — баннер просто не показываем */
      });
    return () => {
      active = false;
    };
  }, []);

  /**
   * Платные планы баннер не показывают: надоедать нечему. Показываем, только
   * когда пробный период на исходе (неделя) или уже кончился, а платный план
   * так и не выбран — тогда действует бесплатный лимит.
   */
  const trialNotice = (() => {
    if (!billing) return null;
    if (billing.isTrialing) {
      const days = billing.trialDaysLeft ?? 0;
      if (days > 7) return null;
      return {
        title: `Пробный период: ${pluralDays(days)}`,
        hint: "Выбрать тариф",
      };
    }
    if (billing.plan === "free" && billing.storedPlan === "trial") {
      return {
        title: "Пробный период закончился",
        hint: `Бесплатный план · до ${billing.vehicleLimit ?? 2} машин`,
      };
    }
    return null;
  })();

  useEffect(() => {
    let active = true;
    fetch("/api/owner/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.owner) setIsOwner(true);
      })
      .catch(() => {
        /* не владелец или нет сессии — пункт просто не виден */
      });
    return () => {
      active = false;
    };
  }, []);

  // Счётчики обновляются при переходе между разделами, раз в минуту и когда
  // вкладка снова становится видимой. Ошибка не ломает меню — бейджи просто
  // не показываются.
  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch("/api/sidebar-counts", {
          credentials: "include",
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!active) return;
        setCounts({
          orders: Number(data?.orders) || 0,
          chat: Number(data?.chat) || 0,
        });
        setAtiEnabled(data?.atiEnabled !== false);
      } catch {
        /* счётчики — не критично */
      }
    };

    load();
    const interval = window.setInterval(load, 60_000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname]);

  const handleLogout = async () => {
    // Серверный выход: сессия отзывается в БД, httpOnly-cookie удаляется
    await logout();
    router.replace("/login");
    router.refresh();
  };

  return (
    <aside
      className={cn(
        // Панель полупрозрачная: живой фон рабочего места читается сквозь неё
        "fixed left-0 top-0 z-40 h-screen bg-sidebar/45 backdrop-blur-xl border-r border-sidebar-border transition-[width] duration-300 ease-out",
        isCollapsed ? "w-20" : "w-64",
      )}
    >
      {/* Кнопка сворачивания — маленький аккуратный «выступ» на самой кромке
          панели, а не полноширинная кнопка внизу списка */}
      <button
        type="button"
        onClick={toggle}
        aria-label={isCollapsed ? "Развернуть меню" : "Свернуть меню"}
        title={isCollapsed ? "Развернуть меню" : "Свернуть меню"}
        className="absolute -right-3 top-20 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-popover text-muted-foreground shadow-lg transition-colors hover:text-foreground"
      >
        {isCollapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          {!isCollapsed && (
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Truck className="h-5 w-5 text-primary-foreground" />
              </div>
              {/* Единое название продукта — не «ГрузоПоток» из старого макета */}
              <span className="text-lg font-bold tracking-tight text-sidebar-foreground">
                {PRODUCT_NAME}
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

        {/* Navigation: min-h-0 + overflow-y-auto — на невысоком окне список
            разделов прокручивается, а логотип сверху и блок пользователя снизу
            остаются на месте. Иначе нижние разделы уезжают за экран. */}
        <nav className="flex-1 min-h-0 space-y-1 overflow-y-auto overscroll-contain p-3">
          {navigation
            .filter(
              (item) =>
                (!item.adminOnly || user?.role === "admin") &&
                (!item.ownerOnly || isOwner) &&
                (!item.atiOnly || atiEnabled),
            )
            .map((item) => {
              const isActive = pathname === item.href;
              const badgeValue = item.badgeKey ? counts[item.badgeKey] : 0;
              const badgeLabel = badgeValue > 99 ? "99+" : String(badgeValue);
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
                </Link>
              );
            })}
        </nav>

        {/* Bottom Section */}
        <div className="border-t border-sidebar-border p-3 space-y-1">
          {/* Пробный период — только когда он на исходе или кончился */}
          {trialNotice && (
            <Link
              href="/pricing"
              className={cn(
                "mb-2 flex items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 transition-colors hover:bg-amber-400/20",
                isCollapsed && "justify-center",
              )}
              title={isCollapsed ? trialNotice.title : undefined}
            >
              <Wallet className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && (
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {trialNotice.title}
                  </span>
                  <span className="block truncate text-[11px] text-amber-300/70">
                    {trialNotice.hint}
                  </span>
                </span>
              )}
            </Link>
          )}

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

          {/* Настройки — отдельная страница /settings: карта, нормы, реквизиты */}
          <Link
            href="/settings"
            className={cn(
              "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground transition-[background-color,color,transform] duration-200 ease-out hover:translate-x-0.5 group",
            )}
            title={isCollapsed ? "Настройки" : undefined}
          >
            <Settings className="h-5 w-5 flex-shrink-0" />
            {!isCollapsed && <span>Настройки</span>}
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
          </Button>
        </div>
      </div>
    </aside>
  );
}
