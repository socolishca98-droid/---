"use client";

// app/s/menu/page.tsx
//
// «Ещё» мобильного пульта: кто вошёл, установка приложения на главный экран
// телефона, переход к полной версии и разделам, которым тесно на мобильном,
// выход из сессии.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Crown,
  Download,
  LogOut,
  Monitor,
  Radar,
  Route as RouteIcon,
  Settings,
  ChevronRight,
} from "lucide-react";

import { useAuth } from "@/lib/auth-context";

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  logist: "Логист",
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const LINKS = [
  {
    href: "/dashboard",
    label: "Полная версия",
    hint: "дашборд, отчёты, справочники",
    icon: Monitor,
  },
  {
    href: "/routes",
    label: "Карта рейсов",
    hint: "холст маршрутов и трек на карте",
    icon: RouteIcon,
  },
  {
    href: "/ati",
    label: "Кабинет АТИ",
    hint: "площадки, токен, поиск грузов",
    icon: Radar,
  },
  {
    href: "/settings",
    label: "Настройки",
    hint: "пароль, внешний вид",
    icon: Settings,
  },
  {
    href: "/organization",
    label: "Организация",
    hint: "реквизиты, команда",
    icon: Building2,
  },
];

export default function StaffMobileMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  // Раздел владельца виден только аккаунту из PLATFORM_OWNER_EMAIL
  const [isOwner, setIsOwner] = useState(false);
  // ATI-ссылка в меню — только пока организация использует биржу
  const [atiEnabled, setAtiEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/org-settings", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.success)
          setAtiEnabled(data.settings?.atiEnabled !== false);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/owner/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.owner) setIsOwner(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const installedHandler = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  };

  const signOut = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <div className="space-y-5 px-4 pt-6">
      <header className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500/30 to-orange-500/5 text-lg font-bold text-orange-300 ring-1 ring-orange-500/25">
          {(user?.name || "?").trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">
            {user?.name || "Сотрудник"}
          </p>
          <p className="truncate text-xs text-zinc-500">
            {user?.role ? ROLE_LABELS[user.role] || user.role : "роль"} ·{" "}
            {user?.organization?.name || ""}
          </p>
        </div>
      </header>

      {(installEvent || installed) && (
        <button
          type="button"
          onClick={() => void install()}
          disabled={!installEvent}
          className="flex w-full items-center gap-3 rounded-2xl border border-orange-500/30 bg-gradient-to-br from-orange-500/15 to-orange-500/[0.03] p-4 text-left backdrop-blur-xl transition-opacity disabled:opacity-60"
        >
          <Download className="h-5 w-5 text-orange-400" />
          <span className="flex-1">
            <span className="block text-sm font-semibold">
              {installed
                ? "Приложение установлено"
                : "Установить на главный экран"}
            </span>
            <span className="mt-0.5 block text-[11px] text-zinc-500">
              {installed
                ? "Открывайте Loginex как обычное приложение телефона."
                : "Работает как отдельное приложение: без адресной строки, с офлайн-оболочкой."}
            </span>
          </span>
        </button>
      )}

      {isOwner && (
        <Link
          href="/owner"
          className="flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/15 to-amber-500/[0.03] p-3.5 backdrop-blur-xl transition-colors hover:from-amber-500/20"
        >
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25">
            <Crown className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-amber-300">
              Режим владельца
            </span>
            <span className="mt-0.5 block text-[11px] text-zinc-500">
              все организации платформы
            </span>
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-600" />
        </Link>
      )}

      <div className="space-y-2">
        {LINKS.filter((link) => link.href !== "/ati" || atiEnabled).map(
          (link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-3.5 backdrop-blur-xl transition-colors hover:bg-white/[0.07]"
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-400">
                <link.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{link.label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                  {link.hint}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-600" />
            </Link>
          ),
        )}
      </div>

      <button
        type="button"
        onClick={() => void signOut()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/25 bg-red-500/[0.07] p-3.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/[0.12]"
      >
        <LogOut className="h-4 w-4" />
        Выйти из аккаунта
      </button>

      <p className="pb-2 text-center text-[10px] text-zinc-600">
        Loginex · мобильный пульт · данные всегда из рабочей базы
      </p>
    </div>
  );
}
