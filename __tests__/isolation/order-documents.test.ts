// __tests__/isolation/order-documents.test.ts
//
// Документы заказа (GET /api/orders/[id]/documents): ТТН, акт и счёт
// собираются только по заказу своей организации; чужой заказ — 404.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest";

import {
  jsonOf,
  makeRequest,
  routeContext,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers";

import { GET as documentsGet } from "@/app/api/orders/[id]/documents/route";

let world: World;
let cookieA: string;
let cookieB: string;

beforeEach(async () => {
  world = seedWorld();
  cookieA = await sessionCookie({
    userId: world.adminA,
    role: "admin",
    kind: "staff",
  });
  cookieB = await sessionCookie({
    userId: world.adminB,
    role: "admin",
    kind: "staff",
  });
});

describe("документы заказа (GET /api/orders/[id]/documents)", () => {
  it("свой заказ: полный комплект — ТТН, акт и счёт", async () => {
    const response = await documentsGet(
      makeRequest("GET", `/api/orders/${world.orderA}/documents`, {
        cookie: cookieA,
      }),
      routeContext({ id: world.orderA }),
    );
    const data = await jsonOf(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.order.id).toBe(world.orderA);
    expect(data.documents.map((doc: any) => doc.kind)).toEqual([
      "ttn",
      "act",
      "invoice",
    ]);
    // номер документа заказа — с префиксом «З», не рейсовый «Р»
    for (const doc of data.documents) {
      expect(doc.number.startsWith("З-")).toBe(true);
    }
  });

  it("выбранные виды: только то, что попросили", async () => {
    const response = await documentsGet(
      makeRequest(
        "GET",
        `/api/orders/${world.orderA}/documents?types=invoice`,
        {
          cookie: cookieA,
        },
      ),
      routeContext({ id: world.orderA }),
    );
    const data = await jsonOf(response);

    expect(response.status).toBe(200);
    expect(data.documents.map((doc: any) => doc.kind)).toEqual(["invoice"]);
  });

  it("чужой заказ → 404, документы не собираются", async () => {
    const response = await documentsGet(
      makeRequest("GET", `/api/orders/${world.orderB}/documents`, {
        cookie: cookieA,
      }),
      routeContext({ id: world.orderB }),
    );

    expect(response.status).toBe(404);
  });

  it("без сессии → 401", async () => {
    const response = await documentsGet(
      makeRequest("GET", `/api/orders/${world.orderA}/documents`, {}),
      routeContext({ id: world.orderA }),
    );

    expect(response.status).toBe(401);
  });
});
