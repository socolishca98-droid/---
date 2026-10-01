"use client";

// app/s/routes/page.tsx
//
// Рейсы организации в мобильном пульте: активные и завершённые, с водителем,
// машиной, экономикой и составом заказов. Тап по рейсу — раскрывает список
// заказов прямо в карточке (без тяжёлых страниц).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, MapPin, Truck, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { TruckLoader } from "@/components/ui/truck-loader";

interface RouteRow {
  id: string;
  status: string;
  createdAt?: string;
  driver?: { name: string; phone?: string } | null;
  vehicle?: { plate?: string; model?: string } | null;
  orders?: Array<{
    id: string;
    routeFrom: string;
    routeTo: string;
    price?: number | null;
  }>;
  stats?: { totalDistance?: number; orderCount?: number } | null;
  economics?: { profit?: number; plannedProfit?: number } | null;
}

const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

const STATUS_TONE: Record<string, string> = {
  planning: "text-zinc-400 border-zinc-500/30",
  active: "text-emerald-400 border-emerald-500/30",
  completed: "text-cyan-400 border-cyan-500/30",
  cancelled: "text-red-400 border-red-500/30",
};

const STATUS_LABEL: Record<string, string> = {
  planning: "планируется",
  active: "в пути",
  completed: "завершён",
  cancelled: "отменён",
};

export default function StaffMobileRoutes() {
  const [tab, setTab] = useState<"active" | "closed">("active");
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async (which: "active" | "closed") => {
    setLoading(true);
    try {
      const url =
        which === "closed"
          ? "/api/routes?includeClosed=1&status=completed,cancelled"
          : "/api/routes";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      setRoutes(Array.isArray(data?.routes) ? data.routes : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  return (
    <div className="space-y-4 px-4 pt-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Рейсы</h1>
          <p className="mt-1 text-xs text-zinc-500">
            Кто где едет и с каким результатом.
          </p>
        </div>
        <Link href="/routes" className="text-xs text-orange-400">
          полная карта
        </Link>
      </header>

      <div className="flex gap-2">
        {(["active", "closed"] as const).map((which) => (
          <button
            key={which}
            type="button"
            onClick={() => setTab(which)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
              tab === which
                ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
                : "border-white/[0.08] bg-white/[0.03] text-zinc-400",
            )}
          >
            {which === "active" ? "Активные" : "Завершённые"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <TruckLoader className="text-primary" />
        </div>
      ) : routes.length === 0 ? (
        <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 text-center text-xs text-zinc-500">
          {tab === "active"
            ? "Активных рейсов нет — холст маршрутов пуст."
            : "Завершённых рейсов пока нет."}
        </p>
      ) : (
        <div className="space-y-2.5">
          {routes.map((route) => {
            const open = openId === route.id;
            const profit =
              route.economics?.profit ?? route.economics?.plannedProfit;
            return (
              <div
                key={route.id}
                className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.04] backdrop-blur-xl"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : route.id)}
                  className="flex w-full items-start gap-3 p-3.5 text-left transition-colors hover:bg-white/[0.04]"
                >
                  <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 text-cyan-400 ring-1 ring-cyan-500/20">
                    <Truck className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {route.driver?.name || "водитель не назначен"}
                      </span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          STATUS_TONE[route.status] ??
                            "text-zinc-400 border-zinc-500/30",
                        )}
                      >
                        {STATUS_LABEL[route.status] ?? route.status}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-zinc-500">
                      {route.vehicle?.plate || "машина не назначена"}
                      {route.stats?.orderCount != null &&
                        ` · ${route.stats.orderCount} заказ(ов)`}
                      {route.stats?.totalDistance
                        ? ` · ${Math.round(route.stats.totalDistance)} км`
                        : ""}
                      {profit != null ? ` · ${money.format(profit)} ₽` : ""}
                    </span>
                  </span>
                  {open ? (
                    <ChevronUp className="mt-1 h-4 w-4 flex-shrink-0 text-zinc-600" />
                  ) : (
                    <ChevronDown className="mt-1 h-4 w-4 flex-shrink-0 text-zinc-600" />
                  )}
                </button>
                {open && (
                  <div className="space-y-2 border-t border-white/[0.05] p-3.5">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                      <User className="h-3 w-3" />
                      {route.driver?.phone || "телефон не указан"}
                    </p>
                    {(route.orders ?? []).length === 0 ? (
                      <p className="text-xs text-zinc-500">
                        Заказов в рейсе нет.
                      </p>
                    ) : (
                      (route.orders ?? []).map((order) => (
                        <Link
                          key={order.id}
                          href={`/s/orders/${order.id}`}
                          className="flex items-center gap-2 rounded-xl bg-white/[0.04] p-2.5 text-xs transition-colors hover:bg-white/[0.08]"
                        >
                          <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                          <span className="min-w-0 flex-1 truncate">
                            {order.routeFrom} → {order.routeTo}
                          </span>
                          {order.price != null && (
                            <span className="tabular-nums text-zinc-400">
                              {money.format(order.price)} ₽
                            </span>
                          )}
                        </Link>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
