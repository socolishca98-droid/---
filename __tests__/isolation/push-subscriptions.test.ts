// __tests__/isolation/push-subscriptions.test.ts
//
// Web Push end-to-end: подписка, отписка и — главное — изоляция между
// организациями.
//
// Что проверяем:
//   1. подписка сохраняется под тем пользователем, чья сессия, а не под тем,
//      кого указали в теле (иначе можно подписать чужие устройства на свои пуши);
//   2. один и тот же endpoint повторно не плодит записи;
//   3. чужую подписку не видно и не удаляется;
//   4. без VAPID-ключей на сервере пуши выключены честно (503), а не «тихо».
//
// Запуск: npm run test:isolation

import { beforeEach, beforeAll, describe, expect, it } from "vitest"

import { GET as pushGet, POST as pushPost, DELETE as pushDelete } from "@/app/api/push/route"
import { generateVapidKeyPair } from "@/lib/push/keys"

import { jsonOf, makeRequest, seedWorld, sessionCookie, type World } from "./helpers"
import { memoryDb } from "../__mocks__/prisma-memory"

let world: World

/** Пара ключей «браузера» — как их отдаёт pushManager.subscribe(). */
function browserKeys() {
  const raw = Buffer.from("0123456789abcdef0123456789abcdef", "utf8")
  return {
    p256dh: raw.toString("base64url"),
    auth: Buffer.from("abcdefghijklmnop", "utf8").toString("base64url"),
  }
}

function subscriptionBody(endpoint: string) {
  return { endpoint, keys: browserKeys(), userAgent: "Mozilla/5.0 (iPhone)" }
}

let cookieAdminA: string
let cookieDriverA: string

// Ключи задаём до запросов: без них роут честно отвечает 503 «пуши выключены».
// Настоящая пара нужна и для реалистичности — подписка идёт через тот же путь.
beforeAll(() => {
  const pair = generateVapidKeyPair()
  process.env.VAPID_PUBLIC_KEY = pair.publicKey
  process.env.VAPID_PRIVATE_KEY = pair.privateKey
})

beforeEach(async () => {
  world = seedWorld()
  cookieAdminA = await sessionCookie({
    userId: world.adminA,
    role: "admin",
    kind: "staff",
  })
  cookieDriverA = await sessionCookie({
    userId: world.driverUserA,
    role: "driver",
    kind: "driver",
    driverId: world.driverA,
  })
})

describe("подписка на пуши", () => {
  it("сохраняется под пользователем из сессии", async () => {
    const keys = browserKeys()
    const response = await pushPost(
      makeRequest("POST", "/api/push", {
        cookie: cookieAdminA,
        body: subscriptionBody("https://fcm.googleapis.com/fcm/send/device-a"),
      }),
    )

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.success).toBe(true)

    const rows = memoryDb.rows("pushSubscription")
    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe(world.adminA)
    expect(rows[0].p256dh).toBe(keys.p256dh)
  })

  it("повторная подписка с того же устройства не плодит записи", async () => {
    const cookie = cookieAdminA
    const endpoint = "https://fcm.googleapis.com/fcm/send/device-a"

    await pushPost(makeRequest("POST", "/api/push", { cookie, body: subscriptionBody(endpoint) }))
    const second = await pushPost(makeRequest("POST", "/api/push", { cookie, body: subscriptionBody(endpoint) }))

    expect(second.status).toBe(200)
    expect(memoryDb.rows("pushSubscription")).toHaveLength(1)
  })

  it("битая подписка отклоняется с 400, а не молча", async () => {
    const response = await pushPost(
      makeRequest("POST", "/api/push", {
        cookie: cookieAdminA,
        body: { endpoint: "не адрес", keys: { p256dh: "x", auth: "y" } },
      }),
    )

    expect(response.status).toBe(400)
    expect(memoryDb.rows("pushSubscription")).toHaveLength(0)
  })

  it("без ключей на сервере подписка не включается (503), а не «тихо»", async () => {
    const saved = {
      public: process.env.VAPID_PUBLIC_KEY,
      private: process.env.VAPID_PRIVATE_KEY,
    }
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY

    try {
      const response = await pushPost(
        makeRequest("POST", "/api/push", {
          cookie: cookieAdminA,
          body: subscriptionBody("https://fcm.send/no-keys"),
        }),
      )
      expect(response.status).toBe(503)
      expect(memoryDb.rows("pushSubscription")).toHaveLength(0)

      const statusResponse = await pushGet(
        makeRequest("GET", "/api/push", { cookie: cookieAdminA }),
      )
      const status = await jsonOf(statusResponse)
      expect(status.enabled).toBe(false)
    } finally {
      process.env.VAPID_PUBLIC_KEY = saved.public
      process.env.VAPID_PRIVATE_KEY = saved.private
    }
  })

  it("без авторизации подписаться нельзя", async () => {
    const response = await pushPost(
      makeRequest("POST", "/api/push", { body: subscriptionBody("https://fcm.send/x") }),
    )
    expect(response.status).toBe(401)
  })
})

describe("список устройств", () => {
  it("показывает только свои подписки", async () => {
    await memoryDb.insert("pushSubscription", {
      id: "sub-own",
      userId: world.adminA,
      endpoint: "https://fcm.send/own",
      p256dh: "k",
      auth: "a",
      createdAt: new Date(),
    })
    await memoryDb.insert("pushSubscription", {
      id: "sub-foreign",
      userId: world.adminB,
      endpoint: "https://fcm.send/foreign",
      p256dh: "k",
      auth: "a",
      createdAt: new Date(),
    })

    const response = await pushGet(
      makeRequest("GET", "/api/push", {
        cookie: cookieAdminA,
      }),
    )

    const payload = await jsonOf(response)
    expect(payload.subscriptions).toHaveLength(1)
    expect(payload.subscriptions[0].id).toBe("sub-own")
    expect(JSON.stringify(payload)).not.toContain("sub-foreign")
  })

  it("водитель подписывается со своей сессией", async () => {
    const response = await pushGet(
      makeRequest("GET", "/api/push", {
        cookie: cookieDriverA,
      }),
    )

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.success).toBe(true)
  })
})

describe("отписка", () => {
  it("удаляет только свою подписку", async () => {
    await memoryDb.insert("pushSubscription", {
      id: "sub-own",
      userId: world.adminA,
      endpoint: "https://fcm.send/own",
      p256dh: "k",
      auth: "a",
      createdAt: new Date(),
    })
    await memoryDb.insert("pushSubscription", {
      id: "sub-foreign",
      userId: world.adminB,
      endpoint: "https://fcm.send/foreign",
      p256dh: "k",
      auth: "a",
      createdAt: new Date(),
    })

    // Пытаемся отписать чужое устройство, зная его endpoint
    const response = await pushDelete(
      makeRequest("DELETE", "/api/push", {
        cookie: cookieAdminA,
        body: { endpoint: "https://fcm.send/foreign" },
      }),
    )

    const payload = await jsonOf(response)
    expect(payload.removed).toBe(0)
    expect(memoryDb.rows("pushSubscription").map((row) => row.id).sort()).toEqual([
      "sub-foreign",
      "sub-own",
    ])
  })

  it("своё устройство отписывается", async () => {
    await memoryDb.insert("pushSubscription", {
      id: "sub-own",
      userId: world.adminA,
      endpoint: "https://fcm.send/own",
      p256dh: "k",
      auth: "a",
      createdAt: new Date(),
    })

    const response = await pushDelete(
      makeRequest("DELETE", "/api/push", {
        cookie: cookieAdminA,
        body: { endpoint: "https://fcm.send/own" },
      }),
    )

    expect((await jsonOf(response)).removed).toBe(1)
    expect(memoryDb.rows("pushSubscription")).toHaveLength(0)
  })
})
