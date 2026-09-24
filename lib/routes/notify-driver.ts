// lib/routes/notify-driver.ts
//
// Передача рейса водителю в мобильное приложение (задача 3, пункт 3).
//
// Раньше назначение водителя на рейс нигде не сообщалось: запись в базе
// менялась, а водитель узнавал о рейсе только если логист звонил ему. Теперь
// при назначении (и при переназначении) водителю создаётся уведомление в его
// учётной записи — мобильное приложение забирает его из
// GET /api/m/notifications и показывает в разделе «Уведомления».

type Tx = {
  user: {
    findFirst: (args: unknown) => Promise<{ id: string; name: string | null } | null>
  }
  notification: {
    create: (args: unknown) => Promise<unknown>
  }
}

export type NotifyDriverParams = {
  organizationId: string
  driverId: string
  routeId: string
  /** Название рейса, если задано логистом. */
  routeName?: string | null
  /** Сколько точек в рейсе — попадает в текст уведомления. */
  ordersCount?: number
  /** Кто назначил: имя или email сотрудника. */
  actorName?: string | null
}

/**
 * Уведомление водителю о назначенном рейсе.
 *
 * Если у водителя нет учётной записи (такой водитель не пользуется
 * приложением), уведомление не создаётся — придумывать получателя нельзя.
 * Возвращает true, если уведомление создано.
 */
export async function notifyDriverRouteAssigned(tx: Tx, params: NotifyDriverParams): Promise<boolean> {
  const { organizationId, driverId, routeId, routeName, ordersCount, actorName } = params

  const account = await tx.user.findFirst({
    where: { organizationId, driverId },
    select: { id: true, name: true },
  })

  if (!account) return false

  const title = "Назначен рейс"
  const points = typeof ordersCount === "number" && ordersCount > 0 ? `${ordersCount} точек` : "рейс"
  const name = routeName?.trim() ? `«${routeName.trim()}»` : "без названия"
  const message = actorName
    ? `Вам назначен рейс ${name}: ${points}. Назначил: ${actorName}.`
    : `Вам назначен рейс ${name}: ${points}.`

  await tx.notification.create({
    data: {
      organizationId,
      userId: account.id,
      userRole: "driver",
      type: "route_assigned",
      title,
      message,
      driverId,
      routeId,
      priority: "high",
    },
  })

  return true
}
