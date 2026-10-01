// __tests__/isolation/org-settings.test.ts
//
// Возможности организации (ATI вкл/выкл) и заказ от постоянного клиента:
//   * настройки у каждой организации свои — переключатель в А не трогает Б;
//   * переключает только администратор, логист получает 403;
//   * с выключенным ATI роуты биржи отвечают 403 code=ati_disabled,
//     а у соседней организации продолжают работать;
//   * заказ от клиента: карточка клиента чужой организации не принимается
//     (404), условия оплаты наследуются из карточки своей организации.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest";

import { memoryDb } from "../__mocks__/prisma-memory";
import {
  cid,
  jsonOf,
  makeRequest,
  rowOf,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers";

import {
  GET as settingsGet,
  POST as settingsPost,
} from "@/app/api/org-settings/route";
import { GET as sandboxGet } from "@/app/api/ati/sandbox/route";
import { POST as ordersPost } from "@/app/api/orders/route";

let world: World;
let cookieAdminA: string;
let cookieLogistA: string;
let cookieAdminB: string;

/** Карточка клиента с условиями оплаты (по умолчанию — организация А). */
function seedClient(slug: string, organizationId?: string) {
  const id = cid(slug);
  memoryDb.insert("client", {
    id,
    organizationId: organizationId ?? world.orgA,
    name: `ООО ${slug}`,
    nameKey: slug,
    contactName: "Пётр Иванов",
    phone: "79001234567",
    paymentType: "bank",
    vatType: "vat20",
    deferredDays: 14,
    source: "manual",
  });
  return id;
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

describe("GET /api/org-settings", () => {
  it("без строки настроек действуют значения по умолчанию (ATI включён)", async () => {
    const data = await jsonOf(
      await settingsGet(
        makeRequest("GET", "/api/org-settings", { cookie: cookieAdminA }),
      ),
    );
    expect(data.success).toBe(true);
    expect(data.settings.atiEnabled).toBe(true);
  });

  it("без сессии — 401", async () => {
    const response = await settingsGet(makeRequest("GET", "/api/org-settings"));
    expect(response.status).toBe(401);
  });
});

describe("POST /api/org-settings", () => {
  it("логист не может переключать возможности — 403", async () => {
    const response = await settingsPost(
      makeRequest("POST", "/api/org-settings", {
        cookie: cookieLogistA,
        body: { atiEnabled: false },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("администратор выключает ATI только в своей организации", async () => {
    const data = await jsonOf(
      await settingsPost(
        makeRequest("POST", "/api/org-settings", {
          cookie: cookieAdminA,
          body: { atiEnabled: false },
        }),
      ),
    );
    expect(data.success).toBe(true);
    expect(data.settings.atiEnabled).toBe(false);

    // организация А — выключено
    const a = await jsonOf(
      await settingsGet(
        makeRequest("GET", "/api/org-settings", { cookie: cookieAdminA }),
      ),
    );
    expect(a.settings.atiEnabled).toBe(false);

    // организация Б — не тронута
    const b = await jsonOf(
      await settingsGet(
        makeRequest("GET", "/api/org-settings", { cookie: cookieAdminB }),
      ),
    );
    expect(b.settings.atiEnabled).toBe(true);
  });

  it("без авторизации — 401", async () => {
    const response = await settingsPost(
      makeRequest("POST", "/api/org-settings", { body: { atiEnabled: false } }),
    );
    expect(response.status).toBe(401);
  });
});

describe("ATI-гейт (выключенная биржа)", () => {
  it("роуты ATI отвечают 403 code=ati_disabled, у соседей работают", async () => {
    await settingsPost(
      makeRequest("POST", "/api/org-settings", {
        cookie: cookieAdminA,
        body: { atiEnabled: false },
      }),
    );

    const denied = await sandboxGet(
      makeRequest("GET", "/api/ati/sandbox", { cookie: cookieAdminA }),
    );
    const deniedData = await jsonOf(denied);
    expect(denied.status).toBe(403);
    expect(deniedData.code).toBe("ati_disabled");

    const allowed = await sandboxGet(
      makeRequest("GET", "/api/ati/sandbox", { cookie: cookieAdminB }),
    );
    expect(allowed.status).toBe(200);
  });

  it("после включения обратно ATI снова доступен", async () => {
    await settingsPost(
      makeRequest("POST", "/api/org-settings", {
        cookie: cookieAdminA,
        body: { atiEnabled: false },
      }),
    );
    await settingsPost(
      makeRequest("POST", "/api/org-settings", {
        cookie: cookieAdminA,
        body: { atiEnabled: true },
      }),
    );
    const response = await sandboxGet(
      makeRequest("GET", "/api/ati/sandbox", { cookie: cookieAdminA }),
    );
    expect(response.status).toBe(200);
  });
});

describe("заказ от постоянного клиента (POST /api/orders)", () => {
  it("создаёт заказ на этапе «Согласование» с условиями из карточки", async () => {
    const clientId = seedClient("romashka");

    const data = await jsonOf(
      await ordersPost(
        makeRequest("POST", "/api/orders", {
          cookie: cookieAdminA,
          body: {
            source: "client",
            clientId,
            routeFrom: "Москва",
            routeTo: "Казань",
            distance: 820,
            weight: 15000,
            cargoType: "Стройматериалы",
            price: 85000,
          },
        }),
      ),
    );

    expect(data.success).toBe(true);
    const row = rowOf("order", data.order.id);
    expect(row.organizationId).toBe(world.orgA);
    expect(row.source).toBe("client");
    expect(row.clientId).toBe(clientId);
    expect(row.clientName).toBe("ООО romashka");
    expect(row.status).toBe("negotiation");
    // условия оплаты унаследованы из карточки клиента
    expect(row.paymentType).toBe("bank");
    expect(row.vatType).toBe("vat20");
    expect(row.deferredDays).toBe(14);
    expect(row.clientContact).toBe("Пётр Иванов, 79001234567");
  });

  it("карточка клиента чужой организации не принимается — 404", async () => {
    const foreignClient = seedClient("foreign", world.orgB);

    const response = await ordersPost(
      makeRequest("POST", "/api/orders", {
        cookie: cookieAdminA,
        body: {
          source: "client",
          clientId: foreignClient,
          routeFrom: "Москва",
          routeTo: "Казань",
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("значения из запроса перекрывают условия карточки", async () => {
    const clientId = seedClient("perekr");

    const data = await jsonOf(
      await ordersPost(
        makeRequest("POST", "/api/orders", {
          cookie: cookieAdminA,
          body: {
            source: "client",
            clientId,
            routeFrom: "Тверь",
            routeTo: "Псков",
            paymentType: "cash",
            deferredDays: 0,
          },
        }),
      ),
    );

    expect(data.success).toBe(true);
    const row = rowOf("order", data.order.id);
    expect(row.paymentType).toBe("cash");
    expect(row.deferredDays).toBe(0);
    // НДС не переопределён — наследуется из карточки
    expect(row.vatType).toBe("vat20");
  });
});
