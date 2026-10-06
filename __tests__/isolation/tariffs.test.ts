// __tests__/isolation/tariffs.test.ts
//
// Тарифы организации: пробный период, смена плана администратором и лимит
// машин при создании (POST /api/vehicles → 409 plan_limit). План хранится
// в OrganizationSettings.plan, действующий план считает resolvePlan
// (lib/billing/plans.ts); GET /api/org-settings отдаёт блок billing.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest";

import { afterEach } from "vitest";

import { memoryDb } from "../__mocks__/prisma-memory";
import {
  cid,
  expectNoForeignIds,
  jsonOf,
  makeRequest,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers";

import {
  GET as settingsGet,
  POST as settingsPost,
} from "@/app/api/org-settings/route";
import { POST as vehiclesPost } from "@/app/api/vehicles/route";

let world: World;
let cookieAdminA: string;

/** Почта владельца платформы: совпадает с PLATFORM_OWNER_EMAIL в тестах. */
const OWNER_EMAIL = "owner@loginex.test";

// Режим владельца включается переменной окружения — после каждого теста её
// надо снимать, иначе соседние проверки поедут на включённом режиме
afterEach(() => {
  delete process.env.PLATFORM_OWNER_EMAIL;
  delete process.env.BILLING_CONTACT_EMAIL;
});

/** Сессия владельца платформы: администратор с почтой из PLATFORM_OWNER_EMAIL. */
async function platformOwnerCookie() {
  const ownerId = cid("owneruser");
  memoryDb.insert("user", {
    id: ownerId,
    organizationId: world.orgA,
    name: "Владелец",
    email: OWNER_EMAIL,
    passwordHash: "x",
    passwordSalt: "x",
    role: "admin",
    status: "active",
  });
  return sessionCookie({ userId: ownerId, role: "admin", kind: "staff" });
}
let cookieLogistA: string;
let cookieAdminB: string;

async function getSettings(cookie: string) {
  const response = await settingsGet(
    makeRequest("GET", "/api/org-settings", { cookie }),
  );
  return { status: response.status, payload: await jsonOf(response) };
}

async function postSettings(cookie: string, body: unknown) {
  const response = await settingsPost(
    makeRequest("POST", "/api/org-settings", { cookie, body }),
  );
  return { status: response.status, payload: await jsonOf(response) };
}

async function createVehicle(cookie: string, plate: string) {
  const response = await vehiclesPost(
    makeRequest("POST", "/api/vehicles", {
      cookie,
      body: { plate, type: "truck", capacity: 5000 },
    }),
  );
  return { status: response.status, payload: await jsonOf(response) };
}

beforeEach(async () => {
  world = seedWorld();
  cookieAdminA = await sessionCookie({
    userId: world.adminA,
    role: "admin",
    kind: "staff",
  });
  cookieLogistA = await sessionCookie({
    userId: world.logistA,
    role: "logist",
    kind: "staff",
  });
  cookieAdminB = await sessionCookie({
    userId: world.adminB,
    role: "admin",
    kind: "staff",
  });
});

describe("тарифы: текущий план", () => {
  it("новая организация — пробный период без лимита машин", async () => {
    const { status, payload } = await getSettings(cookieAdminA);
    expect(status).toBe(200);
    expect(payload.success).toBe(true);
    expectNoForeignIds(payload, world);

    expect(payload.billing.plan).toBe("trial");
    expect(payload.billing.isTrialing).toBe(true);
    // Организация создана только что — осталось 14 дней (или 13 на стыке суток)
    expect(payload.billing.trialDaysLeft).toBeGreaterThanOrEqual(13);
    expect(payload.billing.trialDaysLeft).toBeLessThanOrEqual(14);
    expect(payload.billing.vehicleLimit).toBeNull();
    expect(payload.billing.priceRubPerMonth).toBe(0);
    expect(payload.billing.vehicleCount).toBe(1); // vehicleA из сида
    expect(payload.canManage).toBe(true);
  });

  it("логист видит тариф, но менять его не может", async () => {
    const { payload } = await getSettings(cookieLogistA);
    expect(payload.success).toBe(true);
    expect(payload.canManage).toBe(false);
  });

  it("тариф организации Б не протекает в ответ организации А", async () => {
    const { payload } = await getSettings(cookieAdminB);
    expect(payload.success).toBe(true);
    expect(payload.billing.vehicleCount).toBe(1); // только vehicleB
    expectNoForeignIds(payload, world);
  });
});

describe("тарифы: смена плана", () => {
  it("не администратор план сменить не может (403)", async () => {
    const { status, payload } = await postSettings(cookieLogistA, { plan: "start" });
    expect(status).toBe(403);
    expect(payload.success).toBe(false);
  });

  it("неизвестный план и пустое тело — 400", async () => {
    const bad = await postSettings(cookieAdminA, { plan: "oligarch" });
    expect(bad.status).toBe(400);
    const empty = await postSettings(cookieAdminA, {});
    expect(empty.status).toBe(400);
  });

  it("администратор выбирает план, и он сохраняется", async () => {
    const { status, payload } = await postSettings(cookieAdminA, { plan: "free" });
    expect(status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings.plan).toBe("free");

    const after = await getSettings(cookieAdminA);
    expect(after.payload.billing.plan).toBe("free");
    expect(after.payload.billing.isTrialing).toBe(false);
    expect(after.payload.billing.vehicleLimit).toBe(2);
  });

  it("прежний контракт { atiEnabled } не сломан", async () => {
    const { status, payload } = await postSettings(cookieAdminA, {
      atiEnabled: false,
    });
    expect(status).toBe(200);
    expect(payload.settings.atiEnabled).toBe(false);
    // План не трогали — остаётся пробный
    expect(payload.settings.plan).toBe("trial");
  });
});

describe("тарифы: лимит машин", () => {
  it("на бесплатном плане третья машина — 409 plan_limit", async () => {
    await postSettings(cookieAdminA, { plan: "free" });

    // Вторая машина (всего 2) — проходит
    const second = await createVehicle(cookieAdminA, "В002ВВ77");
    expect(second.status).toBe(200);
    expect(second.payload.success).toBe(true);

    // Третья — упирается в лимит
    const third = await createVehicle(cookieAdminA, "В003ВВ77");
    expect(third.status).toBe(409);
    expect(third.payload.success).toBe(false);
    expect(third.payload.code).toBe("plan_limit");
    expect(third.payload.plan).toBe("free");
    expect(third.payload.limit).toBe(2);
    expect(third.payload.error).toContain("Тариф");
  });

  it("пробный период лимит не включает", async () => {
    // План по умолчанию trial, организация свежая — машин можно больше двух
    const second = await createVehicle(cookieAdminA, "В002ВВ77");
    expect(second.status).toBe(200);
    const third = await createVehicle(cookieAdminA, "В003ВВ77");
    expect(third.status).toBe(200);
  });

  it("переход на «Парк» снимает ограничение", async () => {
    await postSettings(cookieAdminA, { plan: "free" });
    await createVehicle(cookieAdminA, "В002ВВ77");
    const blocked = await createVehicle(cookieAdminA, "В003ВВ77");
    expect(blocked.status).toBe(409);

    // Платный тариф подключает владелец платформы, а не администратор кнопкой
    process.env.PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const cookieOwner = await platformOwnerCookie();
    const upgraded = await postSettings(cookieOwner, { plan: "park" });
    expect(upgraded.status).toBe(200);

    const third = await createVehicle(cookieAdminA, "В003ВВ77");
    expect(third.status).toBe(200);
    expect(third.payload.success).toBe(true);
  });

  it("лимит своей организации не мешает чужой", async () => {
    // А упирается в лимит, Б (своим планом) — нет
    await postSettings(cookieAdminA, { plan: "free" });
    await createVehicle(cookieAdminA, "В002ВВ77");
    const blockedA = await createVehicle(cookieAdminA, "В003ВВ77");
    expect(blockedA.status).toBe(409);

    const okB = await createVehicle(cookieAdminB, "В004ВВ77");
    expect(okB.status).toBe(200);
  });
});

describe("тарифы: платный тариф подключает владелец платформы", () => {
  it("администратор организации не включает платный тариф кнопкой (403)", async () => {
    process.env.BILLING_CONTACT_EMAIL = "sales@loginex.test";
    const { status, payload } = await postSettings(cookieAdminA, { plan: "park" });
    expect(status).toBe(403);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("plan_requires_payment");
    // в сообщении есть куда написать — иначе непонятно, что делать дальше
    expect(payload.error).toContain("sales@loginex.test");

    // тариф не изменился: бесплатно «Парк» не включается
    const after = await getSettings(cookieAdminA);
    expect(after.payload.billing.plan).toBe("trial");
  });

  it("бесплатный план администратор выбирает сам: понижать можно всегда", async () => {
    const { status, payload } = await postSettings(cookieAdminA, { plan: "free" });
    expect(status).toBe(200);
    expect(payload.settings.plan).toBe("free");
  });

  it("владелец платформы подключает платный тариф", async () => {
    process.env.PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const cookieOwner = await platformOwnerCookie();

    const read = await getSettings(cookieOwner);
    expect(read.payload.canSelectPaidPlan).toBe(true);

    const { status, payload } = await postSettings(cookieOwner, { plan: "park" });
    expect(status).toBe(200);
    expect(payload.settings.plan).toBe("park");

    const after = await getSettings(cookieOwner);
    expect(after.payload.billing.plan).toBe("park");
    expect(after.payload.billing.vehicleLimit).toBe(15);
  });

  it("обычному администратору в ответе видно, что платные тарифы не ему", async () => {
    const { payload } = await getSettings(cookieAdminA);
    expect(payload.canSelectPaidPlan).toBe(false);
  });
});
