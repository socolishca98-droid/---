"use client";

// components/assistant/planner-view.tsx
//
// Виртуальный логист: из базы заказов собирает максимально продуктивный
// маршрут для свободной машины — не один заказ, а цепочку (выгрузка там,
// где следующая погрузка). Данные — GET /api/assistant/plan (логика в
// lib/assistant/planner.ts), создание рейса — проверенный POST /api/routes.
//
// Логист подтверждает вариант («Создать рейс») или отклоняет отдельные
// заказы (✕) — планировщик пересобирает цепочки и предлагает другие.
// Заказы, которые ещё не согласованы, помечаются: в рейс попадут только
// согласованные, остальным сначала нужно подтвердить цену.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  Truck,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  chainCities,
  type PlannerProposal,
  type PlannerVehicle,
} from "@/lib/assistant/planner";

type PlanStats = {
  candidates: number;
  overweight: number;
  excluded: number;
};

type PlanPayload = {
  success?: boolean;
  vehicle: PlannerVehicle | null;
  vehicles: PlannerVehicle[];
  proposals: PlannerProposal[];
  stats: PlanStats;
  warning?: string | null;
  error?: string;
};

const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

function formatDate(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function vehicleLabel(vehicle: PlannerVehicle): string {
  const name = [vehicle.brand, vehicle.model].filter(Boolean).join(" ");
  return `${vehicle.plate}${name ? ` · ${name}` : ""} · ${vehicle.capacity.toLocaleString("ru-RU")} кг`;
}

export function PlannerView() {
  const router = useRouter();

  const [data, setData] = useState<PlanPayload | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (vehicleId) params.set("vehicleId", vehicleId);
      if (excludeIds.length > 0) params.set("exclude", excludeIds.join(","));
      const res = await fetch(`/api/assistant/plan?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await res
        .json()
        .catch(() => null)) as PlanPayload | null;
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || "Не удалось собрать предложения");
      }
      setData(payload);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось собрать предложения");
    } finally {
      setLoading(false);
    }
  }, [vehicleId, excludeIds]);

  useEffect(() => {
    void load();
  }, [load]);

  const proposals = data?.proposals ?? [];

  const excludeOrder = (orderId: string) => {
    setExcludeIds((prev) =>
      prev.includes(orderId) ? prev : [...prev, orderId],
    );
  };

  const resetExcludes = () => setExcludeIds([]);

  const createRoute = async (proposal: PlannerProposal) => {
    if (!data?.vehicle) return;
    const orderIds = proposal.orders
      .filter((order) => !order.needsApproval)
      .map((o) => o.id);
    if (orderIds.length === 0) return;

    setCreatingId(proposal.id);
    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, vehicleId: data.vehicle.id }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || "Не удалось создать рейс");
      }
      toast.success(
        `Рейс создан: ${payload.route?.ordersCount ?? orderIds} заказ(ов)`,
        {
          description:
            payload.route?.routeName ||
            "Откройте маршруты, чтобы назначить водителя",
        },
      );
      router.push("/routes");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось создать рейс");
    } finally {
      setCreatingId(null);
    }
  };

  const excludedCount = excludeIds.length;

  return (
    <div className="space-y-5">
      {/* Шапка */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Wand2 className="h-5 w-5 text-orange-400" />
            Виртуальный логист
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Собирает из базы заказов продуктивную цепочку под свободную машину:
            минимум порожних перегонов, учтены вес, объём, сроки и доход.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {excludedCount > 0 && (
            <Button variant="ghost" size="sm" onClick={resetExcludes}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Исключено: {excludedCount} — вернуть все
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Пересобрать
          </Button>
        </div>
      </div>

      {/* Выбор машины */}
      {data && data.vehicles.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Truck className="h-4 w-4 text-muted-foreground" />
            Свободная машина
          </h2>
          <div className="flex flex-wrap gap-2">
            {data.vehicles.map((vehicle) => (
              <button
                key={vehicle.id}
                type="button"
                onClick={() => setVehicleId(vehicle.id)}
                className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                  data.vehicle?.id === vehicle.id
                    ? "border-primary/50 bg-primary/10 font-medium"
                    : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06]"
                }`}
              >
                {vehicleLabel(vehicle)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Сводка */}
      {data && (
        <p className="text-xs text-muted-foreground">
          Актуальных заказов: {data.stats.candidates}
          {data.stats.overweight > 0
            ? ` · не помещаются в машину: ${data.stats.overweight}`
            : ""}
          {data.stats.excluded > 0
            ? ` · исключено вручную: ${data.stats.excluded}`
            : ""}
          {data.vehicle ? ` · машина: ${vehicleLabel(data.vehicle)}` : ""}
        </p>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Планирую маршруты…
        </div>
      ) : data?.warning && proposals.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 text-center text-sm text-muted-foreground">
          <Sparkles className="mx-auto mb-2 h-5 w-5 text-orange-400" />
          {data.warning}
        </div>
      ) : (
        <div className="space-y-4">
          {proposals.map((proposal, index) => {
            const chain = chainCities(proposal.orders);
            const routeableIds = proposal.orders
              .filter((order) => !order.needsApproval)
              .map((order) => order.id);
            return (
              <article
                key={proposal.id}
                className="surface-glass rounded-2xl border border-white/[0.06] p-4"
              >
                <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-gradient-to-br from-orange-500/25 to-orange-500/5 px-2 py-1 text-xs font-semibold text-orange-300 ring-1 ring-orange-500/25">
                      Вариант {index + 1}
                      {index === 0 ? " · лучший" : ""}
                    </span>
                    <span className="text-sm font-medium">
                      {proposal.variantTitle}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {proposal.reason}
                  </span>
                </header>

                {/* Метрики */}
                <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1">
                    {proposal.totalDistanceKm.toLocaleString("ru-RU")} км по
                    заказам
                  </span>
                  <span className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1">
                    {proposal.totalWeightKg.toLocaleString("ru-RU")} кг
                  </span>
                  <span className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-2 py-1 text-emerald-300">
                    доход {money.format(proposal.revenueRub)} ₽
                  </span>
                  <span
                    className={`rounded-lg border px-2 py-1 ${
                      proposal.emptyLegs > 0
                        ? "border-amber-500/25 bg-amber-500/[0.07] text-amber-300"
                        : "border-white/[0.06] bg-white/[0.03]"
                    }`}
                  >
                    порожних перегонов: {proposal.emptyLegs}
                  </span>
                  {proposal.approvalCount > 0 && (
                    <span className="rounded-lg border border-sky-500/25 bg-sky-500/[0.07] px-2 py-1 text-sky-300">
                      ждут согласования: {proposal.approvalCount}
                    </span>
                  )}
                </div>

                {/* Цепочка городов */}
                <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
                  <MapPin className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
                  {chain.map((point, pointIndex) => (
                    <span key={pointIndex} className="flex items-center gap-1">
                      {pointIndex > 0 && (
                        <ArrowRight
                          className={`h-3 w-3 ${point.gapBefore ? "text-amber-400" : "text-muted-foreground"}`}
                        />
                      )}
                      <span className={point.gapBefore ? "text-amber-300" : ""}>
                        {point.city}
                      </span>
                    </span>
                  ))}
                </div>

                {/* Заказы цепочки */}
                <ul className="mb-3 space-y-1.5">
                  {proposal.orders.map((order, orderIndex) => (
                    <li
                      key={order.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-xs"
                    >
                      <span className="w-5 text-muted-foreground">
                        {orderIndex + 1}.
                      </span>
                      <span className="font-medium">
                        {order.routeFrom} → {order.routeTo}
                      </span>
                      <span className="text-muted-foreground">
                        {order.clientName || "клиент не указан"}
                      </span>
                      <span className="text-muted-foreground">
                        {(order.weight ?? 0).toLocaleString("ru-RU")} кг
                      </span>
                      <span className="text-emerald-300">
                        {order.revenueRub > 0
                          ? `${money.format(order.revenueRub)} ₽`
                          : "цена не задана"}
                      </span>
                      {order.deadline && (
                        <span
                          className={
                            order.deadlineSoon
                              ? "text-red-400"
                              : "text-muted-foreground"
                          }
                        >
                          срок {formatDate(order.deadline)}
                          {order.deadlineSoon ? " · горит" : ""}
                        </span>
                      )}
                      {order.needsApproval ? (
                        <Link
                          href={`/orders`}
                          className="rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-sky-500/20"
                          title="Заказ не согласован: подтвердите цену в карточке заказа, тогда он попадёт в рейс"
                        >
                          нужно согласование
                        </Link>
                      ) : (
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          готов к рейсу
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => excludeOrder(order.id)}
                        className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                        title="Не согласован / не подходит — исключить и пересобрать маршрут"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>

                <footer className="flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    disabled={
                      routeableIds.length === 0 ||
                      creatingId !== null ||
                      !data?.vehicle
                    }
                    onClick={() => void createRoute(proposal)}
                  >
                    {creatingId === proposal.id ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Truck className="mr-1.5 h-4 w-4" />
                    )}
                    Создать рейс ({routeableIds.length})
                  </Button>
                  {proposal.approvalCount > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      В рейс попадут только согласованные ({routeableIds.length}{" "}
                      из {proposal.orders.length}). Остальным сначала
                      подтвердите цену —{" "}
                      <Link
                        href="/orders"
                        className="text-sky-400 underline-offset-2 hover:underline"
                      >
                        открыть заказы
                      </Link>
                      , затем «Пересобрать».
                    </p>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
