// lib/assistant/briefing.ts — утренний брифинг «Что сегодня важно».
//
// Ассистент на своих данных: правила читают те же таблицы, что и экраны
// (заказы, оплаты, SOS, рейсы), и собирают один короткий дайджест вместо
// десятка страниц. Без внешних API — быстро, бесплатно, приватно.
//
// Каждый пункт: id, kind, severity, заголовок, сообщение и ссылка на экран,
// где проблема решается. UI (десктоп и мобильный пульт) только рендерит.

import { prisma } from "@/lib/prisma";
import type { AssistantActionId } from "./actions";
import { scopedWhere } from "@/lib/org";

export type BriefingSeverity = "danger" | "warn" | "info" | "good";

export interface BriefingItem {
  id: string;
  kind:
    | "negotiations"
    | "followups"
    | "overdue_payments"
    | "week_payments"
    | "sos"
    | "stalled_routes"
    | "yesterday";
  severity: BriefingSeverity;
  title: string;
  message: string;
  href: string;
  /**
   * Действие «в один клик» — виртуальный логист может выполнить рутину сам
   * (lib/assistant/actions.ts). Есть только у пунктов, где действие безопасно.
   */
  action?: { id: AssistantActionId; label: string };
}

const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

/** Закрытые статусы заказа (канон — lib/orders/stages.ts). */
const CLOSED = ["delivered", "cancelled", "rejected", "expired"];

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function daysSince(date: Date, now: Date): number {
  return Math.max(
    1,
    Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)),
  );
}

/** Собрать брифинг организации. Пустой массив = «всё спокойно». */
export async function buildBriefing(
  organizationId: string,
): Promise<BriefingItem[]> {
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const yesterdayStart = new Date(now);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  yesterdayStart.setHours(0, 0, 0, 0);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [
    negotiations,
    followups,
    overduePayments,
    weekPayments,
    sosCount,
    activeRoutes,
    deliveredYesterday,
  ] = await Promise.all([
    // 1. Согласования: сколько и сколько висит самый старый
    prisma.order.findMany({
      where: scopedWhere(organizationId, { status: "negotiation" }),
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "asc" },
      take: 200,
    }),
    // 2. Просроченные напоминания о контакте
    prisma.order.count({
      where: scopedWhere(organizationId, {
        nextFollowUpAt: { lte: now },
        status: { notIn: CLOSED },
      }),
    }),
    // 3. Просроченные оплаты (сумма)
    prisma.order.aggregate({
      where: scopedWhere(organizationId, {
        isPaid: false,
        dueDate: { lt: now },
        status: { notIn: ["cancelled", "rejected"] },
      }),
      _sum: { price: true },
      _count: { _all: true },
    }),
    // 4. Оплаты ближайшей недели
    prisma.order.aggregate({
      where: scopedWhere(organizationId, {
        isPaid: false,
        dueDate: { gte: now, lte: weekAhead },
        status: { notIn: ["cancelled", "rejected"] },
      }),
      _sum: { price: true },
      _count: { _all: true },
    }),
    // 5. Активные SOS
    prisma.sosAlert.count({
      where: scopedWhere(organizationId, { status: "active" }),
    }),
    // 6. Активные рейсы и их последние события — молчуны больше 2 часов
    prisma.route.findMany({
      where: scopedWhere(organizationId, {
        status: { in: ["active", "in_transit"] },
      }),
      select: {
        id: true,
        name: true,
        events: {
          select: { createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      take: 100,
    }),
    // 7. Вчера доставлено
    prisma.order.aggregate({
      where: scopedWhere(organizationId, {
        deliveredAt: { gte: yesterdayStart, lt: todayStart },
      }),
      _sum: { price: true },
      _count: { _all: true },
    }),
  ]);

  const items: BriefingItem[] = [];

  if (sosCount > 0) {
    items.push({
      id: "sos",
      kind: "sos",
      severity: "danger",
      title: `SOS: ${sosCount} ${plural(sosCount, ["сигнал", "сигнала", "сигналов"])}`,
      message: "Водителю нужна помощь — откройте карту и свяжитесь с ним.",
      href: "/dashboard",
    });
  }

  const overdueCount = overduePayments._count?._all ?? 0;
  if (overdueCount > 0) {
    const sum = overduePayments._sum?.price ?? 0;
    items.push({
      id: "overdue_payments",
      kind: "overdue_payments",
      severity: "danger",
      title: `Просрочено ${overdueCount} ${plural(overdueCount, ["оплата", "оплаты", "оплат"])}`,
      message: `Клиенты должны ${money.format(sum)} ₽ — напомните или остановите новые заказы.`,
      href: "/payments",
      action: { id: "remind_overdue", label: "Напомнить о просрочке" },
    });
  }

  if (negotiations.length > 0) {
    const oldestDays = daysSince(new Date(negotiations[0].updatedAt), now);
    items.push({
      id: "negotiations",
      kind: "negotiations",
      severity: "warn",
      title: `${negotiations.length} ${plural(negotiations.length, ["согласование ждёт", "согласования ждут", "согласований ждут"])}`,
      message:
        oldestDays >= 3
          ? `Самое старое висит ${oldestDays} дн. — предложите цену или закройте.`
          : "Решите цену, чтобы заказ уехал в рейс.",
      href: "/orders",
    });
  }

  if (followups > 0) {
    items.push({
      id: "followups",
      kind: "followups",
      severity: "warn",
      title: `Пора связаться: ${followups}`,
      message: "Напоминание о контакте просрочено — клиент ждёт ответа.",
      href: "/orders",
      action: { id: "snooze_followups", label: "Отложить на завтра" },
    });
  }

  const stalled = activeRoutes.filter(
    (route: any) =>
      !route.events?.[0]?.createdAt ||
      new Date(route.events[0].createdAt) < twoHoursAgo,
  );
  if (stalled.length > 0) {
    items.push({
      id: "stalled_routes",
      kind: "stalled_routes",
      severity: "warn",
      title: `${stalled.length} ${plural(stalled.length, ["рейс молчит", "рейса молчат", "рейсов молчат"])} больше 2 часов`,
      message: "От водителя давно не было отметок — напишите ему в чат.",
      href: "/routes",
    });
  }

  const weekCount = weekPayments._count?._all ?? 0;
  if (weekCount > 0) {
    const sum = weekPayments._sum?.price ?? 0;
    items.push({
      id: "week_payments",
      kind: "week_payments",
      severity: "info",
      title: `На неделе ждут ${money.format(sum)} ₽`,
      message: `${weekCount} ${plural(weekCount, ["оплата", "оплаты", "оплат"])} в ближайшие 7 дней — держите в голове.`,
      href: "/payments",
    });
  }

  const deliveredCount = deliveredYesterday._count?._all ?? 0;
  if (deliveredCount > 0) {
    const sum = deliveredYesterday._sum?.price ?? 0;
    items.push({
      id: "yesterday",
      kind: "yesterday",
      severity: "good",
      title: `Вчера доставлено ${deliveredCount}`,
      message: `На сумму ${money.format(sum)} ₽ — хорошая работа.`,
      href: "/reports",
    });
  }

  const order: Record<BriefingSeverity, number> = {
    danger: 0,
    warn: 1,
    info: 2,
    good: 3,
  };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}
