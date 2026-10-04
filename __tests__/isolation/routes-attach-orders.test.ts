// __tests__/isolation/routes-attach-orders.test.ts
//
// Дособорка рейса (POST /api/routes/[routeId]/attach-orders): существующие
// согласованные заказы добавляются в уже созданный рейс — только своя
// организация, только согласованные и свободные заказы, порядковый номер
// продолжается от последнего в рейсе, статус переводится в «в рейсе»
// с записью в ленту согласования.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest";

import { memoryDb } from "../__mocks__/prisma-memory";
import {
  cid,
  jsonOf,
  makeRequest,
  routeContext,
  rowOf,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers";

import { POST as attachPost } from "@/app/api/routes/[routeId]/attach-orders/route";

let world: World;
let cookieA: string;

const FUTURE = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

function seedRoute(
  slug: string,
  organizationId: string,
  overrides: Record<string, unknown> = {},
) {
  const id = cid(slug);
  memoryDb.insert("route", {
    id,
    organizationId,
    name: `Рейс ${slug}`,
    status: "planned",
    vehicleId: null,
    driverId: null,
    totalDistance: 0,
    cargoWeight: 0,
    createdAt: new Date(),
    ...overrides,
  });
  return id;
}

function seedOrder(
  slug: string,
  organizationId: string,
  overrides: Record<string, unknown> = {},
) {
  const id = cid(slug);
  memoryDb.insert("order", {
    id,
    organizationId,
    source: "manual",
    routeFrom: "Москва",
    routeTo: "Тула",
    distance: 180,
    weight: 3000,
    cargoType: "Груз",
    clientContact: "",
    clientName: "ООО Ромашка",
    status: "agreed",
    negotiationStatus: "agreed",
    createdAt: new Date(),
    deadline: FUTURE,
    price: 30000,
    isPaid: false,
    routeId: null,
    routeSequence: null,
    addedToRouteAt: null,
    ...overrides,
  });
  return id;
}

async function attach(
  cookie: string | null,
  routeId: string,
  orderIds: string[],
) {
  const response = await attachPost(
    makeRequest("POST", `/api/routes/${routeId}/attach-orders`, {
      cookie,
      body: { orderIds },
    }),
    routeContext({ routeId }),
  );
  return { response, data: await jsonOf(response) };
}

beforeEach(async () => {
  world = seedWorld();
  cookieA = await sessionCookie({
    userId: world.adminA,
    role: "admin",
    kind: "staff",
  });
});

describe("дособорка рейса (POST /api/routes/[routeId]/attach-orders)", () => {
  it("без сессии — 401", async () => {
    const routeId = seedRoute("r-anon", world.orgA);
    const orderId = seedOrder("o-anon", world.orgA);

    const { response } = await attach(null, routeId, [orderId]);
    expect(response.status).toBe(401);
  });

  it("чужой рейс — 404", async () => {
    const routeId = seedRoute("r-b", world.orgB);
    const orderId = seedOrder("o-a", world.orgA);

    const { response } = await attach(cookieA, routeId, [orderId]);
    expect(response.status).toBe(404);
  });

  it("чужой или несуществующий заказ — 404", async () => {
    const routeId = seedRoute("r-a1", world.orgA);
    const foreignOrder = seedOrder("o-b1", world.orgB);

    const { response, data } = await attach(cookieA, routeId, [
      foreignOrder,
      "несуществующий",
    ]);
    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
  });

  it("пустой список заказов — 400", async () => {
    const routeId = seedRoute("r-a2", world.orgA);

    const { response } = await attach(cookieA, routeId, []);
    expect(response.status).toBe(400);
  });

  it("несогласованный заказ — 409 orders_not_agreed", async () => {
    const routeId = seedRoute("r-a3", world.orgA);
    const orderId = seedOrder("o-search", world.orgA, { status: "search" });

    const { response, data } = await attach(cookieA, routeId, [orderId]);
    expect(response.status).toBe(409);
    expect(data.code).toBe("orders_not_agreed");
    expect(rowOf("order", orderId).routeId).toBeNull();
  });

  it("заказ уже в рейсе — 409 orders_already_in_route", async () => {
    const routeId = seedRoute("r-a4", world.orgA);
    const otherRouteId = seedRoute("r-a5", world.orgA);
    const orderId = seedOrder("o-busy", world.orgA, { routeId: otherRouteId });

    const { response, data } = await attach(cookieA, routeId, [orderId]);
    expect(response.status).toBe(409);
    expect(data.code).toBe("orders_already_in_route");
    // заказ остался в своём рейсе
    expect(rowOf("order", orderId).routeId).toBe(otherRouteId);
  });

  it("завершённый рейс — 409", async () => {
    const routeId = seedRoute("r-done", world.orgA, { status: "completed" });
    const orderId = seedOrder("o-late", world.orgA);

    const { response } = await attach(cookieA, routeId, [orderId]);
    expect(response.status).toBe(409);
    expect(rowOf("order", orderId).routeId).toBeNull();
  });

  it("успех: порядок продолжается, статус «в рейсе», лента согласования", async () => {
    const routeId = seedRoute("r-ok", world.orgA);
    seedOrder("o-inroute", world.orgA, {
      routeId,
      routeSequence: 5,
      status: "in_route",
      routeFrom: "Ярославль",
      routeTo: "Москва",
    });
    // Намеренно вставляем в таблицу в обратном порядке: нумерация в рейсе
    // должна идти по порядку цепочки из запроса, а не по выдаче таблицы.
    const second = seedOrder("o-second", world.orgA, {
      routeFrom: "Тула",
      routeTo: "Калуга",
    });
    const first = seedOrder("o-first", world.orgA, {
      routeFrom: "Москва",
      routeTo: "Тула",
    });

    const { response, data } = await attach(cookieA, routeId, [first, second]);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.attached).toBe(2);
    expect(data.route.id).toBe(routeId);
    expect(data.route.ordersCount).toBe(3);

    // заказы привязаны к рейсу, порядок продолжен от последнего (5 → 6, 7)
    const rowFirst = rowOf("order", first);
    const rowSecond = rowOf("order", second);
    expect(rowFirst.routeId).toBe(routeId);
    expect(rowSecond.routeId).toBe(routeId);
    // строго в порядке запроса: first — 6, second — 7
    expect(rowFirst.routeSequence).toBe(6);
    expect(rowSecond.routeSequence).toBe(7);
    // статус переведён в «в рейсе», время добавления запомнено
    expect(rowFirst.status).toBe("in_route");
    expect(rowSecond.status).toBe("in_route");
    expect(rowFirst.addedToRouteAt).toBeTruthy();

    // смена статуса попала в ленту согласования заказа
    const talks = memoryDb
      .rows("orderNegotiation")
      .filter((row: any) => row.orderId === first);
    expect(
      talks.some(
        (row: any) =>
          row.kind === "status_change" && String(row.text).includes("дособран"),
      ),
    ).toBe(true);
  });

  it("перегруженный рейс не собирается — 409 overload, с согласием логиста — собирается", async () => {
    const vehicleId = cid("veh-cap");
    memoryDb.insert("vehicle", {
      id: vehicleId,
      organizationId: world.orgA,
      plate: "С001СС77",
      type: "truck",
      capacity: 5000,
      status: "available",
    });
    const routeId = seedRoute("overload", world.orgA, { vehicleId });
    const first = seedOrder("ov-first", world.orgA, { weight: 3000 });
    const second = seedOrder("ov-second", world.orgA, { weight: 3000 });

    const okFirst = await attach(cookieA, routeId, [first]);
    expect(okFirst.response.status).toBe(200);

    // 3000 + 3000 > 5000: молчаливого перегруза больше нет
    const denied = await attach(cookieA, routeId, [second]);
    expect(denied.response.status).toBe(409);
    expect(denied.data.code).toBe("overload");
    expect(denied.data.details.overflow).toBe(1000);
    expect(rowOf("order", second).routeId).toBe(null);

    // Явное согласие логиста — собираем, ответственность на нём
    const approved = await attachPost(
      makeRequest("POST", `/api/routes/${routeId}/attach-orders`, {
        cookie: cookieA,
        body: { orderIds: [second], overloadApproved: true },
      }),
      routeContext({ routeId }),
    );
    expect(approved.status).toBe(200);
    expect(rowOf("order", second).routeId).toBe(routeId);
  });
});
