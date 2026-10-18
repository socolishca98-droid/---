// lib/notifications/create.ts
//
// Единая точка создания уведомлений + доставка пуша.
//
// Зачем: уведомления создавались в одиннадцати местах копипастой
// `prisma.notification.create(...)`. Из-за этого пуши пришлось бы вносить в
// каждый вызов — и обязательно забыли бы в одном. Теперь запись и доставка
// идут вместе, а забыть нельзя.
//
// Важное правило: пуш НИКОГДА не ломает основное действие. Если уведомление
// создано, а пуш не ушёл (нет ключей, сеть отвалилась, подписка битая) —
// действие всё равно успешно. Провалы видны в логе, но не пользователю.

import { prisma } from "@/lib/prisma"
import { deliverPushSafely, type PushMessage } from "@/lib/push/send"

/**
 * Служебные адреса уведомлений: запись видна всей роли, а не одному человеку
 * (SOS должен увидеть каждый логист на смене). Правила те же, что в
 * GET /api/notifications — иначе пуш и список разойдутся.
 */
const ROLE_ADDRESSES = ["logist", "all_logists", "admin", "all_admins", "staff", "all_staff"]

export type NotificationInput = {
  organizationId?: string | null
  userId: string
  userRole: string
  type: string
  title: string
  message: string
  driverId?: string | null
  orderId?: string | null
  photoId?: string | null
  sosId?: string | null
  routeId?: string | null
  priority?: string
}

/** Клиент Prisma, которым пользуется создание — для транзакций и тестов. */
export type NotifyClient = Pick<typeof prisma, "notification">

/**
 * Текст пуша по уведомлению. Заголовок берём из уведомления, а тело
 * обрезаем: в системном уведомлении длинный текст просто не влезет.
 */
export function pushMessageFor(notification: NotificationInput, url = "/notifications"): PushMessage {
  const body = notification.message.length > 140
    ? `${notification.message.slice(0, 139)}…`
    : notification.message

  return {
    title: notification.title,
    body,
    url,
    // Одинаковый tag для одной темы: новые уведомления заменяют старые
    // в шторке, а не выстраиваются стопкой.
    tag: notification.routeId ? `route-${notification.routeId}` : notification.type,
    // critical (SOS) тоже срочный: такое уведомление должно вылезти сразу
    urgency: notification.priority === "high" || notification.priority === "critical" ? "high" : "normal",
    data: {
      type: notification.type,
      routeId: notification.routeId ?? null,
      orderId: notification.orderId ?? null,
      sosId: notification.sosId ?? null,
    },
  }
}

/** Куда ведёт клик по пушу — по типу события. */
export function pushUrlFor(notification: NotificationInput): string {
  if (notification.sosId) return "/sos"
  if (notification.routeId) return "/routes"
  if (notification.photoId) return "/photos"
  if (notification.orderId) return "/orders"
  return "/notifications"
}

/**
 * Кому слать пуш. Если уведомление адресовано роли («all_logists»), получатели —
 * все сотрудники этой организации: иначе пуши об SOS не получил бы никто,
 * потому что userId в записи — не настоящий.
 */
async function pushRecipients(input: NotificationInput): Promise<string[]> {
  if (!ROLE_ADDRESSES.includes(input.userId)) return [input.userId]
  if (!input.organizationId) return []

  const staff = await prisma.user.findMany({
    where: { organizationId: input.organizationId, role: { in: ["admin", "logist", "staff"] } },
    select: { id: true },
  })
  return staff.map((user) => user.id)
}

/**
 * Создаёт уведомление и отправляет пуш его получателю.
 * Возвращает созданную запись — как раньше возвращал прямой create.
 */
export async function createNotification(
  client: NotifyClient,
  input: NotificationInput,
  options: { push?: boolean; pushEnv?: NodeJS.ProcessEnv } = {},
): Promise<{ id: string }> {
  const notification = await client.notification.create({
    data: {
      organizationId: input.organizationId ?? null,
      userId: input.userId,
      userRole: input.userRole,
      type: input.type,
      title: input.title,
      message: input.message,
      driverId: input.driverId ?? null,
      orderId: input.orderId ?? null,
      photoId: input.photoId ?? null,
      sosId: input.sosId ?? null,
      routeId: input.routeId ?? null,
      priority: input.priority ?? "normal",
    },
    select: { id: true },
  })

  if (options.push !== false) {
    const message = pushMessageFor(input, pushUrlFor(input))
    const recipients = await pushRecipients(input)
    // Ждём доставку, но ошибки внутри глотаются: пуш не должен ронять действие
    await Promise.all(
      recipients.map((userId) => deliverPushSafely(userId, message, options.pushEnv)),
    )
  }

  return notification
}

/**
 * Доставка пуша для уже созданного уведомления.
 *
 * Нужна отдельно от createNotification, потому что часть уведомлений
 * создаётся внутри $transaction, а слать пуш из открытой транзакции нельзя:
 * в SQLite открытая запись блокирует других, и доставка встала бы колом.
 * Поэтому внутри транзакции создаём запись, а пуш отправляем после коммита.
 */
export async function deliverNotificationPush(
  input: NotificationInput,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  const message = pushMessageFor(input, pushUrlFor(input))
  const recipients = await pushRecipients(input)
  await Promise.all(recipients.map((userId) => deliverPushSafely(userId, message, env)))
}

/**
 * Тот же помощник без клиента — для вызовов вне транзакций.
 * Большинство мест создают уведомление напрямую, а не внутри $transaction.
 */
export async function notify(input: NotificationInput): Promise<{ id: string }> {
  return createNotification(prisma, input)
}
