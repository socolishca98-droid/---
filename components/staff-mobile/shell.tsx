"use client";

// components/staff-mobile/shell.tsx
//
// Обёртка мобильного пульта логиста: держит сессию (без сотрудника пульт
// закрыт), нижнюю навигацию и регистрацию service worker. Водительскую
// сессию сюда не пускаем: у водителей свой контур /m.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { TruckLoader } from "@/components/ui/truck-loader";
import { BottomNav } from "@/components/staff-mobile/bottom-nav";
import { PwaRegister } from "@/components/pwa-register";

export function StaffMobileShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace("/login");
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <TruckLoader className="text-primary" label="Открываем пульт…" />
      </div>
    );
  }

  return (
    <>
      <div className="pb-28">{children}</div>
      <BottomNav />
      <PwaRegister />
    </>
  );
}
