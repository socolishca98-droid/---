"use client";

// app/s/page.tsx
//
// Экран «День» мобильного пульта логиста: чем живёт организация прямо
// сейчас. Всё, что требует решения, — на первом экране: согласования,
// SOS и важные уведомления. Цифры — из тех же API, что и дашборд.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  CircleCheck,
  Package,
  Radio,
  RefreshCw,
  Wallet,
} from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { formatGreeting, formatHumanDate } from "@/lib/ui/greeting";
import { TruckLoader } from "@/components/ui/truck-loader";

interface Stats {
  revenue: number;
  orders: { active: number; completedToday: number };
  drivers: { online: number };
}

interface DecisionOrder {
  id: string;
  routeFrom: string;
  routeTo: string;
  price: number | null;
  weight: number | null;
  negotiationStatus: string | null;
}

interface AlertItem {
  id: string;
  type: string;
  title: string;
  message: string | null;
  createdAt: string;
}

const money = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function Kpi({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof Wallet;
  value: string;
  label: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-3.5 backdrop-blur-xl">
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${tone}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-lg font-semibold leading-none tabular-nums">
          {value}
        </span>
        <span className="mt-1 block text-[11px] leading-none text-zinc-500">
          {label}
        </span>
      </span>
    </div>
  );
}

export default function StaffMobileHome() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [decisions, setDecisions] = useState<DecisionOrder[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, ordersRes, notesRes] = await Promise.all([
        fetch("/api/dashboard/stats", { cache: "no-store" }),
        fetch("/api/orders?status=negotiation&limit=20", { cache: "no-store" }),
        fetch("/api/notifications", { cache: "no-store" }),
      ]);
      const statsData = await statsRes.json().catch(() => null);
      const ordersData = await ordersRes.json().catch(() => null);
      const notesData = await notesRes.json().catch(() => null);
      if (statsData?.success) setStats(statsData.stats);
      setDecisions(Array.isArray(ordersData?.orders) ? ordersData.orders : []);
      const notes: AlertItem[] = Array.isArray(notesData?.notifications)
        ? notesData.notifications
        : [];
      setAlerts(
        notes
          .filter((n) => n.type.startsWith("sos") || n.type.includes("payment"))
          .slice(0, 3),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5 px-4 pt-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-zinc-500">
            {formatHumanDate()}
          </p>
          <h1 className="mt-1 text-2xl font-bold leading-tight">
            {formatGreeting(user?.name)}
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            {user?.organization?.name || "Организация"} · мобильный пульт
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-zinc-400 backdrop-blur-xl transition-colors hover:text-zinc-200"
          aria-label="Обновить"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {loading && !stats ? (
        <div className="flex justify-center py-16">
          <TruckLoader className="text-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Kpi
              icon={Wallet}
              value={`${money.format(stats?.revenue ?? 0)} ₽`}
              label="выручка дня"
              tone="bg-gradient-to-br from-emerald-500/25 to-emerald-500/5 text-emerald-400 ring-emerald-500/20"
            />
            <Kpi
              icon={Package}
              value={String(stats?.orders.active ?? 0)}
              label="заказов в работе"
              tone="bg-gradient-to-br from-orange-500/25 to-orange-500/5 text-orange-400 ring-orange-500/20"
            />
            <Kpi
              icon={CircleCheck}
              value={String(stats?.orders.completedToday ?? 0)}
              label="завершено сегодня"
              tone="bg-gradient-to-br from-cyan-500/25 to-cyan-500/5 text-cyan-400 ring-cyan-500/20"
            />
            <Kpi
              icon={Radio}
              value={String(stats?.drivers.online ?? 0)}
              label="водителей на связи"
              tone="bg-gradient-to-br from-indigo-500/25 to-indigo-500/5 text-indigo-400 ring-indigo-500/20"
            />
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-300">
                Ждут вашего решения
              </h2>
              <Link href="/s/orders" className="text-xs text-orange-400">
                все заказы
              </Link>
            </div>
            {decisions.length === 0 ? (
              <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs text-zinc-500">
                Согласований в очереди нет — можно выдохнуть.
              </p>
            ) : (
              decisions.slice(0, 5).map((order) => (
                <Link
                  key={order.id}
                  href={`/s/orders/${order.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-3.5 backdrop-blur-xl transition-colors hover:bg-white/[0.07]"
                >
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/25 to-amber-500/5 text-amber-400 ring-1 ring-amber-500/20">
                    <Package className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {order.routeFrom} → {order.routeTo}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-zinc-500">
                      {order.price
                        ? `${money.format(order.price)} ₽`
                        : "цена в торге"}
                      {order.weight
                        ? ` · ${(order.weight / 1000).toFixed(1)} т`
                        : ""}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-600" />
                </Link>
              ))
            )}
          </section>

          <section className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
              <Bell className="h-3.5 w-3.5" />
              Важное
            </h2>
            {alerts.length === 0 ? (
              <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs text-zinc-500">
                SOS и просроченных оплат нет.
              </p>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.07] p-3.5"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{alert.title}</p>
                    {alert.message && (
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        {alert.message}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
