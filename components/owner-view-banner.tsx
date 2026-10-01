"use client";

// components/owner-view-banner.tsx
//
// Баннер «Режим владельца»: виден на всех экранах, пока владелец находится
// внутри чужой организации (cookie ставит /api/owner/impersonate). Кнопка
// «Выйти» отзывает сессию организации и возвращает в свой аккаунт.

import { useEffect, useState } from "react";
import { Crown, LogOut } from "lucide-react";

import { OWNER_VIEW_COOKIE } from "@/lib/auth/constants";

function readViewCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${OWNER_VIEW_COOKIE}=([^;]*)`),
  );
  if (!match || !match[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function OwnerViewBanner() {
  const [orgName, setOrgName] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    setOrgName(readViewCookie());
    const onFocus = () => setOrgName(readViewCookie());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  if (!orgName) return null;

  const exit = async () => {
    setExiting(true);
    try {
      const res = await fetch("/api/owner/exit", { method: "POST" });
      if (res.ok) {
        window.location.href = "/owner";
        return;
      }
    } catch {
      // соединение могло пропасть — останемся на месте
    }
    setExiting(false);
  };

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 border-b border-amber-500/30 bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-amber-500/20 px-4 py-2 backdrop-blur-xl">
      <Crown className="h-4 w-4 flex-shrink-0 text-amber-400" />
      <p className="min-w-0 truncate text-xs text-amber-200">
        Режим владельца — вы внутри «{orgName}». Действия пишутся в журнал
        организации.
      </p>
      <button
        type="button"
        onClick={() => void exit()}
        disabled={exiting}
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
      >
        <LogOut className="h-3 w-3" />
        {exiting ? "Выходим…" : "Выйти"}
      </button>
    </div>
  );
}
