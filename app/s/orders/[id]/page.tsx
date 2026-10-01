"use client";

// app/s/orders/[id]/page.tsx
//
// Полная карточка заказа в мобильном пульте. Внутри — тот же процессный
// компонент, что на десктопе: этапы, торг, лента событий и быстрые действия.
// Ничего не дублируем: один источник правды о заказе.

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { OrderProcess } from "@/components/orders/order-process";

export default function StaffMobileOrderDetail() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id;

  if (!orderId) return null;

  return (
    <div className="space-y-3 px-4 pt-6">
      <Link
        href="/s/orders"
        className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <ChevronLeft className="h-3.5 w-3.5" />к списку заказов
      </Link>
      <OrderProcess orderId={orderId} compact />
    </div>
  );
}
