"use client";

// app/planner/page.tsx
//
// Виртуальный логист: планировщик маршрута из базы заказов под свободную
// машину. Логика — lib/assistant/planner.ts, данные — GET /api/assistant/plan,
// создание рейса — POST /api/routes. Доступ: сотрудники (логист/админ).

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { PlannerView } from "@/components/assistant/planner-view";
import { useAuth } from "@/lib/auth-context";
import { useSidebar } from "@/lib/sidebar-context";

export default function PlannerPage() {
  const { user, isLoading } = useAuth();
  const { isCollapsed } = useSidebar();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.push("/");
    if (!isLoading && user?.role === "driver") router.push("/m");
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Загружаем планировщик…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className={`flex-1 ${isCollapsed ? "lg:ml-16" : "lg:ml-64"}`}>
        <Header />
        <main className="p-4 lg:p-6">
          <PlannerView />
        </main>
      </div>
    </div>
  );
}
