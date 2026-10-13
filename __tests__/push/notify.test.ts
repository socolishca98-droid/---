// __tests__/push/notify.test.ts
//
// Связка «уведомление → пуш». Здесь проверяется обещание, из-за которого
// helper вообще появился: пуш НИКОГДА не ломает основное действие. Если
// ключей нет, сеть отвалилась или подписка битая — уведомление всё равно
// создано, а пользователь не видит ошибку.
//
// До появления помощника уведомления создавались копипастой в 11 местах, и
// пуши пришлось бы вносить в каждое — с гарантией забыв одно.

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createNotification,
  deliverNotificationPush,
  notify,
  pushMessageFor,
  pushUrlFor,
} from "@/lib/notifications/create"

type FakePushMessage = { title: string; body?: string; url?: string; urgency?: string }

const { deliverPushSafelyMock } = vi.hoisted(() => ({
  // Тип аргументов задаём явно: иначе mock.calls окажется пустым кортежем и
  // проверки «кому и что ушло» не скомпилируются.
  deliverPushSafelyMock: vi.fn(
    async (_userId: string, _message: FakePushMessage) => ({
      sent: 1,
      gone: 0,
      failed: 0,
      errors: [] as string[],
    }),
  ),
}))

vi.mock("@/lib/push/send", () => ({
  deliverPushSafely: deliverPushSafelyMock,
}))

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    notification: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "notification-1",
        ...data,
      })),
    },
    user: {
      findMany: vi.fn(async () => [{ id: "logist-1" }, { id: "admin-1" }]),
    },
    pushSubscription: { findMany: vi.fn(async () => []) },
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

// Заглушка клиента намеренно узкая: помощнику нужен только notification.create,
// а Prisma-тип требует весь делегат. Приводим явно, чтобы тест не зависел от
// полного набора методов.
const client = prismaMock as unknown as Parameters<typeof createNotification>[0]

const baseNotification = {
  userId: "driver-1",
  userRole: "driver",
  type: "route_assigned",
  title: "Назначен рейс",
  message: "Вам назначен рейс «Москва — Тула»: 3 точек.",
  driverId: "driver-1",
  routeId: "route-1",
  priority: "high",
}

beforeEach(() => {
  deliverPushSafelyMock.mockClear()
  prismaMock.notification.create.mockClear()
  prismaMock.user.findMany.mockClear()
})

describe("createNotification", () => {
  it("создаёт запись и отправляет пуш получателю", async () => {
    await createNotification(client, baseNotification)

    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1)
    expect(deliverPushSafelyMock).toHaveBeenCalledTimes(1)
    const [userId, message] = deliverPushSafelyMock.mock.calls[0]
    expect(userId).toBe("driver-1")
    expect(message.title).toBe("Назначен рейс")
    expect(message.url).toBe("/routes")
    expect(message.urgency).toBe("high")
  })

  it("уведомлению можно выключить пуш (внутри транзакции)", async () => {
    await createNotification(client, baseNotification, { push: false })

    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1)
    expect(deliverPushSafelyMock).not.toHaveBeenCalled()
  })

  it("проброс исключения из prisma не глотается", async () => {
    prismaMock.notification.create.mockRejectedValueOnce(new Error("база легла"))

    await expect(createNotification(client, baseNotification)).rejects.toThrow("база легла")
    // Пуш не отправляем, если запись не создалась
    expect(deliverPushSafelyMock).not.toHaveBeenCalled()
  })

  it("уведомление роли рассылается всем сотрудникам организации", async () => {
    await createNotification(client, {
      ...baseNotification,
      organizationId: "org-1",
      userId: "all_logists",
      userRole: "logist",
      type: "sos_alert",
    })

    // В БД по-прежнему одна запись с служебным адресом — так её видят все
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1)
    // А пуш уходит каждому логисту и админу
    expect(deliverPushSafelyMock).toHaveBeenCalledTimes(2)
    expect(deliverPushSafelyMock.mock.calls.map(([userId]) => userId)).toEqual([
      "logist-1",
      "admin-1",
    ])
  })

  it("notify работает без явного клиента", async () => {
    await notify(baseNotification)
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1)
  })
})

describe("deliverNotificationPush", () => {
  it("отправляет пуш уже созданного уведомления", async () => {
    await deliverNotificationPush(baseNotification)
    expect(deliverPushSafelyMock).toHaveBeenCalledTimes(1)
    // Запись при этом не создаётся — это делала транзакция
    expect(prismaMock.notification.create).not.toHaveBeenCalled()
  })
})

describe("pushMessageFor", () => {
  it("длинный текст обрезается — в шторке браузера он не влезет", () => {
    const long = "я".repeat(300)
    const message = pushMessageFor({ ...baseNotification, message: long })
    expect(message.body).toHaveLength(140) // 139 символов + многоточие
    expect(message.body?.endsWith("…")).toBe(true)
  })

  it("критичный приоритет даёт срочную доставку", () => {
    expect(pushMessageFor({ ...baseNotification, priority: "critical" }).urgency).toBe("high")
    expect(pushMessageFor({ ...baseNotification, priority: "normal" }).urgency).toBe("normal")
  })

  it("одинаковые уведомления об одном рейсе группируются в шторке", () => {
    const first = pushMessageFor(baseNotification)
    const second = pushMessageFor({ ...baseNotification, message: "Другое сообщение" })
    expect(first.tag).toBe(second.tag)
  })
})

describe("pushUrlFor", () => {
  it("ведёт на экран, соответствующий событию", () => {
    // Базовое уведомление привязано к рейсу — для остальных случаев убираем его
    const withoutRoute = { ...baseNotification, routeId: null }
    expect(pushUrlFor({ ...withoutRoute, sosId: "sos-1" })).toBe("/sos")
    expect(pushUrlFor(baseNotification)).toBe("/routes")
    expect(pushUrlFor({ ...withoutRoute, photoId: "p-1" })).toBe("/photos")
    expect(pushUrlFor({ ...withoutRoute, orderId: "o-1" })).toBe("/orders")
    expect(pushUrlFor(withoutRoute)).toBe("/notifications")
  })
})
