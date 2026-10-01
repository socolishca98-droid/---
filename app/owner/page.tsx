"use client";

// app/owner/page.tsx
//
// Раздел «Владелец» — личная страница владельца платформы (email задан в
// .env: PLATFORM_OWNER_EMAIL). Список всех организаций с поиском и входом
// в любую из них. Вход выпускает настоящую сессию сотрудника организации и
// пишется в её журнал аудита; возврат — баннером «Режим владельца».

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Crown,
  LogIn,
  Package,
  Route as RouteIcon,
  Search,
  Truck,
  Users,
} from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { PageLayout } from "@/components/page-layout";
import { TruckLoader } from "@/components/ui/truck-loader";

interface OwnerOrganization {
  id: string;
  name: string;
  createdAt: string;
  users: number;
  drivers: number;
  orders: number;
  routes: number;
}

const dateFmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" });

export default function OwnerPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [organizations, setOrganizations] = useState<OwnerOrganization[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Доступ: только вошедший сотрудник с email владельца
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    fetch("/api/owner/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setAllowed(Boolean(data?.owner)))
      .catch(() => setAllowed(false));
  }, [authLoading, user, router]);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const url = query.trim()
        ? `/api/owner/organizations?search=${encodeURIComponent(query.trim())}`
        : "/api/owner/organizations";
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      setOrganizations(
        Array.isArray(data?.organizations) ? data.organizations : [],
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Поиск с мягкой задержкой
  useEffect(() => {
    if (allowed !== true) return;
    const timer = window.setTimeout(() => void load(search), 300);
    return () => window.clearTimeout(timer);
  }, [search, allowed, load]);

  const enter = async (org: OwnerOrganization) => {
    setEnteringId(org.id);
    setError("");
    try {
      const res = await fetch("/api/owner/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: org.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || "Не удалось войти в организацию");
        return;
      }
      // Полная перезагрузка: новая сессия должна подхватиться всеми экранами
      window.location.href = "/dashboard";
    } catch {
      setError("Ошибка соединения");
    } finally {
      setEnteringId(null);
    }
  };

  if (authLoading || allowed === null) {
    return (
      <PageLayout title="Владелец" description="Проверяем права…">
        <div className="flex justify-center py-20">
          <TruckLoader className="text-primary" />
        </div>
      </PageLayout>
    );
  }

  if (!allowed) {
    return (
      <PageLayout title="Владелец" description="Раздел недоступен">
        <div className="surface-glass rounded-2xl p-8 text-center">
          <Crown className="mx-auto h-8 w-8 text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-400">
            Этот раздел открыт только владельцу платформы — аккаунту, чей email
            задан в <code className="text-xs">PLATFORM_OWNER_EMAIL</code>.
          </p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Режим владельца"
      description="Все организации платформы: найти, посмотреть масштаб и войти внутрь"
      actions={
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Crown className="h-4 w-4 text-amber-400" />
          организаций: {organizations.length}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="surface-glass flex items-center gap-2 rounded-2xl px-4">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по названию организации…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-zinc-600"
          />
        </div>

        {error && (
          <p className="rounded-xl border border-red-500/25 bg-red-500/[0.08] p-3 text-xs text-red-400">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <TruckLoader className="text-primary" />
          </div>
        ) : organizations.length === 0 ? (
          <div className="surface-glass rounded-2xl p-10 text-center">
            <Building2 className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-3 text-sm text-zinc-400">
              {search.trim()
                ? `Ничего не найдено по запросу «${search.trim()}».`
                : "Организаций пока нет — они появятся после регистрации."}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {organizations.map((org) => (
              <div
                key={org.id}
                className="surface-glass flex items-center gap-4 rounded-2xl p-4 transition-transform hover:-translate-y-0.5"
              >
                <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/25 to-amber-500/5 text-amber-400 ring-1 ring-amber-500/20">
                  <Building2 className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{org.name}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    с {dateFmt.format(new Date(org.createdAt))}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {org.users}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Truck className="h-3 w-3" /> {org.drivers}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Package className="h-3 w-3" /> {org.orders}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <RouteIcon className="h-3 w-3" /> {org.routes}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void enter(org)}
                  disabled={enteringId === org.id}
                  className="inline-flex h-10 flex-shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 px-4 text-xs font-semibold text-zinc-950 shadow-[0_10px_28px_-12px_rgba(249,115,22,0.7)] transition-opacity disabled:opacity-50"
                >
                  {enteringId === org.id ? (
                    <TruckLoader size={16} />
                  ) : (
                    <LogIn className="h-3.5 w-3.5" />
                  )}
                  Войти
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-zinc-600">
          Вход в организацию выпускает сессию её сотрудника и записывается в её
          журнал аудита (<code>owner_impersonate</code> /{" "}
          <code>owner_exit</code>). Пока вы внутри, вверху виден баннер «Режим
          владельца» с кнопкой возврата.
        </p>
      </div>
    </PageLayout>
  );
}
