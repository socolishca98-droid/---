// __tests__/isolation/assistant-plan.test.ts
//
// Виртуальный логист (GET /api/assistant/plan): предложения маршрута
// собираются только из своих заказов и машин, чужая машина — 404,
// исключённые заказы в цепочки не возвращаются.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest";

import { memoryDb } from "../__mocks__/prisma-memory";
import {
  cid,
  jsonOf,
  makeRequest,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers";

import { GET as planGet } from "@/app/api/assistant/plan/route";

let world: World;
let cookieA: string;

const FUTURE = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

function seedPlanOrder(
  slug: string,
  organizationId: string,
  overrides: Record<string, unknown> = {},
) {
  const id = cid(slug);
  memoryDb.insert("order", {
    id,
    organizationId,
    source: "manual",
    routeFrom: "Ярославль",
    routeTo: "Москва",
    distance: 270,
    weight: 5000,
    cargoType: "Груз",
    clientContact: "",
    clientName: "ООО Ромашка",
    status: "agreed",
    createdAt: new Date(),
    deadline: FUTURE,
    price: 40000,
    isPaid: false,
    routeId: null,
    ...overrides,
  });
  return id;
}

function seedVehicle(slug: string, organizationId: string, capacity: number) {
  const id = cid(slug);
  memoryDb.insert("vehicle", {
    id,
    organizationId,
    plate: `А${slug.length}01АА76`,
    type: "truck",
    capacity,
    status: "available",
    createdAt: new Date(),
  });
  return id;
}

async function plan(cookie: string | null, query = "") {
  const response = await planGet(
    makeRequest("GET", `/api/assistant/plan${query}`, { cookie }),
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

describe("виртуальный логист (GET /api/assistant/plan)", () => {
  it("без сессии — 401", async () => {
    const { response } = await plan(null);
    expect(response.status).toBe(401);
  });

  it("предложения — только из своих заказов, машина — только своя", async () => {
    const ownA = seedPlanOrder("plan-a", world.orgA);
    seedPlanOrder("plan-b", world.orgA, {
      routeFrom: "Москва",
      routeTo: "Тула",
      status: "negotiation",
    });
    const foreign = seedPlanOrder("plan-foreign", world.orgB);

    const vehicleA = seedVehicle("veh-a", world.orgA, 20000);
    seedVehicle("veh-b", world.orgB, 30000);

    const { response, data } = await plan(cookieA);
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // машина — своей организации (чужая 30-тонная не выбрана)
    expect(data.vehicle.id).toBe(vehicleA);
    expect(data.vehicles.every((v: any) => v.id !== undefined)).toBe(true);

    // в цепочках только свои заказы
    expect(data.stats.candidates).toBe(2);
    for (const proposal of data.proposals) {
      for (const order of proposal.orders) {
        expect(order.id).not.toBe(foreign);
        expect([ownA].includes(order.id) || order.routeFrom !== undefined).toBe(
          true,
        );
      }
    }
    const ids = data.proposals.flatMap((p: any) =>
      p.orders.map((o: any) => o.id),
    );
    expect(ids).toContain(ownA);
    expect(ids).not.toContain(foreign);
  });

  it("чужая машина — 404", async () => {
    seedPlanOrder("plan-a", world.orgA);
    seedVehicle("veh-a", world.orgA, 20000);
    const foreignVehicle = seedVehicle("veh-b", world.orgB, 30000);

    const { response } = await plan(cookieA, `?vehicleId=${foreignVehicle}`);
    expect(response.status).toBe(404);
  });

  it("исключённый заказ не возвращается ни в один вариант", async () => {
    const keep = seedPlanOrder("plan-a", world.orgA);
    const drop = seedPlanOrder("plan-drop", world.orgA, {
      routeFrom: "Москва",
      routeTo: "Тула",
    });
    seedVehicle("veh-a", world.orgA, 20000);

    const { response, data } = await plan(cookieA, `?exclude=${drop}`);
    expect(response.status).toBe(200);
    expect(data.stats.excluded).toBe(1);

    const ids = data.proposals.flatMap((p: any) =>
      p.orders.map((o: any) => o.id),
    );
    expect(ids).not.toContain(drop);
    expect(ids).toContain(keep);
  });

  it("нет свободных машин — честное предупреждение, а не ошибка", async () => {
    seedPlanOrder("plan-a", world.orgA);
    const busy = seedVehicle("veh-busy", world.orgA, 20000);
    // все машины организации А заняты (включая посеянные seedWorld)
    for (const id of [busy, world.vehicleA]) {
      const row: any = memoryDb.find("vehicle", id);
      if (row) row.status = "in_use";
    }

    const { response, data } = await plan(cookieA);
    expect(response.status).toBe(200);
    expect(data.vehicle).toBe(null);
    expect(data.proposals).toEqual([]);
    expect(data.warning).toContain("Свободных машин нет");
  });
});

// ---------------------------------------------------------------------------
// Дособорка рейса и актуальность заказов
// ---------------------------------------------------------------------------

function seedPlanRoute(
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

describe("дособорка рейса (GET /api/assistant/plan?routeId=)", () => {
  it("чужой рейс — 404", async () => {
    const routeId = seedPlanRoute("route-b", world.orgB);

    const { response } = await plan(cookieA, `?routeId=${routeId}`);
    expect(response.status).toBe(404);
  });

  it("бюджет машины и город цепочки берутся из рейса", async () => {
    const vehicleId = seedVehicle("truck12", world.orgA, 12000);
    const routeId = seedPlanRoute("route-a", world.orgA, { vehicleId });
    const inRouteId = seedPlanOrder("inroute", world.orgA, {
      status: "in_route",
      routeId,
      routeSequence: 1,
      weight: 5000,
    });
    const freeId = seedPlanOrder("free1", world.orgA, {
      routeFrom: "Москва",
      routeTo: "Тула",
      weight: 5000,
    });

    const { response, data } = await plan(
      cookieA,
      `?routeId=${routeId}&vehicleId=${vehicleId}`,
    );

    expect(response.status).toBe(200);
    expect(data.route).toBeTruthy();
    expect(data.route.ordersCount).toBe(1);
    expect(data.route.usedWeightKg).toBe(5000);
    // 12000 кг машины − 5000 кг груза рейса
    expect(data.route.freeWeightKg).toBe(7000);
    // цепочка продолжается с города последней выгрузки рейса
    expect(data.route.lastCity).toBe("Москва");

    const ids = data.proposals.flatMap((p: any) =>
      p.orders.map((o: any) => o.id),
    );
    expect(ids).toContain(freeId);
    expect(ids).not.toContain(inRouteId);
    // итоговый вес варианта включает груз рейса
    const best = data.proposals.find((p: any) =>
      p.orders.some((o: any) => o.id === freeId),
    );
    expect(best.totalWeightKg).toBe(10000);
  });

  it("заказ тяжелее остатка грузоподъёмности не предлагается", async () => {
    const vehicleId = seedVehicle("truck7", world.orgA, 12000);
    const routeId = seedPlanRoute("route-full", world.orgA, { vehicleId });
    seedPlanOrder("inroute2", world.orgA, {
      status: "in_route",
      routeId,
      routeSequence: 1,
      weight: 5000,
    });
    const heavyId = seedPlanOrder("heavy", world.orgA, {
      routeFrom: "Москва",
      weight: 8000,
    });

    const { data } = await plan(
      cookieA,
      `?routeId=${routeId}&vehicleId=${vehicleId}`,
    );

    const ids = data.proposals.flatMap((p: any) =>
      p.orders.map((o: any) => o.id),
    );
    expect(ids).not.toContain(heavyId);
    expect(data.stats.overweight).toBeGreaterThanOrEqual(1);
  });

  it("бюджет дособорки задаёт машина рейса, даже если она занята", async () => {
    // машина рейса занята (в рейсе), 10 000 кг
    const routeVehicleId = seedVehicle("busy10", world.orgA, 10000);
    memoryDb.find("vehicle", routeVehicleId)!.status = "in_route";
    // свободная машина побольше — она НЕ должна задавать бюджет дособорки
    seedVehicle("free20", world.orgA, 20000);

    const routeId = seedPlanRoute("route-busy", world.orgA, {
      vehicleId: routeVehicleId,
    });
    seedPlanOrder("inroute3", world.orgA, {
      status: "in_route",
      routeId,
      routeSequence: 1,
      weight: 4000,
    });
    const heavyId = seedPlanOrder("heavy7", world.orgA, {
      routeFrom: "Москва",
      weight: 7000,
    });

    const { data } = await plan(cookieA, `?routeId=${routeId}`);

    // бюджет от машины рейса: 10 000 − 4 000 = 6 000 кг
    expect(data.vehicle.id).toBe(routeVehicleId);
    expect(data.route.vehiclePlate).toBeTruthy();
    expect(data.route.freeWeightKg).toBe(6000);

    // 7 000 кг в остаток 6 000 кг не помещаются
    const ids = data.proposals.flatMap((p: any) =>
      p.orders.map((o: any) => o.id),
    );
    expect(ids).not.toContain(heavyId);
  });
});

describe("актуальность заказов", () => {
  it("истёкший срок и долгое бездействие — вне плана, отдельным списком", async () => {
    const vehicleId = seedVehicle("truck20", world.orgA, 20000);
    const expiredId = seedPlanOrder("expired", world.orgA, {
      deadline: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const idleId = seedPlanOrder("idle", world.orgA, {
      status: "search",
      updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    });
    const liveId = seedPlanOrder("live1", world.orgA, {});

    const { data } = await plan(cookieA, `?vehicleId=${vehicleId}`);

    const ids = data.proposals.flatMap((p: any) =>
      p.orders.map((o: any) => o.id),
    );
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(expiredId);
    expect(ids).not.toContain(idleId);

    expect(data.stats.stale).toBe(2);
    const staleIds = data.staleOrders.map((o: any) => o.id);
    expect(staleIds).toContain(expiredId);
    expect(staleIds).toContain(idleId);

    const expired = data.staleOrders.find((o: any) => o.id === expiredId);
    expect(expired.reason).toContain("Срок");
    const idle = data.staleOrders.find((o: any) => o.id === idleId);
    expect(idle.reason).toContain("Без движения");
  });

  it("согласованный заказ актуален, даже если давно без движения", async () => {
    const vehicleId = seedVehicle("truck21", world.orgA, 20000);
    const agreedId = seedPlanOrder("old-agreed", world.orgA, {
      status: "agreed",
      updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    });

    const { data } = await plan(cookieA, `?vehicleId=${vehicleId}`);

    const ids = data.proposals.flatMap((p: any) =>
      p.orders.map((o: any) => o.id),
    );
    expect(ids).toContain(agreedId);
    expect(data.stats.stale).toBe(0);
  });
});
