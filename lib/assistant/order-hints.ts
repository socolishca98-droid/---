// lib/assistant/order-hints.ts — подсказки ассистента внутри карточки заказа.
//
// Правила читают данные своей организации: сколько заказ висит в переговорах,
// как цена выглядит на фоне среднего по этому направлению, не должен ли клиент
// просрочку. Подсказки — не блокировка: решение всегда за логистом.

import { prisma } from "@/lib/prisma";
import { scopedWhere } from "@/lib/org";

export interface OrderHint {
  kind: "stalled" | "followup" | "below_market" | "client_debt";
  severity: "danger" | "warn" | "info";
  text: string;
}

const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

interface HintOrderRow {
  id: string;
  status: string;
  routeFrom: string;
  routeTo: string;
  price: number | null;
  agreedPrice?: number | null;
  clientId?: string | null;
  clientName?: string | null;
  nextFollowUpAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

const CLOSED = ["delivered", "cancelled", "rejected", "expired"];

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Собрать подсказки для заказа (все запросы — в рамках организации). */
export async function orderHints(
  organizationId: string,
  order: HintOrderRow,
): Promise<OrderHint[]> {
  const hints: OrderHint[] = [];
  const now = new Date();

  // 1. Переговоры висят больше трёх дней
  if (order.status === "negotiation") {
    const anchor = toDate(order.updatedAt) ?? toDate(order.createdAt);
    if (anchor) {
      const days = Math.floor(
        (now.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (days >= 3) {
        hints.push({
          kind: "stalled",
          severity: "warn",
          text: `Переговоры висят ${days} дн. Предложите встречную цену или закройте заказ — клиент ждёт.`,
        });
      }
    }
  }

  // 2. Просроченное напоминание о контакте
  const followUp = toDate(order.nextFollowUpAt);
  if (followUp && followUp < now && !CLOSED.includes(order.status)) {
    hints.push({
      kind: "followup",
      severity: "info",
      text: "Напоминание о контакте просрочено — стоит позвонить или написать клиенту.",
    });
  }

  // 3. Цена ниже средней по этому направлению (по доставленным заказам)
  const effectivePrice = order.agreedPrice ?? order.price ?? 0;
  if (effectivePrice > 0 && !CLOSED.includes(order.status)) {
    const routeOrders = await prisma.order.findMany({
      where: scopedWhere(organizationId, {
        routeFrom: order.routeFrom,
        routeTo: order.routeTo,
        status: "delivered",
        price: { gt: 0 },
      }),
      select: { price: true },
      take: 50,
    });
    if (routeOrders.length >= 3) {
      const avg =
        routeOrders.reduce(
          (sum: number, row: any) => sum + (Number(row.price) || 0),
          0,
        ) / routeOrders.length;
      if (avg > 0 && effectivePrice < avg * 0.92) {
        const below = Math.round(((avg - effectivePrice) / avg) * 100);
        hints.push({
          kind: "below_market",
          severity: "warn",
          text: `Цена на ${below}% ниже средней по этому направлению (${money.format(avg)} ₽ по ${routeOrders.length} доставленным заказам).`,
        });
      }
    }
  }

  // 4. Просроченный долг клиента (по другим заказам)
  if (order.clientId || order.clientName) {
    const debt = await prisma.order.aggregate({
      where: scopedWhere(organizationId, {
        ...(order.clientId
          ? { clientId: order.clientId }
          : { clientName: order.clientName }),
        id: { not: order.id },
        isPaid: false,
        dueDate: { lt: now },
        status: { notIn: ["cancelled", "rejected"] },
      }),
      _sum: { price: true },
      _count: { _all: true },
    });
    const debtCount = debt._count?._all ?? 0;
    const debtSum = debt._sum?.price ?? 0;
    if (debtCount > 0 && debtSum > 0) {
      hints.push({
        kind: "client_debt",
        severity: "danger",
        text: `У клиента просроченный долг ${money.format(debtSum)} ₽ (${debtCount}). Прежде чем брать новый заказ — напомните об оплате.`,
      });
    }
  }

  return hints;
}
