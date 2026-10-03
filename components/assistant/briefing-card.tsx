"use client";

// components/assistant/briefing-card.tsx
//
// Карточка утреннего брифинга: что сегодня важно — одним списком.
// Рендерит пункты движка правил (lib/assistant/briefing.ts) через
// /api/assistant/briefing; каждый пункт ведёт на экран, где проблема
// решается. Пустой список = «всё спокойно» (это тоже информация).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlarmClock,
  CalendarClock,
  ChevronRight,
  HandCoins,
  MessagesSquare,
  Radio,
  RefreshCw,
  Siren,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { BriefingItem, BriefingSeverity } from "@/lib/assistant/briefing";

const ICONS: Record<BriefingItem["kind"], typeof Siren> = {
  negotiations: MessagesSquare,
  followups: AlarmClock,
  overdue_payments: HandCoins,
  week_payments: CalendarClock,
  sos: Siren,
  stalled_routes: Radio,
  yesterday: TrendingUp,
};

const TONES: Record<BriefingSeverity, string> = {
  danger:
    "bg-gradient-to-br from-red-500/25 to-red-500/5 text-red-400 ring-red-500/25",
  warn: "bg-gradient-to-br from-amber-500/25 to-amber-500/5 text-amber-400 ring-amber-500/25",
  info: "bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 text-cyan-400 ring-cyan-500/20",
  good: "bg-gradient-to-br from-emerald-500/25 to-emerald-500/5 text-emerald-400 ring-emerald-500/25",
};

export function BriefingCard({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<BriefingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/assistant/briefing", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (data?.success && Array.isArray(data.items)) setItems(data.items);
    } catch {
      // офлайн: карточка просто пустая, экраны работают дальше
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <section
      className={cn(
        "surface-glass rounded-2xl",
        compact ? "p-3.5" : "border border-white/[0.06] p-4",
      )}
      aria-label="Брифинг ассистента"
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-orange-400" />
          Ассистент · что сегодня важно
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-400 transition-colors hover:text-zinc-200"
          aria-label="Обновить брифинг"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </header>

      {loading && items.length === 0 ? (
        <p className="text-xs text-zinc-500">Собираем картину дня…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3.5 text-xs text-emerald-300">
          Всё спокойно: ни просрочек, ни висящих согласований, ни молчащих
          рейсов. Хороший момент, чтобы заняться планами на неделю.
        </p>
      ) : (
        <ul className="grid gap-2">
          {items.map((item) => {
            const Icon = ICONS[item.kind] ?? Sparkles;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.06]"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ring-1",
                      TONES[item.severity],
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                      {item.message}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-600" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
