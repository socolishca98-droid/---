// __tests__/isolation/push.test.ts
//
// Веб-пуш (VAPID): подписка устройств сотрудников и водителей, отписка
// только своих подписок, привязка к своей организации.
//
// Запуск: npm run test:isolation

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateVAPIDKeys } from "web-push";

import { memoryDb } from "../__mocks__/prisma-memory";
import {
  cid,
  jsonOf,
  makeRequest,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers";

import {
  DELETE as subscribeDelete,
  POST as subscribePost,
} from "@/app/api/push/subscribe/route";

// Реальные VAPID-ключи: web-push валидирует формат при первой настройке
beforeAll(() => {
  const keys = generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:test@loginex.local";
});

let world: World;
let cookieAdminA: string;
let cookieDriverA: string;

const sub = (slug: string) => ({
  subscription: {
    endpoint: `https://push.example/${cid(slug)}`,
    keys: { p256dh: "BP256dh".padEnd(87, "a"), auth: "auth-secret" },
  },
});

beforeEach(async () => {
  world = seedWorld();
  cookieAdminA = await sessionCookie({
    userId: world.adminA,
    role: "admin",
    kind: "staff",
  });
  cookieDriverA = await sessionCookie({
    userId: world.driverUserA,
    role: "driver",
    kind: "driver",
    driverId: world.driverA,
  });
});

describe("подписка на пуш (/api/push/subscribe)", () => {
  it("без сессии → 401", async () => {
    const response = await subscribePost(
      makeRequest("POST", "/api/push/subscribe", { body: sub("anon") }),
    );
    expect(response.status).toBe(401);
  });

  it("сотрудник подписывает устройство → строка с его организацией", async () => {
    const body = sub("staff-device");
    const response = await subscribePost(
      makeRequest("POST", "/api/push/subscribe", {
        cookie: cookieAdminA,
        body,
      }),
    );
    expect(response.status).toBe(200);
    expect((await jsonOf(response)).success).toBe(true);

    const row: any = memoryDb
      .rows("pushSubscription")
      .find((r: any) => r.endpoint === body.subscription.endpoint);
    expect(row).toBeTruthy();
    expect(row.organizationId).toBe(world.orgA);
    expect(row.userId).toBe(world.adminA);
  });

  it("водитель подписывает устройство → его организация и userId", async () => {
    const body = sub("driver-device");
    const response = await subscribePost(
      makeRequest("POST", "/api/push/subscribe", {
        cookie: cookieDriverA,
        body,
      }),
    );
    expect(response.status).toBe(200);

    const row: any = memoryDb
      .rows("pushSubscription")
      .find((r: any) => r.endpoint === body.subscription.endpoint);
    expect(row).toBeTruthy();
    expect(row.organizationId).toBe(world.orgA);
    expect(row.userId).toBe(world.driverUserA);
  });

  it("повторная подписка того же endpoint не плодит строки", async () => {
    const body = sub("same-device");
    await subscribePost(
      makeRequest("POST", "/api/push/subscribe", {
        cookie: cookieAdminA,
        body,
      }),
    );
    await subscribePost(
      makeRequest("POST", "/api/push/subscribe", {
        cookie: cookieAdminA,
        body,
      }),
    );
    const same = memoryDb
      .rows("pushSubscription")
      .filter((r: any) => r.endpoint === body.subscription.endpoint);
    expect(same.length).toBe(1);
  });

  it("отписка убирает только подписки водителя", async () => {
    const driverBody = sub("driver-device");
    const adminBody = sub("staff-device");
    await subscribePost(
      makeRequest("POST", "/api/push/subscribe", {
        cookie: cookieDriverA,
        body: driverBody,
      }),
    );
    await subscribePost(
      makeRequest("POST", "/api/push/subscribe", {
        cookie: cookieAdminA,
        body: adminBody,
      }),
    );

    const response = await subscribeDelete(
      makeRequest("DELETE", "/api/push/subscribe", {
        cookie: cookieDriverA,
        body: { endpoint: driverBody.subscription.endpoint },
      }),
    );
    expect(response.status).toBe(200);

    const rows = memoryDb.rows("pushSubscription");
    expect(
      rows.find((r: any) => r.endpoint === driverBody.subscription.endpoint),
    ).toBeFalsy();
    expect(
      rows.find((r: any) => r.endpoint === adminBody.subscription.endpoint),
    ).toBeTruthy();
  });
});
