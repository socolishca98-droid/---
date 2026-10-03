// lib/assistant/actions.ts — «руки» виртуального логиста.
//
// Ассистент не только советует (lib/assistant/briefing.ts), но и сам
// выполняет рутинные действия в один клик. Каждое действие:
//   * безопасно: ничего не решает за человека (цену не назначает, заказы
//     не закрывает) — только рутина, которую логист и так сделал бы сам;
//   * идемпотентно в рамках дня: повторное напоминание не плодится;
//   * строго в границах организации: organizationId приходит из сессии.
//
// Действия:
//   remind_overdue   — напомнить логистам обо всех просроченных оплатах
//                      (те же уведомления payment_overdue, что и кнопка
//                      «Напомнить о просрочке» на /payments);
//   snooze_followups — перенести просроченные напоминания «связаться с
//                      клиентом» на завтра, 10:00: сегодня их уже не
//                      разобрать, а потерять нельзя.

import { prisma } from "@/lib/prisma";
import { scopedWhere } from "@/lib/org";
import {
  buildPaymentRow,
  isOverdueRow,
  overdueReminderText,
  type ReminderInfo,
} from "@/lib/payments/summary";

export const ASSISTANT_ACTIONS = [
  "remind_overdue",
  "snooze_followups",
] as const;

export type AssistantActionId = (typeof ASSISTANT_ACTIONS)[number];

export function isAssistantAction(value: unknown): value is AssistantActionId {
  return (
    typeof value === "string" &&
    (ASSISTANT_ACTIONS as readonly string[]).includes(value)
  );
}

export type AssistantActionResult = {
  action: AssistantActionId;
  /** Сколько сущностей затронуло действие. */
  affected: number;
  /** Сколько пропущено (например, уже напоминали сегодня). */
  skipped: number;
  /** Итог человеческим языком — его показывает тост. */
  message: string;
};

/** Закрытые статусы заказа (канон — lib/orders/stages.ts). */
const CLOSED = ["delivered", "cancelled", "rejected", "expired"];

const REMINDER_TYPE = "payment_overdue";

/** Те же поля заказа, что нужны buildPaymentRow. */
const ORDER_SELECT = {
  id: true,
  clientId: true,
  clientName: true,
  clientContact: true,
  routeFrom: true,
  routeTo: true,
  distance: true,
  cargoType: true,
  status: true,
  createdAt: true,
  deadline: true,
  deliveredAt: true,
  price: true,
  agreedPrice: true,
  paymentType: true,
  vatType: true,
  deferredDays: true,
  dueDate: true,
  isPaid: true,
  paidAt: true,
  client: { select: { id: true, name: true, inn: true } },
} as const;

type OrderRow = Parameters<typeof buildPaymentRow>[0];

/** Напоминания, уже отправленные по заказам (тип payment_overdue). */
async function loadReminders(
  organizationId: string,
): Promise<Map<string, ReminderInfo>> {
  const notifications = (await prisma.notification.findMany({
    where: scopedWhere(organizationId, { type: REMINDER_TYPE }),
    select: { orderId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  })) as { orderId: string | null; createdAt: Date }[];

  const map = new Map<string, ReminderInfo>();
  for (const notification of notifications) {
    if (!notification.orderId) continue;
    const current = map.get(notification.orderId);
    if (!current) {
      map.set(notification.orderId, {
        lastAt: notification.createdAt,
        count: 1,
      });
      continue;
    }
    current.count += 1;
    if (notification.createdAt > (current.lastAt ?? new Date(0))) {
      current.lastAt = notification.createdAt;
    }
  }
  return map;
}

/** Напомнить обо всех просроченных оплатах (повтор в тот же день не плодится). */
async function remindOverdue(
  organizationId: string,
  now: Date,
): Promise<AssistantActionResult> {
  const orders = (await prisma.order.findMany({
    where: scopedWhere(organizationId, { isPaid: false }),
    select: ORDER_SELECT,
  })) as OrderRow[];

  const reminders = await loadReminders(organizationId);
  const overdueRows = orders
    .map((order) => buildPaymentRow(order, now, reminders.get(order.id)))
    .filter((row) => isOverdueRow(row));

  let affected = 0;
  let skipped = 0;
  let total = 0;

  for (const row of overdueRows) {
    const remindedToday =
      row.remindedAt !== null &&
      row.remindedAt.toDateString() === now.toDateString();
    if (remindedToday) {
      skipped += 1;
      continue;
    }

    const { title, message } = overdueReminderText(row);
    await prisma.notification.create({
      data: {
        organizationId,
        userId: "all_logists",
        userRole: "logist",
        type: REMINDER_TYPE,
        title,
        message,
        orderId: row.id,
        priority: row.overdueDays >= 7 ? "high" : "normal",
      },
    });

    affected += 1;
    total += row.amount;
  }

  return {
    action: "remind_overdue",
    affected,
    skipped,
    message:
      affected > 0
        ? `Напоминаний отправлено: ${affected} на сумму ${total.toLocaleString("ru-RU")} ₽`
        : overdueRows.length > 0
          ? "Сегодня по просроченным уже напоминали"
          : "Просроченных оплат нет — напоминать не о чем",
  };
}

/** Перенести просроченные «связаться с клиентом» на завтра, 10:00. */
async function snoozeFollowups(
  organizationId: string,
  now: Date,
): Promise<AssistantActionResult> {
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setHours(10, 0, 0, 0);

  const result = await prisma.order.updateMany({
    where: scopedWhere(organizationId, {
      nextFollowUpAt: { lte: now },
      status: { notIn: CLOSED },
    }),
    data: { nextFollowUpAt: target },
  });

  const affected = result.count;
  return {
    action: "snooze_followups",
    affected,
    skipped: 0,
    message:
      affected > 0
        ? `Перенесено на завтра, 10:00: ${affected}`
        : "Просроченных напоминаний нет",
  };
}

/** Выполнить действие ассистента в границах организации. */
export async function runAssistantAction(
  organizationId: string,
  action: AssistantActionId,
  now: Date = new Date(),
): Promise<AssistantActionResult> {
  switch (action) {
    case "remind_overdue":
      return remindOverdue(organizationId, now);
    case "snooze_followups":
      return snoozeFollowups(organizationId, now);
  }
}
