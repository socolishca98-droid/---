"use client";

// app/s/orders/page.tsx
//
// Заказы организации в мобильном пульте: chips по этапам процесса, поиск по
// маршруту и клиенту, карточка-строка с ценой и статусом. Тап — полная
// карточка процесса (та же, что на десктопе: согласование, торг, лента).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Package, Search } from "lucide-react";

import { orderStatusLabel } from "@/lib/orders/stages";
import { cn } from "@/lib/utils";
import { TruckLoader } from "@/components/ui/truck-loader";

interface OrderRow {
  id: string;
  status: string;
  routeFrom: string;
  routeTo: string;
  price: number | null;
  weight: number | null;
  distance: number | null;
  clientName: string | null;
  negotiationStatus: string | null;
}

const CHIPS: Array<{ key: string; label: string; statuses: string | null }> = [
  { key: "all", label: "Все", statuses: null },
  { key: "search", label: "Поиск", statuses: "search" },
  { key: "negotiation", label: "Переговоры", statuses: "negotiation" },
  { key: "agreed", label: "Согласованы", statuses: "agreed" },
  {
    key: "work",
    label: "В рейсе",
    statuses: "in_route,documents,assigned,control",
  },
  { key: "closed", label: "Закрыты", statuses: "delivered,cancelled,rejected" },
];

const STATUS_TONE: Record<string, string> = {
  search: "text-zinc-400 border-zinc-500/30",
  negotiation: "text-amber-400 border-amber-500/30",
  agreed: "text-emerald-400 border-emerald-500/30",
  in_route: "text-cyan-400 border-cyan-500/30",
  documents: "text-cyan-400 border-cyan-500/30",
  assigned: "text-cyan-400 border-cyan-500/30",
  control: "text-cyan-400 border-cyan-500/30",
  delivered: "text-zinc-500 border-zinc-600/30",
  cancelled: "text-red-400 border-red-500/30",
  rejected: "text-red-400 border-red-500/30",
};

const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

export default function StaffMobileOrders() {
  const [chip, setChip] = useState("all");
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (statuses: string | null) => {
    setLoading(true);
    try {
      const url = statuses
        ? `/api/orders?status=${statuses}&limit=100`
        : "/api/orders?limit=100";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      setOrders(Array.isArray(data?.orders) ? data.orders : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const active = CHIPS.find((item) => item.key === chip) ?? CHIPS[0];
    void load(active.statuses);
  }, [chip, load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) =>
      [order.routeFrom, order.routeTo, order.clientName].some(
        (field) => field && field.toLowerCase().includes(q),
      ),
    );
  }, [orders, query]);

  return (
    <div className="space-y-4 px-4 pt-6">
      <header>
        <h1 className="text-2xl font-bold">Заказы</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Этап процесса — цветом статуса. Тап по заказу — карточка с торгом и
          лентой.
        </p>
      </header>

      <div className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 backdrop-blur-xl">
        <Search className="h-4 w-4 text-zinc-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Город, клиент…"
          className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-zinc-600"
        />
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {CHIPS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setChip(item.key)}
            className={cn(
              "flex-shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
              chip === item.key
                ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
                : "border-white/[0.08] bg-white/[0.03] text-zinc-400",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <TruckLoader className="text-primary" />
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 text-center text-xs text-zinc-500">
          На этом этапе заказов нет.
        </p>
      ) : (
        <div className="space-y-2.5">
          {visible.map((order) => (
            <Link
              key={order.id}
              href={`/s/orders/${order.id}`}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-3.5 backdrop-blur-xl transition-colors hover:bg-white/[0.07]"
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-400">
                <Package className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {order.routeFrom} → {order.routeTo}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                  {order.price ? `${money.format(order.price)} ₽` : "без цены"}
                  {order.distance ? ` · ${order.distance} км` : ""}
                  {order.clientName ? ` · ${order.clientName}` : ""}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    STATUS_TONE[order.status] ??
                      "text-zinc-400 border-zinc-500/30",
                  )}
                >
                  {orderStatusLabel(order.status)}
                </span>
                <ChevronRight className="h-4 w-4 text-zinc-600" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
