"use client";

// components/staff-mobile/bottom-nav.tsx
//
// Нижняя навигация мобильного пульта логиста: стеклянная «пилюля» над
// безопасной зоной телефона, пять разделов, живые бейджи из
// /api/sidebar-counts (те же числа, что в сайдбаре десктопа).

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  MessageSquare,
  Package,
  Route as RouteIcon,
  Menu,
} from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/s", label: "День", icon: Home },
  {
    href: "/s/orders",
    label: "Заказы",
    icon: Package,
    badge: "orders" as const,
  },
  { href: "/s/routes", label: "Рейсы", icon: RouteIcon },
  {
    href: "/s/chat",
    label: "Чат",
    icon: MessageSquare,
    badge: "chat" as const,
  },
  { href: "/s/menu", label: "Ещё", icon: Menu },
];

export function BottomNav() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<{ orders: number; chat: number }>({
    orders: 0,
    chat: 0,
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/sidebar-counts", {
          credentials: "include",
        });
        const data = await res.json();
        if (!alive || !data?.success) return;
        setCounts({ orders: data.orders || 0, chat: data.chat || 0 });
      } catch {
        // офлайн или сессия кончилась: бейджи просто нулевые
      }
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <nav
      className="fixed inset-x-3 z-40 border border-white/[0.08] bg-[#101319]/80 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.9)] backdrop-blur-xl rounded-2xl"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      aria-label="Основная навигация мобильного пульта"
    >
      <div className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const active =
            item.href === "/s"
              ? pathname === "/s"
              : pathname.startsWith(item.href);
          const badge =
            item.badge === "orders"
              ? counts.orders
              : item.badge === "chat"
                ? counts.chat
                : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-2xl px-1 py-2.5 transition-colors",
                active
                  ? "text-orange-400"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              <span
                className={cn(
                  "relative flex h-8 w-12 items-center justify-center rounded-xl transition-all",
                  active
                    ? "bg-gradient-to-br from-orange-500/30 to-orange-500/5 ring-1 ring-orange-500/30 shadow-[0_0_18px_-4px_rgba(249,115,22,0.55)]"
                    : "",
                )}
              >
                <item.icon className="h-4.5 w-4.5" />
                {badge > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-bold text-zinc-950">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium leading-none">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
